import Phaser from 'phaser';
import { SOFT_COLLISION_FORCE } from '@cfwk/shared';
import { getTiledProperty, TiledObjectLayer } from '../map/TiledTypes';
import { LightingManager } from '../fx/LightingManager';
import type { OcclusionManager } from '../map/OcclusionManager';
import { createNameplate } from '../player/PlayerVisualUtils';
import { DepthManager, ENTITY_BASE, NAMEPLATE_OFFSET, Y_SORT_FACTOR } from '../rendering/DepthManager';
import { getNpcDefinition } from './NPCRegistry';
import { LocaleManager } from '../i18n/LocaleManager';

type NPCPoint = {
    id: string;
    x: number;
    y: number;
};

type NPCManagerConfig = {
    baseDepth: number;
    occlusionManager?: OcclusionManager;
    depthManager?: DepthManager;
    lightingManager?: LightingManager;
    allowDebugNpc?: boolean;
};

export type NPCInteractable = {
    id: string;
    name: string;
    x: number;
    y: number;
    range: number;
};

type NPCInstance = {
    id: string;
    name: string;
    sprite: Phaser.GameObjects.Sprite;
    baseX: number;
    baseY: number;
    softOffsetX: number;
    softOffsetY: number;
    nameplate: Phaser.GameObjects.Container;
    nameplateMargin: number;
    nameplateHeight: number;
    depthOffset: number;
    scale: number;
    frameWidth: number;
    frameHeight: number;
    trimLeft: number;
    trimTop: number;
    trimBottom: number;
    collisionWidth: number;
    collidableHeight: number;
    visualHeight: number;
    interactionRangePx: number;
};

type NPCVisualMetrics = {
    trimLeft: number;
    trimTop: number;
    width: number;
    height: number;
    trimBottom: number;
};

export class NPCManager {
    private scene: Phaser.Scene;
    private baseDepth: number;
    private depthManager?: DepthManager;
    private lightingManager?: LightingManager;
    private tileSize = 32;
    private npcs: NPCInstance[] = [];
    private allNpcPoints: NPCPoint[] = [];
    private visualMetricsCache = new Map<string, NPCVisualMetrics>();
    private localeManager = LocaleManager.getInstance();
    private localeChangedHandler?: (event: Event) => void;
    private allowDebugNpc: boolean;

    constructor(scene: Phaser.Scene, config: NPCManagerConfig) {
        this.scene = scene;
        this.baseDepth = config.baseDepth;
        this.depthManager = config.depthManager;
        this.lightingManager = config.lightingManager;
        this.allowDebugNpc = config.allowDebugNpc === true;
        this.localeChangedHandler = () => this.refreshNpcNames();
        window.addEventListener('locale:changed', this.localeChangedHandler as EventListener);
    }

    loadAndSpawnFromMap(map: Phaser.Tilemaps.Tilemap) {
        this.tileSize = map.tileWidth || 32;
        const npcPoints = this.getNpcPoints(map);
        this.allNpcPoints = npcPoints;
        const ids = npcPoints.map((point) => point.id.trim().toLowerCase());
        const debugCount = ids.filter((id) => id === 'debug').length;
        console.log(`[NPCManager] POI NPC points discovered: total=${npcPoints.length} debug=${debugCount} ids=${ids.join(',')}`);
        if (npcPoints.length === 0) return;

        const texturesToLoad = new Set<string>();
        const generatedIdleDefs = new Map<string, ReturnType<typeof getNpcDefinition>>();

        npcPoints.forEach((point) => {
            const def = getNpcDefinition(point.id);
            if (!def) return;

            if (def.singleTexturePath) {
                const sourceKey = this.getSingleSourceTextureKey(def.id);
                if (!this.scene.textures.exists(sourceKey)) {
                    this.scene.load.image(sourceKey, def.singleTexturePath);
                    texturesToLoad.add(sourceKey);
                }
                generatedIdleDefs.set(def.id, def);
                return;
            }

            const textureKey = this.getIdleTextureKey(def.id);
            if (!this.scene.textures.exists(textureKey) && def.idleTexturePath) {
                this.scene.load.spritesheet(textureKey, def.idleTexturePath, {
                    frameWidth: def.frameWidth,
                    frameHeight: def.frameHeight
                });
                texturesToLoad.add(textureKey);
            }
        });

        const finalizeSpawn = () => {
            this.ensureGeneratedIdleTextures(Array.from(generatedIdleDefs.values()));
            this.spawnFromPoints(npcPoints);
        };

        if (texturesToLoad.size > 0) {
            this.scene.load.once('complete', () => {
                finalizeSpawn();
            });
            this.scene.load.start();
        } else {
            finalizeSpawn();
        }
    }

    destroy() {
        if (this.localeChangedHandler) {
            window.removeEventListener('locale:changed', this.localeChangedHandler as EventListener);
            this.localeChangedHandler = undefined;
        }
        this.npcs.forEach((npc) => {
            npc.sprite.destroy();
            npc.nameplate.destroy();
        });
        this.npcs = [];
        this.allNpcPoints = [];
    }

    setAllowDebugNpc(allow: boolean) {
        const nextAllow = allow === true;
        if (this.allowDebugNpc === nextAllow) return;
        this.allowDebugNpc = nextAllow;
        console.log(`[NPCManager] setAllowDebugNpc -> ${this.allowDebugNpc}`);

        if (this.allowDebugNpc) {
            const debugPoints = this.allNpcPoints.filter((point) => point.id.trim().toLowerCase() === 'debug');
            console.log(`[NPCManager] Debug NPC points available: ${debugPoints.length}`);
            if (debugPoints.length > 0) {
                this.spawnFromPoints(debugPoints);
            } else {
                console.warn('[NPCManager] Debug NPC enabled but no debug POI point was found in map.');
            }
            return;
        }

        const remaining: NPCInstance[] = [];
        this.npcs.forEach((npc) => {
            if (npc.id.trim().toLowerCase() === 'debug') {
                npc.sprite.destroy();
                npc.nameplate.destroy();
                console.log('[NPCManager] Removed debug NPC from scene');
                return;
            }
            remaining.push(npc);
        });
        this.npcs = remaining;
    }

    getInteractables(): NPCInteractable[] {
        return this.npcs.map((npc) => ({
            id: npc.id,
            name: npc.name,
            x: npc.sprite.x,
            y: this.getVisualBottomY(npc),
            range: npc.interactionRangePx
        }));
    }

    getNpcById(id: string): { x: number; y: number; name: string } | null {
        const npc = this.npcs.find((entry) => entry.id === id);
        if (!npc) return null;
        return { x: npc.sprite.x, y: this.getVisualBottomY(npc), name: npc.name };
    }

    getDebugHitboxes(): Array<{ x: number; y: number; width: number; height: number }> {
        return this.npcs.map((npc) => {
            const width = Math.max(1, npc.collisionWidth);
            const height = Math.max(1, npc.collidableHeight);
            const bottomY = this.getVisualBottomY(npc);
            return {
                x: npc.sprite.x - (width / 2),
                y: bottomY - height,
                width,
                height
            };
        });
    }

    getSoftCollisionBodies(): Array<{ id: string; x: number; y: number; width: number; height: number }> {
        return this.npcs.map((npc) => ({
            id: npc.id,
            x: npc.sprite.x,
            y: this.getVisualBottomY(npc) - (Math.max(1, npc.collidableHeight) / 2),
            width: Math.max(1, npc.collisionWidth),
            height: Math.max(1, npc.collidableHeight)
        }));
    }

    getDebugVisualBounds(): Array<{ x: number; y: number; width: number; height: number }> {
        return this.npcs.map((npc) => ({
            x: npc.sprite.x - (npc.frameWidth * npc.scale / 2) + (npc.trimLeft * npc.scale),
            y: npc.sprite.y - (npc.frameHeight * npc.scale) + (npc.trimTop * npc.scale),
            width: Math.max(1, npc.collisionWidth),
            height: Math.max(1, npc.visualHeight)
        }));
    }

    applySoftCollisionNudge(id: string, dx: number, dy: number) {
        const npc = this.npcs.find((entry) => entry.id === id);
        if (!npc) return;

        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= 0.0001) return;

        const maxPerStep = SOFT_COLLISION_FORCE.maxPushPerStep;
        const scale = length > maxPerStep ? (maxPerStep / length) : 1;
        npc.softOffsetX += dx * scale;
        npc.softOffsetY += dy * scale;

        const offsetLength = Math.hypot(npc.softOffsetX, npc.softOffsetY);
        const maxOffset = 4;
        if (offsetLength > maxOffset) {
            const clampScale = maxOffset / offsetLength;
            npc.softOffsetX *= clampScale;
            npc.softOffsetY *= clampScale;
        }
    }

    private getNpcPoints(map: Phaser.Tilemaps.Tilemap): NPCPoint[] {
        const points: NPCPoint[] = [];
        const objectLayers = map.objects as TiledObjectLayer[];
        const poiLayers = objectLayers.filter((layer) => layer.name === 'POI');
        if (poiLayers.length === 0) return points;

        poiLayers.forEach((poiLayer) => {
            poiLayer.objects.forEach((obj) => {
                const npcProp = obj.properties?.find((prop) => String(prop.name).toLowerCase() === 'npc');
                const npcId = typeof npcProp?.value === 'string'
                    ? npcProp.value
                    : getTiledProperty(obj, 'npc');
                if (typeof npcId !== 'string' || npcId.trim().length === 0) return;
                if (obj.x === undefined || obj.y === undefined) return;

                points.push({
                    id: npcId.trim(),
                    x: obj.x,
                    y: obj.y
                });
            });
        });

        return points;
    }

    private spawnFromPoints(points: NPCPoint[]) {
        points.forEach((point) => {
            const pointId = point.id.trim().toLowerCase();
            if (pointId === 'debug' && !this.allowDebugNpc) return;

            const def = getNpcDefinition(point.id);
            if (!def) {
                console.warn(`[NPCManager] Unknown NPC id: ${point.id}`);
                return;
            }
            if (pointId === 'debug' && this.npcs.some((npc) => npc.id.trim().toLowerCase() === 'debug')) {
                return;
            }

            let textureKey = this.getIdleTextureKey(def.id);
            let resolvedFrameCount = Math.max(1, def.frameCount);
            if (!this.scene.textures.exists(textureKey)) {
                if (def.singleTexturePath) {
                    this.generateIdleSpritesheetFromSingle(def);
                }
            }
            if (!this.scene.textures.exists(textureKey)) {
                const sourceKey = this.getSingleSourceTextureKey(def.id);
                if (def.singleTexturePath && this.scene.textures.exists(sourceKey)) {
                    textureKey = sourceKey;
                    resolvedFrameCount = 1;
                    console.warn(`[NPCManager] Falling back to single-frame texture for NPC: ${def.id}`);
                } else {
                    console.warn(`[NPCManager] Missing NPC texture: ${textureKey} (id=${def.id}, idle=${def.idleTexturePath ?? 'n/a'}, single=${def.singleTexturePath ?? 'n/a'})`);
                    return;
                }
            }

            const visualMetrics = this.getNpcVisualMetrics(def, textureKey, resolvedFrameCount);
            const spriteScale = def.scale > 0 ? def.scale : 1;
            const spriteY = point.y + (visualMetrics.trimBottom * spriteScale);

            const animKey = this.getIdleAnimationKey(def.id);
            if (resolvedFrameCount > 1) {
                const expectedFrames = Math.max(2, resolvedFrameCount);
                const existing = this.scene.anims.exists(animKey) ? this.scene.anims.get(animKey) : undefined;
                const shouldForceRebuild = Boolean(def.singleTexturePath);
                if (existing && (existing.frames.length < expectedFrames || shouldForceRebuild)) {
                    this.scene.anims.remove(animKey);
                }

                if (!this.scene.anims.exists(animKey)) {
                    const animFrames = this.getAnimationFrames(textureKey, resolvedFrameCount);
                    if (animFrames.length > 1) {
                        this.scene.anims.create({
                            key: animKey,
                            frames: animFrames,
                            frameRate: def.frameRate,
                            repeat: -1
                        });
                    } else {
                        console.warn(`[NPCManager] Could not create multi-frame idle animation for NPC: ${def.id}`);
                    }
                }
            }

            const sprite = this.scene.add.sprite(point.x, spriteY, textureKey, 0);
            sprite.setOrigin(0.5, 1);
            sprite.setScale(spriteScale);
            this.lightingManager?.enableLightingOn(sprite);
            const depthOffset = def.depthOffset ?? 0;
            const spawnFeetY = this.getVisualBottomYFromSprite(sprite.y, visualMetrics.trimBottom, spriteScale);
            this.applyDepth(sprite, depthOffset, spawnFeetY);
            if (resolvedFrameCount > 1 && this.scene.anims.exists(animKey)) {
                sprite.play(animKey);
            }

            const localizedName = this.localeManager.t(def.nameKey ?? `npc.${def.id}.name`, undefined, def.name);
            const nameplate = this.createNpcNameplate(localizedName);
            const nameplateMargin = this.getNameplateTopMargin(spriteScale);
            const visualTopY = this.getVisualTopY(sprite, def.frameHeight, visualMetrics.trimTop, spriteScale);
            nameplate.setPosition(sprite.x, visualTopY - nameplateMargin);

            this.npcs.push({
                id: def.id,
                name: localizedName,
                sprite,
                baseX: point.x,
                baseY: spriteY,
                softOffsetX: 0,
                softOffsetY: 0,
                nameplate,
                nameplateMargin,
                nameplateHeight: nameplate.getBounds().height,
                depthOffset,
                scale: spriteScale,
                frameWidth: def.frameWidth,
                frameHeight: def.frameHeight,
                trimLeft: visualMetrics.trimLeft,
                trimTop: visualMetrics.trimTop,
                trimBottom: visualMetrics.trimBottom,
                collisionWidth: Math.max(1, visualMetrics.width * spriteScale),
                collidableHeight: Math.max(1, 6 * spriteScale),
                visualHeight: Math.max(1, visualMetrics.height * spriteScale),
                interactionRangePx: def.interactionRangeTiles * this.tileSize * 1.4
            });

            console.log(`[NPCManager] Spawned NPC ${def.id} at (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) using ${textureKey}`);
        });
    }

    private getNpcVisualMetrics(
        def: { frameWidth: number; frameHeight: number; frameCount: number },
        textureKey: string,
        frameCountOverride?: number
    ): NPCVisualMetrics {
        const cacheKey = `${textureKey}::${frameCountOverride ?? def.frameCount}`;
        const cached = this.visualMetricsCache.get(cacheKey);
        if (cached) return cached;

        const fallback: NPCVisualMetrics = {
            trimLeft: 0,
            trimTop: 0,
            width: def.frameWidth,
            height: def.frameHeight,
            trimBottom: 0
        };

        try {
            const texture = this.scene.textures.get(textureKey);
            const sourceImage = texture.getSourceImage() as (CanvasImageSource & {
                width?: number;
                height?: number;
                naturalWidth?: number;
                naturalHeight?: number;
            }) | null;
            if (!sourceImage) return fallback;

            const sourceWidth = sourceImage.naturalWidth ?? sourceImage.width ?? 0;
            const sourceHeight = sourceImage.naturalHeight ?? sourceImage.height ?? 0;
            if (sourceWidth <= 0 || sourceHeight <= 0) return fallback;

            const frameWidth = def.frameWidth;
            const frameHeight = def.frameHeight;
            const columns = Math.max(1, Math.floor(sourceWidth / frameWidth));
            const frameCount = Math.max(1, frameCountOverride ?? def.frameCount);
            const frameLimit = Math.min(frameCount, Math.floor((sourceWidth / frameWidth) * (sourceHeight / frameHeight)));

            const canvas = document.createElement('canvas');
            canvas.width = frameWidth;
            canvas.height = frameHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return fallback;

            let minX = frameWidth;
            let maxX = -1;
            let minY = frameHeight;
            let maxY = -1;
            let minBottomPadding = frameHeight;

            for (let frameIndex = 0; frameIndex < frameLimit; frameIndex++) {
                const frameX = (frameIndex % columns) * frameWidth;
                const frameY = Math.floor(frameIndex / columns) * frameHeight;

                ctx.clearRect(0, 0, frameWidth, frameHeight);
                ctx.drawImage(sourceImage, frameX, frameY, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
                const pixelData = ctx.getImageData(0, 0, frameWidth, frameHeight).data;

                let frameMinX = frameWidth;
                let frameMaxX = -1;
                let frameMinY = frameHeight;
                let frameMaxY = -1;

                for (let y = 0; y < frameHeight; y++) {
                    for (let x = 0; x < frameWidth; x++) {
                        const alpha = pixelData[((y * frameWidth) + x) * 4 + 3];
                        if (alpha === 0) continue;
                        if (x < frameMinX) frameMinX = x;
                        if (x > frameMaxX) frameMaxX = x;
                        if (y < frameMinY) frameMinY = y;
                        if (y > frameMaxY) frameMaxY = y;
                    }
                }

                if (frameMaxX < frameMinX || frameMaxY < frameMinY) continue;

                if (frameMinX < minX) minX = frameMinX;
                if (frameMaxX > maxX) maxX = frameMaxX;
                if (frameMinY < minY) minY = frameMinY;
                if (frameMaxY > maxY) maxY = frameMaxY;

                const frameBottomPadding = Math.max(0, (frameHeight - 1) - frameMaxY);
                if (frameBottomPadding < minBottomPadding) minBottomPadding = frameBottomPadding;
            }

            if (maxX < minX || maxY < minY) {
                this.visualMetricsCache.set(cacheKey, fallback);
                return fallback;
            }

            const resolved: NPCVisualMetrics = {
                trimLeft: minX,
                trimTop: minY,
                width: Math.max(1, maxX - minX + 1),
                height: Math.max(1, maxY - minY + 1),
                trimBottom: minBottomPadding === frameHeight ? 0 : minBottomPadding
            };
            this.visualMetricsCache.set(cacheKey, resolved);
            return resolved;
        } catch {
            this.visualMetricsCache.set(cacheKey, fallback);
            return fallback;
        }
    }

    private refreshNpcNames() {
        this.npcs.forEach((npc) => {
            const def = getNpcDefinition(npc.id);
            const fallback = def?.name ?? npc.name;
            const localized = this.localeManager.t(def?.nameKey ?? `npc.${npc.id}.name`, undefined, fallback);
            if (localized === npc.name) return;

            npc.name = localized;
            npc.nameplate.destroy();
            npc.nameplate = this.createNpcNameplate(localized);
            const visualTopY = this.getVisualTopY(npc.sprite, npc.frameHeight, npc.trimTop, npc.scale);
            npc.nameplate.setPosition(npc.sprite.x, visualTopY - npc.nameplateMargin);
        });
    }

    update() {
        this.npcs.forEach((npc) => {
            npc.softOffsetX *= 0.82;
            npc.softOffsetY *= 0.82;
            if (Math.abs(npc.softOffsetX) < 0.01) npc.softOffsetX = 0;
            if (Math.abs(npc.softOffsetY) < 0.01) npc.softOffsetY = 0;

            npc.sprite.setPosition(npc.baseX + npc.softOffsetX, npc.baseY + npc.softOffsetY);
            const feetY = this.getVisualBottomY(npc);
            this.applyDepth(npc.sprite, npc.depthOffset, feetY);
            const visualTopY = this.getVisualTopY(npc.sprite, npc.frameHeight, npc.trimTop, npc.scale);
            npc.nameplate.setPosition(npc.sprite.x, visualTopY - npc.nameplateMargin);
            const nameplateDepth = this.depthManager
                ? this.depthManager.nameplateDepth(npc.sprite.depth)
                : npc.sprite.depth + NAMEPLATE_OFFSET;
            npc.nameplate.setDepth(nameplateDepth);
        });
    }

    private applyDepth(sprite: Phaser.GameObjects.Sprite, depthOffset: number, feetY: number) {
        if (this.depthManager) {
            sprite.setDepth(this.depthManager.entityDepth(sprite.x, feetY, { baseDepth: this.baseDepth + depthOffset }));
        } else {
            sprite.setDepth(this.baseDepth + depthOffset + feetY * Y_SORT_FACTOR);
        }
    }

    private getIdleTextureKey(id: string): string {
        return `npc-${id}-idle`;
    }

    private getSingleSourceTextureKey(id: string): string {
        return `npc-${id}-single-src`;
    }

    private getIdleAnimationKey(id: string): string {
        return `npc-${id}-idle`;
    }

    private ensureGeneratedIdleTextures(definitions: Array<ReturnType<typeof getNpcDefinition>>) {
        definitions.forEach((def) => {
            if (!def || !def.singleTexturePath) return;
            const textureKey = this.getIdleTextureKey(def.id);
            if (this.scene.textures.exists(textureKey)) return;
            this.generateIdleSpritesheetFromSingle(def);
        });
    }

    private generateIdleSpritesheetFromSingle(def: NonNullable<ReturnType<typeof getNpcDefinition>>) {
        const sourceKey = this.getSingleSourceTextureKey(def.id);
        const sourceTexture = this.scene.textures.get(sourceKey);
        const sourceImage = sourceTexture.getSourceImage() as (CanvasImageSource & {
            width?: number;
            height?: number;
            naturalWidth?: number;
            naturalHeight?: number;
        }) | null;
        if (!sourceImage) {
            console.warn(`[NPCManager] Missing single-frame source texture for NPC: ${def.id}`);
            return;
        }

        const frameWidth = def.frameWidth;
        const frameHeight = def.frameHeight;
        const bobOffset = 2;
        const canvas = document.createElement('canvas');
        canvas.width = frameWidth * 2;
        canvas.height = frameHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            console.warn(`[NPCManager] Failed to create canvas context for NPC: ${def.id}`);
            return;
        }

        // Frame 1 (left cell): original image
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(sourceImage, 0, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);

        // Analyze source pixels to find the actual content-bottom row
        const analysisCanvas = document.createElement('canvas');
        analysisCanvas.width = frameWidth;
        analysisCanvas.height = frameHeight;
        const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });
        if (!analysisCtx) {
            console.warn(`[NPCManager] Failed to create analysis context for NPC: ${def.id}`);
            return;
        }
        analysisCtx.clearRect(0, 0, frameWidth, frameHeight);
        analysisCtx.drawImage(sourceImage, 0, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
        const pixels = analysisCtx.getImageData(0, 0, frameWidth, frameHeight).data;

        let contentBottomY = -1;
        for (let y = frameHeight - 1; y >= 0; y--) {
            for (let x = 0; x < frameWidth; x++) {
                if (pixels[((y * frameWidth) + x) * 4 + 3] > 0) {
                    contentBottomY = y;
                    break;
                }
            }
            if (contentBottomY >= 0) break;
        }

        // Frame 2 (right cell): bob effect
        // Cut a row near the bottom of actual content, shift everything above down by bobOffset
        const cutFromBottom = Number.isFinite(def.bobCutRowFromBottom)
            ? Math.max(1, Math.floor(def.bobCutRowFromBottom as number))
            : 3;
        const cutRowOffset = Math.max(0, cutFromBottom - 1);
        const cutRowY = contentBottomY >= 0
            ? Math.max(0, contentBottomY - cutRowOffset)
            : Math.max(0, frameHeight - cutFromBottom);
        const upperHeight = cutRowY;
        const lowerSrcY = Math.min(frameHeight, cutRowY + 1);
        const lowerHeight = Math.max(0, frameHeight - lowerSrcY);

        // Upper portion shifted down by bobOffset pixels
        if (upperHeight > 0) {
            ctx.drawImage(
                sourceImage,
                0, 0, frameWidth, upperHeight,
                frameWidth, bobOffset, frameWidth, upperHeight
            );
        }
        // Lower portion stays at original Y
        if (lowerHeight > 0) {
            ctx.drawImage(
                sourceImage,
                0, lowerSrcY, frameWidth, lowerHeight,
                frameWidth, lowerSrcY, frameWidth, lowerHeight
            );
        }

        // Register the canvas directly as the idle texture with manual frame regions
        const textureKey = this.getIdleTextureKey(def.id);
        // Clean up any stale textures (including old intermediate canvas keys)
        const oldCanvasKey = `${textureKey}-canvas`;
        if (this.scene.textures.exists(oldCanvasKey)) {
            this.scene.textures.remove(oldCanvasKey);
        }
        if (this.scene.textures.exists(textureKey)) {
            this.scene.textures.remove(textureKey);
        }
        // Clear visual metrics cache so it re-analyzes the new texture
        this.visualMetricsCache.delete(`${textureKey}::${def.frameCount}`);

        this.scene.textures.addCanvas(textureKey, canvas);
        const resultTexture = this.scene.textures.get(textureKey);
        // Define sub-frames for each animation cell
        resultTexture.add(0, 0, 0, 0, frameWidth, frameHeight);
        resultTexture.add(1, 0, frameWidth, 0, frameWidth, frameHeight);

        console.log(`[NPCManager] Generated 2-frame idle for ${def.id}: canvas ${canvas.width}x${canvas.height}, cutRow=${cutRowY}, contentBottom=${contentBottomY}, cutFromBottom=${cutFromBottom}, bobOffset=${bobOffset}`);
    }

    private getAnimationFrames(textureKey: string, frameCount: number): Phaser.Types.Animations.AnimationFrame[] {
        const texture = this.scene.textures.get(textureKey);
        const frames: Phaser.Types.Animations.AnimationFrame[] = [];
        const limit = Math.max(1, frameCount);

        for (let i = 0; i < limit; i++) {
            const frameKey = i.toString();
            if (texture.has(frameKey)) {
                frames.push({ key: textureKey, frame: frameKey });
            }
        }

        return frames;
    }

    private createNpcNameplate(name: string): Phaser.GameObjects.Container {
        const fontSize = this.isMobileDevice() ? '10px' : '6px';
        const nameplate = createNameplate({
            scene: this.scene,
            text: name,
            fontSize,
            yOffset: 0,
            depth: ENTITY_BASE + NAMEPLATE_OFFSET,
            textColor: '#000000',
            hideBackground: true
        });
        return nameplate.container;
    }

    private isMobileDevice(): boolean {
        const os = this.scene.sys.game.device.os;
        return Boolean(os.android || os.iOS || os.iPad || os.iPhone || os.windowsPhone);
    }

    private getNameplateTopMargin(scale: number): number {
        const baseMargin = this.isMobileDevice() ? 12 : 9;
        return baseMargin * scale;
    }

    private getVisualTopY(sprite: Phaser.GameObjects.Sprite, frameHeight: number, trimTop: number, scale: number): number {
        return sprite.y - (frameHeight * scale) + (trimTop * scale);
    }

    private getVisualBottomY(npc: NPCInstance): number {
        return this.getVisualBottomYFromSprite(npc.sprite.y, npc.trimBottom, npc.scale);
    }

    private getVisualBottomYFromSprite(spriteY: number, trimBottom: number, scale: number): number {
        return spriteY - (trimBottom * scale);
    }

}
