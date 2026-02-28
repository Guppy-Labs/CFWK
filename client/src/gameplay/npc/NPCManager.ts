import Phaser from 'phaser';
import { SOFT_COLLISION_FORCE } from '@cfwk/shared';
import { getTiledProperty, TiledObjectLayer } from '../map/TiledTypes';
import { LightingManager } from '../fx/LightingManager';
import type { OcclusionManager } from '../map/OcclusionManager';
import { createNameplate } from '../player/PlayerVisualUtils';
import { DepthManager, ENTITY_BASE, NAMEPLATE_OFFSET } from '../rendering/DepthManager';
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
    nameplateYOffset: number;
    nameplateHeight: number;
    depthOffset: number;
    interactionRangePx: number;
};

export class NPCManager {
    private scene: Phaser.Scene;
    private baseDepth: number;
    private depthManager?: DepthManager;
    private lightingManager?: LightingManager;
    private tileSize = 32;
    private npcs: NPCInstance[] = [];
    private localeManager = LocaleManager.getInstance();
    private localeChangedHandler?: (event: Event) => void;

    constructor(scene: Phaser.Scene, config: NPCManagerConfig) {
        this.scene = scene;
        this.baseDepth = config.baseDepth;
        this.depthManager = config.depthManager;
        this.lightingManager = config.lightingManager;
        this.localeChangedHandler = () => this.refreshNpcNames();
        window.addEventListener('locale:changed', this.localeChangedHandler as EventListener);
    }

    loadAndSpawnFromMap(map: Phaser.Tilemaps.Tilemap) {
        this.tileSize = map.tileWidth || 32;
        const npcPoints = this.getNpcPoints(map);
        if (npcPoints.length === 0) return;

        const texturesToLoad = new Set<string>();

        npcPoints.forEach((point) => {
            const def = getNpcDefinition(point.id);
            if (!def) return;

            const textureKey = this.getIdleTextureKey(def.id);
            if (!this.scene.textures.exists(textureKey)) {
                this.scene.load.spritesheet(textureKey, def.idleTexturePath, {
                    frameWidth: def.frameWidth,
                    frameHeight: def.frameHeight
                });
                texturesToLoad.add(textureKey);
            }
        });

        if (texturesToLoad.size > 0) {
            this.scene.load.once('complete', () => {
                this.spawnFromPoints(npcPoints);
            });
            this.scene.load.start();
        } else {
            this.spawnFromPoints(npcPoints);
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
    }

    getInteractables(): NPCInteractable[] {
        return this.npcs.map((npc) => ({
            id: npc.id,
            name: npc.name,
            x: npc.sprite.x,
            y: npc.sprite.y,
            range: npc.interactionRangePx
        }));
    }

    getNpcById(id: string): { x: number; y: number; name: string } | null {
        const npc = this.npcs.find((entry) => entry.id === id);
        if (!npc) return null;
        return { x: npc.sprite.x, y: npc.sprite.y, name: npc.name };
    }

    getDebugHitboxes(): Array<{ x: number; y: number; width: number; height: number }> {
        return this.npcs.map((npc) => {
            const width = Math.max(1, npc.sprite.displayWidth);
            const height = 6;
            return {
                x: npc.sprite.x - (width / 2),
                y: npc.sprite.y - height,
                width,
                height
            };
        });
    }

    getSoftCollisionBodies(): Array<{ id: string; x: number; y: number; width: number; height: number }> {
        return this.npcs.map((npc) => ({
            id: npc.id,
            x: npc.sprite.x,
            y: npc.sprite.y,
            width: Math.max(1, npc.sprite.displayWidth),
            height: 6
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
        const poiLayer = objectLayers.find((layer) => layer.name === 'POI');
        if (!poiLayer) return points;

        poiLayer.objects.forEach((obj) => {
            const npcId = getTiledProperty(obj, 'npc');
            if (typeof npcId !== 'string' || npcId.trim().length === 0) return;
            if (obj.x === undefined || obj.y === undefined) return;

            points.push({
                id: npcId.trim(),
                x: obj.x,
                y: obj.y
            });
        });

        return points;
    }

    private spawnFromPoints(points: NPCPoint[]) {
        points.forEach((point) => {
            const def = getNpcDefinition(point.id);
            if (!def) {
                console.warn(`[NPCManager] Unknown NPC id: ${point.id}`);
                return;
            }

            const textureKey = this.getIdleTextureKey(def.id);
            if (!this.scene.textures.exists(textureKey)) {
                console.warn(`[NPCManager] Missing NPC texture: ${textureKey}`);
                return;
            }

            const animKey = this.getIdleAnimationKey(def.id);
            if (!this.scene.anims.exists(animKey)) {
                this.scene.anims.create({
                    key: animKey,
                    frames: this.scene.anims.generateFrameNumbers(textureKey, {
                        start: 0,
                        end: Math.max(0, def.frameCount - 1)
                    }),
                    frameRate: def.frameRate,
                    repeat: -1
                });
            }

            const sprite = this.scene.add.sprite(point.x, point.y, textureKey, 0);
            sprite.setOrigin(0.5, 1);
            this.lightingManager?.enableLightingOn(sprite);
            const depthOffset = def.depthOffset ?? 0;
            this.applyDepth(sprite, depthOffset);
            sprite.play(animKey);

            const localizedName = this.localeManager.t(def.nameKey ?? `npc.${def.id}.name`, undefined, def.name);
            const nameplate = this.createNpcNameplate(localizedName);
            nameplate.setPosition(sprite.x, sprite.y + this.getNameplateYOffset());

            this.npcs.push({
                id: def.id,
                name: localizedName,
                sprite,
                baseX: point.x,
                baseY: point.y,
                softOffsetX: 0,
                softOffsetY: 0,
                nameplate,
                nameplateYOffset: this.getNameplateYOffset(),
                nameplateHeight: nameplate.getBounds().height,
                depthOffset,
                interactionRangePx: def.interactionRangeTiles * this.tileSize
            });
        });
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
            npc.nameplate.setPosition(npc.sprite.x, npc.sprite.y + npc.nameplateYOffset);
        });
    }

    update() {
        this.npcs.forEach((npc) => {
            npc.softOffsetX *= 0.82;
            npc.softOffsetY *= 0.82;
            if (Math.abs(npc.softOffsetX) < 0.01) npc.softOffsetX = 0;
            if (Math.abs(npc.softOffsetY) < 0.01) npc.softOffsetY = 0;

            npc.sprite.setPosition(npc.baseX + npc.softOffsetX, npc.baseY + npc.softOffsetY);
            this.applyDepth(npc.sprite, npc.depthOffset);
            npc.nameplate.setPosition(npc.sprite.x, npc.sprite.y + npc.nameplateYOffset);
            npc.nameplate.setDepth(ENTITY_BASE + NAMEPLATE_OFFSET);
        });
    }

    private applyDepth(sprite: Phaser.GameObjects.Sprite, depthOffset: number) {
        const feetY = sprite.getBottomLeft().y;
        if (this.depthManager) {
            sprite.setDepth(this.depthManager.entityDepth(sprite.x, feetY, { baseDepth: this.baseDepth + depthOffset }));
        } else {
            sprite.setDepth(this.baseDepth + depthOffset + feetY * 0.01);
        }
    }

    private getIdleTextureKey(id: string): string {
        return `npc-${id}-idle`;
    }

    private getIdleAnimationKey(id: string): string {
        return `npc-${id}-idle`;
    }

    private createNpcNameplate(name: string): Phaser.GameObjects.Container {
        const fontSize = this.isMobileDevice() ? '10px' : '6px';
        const nameplate = createNameplate({
            scene: this.scene,
            text: name,
            fontSize,
            yOffset: this.getNameplateYOffset(),
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

    private getNameplateYOffset(): number {
        return this.isMobileDevice() ? -42 : -36;
    }

}
