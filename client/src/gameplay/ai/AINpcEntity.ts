import Phaser from 'phaser';
import { IAiNpcHitbox, IAiNpcState, SOFT_COLLISION_FORCE } from '@cfwk/shared';
import { createNameplate } from '../player/PlayerVisualUtils';
import type { OcclusionManager } from '../map/OcclusionManager';
import { DepthManager, ENTITY_BASE, NAMEPLATE_OFFSET } from '../rendering/DepthManager';
import { LightingManager } from '../fx/LightingManager';
import { WaterSystem } from '../fx/water/WaterSystem';
import { PlayerShadow } from '../player/PlayerShadow';
import { AINpcVisualDefinition } from './AINpcRegistry';

export type AINpcEntityConfig = {
    definition: AINpcVisualDefinition;
    state: IAiNpcState;
    baseDepth: number;
    occlusionManager?: OcclusionManager;
    depthManager?: DepthManager;
    lightingManager?: LightingManager;
    groundLayers?: Phaser.Tilemaps.TilemapLayer[];
};

export class AINpcEntity {
    private scene: Phaser.Scene;
    private definition: AINpcVisualDefinition;
    private sprite: Phaser.GameObjects.Sprite;
    private nameplate: Phaser.GameObjects.Container;
    private targetX: number;
    private targetY: number;
    private targetAnim: string;
    private targetDirection: number;
    private baseDepth: number;
    private depthManager?: DepthManager;
    private debugPath: Array<{ x: number; y: number }> = [];
    private hitbox: IAiNpcHitbox;
    private waterSystem?: WaterSystem;
    private shadow?: PlayerShadow;

    constructor(scene: Phaser.Scene, config: AINpcEntityConfig) {
        this.scene = scene;
        this.definition = config.definition;
        this.targetX = config.state.x;
        this.targetY = config.state.y;
        this.targetAnim = config.state.anim;
        this.targetDirection = Number.isFinite(config.state.direction) ? config.state.direction : 0;
        this.baseDepth = config.baseDepth;
        this.depthManager = config.depthManager;
        this.hitbox = {
            width: config.state.hitbox?.width ?? this.definition.frameWidth,
            height: config.state.hitbox?.height ?? this.definition.frameHeight,
            collidableHeight: config.state.hitbox?.collidableHeight ?? 6
        };

        const textureKey = this.getTextureKey('idle');

        this.sprite = this.scene.add.sprite(config.state.x, config.state.y, textureKey, 0);
        this.sprite.setScale(this.definition.renderScale ?? 1);
        this.applySpriteOrigin();
        this.sprite.setTint(config.state.tint || 0xffffff);
        config.lightingManager?.enableLightingOn(this.sprite);

        this.applyAnimationByMotion(0, 0, 16);
        this.nameplate = createNameplate({
            scene: this.scene,
            text: this.definition.name,
            fontSize: this.isMobile() ? '10px' : '6px',
            yOffset: this.isMobile() ? -42 : -36,
            depth: ENTITY_BASE + NAMEPLATE_OFFSET,
            textColor: '#000000',
            hideBackground: true
        }).container;

        if (config.groundLayers && config.groundLayers.length > 0) {
            this.waterSystem = new WaterSystem(this.scene, this.sprite, config.groundLayers);
        }

        this.shadow = new PlayerShadow(this.scene, this.sprite, config.lightingManager);

        this.applyDepth();
    }

    updateFromState(nextState: IAiNpcState) {
        this.targetX = nextState.x;
        this.targetY = nextState.y;
        this.targetAnim = nextState.anim;
        this.targetDirection = Number.isFinite(nextState.direction) ? nextState.direction : this.targetDirection;
        this.sprite.setTint(nextState.tint || 0xffffff);
        this.hitbox = {
            width: nextState.hitbox?.width ?? this.hitbox.width,
            height: nextState.hitbox?.height ?? this.hitbox.height,
            collidableHeight: nextState.hitbox?.collidableHeight ?? this.hitbox.collidableHeight
        };
        this.applySpriteOrigin();
        this.debugPath = this.parseDebugPath(nextState.pathDebug);
    }

    update(delta: number) {
        const prevX = this.sprite.x;
        const prevY = this.sprite.y;
        const alpha = Phaser.Math.Clamp(delta / 100, 0.08, 0.35);
        this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, alpha);
        this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, alpha);

        const movedX = this.sprite.x - prevX;
        const movedY = this.sprite.y - prevY;
        this.applyAnimationByMotion(movedX, movedY, delta);

        this.applyDepth();
        this.nameplate.setPosition(this.sprite.x, this.sprite.y + (this.isMobile() ? -42 : -36));
        this.nameplate.setDepth(ENTITY_BASE + NAMEPLATE_OFFSET);

        this.waterSystem?.update(delta);
        this.shadow?.update();
    }

    destroy() {
        this.waterSystem?.destroy();
        this.shadow?.destroy();
        this.sprite.destroy();
        this.nameplate.destroy();
    }

    getDebugPath(): Array<{ x: number; y: number }> {
        return this.debugPath;
    }

    getPosition(): { x: number; y: number } {
        return { x: this.sprite.x, y: this.sprite.y };
    }

    getSoftCollisionFootprint(): { x: number; y: number; width: number; height: number } {
        return {
            x: this.sprite.x,
            y: this.sprite.y,
            width: Math.max(1, this.hitbox.width),
            height: Math.max(1, this.hitbox.collidableHeight || this.hitbox.height)
        };
    }

    applySoftCollisionNudge(dx: number, dy: number) {
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= 0.0001) return;

        const maxPerStep = SOFT_COLLISION_FORCE.maxPushPerStep;
        const scale = length > maxPerStep ? (maxPerStep / length) : 1;
        const pushX = dx * scale;
        const pushY = dy * scale;

        this.sprite.x += pushX;
        this.sprite.y += pushY;
        this.targetX += pushX;
        this.targetY += pushY;
        this.nameplate.setPosition(this.sprite.x, this.sprite.y + (this.isMobile() ? -42 : -36));
    }

    getDebugHitbox(): { x: number; y: number; width: number; height: number } {
        const width = Math.max(1, this.hitbox.width);
        const height = Math.max(1, this.hitbox.collidableHeight || this.hitbox.height);
        return {
            x: this.sprite.x - (width / 2),
            y: this.sprite.y - (height / 2),
            width,
            height
        };
    }

    private getTextureKey(state: 'idle' | 'walk' | 'attack' | 'death'): string {
        return `ai-npc-${this.definition.kind}-${state}-sheet`;
    }

    private getAnimKey(state: 'idle' | 'walk' | 'attack' | 'death', direction: number): string {
        return `ai-npc-${this.definition.kind}-${state}-d${direction}`;
    }

    private applyDepth() {
        const feetY = this.sprite.getBottomLeft().y;
        if (this.depthManager) {
            this.sprite.setDepth(this.depthManager.entityDepth(this.sprite.x, feetY, { baseDepth: this.baseDepth }));
        } else {
            this.sprite.setDepth(this.baseDepth + feetY * 0.01);
        }
    }

    private parseDebugPath(rawPath?: string): Array<{ x: number; y: number }> {
        if (!rawPath || rawPath.trim().length === 0) return [];
        return rawPath
            .split(';')
            .map((segment) => {
                const [xRaw, yRaw] = segment.split(',');
                const x = Number(xRaw);
                const y = Number(yRaw);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                return { x, y };
            })
            .filter((point): point is { x: number; y: number } => point !== null);
    }

    private applyAnimationByMotion(movedX: number, movedY: number, deltaMs: number) {
        const dtSec = Math.max(0.001, deltaMs / 1000);
        const speed = Math.hypot(movedX, movedY) / dtSec;
        const isMoving = speed > 0.35 || this.targetAnim === 'walk';
        const direction = ((Math.round(this.targetDirection) % 8) + 8) % 8;
        let state: 'idle' | 'walk' | 'attack' | 'death';
        if (this.targetAnim === 'death') {
            state = 'death';
        } else if (this.targetAnim === 'attack') {
            state = 'attack';
        } else {
            state = isMoving ? 'walk' : 'idle';
        }
        const animKey = this.getAnimKey(state, direction);

        const shouldMirror = this.definition.directionalMode === 'horizontal-only'
            ? (direction === 5 || direction === 6 || direction === 7)
            : (direction === 5 || direction === 6 || direction === 7);
        this.sprite.setFlipX(shouldMirror);

        if (this.sprite.anims.currentAnim?.key !== animKey) {
            this.sprite.play(animKey, true);
        }

        if (this.sprite.anims.currentAnim && state === 'walk') {
            const t = Phaser.Math.Clamp(speed / this.definition.walkAnimSpeedMaxVelocity, 0, 1);
            const targetRate = Phaser.Math.Linear(this.definition.walkAnimSpeedMin, this.definition.walkAnimSpeedMax, t);
            this.sprite.anims.timeScale = targetRate / this.definition.walkFrameRate;
            this.sprite.anims.forward = true;
        } else if (this.sprite.anims.currentAnim) {
            this.sprite.anims.timeScale = 1;
            this.sprite.anims.forward = true;
        }
    }

    private applySpriteOrigin() {
        const collidableHeight = Math.max(1, this.hitbox.collidableHeight || this.hitbox.height);
        const frameHeight = Math.max(1, this.sprite.frame?.realHeight ?? this.definition.frameHeight);
        const originY = 1 - (collidableHeight / (2 * frameHeight));
        this.sprite.setOrigin(0.5, originY);
    }

    private isMobile(): boolean {
        const os = this.scene.sys.game.device.os;
        return Boolean(os.android || os.iOS || os.iPad || os.iPhone || os.windowsPhone);
    }
}
