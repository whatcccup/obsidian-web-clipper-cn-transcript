import browser from '../utils/browser-polyfill';

const NATIVE_HOST = 'cn.transcript.generator.launcher';

export type HelperRuntimeStatus = 'not-installed' | 'stopped' | 'starting' | 'ready' | 'error';

export interface HelperRuntimeSession {
	ok: boolean;
	status: HelperRuntimeStatus;
	url?: string;
	token?: string;
	pid?: number;
	error?: string;
	health?: { version?: string; idleTimeoutSeconds?: number };
}

let activeSession: HelperRuntimeSession | null = null;

async function send(action: 'start' | 'status' | 'stop' | 'restart'): Promise<HelperRuntimeSession> {
	try {
		return await browser.runtime.sendNativeMessage(NATIVE_HOST, { action }) as HelperRuntimeSession;
	} catch (error) {
		return {
			ok: false,
			status: 'not-installed',
			error: error instanceof Error ? error.message : 'Transcript Helper 尚未安装',
		};
	}
}

export async function startHelper(): Promise<HelperRuntimeSession> {
	if (activeSession?.status === 'ready' && activeSession.url && activeSession.token) return activeSession;
	const session = await send('start');
	if (!session.ok || session.status !== 'ready' || !session.url || !session.token) {
		throw new Error(session.error || 'Transcript Helper 启动失败');
	}
	activeSession = session;
	return session;
}

export async function getHelperStatus(): Promise<HelperRuntimeSession> {
	const session = await send('status');
	activeSession = session.status === 'ready' ? session : null;
	return session;
}

export async function stopHelper(): Promise<HelperRuntimeSession> {
	const session = await send('stop');
	activeSession = null;
	return session;
}

export async function restartHelper(): Promise<HelperRuntimeSession> {
	activeSession = null;
	const session = await send('restart');
	if (!session.ok || session.status !== 'ready') throw new Error(session.error || 'Transcript Helper 重启失败');
	activeSession = session;
	return session;
}

export function clearHelperSession(): void {
	activeSession = null;
}
