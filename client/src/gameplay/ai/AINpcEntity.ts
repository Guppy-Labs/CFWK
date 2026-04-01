import Phaser from 'phaser';
import { IAiNpcHitbox, IAiNpcState, SOFT_COLLISION_FORCE } from '@cfwk/shared';
import { createNameplate } from '../player/PlayerVisualUtils';
import type { OcclusionManager } from '../map/OcclusionManager';
import { DepthManager, ENTITY_BASE, NAMEPLATE_OFFSET, Y_SORT_FACTOR } from '../rendering/DepthManager';
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
    private baseTint = 0xffffff;
    private hitFlashTween?: Phaser.Tweens.Tween;
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
        this.baseTint = config.state.tint || 0xffffff;
        this.sprite.setTint(this.baseTint);
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
        this.baseTint = nextState.tint || 0xffffff;
        if (!this.hitFlashTween) {
            this.sprite.setTint(this.baseTint);
        }
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
        const nameplateDepth = this.depthManager
            ? this.depthManager.nameplateDepth(this.sprite.depth)
            : this.sprite.depth + NAMEPLATE_OFFSET;
        this.nameplate.setDepth(nameplateDepth);

        this.waterSystem?.update(delta);
        this.shadow?.update();
    }

    destroy() {
        this.hitFlashTween?.stop();
        this.hitFlashTween = undefined;
        this.waterSystem?.destroy();
        this.shadow?.destroy();
        this.sprite.destroy();
        this.nameplate.destroy();
    }

    flashDamageHighlight(color: number, durationMs: number = 180) {
        if (!this.sprite.active) return;
        this.hitFlashTween?.stop();
        this.hitFlashTween = this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration: Math.max(60, durationMs),
            yoyo: true,
            onUpdate: (tween) => {
                const progress = tween.getValue() ?? 0;
                const tint = Phaser.Display.Color.Interpolate.ColorWithColor(
                    Phaser.Display.Color.IntegerToColor(this.baseTint),
                    Phaser.Display.Color.IntegerToColor(color),
                    1,
                    progress
                );
                this.sprite.setTint(Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b));
            },
            onComplete: () => {
                this.hitFlashTween = undefined;
                if (this.sprite.active) {
                    this.sprite.setTint(this.baseTint);
                }
            }
        });
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
        if (this.depthManager) {
            this.sprite.setDepth(this.depthManager.entityDepthFromSprite(this.sprite, { baseDepth: this.baseDepth }));
        } else {
            this.sprite.setDepth(this.baseDepth + this.sprite.getBottomLeft().y * Y_SORT_FACTOR);
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
        const state: 'idle' | 'walk' | 'attack' | 'death' =
            this.targetAnim === 'death'
                ? 'death'
                : (this.targetAnim === 'attack' ? 'attack' : (this.targetAnim === 'walk' ? 'walk' : 'idle'));
        const centerOffsetPx = this.definition.centerOffsetXByState?.[state] ?? 0;
        // The configured offset assumes the mirrored-left visual case.
        // Invert it for non-mirrored (right-facing) so the center correction matches direction.
        const directionAdjustedOffsetPx = this.sprite.flipX ? centerOffsetPx : -centerOffsetPx;
        const frameWidth = Math.max(1, this.sprite.frame?.realWidth ?? this.definition.frameWidth);
        const collidableHeight = Math.max(1, this.hitbox.collidableHeight || this.hitbox.height);
        const frameHeight = Math.max(1, this.sprite.frame?.realHeight ?? this.definition.frameHeight);
        const originX = Phaser.Math.Clamp(0.5 - (directionAdjustedOffsetPx / frameWidth), 0, 1);
        const originY = 1 - (collidableHeight / (2 * frameHeight));
        this.sprite.setOrigin(originX, originY);
    }

    private isMobile(): boolean {
        const os = this.scene.sys.game.device.os;
        return Boolean(os.android || os.iOS || os.iPad || os.iPhone || os.windowsPhone);
    }
}
