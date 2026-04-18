const ACCOUNT_BOOTSTRAP_CACHE_KEY = 'cfwk_account_bootstrap_cache_v1';

type AccountBootstrapCachePayload = {
    version: 1;
    cachedAt: number;
    user: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readAccountUserBootstrapCache(): Record<string, unknown> | null {
    try {
        const raw = window.localStorage.getItem(ACCOUNT_BOOTSTRAP_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed)) return null;
        if (parsed.version !== 1) return null;
        if (!isRecord(parsed.user)) return null;
        return parsed.user;
    } catch {
        return null;
    }
}

export function writeAccountUserBootstrapCache(user: unknown): void {
    if (!isRecord(user)) return;

    const payload: AccountBootstrapCachePayload = {
        version: 1,
        cachedAt: Date.now(),
        user
    };

    try {
        window.localStorage.setItem(ACCOUNT_BOOTSTRAP_CACHE_KEY, JSON.stringify(payload));
    } catch {
        // Ignore storage write failures (private mode/quota exceeded).
    }
}

export function patchAccountUserBootstrapCache(patch: Record<string, unknown>): void {
    const existing = readAccountUserBootstrapCache();
    if (!existing) return;
    writeAccountUserBootstrapCache({
        ...existing,
        ...patch
    });
}

export function clearAccountUserBootstrapCache(): void {
    try {
        window.localStorage.removeItem(ACCOUNT_BOOTSTRAP_CACHE_KEY);
    } catch {
        // Ignore storage failures.
    }
}
