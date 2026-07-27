import browser from '../utils/browser-polyfill';
import {
	ClipNoteAsrSettings,
	ClipNoteCookieSettings,
	ClipNoteGeneralSettings,
	ClipNoteJobState,
	PlatformCookieConfig,
} from './types';

export const GENERAL_KEY = 'clip_note_general_settings';
export const ASR_KEY = 'clip_note_asr_settings';
export const COOKIE_KEY = 'clip_note_cookie_settings';
export const ACTIVE_JOB_KEY = 'clip_note_active_job';
export const PANEL_COLLAPSED_KEY = 'clip_note_panel_collapsed';

export const DEFAULT_GENERAL_SETTINGS: ClipNoteGeneralSettings = {
	enabled: false,
};

export const DEFAULT_ASR_SETTINGS: ClipNoteAsrSettings = {
	provider: 'faster-whisper',
	whisperModel: 'base',
};

const emptyPlatformConfig = (): PlatformCookieConfig => ({
	mode: 'off',
	cookies: [],
	updatedAt: null,
	lastValidatedAt: null,
	status: 'empty',
});

export const DEFAULT_COOKIE_SETTINGS: ClipNoteCookieSettings = {
	bilibili: emptyPlatformConfig(),
	youtube: emptyPlatformConfig(),
};

export async function loadClipNoteSettings(): Promise<{
	general: ClipNoteGeneralSettings;
	asr: ClipNoteAsrSettings;
	cookies: ClipNoteCookieSettings;
}> {
	const stored = await browser.storage.local.get([GENERAL_KEY, ASR_KEY, COOKIE_KEY]);
	const storedCookies = (stored[COOKIE_KEY] || {}) as Partial<ClipNoteCookieSettings>;
	return {
		general: { ...DEFAULT_GENERAL_SETTINGS, ...(stored[GENERAL_KEY] || {}) },
		asr: { ...DEFAULT_ASR_SETTINGS, ...(stored[ASR_KEY] || {}) },
		cookies: {
			bilibili: { ...emptyPlatformConfig(), ...(storedCookies.bilibili || {}) },
			youtube: { ...emptyPlatformConfig(), ...(storedCookies.youtube || {}) },
		},
	};
}

export async function saveGeneralSettings(settings: ClipNoteGeneralSettings): Promise<void> {
	await browser.storage.local.set({ [GENERAL_KEY]: settings });
}

export async function saveAsrSettings(settings: ClipNoteAsrSettings): Promise<void> {
	await browser.storage.local.set({ [ASR_KEY]: settings });
}

export async function saveCookieSettings(settings: ClipNoteCookieSettings): Promise<void> {
	await browser.storage.local.set({ [COOKIE_KEY]: settings });
}

export async function loadActiveJob(): Promise<ClipNoteJobState | null> {
	const stored = await browser.storage.local.get(ACTIVE_JOB_KEY);
	return (stored[ACTIVE_JOB_KEY] as ClipNoteJobState | undefined) || null;
}

export async function saveActiveJob(job: ClipNoteJobState): Promise<void> {
	await browser.storage.local.set({ [ACTIVE_JOB_KEY]: job });
}

export async function loadPanelCollapsed(): Promise<boolean> {
	const stored = await browser.storage.local.get(PANEL_COLLAPSED_KEY);
	return stored[PANEL_COLLAPSED_KEY] === true;
}

export async function savePanelCollapsed(collapsed: boolean): Promise<void> {
	await browser.storage.local.set({ [PANEL_COLLAPSED_KEY]: collapsed });
}
