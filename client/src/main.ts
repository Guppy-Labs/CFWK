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
        
        startGame({
            _id: data.user._id,
            username: data.user.username
        });
    } catch (e) {
        window.location.href = '/login';
    }
}

checkAuth();
