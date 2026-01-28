
import { init as initBg, rushFish, triggerSuccess } from './login-bg';
import { Toast } from './ui/Toast';

const loginForm = document.getElementById('login-form') as HTMLFormElement;
const registerForm = document.getElementById('register-form') as HTMLFormElement;

const loginEmailInput = document.getElementById('login-email') as HTMLInputElement;
const loginPassInput = document.getElementById('login-password') as HTMLInputElement;

const regEmailInput = document.getElementById('reg-email') as HTMLInputElement;
const regPassInput = document.getElementById('reg-password') as HTMLInputElement;

fetch('/api/auth/me', { method: 'GET', headers: { 'Content-Type': 'application/json' } })
    .then(res => {
        if (res.ok) return res.json();
        throw new Error('Not logged in');
    })
    .then(data => {
        if (data && data.user) {
            window.location.href = '/account';
        }
    })
    .catch(() => {
        // tna
    });

initBg();

// navigation logic
const toRegisterBtn = document.getElementById('to-register');
const toLoginBtn = document.getElementById('to-login');
const loginCard = document.getElementById('login-card');
const registerCard = document.getElementById('register-card');

function switchCard(showRegister: boolean) {
    if (!loginCard || !registerCard) return;
    
    const target = showRegister ? registerCard : loginCard;
    if (target.classList.contains('active')) return;

    if (window.innerWidth <= 768) {
         const current = showRegister ? loginCard : registerCard;
         current.classList.remove('active');
         current.classList.add('hidden');
         
         target.classList.remove('hidden');
         target.classList.add('active');
         return;
    }

    rushFish();
    const title = document.querySelector('.main-title');
    if (title) {
        title.classList.add('fade-out');
        setTimeout(() => { title.classList.remove('fade-out'); }, 400);
    }

    const current = showRegister ? loginCard : registerCard;
    const next = showRegister ? registerCard : loginCard;

    current.classList.remove('active');
    current.classList.add('exit-right');
    
    setTimeout(() => {
        current.classList.remove('exit-right'); 
        next.classList.add('start-right');
        void next.offsetWidth;
        next.classList.remove('start-right');
        next.classList.add('active');
    }, 400); 
}

if (toRegisterBtn) {
    toRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.history.pushState({}, '', '/register');
        switchCard(true);
    });
}

if (toLoginBtn) {
    toLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.history.pushState({}, '', '/login');
        switchCard(false);
    });
}

window.addEventListener('popstate', () => {
    const isRegister = window.location.pathname === '/register' || window.location.pathname === '/register/';
    switchCard(isRegister);
});

if (window.location.pathname === '/register' || window.location.pathname === '/register/') {
    if (loginCard && registerCard) {
        loginCard.classList.remove('active');
        loginCard.classList.add('hidden');
        registerCard.classList.remove('hidden');
        registerCard.classList.add('active');
    }
}



// --- AUTH LOGIC ---

async function manualRegister(email: string, pass: string) {
    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass })
        });
        const data = await res.json();
        if (res.ok) {
            Toast.success('Registration successful! Please check your email.');
            window.location.href = `/sent?email=${encodeURIComponent(email)}`;
        } else {
            Toast.error(data.message || 'Registration failed');
        }
    } catch (e) {
        console.error(e);
        Toast.error('Server connection error');
    }
}

async function manualLogin(email: string, pass: string) {
    try {
        const response = await fetch('/api/auth/login', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ email, password: pass })
        });

        const data = await response.json();
        
        if (response.status === 403 && data.code === 'not_verified') {
            window.location.href = `/sent?email=${encodeURIComponent(email)}`;
            return;
        }

        if (response.ok) {
            Toast.success('Welcome back!');
            triggerSuccess();
            const container = document.getElementById('split-container');
            if (container) container.classList.add('exit-down');
            
            setTimeout(() => window.location.href = '/account', 2500);
        } else {
            Toast.error(data.message || 'Login failed');
        }
    } catch (e) {
        console.error(e);
        Toast.error('Server connection error');
    }
}

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    manualLogin(loginEmailInput.value, loginPassInput.value);
});

registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    manualRegister(regEmailInput.value, regPassInput.value);
});


// Social Buttons
const googleLogin = document.getElementById('google-login');
const discordLogin = document.getElementById('discord-login');
const googleRegister = document.getElementById('google-register');
const discordRegister = document.getElementById('discord-register');

function socialAuth(provider: 'google' | 'discord') {
    window.location.href = `/api/auth/${provider}`;
}

if(googleLogin) googleLogin.addEventListener('click', () => socialAuth('google'));
if(discordLogin) discordLogin.addEventListener('click', () => socialAuth('discord'));
if(googleRegister) googleRegister.addEventListener('click', () => socialAuth('google'));
if(discordRegister) discordRegister.addEventListener('click', () => socialAuth('discord'));

const urlParams = new URLSearchParams(window.location.search);
const error = urlParams.get('error');
if (error) {
    if (error === 'google_failed') Toast.error('Google Login Failed.');
    else if (error === 'discord_failed') Toast.error('Discord Login Failed.');
    else if (error === 'restricted') Toast.error('Access Denied: Your email is not on the allowed list.');
    else if (error === 'provider_mismatch') Toast.error('Email already in use by another provider.');
    else Toast.error('Authentication Failed: ' + error);
    
    if (window.history.replaceState) {
       window.history.replaceState({}, document.title, window.location.pathname);
    }
}

document.addEventListener('contextmenu', event => event.preventDefault());

// --- Release Countdown ---
const countdownContainer = document.getElementById('countdown-container') as HTMLElement;
const cdDays = document.getElementById('cd-days') as HTMLElement;
const cdHours = document.getElementById('cd-hours') as HTMLElement;
const cdMinutes = document.getElementById('cd-minutes') as HTMLElement;
const cdSeconds = document.getElementById('cd-seconds') as HTMLElement;

const releaseDate = new Date('2026-04-09T06:00:00').getTime();

if (countdownContainer) {
    startCountdown();
}

function startCountdown() {
    countdownContainer.style.display = 'flex';
    
    const updateTime = () => {
        const now = new Date().getTime();
        const distance = releaseDate - now;

        if (distance < 0) {
            countdownContainer.innerHTML = '<span style="color: var(--mm-primary); font-weight: bold; font-size: 1.5rem;">RELEASED!</span>';
            return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        if(cdDays) cdDays.textContent = days.toString().padStart(2, '0');
        if(cdHours) cdHours.textContent = hours.toString().padStart(2, '0');
        if(cdMinutes) cdMinutes.textContent = minutes.toString().padStart(2, '0');
        if(cdSeconds) cdSeconds.textContent = seconds.toString().padStart(2, '0');
    };
    
    updateTime();
    setInterval(updateTime, 1000);
}

