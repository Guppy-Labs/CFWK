import { clearAccountUserBootstrapCache } from './utils/accountBootstrapCache';

type AdminUser = {
    permissions?: string[];
};

type PlayerCard = {
    id: string;
    username: string | null;
    email: string | null;
    permissions: string[];
    isVerified: boolean;
    isDemo: boolean;
    premiumStatus: string | null;
    premiumTier: string | null;
    money: number;
    lastLocationId: string | null;
    bannedUntil: string | null;
    mutedUntil: string | null;
    isBanned: boolean;
    isMuted: boolean;
    isOnline: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    playerStats: Record<string, unknown> | null;
};

type PlayerDetail = PlayerCard & {
    googleId: string | null;
    discordId: string | null;
    profilePic: string | null;
    status: string | null;
    lastUsernameChange: string | null;
    lastKnownIP: string | null;
    inventory: unknown[];
    equippedRodId: string | null;
    equippedUsableIds: Array<string | null>;
    equippedUsableCounts: number[];
    glimmerbowl: unknown[];
    glimmerbowlUnlocked: boolean;
    hasOwnedScar: boolean;
    characterAppearance: Record<string, unknown> | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    premiumCurrentPeriodEnd: string | null;
    betaAccessUntil: string | null;
    lastPositionX: number | null;
    lastPositionY: number | null;
    settings: Record<string, unknown> | null;
    hearts: Record<string, unknown> | null;
    advancements: Record<string, unknown> | null;
    shopWares: Record<string, unknown>;
};

type PlayersResponse = {
    items: PlayerCard[];
    page: number;
    pageSize: number;
    total: number;
};

type PlayerDetailResponse = {
    user: PlayerDetail;
};

type LocationsResponse = {
    locations: Array<{
        id: string;
        name: string;
    }>;
};

type ApiMessageResponse = {
    message?: string;
    success?: boolean;
};

const forbiddenBox = document.getElementById('forbidden') as HTMLDivElement;
const appLayout = document.getElementById('app-layout') as HTMLElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const filtersForm = document.getElementById('filters-form') as HTMLFormElement;
const clearFiltersBtn = document.getElementById('clear-filters-btn') as HTMLButtonElement;
const qInput = document.getElementById('q-input') as HTMLInputElement;
const permissionsInput = document.getElementById('permissions-input') as HTMLInputElement;
const onlineInput = document.getElementById('online-input') as HTMLSelectElement;
const activeBanInput = document.getElementById('active-ban-input') as HTMLSelectElement;
const activeMuteInput = document.getElementById('active-mute-input') as HTMLSelectElement;
const verifiedInput = document.getElementById('verified-input') as HTMLSelectElement;
const demoInput = document.getElementById('demo-input') as HTMLSelectElement;
const sortByInput = document.getElementById('sort-by-input') as HTMLSelectElement;
const sortDirInput = document.getElementById('sort-dir-input') as HTMLSelectElement;

const playersMeta = document.getElementById('players-meta') as HTMLParagraphElement;
const playersList = document.getElementById('players-list') as HTMLDivElement;
const prevPageBtn = document.getElementById('prev-page-btn') as HTMLButtonElement;
const nextPageBtn = document.getElementById('next-page-btn') as HTMLButtonElement;
const pageMeta = document.getElementById('page-meta') as HTMLParagraphElement;

const floatingPane = document.getElementById('floating-pane') as HTMLElement;
const paneBackdrop = document.getElementById('pane-backdrop') as HTMLDivElement;
const closePaneBtn = document.getElementById('close-pane-btn') as HTMLButtonElement;
const selectedMeta = document.getElementById('selected-meta') as HTMLParagraphElement;
const detailsTabBtn = document.getElementById('details-tab-btn') as HTMLButtonElement;
const managementTabBtn = document.getElementById('management-tab-btn') as HTMLButtonElement;
const detailsTab = document.getElementById('details-tab') as HTMLElement;
const managementTab = document.getElementById('management-tab') as HTMLElement;

const detailsForm = document.getElementById('details-form') as HTMLFormElement;
const usernameInput = document.getElementById('username-input') as HTMLInputElement;
const emailInput = document.getElementById('email-input') as HTMLInputElement;
const statusInput = document.getElementById('status-input') as HTMLInputElement;
const permissionsDetailInput = document.getElementById('permissions-detail-input') as HTMLInputElement;
const moneyInput = document.getElementById('money-input') as HTMLInputElement;
const locationInput = document.getElementById('location-input') as HTMLInputElement;
const bannedUntilInput = document.getElementById('banned-until-input') as HTMLInputElement;
const mutedUntilInput = document.getElementById('muted-until-input') as HTMLInputElement;
const verifiedCheckbox = document.getElementById('verified-checkbox') as HTMLInputElement;
const demoCheckbox = document.getElementById('demo-checkbox') as HTMLInputElement;

const settingsJsonInput = document.getElementById('settings-json-input') as HTMLTextAreaElement;
const statsJsonInput = document.getElementById('stats-json-input') as HTMLTextAreaElement;
const heartsJsonInput = document.getElementById('hearts-json-input') as HTMLTextAreaElement;
const appearanceJsonInput = document.getElementById('appearance-json-input') as HTMLTextAreaElement;
const advancementsJsonInput = document.getElementById('advancements-json-input') as HTMLTextAreaElement;
const inventoryJsonInput = document.getElementById('inventory-json-input') as HTMLTextAreaElement;
const glimmerbowlJsonInput = document.getElementById('glimmerbowl-json-input') as HTMLTextAreaElement;
const detailsFeedback = document.getElementById('details-feedback') as HTMLParagraphElement;

const durationInput = document.getElementById('duration-input') as HTMLInputElement;
const sendLocationInput = document.getElementById('send-location-input') as HTMLSelectElement;
const wipeConfirmInput = document.getElementById('wipe-confirm-input') as HTMLInputElement;
const actionsFeedback = document.getElementById('actions-feedback') as HTMLParagraphElement;

const banBtn = document.getElementById('ban-btn') as HTMLButtonElement;
const tempbanBtn = document.getElementById('tempban-btn') as HTMLButtonElement;
const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement;
const tempmuteBtn = document.getElementById('tempmute-btn') as HTMLButtonElement;
const unbanBtn = document.getElementById('unban-btn') as HTMLButtonElement;
const unmuteBtn = document.getElementById('unmute-btn') as HTMLButtonElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const wipeBtn = document.getElementById('wipe-btn') as HTMLButtonElement;

let players: PlayerCard[] = [];
let selectedUser: PlayerDetail | null = null;
let selectedUserId: string | null = null;
let page = 1;
let pageSize = 25;
let total = 0;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(raw?: string | null): string {
    if (!raw) return 'n/a';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'n/a';
    return date.toLocaleString();
}

function stringifyJson(value: unknown): string {
    return JSON.stringify(value ?? {}, null, 2);
}

function showForbidden() {
    appLayout.style.display = 'none';
    forbiddenBox.classList.add('show');
}

function setStatus(element: HTMLParagraphElement, text: string, isError = false) {
    element.textContent = text;
    element.style.color = isError ? '#ffbcbc' : 'var(--mm-text-muted)';
}

function resetFilterInputs() {
    qInput.value = '';
    permissionsInput.value = '';
    onlineInput.value = '';
    activeBanInput.value = '';
    activeMuteInput.value = '';
    verifiedInput.value = '';
    demoInput.value = '';
    sortByInput.value = 'updatedAt';
    sortDirInput.value = 'desc';
}

function resetDetailsForm() {
    usernameInput.value = '';
    emailInput.value = '';
    statusInput.value = '';
    permissionsDetailInput.value = '';
    moneyInput.value = '';
    locationInput.value = '';
    bannedUntilInput.value = '';
    mutedUntilInput.value = '';
    verifiedCheckbox.checked = false;
    demoCheckbox.checked = false;
    settingsJsonInput.value = '{}';
    statsJsonInput.value = '{}';
    heartsJsonInput.value = '{}';
    appearanceJsonInput.value = '{}';
    advancementsJsonInput.value = '{}';
    inventoryJsonInput.value = '[]';
    glimmerbowlJsonInput.value = '[]';
}

function fillDetailsForm(user: PlayerDetail) {
    usernameInput.value = user.username || '';
    emailInput.value = user.email || '';
    statusInput.value = user.status || '';
    permissionsDetailInput.value = user.permissions.join(',');
    moneyInput.value = String(user.money ?? 0);
    locationInput.value = user.lastLocationId || '';
    bannedUntilInput.value = user.bannedUntil || '';
    mutedUntilInput.value = user.mutedUntil || '';
    verifiedCheckbox.checked = Boolean(user.isVerified);
    demoCheckbox.checked = Boolean(user.isDemo);
    settingsJsonInput.value = stringifyJson(user.settings || {});
    statsJsonInput.value = stringifyJson(user.playerStats || {});
    heartsJsonInput.value = stringifyJson(user.hearts || {});
    appearanceJsonInput.value = stringifyJson(user.characterAppearance || {});
    advancementsJsonInput.value = stringifyJson(user.advancements || {});
    inventoryJsonInput.value = stringifyJson(Array.isArray(user.inventory) ? user.inventory : []);
    glimmerbowlJsonInput.value = stringifyJson(Array.isArray(user.glimmerbowl) ? user.glimmerbowl : []);
}

function showPane() {
    floatingPane.classList.add('show');
    paneBackdrop.classList.add('show');
}

function hidePane() {
    floatingPane.classList.remove('show');
    paneBackdrop.classList.remove('show');
}

function setActiveTab(tab: 'details' | 'management') {
    const detailsActive = tab === 'details';
    detailsTab.classList.toggle('show', detailsActive);
    managementTab.classList.toggle('show', !detailsActive);
    detailsTabBtn.classList.toggle('active', detailsActive);
    managementTabBtn.classList.toggle('active', !detailsActive);
    detailsTabBtn.classList.toggle('mm-btn-secondary', !detailsActive);
    managementTabBtn.classList.toggle('mm-btn-secondary', detailsActive);
}

function renderPlayers() {
    if (players.length === 0) {
        playersMeta.textContent = 'No players found.';
        playersList.innerHTML = '<div class="player-card">No matching users.</div>';
        pageMeta.textContent = `Page ${page}`;
        prevPageBtn.disabled = true;
        nextPageBtn.disabled = true;
        return;
    }

    playersMeta.textContent = `${total} players total`;
    playersList.innerHTML = players.map((player) => {
        const isActive = selectedUserId === player.id;
        const pills: string[] = [];
        if (player.isOnline) pills.push('<span class="pill online">ONLINE</span>');
        if (player.isBanned) pills.push('<span class="pill bad">BANNED</span>');
        if (player.isMuted) pills.push('<span class="pill bad">MUTED</span>');
        if (player.isDemo) pills.push('<span class="pill">DEMO</span>');
        if (player.isVerified) pills.push('<span class="pill">VERIFIED</span>');
        if (player.permissions.includes('game.admin')) pills.push('<span class="pill">ADMIN</span>');
        if (player.premiumTier) pills.push(`<span class="pill">${escapeHtml(player.premiumTier.toUpperCase())}</span>`);

        const displayName = player.username || '(no username)';
        const location = player.lastLocationId || 'n/a';
        return `
            <article class="player-card ${isActive ? 'active' : ''}" data-user-id="${escapeHtml(player.id)}">
                <div class="player-head">
                    <h3 class="player-name">${escapeHtml(displayName)}</h3>
                    <span class="player-sub">$${escapeHtml(String(player.money ?? 0))}</span>
                </div>
                <p class="player-sub">${escapeHtml(player.email || 'no-email')}</p>
                <p class="player-sub">Location: ${escapeHtml(location)} | Updated: ${escapeHtml(formatDate(player.updatedAt))}</p>
                <div class="pill-row">${pills.join('')}</div>
            </article>
        `;
    }).join('');

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    pageMeta.textContent = `Page ${page} / ${totalPages}`;
    prevPageBtn.disabled = page <= 1;
    nextPageBtn.disabled = page >= totalPages;
}

function buildListQuery(): string {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    params.set('sortBy', sortByInput.value);
    params.set('sortDir', sortDirInput.value);

    const q = qInput.value.trim();
    if (q) params.set('q', q);

    const permissions = permissionsInput.value.trim();
    if (permissions) params.set('permissions', permissions);
    if (onlineInput.value) params.set('online', onlineInput.value);
    if (activeBanInput.value) params.set('activeBan', activeBanInput.value);
    if (activeMuteInput.value) params.set('activeMute', activeMuteInput.value);
    if (verifiedInput.value) params.set('isVerified', verifiedInput.value);
    if (demoInput.value) params.set('isDemo', demoInput.value);

    return params.toString();
}

async function loadPlayers() {
    playersMeta.textContent = 'Loading players...';
    const res = await fetch(`/api/admin/users?${buildListQuery()}`, { credentials: 'include' });
    if (!res.ok) {
        playersMeta.textContent = 'Failed to load players.';
        playersList.innerHTML = '<div class="player-card">Could not load users.</div>';
        return;
    }
    const payload = await res.json() as PlayersResponse;
    players = Array.isArray(payload.items) ? payload.items : [];
    total = Number.isFinite(payload.total) ? payload.total : 0;
    page = Number.isFinite(payload.page) ? payload.page : 1;
    pageSize = Number.isFinite(payload.pageSize) ? payload.pageSize : 25;
    renderPlayers();
}

async function loadLocations() {
    const res = await fetch('/api/admin/users/meta/locations', { credentials: 'include' });
    if (!res.ok) {
        sendLocationInput.innerHTML = '<option value="">Unavailable</option>';
        return;
    }
    const payload = await res.json() as LocationsResponse;
    const locations = Array.isArray(payload.locations) ? payload.locations : [];
    if (locations.length === 0) {
        sendLocationInput.innerHTML = '<option value="">No locations</option>';
        return;
    }
    sendLocationInput.innerHTML = locations
        .map((location) => `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)} (${escapeHtml(location.id)})</option>`)
        .join('');
}

async function loadSelectedUser(userId: string) {
    selectedMeta.textContent = 'Loading user details...';
    detailsFeedback.textContent = '';
    actionsFeedback.textContent = '';
    const res = await fetch(`/api/admin/users/${userId}`, { credentials: 'include' });
    if (!res.ok) {
        selectedMeta.textContent = 'Failed to load user details.';
        return;
    }
    const payload = await res.json() as PlayerDetailResponse;
    selectedUser = payload.user;
    selectedUserId = payload.user.id;
    fillDetailsForm(payload.user);
    const displayName = payload.user.username || '(no username)';
    selectedMeta.textContent = `${displayName} (${payload.user.id})`;
    wipeConfirmInput.value = payload.user.username || payload.user.id;
    renderPlayers();
    setActiveTab('details');
    showPane();
}

function parseJsonInput(input: HTMLTextAreaElement, label: string): { ok: true; value: unknown } | { ok: false; error: string } {
    const raw = input.value.trim();
    if (!raw) return { ok: true, value: {} };
    try {
        return { ok: true, value: JSON.parse(raw) };
    } catch {
        return { ok: false, error: `${label} must be valid JSON.` };
    }
}

async function saveDetails() {
    if (!selectedUserId) {
        setStatus(detailsFeedback, 'Select a user first.', true);
        return;
    }

    const settingsParsed = parseJsonInput(settingsJsonInput, 'Settings');
    if (!settingsParsed.ok) return setStatus(detailsFeedback, settingsParsed.error, true);
    const statsParsed = parseJsonInput(statsJsonInput, 'Player stats');
    if (!statsParsed.ok) return setStatus(detailsFeedback, statsParsed.error, true);
    const heartsParsed = parseJsonInput(heartsJsonInput, 'Hearts');
    if (!heartsParsed.ok) return setStatus(detailsFeedback, heartsParsed.error, true);
    const appearanceParsed = parseJsonInput(appearanceJsonInput, 'Character appearance');
    if (!appearanceParsed.ok) return setStatus(detailsFeedback, appearanceParsed.error, true);
    const advancementsParsed = parseJsonInput(advancementsJsonInput, 'Advancements');
    if (!advancementsParsed.ok) return setStatus(detailsFeedback, advancementsParsed.error, true);
    const inventoryParsed = parseJsonInput(inventoryJsonInput, 'Inventory');
    if (!inventoryParsed.ok) return setStatus(detailsFeedback, inventoryParsed.error, true);
    const glimmerbowlParsed = parseJsonInput(glimmerbowlJsonInput, 'Glimmerbowl');
    if (!glimmerbowlParsed.ok) return setStatus(detailsFeedback, glimmerbowlParsed.error, true);

    const moneyValue = Number.parseInt(moneyInput.value.trim(), 10);
    const permissions = permissionsDetailInput.value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

    const updates: Record<string, unknown> = {
        username: usernameInput.value.trim() || null,
        email: emailInput.value.trim() || null,
        status: statusInput.value.trim() || null,
        permissions,
        money: Number.isFinite(moneyValue) ? moneyValue : 0,
        lastLocationId: locationInput.value.trim() || null,
        bannedUntil: bannedUntilInput.value.trim() || null,
        mutedUntil: mutedUntilInput.value.trim() || null,
        isVerified: verifiedCheckbox.checked,
        isDemo: demoCheckbox.checked,
        settings: settingsParsed.value,
        playerStats: statsParsed.value,
        hearts: heartsParsed.value,
        characterAppearance: appearanceParsed.value,
        advancements: advancementsParsed.value,
        inventory: inventoryParsed.value,
        glimmerbowl: glimmerbowlParsed.value
    };

    setStatus(detailsFeedback, 'Saving...');
    const res = await fetch(`/api/admin/users/${selectedUserId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
    });
    const payload = await res.json() as PlayerDetailResponse & ApiMessageResponse;
    if (!res.ok) {
        setStatus(detailsFeedback, payload.message || 'Failed to save details.', true);
        return;
    }

    if (payload.user) {
        selectedUser = payload.user;
        selectedUserId = payload.user.id;
        fillDetailsForm(payload.user);
    }
    setStatus(detailsFeedback, payload.message || 'Saved.');
    await loadPlayers();
}

async function runAction(action: string) {
    if (!selectedUserId || !selectedUser) {
        setStatus(actionsFeedback, 'Select a user first.', true);
        return;
    }

    const payload: Record<string, unknown> = { action };
    if (action === 'tempban' || action === 'tempmute') {
        payload.duration = durationInput.value.trim();
    }
    if (action === 'send') {
        payload.locationId = sendLocationInput.value;
    }
    if (action === 'wipe') {
        payload.confirmWipe = wipeConfirmInput.value.trim();
    }

    const needsConfirm = action === 'ban' || action === 'tempban' || action === 'mute' || action === 'tempmute' || action === 'wipe';
    if (needsConfirm) {
        const approved = window.confirm(`Run '${action}' for ${selectedUser.username || selectedUser.id}?`);
        if (!approved) return;
    }

    setStatus(actionsFeedback, `Running ${action}...`);
    const res = await fetch(`/api/admin/users/${selectedUserId}/actions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json() as ApiMessageResponse;
    if (!res.ok) {
        setStatus(actionsFeedback, data.message || `Failed to run ${action}.`, true);
        return;
    }
    setStatus(actionsFeedback, data.message || `${action} completed.`);

    await loadPlayers();
    await loadSelectedUser(selectedUserId);
    setActiveTab('management');
}

playersList.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest('[data-user-id]') as HTMLElement | null;
    if (!card) return;
    const userId = card.dataset.userId;
    if (!userId) return;
    await loadSelectedUser(userId);
});

filtersForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    page = 1;
    await loadPlayers();
});

clearFiltersBtn.addEventListener('click', async () => {
    resetFilterInputs();
    page = 1;
    await loadPlayers();
});

prevPageBtn.addEventListener('click', async () => {
    if (page <= 1) return;
    page -= 1;
    await loadPlayers();
});

nextPageBtn.addEventListener('click', async () => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page >= totalPages) return;
    page += 1;
    await loadPlayers();
});

detailsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveDetails();
});

detailsTabBtn.addEventListener('click', () => setActiveTab('details'));
managementTabBtn.addEventListener('click', () => setActiveTab('management'));

closePaneBtn.addEventListener('click', () => hidePane());
paneBackdrop.addEventListener('click', () => hidePane());
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePane();
});

banBtn.addEventListener('click', async () => runAction('ban'));
tempbanBtn.addEventListener('click', async () => runAction('tempban'));
muteBtn.addEventListener('click', async () => runAction('mute'));
tempmuteBtn.addEventListener('click', async () => runAction('tempmute'));
unbanBtn.addEventListener('click', async () => runAction('unban'));
unmuteBtn.addEventListener('click', async () => runAction('unmute'));
sendBtn.addEventListener('click', async () => runAction('send'));
wipeBtn.addEventListener('click', async () => runAction('wipe'));

logoutBtn.addEventListener('click', async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
        clearAccountUserBootstrapCache();
        window.location.href = '/login';
    }
});

async function init() {
    resetDetailsForm();
    resetFilterInputs();
    const authRes = await fetch('/api/auth/me', { credentials: 'include' });
    if (!authRes.ok) {
        clearAccountUserBootstrapCache();
        window.location.href = '/login';
        return;
    }

    const authPayload = await authRes.json() as { user?: AdminUser };
    const permissions = Array.isArray(authPayload.user?.permissions) ? authPayload.user.permissions : [];
    if (!permissions.includes('game.admin')) {
        showForbidden();
        return;
    }

    await loadLocations();
    await loadPlayers();
}

void init().catch(() => {
    showForbidden();
});

export {};
