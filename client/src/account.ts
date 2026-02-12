
import { Toast } from './ui/Toast';
import { CharacterService } from './gameplay/player/CharacterService';
import { DEFAULT_CHARACTER_APPEARANCE } from '@cfwk/shared';
import { renderCharacterPreview } from './skin/CharacterPreview';
import { getUsernameValidationError, normalizeUsername } from './utils/username';

const usernameInput = document.getElementById('username-input') as HTMLInputElement;
const saveUsernameBtn = document.getElementById('save-username-btn') as HTMLButtonElement;
const usernameMsg = document.getElementById('username-msg') as HTMLElement;
const usernameInfoBox = document.getElementById('username-info-box') as HTMLElement;

const statusInput = document.getElementById('status-input') as HTMLInputElement;
const saveStatusBtn = document.getElementById('save-status-btn') as HTMLButtonElement;

const passwordForm = document.getElementById('password-form') as HTMLFormElement;
const newPassInput = document.getElementById('new-password') as HTMLInputElement;
const confirmPassInput = document.getElementById('confirm-password') as HTMLInputElement;
const currentPassGroup = document.getElementById('current-password-group') as HTMLElement;
const currentPassInput = document.getElementById('current-password') as HTMLInputElement;

const navAvatar = document.getElementById('nav-avatar') as HTMLImageElement;
const navUsername = document.getElementById('nav-username') as HTMLElement;
const settingsAvatar = document.getElementById('settings-avatar') as HTMLImageElement;
const avatarInput = document.getElementById('avatar-input') as HTMLInputElement;
const changeAvatarBtn = document.getElementById('change-avatar-btn') as HTMLButtonElement;

const skinPreviewCanvas = document.getElementById('skin-preview-canvas') as HTMLCanvasElement;


const linkGoogleBtn = document.getElementById('link-google') as HTMLAnchorElement;
const linkDiscordBtn = document.getElementById('link-discord') as HTMLAnchorElement;
const unlinkGoogleBtn = document.getElementById('unlink-google') as HTMLButtonElement;
const unlinkDiscordBtn = document.getElementById('unlink-discord') as HTMLButtonElement;

// Unlink Modal
const unlinkModal = document.getElementById('unlink-modal') as HTMLElement;
const unlinkProviderName = document.getElementById('unlink-provider-name') as HTMLElement;
const confirmUnlinkBtn = document.getElementById('confirm-unlink-btn') as HTMLButtonElement;
const cancelUnlinkBtn = document.getElementById('cancel-unlink-btn') as HTMLButtonElement;
const closeUnlinkX = document.querySelector('.close-modal.link-close') as HTMLElement;

let providerToUnlink: string | null = null;

function openUnlinkModal(provider: string) {
    providerToUnlink = provider;
    unlinkProviderName.textContent = provider.charAt(0).toUpperCase() + provider.slice(1);
    unlinkModal.style.display = 'block';
}

function closeUnlinkModal() {
    unlinkModal.style.display = 'none';
    providerToUnlink = null;
}

if (unlinkModal) {
    if (cancelUnlinkBtn) cancelUnlinkBtn.addEventListener('click', closeUnlinkModal);
    if (closeUnlinkX) closeUnlinkX.addEventListener('click', closeUnlinkModal);
    window.addEventListener('click', (e) => {
        if (e.target === unlinkModal) closeUnlinkModal();
    });

    if (unlinkGoogleBtn) unlinkGoogleBtn.addEventListener('click', () => openUnlinkModal('google'));
    if (unlinkDiscordBtn) unlinkDiscordBtn.addEventListener('click', () => openUnlinkModal('discord'));

    confirmUnlinkBtn.addEventListener('click', async () => {
        if (!providerToUnlink) return;
        
        try {
            const res = await fetch('/api/auth/unlink', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: providerToUnlink })
            });
            const data = await res.json();
            
            if (res.ok) {
                Toast.success(`Unlinked ${providerToUnlink}`);
                closeUnlinkModal();
                // Refresh user data
                init();
            } else {
                Toast.error(data.message);
                closeUnlinkModal();
            }
        } catch (e) {
            Toast.error('Failed to unlink');
        }
    });

}

const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;

const userMenuTrigger = document.getElementById('user-menu-trigger') as HTMLElement;
const userDropdown = document.getElementById('user-dropdown') as HTMLElement;

if (userMenuTrigger && userDropdown) {
    userMenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenuTrigger.classList.toggle('active');
        userDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!userMenuTrigger.contains(e.target as Node) && !userDropdown.contains(e.target as Node)) {
            userMenuTrigger.classList.remove('active');
            userDropdown.classList.remove('show');
        }
    });
}

const countdownContainer = document.getElementById('countdown-container') as HTMLElement;
const cdDays = document.getElementById('cd-days') as HTMLElement;
const cdHours = document.getElementById('cd-hours') as HTMLElement;
const cdMinutes = document.getElementById('cd-minutes') as HTMLElement;
const cdSeconds = document.getElementById('cd-seconds') as HTMLElement;

const countdownModal = document.getElementById('countdown-modal') as HTMLElement;
// const closeModalBtn = document.getElementById('close-modal-btn') as HTMLElement;
const closeModalX = document.querySelector('.close-modal') as HTMLElement;
const lcDays = document.getElementById('lc-days') as HTMLElement;
const lcHours = document.getElementById('lc-hours') as HTMLElement;
const lcMinutes = document.getElementById('lc-minutes') as HTMLElement;
const lcSeconds = document.getElementById('lc-seconds') as HTMLElement;

const mapmakerCard = document.getElementById('mapmaker-card') as HTMLElement;
const preregCard = document.getElementById('prereg-card') as HTMLElement;
const navPlayBtn = document.getElementById('nav-play-btn') as HTMLElement;
const navBetaBtn = document.getElementById('nav-beta-btn') as HTMLButtonElement;
const navUpgradeBtn = document.getElementById('nav-upgrade-btn') as HTMLAnchorElement;
const betaAccessCard = document.getElementById('beta-access-card') as HTMLElement;
const betaAccessTime = document.getElementById('beta-access-time') as HTMLElement;

// Beta Modal
const betaModal = document.getElementById('beta-modal') as HTMLElement;
const betaCloseBtn = document.getElementById('beta-close') as HTMLElement;
const betaCancelBtn = document.getElementById('beta-cancel-btn') as HTMLButtonElement;
const betaCodeInput = document.getElementById('beta-code-input') as HTMLInputElement;
const betaSubmitBtn = document.getElementById('beta-submit-btn') as HTMLButtonElement;
const betaFeedback = document.getElementById('beta-feedback') as HTMLElement;

const releaseDate = new Date('2026-05-02T06:00:00').getTime();
let countdownInterval: any;

function openCountdownModal() {
    countdownModal.style.display = 'block';
}

function closeCountdownModal() {
    countdownModal.style.display = 'none';
}

function openBetaModal() {
    if (!betaModal) return;
    betaModal.style.display = 'block';
    if (betaCodeInput) {
        betaCodeInput.value = '';
        betaCodeInput.focus();
    }
    if (betaFeedback) {
        betaFeedback.textContent = '';
        betaFeedback.className = 'beta-feedback';
    }
}

function closeBetaModal() {
    if (!betaModal) return;
    betaModal.style.display = 'none';
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

if (countdownContainer) {
    countdownContainer.addEventListener('click', openCountdownModal);
}
if (closeModalX) closeModalX.addEventListener('click', closeCountdownModal);
window.addEventListener('click', (e) => {
    if (e.target === countdownModal) {
        closeCountdownModal();
    }
});

if (navBetaBtn) {
    navBetaBtn.addEventListener('click', openBetaModal);
}

if (betaCloseBtn) betaCloseBtn.addEventListener('click', closeBetaModal);
if (betaCancelBtn) betaCancelBtn.addEventListener('click', closeBetaModal);
window.addEventListener('click', (e) => {
    if (e.target === betaModal) closeBetaModal();
});

if (betaCodeInput) {
    betaCodeInput.addEventListener('input', () => {
        betaCodeInput.value = betaCodeInput.value.replace(/[^0-9]/g, '').slice(0, 8);
    });

    betaCodeInput.addEventListener('paste', (event) => {
        const text = event.clipboardData?.getData('text') || '';
        const digits = text.replace(/[^0-9]/g, '').slice(0, 8);
        if (digits.length > 0) {
            event.preventDefault();
            betaCodeInput.value = digits;
        }
    });
}

// --- Fetch User Data ---
async function init() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) window.location.href = '/login';
        const data = await res.json();
        
        if (!data.user) {
            window.location.href = '/login';
            return;
        }

        if (!data.user.username) {
            window.location.href = '/onboarding';
            return;
        }
        
        renderUser(data.user);
        renderSkinPreview();
    } catch (e) {
        console.error(e);
    }
}

async function renderSkinPreview() {
    if (!skinPreviewCanvas) return;

    const service = CharacterService.getInstance();
    let appearance = DEFAULT_CHARACTER_APPEARANCE;
    try {
        appearance = await service.fetchAppearance();
    } catch {
        // Use default appearance
    }

    renderCharacterPreview(skinPreviewCanvas, appearance, 'S', 2).catch(() => {
        // Ignore preview errors
    });
}

function renderUser(user: any) {
    // Avatar
    const avatarUrl = user.profilePic || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    navAvatar.src = avatarUrl;
    settingsAvatar.src = avatarUrl;
    
    // Username
    if (user.username) {
        navUsername.textContent = user.username;
        usernameInput.value = user.username;
    }

    // Status
    if (user.status) {
        statusInput.value = user.status;
    }

    // Cooldown
    checkUsernameCooldown(user.lastUsernameChange);

    // Linked Accounts
    updateLinkButton(linkGoogleBtn, user.googleId, 'Google');
    updateLinkButton(linkDiscordBtn, user.discordId, 'Discord');

    // Permissions
    const perms = user.permissions || [];
    // Ban Check (do this before showing play button)
    let isBanned = false;
    
    // Check for account ban
    if (user.bannedUntil) {
        const bannedUntil = new Date(user.bannedUntil);
        if (bannedUntil.getTime() > Date.now()) {
            isBanned = true;
            showBanAlert(bannedUntil, 'ACCOUNT BANNED');
        }
    }
    
    // Check for IP ban (separate from account ban)
    if (user.ipBannedUntil && !isBanned) {
        const ipBannedUntil = new Date(user.ipBannedUntil);
        if (ipBannedUntil.getTime() > Date.now()) {
            isBanned = true;
            showBanAlert(ipBannedUntil, 'BANNED');
        }
    }
    
    if (perms.includes('access.maps')) {
        if (mapmakerCard) mapmakerCard.style.display = 'flex';
    } else {
        if (preregCard) preregCard.style.display = 'flex';
    }

    // Always show countdown for all users
    startCountdown();
    
    const betaAccessUntil = user.betaAccessUntil ? new Date(user.betaAccessUntil) : null;
    const hasBetaAccess = !!(betaAccessUntil && betaAccessUntil.getTime() > Date.now());

    if ((perms.includes('access.game') || hasBetaAccess) && !isBanned) {
        if (navPlayBtn) navPlayBtn.style.display = 'inline-flex';
        if (navBetaBtn) navBetaBtn.style.display = 'none';
    } else if (!isBanned) {
        if (navBetaBtn) navBetaBtn.style.display = 'inline-flex';
        if (navPlayBtn) navPlayBtn.style.display = 'none';
    }

    if (betaAccessCard && betaAccessTime) {
        if (hasBetaAccess && betaAccessUntil) {
            const remaining = betaAccessUntil.getTime() - Date.now();
            betaAccessTime.textContent = `Ends in ${formatRemaining(remaining)}`;
            betaAccessCard.style.display = 'flex';
        } else {
            betaAccessCard.style.display = 'none';
        }
    }

    // Update upgrade button based on premium status
    updateUpgradeButton(user);

    if (user.hasPassword) {
        if(currentPassGroup) currentPassGroup.style.display = 'block';
        if(currentPassInput) currentPassInput.required = true;
    } else {
        if(currentPassGroup) currentPassGroup.style.display = 'none';
        if(currentPassInput) currentPassInput.required = false;

        // Show email reminder if no password set
        showPasswordEmailReminder(user.email);
    }
}

function showBanAlert(bannedUntil: Date, banType: 'ACCOUNT BANNED' | 'BANNED' = 'ACCOUNT BANNED') {
    const container = document.querySelector('.container');
    if (!container) return;

    const alertId = 'ban-alert-banner';
    if (document.getElementById(alertId)) return;

    const alert = document.createElement('div');
    alert.id = alertId;
    alert.style.backgroundColor = 'rgba(255, 0, 0, 0.15)';
    alert.style.border = '1px solid #ff4444';
    alert.style.color = '#ff4444';
    alert.style.padding = '15px';
    alert.style.marginBottom = '20px';
    alert.style.display = 'flex';
    alert.style.alignItems = 'center';
    alert.style.gap = '10px';
    
    // Check if ban is "permanent" (more than 50 years from now)
    const fiftyYearsMs = 50 * 365 * 24 * 60 * 60 * 1000;
    const isPermanent = bannedUntil.getTime() - Date.now() > fiftyYearsMs;
    
    const banMessage = isPermanent 
        ? 'You are permanently banned from playing.'
        : `You are banned from playing until: <strong>${bannedUntil.toLocaleString()}</strong>`;
    
    alert.innerHTML = `
        <i class="fa-solid fa-ban" style="font-size: 1.5rem;"></i>
        <div>
            <div style="font-weight: bold; font-size: 1.1rem;">${banType}</div>
            <div style="font-size: 0.9rem;">${banMessage}</div>
        </div>
    `;
    
    container.insertBefore(alert, container.firstChild);
}

function showPasswordEmailReminder(email: string) {
    const reminderId = 'password-email-reminder';
    let reminder = document.getElementById(reminderId);
    
    if (!reminder) {
        reminder = document.createElement('div');
        reminder.id = reminderId;
        reminder.style.padding = '10px';
        reminder.style.marginBottom = '10px';
        reminder.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
        reminder.style.border = '1px solid #4caf50';
        reminder.style.color = '#81c784';
        reminder.style.borderRadius = '0';
        reminder.style.fontSize = '0.9rem';
        
        // Insert before form
        passwordForm.insertBefore(reminder, passwordForm.firstChild);
    }
    
    reminder.innerHTML = `<i class="fa-solid fa-circle-info" style="margin-right: 8px;"></i> You are setting a password for <strong>${email}</strong>`;
}

function updateUpgradeButton(user: any) {
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
        navUpgradeBtn.style.color = '#ff9800'; // Orange for canceled
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

function startCountdown() {
    countdownContainer.style.display = 'flex';
    
    const updateTime = () => {
        const now = new Date().getTime();
        const distance = releaseDate - now;

        if (distance < 0) {
            clearInterval(countdownInterval);
            countdownContainer.innerHTML = '<span style="color: var(--mm-primary); font-weight: bold; font-size: 1.5rem;">RELEASED!</span>';
             if (countdownModal.style.display === 'block') {
                 countdownModal.querySelector('.large-countdown')!.innerHTML = '<h1 style="color: var(--mm-primary); font-size: 4rem;">RELEASED!</h1>';
             }
            return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        // Navbar
        updateDiff(cdDays, days);
        updateDiff(cdHours, hours);
        updateDiff(cdMinutes, minutes);
        updateDiff(cdSeconds, seconds);

        if (lcDays) updateDiff(lcDays, days);
        if (lcHours) updateDiff(lcHours, hours);
        if (lcMinutes) updateDiff(lcMinutes, minutes);
        if (lcSeconds) updateDiff(lcSeconds, seconds);
    };

    updateTime();
    countdownInterval = setInterval(updateTime, 1000);
}

function updateDiff(el: HTMLElement, val: number) {
    const str = val < 10 ? '0' + val : '' + val;
    if (el.textContent !== str) {
        el.textContent = str;
        el.parentElement!.classList.remove('val-change');
        void el.parentElement!.offsetWidth; // trigger reflow
        el.parentElement!.classList.add('val-change');
    }
}

function checkUsernameCooldown(lastChangeStr: string | undefined) {
    let canChange = true;
    let msg = "You can change your username.";
    let isWarning = false;

    if (lastChangeStr) {
        const lastChange = new Date(lastChangeStr);
        const now = new Date();
        const diffMs = now.getTime() - lastChange.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        
        if (diffDays < 14) {
            canChange = false;
            isWarning = true;
            const daysLeft = Math.ceil(14 - diffDays);
            msg = `Next change available in ${daysLeft} days.`;
        }
    }

    if (isWarning) {
        usernameInfoBox.style.color = '#d53a3a'; // Red/Danger
        usernameInfoBox.style.borderColor = '#d53a3a';
        usernameInfoBox.style.backgroundColor = 'rgba(213, 58, 58, 0.1)';
        usernameInput.disabled = true;
        saveUsernameBtn.disabled = true;
    } else {
        usernameInfoBox.style.color = '#fbbc05'; // Yellow
        usernameInfoBox.style.borderColor = '#fbbc05';
        usernameInfoBox.style.backgroundColor = 'rgba(251, 188, 5, 0.1)';
        usernameInput.disabled = false;
        saveUsernameBtn.disabled = false;
    }
    usernameInfoBox.textContent = msg;
}

function updateLinkButton(btn: HTMLAnchorElement, id: string | undefined, providerName: string) {
    const unlinkBtn = document.getElementById(`unlink-${providerName.toLowerCase()}`) as HTMLElement;
    
    if (id) {
        btn.classList.add('linked');
        btn.querySelector('.link-text')!.textContent = `${providerName} Linked`;
        btn.href = 'javascript:void(0)'; // Disable link
        if (unlinkBtn) unlinkBtn.style.display = 'flex';
    } else {
        btn.classList.remove('linked');
        btn.querySelector('.link-text')!.textContent = `Link ${providerName} Account`;
        btn.href = `/api/account/link/${providerName.toLowerCase()}`;
        if (unlinkBtn) unlinkBtn.style.display = 'none';
    }
}

// --- Actions ---

changeAvatarBtn.addEventListener('click', () => {
    avatarInput.click();
});

avatarInput.addEventListener('change', async () => {
    if (!avatarInput.files || avatarInput.files.length === 0) return;
    const file = avatarInput.files[0];

    if (file.size > 2 * 1024 * 1024) {
        Toast.error('Image too large (max 2MB)');
        return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    try {
        changeAvatarBtn.disabled = true;
        changeAvatarBtn.textContent = 'Uploading...';
        
        const res = await fetch('/api/account/avatar', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (res.ok) {
            Toast.success('Profile picture updated');
            navAvatar.src = data.profilePic;
            settingsAvatar.src = data.profilePic;
        } else {
            Toast.error(data.message || 'Upload failed');
        }
    } catch (e) {
        Toast.error('Upload error');
    } finally {
        changeAvatarBtn.disabled = false;
        changeAvatarBtn.textContent = 'Change Photo';
        avatarInput.value = '';
    }
});

// Update Username
saveUsernameBtn.addEventListener('click', async () => {
    const val = usernameInput.value;
    const usernameError = getUsernameValidationError(val);
    if (usernameError) {
        Toast.error(usernameError);
        usernameMsg.textContent = usernameError;
        return;
    }
    
    try {
        const normalized = normalizeUsername(val);
        const res = await fetch('/api/account/username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: normalized })
        });
        const data = await res.json();
        
        if (res.ok) {
            Toast.success('Username updated');
            usernameMsg.textContent = '';
        } else {
            Toast.error(data.message);
            usernameMsg.textContent = data.message;
        }
    } catch (e) {
        Toast.error('Failed to update username');
    }
});

// Update Status
saveStatusBtn.addEventListener('click', async () => {
    const val = statusInput.value.trim();
    
    try {
        const res = await fetch('/api/account/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: val })
        });
        
        if (res.ok) {
            Toast.success('Status updated');
        } else {
            const data = await res.json();
            Toast.error(data.message);
        }
    } catch (e) {
        Toast.error('Failed to update status');
    }
});

// Update Password
passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = newPassInput.value;
    const p2 = confirmPassInput.value;
    const current = currentPassInput ? currentPassInput.value : '';
    
    if (p1 !== p2) {
        Toast.error('Passwords do not match');
        return;
    }
    
    try {
        const res = await fetch('/api/account/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: p1, currentPassword: current })
        });
        
        if (res.ok) {
            Toast.success('Password updated successfully');
            newPassInput.value = '';
            confirmPassInput.value = '';
            if(currentPassInput) currentPassInput.value = '';
        } else {
            const data = await res.json();
            Toast.error(data.message);
        }
    } catch (e) {
        Toast.error('Failed to update password');
    }
});

logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
});

if (betaSubmitBtn) {
    betaSubmitBtn.addEventListener('click', async () => {
        if (!betaCodeInput) return;
        const code = betaCodeInput.value.trim();
        if (!/^[0-9]{8}$/.test(code)) {
            Toast.error('Enter an 8 digit code');
            if (betaFeedback) {
                betaFeedback.textContent = 'Enter an 8 digit code.';
                betaFeedback.className = 'beta-feedback error';
            }
            return;
        }

        try {
            betaSubmitBtn.disabled = true;
            betaSubmitBtn.textContent = 'Checking...';
            if (betaFeedback) {
                betaFeedback.textContent = 'Checking your code...';
                betaFeedback.className = 'beta-feedback';
            }

            const res = await fetch('/api/beta/redeem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await res.json();
            if (res.ok) {
                Toast.success('Beta access unlocked');
                if (data.betaAccessUntil && betaFeedback) {
                    const remainingMs = new Date(data.betaAccessUntil).getTime() - Date.now();
                    betaFeedback.textContent = `Unlocked! ${formatRemaining(remainingMs)} left.`;
                    betaFeedback.className = 'beta-feedback success';
                }
                setTimeout(() => closeBetaModal(), 600);
                init();
            } else {
                Toast.error(data.message || 'Code rejected');
                if (betaFeedback) {
                    betaFeedback.textContent = data.message || 'Code rejected.';
                    betaFeedback.className = 'beta-feedback error';
                }
            }
        } catch (e) {
            Toast.error('Failed to redeem code');
            if (betaFeedback) {
                betaFeedback.textContent = 'Failed to redeem code.';
                betaFeedback.className = 'beta-feedback error';
            }
        } finally {
            betaSubmitBtn.disabled = false;
            betaSubmitBtn.textContent = 'Unlock Beta';
        }
    });
}

// Check for Link Errors
const urlParams = new URLSearchParams(window.location.search);
const error = urlParams.get('error');
if (error) {
    if (error === 'link_failed') Toast.error('Failed to link account.');
    else if (error === 'already_linked') Toast.error('This account is already linked to another user.');
    else Toast.error('Error: ' + error);
    
    window.history.replaceState({}, '', window.location.pathname);
}

init();

