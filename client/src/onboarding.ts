import { Toast } from './ui/Toast';
import { getUsernameValidationError, normalizeUsername } from './utils/username';

const form = document.getElementById('onboarding-form') as HTMLFormElement;
const usernameInput = document.getElementById('username') as HTMLInputElement;

fetch('/api/auth/me')
    .then(res => {
        if (!res.ok) window.location.href = '/login';
        return res.json();
    })
    .then(data => {
        if (data.user && data.user.username) {
            usernameInput.value = data.user.username;
        }
    })
    .catch(() => {
        window.location.href = '/login';
    });

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value;
    const usernameError = getUsernameValidationError(username);
    if (usernameError) {
        Toast.error(usernameError);
        return;
    }

    try {
        const normalized = normalizeUsername(username);
        const res = await fetch('/api/auth/set-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: normalized })
        });
        const data = await res.json();
        
        if (res.ok) {
            Toast.success('Username set! Welcome aboard.');
            setTimeout(() => window.location.href = '/account', 1000);
        } else {
            Toast.error(data.message || 'Failed to set username');
        }
    } catch (err) {
        console.error(err);
        Toast.error('Server connection error');
    }
});
