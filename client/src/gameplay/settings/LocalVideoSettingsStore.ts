import { IVideoSettings, VideoQualityPreset } from '@cfwk/shared';

const STORAGE_KEY = 'cfwk_video_settings_v1';

const VALID_PRESETS: ReadonlyArray<VideoQualityPreset> = ['low', 'medium', 'high', 'custom'];

// Medium-preset baseline for local-only video persistence. Kept here (not in shared)
// because this is intentionally a client-local default that must not track the
// server-side DEFAULT_USER_SETTINGS if those ever diverge.
export const DEFAULT_LOCAL_VIDEO_SETTINGS: IVideoSettings = {
    qualityPreset: 'medium',
    fullscreen: false,
    visualEffectsEnabled: true,
    seasonalEffectsEnabled: true,
    bloomEnabled: false,
    vignetteEnabled: true,
    tiltShiftEnabled: false,
    crtEnabled: false,
    dustParticlesEnabled: true
};

function getStorage(): Storage | null {
    try {
        if (typeof window === 'undefined') return null;
        return window.localStorage ?? null;
    } catch {
        return null;
    }
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function normalizeQualityPreset(value: unknown, fallback: VideoQualityPreset): VideoQualityPreset {
    if (typeof value === 'string' && VALID_PRESETS.includes(value as VideoQualityPreset)) {
        return value as VideoQualityPreset;
    }
    return fallback;
}

function normalizeVideoSettings(raw: unknown): IVideoSettings {
    const source = (raw && typeof raw === 'object') ? raw as Partial<IVideoSettings> : {};
    const base = DEFAULT_LOCAL_VIDEO_SETTINGS;
    return {
        qualityPreset: normalizeQualityPreset(source.qualityPreset, base.qualityPreset),
        // Fullscreen is never persisted across sessions — it's session-only UX
        fullscreen: base.fullscreen,
        visualEffectsEnabled: normalizeBoolean(source.visualEffectsEnabled, base.visualEffectsEnabled),
        seasonalEffectsEnabled: normalizeBoolean(source.seasonalEffectsEnabled, base.seasonalEffectsEnabled),
        bloomEnabled: normalizeBoolean(source.bloomEnabled, base.bloomEnabled),
        vignetteEnabled: normalizeBoolean(source.vignetteEnabled, base.vignetteEnabled),
        tiltShiftEnabled: normalizeBoolean(source.tiltShiftEnabled, base.tiltShiftEnabled),
        crtEnabled: normalizeBoolean(source.crtEnabled, base.crtEnabled),
        dustParticlesEnabled: normalizeBoolean(source.dustParticlesEnabled, base.dustParticlesEnabled)
    };
}

export function getLocalVideoSettings(): IVideoSettings {
    const storage = getStorage();
    if (!storage) return { ...DEFAULT_LOCAL_VIDEO_SETTINGS };
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_LOCAL_VIDEO_SETTINGS };
        const parsed = JSON.parse(raw);
        return normalizeVideoSettings(parsed);
    } catch {
        return { ...DEFAULT_LOCAL_VIDEO_SETTINGS };
    }
}

export function saveLocalVideoSettings(next: IVideoSettings): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        const normalized = normalizeVideoSettings(next);
        storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        // Best-effort: storage may be unavailable (private mode, quota, etc.)
    }
}

// Convenience for callers that only need the default shape. Using a getter-style
// function keeps the exported constant immutable (callers can still import it
// directly when they just want to read defaults).
export function getDefaultLocalVideoSettings(): IVideoSettings {
    return { ...DEFAULT_LOCAL_VIDEO_SETTINGS };
}

// Used by tests / diagnostics only — not referenced in normal app code paths.
export const LOCAL_VIDEO_SETTINGS_STORAGE_KEY = STORAGE_KEY;
