import Phaser from 'phaser';
import { IAiNpcState, AINpcKind } from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';
import { LightingManager } from '../fx/LightingManager';
import { OcclusionManager } from '../map/OcclusionManager';
import { AINpcEntity } from './AINpcEntity';
import { getAiNpcVisualDefinition } from './AINpcRegistry';

export type AINpcManagerConfig = {
    baseDepth: number;
    occlusionManager?: OcclusionManager;
    lightingManager?: LightingManager;
    groundLayers?: Phaser.Tilemaps.TilemapLayer[];
};

export class AINpcManager {
    private scene: Phaser.Scene;
    private config: AINpcManagerConfig;
    private networkManager = NetworkManager.getInstance();
    private entities = new Map<string, AINpcEntity>();
    private debugGraphics?: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene, config: AINpcManagerConfig) {
        this.scene = scene;
        this.config = config;
    }

    initialize() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.state.aiNpcs?.onAdd((npc: IAiNpcState, id: string) => {
            this.ensureAssetsForKind(npc.kind as AINpcKind, () => {
                const definition = getAiNpcVisualDefinition(npc.kind as AINpcKind);
                if (!definition) return;

                const entity = new AINpcEntity(this.scene, {
                    definition,
                    state: npc,
                    baseDepth: this.config.baseDepth,
                    occlusionManager: this.config.occlusionManager,
                    lightingManager: this.config.lightingManager,
                    groundLayers: this.config.groundLayers
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
    }

    update(delta: number) {
        this.entities.forEach((entity) => entity.update(delta));
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
        this.debugGraphics?.destroy();
        this.debugGraphics = undefined;
        this.entities.forEach((entity) => entity.destroy());
        this.entities.clear();
    }

    private ensureAssetsForKind(kind: AINpcKind, onReady: () => void) {
        const definition = getAiNpcVisualDefinition(kind);
        if (!definition) return;

        const idleTextureKey = `ai-npc-${definition.kind}-idle-sheet`;
        const walkTextureKey = `ai-npc-${definition.kind}-walk-sheet`;

        const maybeCreateAnimations = () => {
            this.ensureDirectionalAnimations(definition.kind, 'idle', idleTextureKey, definition.idleFrameRate, definition.frameCount);
            this.ensureDirectionalAnimations(definition.kind, 'walk', walkTextureKey, definition.walkFrameRate, definition.frameCount);
        };

        const finalize = () => {
            maybeCreateAnimations();
            onReady();
        };

        const idleReady = this.scene.textures.exists(idleTextureKey);
        const walkReady = this.scene.textures.exists(walkTextureKey);
        if (idleReady && walkReady) {
            finalize();
            return;
        }

        if (!idleReady) {
            this.scene.load.spritesheet(idleTextureKey, definition.idleTexturePath, {
                frameWidth: definition.frameWidth,
                frameHeight: definition.frameHeight
            });
        }

        if (!walkReady) {
            this.scene.load.spritesheet(walkTextureKey, definition.walkTexturePath, {
                frameWidth: definition.frameWidth,
                frameHeight: definition.frameHeight
            });
        }

        this.scene.load.once('complete', finalize);
        this.scene.load.start();
    }

    private ensureDirectionalAnimations(
        kind: AINpcKind,
        state: 'idle' | 'walk',
        textureKey: string,
        frameRate: number,
        framesPerRow: number
    ) {
        for (let direction = 0; direction < 8; direction += 1) {
            const { row } = this.getRowAndMirrorForDirection(direction);
            const animKey = this.getAnimKey(kind, state, direction);
            if (this.scene.anims.exists(animKey)) continue;

            const start = row * framesPerRow;
            const end = start + framesPerRow - 1;

            this.scene.anims.create({
                key: animKey,
                frames: this.scene.anims.generateFrameNumbers(textureKey, { start, end }),
                frameRate,
                repeat: -1
            });
        }
    }

    private getAnimKey(kind: AINpcKind, state: 'idle' | 'walk', direction: number): string {
        return `ai-npc-${kind}-${state}-d${direction}`;
    }

    private getRowAndMirrorForDirection(direction: number): { row: number; mirrored: boolean } {
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
