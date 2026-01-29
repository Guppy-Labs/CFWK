import Phaser from 'phaser';
import { getTiledProperty } from '../map/TiledTypes';
import { OcclusionManager } from '../map/OcclusionManager';
import { LightingManager } from './LightingManager';

/**
 * FireParticleSystem - Creates a beautiful pixel-art campfire effect
 * 
 * Uses multiple layered emitters to simulate:
 * - Inner hot core (bright yellow/white)
 * - Main flame body (orange/red gradient)
 * - Outer flame wisps (darker red)
 * - Rising embers/sparks
 * - Subtle smoke above
 * 
 * Designed to work with Tiled maps - spawns at POI points named "Fire"
 * Supports "Base" property to link fire depth to a specific layer for occlusion
 */
export class FireParticleSystem {
    private scene: Phaser.Scene;
    private x: number;
    private y: number;
    private depth: number;
    private baseDepth: number;
    private baseLayerTag: string | null = null;
    private lightId: string;

    // Light properties - use multiple lights for elliptical effect
    private lightingManager?: LightingManager;
    private flickerTime: number = 0;
    private baseIntensity: number = 1.2;
    private baseRadius: number = 100;
    private lightOffsets = [
        { id: 'center', x: 0, y: 0, radiusMult: 1.0, intensityMult: 0.6 },
        { id: 'left', x: -30, y: 4, radiusMult: 0.7, intensityMult: 0.3 },
        { id: 'right', x: 30, y: 4, radiusMult: 0.7, intensityMult: 0.3 },
    ];

    // Emitter layers
    private coreEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
    private flameEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
    private outerFlameEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
    private emberEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
    private smokeBackEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
    private smokeFrontEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

    // Configuration for pixel-art campfire (chill/relaxed style)
    private readonly config = {
        // Core - the hottest, brightest center
        core: {
            scale: { start: 0.4, end: 0.1 },
            alpha: { start: 1, end: 0.3 },
            lifespan: { min: 1000, max: 1500 },
            speed: { min: 15, max: 30 },
            angle: { min: -100, max: -80 },
            frequency: 200,
            quantity: 2,
            tint: 0xffffcc, // Bright yellow-white
            blendMode: Phaser.BlendModes.ADD,
            rotate: { min: -15, max: 15 }
        },
        // Main flame body
        flame: {
            scale: { start: 0.6, end: 0.15, ease: 'sine.out' },
            alpha: { start: 0.9, end: 0 },
            lifespan: { min: 1500, max: 2200 },
            speed: { min: 20, max: 45 },
            angle: { min: -105, max: -75 },
            frequency: 150,
            quantity: 4,
            // Fire color gradient: yellow -> orange -> red -> dark red
            colors: [0xfacc22, 0xf89800, 0xf83600, 0x9f0404],
            colorEase: 'quad.out',
            blendMode: Phaser.BlendModes.ADD,
            rotate: { start: -20, end: 20 }
        },
        // Outer wisps - dancing flames
        outerFlame: {
            scale: { start: 0.5, end: 0.05, ease: 'sine.in' },
            alpha: { start: 0.7, end: 0 },
            lifespan: { min: 1300, max: 1900 },
            speed: { min: 25, max: 55 },
            angle: { min: -115, max: -65 },
            frequency: 250,
            quantity: 3,
            colors: [0xf89800, 0xf83600, 0x9f0404, 0x4a0202],
            colorEase: 'sine.out',
            blendMode: Phaser.BlendModes.ADD,
            rotate: { start: -30, end: 30 }
        },
        // Rising embers/sparks
        ember: {
            scale: { start: 0.15, end: 0.02 },
            alpha: { start: 1, end: 0 },
            lifespan: { min: 2500, max: 4000 },
            speed: { min: 18, max: 50 },
            angle: { min: -120, max: -60 },
            frequency: 600,
            quantity: 2,
            tint: 0xff6600,
            blendMode: Phaser.BlendModes.ADD,
            // Embers drift sideways
            accelerationX: { min: -6, max: 6 },
            accelerationY: -3,
            rotate: { min: -45, max: 45 }
        },
        // Smoke rising above - splits into back and front layers
        smoke: {
            scale: { start: 0.3, end: 1.0 },
            alpha: { start: 0.22, end: 0 },
            lifespan: { min: 5000, max: 8000 },
            speed: { min: 6, max: 12 },
            angle: { min: -105, max: -75 },
            frequency: 400,
            quantity: 2,
            tint: 0x555555,
            blendMode: Phaser.BlendModes.NORMAL,
            // Smoke starts above the flame
            offsetY: -16,
            rotate: { start: -10, end: 40 },
            // Wide horizontal spread for smoke (billowing effect)
            emitWidth: 40,
            emitHeight: 8,
            // Smoke drifts slightly
            accelerationX: { min: -2, max: 2 }
        },
        // Emit zone - spawn area for particles
        emitZone: {
            width: 16,  // Horizontal spread at base
            height: 12   // Slight vertical variation
        }
    };

    constructor(scene: Phaser.Scene, x: number, y: number, depth: number = 100, baseLayerTag: string | null = null) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.depth = depth;
        this.baseDepth = depth;
        this.baseLayerTag = baseLayerTag;
        this.lightId = `fire-${x}-${y}-${Date.now()}`;

        this.createParticleTextures();
        this.createEmitters();
    }

    /**
     * Set up the light source for this fire
     * Uses multiple overlapping lights to create an elliptical glow for angled view
     * Call this after the LightingManager is available
     */
    setupLight(lightingManager: LightingManager, radius: number = 100, intensity: number = 1.2) {
        this.lightingManager = lightingManager;
        this.baseRadius = radius;
        this.baseIntensity = intensity;

        // Create multiple lights for elliptical effect (wider than tall)
        for (const offset of this.lightOffsets) {
            lightingManager.addLight(
                `${this.lightId}-${offset.id}`,
                this.x + offset.x,
                this.y + offset.y,
                radius * offset.radiusMult,
                0xffaa44, // Warm orange
                intensity * offset.intensityMult
            );
        }
    }

    /**
     * Update the fire light flickering effect
     * Call this in the game's update loop
     */
    updateLight(delta: number) {
        if (!this.lightingManager) return;

        this.flickerTime += delta;

        // Create subtle organic flickering using multiple sine waves
        const flicker1 = Math.sin(this.flickerTime * 0.006) * 0.04;
        const flicker2 = Math.sin(this.flickerTime * 0.011) * 0.03;
        const flicker3 = Math.sin(this.flickerTime * 0.019) * 0.02;
        const randomFlicker = (Math.random() - 0.5) * 0.03;

        const totalFlicker = flicker1 + flicker2 + flicker3 + randomFlicker;

        // Apply flickering to all lights
        for (const offset of this.lightOffsets) {
            const lightId = `${this.lightId}-${offset.id}`;
            const newIntensity = this.baseIntensity * offset.intensityMult * (1 + totalFlicker);
            this.lightingManager.updateLightIntensity(lightId, newIntensity);

            // Very subtle radius variation
            const radiusFlicker = 1 + (flicker1 + flicker2) * 0.1;
            this.lightingManager.updateLightRadius(lightId, this.baseRadius * offset.radiusMult * radiusFlicker);
        }
    }

    /**
     * Get the base layer tag this fire is linked to
     */
    getBaseLayerTag(): string | null {
        return this.baseLayerTag;
    }

    /**
     * Update depth based on occlusion state
     * Call this in the game's update loop
     */
    updateOcclusion(occlusionManager: OcclusionManager) {
        if (!this.baseLayerTag) return;

        if (occlusionManager.isTagOccluded(this.baseLayerTag)) {
            // Layer is occluded (in front of player), fire should also be in front
            const occludedDepth = occlusionManager.getOccludedDepth(this.baseLayerTag);
            this.setDepth(occludedDepth + 1); // +1 to be just above the layer
        } else {
            // Layer is at base depth, fire should be too
            this.setDepth(this.baseDepth);
        }
    }

    /**
     * Create all the particle textures we need
     */
    private createParticleTextures() {
        // Soft circular glow for flames
        if (!this.scene.textures.exists('fire-particle')) {
            this.createGlowTexture('fire-particle', 16, 0xffffff);
        }

        // Smaller, sharper particles for embers
        if (!this.scene.textures.exists('ember-particle')) {
            this.createGlowTexture('ember-particle', 6, 0xffffff, 0.8);
        }

        // Larger, softer particles for smoke
        if (!this.scene.textures.exists('smoke-particle')) {
            this.createSmokeTexture('smoke-particle', 24);
        }
    }

    /**
     * Create a soft glowing square texture (pixel-art style)
     */
    private createGlowTexture(key: string, size: number, color: number, sharpness: number = 0.5) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0 }, false);
        
        // Draw concentric squares for pixel-art glow effect
        const steps = 6;
        for (let i = steps; i >= 0; i--) {
            const boxSize = size * (i / steps);
            const offset = (size - boxSize) / 2;
            const alpha = Math.pow(1 - (i / steps), sharpness);
            graphics.fillStyle(color, alpha);
            graphics.fillRect(offset, offset, boxSize, boxSize);
        }
        
        graphics.generateTexture(key, size, size);
        graphics.destroy();
    }

    /**
     * Create a softer, more diffuse smoke texture (square)
     */
    private createSmokeTexture(key: string, size: number) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0 }, false);
        
        // Very soft gradient for smoke using squares
        const steps = 8;
        for (let i = steps; i >= 0; i--) {
            const boxSize = size * (i / steps);
            const offset = (size - boxSize) / 2;
            const alpha = Math.pow(1 - (i / steps), 0.3) * 0.6;
            graphics.fillStyle(0xffffff, alpha);
            graphics.fillRect(offset, offset, boxSize, boxSize);
        }
        
        graphics.generateTexture(key, size, size);
        graphics.destroy();
    }

    /**
     * Create all the fire emitters
     */
    private createEmitters() {
        const { x, y, depth, config } = this;
        const emitZone = new Phaser.Geom.Rectangle(
            -config.emitZone.width / 2,
            -config.emitZone.height / 2,
            config.emitZone.width,
            config.emitZone.height
        );

        // Core emitter - brightest center
        this.coreEmitter = this.scene.add.particles(x, y, 'fire-particle', {
            scale: config.core.scale,
            alpha: config.core.alpha,
            lifespan: config.core.lifespan,
            speed: config.core.speed,
            angle: config.core.angle,
            frequency: config.core.frequency,
            quantity: config.core.quantity,
            tint: config.core.tint,
            blendMode: config.core.blendMode,
            rotate: config.core.rotate,
            emitZone: { type: 'random', source: emitZone }
        });
        this.coreEmitter.setDepth(depth + 3);

        // Main flame emitter with color gradient
        this.flameEmitter = this.scene.add.particles(x, y, 'fire-particle', {
            scale: config.flame.scale,
            alpha: config.flame.alpha,
            lifespan: config.flame.lifespan,
            speed: config.flame.speed,
            angle: config.flame.angle,
            frequency: config.flame.frequency,
            quantity: config.flame.quantity,
            color: config.flame.colors,
            colorEase: config.flame.colorEase,
            blendMode: config.flame.blendMode,
            rotate: config.flame.rotate,
            emitZone: { type: 'random', source: emitZone }
        });
        this.flameEmitter.setDepth(depth + 2);

        // Outer flame wisps
        const widerEmitZone = new Phaser.Geom.Rectangle(
            -config.emitZone.width,
            -config.emitZone.height / 2,
            config.emitZone.width * 2,
            config.emitZone.height
        );
        
        this.outerFlameEmitter = this.scene.add.particles(x, y, 'fire-particle', {
            scale: config.outerFlame.scale,
            alpha: config.outerFlame.alpha,
            lifespan: config.outerFlame.lifespan,
            speed: config.outerFlame.speed,
            angle: config.outerFlame.angle,
            frequency: config.outerFlame.frequency,
            quantity: config.outerFlame.quantity,
            color: config.outerFlame.colors,
            colorEase: config.outerFlame.colorEase,
            blendMode: config.outerFlame.blendMode,
            rotate: config.outerFlame.rotate,
            emitZone: { type: 'random', source: widerEmitZone }
        });
        this.outerFlameEmitter.setDepth(depth + 1);

        // Ember particles
        this.emberEmitter = this.scene.add.particles(x, y, 'ember-particle', {
            scale: config.ember.scale,
            alpha: config.ember.alpha,
            lifespan: config.ember.lifespan,
            speed: config.ember.speed,
            angle: config.ember.angle,
            frequency: config.ember.frequency,
            quantity: config.ember.quantity,
            tint: config.ember.tint,
            blendMode: config.ember.blendMode,
            accelerationX: config.ember.accelerationX,
            accelerationY: config.ember.accelerationY,
            rotate: config.ember.rotate,
            emitZone: { type: 'random', source: emitZone }
        });
        this.emberEmitter.setDepth(depth + 4);

        // Smoke emit zone - much wider than fire for natural billowing
        const smokeEmitZone = new Phaser.Geom.Rectangle(
            -config.smoke.emitWidth / 2,
            -config.smoke.emitHeight / 2,
            config.smoke.emitWidth,
            config.smoke.emitHeight
        );

        // Back smoke layer (behind fire)
        this.smokeBackEmitter = this.scene.add.particles(x, y + config.smoke.offsetY, 'smoke-particle', {
            scale: config.smoke.scale,
            alpha: config.smoke.alpha,
            lifespan: config.smoke.lifespan,
            speed: config.smoke.speed,
            angle: config.smoke.angle,
            frequency: config.smoke.frequency,
            quantity: config.smoke.quantity,
            tint: config.smoke.tint,
            blendMode: config.smoke.blendMode,
            rotate: config.smoke.rotate,
            accelerationX: config.smoke.accelerationX,
            emitZone: { type: 'random', source: smokeEmitZone }
        });
        this.smokeBackEmitter.setDepth(depth);

        // Front smoke layer (in front of fire, sparser)
        this.smokeFrontEmitter = this.scene.add.particles(x, y + config.smoke.offsetY, 'smoke-particle', {
            scale: { start: config.smoke.scale.start * 0.8, end: config.smoke.scale.end * 0.9 },
            alpha: { start: config.smoke.alpha.start * 0.7, end: 0 },
            lifespan: config.smoke.lifespan,
            speed: { min: config.smoke.speed.min * 0.9, max: config.smoke.speed.max * 1.1 },
            angle: config.smoke.angle,
            frequency: config.smoke.frequency * 2.5, // Less frequent
            quantity: 1,
            tint: config.smoke.tint,
            blendMode: config.smoke.blendMode,
            rotate: config.smoke.rotate,
            accelerationX: config.smoke.accelerationX,
            emitZone: { type: 'random', source: smokeEmitZone }
        });
        this.smokeFrontEmitter.setDepth(depth + 5);
    }

    /**
     * Set the position of the fire
     */
    setPosition(x: number, y: number) {
        this.x = x;
        this.y = y;
        
        this.coreEmitter?.setPosition(x, y);
        this.flameEmitter?.setPosition(x, y);
        this.outerFlameEmitter?.setPosition(x, y);
        this.emberEmitter?.setPosition(x, y);
        this.smokeBackEmitter?.setPosition(x, y + this.config.smoke.offsetY);
        this.smokeFrontEmitter?.setPosition(x, y + this.config.smoke.offsetY);
    }

    /**
     * Set the depth of all emitters
     */
    setDepth(depth: number) {
        this.depth = depth;
        this.smokeBackEmitter?.setDepth(depth);
        this.outerFlameEmitter?.setDepth(depth + 1);
        this.flameEmitter?.setDepth(depth + 2);
        this.coreEmitter?.setDepth(depth + 3);
        this.emberEmitter?.setDepth(depth + 4);
        this.smokeFrontEmitter?.setDepth(depth + 5);
    }

    /**
     * Get the base depth
     */
    getDepth(): number {
        return this.depth;
    }

    /**
     * Pause/resume the fire effect
     */
    setActive(active: boolean) {
        if (active) {
            this.coreEmitter?.start();
            this.flameEmitter?.start();
            this.outerFlameEmitter?.start();
            this.emberEmitter?.start();
            this.smokeBackEmitter?.start();
            this.smokeFrontEmitter?.start();
        } else {
            this.coreEmitter?.stop();
            this.flameEmitter?.stop();
            this.outerFlameEmitter?.stop();
            this.emberEmitter?.stop();
            this.smokeBackEmitter?.stop();
            this.smokeFrontEmitter?.stop();
        }
    }

    /**
     * Scale the fire intensity (0-1)
     */
    setIntensity(intensity: number) {
        const clampedIntensity = Phaser.Math.Clamp(intensity, 0, 1);
        
        // Adjust frequency and quantity based on intensity
        if (this.coreEmitter) {
            this.coreEmitter.frequency = this.config.core.frequency / clampedIntensity;
        }
        if (this.flameEmitter) {
            this.flameEmitter.frequency = this.config.flame.frequency / clampedIntensity;
        }
        if (this.outerFlameEmitter) {
            this.outerFlameEmitter.frequency = this.config.outerFlame.frequency / clampedIntensity;
        }
        if (this.emberEmitter) {
            this.emberEmitter.frequency = this.config.ember.frequency / clampedIntensity;
        }
    }

    /**
     * Create fire effects at all "Fire" POI points in the map
     * Reads "Base" property from POI to link fire depth to a layer for occlusion
     */
    static createFromMap(scene: Phaser.Scene, map: Phaser.Tilemaps.Tilemap, baseDepth: number = 100): FireParticleSystem[] {
        const fires: FireParticleSystem[] = [];
        
        // Find POI layer
        const poiLayer = map.objects?.find(layer => layer.name === 'POI');
        if (!poiLayer) {
            console.warn('[FireParticleSystem] No POI layer found in map');
            return fires;
        }

        // Find all Fire points
        poiLayer.objects.forEach(obj => {
            if (obj.name === 'Fire' && obj.x !== undefined && obj.y !== undefined) {
                // Read the Base property to link fire to a specific layer
                const baseLayerTag = getTiledProperty(obj, 'Base') as string | undefined;
                
                const fire = new FireParticleSystem(scene, obj.x, obj.y, baseDepth, baseLayerTag || null);
                fires.push(fire);
                console.log(`[FireParticleSystem] Created fire at (${obj.x}, ${obj.y})${baseLayerTag ? ` linked to layer "${baseLayerTag}"` : ''}`);
            }
        });

        return fires;
    }

    /**
     * Clean up all emitters and lights
     */
    destroy() {
        this.coreEmitter?.destroy();
        this.flameEmitter?.destroy();
        this.outerFlameEmitter?.destroy();
        this.emberEmitter?.destroy();
        this.smokeBackEmitter?.destroy();
        this.smokeFrontEmitter?.destroy();

        // Clean up all lights
        if (this.lightingManager) {
            for (const offset of this.lightOffsets) {
                this.lightingManager.removeLight(`${this.lightId}-${offset.id}`);
            }
        }
    }
}
