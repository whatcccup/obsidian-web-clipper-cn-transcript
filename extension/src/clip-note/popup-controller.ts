import browser from '../utils/browser-polyfill';
import { createTranscription, getHealth, getModelStatus, waitForTranscription } from './api';
import { readBrowserCookies } from './cookies';
import { loadActiveJob, loadClipNoteSettings, loadPanelCollapsed, saveActiveJob, saveCookieSettings, savePanelCollapsed } from './storage';
import { ClipNoteJobState, ClipNotePlatform, StoredCookie, TranscriptResult } from './types';

function platformForUrl(url: string): ClipNotePlatform | null {
	const hostname = new URL(url).hostname.replace(/^www\./, '');
	if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com') || hostname === 'b23.tv') return 'bilibili';
	if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be') return 'youtube';
	return null;
}

function timestamp(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const secs = whole % 60;
	return hours > 0
		? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
		: `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function clipNoteVideoKey(url: string): string {
	const parsed = new URL(url);
	const hostname = parsed.hostname.replace(/^www\./, '');
	if (hostname === 'youtu.be') return `youtube:${parsed.pathname.split('/').filter(Boolean)[0] || parsed.pathname}`;
	if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
		return `youtube:${parsed.searchParams.get('v') || parsed.pathname}`;
	}
	if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com') || hostname === 'b23.tv') {
		const videoId = parsed.pathname.match(/\/video\/(BV[\w]+|av\d+)/i)?.[1] || parsed.pathname;
		return `bilibili:${videoId}:p${parsed.searchParams.get('p') || '1'}`;
	}
	return `${parsed.origin}${parsed.pathname}`;
}

export function formatTranscript(result: TranscriptResult): string {
	return result.segments.length
		? result.segments.map(segment => `[${timestamp(segment.start)}] ${segment.text}`).join('\n')
		: result.fullText;
}

async function cookiesForTask(platform: ClipNotePlatform): Promise<StoredCookie[]> {
	const settings = await loadClipNoteSettings();
	const config = settings.cookies[platform];
	if (config.mode === 'off') return [];
	if (config.mode === 'manual') return config.cookies;
	try {
		const cookies = await readBrowserCookies(platform);
		if (!cookies.length) throw new Error('浏览器中没有可用 Cookie');
		settings.cookies[platform] = {
			...config,
			cookies,
			updatedAt: Date.now(),
			lastValidatedAt: Date.now(),
			status: 'ready',
		};
		await saveCookieSettings(settings.cookies);
		return cookies;
	} catch (error) {
		settings.cookies[platform] = { ...config, status: config.cookies.length ? 'stale' : 'invalid' };
		await saveCookieSettings(settings.cookies);
		if (config.cookies.length) return config.cookies;
		throw error;
	}
}

async function setJobBadge(status: 'active' | 'failed' | 'clear'): Promise<void> {
	try {
		const action = (browser as any).action;
		if (!action?.setBadgeText) return;
		const text = status === 'active' ? 'ASR' : status === 'failed' ? '!' : '';
		await action.setBadgeText({ text });
		if (text && action.setBadgeBackgroundColor) {
			await action.setBadgeBackgroundColor({ color: status === 'failed' ? '#c0392b' : '#6c5ce7' });
		}
	} catch {
		// A badge is helpful feedback, but it must never fail the transcription task.
	}
}

function renderActiveStage(status: HTMLElement, stage: string): void {
	status.textContent = `${stage}。任务已提交，关闭剪藏界面不会取消；重新打开可查看进度。`;
}

async function monitorJob(
	initialJob: ClipNoteJobState,
	button: HTMLButtonElement,
	status: HTMLElement,
	onTranscript: (transcript: string) => Promise<void>,
): Promise<void> {
	let job = initialJob;
	button.disabled = true;
	button.textContent = '字幕生成中';
	renderActiveStage(status, job.stage);
	await setJobBadge('active');
	try {
		const result = await waitForTranscription(job.taskId, async (stage, taskStatus) => {
			if (['queued', 'downloading', 'transcribing'].includes(taskStatus)) {
				job = { ...job, stage, status: taskStatus, updatedAt: Date.now() };
				await saveActiveJob(job);
			}
			renderActiveStage(status, stage);
		});
		job = { ...job, status: 'completed', stage: '字幕已生成', result, updatedAt: Date.now() };
		await saveActiveJob(job);
		await onTranscript(formatTranscript(result));
		status.textContent = '字幕已生成，已写入当前模板的 transcript 变量。';
		button.textContent = '字幕已生成';
		await setJobBadge('clear');
	} catch (error) {
		const message = error instanceof TypeError ? 'Transcript Helper 未连接' : (error as Error).message;
		job = { ...job, status: 'failed', stage: '生成失败', error: message, updatedAt: Date.now() };
		await saveActiveJob(job);
		status.textContent = `生成失败：${message}`;
		button.textContent = '重试生成字幕';
		button.disabled = false;
		await setJobBadge('failed');
	}
}

export async function updateClipNotePanel(
	url: string,
	hasTranscript: boolean,
	onTranscript: (transcript: string) => Promise<void>,
): Promise<void> {
	const panel = document.getElementById('clip-note-panel') as HTMLElement | null;
	const title = document.getElementById('clip-note-title') as HTMLElement | null;
	const toggle = document.getElementById('clip-note-toggle') as HTMLButtonElement | null;
	const content = document.getElementById('clip-note-panel-content') as HTMLElement | null;
	const button = document.getElementById('clip-note-generate') as HTMLButtonElement | null;
	const status = document.getElementById('clip-note-status') as HTMLElement | null;
	if (!panel || !title || !toggle || !content || !button || !status) return;
	title.textContent = 'Transcript Generator';
	let collapsed = await loadPanelCollapsed();
	const renderCollapsed = () => {
		content.hidden = collapsed;
		panel.classList.toggle('is-collapsed', collapsed);
		toggle.textContent = collapsed ? '展开' : '收起';
		toggle.setAttribute('aria-expanded', String(!collapsed));
		toggle.setAttribute('aria-label', collapsed ? '展开字幕生成' : '收起字幕生成');
	};
	renderCollapsed();
	toggle.onclick = async () => {
		collapsed = !collapsed;
		renderCollapsed();
		await savePanelCollapsed(collapsed);
	};
	const platform = platformForUrl(url);
	const settings = await loadClipNoteSettings();
	if (!settings.general.enabled || !platform || hasTranscript) {
		panel.hidden = true;
		return;
	}
	panel.hidden = false;
	const videoKey = clipNoteVideoKey(url);
	const existingJob = await loadActiveJob();
	if (existingJob?.videoKey === videoKey && existingJob.status === 'completed' && existingJob.result) {
		await onTranscript(formatTranscript(existingJob.result));
		status.textContent = '字幕已生成，已恢复到当前模板的 transcript 变量。';
		button.textContent = '字幕已生成';
		button.disabled = true;
		await setJobBadge('clear');
		return;
	}
	if (existingJob?.videoKey === videoKey && ['queued', 'downloading', 'transcribing'].includes(existingJob.status)) {
		void monitorJob(existingJob, button, status, onTranscript);
		return;
	}
	if (existingJob && existingJob.videoKey !== videoKey && ['queued', 'downloading', 'transcribing'].includes(existingJob.status)) {
		status.textContent = `另一个视频的字幕任务仍在运行：${existingJob.stage}。请返回原视频查看结果。`;
		button.textContent = '另一个任务运行中';
		button.disabled = true;
		await setJobBadge('active');
		return;
	}
	button.disabled = false;
	button.textContent = existingJob?.videoKey === videoKey && existingJob.status === 'failed'
		? '重试生成字幕'
		: '生成 transcript 字幕';
	status.textContent = existingJob?.videoKey === videoKey && existingJob.status === 'failed'
		? `上次生成失败：${existingJob.error || '未知错误'}`
		: '点击后将启动本地 Helper。任务提交后可以关闭剪藏界面。';
	button.onclick = async () => {
		button.disabled = true;
		button.textContent = '正在启动';
		status.textContent = '正在连接 Transcript Helper…';
		try {
			await getHealth();
			if (settings.asr.provider === 'faster-whisper') {
				status.textContent = `正在检查本地模型 ${settings.asr.whisperModel}…`;
				const model = await getModelStatus(settings.asr.whisperModel);
				if (model.status !== 'installed') throw new Error(`模型 ${settings.asr.whisperModel} 尚未安装，请先在设置中下载`);
			}
			status.textContent = '正在准备视频访问凭据…';
			const cookies = await cookiesForTask(platform);
			status.textContent = '正在创建字幕任务…';
			const taskId = await createTranscription(url, settings.asr, cookies);
			const now = Date.now();
			const job: ClipNoteJobState = {
				taskId,
				url,
				videoKey,
				provider: settings.asr.provider,
				status: 'queued',
				stage: '等待处理',
				startedAt: now,
				updatedAt: now,
			};
			await saveActiveJob(job);
			await monitorJob(job, button, status, onTranscript);
		} catch (error) {
			const message = error instanceof TypeError ? 'Transcript Helper 未连接' : (error as Error).message;
			status.textContent = `生成失败：${message}`;
			button.textContent = '重试生成字幕';
			button.disabled = false;
		}
	};
}
