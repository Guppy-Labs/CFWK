import { clearAccountUserBootstrapCache } from './utils/accountBootstrapCache';

type AnimState = 'idle' | 'walk' | 'attack' | 'death';

type TrimMetaAnimation = {
    frameWidth: number;
    frameHeight: number;
    frames: number;
    file: string;
};

type TrimMeta = {
    animations: Partial<Record<AnimState, TrimMetaAnimation>>;
};

type NpcKindDef = {
    kind: string;
    name: string;
    trimMetadataPath?: string;
    texturePaths: Partial<Record<AnimState, string>>;
    frameWidth: number;
    frameHeight: number;
    frameCounts: Partial<Record<AnimState, number>>;
    frameRates: Partial<Record<AnimState, number>>;
    directionalMode: 'octant-rows' | 'horizontal-only';
    // Optional world-anchor reference drawn under the sprite. Used for fixed
    // map anchors (e.g. a 2x2 chest tile footprint) where there's no natural
    // idle sheet to align against.
    anchorGuide?: {
        tileCountsX: number;
        tileCountsY: number;
        tilePx: number;
    };
    // When present, the "Copy Config" button emits this constant block instead
    // of the default centerOffset*ByState block, using the current (x, y) of
    // the selected overlay state.
    copyFormat?: {
        xConstName: string;
        yConstName: string;
    };
};

const NPC_KINDS: NpcKindDef[] = [
    {
        kind: 'gremlin',
        name: 'Gremlin',
        trimMetadataPath: '/assets/npc/gremlin/variant1/trim.meta.json',
        texturePaths: {
            idle: '/assets/npc/gremlin/variant1/idle.trim.png',
            walk: '/assets/npc/gremlin/variant1/walk.trim.png',
            attack: '/assets/npc/gremlin/variant1/attack.trim.png',
            death: '/assets/npc/gremlin/variant1/death.trim.png'
        },
        frameWidth: 154,
        frameHeight: 88,
        frameCounts: { idle: 9, walk: 8, attack: 16, death: 12 },
        frameRates: { idle: 8, walk: 12, attack: 20, death: 12 },
        directionalMode: 'horizontal-only'
    },
    {
        kind: 'evil_tim',
        name: 'Evil Tim',
        texturePaths: {
            idle: '/assets/npc/evil_tim/idle.png',
            walk: '/assets/npc/evil_tim/walk.png'
        },
        frameWidth: 16,
        frameHeight: 32,
        frameCounts: { idle: 4, walk: 4 },
        frameRates: { idle: 6, walk: 10 },
        directionalMode: 'octant-rows'
    },
    {
        // Single-animation art pinned to a fixed map anchor (2x2 tile footprint).
        // Idle/overlay both point at the same spritesheet: idle shows the closed
        // chest (frame 0) and overlay plays frames 0..10 of the open animation.
        // The anchorGuide draws the 2x2 world footprint at the canvas crosshair
        // so the tuner can dial in a world-offset that keeps the animation art
        // visually centered on the chest tiles.
        kind: 'glimmeringchest',
        name: 'Glimmering Chest',
        texturePaths: {
            idle: '/assets/animations/chest-open.png',
            attack: '/assets/animations/chest-open.png'
        },
        frameWidth: 128,
        frameHeight: 128,
        frameCounts: { idle: 1, attack: 11 },
        frameRates: { idle: 1, attack: 14 },
        directionalMode: 'horizontal-only',
        anchorGuide: {
            tileCountsX: 2,
            tileCountsY: 2,
            tilePx: 32
        },
        copyFormat: {
            xConstName: 'QUEST_CHEST_ANIM_OFFSET_X',
            yConstName: 'QUEST_CHEST_ANIM_OFFSET_Y'
        }
    }
];

// DOM refs
const forbiddenBox = document.getElementById('forbidden') as HTMLDivElement;
const appLayout = document.getElementById('app-layout') as HTMLElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const kindSelect = document.getElementById('kind-select') as HTMLSelectElement;
const overlaySelect = document.getElementById('overlay-select') as HTMLSelectElement;
const opacityRange = document.getElementById('opacity-range') as HTMLInputElement;
const zoomSelect = document.getElementById('zoom-select') as HTMLSelectElement;
const canvas = document.getElementById('tuner-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const offsetXInput = document.getElementById('offset-x-input') as HTMLInputElement;
const offsetYInput = document.getElementById('offset-y-input') as HTMLInputElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const copyFeedback = document.getElementById('copy-feedback') as HTMLSpanElement;
const playPauseBtn = document.getElementById('play-pause-btn') as HTMLButtonElement;
const idleFrameRange = document.getElementById('idle-frame-range') as HTMLInputElement;
const overlayFrameRange = document.getElementById('overlay-frame-range') as HTMLInputElement;
const idleFrameLabel = document.getElementById('idle-frame-label') as HTMLSpanElement;
const overlayFrameLabel = document.getElementById('overlay-frame-label') as HTMLSpanElement;

// State
let currentKind: NpcKindDef = NPC_KINDS[0];
let sheetImages: Partial<Record<AnimState, HTMLImageElement>> = {};
let frameSizes: Partial<Record<AnimState, { w: number; h: number }>> = {};
let overlayState: AnimState = 'attack';
let offsetX = 0;
let offsetY = 0;
let zoom = 4;
let overlayOpacity = 0.55;
let idleFrame = 0;
let overlayFrame = 0;
let lastIdleFrameTime = 0;
let lastOverlayFrameTime = 0;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartOffsetX = 0;
let dragStartOffsetY = 0;
let animHandle = 0;
let playing = true;
let canvasLogicalW = 200;
let canvasLogicalH = 200;
const allOffsets: Record<string, Partial<Record<AnimState, { x: number; y: number }>>> = {};

function showForbidden() {
    forbiddenBox.classList.add('show');
    appLayout.style.display = 'none';
}

function populateKindSelect() {
    kindSelect.innerHTML = '';
    for (const def of NPC_KINDS) {
        const opt = document.createElement('option');
        opt.value = def.kind;
        opt.textContent = def.name;
        kindSelect.appendChild(opt);
    }
}

function populateOverlaySelect() {
    overlaySelect.innerHTML = '';
    const states: AnimState[] = ['walk', 'attack', 'death'];
    for (const state of states) {
        if (!currentKind.texturePaths[state] || !currentKind.frameCounts[state]) continue;
        const opt = document.createElement('option');
        opt.value = state;
        opt.textContent = state;
        overlaySelect.appendChild(opt);
    }
    if (overlaySelect.querySelector(`option[value="${overlayState}"]`)) {
        overlaySelect.value = overlayState;
    } else if (overlaySelect.options.length > 0) {
        overlayState = overlaySelect.options[0].value as AnimState;
        overlaySelect.value = overlayState;
    }
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src + '?t=' + Date.now();
    });
}

async function loadAssets() {
    cancelAnimationFrame(animHandle);
    sheetImages = {};
    frameSizes = {};
    idleFrame = 0;
    overlayFrame = 0;

    if (currentKind.trimMetadataPath) {
        try {
            const res = await fetch(currentKind.trimMetadataPath + '?t=' + Date.now());
            if (res.ok) {
                const meta = (await res.json()) as TrimMeta;
                if (meta.animations) {
                    for (const state of ['idle', 'walk', 'attack', 'death'] as AnimState[]) {
                        const anim = meta.animations[state];
                        if (anim) {
                            frameSizes[state] = { w: anim.frameWidth, h: anim.frameHeight };
                            if (anim.frames) {
                                currentKind.frameCounts[state] = anim.frames;
                            }
                        }
                    }
                }
            }
        } catch { /* use defaults */ }
    }

    for (const state of ['idle', 'walk', 'attack', 'death'] as AnimState[]) {
        if (!frameSizes[state]) {
            frameSizes[state] = { w: currentKind.frameWidth, h: currentKind.frameHeight };
        }
    }

    const loadPromises: Promise<void>[] = [];
    for (const state of ['idle', 'walk', 'attack', 'death'] as AnimState[]) {
        const path = currentKind.texturePaths[state];
        if (!path) continue;
        loadPromises.push(
            loadImage(path).then((img) => { sheetImages[state] = img; }).catch(() => {})
        );
    }
    await Promise.all(loadPromises);

    recomputeCanvasSize();
    syncScrubberRanges();
    restoreOffsets();
    startRenderLoop();
}

function recomputeCanvasSize() {
    const padding = 16;
    let maxFrameW = 0;
    let maxFrameH = 0;
    for (const state of ['idle', 'walk', 'attack', 'death'] as AnimState[]) {
        const size = frameSizes[state];
        if (size) {
            maxFrameW = Math.max(maxFrameW, size.w);
            maxFrameH = Math.max(maxFrameH, size.h);
        }
    }
    canvasLogicalW = maxFrameW * 2 + padding * 2;
    canvasLogicalH = maxFrameH * 2 + padding * 2;
}

function syncScrubberRanges() {
    const idleCount = Math.max(1, currentKind.frameCounts['idle'] || 1);
    const overlayCount = Math.max(1, currentKind.frameCounts[overlayState] || 1);
    idleFrameRange.max = String(idleCount - 1);
    overlayFrameRange.max = String(overlayCount - 1);
    idleFrameRange.value = String(idleFrame);
    overlayFrameRange.value = String(overlayFrame);
    idleFrameLabel.textContent = `${idleFrame}/${idleCount - 1}`;
    overlayFrameLabel.textContent = `${overlayFrame}/${overlayCount - 1}`;
}

function saveOffset() {
    if (!allOffsets[currentKind.kind]) {
        allOffsets[currentKind.kind] = {};
    }
    allOffsets[currentKind.kind][overlayState] = { x: offsetX, y: offsetY };
}

function restoreOffsets() {
    const saved = allOffsets[currentKind.kind]?.[overlayState];
    if (saved) {
        offsetX = saved.x;
        offsetY = saved.y;
    } else {
        offsetX = 0;
        offsetY = 0;
    }
    syncInputsFromState();
}

function syncInputsFromState() {
    offsetXInput.value = String(offsetX);
    offsetYInput.value = String(offsetY);
}

function startRenderLoop() {
    cancelAnimationFrame(animHandle);
    lastIdleFrameTime = performance.now();
    lastOverlayFrameTime = performance.now();
    idleFrame = 0;
    overlayFrame = 0;

    function loop(now: number) {
        renderFrame(now);
        animHandle = requestAnimationFrame(loop);
    }
    animHandle = requestAnimationFrame(loop);
}

function renderFrame(now: number) {
    const idleSheet = sheetImages['idle'];
    const overlaySheet = sheetImages[overlayState];
    if (!idleSheet) return;

    const idleSize = frameSizes['idle'] || { w: currentKind.frameWidth, h: currentKind.frameHeight };
    const overlaySize = frameSizes[overlayState] || { w: currentKind.frameWidth, h: currentKind.frameHeight };
    const idleCount = currentKind.frameCounts['idle'] || 1;
    const overlayCount = currentKind.frameCounts[overlayState] || 1;
    const idleRate = currentKind.frameRates['idle'] || 8;
    const overlayRate = currentKind.frameRates[overlayState] || 12;

    if (playing) {
        const idleInterval = 1000 / idleRate;
        const overlayInterval = 1000 / overlayRate;

        if (now - lastIdleFrameTime >= idleInterval) {
            idleFrame = (idleFrame + 1) % idleCount;
            lastIdleFrameTime = now;
        }
        if (overlaySheet && now - lastOverlayFrameTime >= overlayInterval) {
            overlayFrame = (overlayFrame + 1) % overlayCount;
            lastOverlayFrameTime = now;
        }
    }

    idleFrameRange.value = String(idleFrame);
    overlayFrameRange.value = String(overlayFrame);
    idleFrameLabel.textContent = `${idleFrame}/${idleCount - 1}`;
    overlayFrameLabel.textContent = `${overlayFrame}/${overlayCount - 1}`;

    const canvasW = canvasLogicalW * zoom;
    const canvasH = canvasLogicalH * zoom;
    if (canvas.width !== canvasW || canvas.height !== canvasH) {
        canvas.width = canvasW;
        canvas.height = canvasH;
    }

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvasW, canvasH);

    const centerLX = canvasLogicalW / 2;
    const centerLY = canvasLogicalH / 2;

    // Crosshair at center
    const crossPxX = centerLX * zoom;
    const crossPxY = centerLY * zoom;
    ctx.strokeStyle = 'rgba(255, 102, 170, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crossPxX, 0);
    ctx.lineTo(crossPxX, canvasH);
    ctx.moveTo(0, crossPxY);
    ctx.lineTo(canvasW, crossPxY);
    ctx.stroke();

    // Optional anchor guide: the world tile footprint the art must align with
    // (e.g. the 2x2 chest tiles). Drawn as a cyan grid centered on the crosshair.
    const anchorGuide = currentKind.anchorGuide;
    if (anchorGuide) {
        const gridW = anchorGuide.tileCountsX * anchorGuide.tilePx;
        const gridH = anchorGuide.tileCountsY * anchorGuide.tilePx;
        const gridLX = centerLX - gridW / 2;
        const gridLY = centerLY - gridH / 2;
        ctx.strokeStyle = 'rgba(102, 221, 255, 0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(gridLX * zoom, gridLY * zoom, gridW * zoom, gridH * zoom);
        ctx.strokeStyle = 'rgba(102, 221, 255, 0.45)';
        ctx.lineWidth = 1;
        for (let ix = 1; ix < anchorGuide.tileCountsX; ix += 1) {
            const gx = (gridLX + ix * anchorGuide.tilePx) * zoom;
            ctx.beginPath();
            ctx.moveTo(gx, gridLY * zoom);
            ctx.lineTo(gx, (gridLY + gridH) * zoom);
            ctx.stroke();
        }
        for (let iy = 1; iy < anchorGuide.tileCountsY; iy += 1) {
            const gy = (gridLY + iy * anchorGuide.tilePx) * zoom;
            ctx.beginPath();
            ctx.moveTo(gridLX * zoom, gy);
            ctx.lineTo((gridLX + gridW) * zoom, gy);
            ctx.stroke();
        }
    }

    // Idle frame centered
    const idleDrawX = centerLX - idleSize.w / 2;
    const idleDrawY = centerLY - idleSize.h / 2;
    ctx.globalAlpha = 1;
    const idleSx = idleFrame * idleSize.w;
    ctx.drawImage(
        idleSheet,
        idleSx, 0, idleSize.w, idleSize.h,
        idleDrawX * zoom, idleDrawY * zoom, idleSize.w * zoom, idleSize.h * zoom
    );

    // Overlay frame centered + offset
    if (overlaySheet) {
        ctx.globalAlpha = overlayOpacity;
        const overlaySx = overlayFrame * overlaySize.w;
        const overlayDrawX = centerLX - overlaySize.w / 2 + offsetX;
        const overlayDrawY = centerLY - overlaySize.h / 2 + offsetY;
        ctx.drawImage(
            overlaySheet,
            overlaySx, 0, overlaySize.w, overlaySize.h,
            overlayDrawX * zoom, overlayDrawY * zoom, overlaySize.w * zoom, overlaySize.h * zoom
        );
        ctx.globalAlpha = 1;
    }

    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText(`idle: ${idleSize.w}x${idleSize.h}  ${overlayState}: ${overlaySize.w}x${overlaySize.h}`, 6, 14);
    ctx.fillText(`offset: (${offsetX}, ${offsetY})`, 6, 28);
}

// --- Drag interaction ---
canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartOffsetX = offsetX;
    dragStartOffsetY = offsetY;
});

window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - dragStartX) / zoom;
    const dy = (e.clientY - dragStartY) / zoom;
    offsetX = Math.round(dragStartOffsetX + dx);
    offsetY = Math.round(dragStartOffsetY + dy);
    syncInputsFromState();
    saveOffset();
});

window.addEventListener('mouseup', () => {
    dragging = false;
});

// --- Play / Pause ---
function setPlaying(value: boolean) {
    playing = value;
    playPauseBtn.innerHTML = playing
        ? '<i class="fa-solid fa-pause"></i> Pause'
        : '<i class="fa-solid fa-play"></i> Play';
    if (playing) {
        lastIdleFrameTime = performance.now();
        lastOverlayFrameTime = performance.now();
    }
}

playPauseBtn.addEventListener('click', () => setPlaying(!playing));

idleFrameRange.addEventListener('input', () => {
    idleFrame = parseInt(idleFrameRange.value, 10) || 0;
    if (playing) setPlaying(false);
});

overlayFrameRange.addEventListener('input', () => {
    overlayFrame = parseInt(overlayFrameRange.value, 10) || 0;
    if (playing) setPlaying(false);
});

// --- Keyboard nudge ---
window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.key === ' ') {
        e.preventDefault();
        setPlaying(!playing);
        return;
    }

    const step = e.shiftKey ? 5 : 1;
    let handled = false;
    if (e.key === 'ArrowLeft') { offsetX -= step; handled = true; }
    else if (e.key === 'ArrowRight') { offsetX += step; handled = true; }
    else if (e.key === 'ArrowUp') { offsetY -= step; handled = true; }
    else if (e.key === 'ArrowDown') { offsetY += step; handled = true; }
    if (handled) {
        e.preventDefault();
        syncInputsFromState();
        saveOffset();
    }
});

// --- Inputs ---
offsetXInput.addEventListener('input', () => {
    offsetX = parseInt(offsetXInput.value, 10) || 0;
    saveOffset();
});

offsetYInput.addEventListener('input', () => {
    offsetY = parseInt(offsetYInput.value, 10) || 0;
    saveOffset();
});

opacityRange.addEventListener('input', () => {
    overlayOpacity = parseInt(opacityRange.value, 10) / 100;
});

zoomSelect.addEventListener('change', () => {
    zoom = parseInt(zoomSelect.value, 10) || 4;
});

resetBtn.addEventListener('click', () => {
    offsetX = 0;
    offsetY = 0;
    syncInputsFromState();
    saveOffset();
});

// --- Overlay select ---
overlaySelect.addEventListener('change', () => {
    saveOffset();
    overlayState = overlaySelect.value as AnimState;
    overlayFrame = 0;
    lastOverlayFrameTime = performance.now();
    syncScrubberRanges();
    restoreOffsets();
});

// --- Kind select ---
kindSelect.addEventListener('change', () => {
    saveOffset();
    const found = NPC_KINDS.find((k) => k.kind === kindSelect.value);
    if (found) {
        currentKind = found;
        populateOverlaySelect();
        void loadAssets();
    }
});

// --- Copy config ---
copyBtn.addEventListener('click', () => {
    saveOffset();
    const kindOffsets = allOffsets[currentKind.kind] || {};

    let text: string;
    if (currentKind.copyFormat) {
        // Single-constant format (e.g. for fixed map anchors like the chest).
        const saved = kindOffsets[overlayState];
        const x = saved?.x ?? 0;
        const y = saved?.y ?? 0;
        const { xConstName, yConstName } = currentKind.copyFormat;
        text = `const ${xConstName} = ${x};\nconst ${yConstName} = ${y};`;
    } else {
        const states: AnimState[] = ['walk', 'attack', 'death'];
        const xEntries: string[] = [];
        const yEntries: string[] = [];
        for (const state of states) {
            if (!currentKind.texturePaths[state]) continue;
            const saved = kindOffsets[state];
            const x = saved?.x ?? 0;
            const y = saved?.y ?? 0;
            xEntries.push(`${state}: ${x}`);
            yEntries.push(`${state}: ${y}`);
        }
        text = [
            `centerOffsetXByState: { ${xEntries.join(', ')} },`,
            `centerOffsetYByState: { ${yEntries.join(', ')} }`
        ].join('\n');
    }

    void navigator.clipboard.writeText(text).then(() => {
        copyFeedback.classList.add('show');
        setTimeout(() => copyFeedback.classList.remove('show'), 1500);
    });
});

// --- Logout ---
logoutBtn.addEventListener('click', async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
        clearAccountUserBootstrapCache();
        window.location.href = '/login';
    }
});

// --- Init ---
async function init() {
    const authRes = await fetch('/api/auth/me', { credentials: 'include' });
    if (!authRes.ok) {
        clearAccountUserBootstrapCache();
        window.location.href = '/login';
        return;
    }

    const authPayload = await authRes.json() as { user?: { permissions?: string[] } };
    const permissions = Array.isArray(authPayload.user?.permissions) ? authPayload.user.permissions : [];
    if (!permissions.includes('game.admin')) {
        showForbidden();
        return;
    }

    populateKindSelect();
    populateOverlaySelect();
    await loadAssets();
}

void init().catch(() => {
    showForbidden();
});

export {};
