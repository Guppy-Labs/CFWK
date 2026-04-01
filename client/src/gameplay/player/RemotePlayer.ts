import Phaser from 'phaser';
import type { OcclusionManager } from '../map/OcclusionManager';
import { GuiSwirlEffect } from '../fx/GuiSwirlEffect';
import { SharedMCTextures } from './SharedMCTextures';
import { WaterSystem } from '../fx/water/WaterSystem';
import { PlayerShadow } from './PlayerShadow';
import { createChatBubble, createIconBubble, createNameplate } from './PlayerVisualUtils';
import { DepthManager, ENTITY_BASE, NAMEPLATE_OFFSET, CHAT_BUBBLE_DEPTH, Y_SORT_FACTOR } from '../rendering/DepthManager';
import { MCAnimationType, MC_FRAME_DIMENSIONS_BY_ANIM, SOFT_COLLISION_FORCE, PLAYER_RENDER_SCALE } from '@cfwk/shared';
import type { LightingManager } from '../fx/LightingManager';
import { ItemTextureLoader } from '../assets/ItemTextureLoader';

/**
 * MCDirection type for MC character system
 */
type MCDirection = 'N' | 'S' | 'E' | 'W' | 'NE' | 'SE' | 'NW' | 'SW';

/**
 * Direction enum matching PlayerAnimationController
 */
enum Direction {
    Down = 0,
    DownRight = 1,
    Right = 2,
    UpRight = 3,
    Up = 4,
    UpLeft = 5,
    Left = 6,
    DownLeft = 7
}

/**
 * Map direction index to MC direction
 */
const DIRECTION_TO_MC: Record<Direction, MCDirection> = {
    [Direction.Down]: 'S',
    [Direction.DownRight]: 'SE',
    [Direction.Right]: 'E',
    [Direction.UpRight]: 'NE',
    [Direction.Up]: 'N',
    [Direction.UpLeft]: 'NW',
    [Direction.Left]: 'W',
    [Direction.DownLeft]: 'SW'
};

/**
 * Unit vectors for each facing direction (used for shove forward/backward detection)
 */
const DIRECTION_VECTORS: Record<Direction, { x: number; y: number }> = {
    [Direction.Down]:      { x:  0,     y:  1     },
    [Direction.DownRight]: { x:  0.707, y:  0.707 },
    [Direction.Right]:     { x:  1,     y:  0     },
    [Direction.UpRight]:   { x:  0.707, y: -0.707 },
    [Direction.Up]:        { x:  0,     y: -1     },
    [Direction.UpLeft]:    { x: -0.707, y: -0.707 },
    [Direction.Left]:      { x: -1,     y:  0     },
    [Direction.DownLeft]:  { x: -0.707, y:  0.707 }
};


/**
 * Pixel particle for spawn/despawn effects
 */
interface PixelParticle {
    graphics: Phaser.GameObjects.Graphics;
    targetX: number;
    targetY: number;
    startX: number;
    startY: number;
    color: number;
    size: number;
    progress: number;
    delay: number;
}

interface InterpolationSample {
    time: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
}

export type RemotePlayerConfig = {
    sessionId: string;
    username: string;
    odcid: string;
    x: number;
    y: number;
    direction: number;
    depth: number;
    occlusionManager?: OcclusionManager;
    depthManager?: DepthManager;
    skipSpawnEffect?: boolean; // True for players already in room on initial sync
    isAfk?: boolean; // Initial AFK state
    afkSince?: number; // Server timestamp (ms) when AFK started
    isGuiOpen?: boolean; // Initial GUI open state
    isChatOpen?: boolean; // Initial chat open/focused state
    isPremium?: boolean; // Shark tier badge
    groundLayers?: Phaser.Tilemaps.TilemapLayer[];
    walkAnimSpeedMin?: number;
    walkAnimSpeedMax?: number;
    walkAnimSpeedMaxVelocity?: number;
    lightingManager?: LightingManager;
    /** Custom animation key getter for per-player appearance - returns animation key for anim + direction */
    customAnimationKeyGetter?: (anim: string, direction: MCDirection) => string | undefined;
};

/**
 * Represents another player in the game world.
 * Renders their character sprite with color tint and nameplate.
 */
export class RemotePlayer {
    private scene: Phaser.Scene;
    private sessionId: string;
    private username: string;
    private isPremium: boolean = false;
    
    private sprite!: Phaser.GameObjects.Sprite;
    private nameplate!: Phaser.GameObjects.Container;
    private afkTimerText?: Phaser.GameObjects.Text;
    private nameplateHeight = 0;
    
    private targetX: number;
    private targetY: number;
    private currentDirection: Direction = Direction.Down;
    private currentAnim: string = 'idle';
    private playerColor: number = 0xffffff;
    private baseDepth: number;
    private depthManager?: DepthManager;
    private chatBubble?: Phaser.GameObjects.Container;
    private chatTimer?: Phaser.Time.TimerEvent;
    private fishingBubble?: Phaser.GameObjects.Container;
    private fishingTimer?: Phaser.Time.TimerEvent;
    private readonly itemTextureLoader = ItemTextureLoader.getInstance();
    private waterSystem?: WaterSystem;
    
    /** Custom animation key getter for per-player appearance */
    private customAnimationKeyGetter?: (anim: string, direction: MCDirection) => string | undefined;

    // Interpolation
    private readonly interpolationBufferMax = 40;
    private interpolationBuffer: InterpolationSample[] = [];
    private readonly interpolationDelayMinMs = 90;
    private readonly interpolationDelayMaxMs = 260;
    private readonly extrapolationLimitMs = 120;
    private readonly smoothingTimeConstantMs = 45;
    private readonly snapDistancePx = 110;
    private packetIntervalAvgMs = 110;
    private packetJitterAvgMs = 0;
    private readonly chatBubbleGap = 10;
    private readonly scale = PLAYER_RENDER_SCALE;
    private readonly hitboxWidth = 16;
    private readonly collidableHeight = 6;
    private readonly walkFrameRate = 10;
    private walkAnimSpeedMin = 6;
    private walkAnimSpeedMax = 14;
    private walkAnimSpeedMaxVelocity = 3.2;

    // Spawn effect
    private particles: PixelParticle[] = [];
    private isSpawning: boolean = true;
    private readonly spawnDuration: number = 800; // ms
    private spawnStartTime: number = 0;

    // Despawn callback
    private onDespawnComplete?: () => void;

    // AFK state
    private isAfk: boolean = false;
    private afkAlpha: number = 1;
    private readonly afkTargetAlpha = 0.4;
    private readonly afkCountdownMs = 240000; // 4 minutes base (exclude 1 min pre)
    private readonly afkCountdownPremiumMs = 1140000; // 19 minutes for Shark tier (exclude 1 min pre)
    private afkStartTime: number | null = null;
    private isGuiOpen: boolean = false;
    private isChatOpen: boolean = false;
    private guiEffect?: GuiSwirlEffect;
    private nameplateYOffset: number = -36;
    private destroyed: boolean = false;
    private isPlayingInteract: boolean = false;
    private shadow?: PlayerShadow;
    private lightingManager?: LightingManager;
    /** Timestamp (scene.time.now) until which shove animation overrides normal anim */
    private shovedUntil: number = 0;
    private shoveParticles: { gfx: Phaser.GameObjects.Graphics; vx: number; vy: number; x: number; y: number; life: number; maxLife: number; size: number; color: number }[] = [];

    constructor(scene: Phaser.Scene, config: RemotePlayerConfig) {
        this.scene = scene;
        this.sessionId = config.sessionId;
        this.username = config.username;
        this.isPremium = !!config.isPremium;
        this.targetX = config.x;
        this.targetY = config.y;
        this.currentDirection = config.direction as Direction;
        this.baseDepth = config.depth;
        this.depthManager = config.depthManager;
        this.lightingManager = config.lightingManager;
        this.customAnimationKeyGetter = config.customAnimationKeyGetter;
        this.walkAnimSpeedMin = config.walkAnimSpeedMin ?? this.walkAnimSpeedMin;
        this.walkAnimSpeedMax = config.walkAnimSpeedMax ?? this.walkAnimSpeedMax;
        this.walkAnimSpeedMaxVelocity = config.walkAnimSpeedMaxVelocity ?? this.walkAnimSpeedMaxVelocity;
        
        // Check for mobile device (Android, iOS, etc.)
        const os = this.scene.sys.game.device.os;
        const isMobile = os.android || os.iOS || os.iPad || os.iPhone || os.windowsPhone;

        // Adjust settings for mobile
        const fontSize = isMobile ? '10px' : '6px';
        this.nameplateYOffset = isMobile ? -42 : -36;

        this.playerColor = 0xffffff;
        
        this.createSprite(config.x, config.y, config.skipSpawnEffect);
        this.createNameplate(config.skipSpawnEffect, fontSize);
        this.shadow = new PlayerShadow(this.scene, this.sprite, this.lightingManager);
        // Hide shadow during spawn particle effect
        if (!config.skipSpawnEffect) {
            this.shadow.setVisible(false);
        }
        this.currentAnim = 'idle';
        this.updateAnimation(this.currentAnim, this.currentDirection);

        if (config.groundLayers && config.groundLayers.length > 0) {
            this.waterSystem = new WaterSystem(this.scene, this.sprite, config.groundLayers);
        }

        this.guiEffect = new GuiSwirlEffect(this.scene);
        this.isChatOpen = !!config.isChatOpen;
        this.guiEffect.setActive(!!config.isGuiOpen || !!config.isChatOpen);

        if (config.isGuiOpen) {
            this.isGuiOpen = true;
        }

        if (config.isChatOpen) {
            this.isChatOpen = true;
        }

        if (config.isAfk) {
            this.setAfk(true, config.afkSince || 0);
        }
    }

    private createSprite(x: number, y: number, skipSpawnEffect?: boolean) {
        // Try to use MC texture if available, otherwise create a colored placeholder
        const sharedMC = SharedMCTextures.getInstance();
        const defaultTextureKey = sharedMC.getTextureKey('S'); // Default south-facing
        
        if (defaultTextureKey && this.scene.textures.exists(defaultTextureKey)) {
            this.sprite = this.scene.add.sprite(x, y, defaultTextureKey, 0);
        } else {
            // Fallback: create colored rectangle texture
            const fallbackKey = `remote-player-${this.sessionId}`;
            if (!this.scene.textures.exists(fallbackKey)) {
                const graphics = this.scene.make.graphics({}, false);
                graphics.fillStyle(this.playerColor);
                graphics.fillRect(0, 0, 16, 27);
                graphics.generateTexture(fallbackKey, 16, 27);
                graphics.destroy();
            }
            this.sprite = this.scene.add.sprite(x, y, fallbackKey);
            // Only tint the fallback placeholder (white)
            this.sprite.setTint(this.playerColor);
        }
        
        // Match MCPlayerController dimensions exactly:
        // - Base dimensions: 16x27 (MC_FRAME_DIMENSIONS['S'])
        // - Scale: PLAYER_RENDER_SCALE
        const baseHeight = 27;
        const scaledHeight = baseHeight * this.scale;
        const collidableHeight = this.collidableHeight * this.scale;
        
        // Use setScale instead of setDisplaySize to preserve texture proportions
        this.sprite.setScale(this.scale);
        
        // Match origin so feet align with position (same formula as MCPlayerController)
        const originY = 1 - collidableHeight / (2 * scaledHeight);
        this.sprite.setOrigin(0.5, originY);
        
        this.sprite.setDepth(this.baseDepth);

        // Start with sprite hidden for spawn effect (unless skipped)
        if (skipSpawnEffect) {
            this.isSpawning = false;
            this.sprite.setAlpha(1);
        } else {
            this.sprite.setAlpha(0);
            this.startSpawnEffect();
        }
    }

    /**
     * Create the pixel assembly spawn effect
     */
    private startSpawnEffect() {
        this.isSpawning = true;
        this.spawnStartTime = this.scene.time.now;
        this.particles = [];

        // Get player dimensions (match MCPlayerController: 16x27 base, PLAYER_RENDER_SCALE)
        const width = 16 * this.scale;
        const height = 27 * this.scale;
        const pixelSize = 2;
        const numParticles = 40; // Number of particles to use

        // Create particles that will fly in from random directions
        for (let i = 0; i < numParticles; i++) {
            // Random position within player bounds (target position)
            const localX = (Math.random() - 0.5) * width;
            const localY = (Math.random() - 0.5) * height;
            
            // Start position - fly in from random direction, far away
            const angle = Math.random() * Math.PI * 2;
            const distance = 80 + Math.random() * 60;
            const startX = this.sprite.x + localX + Math.cos(angle) * distance;
            const startY = this.sprite.y + localY - 16 + Math.sin(angle) * distance;
            
            // Target position relative to sprite
            const targetX = this.sprite.x + localX;
            const targetY = this.sprite.y + localY - 16; // Offset for origin

            const graphics = this.scene.add.graphics();
            graphics.setDepth(ENTITY_BASE + 1);
            
            this.particles.push({
                graphics,
                targetX,
                targetY,
                startX,
                startY,
                color: 0xffffff,
                size: pixelSize + Math.random() * 2,
                progress: 0,
                delay: Math.random() * 0.3 // Stagger arrival
            });
        }
    }

    /**
     * Start the despawn effect (reverse of spawn)
     */
    startDespawnEffect(onComplete: () => void) {
        this.onDespawnComplete = onComplete;
        this.isSpawning = false;
        this.spawnStartTime = this.scene.time.now;
        this.particles = [];

        // Hide the sprite
        this.sprite.setAlpha(0);
        this.nameplate.setAlpha(0);

        // Get player dimensions (match MCPlayerController: 16x27 base, PLAYER_RENDER_SCALE)
        const width = 16 * this.scale;
        const height = 27 * this.scale;
        const pixelSize = 2;
        const numParticles = 40;

        // Create particles that will fly out
        for (let i = 0; i < numParticles; i++) {
            // Start position within player bounds
            const localX = (Math.random() - 0.5) * width;
            const localY = (Math.random() - 0.5) * height;
            
            const startX = this.sprite.x + localX;
            const startY = this.sprite.y + localY - 16;
            
            // Target position - fly out in random direction
            const angle = Math.random() * Math.PI * 2;
            const distance = 80 + Math.random() * 60;
            const targetX = startX + Math.cos(angle) * distance;
            const targetY = startY + Math.sin(angle) * distance;

            const graphics = this.scene.add.graphics();
            graphics.setDepth(ENTITY_BASE + 1);
            
            this.particles.push({
                graphics,
                targetX,
                targetY,
                startX,
                startY,
                color: 0xffffff,
                size: pixelSize + Math.random() * 2,
                progress: 0,
                delay: Math.random() * 0.2
            });
        }
    }

    private createNameplate(skipSpawnEffect?: boolean, fontSize: string = '6px') {
        const nameplate = createNameplate({
            scene: this.scene,
            text: this.username,
            isPremium: this.isPremium,
            fontSize,
            yOffset: this.nameplateYOffset,
            depth: ENTITY_BASE + NAMEPLATE_OFFSET,
            includeAfkTimer: true
        });

        this.nameplate = nameplate.container;
        this.afkTimerText = nameplate.afkTimerText;
        this.nameplateHeight = nameplate.nameText.height + 2; // padding.y * 2 from createNameplate

        this.nameplate.setPosition(this.sprite.x, this.sprite.y + this.nameplateYOffset);
        this.nameplate.setAlpha(skipSpawnEffect ? 1 : 0);
    }

    /**
     * Update position from server state
     */
    setPosition(x: number, y: number, serverTime?: number) {
        if (this.destroyed) return;
        const dx = x - this.targetX;
        const dy = y - this.targetY;
        
        this.targetX = x;
        this.targetY = y;
        const sampleTime = Number.isFinite(serverTime) ? Number(serverTime) : Date.now();
        const prev = this.interpolationBuffer[this.interpolationBuffer.length - 1];
        const safeSampleTime = prev ? Math.max(sampleTime, prev.time + 1) : sampleTime;
        const dtMs = prev ? Math.max(1, safeSampleTime - prev.time) : 1;
        const vx = prev ? ((x - prev.x) / dtMs) : 0;
        const vy = prev ? ((y - prev.y) / dtMs) : 0;

        if (prev) {
            const interval = safeSampleTime - prev.time;
            const alpha = 0.15;
            const prevAvg = this.packetIntervalAvgMs;
            this.packetIntervalAvgMs = Phaser.Math.Linear(prevAvg, interval, alpha);
            this.packetJitterAvgMs = Phaser.Math.Linear(this.packetJitterAvgMs, Math.abs(interval - prevAvg), alpha);
        }

        this.interpolationBuffer.push({
            time: safeSampleTime,
            x,
            y,
            vx,
            vy
        });
        if (this.interpolationBuffer.length > this.interpolationBufferMax) {
            this.interpolationBuffer.splice(0, this.interpolationBuffer.length - this.interpolationBufferMax);
        }

        // If spawning, also update particle targets so they fly to the correct position
        if (this.isSpawning && this.particles.length > 0) {
            for (const particle of this.particles) {
                particle.targetX += dx;
                particle.targetY += dy;
                // Also move start positions so particles maintain their relative trajectories
                particle.startX += dx;
                particle.startY += dy;
            }
            // Move the hidden sprite too
            this.sprite.x = x;
            this.sprite.y = y;
        }
    }

    /**
     * Update animation state from server
     */
    setAnimation(anim: string, direction: number) {
        if (this.destroyed) return;
        this.currentDirection = direction as Direction;
        this.currentAnim = anim;
        this.updateAnimation(this.currentAnim, this.currentDirection);
    }

    /**
     * Update the animation key getter after textures are generated
     */
    setCustomAnimationKeyGetter(getter?: (anim: string, direction: MCDirection) => string | undefined) {
        if (this.destroyed) return;
        this.customAnimationKeyGetter = getter;
        this.updateAnimation(this.currentAnim, this.currentDirection);
    }

    /**
     * Set AFK state from server
     */
    setAfk(isAfk: boolean, afkSince?: number) {
        if (this.destroyed) return;
        const shouldUpdateAfkSince = isAfk && afkSince && afkSince > 0 && this.afkStartTime !== afkSince;

        if (this.isAfk !== isAfk) {
            this.isAfk = isAfk;
        } else if (!shouldUpdateAfkSince) {
            return;
        }

        if (isAfk) {
            this.afkStartTime = afkSince && afkSince > 0 ? afkSince : (this.afkStartTime ?? Date.now());
        } else {
            this.afkStartTime = null;
        }

        if (this.afkTimerText) {
            this.afkTimerText.setVisible(isAfk);
        }
    }

    setGuiOpen(isOpen: boolean) {
        if (this.destroyed) return;
        this.isGuiOpen = isOpen;
        this.guiEffect?.setActive(isOpen || this.isChatOpen);
    }

    setChatOpen(isOpen: boolean) {
        if (this.destroyed) return;
        this.isChatOpen = isOpen;
        this.guiEffect?.setActive(this.isGuiOpen || isOpen);
    }

    private updateAnimation(anim: string, direction: Direction) {
        if (this.destroyed || !this.sprite || !this.sprite.anims) return;
        if (this.isPlayingInteract) return;
        // Convert to MC direction
        const mcDir = DIRECTION_TO_MC[direction];
        
        // MC textures are pre-flipped, so no need for setFlipX
        this.sprite.setFlipX(false);
        
        // Try custom animation key first (per-player appearance), fallback to shared MC
        let animKey: string | undefined;
        
        if (this.customAnimationKeyGetter) {
            animKey = this.customAnimationKeyGetter(anim, mcDir);
            if (!animKey) {
                console.warn(`[RemotePlayer] customAnimationKeyGetter returned undefined for ${this.sessionId} anim ${anim} dir ${mcDir}`);
            }
        }
        
        // Fallback to remote-default animation, then legacy key.
        if (!animKey) {
            const sharedMC = SharedMCTextures.getInstance();
            const sharedKey = sharedMC.getAnimationKey(mcDir, anim as MCAnimationType);
            animKey = this.scene.anims.exists(sharedKey) ? sharedKey : `mc-${anim}-${mcDir}`;
        }
        
        if (this.scene.anims.exists(animKey) && this.sprite.anims.currentAnim?.key !== animKey) {
            this.sprite.play(animKey);
        }

        this.updateSpriteOrigin(anim, mcDir);
    }

    private updateSpriteOrigin(anim: string, direction: MCDirection) {
        if (this.destroyed || !this.sprite) return;
        const animType: MCAnimationType = anim === 'idle' || anim === 'walk' || anim === 'run' ? anim : 'walk';
        const dimensions = MC_FRAME_DIMENSIONS_BY_ANIM[animType][direction];
        const scaledWidth = dimensions.width * this.scale;
        const scaledHeight = dimensions.height * this.scale;
        const scaledCollidableHeight = this.collidableHeight * this.scale;

        this.sprite.setDisplaySize(scaledWidth, scaledHeight);

        const originY = 1 - scaledCollidableHeight / (2 * scaledHeight);

        if (dimensions.width > this.hitboxWidth) {
            const extraWidth = dimensions.width - this.hitboxWidth;
            const extraScaled = extraWidth * this.scale;

            if (direction === 'E' || direction === 'NE' || direction === 'SE') {
                const originX = 0.5 + (extraScaled / 2) / scaledWidth;
                this.sprite.setOrigin(originX, originY);
            } else if (direction === 'W' || direction === 'NW' || direction === 'SW') {
                const originX = 0.5 - (extraScaled / 2) / scaledWidth;
                this.sprite.setOrigin(originX, originY);
            } else {
                this.sprite.setOrigin(0.5, originY);
            }
        } else {
            this.sprite.setOrigin(0.5, originY);
        }
    }

    /**
     * Update every frame - interpolate position and particle effects
     */
    update(delta: number) {
        if (this.destroyed || !this.sprite || !this.nameplate) return;
        // Update particle effects
        if (this.particles.length > 0) {
            this.updateParticles();
        }

        // Update shove dirt particles
        if (this.shoveParticles.length > 0) {
            this.updateShoveParticles(delta);
        }

        // Don't update position while spawning
        if (this.isSpawning && this.particles.length > 0) return;

        // Guard: skip update if sprite frame is not ready (texture still loading)
        if (!this.sprite.frame || !this.sprite.anims) return;

        // Buffered interpolation using adaptive delay + short extrapolation.
        const prevX = this.sprite.x;
        const prevY = this.sprite.y;
        const adaptiveDelayMs = Phaser.Math.Clamp(
            this.packetIntervalAvgMs + this.packetJitterAvgMs * 2.2,
            this.interpolationDelayMinMs,
            this.interpolationDelayMaxMs
        );
        const renderTime = Date.now() - adaptiveDelayMs;

        let targetRenderX = this.targetX;
        let targetRenderY = this.targetY;

        if (this.interpolationBuffer.length > 0) {
            while (this.interpolationBuffer.length >= 2 && this.interpolationBuffer[1].time <= renderTime) {
                this.interpolationBuffer.shift();
            }

            const first = this.interpolationBuffer[0];
            const second = this.interpolationBuffer[1];
            if (first && second && renderTime >= first.time && renderTime <= second.time) {
                const span = Math.max(1, second.time - first.time);
                const t = Phaser.Math.Clamp((renderTime - first.time) / span, 0, 1);
                const tt = t * t;
                const ttt = tt * t;
                const h00 = 2 * ttt - 3 * tt + 1;
                const h10 = ttt - 2 * tt + t;
                const h01 = -2 * ttt + 3 * tt;
                const h11 = ttt - tt;
                targetRenderX = h00 * first.x + h10 * span * first.vx + h01 * second.x + h11 * span * second.vx;
                targetRenderY = h00 * first.y + h10 * span * first.vy + h01 * second.y + h11 * span * second.vy;
            } else if (first) {
                const aheadMs = Math.max(0, renderTime - first.time);
                const extrapolationMs = Math.min(this.extrapolationLimitMs, aheadMs);
                targetRenderX = first.x + first.vx * extrapolationMs;
                targetRenderY = first.y + first.vy * extrapolationMs;
            }
        }

        const smoothingAlpha = 1 - Math.exp(-Math.max(1, delta) / this.smoothingTimeConstantMs);
        const diffX = targetRenderX - this.sprite.x;
        const diffY = targetRenderY - this.sprite.y;
        if ((diffX * diffX) + (diffY * diffY) > this.snapDistancePx * this.snapDistancePx) {
            this.sprite.x = targetRenderX;
            this.sprite.y = targetRenderY;
        } else {
            this.sprite.x += diffX * smoothingAlpha;
            this.sprite.y += diffY * smoothingAlpha;
        }

        const dtSec = Math.max(0.001, delta / 1000);
        const movedX = this.sprite.x - prevX;
        const movedY = this.sprite.y - prevY;
        const speed = Math.hypot(movedX, movedY) / dtSec;

        const inShoveState = this.scene.time.now < this.shovedUntil;

        if (inShoveState) {
            // During shove: force walk animation, preserve facing direction,
            // play forward/backward based on velocity vs facing
            const walkDir = DIRECTION_TO_MC[this.currentDirection];
            let animKey: string | undefined;
            if (this.customAnimationKeyGetter) {
                animKey = this.customAnimationKeyGetter('walk', walkDir);
            }
            if (!animKey) {
                const sharedKey = SharedMCTextures.getInstance().getAnimationKey(walkDir, 'walk');
                animKey = this.scene.anims.exists(sharedKey) ? sharedKey : `mc-walk-${walkDir}`;
            }

            if (this.scene.anims.exists(animKey) && this.sprite.anims.currentAnim?.key !== animKey) {
                this.sprite.setFlipX(false);
                this.sprite.play(animKey, true);
            }

            if (speed > 0.3) {
                const facing = DIRECTION_VECTORS[this.currentDirection];
                const dot = movedX * facing.x + movedY * facing.y;
                this.sprite.anims.forward = dot >= 0;
                const t = Phaser.Math.Clamp(speed / this.walkAnimSpeedMaxVelocity, 0, 1);
                const targetRate = Phaser.Math.Linear(this.walkAnimSpeedMin, this.walkAnimSpeedMax, t);
                this.sprite.anims.timeScale = targetRate / this.walkFrameRate;
            } else {
                this.sprite.anims.timeScale = 0;
            }
        } else {
            // Normal animation speed handling
            this.sprite.anims.forward = true;
            if (this.sprite.anims.currentAnim && this.currentAnim === 'walk') {
                const t = Phaser.Math.Clamp(speed / this.walkAnimSpeedMaxVelocity, 0, 1);
                const targetRate = Phaser.Math.Linear(this.walkAnimSpeedMin, this.walkAnimSpeedMax, t);
                this.sprite.anims.timeScale = targetRate / this.walkFrameRate;
            } else if (this.sprite.anims.currentAnim) {
                this.sprite.anims.timeScale = 1;
            }
        }
        
        // Calculate depth with Y-sorting and occlusion awareness
        const feetY = this.sprite.getBottomLeft().y;
        const depth = this.depthManager
            ? this.depthManager.entityDepthFromSprite(this.sprite, { baseDepth: this.baseDepth })
            : this.baseDepth + feetY * Y_SORT_FACTOR;
        this.sprite.setDepth(depth);
        const nameplateDepth = this.depthManager
            ? this.depthManager.nameplateDepth(depth)
            : depth + NAMEPLATE_OFFSET;
        this.nameplate.setDepth(nameplateDepth);
        
        // Update nameplate position (above the sprite, accounting for origin)
        this.nameplate.setPosition(this.sprite.x, this.sprite.y + this.nameplateYOffset);

        if (this.chatBubble) {
            this.positionChatBubble();
            this.chatBubble.setDepth(CHAT_BUBBLE_DEPTH); // Always top
        }
        if (this.fishingBubble) {
            this.positionFishingBubble();
            this.fishingBubble.setDepth(CHAT_BUBBLE_DEPTH);
        }

        // Update AFK transparency
        this.updateAfkAlpha();
        this.updateAfkTimer();

        if (this.isGuiOpen || this.isChatOpen) {
            this.guiEffect?.update(this.sprite.x, this.sprite.y - 25);
        }

        this.waterSystem?.update(delta);

        // Update shadow
        this.shadow?.update();
    }

    /**
     * Update AFK transparency smoothly
     */
    private updateAfkAlpha() {
        const targetAlpha = this.isAfk ? this.afkTargetAlpha : 1;
        
        // Smooth transition
        this.afkAlpha += (targetAlpha - this.afkAlpha) * 0.05;
        
        // Apply alpha to sprite and nameplate (unless spawning/despawning)
        if (!this.isSpawning && this.particles.length === 0) {
            this.sprite.setAlpha(this.afkAlpha);
            this.nameplate.setAlpha(this.afkAlpha);
            if (this.afkTimerText) {
                this.afkTimerText.setAlpha(this.isAfk ? 0.95 : this.afkAlpha);
            }
        }
    }

    private updateAfkTimer() {
        if (!this.isAfk || !this.afkTimerText || this.afkStartTime === null) return;

        const elapsed = Date.now() - this.afkStartTime;
        const countdownMs = this.isPremium ? this.afkCountdownPremiumMs : this.afkCountdownMs;
        const remaining = Math.max(0, countdownMs - elapsed);
        const totalSeconds = Math.ceil(remaining / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        this.afkTimerText.setText(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }

    /**
     * Update particle animation
     */
    private updateParticles() {
        if (this.destroyed || !this.sprite || !this.nameplate) return;
        const elapsed = this.scene.time.now - this.spawnStartTime;
        const totalProgress = elapsed / this.spawnDuration;

        let allComplete = true;

        for (const particle of this.particles) {
            // Apply individual delay
            const adjustedProgress = Math.max(0, totalProgress - particle.delay) / (1 - particle.delay);
            particle.progress = Math.min(1, adjustedProgress);

            if (particle.progress < 1) {
                allComplete = false;
            }

            // Easing - ease out cubic for smooth landing
            const eased = this.isSpawning 
                ? 1 - Math.pow(1 - particle.progress, 3) // ease out for spawn
                : particle.progress * particle.progress; // ease in for despawn

            // Interpolate position
            const x = particle.startX + (particle.targetX - particle.startX) * eased;
            const y = particle.startY + (particle.targetY - particle.startY) * eased;

            // Calculate alpha (fade in during spawn, fade out during despawn)
            let alpha: number;
            if (this.isSpawning) {
                alpha = Math.min(1, particle.progress * 2); // Fade in quickly
            } else {
                alpha = 1 - particle.progress; // Fade out
            }

            // Draw particle
            particle.graphics.clear();
            particle.graphics.fillStyle(particle.color, alpha);
            particle.graphics.fillRect(x - particle.size / 2, y - particle.size / 2, particle.size, particle.size);
        }

        // When effect completes
        if (allComplete) {
            // Clean up particles
            for (const particle of this.particles) {
                particle.graphics.destroy();
            }
            this.particles = [];

            if (this.isSpawning) {
                // Snap to current target position and show sprite
                this.sprite.x = this.targetX;
                this.sprite.y = this.targetY;
                // Respect AFK state when spawn completes
                const alpha = this.isAfk ? this.afkTargetAlpha : 1;
                this.sprite.setAlpha(alpha);
                this.nameplate.setAlpha(alpha);
                this.afkAlpha = alpha;
                this.isSpawning = false;
                // Show shadow now that spawn effect is done
                this.shadow?.setVisible(true);
            } else {
                // Despawn complete - call callback
                if (this.onDespawnComplete) {
                    this.onDespawnComplete();
                }
            }
        }
    }

    /**
     * Update shove dirt particles (simple physics with gravity + fade)
     */
    private updateShoveParticles(delta: number) {
        const dtSec = Math.min(delta / 1000, 0.05);
        const gravity = 120;

        for (let i = this.shoveParticles.length - 1; i >= 0; i--) {
            const p = this.shoveParticles[i];
            p.life += delta;
            if (p.life >= p.maxLife) {
                p.gfx.destroy();
                this.shoveParticles.splice(i, 1);
                continue;
            }

            p.vy += gravity * dtSec;
            p.x += p.vx * dtSec;
            p.y += p.vy * dtSec;

            const t = p.life / p.maxLife;
            const alpha = 1 - t * t; // ease-in fade out
            p.gfx.clear();
            p.gfx.fillStyle(p.color, alpha);
            p.gfx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
    }

    /**
     * Get the sprite for external access (e.g., occlusion checks)
     */
    getSprite(): Phaser.GameObjects.Sprite {
        return this.sprite;
    }

    getSoftCollisionFootprint(): { x: number; y: number; width: number; height: number } {
        return {
            x: this.sprite.x,
            y: this.sprite.y,
            width: this.hitboxWidth * this.scale,
            height: this.collidableHeight * this.scale
        };
    }

    applySoftCollisionNudge(dx: number, dy: number) {
        if (this.destroyed || this.isAfkGhosted()) return;

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

        this.interpolationBuffer = this.interpolationBuffer.map((entry) => ({
            ...entry,
            x: entry.x + pushX,
            y: entry.y + pushY
        }));

        this.nameplate.setPosition(this.sprite.x, this.sprite.y + this.nameplateYOffset);
        this.positionChatBubble();
        this.positionFishingBubble();
    }

    /**
     * Get the session ID
     */
    getSessionId(): string {
        return this.sessionId;
    }

    getUsername(): string {
        return this.username;
    }

    /**
     * Returns true if the player has been AFK long enough to be ghosted
     */
    isAfkGhosted(): boolean {
        return this.isAfk;
    }

    /**
     * Play interact animation for this remote player
     */
    playInteractAnimation() {
        if (this.destroyed || !this.sprite || !this.sprite.anims || typeof (this.sprite as any).play !== 'function') return;

        const directionMap: { [key in Direction]: { name: string; flip: boolean } } = {
            [Direction.Down]: { name: 'down', flip: false },
            [Direction.DownRight]: { name: 'down-right', flip: false },
            [Direction.Right]: { name: 'right', flip: false },
            [Direction.UpRight]: { name: 'up-right', flip: false },
            [Direction.Up]: { name: 'up', flip: false },
            [Direction.UpLeft]: { name: 'up-right', flip: true },
            [Direction.Left]: { name: 'right', flip: true },
            [Direction.DownLeft]: { name: 'down-right', flip: true }
        };

        const { name, flip } = directionMap[this.currentDirection];
        const animKey = `player-interact-${name}`;

        if (!this.scene.anims.exists(animKey)) return;

        this.isPlayingInteract = true;
        this.sprite.setFlipX(flip);
        this.sprite.play(animKey, true);

        this.sprite.once('animationcomplete', () => {
            this.isPlayingInteract = false;
            this.sprite.setFlipX(false);
            this.updateAnimation(this.currentAnim, this.currentDirection);
        });
    }

    /**
     * Play shove hit effect: red tint flash + dirt-like particles
     */
    /**
     * Start shove animation state — forces walk forward/backward for the given duration
     */
    startShoveState(durationMs: number) {
        this.shovedUntil = this.scene.time.now + durationMs;
    }

    playShoveEffect() {
        if (this.destroyed || !this.sprite) return;

        // Red tint flash
        this.sprite.setTint(0xff4444);
        this.scene.time.delayedCall(120, () => {
            if (!this.destroyed && this.sprite) {
                this.sprite.clearTint();
            }
        });

        // Dirt-like particles burst from the sprite's feet
        const cx = this.sprite.x;
        const cy = this.sprite.getBottomCenter().y;
        const dirtColors = [0x8B6914, 0xA0804A, 0x6B4F1A, 0x9C7C38, 0xBFA66A];
        const count = 8 + Math.floor(Math.random() * 5); // 8-12 particles

        for (let i = 0; i < count; i++) {
            const gfx = this.scene.add.graphics();
            gfx.setDepth(this.depthManager?.shadowDepth(this.sprite.depth) ?? this.sprite.depth - 1);
            const angle = Math.random() * Math.PI * 2;
            const speed = 20 + Math.random() * 50;
            const size = 1 + Math.random() * 2;
            const color = dirtColors[Math.floor(Math.random() * dirtColors.length)];
            const maxLife = 200 + Math.random() * 250;

            this.shoveParticles.push({
                gfx,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 30 - Math.random() * 20, // bias upward
                x: cx + (Math.random() - 0.5) * 8,
                y: cy + (Math.random() - 0.5) * 4,
                life: 0,
                maxLife,
                size,
                color
            });
        }
    }

    /**
     * Destroy and clean up
     */
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.guiEffect?.destroy();
        this.waterSystem?.destroy();
        // Clean up any remaining particles
        for (const particle of this.particles) {
            particle.graphics.destroy();
        }
        this.particles = [];
        for (const p of this.shoveParticles) {
            p.gfx.destroy();
        }
        this.shoveParticles = [];
        
        if (this.chatBubble) {
            this.chatBubble.destroy();
        }
        if (this.chatTimer) {
            this.chatTimer.remove(false);
        }
        if (this.fishingBubble) {
            this.fishingBubble.destroy();
        }
        if (this.fishingTimer) {
            this.fishingTimer.remove(false);
        }

        this.shadow?.destroy();
        this.sprite.destroy();
        this.nameplate.destroy();
    }

    showChat(message: string) {
        // Remove existing bubble if any
        if (this.chatBubble) {
            this.chatBubble.destroy();
            this.chatBubble = undefined;
        }
        if (this.chatTimer) {
            this.chatTimer.remove(false);
            this.chatTimer = undefined;
        }

        const bubble = createChatBubble({
            scene: this.scene,
            message,
            depth: CHAT_BUBBLE_DEPTH
        });

        this.chatBubble = bubble.container;
        this.positionChatBubble();

        // Auto destroy
        this.chatTimer = this.scene.time.delayedCall(4000, () => {
            if (this.chatBubble) {
                this.scene.tweens.add({
                    targets: this.chatBubble,
                    alpha: 0,
                    duration: 300,
                    onComplete: () => {
                        this.chatBubble?.destroy();
                        this.chatBubble = undefined;
                    }
                });
            }
        });
    }

    showFishingBubble(rodItemId: string) {
        const textureKey = `item-${rodItemId}-18`;
        if (!this.scene.textures.exists(textureKey)) {
            void this.itemTextureLoader.ensureItemIconTexture(this.scene, rodItemId, 18).then((loadedKey) => {
                if (!loadedKey) return;
                this.showFishingBubble(rodItemId);
            });
            return;
        }

        if (this.fishingBubble) {
            this.fishingBubble.destroy();
            this.fishingBubble = undefined;
        }
        if (this.fishingTimer) {
            this.fishingTimer.remove(false);
            this.fishingTimer = undefined;
        }

        const bubble = createIconBubble({
            scene: this.scene,
            textureKey,
            depth: CHAT_BUBBLE_DEPTH
        });

        this.fishingBubble = bubble.container;
        this.positionFishingBubble(true);

        this.fishingTimer = this.scene.time.delayedCall(2000, () => {
            if (this.fishingBubble) {
                this.scene.tweens.add({
                    targets: this.fishingBubble,
                    alpha: 0,
                    duration: 250,
                    onComplete: () => {
                        this.fishingBubble?.destroy();
                        this.fishingBubble = undefined;
                    }
                });
            }
        });
    }

    private positionChatBubble() {
        if (!this.chatBubble) return;
        const bubbleHeight = this.chatBubble.getBounds().height;
        const nameplateTop = this.nameplateHeight
            ? this.sprite.y + this.nameplateYOffset - this.nameplateHeight / 2
            : (this.nameplate?.getBounds().top ?? (this.sprite.y + this.nameplateYOffset));
        const bubbleY = nameplateTop - this.chatBubbleGap - bubbleHeight / 2;
        this.chatBubble.setPosition(this.sprite.x, bubbleY);
    }

    private positionFishingBubble(isInitial: boolean = false) {
        if (!this.fishingBubble) return;
        const bubbleHeight = this.fishingBubble.getBounds().height;
        const nameplateTop = this.nameplateHeight
            ? this.sprite.y + this.nameplateYOffset - this.nameplateHeight / 2
            : (this.nameplate?.getBounds().top ?? (this.sprite.y + this.nameplateYOffset));
        const bubbleY = nameplateTop - this.chatBubbleGap - bubbleHeight / 2;
        if (isInitial) {
            this.fishingBubble.setPosition(this.sprite.x, bubbleY + 6);
            this.fishingBubble.setAlpha(0);
            this.scene.tweens.add({
                targets: this.fishingBubble,
                y: bubbleY,
                alpha: 1,
                duration: 250,
                ease: 'Sine.out'
            });
        } else {
            this.fishingBubble.setPosition(this.sprite.x, bubbleY);
        }
    }

    /**
     * Start despawn effect then destroy
     */
    despawn() {
        this.startDespawnEffect(() => {
            this.destroy();
        });
    }

    /**
     * Check if currently despawning
     */
    isDespawning(): boolean {
        return !this.isSpawning && this.particles.length > 0;
    }

}
