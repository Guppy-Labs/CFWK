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
    onDebug?: (message: string) => void;
}

interface PrepareGameAssetsResult {
    mode: BootstrapMode;
    assetVersion: string;
    cachedAssetCount: number;
    mobileSafeMode: boolean;
    manifestSkipped: boolean;
}

const VERSION_ENDPOINT = '/api/assets/version';
const MANIFEST_URL = '/game-assets.manifest.json';
const ASSET_VERSION_STORAGE_KEY = 'cfwk_asset_version';
const CACHE_PREFIX = 'cfwk-game-assets-';
const DEFAULT_VERSION = 'v1';
const CRITICAL_ASSET_LIMIT = 24;
const MOBILE_CRITICAL_ASSET_LIMIT = 10;
const BACKGROUND_WARM_CONCURRENCY = 8;
const MOBILE_BACKGROUND_WARM_CONCURRENCY = 2;
const SW_REGISTER_TIMEOUT_MS = 3500;
const SW_READY_TIMEOUT_MS = 4500;
const VERSION_FETCH_TIMEOUT_MS = 2500;
const MANIFEST_FETCH_TIMEOUT_MS = 5000;
const MOBILE_SAFE_CRITICAL_ASSETS = [
    '/packs/ui-core.pack.json',
    '/packs/audio-core.pack.json',
    '/assets/fish_tilesheet.png',
    '/ui/BookBaseOpen01a.png',
    '/ui/BookBaseOpen01b.png',
    '/ui/Handle01a.png',
    '/ui/Joystick01a.png',
    '/ui/glimmerbowl/idle.png',
    '/maps/anchor-hollow.tmj'
];

function isCacheApiAvailable() {
    return typeof window !== 'undefined' && 'caches' in window;
}

function isServiceWorkerAvailable() {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

function isIpadChrome(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIPadUA = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    const isChromeOniOS = /CriOS/i.test(ua);
    return isIPadUA && isChromeOniOS;
}

function isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

function isConstrainedDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const cores = navigator.hardwareConcurrency;
    const lowMemory = typeof memory === 'number' && Number.isFinite(memory) && memory <= 4;
    const lowCpu = typeof cores === 'number' && Number.isFinite(cores) && cores <= 4;
    return lowMemory || lowCpu;
}

function shouldUseMobileSafeCaching(): boolean {
    return isMobileDevice() || isConstrainedDevice();
}

export function isMobileSafeMode(): boolean {
    return shouldUseMobileSafeCaching();
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
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller
        ? setTimeout(() => controller.abort(), VERSION_FETCH_TIMEOUT_MS)
        : null;
    try {
        const response = await fetch(VERSION_ENDPOINT, {
            credentials: 'include',
            cache: 'no-store',
            signal: controller?.signal
        });

        if (!response.ok) {
            return DEFAULT_VERSION;
        }

        const payload = (await response.json()) as AssetVersionResponse;
        return normalizeVersion(payload.version);
    } catch {
        return DEFAULT_VERSION;
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

async function fetchManifestAssets(): Promise<string[]> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller
        ? setTimeout(() => controller.abort(), MANIFEST_FETCH_TIMEOUT_MS)
        : null;
    try {
        const response = await fetch(MANIFEST_URL, {
            cache: 'no-store',
            signal: controller?.signal
        });

        if (!response.ok) {
            return [];
        }

        const payload = (await response.json()) as AssetManifest;
        return normalizeManifestAssets(payload).filter(shouldCacheAsset);
    } catch {
        return [];
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

async function registerServiceWorker(assetVersion: string, onDebug?: (message: string) => void) {
    if (!isServiceWorkerAvailable()) return;
    if (isIpadChrome() || shouldUseMobileSafeCaching()) {
        onDebug?.('sw:register:skipped-mobile-safe');
        return;
    }

    const postVersionMessage = (
        target: ServiceWorker | null | undefined,
        label: string,
        onDebug?: (message: string) => void
    ) => {
        if (!target) return;
        target.postMessage({
            type: 'SET_ASSET_VERSION',
            version: assetVersion,
            cachePrefix: CACHE_PREFIX
        });
        onDebug?.(`sw:${label}:post-version`);
    };

    try {
        onDebug?.('sw:register:start');
        const registration = await Promise.race([
            navigator.serviceWorker.register('/sw.js', { scope: '/' }),
            new Promise<null>((resolve) => {
                setTimeout(() => resolve(null), SW_REGISTER_TIMEOUT_MS);
            })
        ]);
        if (!registration) {
            onDebug?.('sw:register:timeout');
            return;
        }
        onDebug?.('sw:register:ok');
        postVersionMessage(registration.active, 'register-active', onDebug);
        postVersionMessage(registration.waiting, 'register-waiting', onDebug);
        postVersionMessage(registration.installing, 'register-installing', onDebug);

        const readyRegistration = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<null>((resolve) => {
                setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS);
            })
        ]);

        if (readyRegistration) {
            postVersionMessage(readyRegistration.active, 'ready-active', onDebug);
        } else {
            onDebug?.('sw:ready:timeout');
        }
    } catch {
        onDebug?.('sw:register:error');
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

function selectCriticalAssets(assetUrls: string[], limit: number): string[] {
    const priority = assetUrls.filter((url) => url.startsWith('/packs/'));
    const essentials = [
        '/assets/fish_tilesheet.png',
        '/packs/ui-core.pack.json',
        '/packs/audio-core.pack.json'
    ];

    const merged = [...priority, ...essentials].filter((url, index, array) => array.indexOf(url) === index);
    return merged.slice(0, Math.max(1, Math.floor(limit)));
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
                await cache.put(url, response);
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
                    cache: 'no-cache'
                });

                if (response.ok) {
                    await cache.put(url, response);
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
    options.onDebug?.(`assets:mode=${mode}`);

    const cacheName = `${CACHE_PREFIX}${serverVersion}`;
    let cachedAssetCount = 0;
    const mobileSafeCaching = shouldUseMobileSafeCaching();
    const criticalAssetLimit = mobileSafeCaching ? MOBILE_CRITICAL_ASSET_LIMIT : CRITICAL_ASSET_LIMIT;
    const backgroundConcurrency = mobileSafeCaching ? MOBILE_BACKGROUND_WARM_CONCURRENCY : BACKGROUND_WARM_CONCURRENCY;
    let manifestSkipped = false;

    if (mode === 'updating') {
        await clearOldCaches(cacheName);
        options.onDebug?.('assets:cleared-old-caches');
    }

    if (mode !== 'up-to-date') {
        let manifestAssets: string[];
        if (mobileSafeCaching) {
            manifestAssets = [...MOBILE_SAFE_CRITICAL_ASSETS];
            manifestSkipped = true;
            options.onDebug?.('assets:manifest:skipped-mobile-safe');
        } else {
            manifestAssets = await fetchManifestAssets();
        }
        const criticalAssets = selectCriticalAssets(manifestAssets, criticalAssetLimit);
        options.onDebug?.(`assets:manifest=${manifestAssets.length} critical=${criticalAssets.length}`);
        cachedAssetCount = await warmCache(cacheName, criticalAssets, options.onProgress);
        options.onDebug?.(`assets:critical-cached=${cachedAssetCount}`);
        localStorage.setItem(ASSET_VERSION_STORAGE_KEY, serverVersion);

        const remainingAssets = manifestAssets.filter((url) => !criticalAssets.includes(url));
        if (!mobileSafeCaching) {
            scheduleBackground(async () => {
                await clearOldCaches(cacheName);
                await warmCacheConcurrent(cacheName, remainingAssets, backgroundConcurrency);
            });
        } else {
            options.onDebug?.('assets:background-warm:skipped-mobile-safe');
        }
    }

    await registerServiceWorker(serverVersion, options.onDebug);
    options.onDebug?.('assets:bootstrap-complete');

    return {
        mode,
        assetVersion: serverVersion,
        cachedAssetCount,
        mobileSafeMode: mobileSafeCaching,
        manifestSkipped
    };
}
