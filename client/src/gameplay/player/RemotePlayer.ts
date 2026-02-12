import Phaser from 'phaser';
import { OcclusionManager } from '../map/OcclusionManager';
import { GuiSwirlEffect } from '../fx/GuiSwirlEffect';
import { SharedMCTextures } from './SharedMCTextures';
import { WaterSystem } from '../fx/water/WaterSystem';
import { createChatBubble, createIconBubble, createNameplate, getOcclusionAdjustedDepth } from './PlayerVisualUtils';
import { MCAnimationType, MC_FRAME_DIMENSIONS_BY_ANIM } from '@cfwk/shared';

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

export type RemotePlayerConfig = {
    sessionId: string;
    username: string;
    odcid: string;
    x: number;
    y: number;
    direction: number;
    depth: number;
    occlusionManager?: OcclusionManager;
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
    private occlusionManager?: OcclusionManager;
    private chatBubble?: Phaser.GameObjects.Container;
    private chatTimer?: Phaser.Time.TimerEvent;
    private fishingBubble?: Phaser.GameObjects.Container;
    private fishingTimer?: Phaser.Time.TimerEvent;
    private waterSystem?: WaterSystem;
    
    /** Custom animation key getter for per-player appearance */
    private customAnimationKeyGetter?: (anim: string, direction: MCDirection) => string | undefined;

    // Interpolation
    private readonly interpSpeed = 0.25;
    private readonly chatBubbleGap = 10;
    private readonly scale = 1.2;
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

    constructor(scene: Phaser.Scene, config: RemotePlayerConfig) {
        this.scene = scene;
        this.sessionId = config.sessionId;
        this.username = config.username;
        this.isPremium = !!config.isPremium;
        this.targetX = config.x;
        this.targetY = config.y;
        this.currentDirection = config.direction as Direction;
        this.baseDepth = config.depth;
        this.occlusionManager = config.occlusionManager;
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
        // - Scale: 1.2
        // - Collidable height: 6 * 1.5 = 9
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

        // Get player dimensions (match MCPlayerController: 16x27 base, 1.2 scale)
        const width = 16 * 1.2;
        const height = 27 * 1.2;
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
            graphics.setDepth(this.baseDepth + 1);
            
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

        // Get player dimensions (match MCPlayerController: 16x27 base, 1.2 scale)
        const width = 16 * 1.2;
        const height = 27 * 1.2;
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
            graphics.setDepth(this.baseDepth + 1);
            
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
            depth: this.baseDepth + 1000,
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
    setPosition(x: number, y: number) {
        const dx = x - this.targetX;
        const dy = y - this.targetY;
        
        this.targetX = x;
        this.targetY = y;

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
        this.currentDirection = direction as Direction;
        this.currentAnim = anim;
        this.updateAnimation(this.currentAnim, this.currentDirection);
    }

    /**
     * Update the animation key getter after textures are generated
     */
    setCustomAnimationKeyGetter(getter?: (anim: string, direction: MCDirection) => string | undefined) {
        this.customAnimationKeyGetter = getter;
        this.updateAnimation(this.currentAnim, this.currentDirection);
    }

    /**
     * Set AFK state from server
     */
    setAfk(isAfk: boolean, afkSince?: number) {
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
        this.isGuiOpen = isOpen;
        this.guiEffect?.setActive(isOpen || this.isChatOpen);
    }

    setChatOpen(isOpen: boolean) {
        this.isChatOpen = isOpen;
        this.guiEffect?.setActive(this.isGuiOpen || isOpen);
    }

    private updateAnimation(anim: string, direction: Direction) {
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
        
        // Fallback to shared MC animation
        if (!animKey) {
            animKey = `mc-${anim}-${mcDir}`;
        }
        
        if (this.scene.anims.exists(animKey) && this.sprite.anims.currentAnim?.key !== animKey) {
            this.sprite.play(animKey);
        }

        this.updateSpriteOrigin(anim, mcDir);
    }

    private updateSpriteOrigin(anim: string, direction: MCDirection) {
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
        // Update particle effects
        if (this.particles.length > 0) {
            this.updateParticles();
        }

        // Don't update position while spawning
        if (this.isSpawning && this.particles.length > 0) return;

        // Guard: skip update if sprite frame is not ready (texture still loading)
        if (!this.sprite.frame) return;

        // Smooth interpolation to target position
        const prevX = this.sprite.x;
        const prevY = this.sprite.y;
        const dx = this.targetX - this.sprite.x;
        const dy = this.targetY - this.sprite.y;
        
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            this.sprite.x += dx * this.interpSpeed;
            this.sprite.y += dy * this.interpSpeed;
        } else {
            this.sprite.x = this.targetX;
            this.sprite.y = this.targetY;
        }

        const dtSec = Math.max(0.001, delta / 1000);
        const movedX = this.sprite.x - prevX;
        const movedY = this.sprite.y - prevY;
        const speed = Math.hypot(movedX, movedY) / dtSec;
        if (this.sprite.anims.currentAnim && this.currentAnim === 'walk') {
            const t = Phaser.Math.Clamp(speed / this.walkAnimSpeedMaxVelocity, 0, 1);
            const targetRate = Phaser.Math.Linear(this.walkAnimSpeedMin, this.walkAnimSpeedMax, t);
            this.sprite.anims.timeScale = targetRate / this.walkFrameRate;
        } else if (this.sprite.anims.currentAnim) {
            this.sprite.anims.timeScale = 1;
        }
        
        // Calculate depth with Y-sorting and occlusion awareness
        const feetY = this.sprite.getBottomLeft().y;
        const depth = getOcclusionAdjustedDepth(
            this.occlusionManager,
            this.sprite.x,
            feetY,
            this.baseDepth,
            true,
            false
        );
        this.sprite.setDepth(depth);
        
        // Update nameplate position (above the sprite, accounting for origin)
        this.nameplate.setPosition(this.sprite.x, this.sprite.y + this.nameplateYOffset);

        if (this.chatBubble) {
            this.positionChatBubble();
            this.chatBubble.setDepth(99999); // Always top
        }
        if (this.fishingBubble) {
            this.positionFishingBubble();
            this.fishingBubble.setDepth(99999);
        }

        // Update AFK transparency
        this.updateAfkAlpha();
        this.updateAfkTimer();

        if (this.isGuiOpen || this.isChatOpen) {
            this.guiEffect?.update(this.sprite.x, this.sprite.y - 25);
        }

        this.waterSystem?.update(delta);
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
            } else {
                // Despawn complete - call callback
                if (this.onDespawnComplete) {
                    this.onDespawnComplete();
                }
            }
        }
    }

    /**
     * Get the sprite for external access (e.g., occlusion checks)
     */
    getSprite(): Phaser.GameObjects.Sprite {
        return this.sprite;
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
        if (!this.isAfk || !this.afkStartTime) return false;
        return Date.now() - this.afkStartTime >= 60000;
    }

    /**
     * Play interact animation for this remote player
     */
    playInteractAnimation() {
        if (!this.sprite || typeof (this.sprite as any).play !== 'function') return;

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

        this.sprite.setFlipX(flip);
        if (this.scene.anims.exists(animKey)) {
            this.sprite.play(animKey, true);
        }
    }

    /**
     * Destroy and clean up
     */
    destroy() {
        this.guiEffect?.destroy();
        this.waterSystem?.destroy();
        // Clean up any remaining particles
        for (const particle of this.particles) {
            particle.graphics.destroy();
        }
        this.particles = [];
        
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
            depth: 99999
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
        if (!this.scene.textures.exists(textureKey)) return;

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
            depth: 99999
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
