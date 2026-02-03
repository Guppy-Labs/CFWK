/**
 * CharacterCompositor - Composites multiple sprite layers into a single texture
 * 
 * Handles:
 * - Loading body + accessory animation strips
 * - Compositing them into combined textures per direction/animation
 * - Managing mirrored directions (W mirrors E, etc.)
 * - Handling different frame dimensions (16x27 vs 19x27)
 */

import Phaser from 'phaser';
import {
    ICharacterAppearance,
    MCDirection,
    MCAnimationType,
    MC_FRAME_DIMENSIONS,
    MC_FRAMES_PER_ANIMATION
} from '@cfwk/shared';

/**
 * Layer types that can be composited
 */
export type MCLayerType = 'body' | 'cape' | 'scarf';

/**
 * Asset paths for MC character
 */
const MC_ASSET_BASE = '/assets/char/mc';

/**
 * Source directions available in assets (N, E, S)
 * Other directions are derived from these
 */
type SourceDirection = 'N' | 'E' | 'S';

/**
 * Mapping from all directions to their source direction and whether to mirror
 */
const DIRECTION_SOURCE_MAP: Record<MCDirection, { source: SourceDirection; mirror: boolean }> = {
    N: { source: 'N', mirror: false },
    S: { source: 'S', mirror: false },
    E: { source: 'E', mirror: false },
    W: { source: 'E', mirror: true },
    NE: { source: 'E', mirror: false }, // Use E until NE is ready
    SE: { source: 'E', mirror: false }, // Use E until SE is ready
    NW: { source: 'E', mirror: true },  // Mirror of E until NW is ready
    SW: { source: 'E', mirror: true }   // Mirror of E until SW is ready
};

/**
 * Result of compositing - contains texture keys for all generated textures
 */
export interface CompositorResult {
    /** Map of "animationType-direction" to texture key */
    textureKeys: Map<string, string>;
    /** Frame dimensions by direction */
    frameDimensions: Map<MCDirection, { width: number; height: number }>;
}

/**
 * Internal tracking of loaded images
 */
interface LoadedImage {
    img: HTMLImageElement;
    width: number;
    height: number;
}

export class CharacterCompositor {
    private scene: Phaser.Scene;
    private loadedImages: Map<string, LoadedImage> = new Map();
    private textureCounter = 0;
    private generatedTextureKeys: string[] = [];

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    /**
     * Generate asset path for a layer
     */
    private getAssetPath(animType: MCAnimationType, layerType: MCLayerType, direction: SourceDirection): string {
        if (layerType === 'body') {
            return `${MC_ASSET_BASE}/${animType}/body/${animType}_${direction}_body.png`;
        } else {
            return `${MC_ASSET_BASE}/${animType}/accessories/base/${layerType}/${animType}_${direction}_${layerType}.png`;
        }
    }

    /**
     * Load an image and return a promise
     */
    private loadImage(path: string): Promise<LoadedImage> {
        return new Promise((resolve, reject) => {
            if (this.loadedImages.has(path)) {
                resolve(this.loadedImages.get(path)!);
                return;
            }

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const loaded: LoadedImage = { img, width: img.width, height: img.height };
                this.loadedImages.set(path, loaded);
                resolve(loaded);
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
            img.src = path;
        });
    }

    /**
     * Composite all layers for a single direction and animation type
     * Returns a canvas with all frames composited
     */
    private async compositeDirection(
        animType: MCAnimationType,
        direction: MCDirection,
        appearance: ICharacterAppearance
    ): Promise<HTMLCanvasElement> {
        const { source, mirror } = DIRECTION_SOURCE_MAP[direction];
        const dimensions = MC_FRAME_DIMENSIONS[direction];
        const frameCount = MC_FRAMES_PER_ANIMATION;

        // Load all required images
        const bodyPath = this.getAssetPath(animType, 'body', source);
        const bodyImg = await this.loadImage(bodyPath);

        const layers: { img: LoadedImage; type: MCLayerType }[] = [
            { img: bodyImg, type: 'body' }
        ];

        // Load accessories if equipped
        if (appearance.accessories.cape.equipped) {
            const capePath = this.getAssetPath(animType, 'cape', source);
            try {
                const capeImg = await this.loadImage(capePath);
                layers.push({ img: capeImg, type: 'cape' });
            } catch (e) {
                console.warn(`Cape not found for ${animType}/${source}, skipping`);
            }
        }

        if (appearance.accessories.scarf.equipped) {
            const scarfPath = this.getAssetPath(animType, 'scarf', source);
            try {
                const scarfImg = await this.loadImage(scarfPath);
                layers.push({ img: scarfImg, type: 'scarf' });
            } catch (e) {
                console.warn(`Scarf not found for ${animType}/${source}, skipping`);
            }
        }

        // Create output canvas
        const canvas = document.createElement('canvas');
        canvas.width = dimensions.width * frameCount;
        canvas.height = dimensions.height;
        const ctx = canvas.getContext('2d')!;

        // If mirroring, flip the context
        if (mirror) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }

        // Draw each layer in order (body first, then accessories)
        for (const layer of layers) {
            ctx.drawImage(layer.img.img, 0, 0);
        }

        // Reset transform if we mirrored
        if (mirror) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }

        return canvas;
    }

    /**
     * Generate a unique texture key
     */
    private generateTextureKey(animType: MCAnimationType, direction: MCDirection): string {
        const key = `mc-${animType}-${direction}-${this.textureCounter++}`;
        this.generatedTextureKeys.push(key);
        return key;
    }

    /**
     * Composite all animations and directions for a character
     */
    async compositeCharacter(
        appearance: ICharacterAppearance,
        animationTypes: MCAnimationType[] = ['walk']
    ): Promise<CompositorResult> {
        const textureKeys = new Map<string, string>();
        const frameDimensions = new Map<MCDirection, { width: number; height: number }>();

        const allDirections: MCDirection[] = ['N', 'S', 'E', 'W', 'NE', 'SE', 'NW', 'SW'];

        for (const animType of animationTypes) {
            for (const direction of allDirections) {
                try {
                    const canvas = await this.compositeDirection(animType, direction, appearance);
                    const textureKey = this.generateTextureKey(animType, direction);

                    // Add texture to Phaser
                    this.scene.textures.addCanvas(textureKey, canvas);

                    const mapKey = `${animType}-${direction}`;
                    textureKeys.set(mapKey, textureKey);
                    frameDimensions.set(direction, MC_FRAME_DIMENSIONS[direction]);

                } catch (e) {
                    console.error(`Failed to composite ${animType}/${direction}:`, e);
                }
            }
        }

        return { textureKeys, frameDimensions };
    }

    /**
     * Get a specific composite texture key
     */
    getTextureKey(result: CompositorResult, animType: MCAnimationType, direction: MCDirection): string | undefined {
        return result.textureKeys.get(`${animType}-${direction}`);
    }

    /**
     * Clean up all generated textures
     */
    destroy() {
        for (const key of this.generatedTextureKeys) {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        }
        this.generatedTextureKeys = [];
        this.loadedImages.clear();
    }
}
