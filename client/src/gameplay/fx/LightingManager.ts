import Phaser from 'phaser';
import { WorldTimeState, DAYLIGHT_HOURS, Season } from '@cfwk/shared';

/**
 * Manages dynamic lighting for the game
 * Uses Phaser's built-in light pipeline for efficient GPU-based lighting
 * Supports day/night cycle based on world time
 */
export class LightingManager {
    private scene: Phaser.Scene;
    private ambientColor: Phaser.Display.Color;
    private lights: Map<string, Phaser.GameObjects.Light> = new Map();
    
    // Map-specific brightness multiplier (from map properties)
    private mapBrightnessMultiplier: number = 1.0;
    
    // Current time-based brightness
    private currentBrightness: number = 1.0;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.ambientColor = new Phaser.Display.Color(255, 255, 255);

        // Enable the light pipeline
        this.scene.lights.enable();
    }

    /**
     * Setup lighting from map properties
     * Reads "Brightness" (0-1) multiplier from map - this is combined with time-of-day
     */
    setupFromMap(_map: Phaser.Tilemaps.Tilemap) {
        // Get the raw map data from cache - need to find the right key
        let rawMapData: any = null;
        
        // The map key should match how it was loaded
        const cacheKeys = this.scene.cache.tilemap.getKeys();
        for (const key of cacheKeys) {
            const cached = this.scene.cache.tilemap.get(key);
            if (cached?.data) {
                rawMapData = cached.data;
                break;
            }
        }

        // Try to get brightness multiplier from the raw map data
        if (rawMapData?.properties) {
            const props = rawMapData.properties;
            if (Array.isArray(props)) {
                const brightnessProp = props.find((p: any) => p.name === 'Brightness');
                if (brightnessProp !== undefined) {
                    this.mapBrightnessMultiplier = brightnessProp.value;
                }
            }
        }

        console.log('[LightingManager] Map brightness multiplier:', this.mapBrightnessMultiplier);
    }

    /**
     * Update lighting based on world time
     * Call this each frame with the current time state
     */
    updateFromWorldTime(worldTime: WorldTimeState) {
        // Calculate final brightness: time-of-day brightness * map multiplier
        const timeBrightness = worldTime.brightness;
        this.currentBrightness = timeBrightness * this.mapBrightnessMultiplier;
        
        // Calculate ambient color based on time of day
        // Night: cooler blue tint, Day: warm white, Dawn/Dusk: orange/pink
        const { r, g, b } = this.calculateAmbientColor(worldTime);
        
        // Apply brightness
        const cr = Phaser.Math.Clamp(Math.floor(r * this.currentBrightness), 0, 255);
        const cg = Phaser.Math.Clamp(Math.floor(g * this.currentBrightness), 0, 255);
        const cb = Phaser.Math.Clamp(Math.floor(b * this.currentBrightness), 0, 255);

        this.ambientColor.setTo(cr, cg, cb);
        
        this.scene.lights.setAmbientColor(this.ambientColor.color);
    }

    /**
     * Calculate ambient color temperature based on time of day
     * Interpolates smoothly between Night -> Dawn -> Day -> Dusk -> Night
     */
    private calculateAmbientColor(worldTime: WorldTimeState): { r: number; g: number; b: number } {
        // Colors
        const NIGHT_COLOR = { r: 160, g: 175, b: 255 }; // Deep cool blue
        const DAWN_COLOR = { r: 255, g: 200, b: 180 };  // Soft orange/pink
        const DAY_COLOR = { r: 255, g: 255, b: 250 };   // Bright warm white
        const DUSK_COLOR = { r: 255, g: 170, b: 140 };  // Deep orange/red

        // Get seasonal times
        const { sunrise, sunset } = DAYLIGHT_HOURS[worldTime.season];
        const currentHour = worldTime.hour + worldTime.minute / 60 + worldTime.second / 3600;

        // Visual transition duration (in hours) - e.g., dawn starts 1.5 hours before sunrise
        const transitionDuration = 1.5;

        // Helper to interpolate colors
        const lerpColor = (c1: typeof NIGHT_COLOR, c2: typeof NIGHT_COLOR, t: number) => ({
            r: Math.floor(Phaser.Math.Linear(c1.r, c2.r, t)),
            g: Math.floor(Phaser.Math.Linear(c1.g, c2.g, t)),
            b: Math.floor(Phaser.Math.Linear(c1.b, c2.b, t))
        });

        // Determine phase
        // Dead of Night (Pre-Dawn)
        if (currentHour < sunrise - transitionDuration) {
            return NIGHT_COLOR;
        }
        
        // Dawn Transition (Night -> Dawn -> Day)
        if (currentHour < sunrise + transitionDuration) {
            // Split into two sub-phases: Night->Dawn and Dawn->Day
            if (currentHour < sunrise) {
                // Night -> Dawn
                const t = (currentHour - (sunrise - transitionDuration)) / transitionDuration;
                return lerpColor(NIGHT_COLOR, DAWN_COLOR, t);
            } else {
                // Dawn -> Day
                const t = (currentHour - sunrise) / transitionDuration;
                return lerpColor(DAWN_COLOR, DAY_COLOR, t);
            }
        }

        // Day
        if (currentHour < sunset - transitionDuration) {
            return DAY_COLOR;
        }

        // Dusk Transition (Day -> Dusk -> Night)
        if (currentHour < sunset + transitionDuration) {
            if (currentHour < sunset) {
                // Day -> Dusk
                const t = (currentHour - (sunset - transitionDuration)) / transitionDuration;
                return lerpColor(DAY_COLOR, DUSK_COLOR, t);
            } else {
                // Dusk -> Night
                const t = (currentHour - sunset) / transitionDuration;
                return lerpColor(DUSK_COLOR, NIGHT_COLOR, t);
            }
        }

        // Dead of Night (Post-Dusk)
        return NIGHT_COLOR;
    }

    /**
     * Add a point light source
     */
    addLight(
        id: string,
        x: number,
        y: number,
        radius: number = 100,
        color: number = 0xffaa44,
        intensity: number = 1.0
    ): Phaser.GameObjects.Light {
        // Remove existing light with same ID
        if (this.lights.has(id)) {
            this.removeLight(id);
        }

        const light = this.scene.lights.addLight(x, y, radius, color, intensity);
        this.lights.set(id, light);

        return light;
    }

    /**
     * Get a light by ID
     */
    getLight(id: string): Phaser.GameObjects.Light | undefined {
        return this.lights.get(id);
    }

    /**
     * Remove a light by ID
     */
    removeLight(id: string): void {
        const light = this.lights.get(id);
        if (light) {
            this.scene.lights.removeLight(light);
            this.lights.delete(id);
        }
    }

    /**
     * Update a light's position
     */
    updateLightPosition(id: string, x: number, y: number): void {
        const light = this.lights.get(id);
        if (light) {
            light.setPosition(x, y);
        }
    }

    /**
     * Update a light's intensity (useful for flickering effects)
     */
    updateLightIntensity(id: string, intensity: number): void {
        const light = this.lights.get(id);
        if (light) {
            light.setIntensity(intensity);
        }
    }

    /**
     * Update a light's radius
     */
    updateLightRadius(id: string, radius: number): void {
        const light = this.lights.get(id);
        if (light) {
            light.setRadius(radius);
        }
    }

    /**
     * Enable lighting on a game object (tilemap layer, sprite, etc.)
     * The object must use a texture and will be affected by lights
     */
    enableLightingOn(gameObject: Phaser.GameObjects.GameObject): void {
        if ('setPipeline' in gameObject) {
            (gameObject as any).setPipeline('Light2D');
        }
    }

    /**
     * Get the ambient brightness (0-1)
     */
    getAmbientBrightness(): number {
        // Calculate brightness from ambient color
        const max = Math.max(this.ambientColor.red, this.ambientColor.green, this.ambientColor.blue);
        return max / 255;
    }

    /**
     * Set ambient brightness dynamically
     */
    setAmbientBrightness(brightness: number): void {
        const b = Phaser.Math.Clamp(brightness, 0, 1);
        this.ambientColor.setTo(
            Math.floor(255 * b),
            Math.floor(255 * b),
            Math.floor(255 * b)
        );
        this.scene.lights.setAmbientColor(this.ambientColor.color);
    }

    /**
     * Clean up all lights
     */
    destroy(): void {
        this.lights.forEach((light) => {
            this.scene.lights.removeLight(light);
        });
        this.lights.clear();
    }
}
