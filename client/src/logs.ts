type CommandLogRow = {
    timestamp?: string;
    playerId?: string;
    playerUsername?: string;
    command?: string;
    args?: string[];
    success?: boolean;
    resultMessage?: string;
};

type LogsApiResponse = {
    total: number;
    entries: CommandLogRow[];
};

const metaEl = document.getElementById('meta') as HTMLParagraphElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const tableEl = document.getElementById('logs-table') as HTMLTableElement;
const bodyEl = document.getElementById('logs-body') as HTMLTableSectionElement;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderRows(rows: CommandLogRow[]) {
    const html = rows.map((row) => {
        const timestamp = row.timestamp || '';
        const username = row.playerUsername || 'unknown';
        const playerId = row.playerId || 'unknown';
        const command = row.command || '';
        const args = Array.isArray(row.args) ? row.args.join(' ') : '';
        const success = row.success === true;
        const resultMessage = row.resultMessage || '';

        return `
            <tr>
                <td>${escapeHtml(timestamp)}</td>
                <td>${escapeHtml(username)}</td>
                <td title="${escapeHtml(playerId)}">${escapeHtml(playerId)}</td>
                <td><code>/${escapeHtml(command)} ${escapeHtml(args)}</code></td>
                <td class="${success ? 'ok' : 'fail'}">${success ? 'PASS' : 'FAIL'}</td>
                <td>${escapeHtml(resultMessage)}</td>
            </tr>
        `;
    }).join('');

    bodyEl.innerHTML = html;
}

async function ensureLoggedIn() {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) {
        window.location.href = '/login';
        throw new Error('not-authenticated');
    }
}

async function loadLogs() {
    await ensureLoggedIn();

    const res = await fetch('/api/logs/entries?limit=1000', {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Accept': 'application/json'
        }
    });

    if (res.status === 403) {
        statusEl.textContent = 'Forbidden: This page is only available to game admins.';
        metaEl.textContent = 'Access denied';
        return;
    }

    if (!res.ok) {
        statusEl.textContent = 'Failed to load command logs.';
        metaEl.textContent = 'Error';
        return;
    }

    const payload = await res.json() as LogsApiResponse;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];

    if (entries.length === 0) {
        statusEl.textContent = 'No command attempts logged yet.';
        metaEl.textContent = '0 entries';
        return;
    }

    renderRows(entries);
    tableEl.classList.remove('hidden');
    statusEl.classList.add('hidden');
    metaEl.textContent = `Showing latest ${entries.length} command attempts`;
}

void loadLogs().catch(() => {
    if (!statusEl.textContent || statusEl.textContent.includes('Loading')) {
        statusEl.textContent = 'Failed to load command logs.';
        metaEl.textContent = 'Error';
    }
});
