import { startGame, setLoaderText } from './gameplay';
import { ErrorModal } from './ui/ErrorModal';

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

// Auth check
async function checkAuth() {
    try {
        setLoaderText('Authenticating...');
        
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
            window.location.href = '/login';
            return;
        }
        const data = await res.json();
        if (!data.user) {
            window.location.href = '/login';
            return;
        }

        if (!data.user.username) {
            window.location.href = '/onboarding';
            return;
        }

        const perms = data.user.permissions || [];
        if (!perms.includes('access.game')) {
             window.location.href = '/account'; 
             return;
        }

        setLoaderText('Initializing game...');
        
        // Update the upgrade button based on premium status
        updateUpgradeButton(data.user);
        
        startGame({
            _id: data.user._id,
            username: data.user.username,
            permissions: perms,
            isPremium: perms.includes('premium.shark')
        });
    } catch (e) {
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
