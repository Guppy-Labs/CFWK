import Phaser from 'phaser';
import { WorldTimeState } from '@cfwk/shared';

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
     */
    private calculateAmbientColor(worldTime: WorldTimeState): { r: number; g: number; b: number } {
        // Define color temperatures for different times
        // Night: cool blue (200, 210, 255)
        // Dawn: warm orange-pink (255, 200, 180)
        // Day: neutral white (255, 255, 250)
        // Dusk: warm orange-red (255, 180, 150)
        
        if (worldTime.isDaytime) {
            // During day, use warmer white
            // Near dawn/dusk transitions, shift to warmer colors
            const dayProgress = worldTime.sunProgress; // 0-1
            
            if (dayProgress < 0.15) {
                // Early morning - warm golden
                const t = dayProgress / 0.15;
                return {
                    r: 255,
                    g: Phaser.Math.Linear(200, 250, t),
                    b: Phaser.Math.Linear(180, 245, t)
                };
            } else if (dayProgress > 0.85) {
                // Late afternoon - warm golden
                const t = (dayProgress - 0.85) / 0.15;
                return {
                    r: 255,
                    g: Phaser.Math.Linear(250, 200, t),
                    b: Phaser.Math.Linear(245, 160, t)
                };
            } else {
                // Midday - neutral warm white
                return { r: 255, g: 252, b: 245 };
            }
        } else {
            // Nighttime - cool blue
            const nightProgress = worldTime.nightProgress; // 0-1
            
            // Slightly warmer near dusk/dawn transitions
            if (nightProgress < 0.1 || nightProgress > 0.9) {
                return { r: 220, g: 215, b: 255 };
            }
            
            // Deep night - cooler blue
            return { r: 180, g: 195, b: 255 };
        }
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
