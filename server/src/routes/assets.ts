import express from 'express';

const router = express.Router();

const DEFAULT_ASSET_VERSION = 'v1.1';
const SERVER_BOOT_TIMESTAMP = new Date().toISOString();

function resolveAssetVersion(): string {
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
