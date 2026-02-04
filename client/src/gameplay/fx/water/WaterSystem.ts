import Phaser from 'phaser';
import { WaterDepthEffect } from './WaterDepthEffect';

/**
 * Configuration for water detection and effects
 */
interface WaterEffectsConfig {
    /** How long "wet feet" effect lasts after leaving water (ms) */
    wetFeetDuration: number;
    /** How long each footprint persists (ms) */
    footprintDuration: number;
    /** Minimum distance between footprints */
    footprintSpacing: number;
    /** How often to sample water (ms) - for performance */
    sampleInterval: number;
}

/**
 * Represents a single footprint mark
 */
interface Footprint {
    sprite: Phaser.GameObjects.Sprite;
    createdAt: number;
}

/**
 * WaterSystem - Unified water effects manager
 * 
 * Features:
 * - Detects water via Water layer tiles
 * - Creates splash particles when walking in water
 * - Leaves wet footprints after exiting water
 * - Depth-based sinking and speed reduction (via WaterDepthEffect)
 */
export class WaterSystem {
    private scene: Phaser.Scene;
    private player: Phaser.GameObjects.Sprite;
    private waterLayer?: Phaser.Tilemaps.TilemapLayer;
    
    private config: WaterEffectsConfig = {
        wetFeetDuration: 2000,
        footprintDuration: 1000,
        footprintSpacing: 14,
        sampleInterval: 100
    };

    // Sub-systems
    private depthEffect?: WaterDepthEffect;

    // State tracking
    private isInWater = false;
    private isWet = false;
    private wetTimer = 0;
    private timeInWater = 0;
    private lastFootprintPos: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, 0);
    private footprints: Footprint[] = [];
    private lastSampleTime = 0;
    private cachedWaterResult = false;

    // Splash particle emitter
    private splashEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
    private lastSplashTime = 0;

    // Movement tracking
    private lastPlayerX = 0;
    private lastPlayerY = 0;
    private isMoving = false;
    private currentSpeed = 0;

    constructor(scene: Phaser.Scene, player: Phaser.GameObjects.Sprite, groundLayers: Phaser.Tilemaps.TilemapLayer[]) {
        this.scene = scene;
        this.player = player;
        
        // Find the Water layer
        this.waterLayer = groundLayers.find(layer => 
            layer.layer.name.toLowerCase() === 'water'
        );

        // Initialize depth effect
        if (this.waterLayer) {
            this.depthEffect = new WaterDepthEffect(scene, player, this.waterLayer);
        }

        this.createTextures();
        this.createSplashEmitter();

        this.lastPlayerX = player.x;
        this.lastPlayerY = player.y;
    }

    /**
     * Create pixel-art textures for effects
     */
    private createTextures() {
        // Splash particle texture
        if (!this.scene.textures.exists('water-splash')) {
            const graphics = this.scene.make.graphics({ x: 0, y: 0 }, false);
            const size = 8;
            
            graphics.fillStyle(0xffffff, 1);
            graphics.fillRect(2, 2, 4, 4);
            graphics.fillStyle(0xffffff, 0.7);
            graphics.fillRect(1, 3, 1, 2);
            graphics.fillRect(6, 3, 1, 2);
            graphics.fillRect(3, 1, 2, 1);
            graphics.fillRect(3, 6, 2, 1);
            
            graphics.generateTexture('water-splash', size, size);
            graphics.destroy();
        }

        // Footprint texture
        if (!this.scene.textures.exists('wet-footprint')) {
            const graphics = this.scene.make.graphics({ x: 0, y: 0 }, false);
            const size = 6;
            
            graphics.fillStyle(0x1a1a2e, 0.5);
            graphics.fillEllipse(5, 5, 8, 6);
            
            graphics.generateTexture('wet-footprint', size, size);
            graphics.destroy();
        }
    }

    /**
     * Create splash particle emitter
     */
    private createSplashEmitter() {
        this.splashEmitter = this.scene.add.particles(0, 0, 'water-splash', {
            speed: { min: 30, max: 60 },
            angle: { min: -150, max: -30 },
            scale: { start: 0.8, end: 0.2 },
            alpha: { start: 0.9, end: 0 },
            lifespan: { min: 300, max: 500 },
            gravityY: 80,
            quantity: 0,
            emitting: false
        });
        this.splashEmitter.setDepth(this.player.depth + 1);
    }

    /**
     * Check if player's feet are over a water tile
     */
    private sampleWaterAtFeet(): boolean {
        const now = Date.now();
        
        if (now - this.lastSampleTime < this.config.sampleInterval) {
            return this.cachedWaterResult;
        }
        this.lastSampleTime = now;

        if (!this.waterLayer) {
            this.cachedWaterResult = false;
            return false;
        }

        const feetX = this.player.x;
        const feetY = this.player.y + 3;

        const tileX = this.waterLayer.worldToTileX(feetX);
        const tileY = this.waterLayer.worldToTileY(feetY);
        
        if (tileX === null || tileY === null) {
            this.cachedWaterResult = false;
            return false;
        }

        const tile = this.waterLayer.getTileAt(tileX, tileY);
        this.cachedWaterResult = tile !== null && tile.index >= 0;
        return this.cachedWaterResult;
    }

    /**
     * Create splash effect based on depth and speed
     */
    private createSplash() {
        if (!this.splashEmitter) return;

        // Don't create splash if player is too deep (> 1 tile)
        const depth = this.depthEffect?.getDepth() ?? 0;
        if (depth > 1) return;

        const now = Date.now();
        const dynamicCooldown = Math.max(50, 250 - this.currentSpeed * 20);
        if (now - this.lastSplashTime < dynamicCooldown) return;

        this.lastSplashTime = now;
        
        const speedRaw = Math.min(1, this.currentSpeed / 5);
        const speedIntensity = speedRaw * speedRaw;
        
        // Scale splash with depth (but only up to 1 tile now)
        const depthIntensity = Math.min(1, depth / 1);
        const combinedIntensity = Math.min(1, (speedIntensity + depthIntensity) / 1.5);
        
        const particleCount = Math.floor(4 + combinedIntensity * 8);
        const startScale = 0.4 + combinedIntensity * 1.2;
        const endScale = 0.1 + combinedIntensity * 0.3;
        const startAlpha = 0.6 + combinedIntensity * 0.3;
        const minSpeed = 20 + combinedIntensity * 60;
        const maxSpeed = 40 + combinedIntensity * 100;
        const lifespan = 250 + combinedIntensity * 400;
        
        this.splashEmitter.setParticleScale(startScale, endScale);
        this.splashEmitter.setParticleAlpha({ start: startAlpha, end: 0 });
        this.splashEmitter.setParticleSpeed(minSpeed, maxSpeed);
        this.splashEmitter.setParticleLifespan(lifespan);
        
        const spread = 4 + combinedIntensity * 10;
        
        this.splashEmitter.emitParticleAt(
            this.player.x + Phaser.Math.Between(-spread, spread),
            this.player.y + 4,
            particleCount
        );
    }

    /**
     * Create wet footprint
     */
    private createFootprint() {
        const x = this.player.x;
        const y = this.player.y + 3;

        const dist = Phaser.Math.Distance.Between(x, y, this.lastFootprintPos.x, this.lastFootprintPos.y);
        if (dist < this.config.footprintSpacing) return;

        const footprint = this.scene.add.sprite(x, y, 'wet-footprint');
        footprint.setDepth(15);
        footprint.setAlpha(0.7);
        footprint.setRotation(Phaser.Math.DegToRad(Phaser.Math.Between(-15, 15)));

        this.footprints.push({
            sprite: footprint,
            createdAt: Date.now()
        });

        this.lastFootprintPos.set(x, y);
    }

    /**
     * Update footprints
     */
    private updateFootprints() {
        const now = Date.now();
        
        for (let i = this.footprints.length - 1; i >= 0; i--) {
            const fp = this.footprints[i];
            const age = now - fp.createdAt;

            if (age >= this.config.footprintDuration) {
                fp.sprite.destroy();
                this.footprints.splice(i, 1);
            } else {
                const fadeStart = this.config.footprintDuration * 0.5;
                if (age > fadeStart) {
                    const fadeProgress = (age - fadeStart) / (this.config.footprintDuration - fadeStart);
                    fp.sprite.setAlpha(0.7 * (1 - fadeProgress));
                }
            }
        }
    }

    /**
     * Get speed multiplier for player movement (affected by water depth)
     */
    getSpeedMultiplier(): number {
        return this.depthEffect?.getSpeedMultiplier() ?? 1.0;
    }

    /**
     * Get current water depth (0 = not in water)
     */
    getDepth(): number {
        return this.depthEffect?.getDepth() ?? 0;
    }

    /**
     * Main update loop
     */
    update(delta: number) {
        if (!this.isPlayerValid()) return;
        // Track movement
        const dx = this.player.x - this.lastPlayerX;
        const dy = this.player.y - this.lastPlayerY;
        this.currentSpeed = Math.sqrt(dx * dx + dy * dy);
        this.isMoving = this.currentSpeed > 0.1;
        this.lastPlayerX = this.player.x;
        this.lastPlayerY = this.player.y;

        // Sample water
        const wasInWater = this.isInWater;
        this.isInWater = this.sampleWaterAtFeet();

        // Update depth effect
        this.depthEffect?.update(delta);

        // Track time in water
        if (this.isInWater) {
            this.timeInWater += delta;
        }

        // Handle water transitions
        if (this.isInWater && !wasInWater) {
            this.isWet = true;
            this.timeInWater = 0;
        } else if (!this.isInWater && wasInWater) {
            const wetDuration = Math.min(3000, Math.max(500, this.timeInWater * 0.5));
            this.wetTimer = wetDuration;
            this.timeInWater = 0;
        }

        // Update wet timer
        if (!this.isInWater && this.isWet) {
            this.wetTimer -= delta;
            if (this.wetTimer <= 0) {
                this.isWet = false;
            }
        }

        // Create effects
        if (this.isInWater && this.isMoving) {
            this.createSplash();
        }

        if (this.isWet && !this.isInWater && this.isMoving) {
            this.createFootprint();
        }

        this.updateFootprints();

        if (this.splashEmitter) {
            this.splashEmitter.setDepth(this.player.depth + 1);
        }
    }

    private isPlayerValid(): boolean {
        if (!this.player || !this.player.active) return false;
        if (this.player instanceof Phaser.Physics.Matter.Sprite) {
            return !!this.player.body;
        }
        return true;
    }

    /**
     * Check if player is in water
     */
    getIsInWater(): boolean {
        return this.isInWater;
    }

    /**
     * Check if player has wet feet
     */
    getIsWet(): boolean {
        return this.isWet;
    }

    /**
     * Get debug info
     */
    getDebugInfo(): { inWater: boolean; isWet: boolean; depth: number; speedMult: number } {
        return {
            inWater: this.isInWater,
            isWet: this.isWet,
            depth: this.getDepth(),
            speedMult: this.getSpeedMultiplier()
        };
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.splashEmitter?.destroy();
        this.depthEffect?.destroy();
        this.footprints.forEach(fp => fp.sprite.destroy());
        this.footprints = [];
    }
}

// Re-export for convenience
export { WaterDepthEffect } from './WaterDepthEffect';
