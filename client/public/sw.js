const DEFAULT_CACHE_PREFIX = 'cfwk-game-assets-';
let cachePrefix = DEFAULT_CACHE_PREFIX;
let currentAssetVersion = null;
const MAX_CACHEABLE_BYTES = 4 * 1024 * 1024;

const ASSET_PATH_PREFIXES = ['/assets/', '/audio/', '/dialogue/', '/items/', '/maps/', '/ui/', '/packs/'];

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        await self.clients.claim();
        await hydrateActiveVersionFromCaches();
    })());
});

self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'SET_ASSET_VERSION') return;

    if (typeof data.cachePrefix === 'string' && data.cachePrefix.trim().length > 0) {
        cachePrefix = data.cachePrefix.trim();
    }

    if (typeof data.version === 'string' && data.version.trim().length > 0) {
        currentAssetVersion = data.version.trim();
        const activeCacheName = `${cachePrefix}${currentAssetVersion}`;
        event.waitUntil(cleanupOldCaches(activeCacheName));
    }
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const requestUrl = new URL(request.url);
    if (requestUrl.origin !== self.location.origin) return;

    const isAssetPath = ASSET_PATH_PREFIXES.some((prefix) => requestUrl.pathname.startsWith(prefix));
    if (!isAssetPath) return;

    event.respondWith(cacheFirst(request));
});

function getActiveCacheName() {
    const version = currentAssetVersion || 'runtime';
    return `${cachePrefix}${version}`;
}

async function cacheFirst(request) {
    const cacheName = getActiveCacheName();
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response && response.ok) {
            const contentLength = Number(response.headers.get('content-length') || 0);
            if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength <= MAX_CACHEABLE_BYTES) {
                cache.put(request, response.clone());
            }
        }
        return response;
    } catch (error) {
        if (cached) return cached;
        throw error;
    }
}

async function hydrateActiveVersionFromCaches() {
    const names = await caches.keys();
    const versionedCaches = names.filter((name) => name.startsWith(cachePrefix));
    if (versionedCaches.length === 0) return;

    versionedCaches.sort();
    const last = versionedCaches[versionedCaches.length - 1];
    currentAssetVersion = last.slice(cachePrefix.length) || currentAssetVersion;
}

async function cleanupOldCaches(activeCacheName) {
    const names = await caches.keys();
    await Promise.all(
        names
            .filter((name) => name.startsWith(cachePrefix) && name !== activeCacheName)
            .map((name) => caches.delete(name))
    );
}
