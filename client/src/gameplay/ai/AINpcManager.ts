import Phaser from 'phaser';
import { IAiNpcState, AINpcKind } from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';
import { LightingManager } from '../fx/LightingManager';
import { OcclusionManager } from '../map/OcclusionManager';
import { AINpcEntity } from './AINpcEntity';
import { getAiNpcVisualDefinition } from './AINpcRegistry';
import type { DepthManager } from '../rendering/DepthManager';
import type { AudioManager, FootstepSurface } from '../audio/AudioManager';

type TrimMetaAnimation = {
    frameWidth: number;
    frameHeight: number;
    frames: number;
    file: string;
};

type GremlinTrimMeta = {
    version: number;
    sourceFrame: { width: number; height: number };
    generatedAt: string;
    animations: {
        idle: TrimMetaAnimation;
        walk: TrimMetaAnimation;
        attack: TrimMetaAnimation;
        death: TrimMetaAnimation;
    };
};

export type AINpcManagerConfig = {
    baseDepth: number;
    occlusionManager?: OcclusionManager;
    depthManager?: DepthManager;
    lightingManager?: LightingManager;
    groundLayers?: Phaser.Tilemaps.TilemapLayer[];
    getAudioManager?: () => AudioManager | undefined;
    getMap?: () => Phaser.Tilemaps.Tilemap | undefined;
    getMapFile?: () => string;
    getLocalPlayerPosition?: () => { x: number; y: number } | undefined;
};

export type GremlinFootstepEvent = {
    surface: FootstepSurface;
    audible: boolean;
};

export class AINpcManager {
    private scene: Phaser.Scene;
    private config: AINpcManagerConfig;
    private networkManager = NetworkManager.getInstance();
    private entities = new Map<string, AINpcEntity>();
    private debugGraphics?: Phaser.GameObjects.Graphics;
    private trimMetaPromiseByKind = new Map<AINpcKind, Promise<GremlinTrimMeta | null>>();
    private destroyed = false;
    private pendingFootstepSurfaces: FootstepSurface[] = [];

    constructor(scene: Phaser.Scene, config: AINpcManagerConfig) {
        this.scene = scene;
        this.config = config;
    }

    initialize() {
        if (this.destroyed) return;
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.state.aiNpcs?.onAdd((npc: IAiNpcState, id: string) => {
            this.ensureAssetsForKind(npc.kind as AINpcKind, () => {
                if (this.destroyed || !this.scene.sys.isActive()) return;
                if (!room.state.aiNpcs?.has(id)) return;
                const definition = getAiNpcVisualDefinition(npc.kind as AINpcKind);
                if (!definition) return;

                const existing = this.entities.get(id);
                if (existing) {
                    existing.destroy();
                    this.entities.delete(id);
                }

                const entity = new AINpcEntity(this.scene, {
                    definition,
                    state: npc,
                    baseDepth: this.config.baseDepth,
                    occlusionManager: this.config.occlusionManager,
                    depthManager: this.config.depthManager,
                    lightingManager: this.config.lightingManager,
                    groundLayers: this.config.groundLayers,
                    manager: this
                });

                this.entities.set(id, entity);
            });

            const runtimeNpc = npc as IAiNpcState & { onChange?: (cb: () => void) => void };

            runtimeNpc.onChange?.(() => {
                const entity = this.entities.get(id);
                if (!entity) return;
                entity.updateFromState({
                    id: runtimeNpc.id,
                    kind: runtimeNpc.kind,
                    controllerId: runtimeNpc.controllerId,
                    x: runtimeNpc.x,
                    y: runtimeNpc.y,
                    vx: runtimeNpc.vx,
                    vy: runtimeNpc.vy,
                    moveTs: runtimeNpc.moveTs,
                    direction: runtimeNpc.direction,
                    anim: runtimeNpc.anim,
                    tint: runtimeNpc.tint,
                    currentHealth: runtimeNpc.currentHealth,
                    maxHealth: runtimeNpc.maxHealth,
                    hitbox: runtimeNpc.hitbox,
                    pathDebug: runtimeNpc.pathDebug
                });
            });
        });

        room.state.aiNpcs?.onRemove((_npc: IAiNpcState, id: string) => {
            const entity = this.entities.get(id);
            if (!entity) return;
            entity.destroy();
            this.entities.delete(id);
        });

        room.onMessage('ai:attack-hit', (data: { attackerId?: string }) => {
            if (!data?.attackerId) return;
            const entity = this.entities.get(data.attackerId);
            if (!entity) return;
            entity.onAttackHit();
        });
    }

    update(delta: number) {
        if (this.destroyed) return;
        this.pendingFootstepSurfaces = [];
        this.entities.forEach((entity, id) => {
            if (entity.isDestroyed()) {
                this.entities.delete(id);
                return;
            }
            entity.update(delta);
        });
        this.emitAggregatedFootstepSubtitle();
    }

    reportGremlinFootstep(surface: FootstepSurface) {
        this.pendingFootstepSurfaces.push(surface);
    }

    getFootstepContext(): {
        audioManager: AudioManager | undefined;
        map: Phaser.Tilemaps.Tilemap | undefined;
        mapFile: string;
        playerPos: { x: number; y: number } | undefined;
        manager: AINpcManager;
    } {
        return {
            audioManager: this.config.getAudioManager?.(),
            map: this.config.getMap?.(),
            mapFile: this.config.getMapFile?.() ?? '',
            playerPos: this.config.getLocalPlayerPosition?.(),
            manager: this
        };
    }

    private emitAggregatedFootstepSubtitle() {
        if (this.pendingFootstepSurfaces.length === 0) return;
        const audioManager = this.config.getAudioManager?.();
        if (!audioManager) return;

        const surfaceCounts = new Map<FootstepSurface, number>();
        for (const surface of this.pendingFootstepSurfaces) {
            surfaceCounts.set(surface, (surfaceCounts.get(surface) ?? 0) + 1);
        }

        const totalAudible = this.pendingFootstepSurfaces.length;
        const isPlural = totalAudible > 1;

        for (const [surface] of surfaceCounts) {
            audioManager.emitGremlinFootstepSubtitle(surface, isPlural);
        }
    }

    getEntities(): Map<string, AINpcEntity> {
        return this.entities;
    }

    getDebugHitboxes(): Array<{ x: number; y: number; width: number; height: number }> {
        const hitboxes: Array<{ x: number; y: number; width: number; height: number }> = [];
        this.entities.forEach((entity) => {
            hitboxes.push(entity.getDebugHitbox());
        });
        return hitboxes;
    }

    drawDebugPaths(enabled: boolean) {
        if (enabled) {
            if (!this.debugGraphics) {
                this.debugGraphics = this.scene.add.graphics();
                this.debugGraphics.setDepth(2001);
                this.debugGraphics.setScrollFactor(1);
            }

            this.debugGraphics.clear();
            this.debugGraphics.lineStyle(2, 0xff4444, 0.95);

            this.entities.forEach((entity) => {
                const path = entity.getDebugPath();
                if (path.length === 0) return;

                const position = entity.getPosition();
                this.debugGraphics!.beginPath();
                this.debugGraphics!.moveTo(position.x, position.y);

                path.forEach((point, index) => {
                    if (index === 0) {
                        this.debugGraphics!.lineTo(point.x, point.y);
                    } else {
                        this.debugGraphics!.lineTo(point.x, point.y);
                    }
                });

                this.debugGraphics!.strokePath();
                this.debugGraphics!.fillStyle(0xff4444, 0.8);
                path.forEach((point) => {
                    this.debugGraphics!.fillCircle(point.x, point.y, 2);
                });
            });
            return;
        }

        this.debugGraphics?.clear();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.debugGraphics?.destroy();
        this.debugGraphics = undefined;
        this.entities.forEach((entity) => entity.destroy());
        this.entities.clear();
    }

    private ensureAssetsForKind(kind: AINpcKind, onReady: () => void) {
        const definition = getAiNpcVisualDefinition(kind);
        if (!definition) return;

        const stateFrameSize = (state: 'idle' | 'walk' | 'attack' | 'death') => ({
            width: Math.max(1, definition.frameWidthByState?.[state] ?? definition.frameWidth),
            height: Math.max(1, definition.frameHeightByState?.[state] ?? definition.frameHeight)
        });

        const idleTextureKey = `ai-npc-${definition.kind}-idle-sheet`;
        const walkTextureKey = `ai-npc-${definition.kind}-walk-sheet`;
        const attackTextureKey = `ai-npc-${definition.kind}-attack-sheet`;
        const deathTextureKey = `ai-npc-${definition.kind}-death-sheet`;

        const maybeCreateAnimations = () => {
            this.ensureDirectionalAnimations(definition, 'idle', idleTextureKey, definition.idleFrameRate, definition.idleFrameCount);
            this.ensureDirectionalAnimations(definition, 'walk', walkTextureKey, definition.walkFrameRate, definition.walkFrameCount);
            if (definition.attackTexturePath && definition.attackFrameCount) {
                this.ensureDirectionalAnimations(
                    definition,
                    'attack',
                    attackTextureKey,
                    definition.attackFrameRate ?? 14,
                    definition.attackFrameCount
                );
            }
            if (definition.deathTexturePath && definition.deathFrameCount) {
                this.ensureDirectionalAnimations(
                    definition,
                    'death',
                    deathTextureKey,
                    definition.deathFrameRate ?? 10,
                    definition.deathFrameCount
                );
            }
        };

        const finalize = () => {
            maybeCreateAnimations();
            onReady();
        };

        const idleReady = this.scene.textures.exists(idleTextureKey);
        const walkReady = this.scene.textures.exists(walkTextureKey);
        const attackReady = !definition.attackTexturePath || this.scene.textures.exists(attackTextureKey);
        const deathReady = !definition.deathTexturePath || this.scene.textures.exists(deathTextureKey);

        if (idleReady && walkReady && attackReady && deathReady) {
            finalize();
            return;
        }

        const primeFrameSizesAndLoad = () => {
            const idleFrameSize = stateFrameSize('idle');
            const walkFrameSize = stateFrameSize('walk');
            const attackFrameSize = stateFrameSize('attack');
            const deathFrameSize = stateFrameSize('death');

            if (!idleReady) {
                this.scene.load.spritesheet(idleTextureKey, definition.idleTexturePath, {
                    frameWidth: idleFrameSize.width,
                    frameHeight: idleFrameSize.height
                });
            }

            if (!walkReady) {
                this.scene.load.spritesheet(walkTextureKey, definition.walkTexturePath, {
                    frameWidth: walkFrameSize.width,
                    frameHeight: walkFrameSize.height
                });
            }

            if (definition.attackTexturePath && !attackReady) {
                this.scene.load.spritesheet(attackTextureKey, definition.attackTexturePath, {
                    frameWidth: attackFrameSize.width,
                    frameHeight: attackFrameSize.height
                });
            }

            if (definition.deathTexturePath && !deathReady) {
                this.scene.load.spritesheet(deathTextureKey, definition.deathTexturePath, {
                    frameWidth: deathFrameSize.width,
                    frameHeight: deathFrameSize.height
                });
            }

            this.scene.load.once('complete', finalize);
            this.scene.load.start();
        };

        this.loadTrimMetadataIntoDefinition(kind, definition)
            .catch((error) => {
                console.warn(`[AINpcManager] Failed to load trim metadata for ${definition.kind}:`, error);
            })
            .finally(() => {
                primeFrameSizesAndLoad();
            });
    }

    private loadTrimMetadataIntoDefinition(kind: AINpcKind, definition: NonNullable<ReturnType<typeof getAiNpcVisualDefinition>>): Promise<GremlinTrimMeta | null> {
        if (!definition.trimMetadataPath) {
            return Promise.resolve(null);
        }

        const existing = this.trimMetaPromiseByKind.get(kind);
        if (existing) {
            return existing.then((meta) => {
                this.applyTrimMetaToDefinition(definition, meta);
                return meta;
            });
        }

        const request = fetch(`${definition.trimMetadataPath}?t=${Date.now()}`)
            .then(async (response) => {
                if (!response.ok) return null;
                const meta = (await response.json()) as GremlinTrimMeta;
                this.applyTrimMetaToDefinition(definition, meta);
                return meta;
            })
            .catch(() => null);

        this.trimMetaPromiseByKind.set(kind, request);
        return request;
    }

    private applyTrimMetaToDefinition(definition: NonNullable<ReturnType<typeof getAiNpcVisualDefinition>>, meta: GremlinTrimMeta | null) {
        if (!meta?.animations) return;

        const { idle, walk, attack, death } = meta.animations;
        const frameWidthByState = {
            idle: Math.max(1, Number(idle?.frameWidth) || definition.frameWidth),
            walk: Math.max(1, Number(walk?.frameWidth) || definition.frameWidth),
            attack: Math.max(1, Number(attack?.frameWidth) || definition.frameWidth),
            death: Math.max(1, Number(death?.frameWidth) || definition.frameWidth)
        };
        const frameHeightByState = {
            idle: Math.max(1, Number(idle?.frameHeight) || definition.frameHeight),
            walk: Math.max(1, Number(walk?.frameHeight) || definition.frameHeight),
            attack: Math.max(1, Number(attack?.frameHeight) || definition.frameHeight),
            death: Math.max(1, Number(death?.frameHeight) || definition.frameHeight)
        };

        definition.frameWidthByState = frameWidthByState;
        definition.frameHeightByState = frameHeightByState;
        definition.frameWidth = frameWidthByState.idle;
        definition.frameHeight = frameHeightByState.idle;
    }

    private ensureDirectionalAnimations(
        definition: NonNullable<ReturnType<typeof getAiNpcVisualDefinition>>,
        state: 'idle' | 'walk' | 'attack' | 'death',
        textureKey: string,
        frameRate: number,
        framesPerRow: number
    ) {
        for (let direction = 0; direction < 8; direction += 1) {
            const { row } = this.getRowAndMirrorForDirection(direction, definition.directionalMode ?? 'octant-rows');
            const animKey = this.getAnimKey(definition.kind, state, direction);
            if (this.scene.anims.exists(animKey)) continue;

            const start = row * framesPerRow;
            const end = start + framesPerRow - 1;

            this.scene.anims.create({
                key: animKey,
                frames: this.scene.anims.generateFrameNumbers(textureKey, { start, end }),
                frameRate,
                repeat: (state === 'attack' || state === 'death') ? 0 : -1
            });
        }
    }

    private getAnimKey(kind: AINpcKind, state: 'idle' | 'walk' | 'attack' | 'death', direction: number): string {
        return `ai-npc-${kind}-${state}-d${direction}`;
    }

    private getRowAndMirrorForDirection(direction: number, directionalMode: 'octant-rows' | 'horizontal-only'): { row: number; mirrored: boolean } {
        if (directionalMode === 'horizontal-only') {
            const mirrored = direction === 5 || direction === 6 || direction === 7;
            return { row: 0, mirrored };
        }

        switch (direction) {
            case 0: return { row: 0, mirrored: false }; // S
            case 1: return { row: 1, mirrored: false }; // SE
            case 2: return { row: 2, mirrored: false }; // E
            case 3: return { row: 3, mirrored: false }; // NE
            case 4: return { row: 4, mirrored: false }; // N
            case 5: return { row: 3, mirrored: true };  // NW (mirror NE)
            case 6: return { row: 2, mirrored: true };  // W (mirror E)
            case 7: return { row: 1, mirrored: true };  // SW (mirror SE)
            default: return { row: 0, mirrored: false };
        }
    }
}
