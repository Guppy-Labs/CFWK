import { FishBowlSimulator } from './launch/FishBowlSimulator';
import { clearAccountUserBootstrapCache } from './utils/accountBootstrapCache';

type LaunchUser = {
    username?: string;
    permissions?: string[];
    betaAccessUntil?: string | null;
    premiumStatus?: string;
    premiumCurrentPeriodEnd?: string | null;
    bannedUntil?: string | null;
    ipBannedUntil?: string | null;
};

type NewsPost = {
    _id: string;
    title: string;
    content: string;
    classification: 'RELEASE' | 'OTHER';
    imageUrl?: string;
    authorUsernameSnapshot?: string;
    publishAt?: string;
    createdAt?: string;
};

type NewsResponse = {
    posts: NewsPost[];
};

const usernameValue = document.getElementById('username-value') as HTMLSpanElement;
const betaStatusValue = document.getElementById('beta-status-value') as HTMLSpanElement;
const betaBadge = document.getElementById('beta-badge') as HTMLSpanElement;
const premiumBadge = document.getElementById('premium-badge') as HTMLSpanElement;
const premiumCtaBtn = document.getElementById('premium-cta-btn') as HTMLAnchorElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const playBtnIconLeft = document.getElementById('play-btn-icon-left') as HTMLImageElement;
const playBtnIconRight = document.getElementById('play-btn-icon-right') as HTMLImageElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const launchTransitionOverlay = document.getElementById('launch-transition-overlay') as HTMLDivElement;
const fishbowlHost = document.getElementById('fishbowl-host') as HTMLDivElement;
const pageElement = document.querySelector('.page') as HTMLElement;
const heroElement = document.querySelector('.hero') as HTMLElement;
const newsElement = document.querySelector('.news') as HTMLElement;
const launchCountdownValue = document.getElementById('launch-countdown-value') as HTMLParagraphElement;
const fishbowlToggle = document.getElementById('fishbowl-toggle') as HTMLButtonElement;
const banAlert = document.getElementById('ban-alert') as HTMLDivElement;
const banAlertTitle = document.getElementById('ban-alert-title') as HTMLSpanElement;
const banAlertMessage = document.getElementById('ban-alert-message') as HTMLSpanElement;
const newsMeta = document.getElementById('news-meta') as HTMLSpanElement;
const newsList = document.getElementById('news-list') as HTMLOListElement;
const newsSkeleton = document.getElementById('news-skeleton') as HTMLDivElement;

let currentUser: LaunchUser | null = null;
let fishbowlSimulator: FishBowlSimulator | null = null;

const FISHBOWL_STORAGE_KEY = 'cfwk_fishbowl_enabled';
const DEFAULT_PLAY_ICON_SRC = '/assets/ui/play-icon.png';
const FISH_TILE_MAX_INDEX = 374;
const HOVER_FISH_FPS = 12;
const RELEASE_TIMESTAMP = new Date('2026-05-20T06:00:00').getTime();
const FISHBOWL_FADE_MS = 240;
const CURSOR_SCALE = 3;
const CURSOR_DEFAULT_SRC = '/ui/Cursor03b.png';
const CURSOR_POINTER_SRC = '/ui/Cursor03c.png';

let hoverFishIntervalId: number | null = null;
let countdownIntervalId: number | null = null;
let fishbowlFadeTimeoutId: number | null = null;

function resetLaunchScrollPosition() {
    try {
        if ('scrollRestoration' in window.history) {
            window.history.scrollRestoration = 'manual';
        }
    } catch {
        // Ignore restoration setting failures.
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function randomFishIconPath(): string {
    const fishIndex = Math.floor(Math.random() * (FISH_TILE_MAX_INDEX + 1));
    return `/assets/fish/tile${String(fishIndex).padStart(3, '0')}.png`;
}

function startPlayButtonIconCycle() {
    if (playBtn.disabled || hoverFishIntervalId !== null) return;
    const intervalMs = Math.round(1000 / HOVER_FISH_FPS);
    hoverFishIntervalId = window.setInterval(() => {
        playBtnIconLeft.src = randomFishIconPath();
        playBtnIconRight.src = randomFishIconPath();
    }, intervalMs);
}

function stopPlayButtonIconCycle() {
    if (hoverFishIntervalId !== null) {
        window.clearInterval(hoverFishIntervalId);
        hoverFishIntervalId = null;
    }
    playBtnIconLeft.src = DEFAULT_PLAY_ICON_SRC;
    playBtnIconRight.src = DEFAULT_PLAY_ICON_SRC;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(raw?: string): string {
    if (!raw) return 'Unknown date';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleString();
}

function formatNewsDateShort(raw?: string): string {
    if (!raw) return '--/--/--';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '--/--/--';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
}

function hasBetaAccess(user: LaunchUser): boolean {
    if (!user.betaAccessUntil) return false;
    const expires = new Date(user.betaAccessUntil);
    if (Number.isNaN(expires.getTime())) return false;
    return expires.getTime() > Date.now();
}

function canLaunch(user: LaunchUser): boolean {
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    return permissions.includes('access.game') || hasBetaAccess(user);
}

function readFishbowlEnabled(): boolean {
    try {
        const stored = window.localStorage.getItem(FISHBOWL_STORAGE_KEY);
        if (stored === null) return true;
        return stored === 'true';
    } catch {
        return true;
    }
}

function writeFishbowlEnabled(enabled: boolean) {
    try {
        window.localStorage.setItem(FISHBOWL_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
        // Ignore write failures (private mode/storage blocked).
    }
}

function renderFishToggle(enabled: boolean) {
    fishbowlToggle.classList.toggle('enabled', enabled);
    fishbowlToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

async function createScaledCursorDataUrl(src: string, scale: number): Promise<string | null> {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error(`Failed to load cursor asset: ${src}`));
        nextImage.src = src;
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.width * scale;
    canvas.height = image.height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
}

async function applyScaledLaunchCursors() {
    try {
        const [defaultCursorUrl, pointerCursorUrl] = await Promise.all([
            createScaledCursorDataUrl(CURSOR_DEFAULT_SRC, CURSOR_SCALE),
            createScaledCursorDataUrl(CURSOR_POINTER_SRC, CURSOR_SCALE)
        ]);
        if (!defaultCursorUrl || !pointerCursorUrl) return;

        document.documentElement.style.setProperty('--launch-cursor-default', `url(${defaultCursorUrl}) 0 0, auto`);
        document.documentElement.style.setProperty('--launch-cursor-pointer', `url(${pointerCursorUrl}) 0 0, pointer`);
    } catch {
        // Keep CSS fallbacks if runtime scaling fails.
    }
}

async function ensureFishbowlSimulator() {
    if (!fishbowlHost || !pageElement || !heroElement || !newsElement) return;
    if (!fishbowlSimulator) {
        fishbowlSimulator = new FishBowlSimulator({
            host: fishbowlHost,
            pageElement,
            heroElement,
            newsElement
        });
        await fishbowlSimulator.start();
    }

    const enabled = readFishbowlEnabled();
    renderFishToggle(enabled);
    if (enabled) {
        fishbowlHost.classList.remove('fading');
        fishbowlSimulator.setEnabled(true);
        requestAnimationFrame(() => fishbowlHost.classList.add('active'));
    } else {
        fishbowlHost.classList.remove('active');
        fishbowlHost.classList.add('fading');
        fishbowlSimulator.setEnabled(false);
    }
}

function setFishbowlEnabledWithFade(enabled: boolean) {
    if (!fishbowlSimulator) return;

    if (fishbowlFadeTimeoutId !== null) {
        window.clearTimeout(fishbowlFadeTimeoutId);
        fishbowlFadeTimeoutId = null;
    }

    if (enabled) {
        fishbowlHost.classList.remove('fading');
        fishbowlSimulator.setEnabled(true);
        requestAnimationFrame(() => fishbowlHost.classList.add('active'));
        return;
    }

    fishbowlHost.classList.remove('active');
    fishbowlHost.classList.add('fading');
    fishbowlFadeTimeoutId = window.setTimeout(() => {
        fishbowlSimulator?.setEnabled(false);
        fishbowlFadeTimeoutId = null;
    }, FISHBOWL_FADE_MS);
}

function startLaunchCountdown() {
    if (!launchCountdownValue) return;

    const update = () => {
        const remainingMs = RELEASE_TIMESTAMP - Date.now();
        if (remainingMs <= 0) {
            launchCountdownValue.textContent = 'RELEASED';
            if (countdownIntervalId !== null) {
                window.clearInterval(countdownIntervalId);
                countdownIntervalId = null;
            }
            return;
        }

        const totalSeconds = Math.floor(remainingMs / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        launchCountdownValue.textContent = `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };

    update();
    countdownIntervalId = window.setInterval(update, 1000);
}

const FIFTY_YEARS_MS = 50 * 365 * 24 * 60 * 60 * 1000;

function getActiveBanDate(user: LaunchUser): { date: Date; type: 'account' | 'ip' } | null {
    if (user.bannedUntil) {
        const d = new Date(user.bannedUntil);
        if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
            return { date: d, type: 'account' };
        }
    }
    if (user.ipBannedUntil) {
        const d = new Date(user.ipBannedUntil);
        if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
            return { date: d, type: 'ip' };
        }
    }
    return null;
}

function renderBanState(user: LaunchUser): boolean {
    const ban = getActiveBanDate(user);
    if (!ban) {
        banAlert.classList.remove('show');
        playBtn.style.display = '';
        playBtn.disabled = false;
        return false;
    }

    const isPermanent = ban.date.getTime() - Date.now() > FIFTY_YEARS_MS;
    banAlertTitle.textContent = ban.type === 'account' ? 'ACCOUNT BANNED' : 'BANNED';
    banAlertMessage.textContent = isPermanent
        ? 'You are permanently banned from playing.'
        : `Banned until ${ban.date.toLocaleString()}`;

    banAlert.classList.add('show');
    playBtn.style.display = 'none';
    playBtn.disabled = true;
    return true;
}

function renderUser(user: LaunchUser) {
    currentUser = user;
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    const betaActive = hasBetaAccess(user);
    const premiumOwned = permissions.includes('premium.shark');
    const hasPermanentGameAccess = permissions.includes('access.game');

    usernameValue.textContent = user.username || 'Player';
    betaStatusValue.textContent = betaActive
        ? `Active until ${formatDate(user.betaAccessUntil || undefined)}`
        : 'No active beta window';
    betaBadge.style.display = hasPermanentGameAccess ? 'none' : 'inline-flex';

    premiumBadge.style.display = premiumOwned ? 'inline-flex' : 'none';
    premiumCtaBtn.style.display = premiumOwned ? 'none' : 'inline-flex';

    renderBanState(user);
}

function renderNews(posts: NewsPost[]) {
    newsSkeleton.classList.remove('show');
    if (posts.length === 0) {
        newsMeta.textContent = '';
        newsList.innerHTML = '';
        return;
    }

    const ordered = [...posts].sort((a, b) => {
        const dateA = new Date(a.publishAt || a.createdAt || 0).getTime();
        const dateB = new Date(b.publishAt || b.createdAt || 0).getTime();
        return dateB - dateA;
    });

    const html = ordered.map((post) => {
        const when = post.publishAt || post.createdAt;
        const formattedDate = formatNewsDateShort(when);
        const kind = post.classification === 'RELEASE' ? 'release' : '';
        const author = post.authorUsernameSnapshot ? escapeHtml(post.authorUsernameSnapshot) : '';
        const imageHtml = post.imageUrl
            ? `<img class="news-image" src="${escapeHtml(post.imageUrl)}" alt="Post image for ${escapeHtml(post.title)}">`
            : '<div class="news-image news-image-placeholder" aria-hidden="true"></div>';

        return `
            <li class="news-item ${kind}">
                ${imageHtml}
                <div class="news-card-content">
                    <div class="news-card-meta">
                        <span class="news-date">${escapeHtml(formattedDate)}</span>
                        <span class="news-author">${author}</span>
                    </div>
                    <h3 class="news-card-title">${escapeHtml(post.title)}</h3>
                    <p class="news-desc">${escapeHtml(post.content)}</p>
                </div>
            </li>
        `;
    }).join('');

    newsMeta.textContent = `${ordered.length} post${ordered.length === 1 ? '' : 's'}`;
    newsList.innerHTML = html;
}

async function loadNews() {
    try {
        const res = await fetch('/api/news', { credentials: 'include' });
        if (!res.ok) {
            newsSkeleton.classList.remove('show');
            newsMeta.textContent = 'Failed to load';
            newsList.innerHTML = '<li class="news-item">Could not load news right now.</li>';
            return;
        }
        const data = await res.json() as NewsResponse;
        renderNews(Array.isArray(data.posts) ? data.posts : []);
    } catch {
        newsSkeleton.classList.remove('show');
        newsMeta.textContent = 'Failed to load';
        newsList.innerHTML = '<li class="news-item">Could not load news right now.</li>';
    }
}

async function init(): Promise<boolean> {
    try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!res.ok) {
            clearAccountUserBootstrapCache();
            window.location.href = '/login';
            return false;
        }

        const data = await res.json() as { user?: LaunchUser };
        if (!data.user) {
            clearAccountUserBootstrapCache();
            window.location.href = '/login';
            return false;
        }
        if (!data.user.username) {
            window.location.href = '/onboarding';
            return false;
        }

        const banned = getActiveBanDate(data.user) !== null;
        if (!canLaunch(data.user) && !banned) {
            window.location.href = '/account';
            return false;
        }

        renderUser(data.user);
        await loadNews();
        return true;
    } catch {
        clearAccountUserBootstrapCache();
        window.location.href = '/login';
        return false;
    }
}

playBtn.addEventListener('click', () => {
    if (!currentUser) return;
    if (getActiveBanDate(currentUser)) return;
    if (canLaunch(currentUser)) {
        stopPlayButtonIconCycle();
        playBtn.disabled = true;
        launchTransitionOverlay.classList.add('show');
        window.setTimeout(() => {
            window.location.href = '/game';
        }, 220);
        return;
    }
    window.location.href = '/account';
});

playBtn.addEventListener('mouseenter', startPlayButtonIconCycle);
playBtn.addEventListener('mouseleave', stopPlayButtonIconCycle);

logoutBtn.addEventListener('click', async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
        clearAccountUserBootstrapCache();
        window.location.href = '/login';
    }
});

fishbowlToggle.addEventListener('click', () => {
    const nextEnabled = !readFishbowlEnabled();
    writeFishbowlEnabled(nextEnabled);
    renderFishToggle(nextEnabled);
    setFishbowlEnabledWithFade(nextEnabled);
});

window.addEventListener('pointerdown', (event) => {
    if (!fishbowlSimulator) return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest('button, a, input, textarea, select, label, .news, .news-marquee, .news-inner')) {
        return;
    }
    fishbowlSimulator.handlePointerDown(event.clientX, event.clientY);
});

window.addEventListener('beforeunload', () => {
    fishbowlHost.classList.add('fading');
    if (fishbowlFadeTimeoutId !== null) {
        window.clearTimeout(fishbowlFadeTimeoutId);
        fishbowlFadeTimeoutId = null;
    }
    if (countdownIntervalId !== null) {
        window.clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }
    fishbowlSimulator?.destroy();
});

document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
});

void (async () => {
    resetLaunchScrollPosition();
    await applyScaledLaunchCursors();
    const accessGranted = await init();
    if (!accessGranted) return;
    startLaunchCountdown();
    await ensureFishbowlSimulator();
})();

export {};
