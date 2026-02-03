const upgradeBtn = document.getElementById('upgrade-btn') as HTMLButtonElement | null;
const statusBanner = document.getElementById('upgrade-status') as HTMLDivElement | null;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement | null;
const resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement | null;
const upgradeCard = document.getElementById('upgrade-card') as HTMLDivElement | null;
const premiumCard = document.getElementById('premium-card') as HTMLDivElement | null;
const canceledCard = document.getElementById('canceled-card') as HTMLDivElement | null;
const expiresDateEl = document.getElementById('expires-date') as HTMLSpanElement | null;

function showStatus(message: string, type: 'success' | 'error' | 'info' = 'info') {
    if (!statusBanner) return;
    statusBanner.style.display = 'block';
    statusBanner.textContent = message;
    statusBanner.className = `status-banner ${type}`;
}

function getDaysRemaining(endDate: Date): number {
    const now = new Date();
    const diff = endDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
            showStatus('Please log in to upgrade.', 'error');
            if (upgradeBtn) upgradeBtn.disabled = true;
            return null;
        }
        const data = await res.json();
        if (!data.user) {
            showStatus('Please log in to upgrade.', 'error');
            if (upgradeBtn) upgradeBtn.disabled = true;
            return null;
        }

        const perms = data.user.permissions || [];
        const isPremium = perms.includes('premium.shark');
        const premiumStatus = data.user.premiumStatus as string | undefined;
        const periodEnd = data.user.premiumCurrentPeriodEnd ? new Date(data.user.premiumCurrentPeriodEnd) : null;

        // Hide all cards initially
        if (upgradeCard) upgradeCard.style.display = 'none';
        if (premiumCard) premiumCard.style.display = 'none';
        if (canceledCard) canceledCard.style.display = 'none';

        if (isPremium && premiumStatus === 'canceled' && periodEnd) {
            // Canceled but still has benefits until period end
            const daysLeft = getDaysRemaining(periodEnd);
            if (canceledCard) canceledCard.style.display = 'flex';
            if (expiresDateEl) expiresDateEl.textContent = formatDate(periodEnd);
            showStatus(`Your subscription is canceled. Benefits expire in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`, 'info');
        } else if (isPremium) {
            // Active premium
            showStatus('You are a Shark. Thank you for supporting development!', 'success');
            if (premiumCard) premiumCard.style.display = 'flex';
        } else {
            // Not premium
            if (upgradeCard) upgradeCard.style.display = 'flex';
            
            if (premiumStatus === 'past_due') {
                showStatus('Your payment is past due. Please update your subscription.', 'error');
            }
        }

        return data.user;
    } catch {
        showStatus('Unable to verify account. Please log in again.', 'error');
        if (upgradeBtn) upgradeBtn.disabled = true;
        return null;
    }
}

function showCancelConfirm(onConfirm: () => void) {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0,0,0,0.65)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';

    const card = document.createElement('div');
    card.style.background = 'var(--mm-bg-panel)';
    card.style.border = '2px solid var(--mm-border)';
    card.style.padding = '1.5rem';
    card.style.maxWidth = '420px';
    card.style.width = '90%';
    card.style.color = 'var(--mm-text-main)';
    card.style.fontFamily = 'Minecraft, sans-serif';

    card.innerHTML = `
        <div style="font-size:1.2rem; color:var(--mm-primary); margin-bottom:0.5rem;">End Subscription?</div>
        <div style="color:var(--mm-text-muted); margin-bottom:1rem;">
            You will lose Shark perks at the end of your billing period. Are you sure?
        </div>
        <div style="display:flex; gap:0.75rem; justify-content:flex-end;">
            <button id="cancel-no" style="background: transparent; border:1px solid var(--mm-border); color:var(--mm-text-muted); padding:8px 14px; font-family:inherit; cursor:pointer;">Keep</button>
            <button id="cancel-yes" style="background: var(--mm-danger); border:none; color:white; padding:8px 14px; font-family:inherit; cursor:pointer;">End</button>
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    (card.querySelector('#cancel-no') as HTMLButtonElement)?.addEventListener('click', close);
    (card.querySelector('#cancel-yes') as HTMLButtonElement)?.addEventListener('click', () => {
        close();
        onConfirm();
    });
}

async function cancelSubscription() {
    if (!cancelBtn) return;
    cancelBtn.disabled = true;
    try {
        const res = await fetch('/api/stripe/cancel-subscription', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Failed to cancel subscription');

        // Refresh the page to show updated state
        window.location.reload();
    } catch (e: any) {
        showStatus(e?.message || 'Failed to cancel subscription.', 'error');
    } finally {
        cancelBtn.disabled = false;
    }
}

async function resumeSubscription() {
    if (!resumeBtn) return;
    resumeBtn.disabled = true;
    resumeBtn.textContent = 'Resuming...';
    try {
        const res = await fetch('/api/stripe/resume-subscription', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Failed to resume subscription');

        // Refresh the page to show updated state
        window.location.reload();
    } catch (e: any) {
        showStatus(e?.message || 'Failed to resume subscription.', 'error');
        resumeBtn.disabled = false;
        resumeBtn.textContent = 'Resume Subscription';
    }
}

async function startCheckout() {
    if (!upgradeBtn) return;
    upgradeBtn.disabled = true;
    upgradeBtn.textContent = 'Redirecting...';

    try {
        const res = await fetch('/api/stripe/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || 'Unable to start checkout');
        }

        const data = await res.json();
        if (!data.url) throw new Error('Missing checkout URL');

        window.location.href = data.url;
    } catch (e: any) {
        showStatus(e?.message || 'Checkout failed. Please try again.', 'error');
        upgradeBtn.disabled = false;
        upgradeBtn.textContent = 'Upgrade for $4/mo';
    }
}

function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === '1') {
        showStatus('Payment received! Your Shark perks will activate shortly.', 'success');
    } else if (params.get('canceled') === '1') {
        showStatus('Checkout canceled. No changes were made.', 'error');
    }
}

checkUrlParams();
checkAuth();

if (upgradeBtn) {
    upgradeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        startCheckout();
    });
}

if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showCancelConfirm(cancelSubscription);
    });
}

if (resumeBtn) {
    resumeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        resumeSubscription();
    });
}
