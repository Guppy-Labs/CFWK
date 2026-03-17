import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

const DEFAULT_ASSET_VERSION = 'v1.1';
const SERVER_BOOT_TIMESTAMP = new Date().toISOString();
const ASSET_VERSION_FILE_CANDIDATES = [
    path.resolve(process.cwd(), 'asset-version.json'),
    path.resolve(process.cwd(), '..', 'asset-version.json'),
    path.resolve(__dirname, '..', '..', '..', 'asset-version.json')
];

function resolveAssetVersionFilePath(): string | null {
    for (const candidate of ASSET_VERSION_FILE_CANDIDATES) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function readAssetVersionFile(): string | null {
    try {
        const filePath = resolveAssetVersionFilePath();
        if (!filePath) return null;
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as { version?: unknown };
        if (typeof parsed.version !== 'string') return null;
        const trimmed = parsed.version.trim();
        return trimmed.length > 0 ? trimmed : null;
    } catch {
        return null;
    }
}

function resolveAssetVersion(): string {
    const fileVersion = readAssetVersionFile();
    if (fileVersion) {
        return fileVersion;
    }

    const envVersion = process.env.ASSET_VERSION?.trim();
    if (envVersion && envVersion.length > 0) {
        return envVersion;
    }

    const gitSha = process.env.GIT_COMMIT_SHA?.trim();
    if (gitSha && gitSha.length > 0) {
        return gitSha;
    }

    const appVersion = process.env.npm_package_version?.trim();
    if (appVersion && appVersion.length > 0) {
        return appVersion;
    }

    return DEFAULT_ASSET_VERSION;
}

router.get('/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json({
        version: resolveAssetVersion(),
        generatedAt: SERVER_BOOT_TIMESTAMP
    });
});

export default router;
