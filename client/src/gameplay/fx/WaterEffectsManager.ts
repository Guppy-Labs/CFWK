import Phaser from 'phaser';

/**
 * Configuration for water detection and effects
 */
interface WaterEffectsConfig {
    /** Minimum blue ratio (blue / (red + green + blue)) to consider a pixel as water */
    blueThreshold: number;
    /** Minimum percentage of sampled pixels that must be water to trigger effect */
    waterPixelThreshold: number;
    /** Size of the sampling area around player's feet */
    sampleSize: number;
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
 * WaterEffectsManager - Detects water by pixel color and creates splash/footprint effects
 * 
 * Features:
 * - Samples pixel colors near player's feet to detect water (works with transition tiles)
 * - Creates splash particles when walking in water
 * - Leaves wet footprints for a duration after exiting water
 */
export class WaterEffectsManager {
    private scene: Phaser.Scene;
    private player: Phaser.Physics.Matter.Sprite;
    private groundLayers: Phaser.Tilemaps.TilemapLayer[] = [];
    
    private config: WaterEffectsConfig = {
        blueThreshold: 0.5,        // Blue must be 36%+ of total RGB
        waterPixelThreshold: 0.3,  // 25% of sampled pixels must be water
        sampleSize: 16,             // 16x16 pixel sample area
        wetFeetDuration: 2000,      // 2 seconds of wet feet
        footprintDuration: 1000,    // 1 second per footprint
        footprintSpacing: 14,       // Minimum pixels between footprints
        sampleInterval: 100         // Sample every 100ms
    };

    // State tracking
    private isInWater = false;
    private isWet = false;
    private wetTimer = 0;
    private timeInWater = 0; // Track how long player has been in water (ms)
    private lastFootprintPos: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, 0);
    private footprints: Footprint[] = [];
    private lastSampleTime = 0;
    private cachedWaterResult = false;

    // Debug tracking
    private debugLastBlueRatio = 0;
    private debugLastWaterPercent = 0;
    private debugTotalPixels = 0;
    private debugWaterPixels = 0;

    // Canvas for pixel sampling
    private sampleCanvas: HTMLCanvasElement;
    private sampleCtx: CanvasRenderingContext2D;

    // Splash particle emitter
    private splashEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
    private lastSplashTime = 0;
    private splashCooldown = 120; // ms between splashes

    // Movement tracking for splash timing
    private lastPlayerX = 0;
    private lastPlayerY = 0;
    private isMoving = false;
    private currentSpeed = 0; // Pixels per frame

    constructor(scene: Phaser.Scene, player: Phaser.Physics.Matter.Sprite, groundLayers: Phaser.Tilemaps.TilemapLayer[]) {
        this.scene = scene;
        this.player = player;
        this.groundLayers = groundLayers;

        // Create offscreen canvas for pixel reading
        this.sampleCanvas = document.createElement('canvas');
        this.sampleCanvas.width = this.config.sampleSize;
        this.sampleCanvas.height = this.config.sampleSize;
        this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true })!;

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
            
            // Simple white splash droplet
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

        // Footprint texture (dark wet mark)
        if (!this.scene.textures.exists('wet-footprint')) {
            const graphics = this.scene.make.graphics({ x: 0, y: 0 }, false);
            const size = 6;
            
            // Simple oval-ish footprint shape - darker for better visibility
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
            quantity: 0, // Manual emission
            emitting: false
        });
        this.splashEmitter.setDepth(this.player.depth + 1);
    }

    /**
     * Sample pixels near player's feet and detect water
     * Uses tile data from ground layers
     */
    private sampleWaterAtFeet(): boolean {
        const now = Date.now();
        
        // Throttle sampling for performance
        if (now - this.lastSampleTime < this.config.sampleInterval) {
            return this.cachedWaterResult;
        }
        this.lastSampleTime = now;

        if (this.groundLayers.length === 0) {
            this.cachedWaterResult = false;
            return false;
        }

        const size = this.config.sampleSize;
        const feetX = Math.floor(this.player.x);
        const feetY = Math.floor(this.player.y + 3); // Physics body bottom (feet)

        // Clear canvas
        this.sampleCtx.clearRect(0, 0, size, size);

        // Sample pixels from each ground layer's texture
        let waterPixels = 0;
        let totalPixels = 0;

        for (const layer of this.groundLayers) {
            // Get the tile at player's feet
            const tileX = layer.worldToTileX(feetX);
            const tileY = layer.worldToTileY(feetY);
            
            if (tileX === null || tileY === null) continue;

            // Sample a small area around feet
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const tile = layer.getTileAt(tileX + dx, tileY + dy);
                    if (!tile || tile.index < 0) continue;

                    // Get the tileset for this tile
                    const tileset = tile.tileset;
                    if (!tileset) continue;

                    // Get the texture source for this tileset
                    const textureKey = tileset.image?.key;
                    if (!textureKey) continue;

                    const texture = this.scene.textures.get(textureKey);
                    if (!texture) continue;

                    const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
                    if (!source) continue;

                    // Calculate the tile's position in the tileset
                    const localTileIndex = tile.index - tileset.firstgid;
                    const imageWidth = (source as HTMLImageElement).width || tileset.tileWidth;
                    const tilesPerRow = Math.floor(imageWidth / tileset.tileWidth);
                    const tileRow = Math.floor(localTileIndex / tilesPerRow);
                    const tileCol = localTileIndex % tilesPerRow;
                    
                    const srcX = tileset.tileMargin + tileCol * (tileset.tileWidth + tileset.tileSpacing);
                    const srcY = tileset.tileMargin + tileRow * (tileset.tileHeight + tileset.tileSpacing);

                    // Draw tile to canvas
                    try {
                        this.sampleCtx.drawImage(
                            source,
                            srcX, srcY, tileset.tileWidth, tileset.tileHeight,
                            (dx + 1) * 5, (dy + 1) * 5, 5, 5
                        );
                    } catch (e) {
                        // Cross-origin or other issues
                    }
                }
            }
        }

        // Read pixels from canvas
        let maxBlueRatio = 0;
        try {
            const imageData = this.sampleCtx.getImageData(0, 0, size, size);
            const pixels = imageData.data;

            // Sample pixels
            for (let i = 0; i < pixels.length; i += 4) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const a = pixels[i + 3];

                // Skip transparent pixels
                if (a < 50) continue;

                totalPixels++;
                
                // Check if pixel is blue-ish (water)
                const total = r + g + b;
                if (total > 30) { // Avoid very dark pixels
                    const blueRatio = b / total;
                    if (blueRatio > maxBlueRatio) maxBlueRatio = blueRatio;
                    // Water: high blue ratio, blue > red, moderate total brightness
                    if (blueRatio > this.config.blueThreshold && b > r && b > 60) {
                        waterPixels++;
                    }
                }
            }

            // Determine if enough pixels are water
            if (totalPixels > 0) {
                const waterRatio = waterPixels / totalPixels;
                
                // Store debug values
                this.debugLastBlueRatio = maxBlueRatio;
                this.debugLastWaterPercent = waterRatio;
                this.debugTotalPixels = totalPixels;
                this.debugWaterPixels = waterPixels;
                
                this.cachedWaterResult = waterRatio >= this.config.waterPixelThreshold;
                return this.cachedWaterResult;
            }
        } catch (e) {
            // Canvas might not be ready yet
        }

        this.debugLastBlueRatio = maxBlueRatio;
        this.debugLastWaterPercent = 0;
        this.debugTotalPixels = totalPixels;
        this.debugWaterPixels = waterPixels;
        this.cachedWaterResult = false;
        return false;
    }

    /**
     * Create a splash effect at the player's feet
     * Size and visibility scale with water pixel percentage and player speed
     */
    private createSplash() {
        if (!this.splashEmitter) return;

        const now = Date.now();
        
        // Faster splashes when moving faster (cooldown 50-250ms based on speed)
        const dynamicCooldown = Math.max(50, 250 - this.currentSpeed * 20);
        if (now - this.lastSplashTime < dynamicCooldown) return;

        this.lastSplashTime = now;
        
        // Water intensity: 0 at threshold, 1 at full coverage
        // Use exponential curve for more dramatic scaling
        const waterRaw = Math.min(1, this.debugLastWaterPercent / 0.8); // Normalize to 0-1
        const waterIntensity = waterRaw * waterRaw; // Exponential - big difference between shallow/deep
        
        // Speed intensity: walking ~1-2 pixels/frame, sprinting ~4+ pixels/frame
        // Much more dramatic scaling
        const speedRaw = Math.min(1, this.currentSpeed / 5);
        const speedIntensity = speedRaw * speedRaw; // Exponential for dramatic sprint effect
        
        // Combined intensity - additive so both contribute significantly
        const combinedIntensity = Math.min(1, (waterIntensity + speedIntensity) / 1.5);
        
        // PARTICLE COUNT: Very noticeable difference (1-20 particles)
        const particleCount = Math.floor(4 + waterIntensity * 2 + speedIntensity * 4);
        
        // SCALE: Much larger range (0.2 to 2.0)
        const startScale = 0.2 + combinedIntensity * 1.8;
        const endScale = 0.1 + combinedIntensity * 0.5;
        
        // ALPHA: Highly visible difference (0.2 to 1.0)
        const startAlpha = 0.2 + speedIntensity * 0.05 + waterIntensity * 0.05;
        
        // SPEED: Dramatically faster particles when sprinting (15 to 150)
        const minSpeed = 15 + speedIntensity * 80;
        const maxSpeed = 30 + speedIntensity * 120;
        
        // LIFESPAN: Longer for bigger splashes
        const lifespan = 200 + combinedIntensity * 400;
        
        // Apply emitter properties
        this.splashEmitter.setParticleScale(startScale, endScale);
        this.splashEmitter.setParticleAlpha(startAlpha, 0);
        this.splashEmitter.setParticleSpeed(minSpeed, maxSpeed);
        this.splashEmitter.setParticleLifespan(lifespan);
        
        // Wider spread when sprinting
        const spread = 4 + speedIntensity * 8;
        
        // Emit splash particles at feet level
        this.splashEmitter.emitParticleAt(
            this.player.x + Phaser.Math.Between(-spread, spread),
            this.player.y + 4,
            particleCount
        );
    }

    /**
     * Create a wet footprint at the current position
     */
    private createFootprint() {
        const x = this.player.x;
        const y = this.player.y + 3; // Physics body bottom (feet)

        // Check spacing from last footprint
        const dist = Phaser.Math.Distance.Between(x, y, this.lastFootprintPos.x, this.lastFootprintPos.y);
        if (dist < this.config.footprintSpacing) return;

        // Create footprint sprite
        const footprint = this.scene.add.sprite(x, y, 'wet-footprint');
        footprint.setDepth(15); // Above first couple ground layers
        footprint.setAlpha(0.7);
        
        // Add slight random rotation
        footprint.setRotation(Phaser.Math.DegToRad(Phaser.Math.Between(-15, 15)));

        this.footprints.push({
            sprite: footprint,
            createdAt: Date.now()
        });

        this.lastFootprintPos.set(x, y);
    }

    /**
     * Update footprints - fade out and remove old ones
     */
    private updateFootprints() {
        const now = Date.now();
        
        for (let i = this.footprints.length - 1; i >= 0; i--) {
            const fp = this.footprints[i];
            const age = now - fp.createdAt;

            if (age >= this.config.footprintDuration) {
                // Remove old footprint
                fp.sprite.destroy();
                this.footprints.splice(i, 1);
            } else {
                // Fade out over time
                const fadeStart = this.config.footprintDuration * 0.5; // Start fading at 50%
                if (age > fadeStart) {
                    const fadeProgress = (age - fadeStart) / (this.config.footprintDuration - fadeStart);
                    fp.sprite.setAlpha(0.7 * (1 - fadeProgress));
                }
            }
        }
    }

    /**
     * Main update loop - call each frame
     */
    update(delta: number) {
        // Check if player is moving and calculate speed
        const dx = this.player.x - this.lastPlayerX;
        const dy = this.player.y - this.lastPlayerY;
        this.currentSpeed = Math.sqrt(dx * dx + dy * dy);
        this.isMoving = this.currentSpeed > 0.1;
        this.lastPlayerX = this.player.x;
        this.lastPlayerY = this.player.y;

        // Sample water at feet
        const wasInWater = this.isInWater;
        this.isInWater = this.sampleWaterAtFeet();

        // Track time spent in water
        if (this.isInWater) {
            this.timeInWater += delta;
        }

        // Handle entering/exiting water
        if (this.isInWater && !wasInWater) {
            // Just entered water
            this.isWet = true;
            this.timeInWater = 0; // Reset timer on entry
        } else if (!this.isInWater && wasInWater) {
            // Just left water - calculate wet duration based on time spent in water
            // Min 500ms, max 3000ms, scales with time in water
            const wetDuration = Math.min(3000, Math.max(500, this.timeInWater * 0.5));
            this.wetTimer = wetDuration;
            this.timeInWater = 0; // Reset for next water encounter
        }

        // Update wet timer
        if (!this.isInWater && this.isWet) {
            this.wetTimer -= delta;
            if (this.wetTimer <= 0) {
                this.isWet = false;
            }
        }

        // Create effects based on state
        if (this.isInWater && this.isMoving) {
            this.createSplash();
        }

        if (this.isWet && !this.isInWater && this.isMoving) {
            this.createFootprint();
        }

        // Update existing footprints
        this.updateFootprints();

        // Keep splash emitter at correct depth
        if (this.splashEmitter) {
            this.splashEmitter.setDepth(this.player.depth + 1);
        }
    }

    /**
     * Check if player is currently in water
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
     * Get debug info for water detection
     */
    getDebugInfo(): { blueRatio: number; waterPercent: number; totalPixels: number; waterPixels: number; inWater: boolean; isWet: boolean } {
        return {
            blueRatio: this.debugLastBlueRatio,
            waterPercent: this.debugLastWaterPercent,
            totalPixels: this.debugTotalPixels,
            waterPixels: this.debugWaterPixels,
            inWater: this.isInWater,
            isWet: this.isWet
        };
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.splashEmitter?.destroy();
        this.footprints.forEach(fp => fp.sprite.destroy());
        this.footprints = [];
    }
}
