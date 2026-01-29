import Phaser from 'phaser';
import { OcclusionManager } from '../map/OcclusionManager';

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
 * Generates a consistent color from a string (user ID)
 */
function hashToColor(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    
    // Generate HSL values for nice colors
    const hue = Math.abs(hash) % 360;
    const saturation = 60 + (Math.abs(hash >> 8) % 30); // 60-90%
    const lightness = 55 + (Math.abs(hash >> 16) % 20);  // 55-75%
    
    return Phaser.Display.Color.HSLToColor(hue / 360, saturation / 100, lightness / 100).color;
}

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
};

/**
 * Represents another player in the game world.
 * Renders their character sprite with color tint and nameplate.
 */
export class RemotePlayer {
    private scene: Phaser.Scene;
    private sessionId: string;
    private username: string;
    private odcid: string;
    
    private sprite!: Phaser.GameObjects.Sprite;
    private nameplate!: Phaser.GameObjects.Container;
    private nameText!: Phaser.GameObjects.Text;
    private nameBg!: Phaser.GameObjects.Graphics;
    
    private targetX: number;
    private targetY: number;
    private currentDirection: Direction = Direction.Down;
    private currentAnim: string = 'idle';
    private playerColor: number;
    private baseDepth: number;
    private occlusionManager?: OcclusionManager;

    // Interpolation
    private readonly interpSpeed = 0.25;

    // Spawn effect
    private particles: PixelParticle[] = [];
    private isSpawning: boolean = true;
    private spawnProgress: number = 0;
    private readonly spawnDuration: number = 800; // ms
    private spawnStartTime: number = 0;

    // Despawn callback
    private onDespawnComplete?: () => void;

    constructor(scene: Phaser.Scene, config: RemotePlayerConfig) {
        this.scene = scene;
        this.sessionId = config.sessionId;
        this.username = config.username;
        this.odcid = config.odcid;
        this.targetX = config.x;
        this.targetY = config.y;
        this.currentDirection = config.direction as Direction;
        this.baseDepth = config.depth;
        this.occlusionManager = config.occlusionManager;
        
        // Generate consistent color from user ID
        this.playerColor = hashToColor(this.odcid);
        
        this.createSprite(config.x, config.y, config.skipSpawnEffect);
        this.createNameplate(config.skipSpawnEffect);
        this.updateAnimation('idle', this.currentDirection);
    }

    private createSprite(x: number, y: number, skipSpawnEffect?: boolean) {
        this.sprite = this.scene.add.sprite(x, y, 'player-idle');
        
        // Match local player scale and origin settings
        const width = 16;
        const height = 32;
        const scale = 1.2;
        const scaledWidth = width * scale;
        const scaledHeight = height * scale;
        const collidableHeight = scaledHeight / 6;
        
        // Scale up to match local player
        this.sprite.setDisplaySize(scaledWidth, scaledHeight);
        
        // Match origin so feet align with position
        const originY = 1 - collidableHeight / (2 * scaledHeight);
        this.sprite.setOrigin(0.5, originY);
        
        this.sprite.setDepth(this.baseDepth);
        
        // Apply color tint
        this.sprite.setTint(this.playerColor);

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

        // Get player dimensions
        const width = 16;
        const height = 32;
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
            
            // Vary color slightly around player color
            const baseColor = Phaser.Display.Color.IntegerToColor(this.playerColor);
            const variation = 0.85 + Math.random() * 0.3; // 0.85 to 1.15
            const r = Math.min(255, Math.floor(baseColor.red * variation));
            const g = Math.min(255, Math.floor(baseColor.green * variation));
            const b = Math.min(255, Math.floor(baseColor.blue * variation));
            
            this.particles.push({
                graphics,
                targetX,
                targetY,
                startX,
                startY,
                color: Phaser.Display.Color.GetColor(r, g, b),
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
        this.spawnProgress = 0;
        this.particles = [];

        // Hide the sprite
        this.sprite.setAlpha(0);
        this.nameplate.setAlpha(0);

        // Get player dimensions
        const width = 16;
        const height = 32;
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
            
            // Vary color
            const baseColor = Phaser.Display.Color.IntegerToColor(this.playerColor);
            const variation = 0.85 + Math.random() * 0.3;
            const r = Math.min(255, Math.floor(baseColor.red * variation));
            const g = Math.min(255, Math.floor(baseColor.green * variation));
            const b = Math.min(255, Math.floor(baseColor.blue * variation));
            
            this.particles.push({
                graphics,
                targetX,
                targetY,
                startX,
                startY,
                color: Phaser.Display.Color.GetColor(r, g, b),
                size: pixelSize + Math.random() * 2,
                progress: 0,
                delay: Math.random() * 0.2
            });
        }
    }

    private createNameplate(skipSpawnEffect?: boolean) {
        const padding = { x: 3, y: 1 };
        
        // Create text - render at higher resolution for crisp display
        this.nameText = this.scene.add.text(0, 0, this.username, {
            fontSize: '8px',
            fontFamily: 'Minecraft, monospace',
            color: '#ffffff',
            resolution: 2  // Render at 2x resolution for crisp text
        }).setOrigin(0.5);

        // Create background
        const textWidth = this.nameText.width;
        const textHeight = this.nameText.height;
        const bgWidth = textWidth + padding.x * 2;
        const bgHeight = textHeight + padding.y * 2;
        
        this.nameBg = this.scene.add.graphics();
        this.nameBg.fillStyle(0x000000, 0.6);
        this.nameBg.fillRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight);

        // Container for nameplate (above the sprite, accounting for origin)
        this.nameplate = this.scene.add.container(this.sprite.x, this.sprite.y - 36, [
            this.nameBg,
            this.nameText
        ]);
        this.nameplate.setDepth(this.baseDepth + 1000); // Always on top
        
        // Start hidden during spawn effect (unless skipped)
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
        this.currentAnim = anim;
        this.currentDirection = direction as Direction;
        this.updateAnimation(anim, this.currentDirection);
    }

    private updateAnimation(anim: string, direction: Direction) {
        const directionNames = ['down', 'down-right', 'right', 'up-right', 'up', 'up-right', 'right', 'down-right'];
        const dirName = directionNames[direction] || 'down';
        
        // Mirror for left-facing directions
        const shouldFlip = direction === Direction.UpLeft || 
                          direction === Direction.Left || 
                          direction === Direction.DownLeft;
        this.sprite.setFlipX(shouldFlip);
        
        const animKey = `player-${anim}-${dirName}`;
        
        if (this.scene.anims.exists(animKey) && this.sprite.anims.currentAnim?.key !== animKey) {
            this.sprite.play(animKey);
        }
    }

    /**
     * Update every frame - interpolate position and particle effects
     */
    update() {
        // Update particle effects
        if (this.particles.length > 0) {
            this.updateParticles();
        }

        // Don't update position while spawning
        if (this.isSpawning && this.particles.length > 0) return;

        // Smooth interpolation to target position
        const dx = this.targetX - this.sprite.x;
        const dy = this.targetY - this.sprite.y;
        
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            this.sprite.x += dx * this.interpSpeed;
            this.sprite.y += dy * this.interpSpeed;
        } else {
            this.sprite.x = this.targetX;
            this.sprite.y = this.targetY;
        }
        
        // Calculate depth with occlusion awareness
        // When in an occlusion region, remote player should appear BEHIND layers
        let depth = this.baseDepth + (this.sprite.y * 0.01);
        
        if (this.occlusionManager) {
            // Check if remote player is in an occlusion region using their foot position
            const isOccluded = this.occlusionManager.isInOcclusionRegion(this.sprite.x, this.sprite.y, 4);
            
            if (isOccluded) {
                // Put remote player behind occludable layers (which start at ~200)
                const occludableBase = this.occlusionManager.getOccludableBaseDepth();
                depth = (occludableBase - 10) + (this.sprite.y * 0.01);
            }
        }
        this.sprite.setDepth(depth);
        
        // Update nameplate position (above the sprite, accounting for origin)
        this.nameplate.setPosition(this.sprite.x, this.sprite.y - 36);
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
                this.sprite.setAlpha(1);
                this.nameplate.setAlpha(1);
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

    /**
     * Destroy and clean up
     */
    destroy() {
        // Clean up any remaining particles
        for (const particle of this.particles) {
            particle.graphics.destroy();
        }
        this.particles = [];
        
        this.sprite.destroy();
        this.nameplate.destroy();
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
