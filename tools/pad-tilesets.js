#!/usr/bin/env node
/*
 * Tileset padding service
 *
 * Extrudes tile edges by PAD pixels for all tilesets referenced by TMJ files,
 * and writes results to public/maps/Tilesets_padded (mirroring Tilesets layout).
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const MAPS_DIR = path.join(ROOT, 'client', 'public', 'maps');
const OUTPUT_ROOT = path.join(MAPS_DIR, 'Tilesets_padded');
const PAD = 2;

function listTmjFiles() {
    return fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith('.tmj'));
}

function readJson(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function getTilesetConfig(tileset) {
    if (!tileset || !tileset.image) return null;

    return {
        name: tileset.name,
        image: tileset.image,
        tileWidth: tileset.tilewidth,
        tileHeight: tileset.tileheight,
        spacing: tileset.spacing || 0,
        margin: tileset.margin || 0,
        columns: tileset.columns || null,
        tilecount: tileset.tilecount || null,
        imagewidth: tileset.imagewidth || null,
        imageheight: tileset.imageheight || null
    };
}

function resolveTilesetPath(imagePath) {
    return path.join(MAPS_DIR, imagePath);
}

function getOutputPath(imagePath) {
    if (!imagePath.startsWith('Tilesets/')) {
        return null;
    }
    const relative = imagePath.replace('Tilesets/', 'Tilesets_padded/');
    return path.join(MAPS_DIR, relative);
}

function computeColumns(config, metadata) {
    if (config.columns) return config.columns;
    const imageWidth = metadata.width || config.imagewidth;
    if (!imageWidth) return null;

    const effective = imageWidth - config.margin * 2 + config.spacing;
    const step = config.tileWidth + config.spacing;
    return Math.floor(effective / step);
}

function computeRows(config, metadata, columns) {
    if (config.tilecount) return Math.ceil(config.tilecount / columns);
    const imageHeight = metadata.height || config.imageheight;
    if (!imageHeight) return null;

    const effective = imageHeight - config.margin * 2 + config.spacing;
    const step = config.tileHeight + config.spacing;
    return Math.floor(effective / step);
}

async function padTileset(config) {
    if (!config.image.startsWith('Tilesets/')) {
        console.log(`[pad-tilesets] Skipping non-Tilesets image: ${config.image}`);
        return;
    }

    const inputPath = resolveTilesetPath(config.image);
    const outputPath = getOutputPath(config.image);
    if (!outputPath) return;

    if (!fs.existsSync(inputPath)) {
        console.warn(`[pad-tilesets] Missing tileset image: ${inputPath}`);
        return;
    }

    const input = sharp(inputPath);
    const metadata = await input.metadata();

    const columns = computeColumns(config, metadata);
    const rows = computeRows(config, metadata, columns);

    if (!columns || !rows) {
        console.warn(`[pad-tilesets] Could not compute grid for ${config.image}`);
        return;
    }

    const tileCount = config.tilecount || columns * rows;
    const newMargin = config.margin + PAD;
    const newSpacing = config.spacing + PAD * 2;

    const outputWidth = newMargin * 2 + columns * config.tileWidth + (columns - 1) * newSpacing;
    const outputHeight = newMargin * 2 + rows * config.tileHeight + (rows - 1) * newSpacing;

    const base = sharp({
        create: {
            width: outputWidth,
            height: outputHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    });

    const composites = [];

    for (let i = 0; i < tileCount; i++) {
        const col = i % columns;
        const row = Math.floor(i / columns);

        const srcX = config.margin + col * (config.tileWidth + config.spacing);
        const srcY = config.margin + row * (config.tileHeight + config.spacing);

        const paddedTile = await input
            .clone()
            .extract({ left: srcX, top: srcY, width: config.tileWidth, height: config.tileHeight })
            .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' })
            .png()
            .toBuffer();

        const destX = newMargin + col * (config.tileWidth + newSpacing) - PAD;
        const destY = newMargin + row * (config.tileHeight + newSpacing) - PAD;

        composites.push({ input: paddedTile, left: destX, top: destY });
    }

    ensureDir(path.dirname(outputPath));
    await base.composite(composites).png().toFile(outputPath);

    console.log(`[pad-tilesets] Wrote ${outputPath}`);
}

async function run() {
    const tmjFiles = listTmjFiles();
    const tilesetMap = new Map();

    tmjFiles.forEach((file) => {
        const data = readJson(path.join(MAPS_DIR, file));
        const tilesets = data.tilesets || [];

        tilesets.forEach((tileset) => {
            const config = getTilesetConfig(tileset);
            if (!config) return;

            if (!tilesetMap.has(config.image)) {
                tilesetMap.set(config.image, config);
            }
        });
    });

    ensureDir(OUTPUT_ROOT);

    for (const config of tilesetMap.values()) {
        await padTileset(config);
    }

    console.log('[pad-tilesets] Done.');
}

run().catch((err) => {
    console.error('[pad-tilesets] Failed:', err);
    process.exit(1);
});
