import { startGame } from './gameplay';

export interface UserData {
    _id: string;
    username: string;
}

// Auth check
async function checkAuth() {
    try {
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

        startGame({
            _id: data.user._id,
            username: data.user.username
        });
    } catch (e) {
        window.location.href = '/login';
    }
}

checkAuth();
