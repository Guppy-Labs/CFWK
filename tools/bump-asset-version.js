const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const assetVersionPath = path.join(workspaceRoot, 'asset-version.json');

function normalizeVersion(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed;
}

function bumpPatch(version) {
    const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]) + 1;
    return `v${major}.${minor}.${patch}`;
}

function fallbackTimestampVersion() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const y = now.getUTCFullYear();
    const m = pad(now.getUTCMonth() + 1);
    const d = pad(now.getUTCDate());
    const hh = pad(now.getUTCHours());
    const mm = pad(now.getUTCMinutes());
    const ss = pad(now.getUTCSeconds());
    return `v${y}.${m}.${d}-${hh}${mm}${ss}`;
}

function readCurrentVersion() {
    if (!fs.existsSync(assetVersionPath)) return null;
    try {
        const raw = fs.readFileSync(assetVersionPath, 'utf8');
        const payload = JSON.parse(raw);
        return normalizeVersion(payload?.version);
    } catch {
        return null;
    }
}

function writeVersion(version) {
    const payload = {
        version
    };
    fs.writeFileSync(assetVersionPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
    const currentVersion = readCurrentVersion();
    const nextVersion = (currentVersion && bumpPatch(currentVersion)) || fallbackTimestampVersion();
    writeVersion(nextVersion);
    console.log(`[asset-version] ${currentVersion || 'none'} -> ${nextVersion}`);
}

main();
