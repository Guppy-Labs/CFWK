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
    private tiltShift?: Phaser.FX.Bokeh;
    private colorMatrix?: Phaser.FX.ColorMatrix;
    private effectsMasterEnabled = true;
    private bloomEnabled = false;
    private vignetteEnabled = true;
    private tiltShiftEnabled = true;

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
        this.bloomEnabled = this.config.bloom.enabled;
        this.vignetteEnabled = this.config.vignette.enabled;
        this.tiltShiftEnabled = this.config.tiltShift.enabled;
        this.syncAllEffects();
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
        this.bloomEnabled = enabled;
        this.syncBloomEffect();
    }

    setVignetteEnabled(enabled: boolean) {
        this.vignetteEnabled = enabled;
        this.syncVignetteEffect();
    }

    setTiltShiftEnabled(enabled: boolean) {
        this.tiltShiftEnabled = enabled;
        this.syncTiltShiftEffect();
    }

    /**
     * Master toggle for all effects
     */
    setAllEffectsEnabled(enabled: boolean) {
        this.effectsMasterEnabled = enabled;
        this.syncAllEffects();
    }

    getEffectsState() {
        return {
            visualEffectsEnabled: this.effectsMasterEnabled,
            bloomEnabled: this.bloomEnabled,
            vignetteEnabled: this.vignetteEnabled,
            tiltShiftEnabled: this.tiltShiftEnabled
        };
    }

    private syncAllEffects() {
        this.syncBloomEffect();
        this.syncVignetteEffect();
        this.syncTiltShiftEffect();
        this.syncColorGradeEffect();
    }

    private syncBloomEffect() {
        if (!this.camera.postFX) return;
        const shouldEnable = this.effectsMasterEnabled && this.bloomEnabled;

        if (!shouldEnable) {
            if (this.bloom) {
                this.camera.postFX.remove(this.bloom);
                this.bloom = undefined;
            }
            return;
        }

        if (this.bloom) return;

        const b = this.config.bloom;
        try {
            this.bloom = this.camera.postFX.addBloom(
                b.color,
                b.offsetX,
                b.offsetY,
                b.blurStrength,
                b.strength,
                b.steps
            );
        } catch (error) {
            console.warn('[VisualEffectsManager] Failed to create bloom effect:', error);
            this.bloomEnabled = false;
        }
    }

    private syncVignetteEffect() {
        if (!this.camera.postFX) return;
        const shouldEnable = this.effectsMasterEnabled && this.vignetteEnabled;

        if (!shouldEnable) {
            if (this.vignette) {
                this.camera.postFX.remove(this.vignette);
                this.vignette = undefined;
            }
            return;
        }

        if (this.vignette) return;

        const v = this.config.vignette;
        try {
            this.vignette = this.camera.postFX.addVignette(
                v.x,
                v.y,
                v.radius,
                v.strength
            );
        } catch (error) {
            console.warn('[VisualEffectsManager] Failed to create vignette effect:', error);
            this.vignetteEnabled = false;
        }
    }

    private syncTiltShiftEffect() {
        if (!this.camera.postFX) return;
        const shouldEnable = this.effectsMasterEnabled && this.tiltShiftEnabled;

        if (!shouldEnable) {
            if (this.tiltShift) {
                this.camera.postFX.remove(this.tiltShift);
                this.tiltShift = undefined;
            }
            return;
        }

        if (this.tiltShift) return;

        const t = this.config.tiltShift;
        try {
            this.tiltShift = this.camera.postFX.addTiltShift(
                t.radius,
                t.amount,
                t.contrast,
                t.blurX,
                t.blurY,
                t.strength
            );
        } catch (error) {
            console.warn('[VisualEffectsManager] Failed to create tilt-shift effect:', error);
            this.tiltShiftEnabled = false;
        }
    }

    private syncColorGradeEffect() {
        if (!this.camera.postFX) return;
        const shouldEnable = this.effectsMasterEnabled && this.config.colorGrade.enabled;

        if (!shouldEnable) {
            if (this.colorMatrix) this.colorMatrix.active = false;
            return;
        }

        if (this.colorMatrix) {
            this.colorMatrix.active = true;
            return;
        }

        const c = this.config.colorGrade;
        this.colorMatrix = this.camera.postFX.addColorMatrix();
        this.colorMatrix.saturate(c.saturation, true);
        this.colorMatrix.contrast(c.contrast, true);
        this.colorMatrix.active = true;
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
