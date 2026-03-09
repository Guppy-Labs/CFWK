const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(workspaceRoot, 'client', 'public');
const outputPath = path.join(publicRoot, 'game-assets.manifest.json');

const ROOT_PREFIXES = ['assets', 'audio', 'dialogue', 'items', 'maps', 'ui', 'packs'];
const ALLOWED_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.json', '.tmj', '.tsx', '.xml', '.mp3', '.m4a', '.ogg', '.wav'
]);

function toWebPath(absolutePath) {
    const relative = path.relative(publicRoot, absolutePath).split(path.sep).join('/');
    return `/${relative}`;
}

function collectFiles(dirPath, files) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const absolutePath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            collectFiles(absolutePath, files);
            continue;
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(extension)) {
            continue;
        }

        files.push(absolutePath);
    }
}

function main() {
    const allFiles = [];

    for (const prefix of ROOT_PREFIXES) {
        const absolutePrefix = path.join(publicRoot, prefix);
        if (!fs.existsSync(absolutePrefix)) continue;
        collectFiles(absolutePrefix, allFiles);
    }

    const assets = allFiles
        .map(toWebPath)
        .sort((a, b) => a.localeCompare(b));

    const payload = {
        generatedAt: new Date().toISOString(),
        totalAssets: assets.length,
        assets
    };

    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(`[assets-manifest] Wrote ${assets.length} assets to ${outputPath}`);
}

main();
