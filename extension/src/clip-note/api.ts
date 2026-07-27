import { ClipNoteAsrSettings, ClipNoteJobStatus, HelperHealth, StoredCookie, TranscriptResult, WhisperModelSize } from './types';
import { clearHelperSession, startHelper } from './native-client';

function baseUrl(url: string): string {
	const parsed = new URL(url);
	if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
		throw new Error('Transcript Helper 仅允许 localhost 或 127.0.0.1');
	}
	return parsed.origin;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	let session = await startHelper();
	let response: Response;
	try {
		response = await fetch(`${baseUrl(session.url!)}${path}`, {
			...init,
			headers: {
				...(init?.headers || {}),
				Authorization: `Bearer ${session.token}`,
			},
		});
	} catch (error) {
		clearHelperSession();
		session = await startHelper();
		response = await fetch(`${baseUrl(session.url!)}${path}`, {
			...init,
			headers: { ...(init?.headers || {}), Authorization: `Bearer ${session.token}` },
		});
	}
	if (!response.ok) {
		let message = `Helper 请求失败 (${response.status})`;
		try {
			const error = await response.json();
			message = error.detail || message;
		} catch {}
		throw new Error(message);
	}
	return response.json() as Promise<T>;
}

export const getHealth = (): Promise<HelperHealth> => request('/v1/health');

export async function createTranscription(
	url: string,
	asr: ClipNoteAsrSettings,
	cookies: StoredCookie[],
): Promise<string> {
	const created = await request<{ task_id: string }>('/v1/transcriptions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ url, provider: asr.provider, whisperModel: asr.whisperModel, cookies }),
	});
	return created.task_id;
}

export async function waitForTranscription(
	taskId: string,
	onStage: (stage: string, status: ClipNoteJobStatus) => void | Promise<void>,
): Promise<TranscriptResult> {
	for (;;) {
		const task = await request<{ status: ClipNoteJobStatus; stage: string; result?: TranscriptResult; error?: string }>(
				`/v1/transcriptions/${encodeURIComponent(taskId)}`,
		);
		await onStage(task.stage, task.status);
		if (task.status === 'completed' && task.result) return task.result;
		if (task.status === 'failed') throw new Error(task.error || '字幕生成失败');
		await new Promise(resolve => setTimeout(resolve, 1000));
	}
}

export const getModelStatus = (model: WhisperModelSize) =>
	request<{ status: 'installed' | 'not-installed' | 'downloading' | 'failed'; sizeBytes: number }>(`/v1/models/${model}/status`);

export const getTranscribers = () =>
	request<{ transcribers: Array<{ id: string; available: boolean; remote: boolean }> }>('/v1/transcribers');

export const downloadModel = (model: WhisperModelSize) =>
	request(`/v1/models/${model}/download`, { method: 'POST' });

export const deleteModel = (model: WhisperModelSize) =>
	request(`/v1/models/${model}`, { method: 'DELETE' });
