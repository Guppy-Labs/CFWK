async function requireLogin() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
            const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
            window.location.href = `/login?next=${next}`;
            return;
        }
        const data = await res.json();
        if (!data.user) {
            const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
            window.location.href = `/login?next=${next}`;
            return;
        }

        if (!data.user.username) {
            window.location.href = '/onboarding';
            return;
        }
    } catch {
        const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
        window.location.href = `/login?next=${next}`;
    }
}

requireLogin();
