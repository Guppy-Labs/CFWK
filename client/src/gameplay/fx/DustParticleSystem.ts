import Phaser from 'phaser';

/**
 * Creates dust particle effects at the player's feet.
 * Samples ground color to tint particles appropriately.
 */
export class DustParticleSystem {
    private scene: Phaser.Scene;
    private target: Phaser.Physics.Matter.Sprite;
    private emitter?: Phaser.GameObjects.Particles.ParticleEmitter;
    private map?: Phaser.Tilemaps.Tilemap;

    // Particle generation state
    private lastX = 0;
    private lastY = 0;
    private distanceTraveled = 0;

    // Configuration
    private readonly config = {
        // Distance thresholds for spawning particles
        walkSpawnDistance: 30,   // Pixels traveled before spawning when walking
        runSpawnDistance: 20,    // More frequent spawns when running

        // Speed thresholds
        walkThreshold: 0.5,      // Min speed to be "walking"
        runThreshold: 2.0,       // Min speed to be "running"

        // Particle appearance
        particleScale: { start: 0.7, end: 0.1 },
        particleAlpha: { start: 0.6, end: 0 },
        particleLifespan: { min: 450, max: 650 },

        // Spawn counts
        walkParticles: { min: 1, max: 1 },
        runParticles: { min: 1, max: 3 },

        // Movement
        speedX: { min: -8, max: 8 },
        speedY: { min: -15, max: -5 },  // Rise upward
        gravityY: 20,                    // Gentle fall

        // Default tint (earthy brown-gray)
        defaultColor: 0x8b7355
    };

    constructor(scene: Phaser.Scene, target: Phaser.Physics.Matter.Sprite, map?: Phaser.Tilemaps.Tilemap) {
        this.scene = scene;
        this.target = target;
        this.map = map;

        this.lastX = target.x;
        this.lastY = target.y;

        this.createParticleTexture();
        this.setupEmitter();
    }

    /**
     * Generate a simple soft circle texture for dust particles
     */
    private createParticleTexture() {
        const key = 'dust-particle';
        if (this.scene.textures.exists(key)) return;

        const size = 8;
        const graphics = this.scene.make.graphics({ x: 0, y: 0 }, false);
        
        // Draw a soft circular gradient
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(size / 2, size / 2, size / 2);
        
        // Add softer edges with concentric circles
        graphics.fillStyle(0xffffff, 0.6);
        graphics.fillCircle(size / 2, size / 2, size / 3);
        
        graphics.generateTexture(key, size, size);
        graphics.destroy();
    }

    private setupEmitter() {
        this.emitter = this.scene.add.particles(0, 0, 'dust-particle', {
            lifespan: this.config.particleLifespan,
            scale: this.config.particleScale,
            alpha: this.config.particleAlpha,
            speedX: this.config.speedX,
            speedY: this.config.speedY,
            gravityY: this.config.gravityY,
            tint: this.config.defaultColor,
            emitting: false,
            blendMode: Phaser.BlendModes.NORMAL
        });

        // Set depth just below player
        this.emitter.setDepth(this.target.depth - 2);
    }

    /**
     * Sample ground tile color beneath the player
     */
    private sampleGroundColor(x: number, y: number): number {
        if (!this.map) return this.config.defaultColor;

        // Check Ground layer first
        const groundLayer = this.map.getLayer('Ground');
        if (!groundLayer?.tilemapLayer) return this.config.defaultColor;

        const tile = groundLayer.tilemapLayer.getTileAtWorldXY(x, y);
        if (!tile) return this.config.defaultColor;

        // Try to get a representative color from the tileset
        // We'll sample the tileset texture at this tile's position
        const tileset = tile.tileset;
        if (!tileset) return this.config.defaultColor;

        // Get the texture for this tileset
        const textureKey = tileset.image?.key;
        if (!textureKey) return this.config.defaultColor;

        const texture = this.scene.textures.get(textureKey);
        if (!texture) return this.config.defaultColor;

        // Calculate tile position in the tileset image
        const tilesetX = tileset.tileMargin + (tile.index % tileset.columns) * (tileset.tileWidth + tileset.tileSpacing);
        const tilesetY = tileset.tileMargin + Math.floor(tile.index / tileset.columns) * (tileset.tileHeight + tileset.tileSpacing);

        // Sample center of tile
        const sampleX = tilesetX + tileset.tileWidth / 2;
        const sampleY = tilesetY + tileset.tileHeight / 2;

        try {
            const pixel = texture.getPixel(sampleX, sampleY);
            if (pixel) {
                // Desaturate and lighten slightly for dust effect
                const r = Math.min(255, pixel.r + 40);
                const g = Math.min(255, pixel.g + 35);
                const b = Math.min(255, pixel.b + 30);
                return Phaser.Display.Color.GetColor(r, g, b);
            }
        } catch {
            // Fallback if pixel sampling fails
        }

        return this.config.defaultColor;
    }

    /**
     * Update particle system - call every frame
     */
    update() {
        if (!this.emitter || !this.target.active) return;

        // Calculate distance moved
        const dx = this.target.x - this.lastX;
        const dy = this.target.y - this.lastY;
        const distance = Math.hypot(dx, dy);

        // Get current speed
        const velocity = this.target.body?.velocity as MatterJS.Vector | undefined;
        const speed = velocity ? Math.hypot(velocity.x, velocity.y) : 0;

        // Determine movement state
        const isWalking = speed > this.config.walkThreshold && speed < this.config.runThreshold;
        const isRunning = speed >= this.config.runThreshold;

        // Only generate dust when actually moving on ground
        if (isWalking || isRunning) {
            this.distanceTraveled += distance;

            const spawnThreshold = isRunning ? this.config.runSpawnDistance : this.config.walkSpawnDistance;

            if (this.distanceTraveled >= spawnThreshold) {
                // Reset distance counter
                this.distanceTraveled = 0;

                // Sample ground color at player's feet
                // The sprite origin is set so that target.y is near the feet
                const footY = this.target.y;
                const groundColor = this.sampleGroundColor(this.target.x, footY);

                // Calculate spawn position at player's feet
                const spawnX = this.target.x;
                const spawnY = footY; // At foot level

                // Determine particle count based on movement
                const particleConfig = isRunning ? this.config.runParticles : this.config.walkParticles;
                const count = Phaser.Math.Between(particleConfig.min, particleConfig.max);

                // Update tint and emit
                this.emitter.particleTint = groundColor;
                
                // Add velocity-based spread (particles kick backwards)
                const kickX = velocity ? -velocity.x * 0.5 : 0;
                const kickY = velocity ? -velocity.y * 0.3 : 0;

                // Emit particles
                for (let i = 0; i < count; i++) {
                    this.emitter.emitParticleAt(
                        spawnX + Phaser.Math.Between(-3, 3),
                        spawnY + Phaser.Math.Between(-1, 1)
                    );
                }
            }
        } else {
            // Reset distance when stationary to prevent burst on movement start
            this.distanceTraveled = 0;
        }

        // Update tracking
        this.lastX = this.target.x;
        this.lastY = this.target.y;

        // Keep emitter depth synced
        this.emitter.setDepth(this.target.depth - 2);
    }

    /**
     * Set the tilemap for ground color sampling
     */
    setMap(map: Phaser.Tilemaps.Tilemap) {
        this.map = map;
    }

    /**
     * Toggle dust effects
     */
    setEnabled(enabled: boolean) {
        if (this.emitter) {
            this.emitter.visible = enabled;
        }
    }

    /**
     * Clean up
     */
    destroy() {
        if (this.emitter) {
            this.emitter.destroy();
        }
    }
}
