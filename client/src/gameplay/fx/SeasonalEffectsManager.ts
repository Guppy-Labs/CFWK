import Phaser from 'phaser';
import { Season, WorldTimeState } from '@cfwk/shared';

/**
 * Configuration for a single particle layer
 */
interface ParticleLayerConfig {
    texture: string;
    alpha: { min: number; max: number };
    scale: { min: number; max: number };
    speedY: { min: number; max: number };
    speedX: { min: number; max: number }; // Inherent horizontal drift
    lifespan: { min: number; max: number };
    frequency: number;      // Ms between emissions
    quantity: number;       // Particles per emission
    color?: number;         // Tint color
    depth: number;          // Z-index
}

/**
 * Seasonal visual configuration
 */
interface SeasonConfig {
    tint: { r: number; g: number; b: number; a: number };
    layers: ParticleLayerConfig[];
    baseWindX: number;
}

const SEASON_CONFIGS: Record<Season, SeasonConfig> = {
    [Season.Winter]: {
        tint: { r: 180, g: 210, b: 255, a: 0.18 }, // Cool blue tint
        baseWindX: -20,
        layers: [
            // Background Snow (Small, Slow)
            {
                texture: 'particle-snow-small',
                alpha: { min: 0.4, max: 0.6 },
                scale: { min: 1, max: 1 },
                speedY: { min: 30, max: 60 },
                speedX: { min: -5, max: 5 },
                lifespan: { min: 10000, max: 15000 },
                frequency: 100,
                quantity: 1,
                color: 0xEBF5FF,
                depth: 850
            },
            // Midground Snow (Medium)
            {
                texture: 'particle-snow-mid',
                alpha: { min: 0.7, max: 0.9 },
                scale: { min: 1, max: 1 },
                speedY: { min: 80, max: 120 },
                speedX: { min: -10, max: 10 },
                lifespan: { min: 6000, max: 10000 },
                frequency: 200,
                quantity: 1,
                color: 0xEBF5FF,
                depth: 851
            },
            // Foreground Snow (Large, Fast)
            {
                texture: 'particle-snow-large',
                alpha: { min: 0.9, max: 1.0 },
                scale: { min: 1, max: 1 },
                speedY: { min: 150, max: 200 },
                speedX: { min: -20, max: 20 },
                lifespan: { min: 4000, max: 7000 },
                frequency: 300,
                quantity: 1,
                color: 0xEBF5FF,
                depth: 852
            }
        ]
    },
    [Season.Spring]: {
        tint: { r: 200, g: 255, b: 220, a: 0.12 }, // Fresh green/pink tint
        baseWindX: 10,
        layers: [
            {
                texture: 'particle-petal',
                alpha: { min: 0.6, max: 0.9 },
                scale: { min: 1, max: 1 },
                speedY: { min: 20, max: 50 },
                speedX: { min: -15, max: 15 },
                lifespan: { min: 8000, max: 12000 },
                frequency: 250,
                quantity: 1,
                color: 0xFFB7C5,
                depth: 850
            }
        ]
    },
    [Season.Summer]: {
        tint: { r: 255, g: 245, b: 200, a: 0.10 }, // Warm golden tint
        baseWindX: 5,
        layers: [
            {
                texture: 'particle-dust',
                alpha: { min: 0.2, max: 0.5 },
                scale: { min: 1, max: 1 },
                speedY: { min: 5, max: 20 },
                speedX: { min: -10, max: 10 },
                lifespan: { min: 5000, max: 10000 },
                frequency: 400,
                quantity: 1,
                color: 0xFFFFDD,
                depth: 850
            }
        ]
    },
    [Season.Autumn]: {
        tint: { r: 255, g: 210, b: 170, a: 0.15 }, // Warm orange/brown tint
        baseWindX: 30,
        layers: [
            {
                texture: 'particle-leaf',
                alpha: { min: 0.7, max: 1.0 },
                scale: { min: 1, max: 1 },
                speedY: { min: 50, max: 100 },
                speedX: { min: 20, max: 60 },
                lifespan: { min: 6000, max: 10000 },
                frequency: 200,
                quantity: 1,
                color: 0xFFA500,
                depth: 850
            }
        ]
    }
};

/**
 * SeasonalEffectsManager
 * 
 * Handles pixel-perfect seasonal visual effects:
 * - Color tint overlays that shift with seasons
 * - Multi-layered particle effects (snow, petals, leaves, dust)
 * - Reactive wind based on player movement
 */
export class SeasonalEffectsManager {
    private scene: Phaser.Scene;
    private particlesEnabled: boolean = false;
    
    // Color overlay
    private tintOverlay: Phaser.GameObjects.Rectangle | null = null;
    private currentTint = { r: 255, g: 255, b: 255, a: 0 };
    private targetTint = { r: 255, g: 255, b: 255, a: 0 };
    
    // Particle emitters (one for each layer in the current config)
    private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
    private fadingOutEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
    private currentSeason: Season = Season.Winter;
    
    // Transition state
    private readonly TRANSITION_DURATION = 3000; // 3 seconds in ms
    private transitionProgress: number = 1; // 0 to 1, 1 = fully transitioned
    private isTransitioning: boolean = false;
    
    // Whether effects are enabled
    private enabled: boolean = true;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    /**
     * Initialize the seasonal effects system
     */
    initialize() {
        this.createParticleTextures();
        this.createTintOverlay();
    }

    /**
     * Create pixel-perfect particle textures
     */
    private createParticleTextures() {
        const graphics = this.scene.make.graphics({ x: 0, y: 0 });

        // SNOW 1: Distant speck (1x1)
        graphics.clear();
        graphics.fillStyle(0xFFFFFF, 1);
        graphics.fillRect(0, 0, 1, 1);
        graphics.generateTexture('particle-snow-small', 1, 1);

        // SNOW 2: Midground block (2x2)
        graphics.clear();
        graphics.fillStyle(0xFFFFFF, 1);
        graphics.fillRect(0, 0, 2, 2);
        graphics.generateTexture('particle-snow-mid', 2, 2);

        // SNOW 3: Close cross (3x3)
        graphics.clear();
        graphics.fillStyle(0xFFFFFF, 1);
        graphics.fillRect(1, 0, 1, 1); // Top center
        graphics.fillRect(0, 1, 3, 1); // Middle row
        graphics.fillRect(1, 2, 1, 1); // Bottom center
        graphics.generateTexture('particle-snow-large', 3, 3);

        // LEAF: Pixelated debris (4x3)
        graphics.clear();
        graphics.fillStyle(0xFFFFFF, 1);
        graphics.fillRect(1, 0, 2, 1);
        graphics.fillRect(0, 1, 4, 1);
        graphics.fillRect(1, 2, 2, 1);
        graphics.generateTexture('particle-leaf', 4, 3);

        // PETAL: Small pixel cluster (2x2 or 3x2)
        graphics.clear();
        graphics.fillStyle(0xFFFFFF, 1);
        graphics.fillRect(0, 0, 2, 1);
        graphics.fillRect(0, 1, 2, 1);
        graphics.generateTexture('particle-petal', 2, 2);

        // DUST: 1x1 
        graphics.clear();
        graphics.fillStyle(0xFFFFFF, 1);
        graphics.fillRect(0, 0, 1, 1);
        graphics.generateTexture('particle-dust', 1, 1);

        graphics.destroy();
    }

    /**
     * Create the color tint overlay
     */
    private createTintOverlay() {
        const { width, height } = this.scene.cameras.main;
        
        this.tintOverlay = this.scene.add.rectangle(
            0, 0,
            width * 3, height * 3, // Oversized to cover camera movement
            0xffffff, 0
        );
        this.tintOverlay.setOrigin(0, 0);
        this.tintOverlay.setScrollFactor(0); // Fixed to camera
        this.tintOverlay.setDepth(900); // Above most things, below UI
        this.tintOverlay.setBlendMode(Phaser.BlendModes.MULTIPLY);
    }

    /**
     * Setup particle emitters for a given season
     */
    private setupParticleEmitters(season: Season) {
        if (!this.particlesEnabled) return;
        // Destroy existing emitters
        this.destroyEmitters();

        const config = SEASON_CONFIGS[season];
        if (!this.enabled || !config.layers.length) return;

        const camera = this.scene.cameras.main;

        // Create an emitter for each layer definition
        config.layers.forEach(layerConfig => {
            const emitter = this.scene.add.particles(0, 0, layerConfig.texture, {
                // Spawn across the entire screen width + buffer
                x: { min: -100, max: camera.width + 100 },
                y: -20, // Just above screen
                
                speedY: layerConfig.speedY,
                speedX: layerConfig.speedX,
                lifespan: layerConfig.lifespan,
                frequency: layerConfig.frequency,
                quantity: layerConfig.quantity,
                scale: layerConfig.scale,
                alpha: layerConfig.alpha,
                tint: layerConfig.color,
                blendMode: Phaser.BlendModes.NORMAL
            });

            emitter.setScrollFactor(0); // Stick to screen (we simulate movement)
            emitter.setDepth(layerConfig.depth);
            
            // Pre-warm (fast forward simulation)
            // Not directly supported on ParticleEmitter in 3.60+, so we just start emitting
            // Alternatively we could burst some particles randomly
            this.emitters.push(emitter);
        });
    }

    private destroyEmitters() {
        this.emitters.forEach(emitter => {
            emitter.stop();
            emitter.destroy();
        });
        this.emitters = [];
    }

    /**
     * Update seasonal effects based on world time
     * Call this each frame
     */
    update(worldTime: WorldTimeState, delta: number, playerVelocity: {x: number, y: number} = {x: 0, y: 0}) {
        if (!this.enabled) return;

        // Check for season change
        if (worldTime.season !== this.currentSeason && !this.isTransitioning) {
            this.startSeasonTransition(worldTime.season);
        }

        // Update transition progress
        if (this.isTransitioning) {
            this.transitionProgress += delta / this.TRANSITION_DURATION;
            if (this.transitionProgress >= 1) {
                this.transitionProgress = 1;
                this.isTransitioning = false;
                this.cleanupFadingEmitters();
            }
        }

        // Update color tint with smooth lerp based on transition progress
        this.updateTintOverlay(delta);
        
        // Update fading emitters alpha
        this.updateEmitterAlphas();

        // Update particle physics (reactive wind)
        this.updateParticles(playerVelocity);
    }

    private updateParticles(playerVelocity: {x: number, y: number}) {
        if (!this.emitters.length && !this.fadingOutEmitters.length) return;

        const config = SEASON_CONFIGS[this.currentSeason];
        
        // Calculate wind effect
        // 1. Base wind from season
        // 2. Reactive wind from player movement (moving right = wind blows left)
        const playerFactor = -0.5; // Strength of player movement influence
        const reactiveWindX = playerVelocity.x * playerFactor;
        
        // Total wind force
        const totalWindX = config.baseWindX + reactiveWindX;

        // Apply to current emitters
        this.emitters.forEach(emitter => {
            emitter.gravityX = totalWindX;
        });
        
        // Apply to fading emitters too
        this.fadingOutEmitters.forEach(emitter => {
            emitter.gravityX = totalWindX;
        });
    }
    
    /**
     * Update emitter alphas during transition
     */
    private updateEmitterAlphas() {
        // Fade in new emitters
        const fadeInAlpha = this.transitionProgress;
        this.emitters.forEach(emitter => {
            emitter.setAlpha(fadeInAlpha);
        });
        
        // Fade out old emitters
        const fadeOutAlpha = 1 - this.transitionProgress;
        this.fadingOutEmitters.forEach(emitter => {
            emitter.setAlpha(fadeOutAlpha);
        });
    }
    
    /**
     * Clean up fading emitters after transition completes
     */
    private cleanupFadingEmitters() {
        this.fadingOutEmitters.forEach(emitter => {
            emitter.stop();
            emitter.destroy();
        });
        this.fadingOutEmitters = [];
        
        // Ensure new emitters are fully visible
        this.emitters.forEach(emitter => {
            emitter.setAlpha(1);
        });
    }

    /**
     * Start transitioning to a new season
     */
    private startSeasonTransition(newSeason: Season) {
        const oldSeason = this.currentSeason;
        this.currentSeason = newSeason;
        
        // Start transition timer
        this.isTransitioning = true;
        this.transitionProgress = 0;
        
        // Set target tint to new season
        const newConfig = SEASON_CONFIGS[newSeason];
        this.targetTint = { ...newConfig.tint };
        
        // Move current emitters to fading out list (stop spawning new particles)
        this.fadingOutEmitters.forEach(e => { e.stop(); e.destroy(); }); // Clean any existing
        this.fadingOutEmitters = this.emitters.map(emitter => {
            emitter.stop(); // Stop spawning new particles, existing ones continue
            return emitter;
        });
        this.emitters = [];
        
        // Create new emitters for the new season (starting at 0 alpha)
        this.setupParticleEmitters(newSeason);
        this.emitters.forEach(emitter => emitter.setAlpha(0));

        console.log(`[SeasonalEffects] Transitioning from ${Season[oldSeason]} to ${Season[newSeason]} over 3 seconds`);
    }

    /**
     * Smoothly update the tint overlay color
     */
    private updateTintOverlay(_delta: number) {
        if (!this.tintOverlay) return;

        // Use transition progress for smooth 3-second lerp
        this.currentTint.r = Phaser.Math.Linear(this.currentTint.r, this.targetTint.r, this.transitionProgress);
        this.currentTint.g = Phaser.Math.Linear(this.currentTint.g, this.targetTint.g, this.transitionProgress);
        this.currentTint.b = Phaser.Math.Linear(this.currentTint.b, this.targetTint.b, this.transitionProgress);
        this.currentTint.a = Phaser.Math.Linear(this.currentTint.a, this.targetTint.a, this.transitionProgress);

        // Apply to overlay
        const color = Phaser.Display.Color.GetColor(
            Math.floor(this.currentTint.r),
            Math.floor(this.currentTint.g),
            Math.floor(this.currentTint.b)
        );
        this.tintOverlay.setFillStyle(color, this.currentTint.a);

        // Fixed position for overlay
        this.tintOverlay.setPosition(0, 0); 
    }

    /**
     * Set initial season without transition
     */
    setInitialSeason(season: Season) {
        this.currentSeason = season;
        
        const config = SEASON_CONFIGS[season];
        this.currentTint = { ...config.tint };
        this.targetTint = { ...config.tint };

        // Apply immediately
        if (this.tintOverlay) {
            const color = Phaser.Display.Color.GetColor(
                Math.floor(this.currentTint.r),
                Math.floor(this.currentTint.g),
                Math.floor(this.currentTint.b)
            );
            this.tintOverlay.setFillStyle(color, this.currentTint.a);
        }

        this.setupParticleEmitters(season);
    }

    /**
     * Enable or disable all seasonal effects
     */
    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        
        if (!enabled) {
            if (this.tintOverlay) this.tintOverlay.setAlpha(0);
            this.destroyEmitters();
        } else {
            if (this.tintOverlay) this.tintOverlay.setAlpha(1);
            this.setupParticleEmitters(this.currentSeason);
        }
    }

    /**
     * Check if effects are enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Get current season
     */
    getCurrentSeason(): Season {
        return this.currentSeason;
    }

    /**
     * Handle camera/screen resize
     */
    resize(width: number, height: number) {
        if (this.tintOverlay) {
            this.tintOverlay.setSize(width * 3, height * 3);
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this.tintOverlay) {
            this.tintOverlay.destroy();
            this.tintOverlay = null;
        }
        this.destroyEmitters();
    }
}