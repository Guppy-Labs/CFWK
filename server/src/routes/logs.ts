import express from 'express';
import fs from 'fs';
import path from 'path';
import { isGameAdmin } from './_adminAuth';

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

const router = express.Router();
const commandLogPath = path.resolve(__dirname, '..', '..', 'logs', 'commands.log');

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function readCommandLogs(limit = 1000): CommandLogRow[] {
    if (!fs.existsSync(commandLogPath)) return [];

    const raw = fs.readFileSync(commandLogPath, 'utf8');
    const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const rows: CommandLogRow[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        try {
            const parsed = JSON.parse(line) as CommandLogRow;
            rows.push(parsed);
        } catch {
            rows.push({
                timestamp: new Date().toISOString(),
                playerId: 'unknown',
                playerUsername: 'unknown',
                command: 'parse-error',
                args: [],
                success: false,
                resultMessage: `Invalid log line: ${line.slice(0, 140)}`
            });
        }

        if (rows.length >= limit) break;
    }

    return rows;
}

router.get('/', async (req, res) => {
    try {
        const allowed = await isGameAdmin(req);
        if (!allowed) {
            return res.status(403).send('Forbidden');
        }

        const rows = readCommandLogs(1000);
        const tableRows = rows.map((row) => {
            const args = Array.isArray(row.args) ? row.args.join(' ') : '';
            const timestamp = row.timestamp || '';
            const username = row.playerUsername || 'unknown';
            const playerId = row.playerId || 'unknown';
            const command = row.command || '';
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

        const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Command Logs</title>
    <style>
        body { font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #0b1020; color: #e6eaf2; }
        .wrap { max-width: 1400px; margin: 24px auto; padding: 0 16px; }
        h1 { margin: 0 0 8px; font-size: 24px; }
        .meta { margin: 0 0 16px; color: #aab4c8; font-size: 14px; }
        .card { border: 1px solid #263248; border-radius: 10px; overflow: hidden; background: #121a2b; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { padding: 10px 12px; border-bottom: 1px solid #1f2a40; vertical-align: top; }
        th { position: sticky; top: 0; background: #1a2440; text-align: left; z-index: 1; }
        tr:hover td { background: #16213a; }
        code { color: #d2e3ff; white-space: pre-wrap; word-break: break-word; }
        .ok { color: #4ade80; font-weight: 600; }
        .fail { color: #f87171; font-weight: 600; }
        td:nth-child(1) { white-space: nowrap; }
        td:nth-child(3) { max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        td:nth-child(4), td:nth-child(6) { max-width: 460px; word-break: break-word; }
        .empty { padding: 14px; color: #9aa8c3; }
    </style>
</head>
<body>
    <div class="wrap">
        <h1>Command Attempt Logs</h1>
        <p class="meta">Showing latest ${rows.length} entries from ${escapeHtml(commandLogPath)}</p>
        <div class="card">
            ${rows.length === 0 ? '<div class="empty">No command attempts logged yet.</div>' : `
                <table>
                    <thead>
                        <tr>
                            <th>Timestamp</th>
                            <th>Player</th>
                            <th>Player ID</th>
                            <th>Command</th>
                            <th>Status</th>
                            <th>Result</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            `}
        </div>
    </div>
</body>
</html>`;

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        return res.status(200).send(html);
    } catch (error) {
        console.error('[LogsRoute] Failed to render command logs page:', error);
        return res.status(500).send('Failed to load logs page.');
    }
});

router.get('/entries', async (req, res) => {
    try {
        const allowed = await isGameAdmin(req);
        if (!allowed) {
            return res.status(403).json({ error: 'forbidden' });
        }

        const requestedLimitRaw = req.query.limit;
        const requestedLimit = typeof requestedLimitRaw === 'string' ? Number.parseInt(requestedLimitRaw, 10) : 300;
        const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(2000, requestedLimit)) : 300;

        const rows = readCommandLogs(limit);
        const payload: LogsApiResponse = {
            total: rows.length,
            entries: rows
        };

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        return res.status(200).json(payload);
    } catch (error) {
        console.error('[LogsRoute] Failed to serve command log entries:', error);
        return res.status(500).json({ error: 'failed_to_load_logs' });
    }
});

export default router;
