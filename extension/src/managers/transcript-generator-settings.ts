import { deleteModel, downloadModel, getHealth, getModelStatus, getTranscribers } from '../transcript-generator/api';
import { parseManualCookies, readBrowserCookies } from '../transcript-generator/cookies';
import { loadTranscriptGeneratorSettings, saveAsrSettings, saveCookieSettings, saveGeneralSettings } from '../transcript-generator/storage';
import { TranscriptGeneratorCookieSettings, TranscriptGeneratorPlatform, PlatformCookieConfig, WhisperModelSize } from '../transcript-generator/types';
import { getHelperStatus, restartHelper, startHelper, stopHelper } from '../transcript-generator/native-client';

const formatDate = (value: number | null) => value ? new Date(value).toLocaleString() : '从未';

const COOKIE_STATUS_LABELS: Record<PlatformCookieConfig['status'], string> = {
	empty: '未配置',
	ready: '读取与格式验证通过',
	stale: '读取失败，正在使用旧缓存',
	invalid: '读取或格式验证失败',
};

function renderCookieSummary(platform: TranscriptGeneratorPlatform, config: PlatformCookieConfig, message?: string): void {
	const summary = document.getElementById(`transcript-generator-${platform}-summary`);
	if (!summary) return;
	summary.dataset.status = config.status;
	summary.textContent = message || `${COOKIE_STATUS_LABELS[config.status]} · ${config.cookies.length} 条 · 更新于 ${formatDate(config.updatedAt)}`;
}

async function savePlatformCookies(platform: TranscriptGeneratorPlatform, cookies: TranscriptGeneratorCookieSettings, config: PlatformCookieConfig): Promise<void> {
	cookies[platform] = config;
	await saveCookieSettings(cookies);
	renderCookieSummary(platform, config);
}

export async function initializeTranscriptGeneratorSettings(): Promise<void> {
	const settings = await loadTranscriptGeneratorSettings();
	const enabled = document.getElementById('transcript-generator-enabled') as HTMLInputElement;
	const provider = document.getElementById('transcript-generator-provider') as HTMLSelectElement;
	const model = document.getElementById('transcript-generator-whisper-model') as HTMLSelectElement;
	const localControls = document.getElementById('transcript-generator-model-controls') as HTMLElement;
	const remoteNotice = document.getElementById('transcript-generator-bcut-notice') as HTMLElement;
	enabled.checked = settings.general.enabled;
	provider.value = settings.asr.provider;
	model.value = settings.asr.whisperModel;

	const refreshProviderVisibility = () => {
		const local = provider.value === 'faster-whisper';
		localControls.hidden = !local;
		remoteNotice.hidden = local;
	};
	refreshProviderVisibility();

	enabled.onchange = () => saveGeneralSettings({ enabled: enabled.checked });
	provider.onchange = async () => {
		await saveAsrSettings({ provider: provider.value as 'bcut' | 'faster-whisper', whisperModel: model.value as WhisperModelSize });
		refreshProviderVisibility();
	};
	model.onchange = () => saveAsrSettings({ provider: provider.value as 'bcut' | 'faster-whisper', whisperModel: model.value as WhisperModelSize });

	const connection = document.getElementById('transcript-generator-connection-status')!;
	const renderRuntime = async () => {
		const runtime = await getHelperStatus();
		connection.textContent = runtime.status === 'ready'
			? `已就绪 · v${runtime.health?.version || 'unknown'} · 空闲 ${runtime.health?.idleTimeoutSeconds || 900} 秒后退出`
			: runtime.status === 'not-installed' ? '尚未安装 Transcript Helper' : 'Helper 未运行';
	};
	document.getElementById('transcript-generator-start')!.addEventListener('click', async () => {
		connection.textContent = '正在连接…';
		try {
			const runtime = await startHelper();
			const health = await getHealth();
			connection.textContent = `已就绪 · v${health.version} · PID ${runtime.pid} · ${Object.entries(health.capabilities).filter(([, value]) => value).map(([key]) => key).join(', ')}`;
		} catch (error) {
			connection.textContent = `未连接 · ${(error as Error).message}`;
		}
	});
	document.getElementById('transcript-generator-stop')!.addEventListener('click', async () => { await stopHelper(); await renderRuntime(); });
	document.getElementById('transcript-generator-restart')!.addEventListener('click', async () => { await restartHelper(); await renderRuntime(); });
	await renderRuntime();

	const bcutStatus = document.getElementById('transcript-generator-bcut-status')!;
	document.getElementById('transcript-generator-bcut-test')!.addEventListener('click', async () => {
		bcutStatus.textContent = '正在连接必剪接口…';
		try {
			const transcribers = await getTranscribers();
			const bcut = transcribers.transcribers.find(item => item.id === 'bcut');
			bcutStatus.textContent = bcut?.available ? '接口可达，可以使用' : '接口不可用，请稍后重试';
		} catch (error) {
			bcutStatus.textContent = `测试失败：${(error as Error).message}`;
		}
	});

	const modelStatus = document.getElementById('transcript-generator-model-status')!;
	const refreshModel = async () => {
		try {
			const result = await getModelStatus(model.value as WhisperModelSize);
			const labels = { 'not-installed': '未安装', downloading: '正在下载', failed: '下载失败，可重试' } as const;
			modelStatus.textContent = result.status === 'installed' ? `已安装 · ${(result.sizeBytes / 1024 / 1024).toFixed(0)} MB` : labels[result.status];
		} catch (error) {
			modelStatus.textContent = `无法读取状态 · ${(error as Error).message}`;
		}
	};
	document.getElementById('transcript-generator-model-download')!.addEventListener('click', async () => {
		modelStatus.textContent = '正在下载；可稍后刷新状态';
		try { await downloadModel(model.value as WhisperModelSize); } catch (error) { modelStatus.textContent = `下载失败 · ${(error as Error).message}`; }
	});
	document.getElementById('transcript-generator-model-refresh')!.addEventListener('click', refreshModel);
	document.getElementById('transcript-generator-model-delete')!.addEventListener('click', async () => {
		if (!confirm(`删除本机模型 ${model.value}？`)) return;
		await deleteModel(model.value as WhisperModelSize);
		await refreshModel();
	});

	for (const platform of ['bilibili', 'youtube'] as TranscriptGeneratorPlatform[]) {
		const mode = document.getElementById(`transcript-generator-${platform}-mode`) as HTMLSelectElement;
		const input = document.getElementById(`transcript-generator-${platform}-manual`) as HTMLTextAreaElement;
		const browserControls = document.getElementById(`transcript-generator-${platform}-browser-controls`) as HTMLElement;
		const manualControls = document.getElementById(`transcript-generator-${platform}-manual-controls`) as HTMLElement;
		const refreshControls = () => {
			browserControls.hidden = mode.value !== 'browser';
			manualControls.hidden = mode.value !== 'manual';
		};
		const importBrowserCookies = async () => {
			renderCookieSummary(platform, settings.cookies[platform], '正在请求权限并读取浏览器 Cookies…');
			try {
				const imported = await readBrowserCookies(platform);
				if (!imported.length) throw new Error('当前 Chrome 用户中没有找到该平台的 Cookie，请先登录网站');
				const next: PlatformCookieConfig = {
					mode: 'browser', cookies: imported, status: 'ready', updatedAt: Date.now(), lastValidatedAt: Date.now(),
				};
				await savePlatformCookies(platform, settings.cookies, next);
				renderCookieSummary(platform, next, `自动读取成功：已保存 ${imported.length} 条 Cookie；格式与域名验证通过`);
			} catch (error) {
				const previous = settings.cookies[platform];
				const next: PlatformCookieConfig = {
					...previous,
					mode: 'browser',
					status: previous.cookies.length ? 'stale' : 'invalid',
				};
				await savePlatformCookies(platform, settings.cookies, next);
				renderCookieSummary(platform, next, `自动读取失败：${(error as Error).message}`);
			}
		};
		mode.value = settings.cookies[platform].mode;
		refreshControls();
		renderCookieSummary(platform, settings.cookies[platform]);
		mode.onchange = async () => {
			const nextMode = mode.value as PlatformCookieConfig['mode'];
			refreshControls();
			if (nextMode === 'browser') {
				await importBrowserCookies();
				return;
			}
			let next: PlatformCookieConfig = { ...settings.cookies[platform], mode: nextMode };
			if (nextMode === 'off') next = { ...next, cookies: [], status: 'empty', updatedAt: Date.now(), lastValidatedAt: null };
			await savePlatformCookies(platform, settings.cookies, next);
			if (nextMode === 'manual') renderCookieSummary(platform, next, '请粘贴 Cookie Header 或 cookies.txt，然后点击“导入并验证”');
		};
		document.getElementById(`transcript-generator-${platform}-browser-read`)!.addEventListener('click', importBrowserCookies);
		document.getElementById(`transcript-generator-${platform}-import`)!.addEventListener('click', async () => {
			try {
				const parsed = parseManualCookies(input.value, platform);
				const next: PlatformCookieConfig = {
					mode: 'manual', cookies: parsed, updatedAt: Date.now(), lastValidatedAt: Date.now(), status: 'ready',
				};
				await savePlatformCookies(platform, settings.cookies, next);
				input.value = '';
				mode.value = 'manual';
				refreshControls();
				renderCookieSummary(platform, next, `手动导入成功：已保存 ${parsed.length} 条 Cookie；格式与域名验证通过`);
			} catch (error) {
				const next = { ...settings.cookies[platform], mode: 'manual' as const, status: 'invalid' as const };
				await savePlatformCookies(platform, settings.cookies, next);
				renderCookieSummary(platform, next, `导入失败：${(error as Error).message}`);
			}
		});
		document.getElementById(`transcript-generator-${platform}-clear`)!.addEventListener('click', async () => {
			mode.value = 'off';
			refreshControls();
			const next: PlatformCookieConfig = { mode: 'off', cookies: [], updatedAt: Date.now(), lastValidatedAt: null, status: 'empty' };
			await savePlatformCookies(platform, settings.cookies, next);
			renderCookieSummary(platform, next, '本地 Cookie 已清除');
		});
	}
}
