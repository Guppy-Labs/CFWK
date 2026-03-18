import {
    appendLoaderDebug,
    clearLoaderDebug,
    setLoaderDebugVisible,
    setLoaderProgress,
    setLoaderProgressVisible,
    setLoaderText,
    startGame
} from './gameplay';
import { ErrorModal } from './ui/ErrorModal';
import { Toast } from './ui/Toast';
import { LocaleManager } from './gameplay/i18n/LocaleManager';
import { bootstrapLocale } from './gameplay/i18n/localeBootstrap';
import { clearNonAuthCaches, isMobileSafeMode, prepareGameAssets } from './gameplay/assets/AssetCacheBootstrap';

const SLOW_LOAD_RETRY_DELAY_MS = 20_000;
let slowLoadRetryTimer: number | null = null;
let dismissSlowLoadToast: (() => void) | null = null;
let retryPending = false;
let lastLoggedProgressBucket = -1;

function shouldEnableLoaderDebug(): boolean {
    const searchParams = new URLSearchParams(window.location.search);
    return searchParams.get('debugLoader') === '1';
}

function clearSlowLoadRetryPrompt() {
    if (slowLoadRetryTimer !== null) {
        window.clearTimeout(slowLoadRetryTimer);
        slowLoadRetryTimer = null;
    }
    if (dismissSlowLoadToast) {
        dismissSlowLoadToast();
        dismissSlowLoadToast = null;
    }
}

function startSlowLoadRetryPrompt() {
    clearSlowLoadRetryPrompt();
    slowLoadRetryTimer = window.setTimeout(() => {
        dismissSlowLoadToast = Toast.showAction(
            'Not Working?',
            'Retry',
            async () => {
                if (retryPending) return;
                retryPending = true;
                try {
                    setLoaderText('Retrying...');
                    await clearNonAuthCaches();
                } finally {
                    window.location.reload();
                }
            },
            'info',
            0
        );
    }, SLOW_LOAD_RETRY_DELAY_MS);
}

function isIgnorableClientError(err: unknown): boolean {
    const message =
        typeof err === 'string'
            ? err
            : err instanceof Error
                ? err.message
                : '';

    return message.toLowerCase().includes('failed to start audio device');
}

// --- Global Error Handling ---
window.onerror = function(message, source, lineno, colno, error) {
    console.error('[Global Error]', message, error);
    const payload = error || message;
    if (!isIgnorableClientError(payload)) {
        ErrorModal.show(payload, `${source}:${lineno}:${colno}`);
    }
    return false; // Let default handler run too (logging to console)
};

window.onunhandledrejection = function(event) {
    console.error('[Unhandled Rejection]', event.reason);
    if (!isIgnorableClientError(event.reason)) {
        ErrorModal.show(event.reason, 'Unhandled Promise Rejection');
    }
};

export interface UserData {
    _id: string;
    username: string;
}

function formatRemaining(ms: number): string {
    if (ms <= 0) return 'ended';
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Auth check
async function checkAuth() {
    try {
        const loaderDebugEnabled = shouldEnableLoaderDebug();
        setLoaderDebugVisible(loaderDebugEnabled);
        clearLoaderDebug();
        lastLoggedProgressBucket = -1;
        const logLoader = (message: string) => {
            if (!loaderDebugEnabled) return;
            appendLoaderDebug(message);
        };
        logLoader(`env:ua=${navigator.userAgent}`);
        logLoader(`env:mobile-safe=${isMobileSafeMode() ? '1' : '0'}`);

        startSlowLoadRetryPrompt();
        logLoader('start:bootstrap-locale');
        await bootstrapLocale({ fetchFromServer: true });
        logLoader('done:bootstrap-locale');
        const localeManager = LocaleManager.getInstance();

        logLoader('start:prepare-assets');
        const cacheStatus = await prepareGameAssets({
            onModeChanged: (mode) => {
                logLoader(`assets:mode:${mode}`);
                if (mode === 'up-to-date') {
                    setLoaderProgressVisible(false);
                    return;
                }

                setLoaderProgressVisible(true);
                setLoaderProgress(0);
                if (mode === 'first-download') {
                    setLoaderText(localeManager.t('loader.downloadingGame', undefined, 'Downloading Game...'));
                } else {
                    setLoaderText(localeManager.t('loader.updatingGame', undefined, 'Updating Game...'));
                }
            },
            onProgress: (progress) => {
                setLoaderProgress(progress);
                const bucket = Math.floor(progress * 10);
                if (bucket !== lastLoggedProgressBucket) {
                    lastLoggedProgressBucket = bucket;
                    logLoader(`assets:progress:${Math.round(progress * 100)}%`);
                }
            },
            onDebug: (message) => {
                logLoader(message);
            }
        });
        logLoader('done:prepare-assets');
        logLoader(`assets:mobile-safe=${cacheStatus.mobileSafeMode ? '1' : '0'}`);
        logLoader(`assets:manifest-skipped=${cacheStatus.manifestSkipped ? '1' : '0'}`);

        if (cacheStatus.mode !== 'up-to-date') {
            setLoaderProgress(1);
        }

        setLoaderText(localeManager.t('loader.authenticating', undefined, 'Authenticating...'));
        logLoader('start:auth-me');
        
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
            logLoader(`auth-me:failed:${res.status}`);
            clearSlowLoadRetryPrompt();
            window.location.href = '/login';
            return;
        }
        logLoader('auth-me:ok');
        const data = await res.json();
        if (!data.user) {
            logLoader('auth-me:no-user');
            clearSlowLoadRetryPrompt();
            window.location.href = '/login';
            return;
        }

        if (!data.user.username) {
            clearSlowLoadRetryPrompt();
            window.location.href = '/onboarding';
            return;
        }

        const perms = data.user.permissions || [];
        const betaAccessUntil = data.user.betaAccessUntil ? new Date(data.user.betaAccessUntil) : null;
        const hasBetaAccess = !!(betaAccessUntil && betaAccessUntil.getTime() > Date.now());
           if (!perms.includes('access.game') && !hasBetaAccess) {
                         clearSlowLoadRetryPrompt();
             window.location.href = '/account'; 
             return;
        }

        const betaChip = document.getElementById('beta-access-chip') as HTMLElement | null;
        if (betaChip && hasBetaAccess && betaAccessUntil) {
            const updateChip = () => {
                const remainingMs = betaAccessUntil.getTime() - Date.now();
                betaChip.textContent = `Beta ends in ${formatRemaining(remainingMs)}`;
                betaChip.style.display = remainingMs > 0 ? 'inline-flex' : 'none';
            };
            updateChip();
            setInterval(updateChip, 60000);
        }

        setLoaderText(localeManager.t('loader.initializingGame', undefined, 'Initializing game...'));
        setLoaderProgressVisible(false);
        logLoader('start:phaser');
        
        // Update the upgrade button based on premium status
        updateUpgradeButton(data.user);
        
        startGame({
            _id: data.user._id,
            username: data.user.username,
            permissions: perms,
            isPremium: perms.includes('premium.shark')
        });
        logLoader('done:start-game');
        clearSlowLoadRetryPrompt();
    } catch (e) {
        if (shouldEnableLoaderDebug()) {
            appendLoaderDebug(`fatal:${e instanceof Error ? e.message : String(e)}`);
        }
        clearSlowLoadRetryPrompt();
        window.location.href = '/login';
    }
}

function updateUpgradeButton(user: any) {
    const navUpgradeBtn = document.getElementById('nav-upgrade-btn') as HTMLAnchorElement | null;
    if (!navUpgradeBtn) return;
    
    const perms = user.permissions || [];
    const isPremium = perms.includes('premium.shark');
    const premiumStatus = user.premiumStatus as string | undefined;
    const periodEnd = user.premiumCurrentPeriodEnd ? new Date(user.premiumCurrentPeriodEnd) : null;
    
    if (isPremium && premiumStatus === 'canceled' && periodEnd) {
        // Canceled but still has benefits - show days remaining
        const now = new Date();
        const diff = periodEnd.getTime() - now.getTime();
        const daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
        navUpgradeBtn.innerHTML = `🦈 ${daysLeft}d`;
        navUpgradeBtn.title = `Shark expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
        navUpgradeBtn.style.color = '#ff9800';
        navUpgradeBtn.style.borderColor = 'rgba(255, 152, 0, 0.5)';
        navUpgradeBtn.style.background = 'rgba(255, 152, 0, 0.12)';
    } else if (isPremium) {
        // Active premium - show shark
        navUpgradeBtn.innerHTML = '🦈';
        navUpgradeBtn.title = 'Shark Active';
        navUpgradeBtn.style.color = '#ffd54f';
        navUpgradeBtn.style.borderColor = 'rgba(255, 215, 0, 0.5)';
        navUpgradeBtn.style.background = 'rgba(255, 215, 0, 0.12)';
    } else {
        // Not premium - show star upgrade button
        navUpgradeBtn.innerHTML = '★';
        navUpgradeBtn.title = 'Upgrade to Shark';
        navUpgradeBtn.style.color = '#ffd54f';
        navUpgradeBtn.style.borderColor = 'rgba(255, 215, 0, 0.5)';
        navUpgradeBtn.style.background = 'rgba(255, 215, 0, 0.12)';
    }
}

checkAuth();
