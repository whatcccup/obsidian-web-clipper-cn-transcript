export type TranscriptGeneratorProvider = 'bcut' | 'faster-whisper';
export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3' | 'large-v3-turbo';
export type CookieMode = 'off' | 'browser' | 'manual';
export type CookieStatus = 'empty' | 'ready' | 'stale' | 'invalid';
export type TranscriptGeneratorPlatform = 'bilibili' | 'youtube';

export interface TranscriptGeneratorGeneralSettings {
	enabled: boolean;
}

export interface TranscriptGeneratorAsrSettings {
	provider: TranscriptGeneratorProvider;
	whisperModel: WhisperModelSize;
}

export interface StoredCookie {
	domain: string;
	name: string;
	value: string;
	path: string;
	secure: boolean;
	expirationDate?: number;
	httpOnly?: boolean;
}

export interface PlatformCookieConfig {
	mode: CookieMode;
	cookies: StoredCookie[];
	updatedAt: number | null;
	lastValidatedAt: number | null;
	status: CookieStatus;
}

export interface TranscriptGeneratorCookieSettings {
	bilibili: PlatformCookieConfig;
	youtube: PlatformCookieConfig;
}

export interface TranscriptSegment {
	start: number;
	end: number;
	text: string;
}

export interface TranscriptResult {
	language: string;
	fullText: string;
	segments: TranscriptSegment[];
	source: 'platform' | 'bcut' | 'faster-whisper';
}

export type TranscriptGeneratorJobStatus = 'queued' | 'downloading' | 'transcribing' | 'completed' | 'failed';

export interface TranscriptGeneratorJobState {
	taskId: string;
	url: string;
	videoKey: string;
	provider: TranscriptGeneratorProvider;
	status: TranscriptGeneratorJobStatus;
	stage: string;
	startedAt: number;
	updatedAt: number;
	result?: TranscriptResult;
	error?: string;
}

export interface HelperHealth {
	status: 'ok';
	version: string;
	idleTimeoutSeconds: number;
	capabilities: Record<string, boolean>;
}
