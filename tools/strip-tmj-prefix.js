#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAPS_DIR = path.join(ROOT, 'client', 'public', 'maps');
const ENV_PATH = path.join(ROOT, '.env');
const ENV_KEY = 'TMJ_PREFIX_TO_STRIP';
const SECONDARY_FROM = '"props\\/';
const SECONDARY_TO = '"Props\\/';

function readEnvValue(filePath, key) {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const idx = line.indexOf('=');
        if (idx <= 0) continue;

        const envKey = line.slice(0, idx).trim();
        if (envKey !== key) continue;

        let value = line.slice(idx + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        return value;
    }

    return null;
}

function listTmjFilesRecursive(dirPath) {
    const files = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...listTmjFilesRecursive(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.tmj')) {
            files.push(fullPath);
        }
    }

    return files;
}

function replaceAllWithCount(source, from, to) {
    if (!source.includes(from)) {
        return { text: source, occurrences: 0 };
    }

    const occurrences = source.split(from).length - 1;
    const text = source.split(from).join(to);
    return { text, occurrences };
}

function normalizeTmjFile(filePath, prefix) {
    const before = fs.readFileSync(filePath, 'utf8');
    const prefixResult = replaceAllWithCount(before, prefix, '');
    const propsResult = replaceAllWithCount(prefixResult.text, SECONDARY_FROM, SECONDARY_TO);
    const totalOccurrences = prefixResult.occurrences + propsResult.occurrences;

    if (totalOccurrences === 0) {
        return { changed: false, occurrences: 0 };
    }

    fs.writeFileSync(filePath, propsResult.text, 'utf8');

    return {
        changed: true,
        occurrences: totalOccurrences,
        prefixOccurrences: prefixResult.occurrences,
        propsOccurrences: propsResult.occurrences
    };
}

function run() {
    const prefix = readEnvValue(ENV_PATH, ENV_KEY);
    if (!prefix) {
        console.error(`[strip-tmj-prefix] Missing ${ENV_KEY} in ${ENV_PATH}`);
        process.exit(1);
    }

    if (!fs.existsSync(MAPS_DIR)) {
        console.error(`[strip-tmj-prefix] Maps directory not found: ${MAPS_DIR}`);
        process.exit(1);
    }

    const tmjFiles = listTmjFilesRecursive(MAPS_DIR);
    let touchedFiles = 0;
    let totalReplacements = 0;

    tmjFiles.forEach((filePath) => {
        const result = normalizeTmjFile(filePath, prefix);
        if (!result.changed) return;

        touchedFiles += 1;
        totalReplacements += result.occurrences;
        const relativePath = path.relative(ROOT, filePath).replace(/\\/g, '/');
        console.log(
            `[strip-tmj-prefix] Updated ${relativePath} ` +
            `(prefix: ${result.prefixOccurrences}, props-case: ${result.propsOccurrences}, total: ${result.occurrences})`
        );
    });

    console.log(`[strip-tmj-prefix] Done. ${totalReplacements} replacements across ${touchedFiles} file(s).`);
}

run();
