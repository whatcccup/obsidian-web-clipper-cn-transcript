import browser from '../utils/browser-polyfill';
import {
	TranscriptGeneratorAsrSettings,
	TranscriptGeneratorCookieSettings,
	TranscriptGeneratorGeneralSettings,
	TranscriptGeneratorJobState,
	PlatformCookieConfig,
} from './types';

export const GENERAL_KEY = 'transcript_generator_general_settings';
export const ASR_KEY = 'transcript_generator_asr_settings';
export const COOKIE_KEY = 'transcript_generator_cookie_settings';
export const ACTIVE_JOB_KEY = 'transcript_generator_active_job';
export const PANEL_COLLAPSED_KEY = 'transcript_generator_panel_collapsed';

const LEGACY_KEYS = {
	general: 'clip_note_general_settings',
	asr: 'clip_note_asr_settings',
	cookies: 'clip_note_cookie_settings',
	activeJob: 'clip_note_active_job',
	panelCollapsed: 'clip_note_panel_collapsed',
} as const;

let migrationPromise: Promise<void> | null = null;

async function migrateLegacyStorage(): Promise<void> {
	if (migrationPromise) return migrationPromise;
	migrationPromise = (async () => {
		const pairs = [
			[GENERAL_KEY, LEGACY_KEYS.general],
			[ASR_KEY, LEGACY_KEYS.asr],
			[COOKIE_KEY, LEGACY_KEYS.cookies],
			[ACTIVE_JOB_KEY, LEGACY_KEYS.activeJob],
			[PANEL_COLLAPSED_KEY, LEGACY_KEYS.panelCollapsed],
		] as const;
		const keys = pairs.reduce<string[]>((all, [current, legacy]) => {
			all.push(current, legacy);
			return all;
		}, []);
		const stored = await browser.storage.local.get(keys);
		const migrated: Record<string, unknown> = {};
		for (const [current, legacy] of pairs) {
			if (stored[current] === undefined && stored[legacy] !== undefined) migrated[current] = stored[legacy];
		}
		if (Object.keys(migrated).length) await browser.storage.local.set(migrated);
		const legacyKeys = pairs.map(([, legacy]) => legacy).filter(key => stored[key] !== undefined);
		if (legacyKeys.length) await browser.storage.local.remove(legacyKeys);
	})();
	return migrationPromise;
}

export const DEFAULT_GENERAL_SETTINGS: TranscriptGeneratorGeneralSettings = {
	enabled: false,
};

export const DEFAULT_ASR_SETTINGS: TranscriptGeneratorAsrSettings = {
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

export const DEFAULT_COOKIE_SETTINGS: TranscriptGeneratorCookieSettings = {
	bilibili: emptyPlatformConfig(),
	youtube: emptyPlatformConfig(),
};

export async function loadTranscriptGeneratorSettings(): Promise<{
	general: TranscriptGeneratorGeneralSettings;
	asr: TranscriptGeneratorAsrSettings;
	cookies: TranscriptGeneratorCookieSettings;
}> {
	await migrateLegacyStorage();
	const stored = await browser.storage.local.get([GENERAL_KEY, ASR_KEY, COOKIE_KEY]);
	const storedCookies = (stored[COOKIE_KEY] || {}) as Partial<TranscriptGeneratorCookieSettings>;
	return {
		general: { ...DEFAULT_GENERAL_SETTINGS, ...(stored[GENERAL_KEY] || {}) },
		asr: { ...DEFAULT_ASR_SETTINGS, ...(stored[ASR_KEY] || {}) },
		cookies: {
			bilibili: { ...emptyPlatformConfig(), ...(storedCookies.bilibili || {}) },
			youtube: { ...emptyPlatformConfig(), ...(storedCookies.youtube || {}) },
		},
	};
}

export async function saveGeneralSettings(settings: TranscriptGeneratorGeneralSettings): Promise<void> {
	await browser.storage.local.set({ [GENERAL_KEY]: settings });
}

export async function saveAsrSettings(settings: TranscriptGeneratorAsrSettings): Promise<void> {
	await browser.storage.local.set({ [ASR_KEY]: settings });
}

export async function saveCookieSettings(settings: TranscriptGeneratorCookieSettings): Promise<void> {
	await browser.storage.local.set({ [COOKIE_KEY]: settings });
}

export async function loadActiveJob(): Promise<TranscriptGeneratorJobState | null> {
	await migrateLegacyStorage();
	const stored = await browser.storage.local.get(ACTIVE_JOB_KEY);
	return (stored[ACTIVE_JOB_KEY] as TranscriptGeneratorJobState | undefined) || null;
}

export async function saveActiveJob(job: TranscriptGeneratorJobState): Promise<void> {
	await browser.storage.local.set({ [ACTIVE_JOB_KEY]: job });
}

export async function loadPanelCollapsed(): Promise<boolean> {
	await migrateLegacyStorage();
	const stored = await browser.storage.local.get(PANEL_COLLAPSED_KEY);
	return stored[PANEL_COLLAPSED_KEY] === true;
}

export async function savePanelCollapsed(collapsed: boolean): Promise<void> {
	await browser.storage.local.set({ [PANEL_COLLAPSED_KEY]: collapsed });
}
