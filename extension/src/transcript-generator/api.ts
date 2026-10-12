import { TranscriptGeneratorAsrSettings, TranscriptGeneratorJobStatus, HelperHealth, StoredCookie, TranscriptResult, WhisperModelSize, LocalTranscriptProvider } from './types';
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
	asr: TranscriptGeneratorAsrSettings,
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
	onStage: (stage: string, status: TranscriptGeneratorJobStatus) => void | Promise<void>,
): Promise<TranscriptResult> {
	for (;;) {
		const task = await request<{ status: TranscriptGeneratorJobStatus; stage: string; result?: TranscriptResult; error?: string }>(
				`/v1/transcriptions/${encodeURIComponent(taskId)}`,
		);
		await onStage(task.stage, task.status);
		if (task.status === 'completed' && task.result) return task.result;
		if (task.status === 'failed') throw new Error(task.error || '字幕生成失败');
		await new Promise(resolve => setTimeout(resolve, 1000));
	}
}

interface ModelStatus {
	status: 'installed' | 'not-installed' | 'downloading' | 'failed';
	sizeBytes: number;
	provider?: LocalTranscriptProvider;
	available?: boolean;
	reason?: string;
}

export async function getModelStatus(model: WhisperModelSize, provider: LocalTranscriptProvider = 'faster-whisper'): Promise<ModelStatus> {
	const result = await request<ModelStatus>(`/v1/models/${model}/status?provider=${provider}`);
	// Older Helpers ignore unknown query parameters: never mistake their Faster
	// Whisper model for an OpenAI or MLX checkpoint.
	if (provider !== 'faster-whisper' && result.provider !== provider) {
		throw new Error('当前 Helper 不支持此转写器，请使用新版 install.sh 更新并重启 Helper');
	}
	return result;
}

export const getTranscribers = () =>
	request<{ transcribers: Array<{ id: string; available: boolean; remote: boolean; reason?: string }> }>('/v1/transcribers');

export async function downloadModel(model: WhisperModelSize, provider: LocalTranscriptProvider = 'faster-whisper') {
	const status = await getModelStatus(model, provider);
	if (status.available === false) throw new Error(status.reason || '此转写器不可用');
	return request(`/v1/models/${model}/download?provider=${provider}`, { method: 'POST' });
}

export async function deleteModel(model: WhisperModelSize, provider: LocalTranscriptProvider = 'faster-whisper') {
	await getModelStatus(model, provider);
	return request(`/v1/models/${model}?provider=${provider}`, { method: 'DELETE' });
}
