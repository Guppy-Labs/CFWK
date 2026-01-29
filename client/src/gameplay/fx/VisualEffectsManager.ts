import Phaser from 'phaser';

/**
 * Manages post-processing visual effects applied to the game camera.
 * Uses Phaser's built-in FX system (3.60+) for WebGL effects.
 */
export class VisualEffectsManager {
    private scene: Phaser.Scene;
    private camera: Phaser.Cameras.Scene2D.Camera;

    // FX references for runtime adjustment
    private bloom?: Phaser.FX.Bloom;
    private vignette?: Phaser.FX.Vignette;
    private tiltShift?: Phaser.FX.TiltShift;
    private colorMatrix?: Phaser.FX.ColorMatrix;

    // Configuration - carefully tuned for pixel art RPG aesthetic
    private readonly config = {
        bloom: {
            enabled: false,     // Disabled - can cause black screen on some setups
            color: 0xffffee,    // Warm white bloom
            offsetX: 1,         // Subtle horizontal spread
            offsetY: 1,         // Subtle vertical spread  
            blurStrength: 1,    // Gentle blur
            strength: 1,        // Bloom intensity
            steps: 4            // Quality (more = smoother but heavier)
        },
        vignette: {
            enabled: true,
            x: 0.5,             // Center X
            y: 0.5,             // Center Y
            radius: 0.8,        // Large radius = subtle edge darkening
            strength: 0.4      // Very gentle darkening
        },
        tiltShift: {
            enabled: true,     // Disabled - can cause rendering issues
            radius: 0.8,         // Blur radius
            amount: 0.5,        // Blur intensity
            contrast: 0,      // Slight contrast boost in focus area
            blurX: 0.1,           // Horizontal blur component
            blurY: 0.1,           // Vertical blur component
            strength: 1         // Overall strength
        },
        colorGrade: {
            enabled: false,     // Disabled for now
            saturation: 0.15,   // Slight saturation boost
            contrast: 0.1       // Gentle contrast enhancement
        }
    };

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.camera = scene.cameras.main;

        this.setupEffects();
    }

    private setupEffects() {
        // Ensure we have WebGL and postFX available
        if (!this.camera.postFX) {
            console.warn('PostFX not available - WebGL required for visual effects');
            return;
        }

        // === BLOOM ===
        // Creates a soft glow around bright pixels, giving warmth to lights and highlights
        // Particularly nice for torchlight, water reflections, etc.
        if (this.config.bloom.enabled) {
            const b = this.config.bloom;
            this.bloom = this.camera.postFX.addBloom(
                b.color,
                b.offsetX,
                b.offsetY,
                b.blurStrength,
                b.strength,
                b.steps
            );
        }

        // === VIGNETTE ===
        // Darkens the screen edges, drawing focus to the center
        // Creates a natural "tunnel vision" that keeps attention on the player
        if (this.config.vignette.enabled) {
            const v = this.config.vignette;
            this.vignette = this.camera.postFX.addVignette(
                v.x,
                v.y,
                v.radius,
                v.strength
            );
        }

        // === TILT SHIFT ===
        // Simulates a shallow depth-of-field effect
        // Creates a "miniature/diorama" look that works beautifully with pixel art
        // Focus band is horizontal through center, edges blur vertically
        if (this.config.tiltShift.enabled) {
            const t = this.config.tiltShift;
            this.tiltShift = this.camera.postFX.addTiltShift(
                t.radius,
                t.amount,
                t.contrast,
                t.blurX,
                t.blurY,
                t.strength
            );
        }

        // === COLOR GRADING ===
        // Subtle color adjustments to make the world feel more vibrant
        if (this.config.colorGrade.enabled) {
            const c = this.config.colorGrade;
            this.colorMatrix = this.camera.postFX.addColorMatrix();
            this.colorMatrix.saturate(c.saturation, true);
            this.colorMatrix.contrast(c.contrast, true);
        }
    }

    /**
     * Dynamically adjust bloom intensity (e.g., for day/night cycle)
     */
    setBloomStrength(strength: number) {
        if (this.bloom) {
            this.bloom.strength = strength;
        }
    }

    /**
     * Dynamically adjust vignette (e.g., intensify when player is low health)
     */
    setVignetteStrength(strength: number) {
        if (this.vignette) {
            this.vignette.strength = Phaser.Math.Clamp(strength, 0, 1);
        }
    }

    /**
     * Set vignette color tint for status effects (e.g., red when damaged)
     */
    pulseVignette(targetStrength: number, duration: number = 200) {
        if (!this.vignette) return;

        const originalStrength = this.config.vignette.strength;
        
        this.scene.tweens.add({
            targets: this.vignette,
            strength: targetStrength,
            duration: duration,
            yoyo: true,
            ease: 'Sine.easeInOut',
            onComplete: () => {
                if (this.vignette) this.vignette.strength = originalStrength;
            }
        });
    }

    /**
     * Toggle individual effects
     */
    setBloomEnabled(enabled: boolean) {
        if (this.bloom) this.bloom.active = enabled;
    }

    setVignetteEnabled(enabled: boolean) {
        if (this.vignette) this.vignette.active = enabled;
    }

    setTiltShiftEnabled(enabled: boolean) {
        if (this.tiltShift) this.tiltShift.active = enabled;
    }

    /**
     * Master toggle for all effects
     */
    setAllEffectsEnabled(enabled: boolean) {
        this.setBloomEnabled(enabled);
        this.setVignetteEnabled(enabled);
        this.setTiltShiftEnabled(enabled);
        if (this.colorMatrix) this.colorMatrix.active = enabled;
    }

    /**
     * Clean up effects
     */
    destroy() {
        if (this.camera.postFX) {
            this.camera.postFX.clear();
        }
    }
}
