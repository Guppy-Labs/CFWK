import Phaser from 'phaser';
import { IAiNpcHitbox, IAiNpcState, SOFT_COLLISION_FORCE } from '@cfwk/shared';
import { createNameplate } from '../player/PlayerVisualUtils';
import type { OcclusionManager } from '../map/OcclusionManager';
import { DepthManager, ENTITY_BASE, NAMEPLATE_OFFSET, Y_SORT_FACTOR } from '../rendering/DepthManager';
import { LightingManager } from '../fx/LightingManager';
import { WaterSystem } from '../fx/water/WaterSystem';
import { PlayerShadow } from '../player/PlayerShadow';
import { AINpcVisualDefinition } from './AINpcRegistry';
import { getFootstepSurfaceAt } from '../audio/FootstepSurfaceDetector';
import type { AINpcManager } from './AINpcManager';
import type { AudioManager, FootstepSurface } from '../audio/AudioManager';

const GREMLIN_FOOTSTEP_INTERVAL_MS = 420;
const GREMLIN_FOOTSTEP_BASE_VOLUME = 0.07;
const GREMLIN_FOOTSTEP_PITCH_MULTIPLIER = 0.7;
const GREMLIN_FOOTSTEP_MAX_HEARING_RANGE_PX = 280;
const GREMLIN_FOOTSTEP_PITCH_MIN = 0.85;
const GREMLIN_FOOTSTEP_PITCH_MAX = 1.15;

const GREMLIN_IDLE_GRUNT_MIN_MS = 3500;
const GREMLIN_IDLE_GRUNT_MAX_MS = 8000;
const GREMLIN_CHASE_GRUNT_MIN_MS = 1500;
const GREMLIN_CHASE_GRUNT_MAX_MS = 3500;
const GREMLIN_CHASE_SECOND_GRUNT_DELAY_MS = 190;

const SURFACE_SOUND_KEYS: Record<FootstepSurface, string> = {
    sand: 'footstep-sand',
    grass: 'footstep-grass',
    stone: 'footstep-stone',
    wood: 'footstep-wood'
};

export type AINpcEntityConfig = {
    definition: AINpcVisualDefinition;
    state: IAiNpcState;
    baseDepth: number;
    occlusionManager?: OcclusionManager;
    depthManager?: DepthManager;
    lightingManager?: LightingManager;
    groundLayers?: Phaser.Tilemaps.TilemapLayer[];
    manager?: AINpcManager;
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
    private destroyed = false;
    private lastFootstepTime = 0;
    private manager?: AINpcManager;
    private lastOriginState: string = '';
    private lastOriginFlipX = false;
    private lastAnim: string = '';
    private lastPathDebug: string = '';
    private nextPeriodicGruntAtMs = 0;
    private currentAttackSwingSound?: Phaser.Sound.WebAudioSound;
    private attackSwingPendingLand = false;
    private pendingSecondGruntTimer?: Phaser.Time.TimerEvent;

    constructor(scene: Phaser.Scene, config: AINpcEntityConfig) {
        this.scene = scene;
        this.definition = config.definition;
        this.manager = config.manager;
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

        this.lastAnim = config.state.anim;
        this.lastPathDebug = config.state.pathDebug ?? '';
        this.nextPeriodicGruntAtMs = Date.now() + this.randomPeriodicGruntInterval();

        this.applyDepth();
    }

    private randomPeriodicGruntInterval(): number {
        const chasing = this.lastPathDebug.length > 0;
        const minMs = chasing ? GREMLIN_CHASE_GRUNT_MIN_MS : GREMLIN_IDLE_GRUNT_MIN_MS;
        const maxMs = chasing ? GREMLIN_CHASE_GRUNT_MAX_MS : GREMLIN_IDLE_GRUNT_MAX_MS;
        const spread = Math.max(1, maxMs - minMs);
        return minMs + Math.floor(Math.random() * spread);
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
        this.lastOriginState = '';
        this.debugPath = this.parseDebugPath(nextState.pathDebug);

        this.handleGremlinStateTransitions(nextState);
    }

    private handleGremlinStateTransitions(nextState: IAiNpcState) {
        if (this.destroyed) return;
        if (this.definition.kind !== 'gremlin') return;

        const prevAnim = this.lastAnim;
        const prevPath = this.lastPathDebug;
        const nextAnim = nextState.anim;
        const nextPath = nextState.pathDebug ?? '';

        this.lastAnim = nextAnim;
        this.lastPathDebug = nextPath;

        // Stop periodic grunts once dead and let any pending swing finish naturally.
        if (nextAnim === 'death' || nextState.currentHealth <= 0) return;

        const wasChasing = prevPath.length > 0;
        const isChasing = nextPath.length > 0;

        if (!wasChasing && isChasing) {
            this.playChaseStartGrunts();
        }

        if (prevAnim !== 'attack' && nextAnim === 'attack') {
            this.playAttackSwing();
            // A vocalization alongside the swing reads well ("as they attack").
            this.playGruntNow();
        }
    }

    private getListenerDistance(): number | undefined {
        const ctx = this.manager?.getFootstepContext();
        const playerPos = ctx?.playerPos;
        if (!playerPos) return undefined;
        return Math.hypot(this.sprite.x - playerPos.x, this.sprite.y - playerPos.y);
    }

    private getAudioManager(): AudioManager | undefined {
        return this.manager?.getFootstepContext().audioManager;
    }

    private playGruntNow() {
        if (this.destroyed || this.definition.kind !== 'gremlin') return;
        if (this.targetAnim === 'death') return;
        const audio = this.getAudioManager();
        const distance = this.getListenerDistance();
        if (!audio || distance === undefined) return;
        audio.playGremlinGrunt(distance);
    }

    private playChaseStartGrunts() {
        this.playGruntNow();
        // Second grunt back-to-back for emphasis when chase begins.
        this.pendingSecondGruntTimer?.remove(false);
        this.pendingSecondGruntTimer = this.scene.time.delayedCall(
            GREMLIN_CHASE_SECOND_GRUNT_DELAY_MS,
            () => {
                this.pendingSecondGruntTimer = undefined;
                this.playGruntNow();
            }
        );
        // Re-seed the periodic timer so subsequent grunts use the faster chase cadence.
        this.nextPeriodicGruntAtMs = Date.now() + this.randomPeriodicGruntInterval();
    }

    private playAttackSwing() {
        if (this.destroyed || this.definition.kind !== 'gremlin') return;
        const audio = this.getAudioManager();
        const distance = this.getListenerDistance();
        if (!audio || distance === undefined) return;

        // If a previous swing is still going, replace it cleanly.
        if (this.currentAttackSwingSound) {
            this.currentAttackSwingSound.off('complete');
            this.currentAttackSwingSound.stop();
            this.currentAttackSwingSound.destroy();
            this.currentAttackSwingSound = undefined;
        }
        this.attackSwingPendingLand = false;

        const swing = audio.playGremlinWeaponSwing(distance);
        if (!swing) return;

        this.currentAttackSwingSound = swing;
        swing.once('complete', () => {
            if (this.currentAttackSwingSound === swing) {
                this.currentAttackSwingSound = undefined;
            }
            if (this.attackSwingPendingLand) {
                this.attackSwingPendingLand = false;
                this.playAttackLand();
            }
        });
    }

    private playAttackLand() {
        if (this.destroyed || this.definition.kind !== 'gremlin') return;
        const audio = this.getAudioManager();
        const distance = this.getListenerDistance();
        if (!audio || distance === undefined) return;
        audio.playGremlinWeaponLand(distance);
    }

    /**
     * Called by the manager when the server confirms this gremlin's attack
     * actually damaged a player. Chains the "land" sound back-to-back after
     * the currently-playing swing (or plays immediately if swing is done).
     */
    onAttackHit() {
        if (this.destroyed || this.definition.kind !== 'gremlin') return;
        if (this.currentAttackSwingSound && this.currentAttackSwingSound.isPlaying) {
            this.attackSwingPendingLand = true;
            return;
        }
        this.playAttackLand();
    }

    private updatePeriodicGrunts() {
        if (this.destroyed || this.definition.kind !== 'gremlin') return;
        if (this.targetAnim === 'death') return;

        const now = Date.now();
        if (now < this.nextPeriodicGruntAtMs) return;

        this.nextPeriodicGruntAtMs = now + this.randomPeriodicGruntInterval();
        this.playGruntNow();
    }

    update(delta: number) {
        if (this.destroyed || !this.sprite || !this.sprite.active || !this.sprite.anims) return;
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
        this.updateFootsteps(movedX, movedY);
        this.updatePeriodicGrunts();
    }

    private updateFootsteps(movedX: number, movedY: number) {
        if (!this.manager || this.definition.kind !== 'gremlin') return;
        if (this.targetAnim !== 'walk' && this.targetAnim !== 'idle') return;

        const speed = Math.hypot(movedX, movedY);
        if (speed < 0.15) return;

        const now = Date.now();
        if (now - this.lastFootstepTime < GREMLIN_FOOTSTEP_INTERVAL_MS) return;
        this.lastFootstepTime = now;

        const ctx = this.manager.getFootstepContext();
        if (!ctx.audioManager || !ctx.map) return;

        const surface = getFootstepSurfaceAt(ctx.map, this.sprite.x, this.sprite.y, ctx.mapFile);
        const soundKey = SURFACE_SOUND_KEYS[surface];
        if (!this.scene.cache.audio.exists(soundKey)) return;

        const playerPos = ctx.playerPos;
        if (!playerPos) return;

        const dist = Math.hypot(this.sprite.x - playerPos.x, this.sprite.y - playerPos.y);
        if (dist > GREMLIN_FOOTSTEP_MAX_HEARING_RANGE_PX) return;

        const distanceFalloff = 1 - (dist / GREMLIN_FOOTSTEP_MAX_HEARING_RANGE_PX);
        const volume = ctx.audioManager.getEffectiveNpcVolume(
            GREMLIN_FOOTSTEP_BASE_VOLUME * distanceFalloff
        );
        if (volume < 0.001) return;

        const pitchRange = GREMLIN_FOOTSTEP_PITCH_MAX - GREMLIN_FOOTSTEP_PITCH_MIN;
        const pitchVariation = GREMLIN_FOOTSTEP_PITCH_MIN + Math.random() * pitchRange;
        const rate = pitchVariation * GREMLIN_FOOTSTEP_PITCH_MULTIPLIER;
        const detune = (pitchVariation * GREMLIN_FOOTSTEP_PITCH_MULTIPLIER - 1) * 200;

        const footstep = this.scene.sound.add(soundKey, { volume, rate, detune }) as Phaser.Sound.WebAudioSound;
        footstep.play();
        footstep.once('complete', () => footstep.destroy());

        this.manager.reportGremlinFootstep(surface);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.hitFlashTween?.stop();
        this.hitFlashTween = undefined;
        this.pendingSecondGruntTimer?.remove(false);
        this.pendingSecondGruntTimer = undefined;
        if (this.currentAttackSwingSound) {
            this.currentAttackSwingSound.off('complete');
            this.currentAttackSwingSound.stop();
            this.currentAttackSwingSound.destroy();
            this.currentAttackSwingSound = undefined;
        }
        this.attackSwingPendingLand = false;
        this.waterSystem?.destroy();
        this.shadow?.destroy();
        this.sprite?.destroy();
        this.nameplate?.destroy();
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

    isDestroyed(): boolean {
        return this.destroyed || !this.sprite || !this.sprite.active;
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
        if (this.destroyed || !this.sprite || !this.sprite.active || !this.sprite.anims) return;
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

        if (this.scene.anims.exists(animKey) && this.sprite.anims.currentAnim?.key !== animKey) {
            this.sprite.play(animKey, true);
        }

        if (state !== this.lastOriginState || shouldMirror !== this.lastOriginFlipX) {
            this.lastOriginState = state;
            this.lastOriginFlipX = shouldMirror;
            this.applySpriteOrigin(state);
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

    private applySpriteOrigin(displayedState?: 'idle' | 'walk' | 'attack' | 'death') {
        if (this.destroyed || !this.sprite || !this.sprite.active) return;
        const state: 'idle' | 'walk' | 'attack' | 'death' = displayedState ??
            (this.targetAnim === 'death' ? 'death'
                : (this.targetAnim === 'attack' ? 'attack'
                    : (this.targetAnim === 'walk' ? 'walk' : 'idle')));

        const centerOffsetXPx = this.definition.centerOffsetXByState?.[state] ?? 0;
        const centerOffsetYPx = this.definition.centerOffsetYByState?.[state] ?? 0;

        // Tuner measures offsets for the unflipped (right-facing) sprite.
        // Negate X when flipped (left-facing) since mirroring swaps left/right.
        const dirXPx = this.sprite.flipX ? -centerOffsetXPx : centerOffsetXPx;

        const frameW = Math.max(1, this.sprite.frame?.realWidth ?? this.definition.frameWidth);
        const frameH = Math.max(1, this.sprite.frame?.realHeight ?? this.definition.frameHeight);
        const colH = Math.max(1, this.hitbox.collidableHeight || this.hitbox.height);
        const idleH = Math.max(1, this.definition.frameHeightByState?.idle ?? this.definition.frameHeight);

        const originX = 0.5 - (dirXPx / frameW);
        // Anchor at feet using idle frame height as reference so that character
        // center stays at a consistent screen position across all animation states.
        const originY = 0.5 + (idleH - colH - 2 * centerOffsetYPx) / (2 * frameH);

        this.sprite.setOrigin(originX, originY);
    }

    private isMobile(): boolean {
        const os = this.scene.sys.game.device.os;
        return Boolean(os.android || os.iOS || os.iPad || os.iPhone || os.windowsPhone);
    }
}
