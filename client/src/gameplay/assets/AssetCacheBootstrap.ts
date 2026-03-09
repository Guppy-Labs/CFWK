type AssetVersionResponse = {
    version?: string;
    generatedAt?: string;
};

type AssetManifest = {
    generatedAt?: string;
    assets?: string[];
};

type BootstrapMode = 'first-download' | 'updating' | 'up-to-date';

interface PrepareGameAssetsOptions {
    onModeChanged?: (mode: BootstrapMode) => void;
    onProgress?: (progress: number) => void;
}

interface PrepareGameAssetsResult {
    mode: BootstrapMode;
    assetVersion: string;
    cachedAssetCount: number;
}

const VERSION_ENDPOINT = '/api/assets/version';
const MANIFEST_URL = '/game-assets.manifest.json';
const ASSET_VERSION_STORAGE_KEY = 'cfwk_asset_version';
const CACHE_PREFIX = 'cfwk-game-assets-';
const DEFAULT_VERSION = 'v1';
const CRITICAL_ASSET_LIMIT = 24;
const BACKGROUND_WARM_CONCURRENCY = 8;

function isCacheApiAvailable() {
    return typeof window !== 'undefined' && 'caches' in window;
}

function isServiceWorkerAvailable() {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

function normalizeVersion(raw: unknown): string {
    if (typeof raw !== 'string') return DEFAULT_VERSION;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_VERSION;
}

function normalizeManifestAssets(manifest: AssetManifest): string[] {
    if (!Array.isArray(manifest.assets)) return [];
    return manifest.assets
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.startsWith('/'));
}

function shouldCacheAsset(url: string): boolean {
    return (
        url.startsWith('/assets/') ||
        url.startsWith('/audio/') ||
        url.startsWith('/dialogue/') ||
        url.startsWith('/items/') ||
        url.startsWith('/maps/') ||
        url.startsWith('/ui/') ||
        url.startsWith('/packs/')
    );
}

export async function clearNonAuthCaches(): Promise<void> {
    if (typeof window !== 'undefined') {
        try {
            localStorage.removeItem(ASSET_VERSION_STORAGE_KEY);
        } catch {
            // Ignore storage failures.
        }
    }

    if (!isCacheApiAvailable()) return;

    const cacheNames = await caches.keys();
    const nonAuthCaches = cacheNames.filter((name) => !/auth/i.test(name));
    await Promise.all(nonAuthCaches.map((name) => caches.delete(name)));
}

async function fetchAssetVersion(): Promise<string> {
    try {
        const response = await fetch(VERSION_ENDPOINT, {
            credentials: 'include',
            cache: 'no-store'
        });

        if (!response.ok) {
            return DEFAULT_VERSION;
        }

        const payload = (await response.json()) as AssetVersionResponse;
        return normalizeVersion(payload.version);
    } catch {
        return DEFAULT_VERSION;
    }
}

async function fetchManifestAssets(): Promise<string[]> {
    try {
        const response = await fetch(MANIFEST_URL, {
            cache: 'no-store'
        });

        if (!response.ok) {
            return [];
        }

        const payload = (await response.json()) as AssetManifest;
        return normalizeManifestAssets(payload).filter(shouldCacheAsset);
    } catch {
        return [];
    }
}

async function registerServiceWorker(assetVersion: string) {
    if (!isServiceWorkerAvailable()) return;

    try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        const registration = await navigator.serviceWorker.ready;
        const target = registration.active || registration.waiting || registration.installing;
        if (target) {
            target.postMessage({
                type: 'SET_ASSET_VERSION',
                version: assetVersion,
                cachePrefix: CACHE_PREFIX
            });
        }
    } catch {
        // Service worker is optional; cache bootstrap still works without it.
    }
}

async function clearOldCaches(currentCacheName: string) {
    if (!isCacheApiAvailable()) return;

    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== currentCacheName)
            .map((name) => caches.delete(name))
    );
}

function selectCriticalAssets(assetUrls: string[]): string[] {
    const priority = assetUrls.filter((url) => url.startsWith('/packs/'));
    const essentials = [
        '/assets/fish_tilesheet.png',
        '/packs/ui-core.pack.json',
        '/packs/audio-core.pack.json'
    ];

    const merged = [...priority, ...essentials].filter((url, index, array) => array.indexOf(url) === index);
    return merged.slice(0, CRITICAL_ASSET_LIMIT);
}

function scheduleBackground(task: () => Promise<void>) {
    const run = () => {
        task().catch(() => {
            // Ignore background cache errors.
        });
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(() => run());
        return;
    }

    setTimeout(run, 0);
}

async function warmCacheConcurrent(cacheName: string, assetUrls: string[], concurrency: number): Promise<number> {
    if (!isCacheApiAvailable() || assetUrls.length === 0) return 0;

    const cache = await caches.open(cacheName);
    const queue = [...assetUrls];
    let cached = 0;

    const worker = async () => {
        while (queue.length > 0) {
            const url = queue.shift();
            if (!url) return;

            try {
                const existing = await cache.match(url, { ignoreSearch: false });
                if (existing) {
                    cached += 1;
                    continue;
                }

                const response = await fetch(url, {
                    credentials: 'same-origin'
                });

                if (!response.ok) continue;
                await cache.put(url, response.clone());
                cached += 1;
            } catch {
                // Keep background workers running.
            }
        }
    };

    const workerCount = Math.max(1, Math.min(concurrency, assetUrls.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return cached;
}

async function warmCache(
    cacheName: string,
    assetUrls: string[],
    onProgress?: (progress: number) => void
): Promise<number> {
    if (!isCacheApiAvailable() || assetUrls.length === 0) {
        onProgress?.(1);
        return 0;
    }

    const cache = await caches.open(cacheName);
    let completed = 0;
    let cached = 0;

    const total = assetUrls.length;
    for (const url of assetUrls) {
        try {
            const existing = await cache.match(url, { ignoreSearch: false });
            if (existing) {
                cached += 1;
            } else {
                const response = await fetch(url, {
                    credentials: 'same-origin',
                    cache: 'reload'
                });

                if (response.ok) {
                    await cache.put(url, response.clone());
                    cached += 1;
                }
            }
        } catch {
            // Keep going; single-asset failures should not block game start.
        }

        completed += 1;
        onProgress?.(total === 0 ? 1 : completed / total);
    }

    return cached;
}

export async function prepareGameAssets(options: PrepareGameAssetsOptions = {}): Promise<PrepareGameAssetsResult> {
    const serverVersion = await fetchAssetVersion();
    const previousVersion = normalizeVersion(localStorage.getItem(ASSET_VERSION_STORAGE_KEY));
    const hasPreviousVersion = localStorage.getItem(ASSET_VERSION_STORAGE_KEY) !== null;

    let mode: BootstrapMode = 'up-to-date';
    if (!hasPreviousVersion) {
        mode = 'first-download';
    } else if (serverVersion !== previousVersion) {
        mode = 'updating';
    }

    options.onModeChanged?.(mode);

    const cacheName = `${CACHE_PREFIX}${serverVersion}`;
    let cachedAssetCount = 0;

    if (mode !== 'up-to-date') {
        const manifestAssets = await fetchManifestAssets();
        const criticalAssets = selectCriticalAssets(manifestAssets);
        cachedAssetCount = await warmCache(cacheName, criticalAssets, options.onProgress);
        localStorage.setItem(ASSET_VERSION_STORAGE_KEY, serverVersion);

        const remainingAssets = manifestAssets.filter((url) => !criticalAssets.includes(url));
        scheduleBackground(async () => {
            await clearOldCaches(cacheName);
            await warmCacheConcurrent(cacheName, remainingAssets, BACKGROUND_WARM_CONCURRENCY);
        });
    }

    await registerServiceWorker(serverVersion);

    return {
        mode,
        assetVersion: serverVersion,
        cachedAssetCount
    };
}
