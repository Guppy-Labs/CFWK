/**
 * CharacterCompositor - Composites multiple sprite layers into a single texture
 * 
 * Handles:
 * - Loading body + accessory animation strips
 * - Applying hue/brightness color shifts to each layer
 * - Compositing them into combined textures per direction/animation
 * - Managing mirrored directions (W mirrors E, etc.)
 * - Handling different frame dimensions (16x27 vs 19x27)
 */

import Phaser from 'phaser';
import {
    ICharacterAppearance,
    MCDirection,
    MCAnimationType,
    MC_FRAME_DIMENSIONS_BY_ANIM,
    MC_FRAMES_PER_ANIMATION_BY_ANIM,
    HueBrightnessShift
} from '@cfwk/shared';
import { applyColorShift } from './ColorShift';

/**
 * Layer types that can be composited
 */
export type MCLayerType = 'body' | 'cape' | 'scarf' | 'head';

/**
 * Asset paths for MC character
 */
const MC_ASSET_BASE = '/assets/char/mc';

/**
 * Source directions available in assets (N, E, S, NE, SE)
 * Other directions are derived from these
 */
type SourceDirection = 'N' | 'E' | 'S' | 'NE' | 'SE';

/**
 * Mapping from all directions to their source direction and whether to mirror
 */
const DIRECTION_SOURCE_MAP: Record<MCDirection, { source: SourceDirection; mirror: boolean }> = {
    N: { source: 'N', mirror: false },
    S: { source: 'S', mirror: false },
    E: { source: 'E', mirror: false },
    W: { source: 'E', mirror: true },
    NE: { source: 'NE', mirror: false },
    SE: { source: 'SE', mirror: false },
    NW: { source: 'NE', mirror: true },
    SW: { source: 'SE', mirror: true }
};

/**
 * X-axis offset adjustments for specific directions (in pixels)
 * Applied after mirroring to fine-tune sprite alignment
 */
const DIRECTION_X_OFFSET: Partial<Record<MCDirection, number>> = {
    NE: 1,   // Shift 1px right
    NW: -1   // Shift 1px left
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
    private textureKeyPrefix: string;

    constructor(scene: Phaser.Scene, textureKeyPrefix: string = 'mc') {
        this.scene = scene;
        this.textureKeyPrefix = textureKeyPrefix;
    }

    /**
     * Generate asset path for a layer
     */
    private getAssetPath(animType: MCAnimationType, layerType: MCLayerType, direction: SourceDirection): string {
        if (layerType === 'body') {
            return `${MC_ASSET_BASE}/${animType}/body/${animType}_${direction}_body.png`;
        } else if (layerType === 'head') {
            return `${MC_ASSET_BASE}/${animType}/head/${animType}_${direction}_head.png`;
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
     * Get the color shift values for a specific layer type
     */
    private getColorShiftForLayer(layerType: MCLayerType, appearance: ICharacterAppearance): HueBrightnessShift {
        switch (layerType) {
            case 'body':
                return appearance.body;
            case 'head':
                return appearance.head;
            case 'cape':
                return {
                    hueShift: appearance.accessories.cape.hueShift,
                    brightnessShift: appearance.accessories.cape.brightnessShift
                };
            case 'scarf':
                return {
                    hueShift: appearance.accessories.neck.hueShift,
                    brightnessShift: appearance.accessories.neck.brightnessShift
                };
            default:
                return { hueShift: 0, brightnessShift: 0 };
        }
    }

    /**
     * Apply color shift to a loaded image and return a drawable source
     */
    private applyLayerColorShift(
        loadedImage: LoadedImage,
        layerType: MCLayerType,
        appearance: ICharacterAppearance
    ): HTMLCanvasElement | HTMLImageElement {
        const shift = this.getColorShiftForLayer(layerType, appearance);
        
        // If no shift needed, return original image
        if (shift.hueShift === 0 && shift.brightnessShift === 0) {
            return loadedImage.img;
        }
        
        // Apply color shift and return the modified canvas
        return applyColorShift(loadedImage.img, shift.hueShift, shift.brightnessShift);
    }

    /**
     * Composite all layers for a single direction and animation type
     * Returns a canvas with all frames composited
     * Each layer has its hue/brightness shift applied before compositing
     */
    private async compositeDirection(
        animType: MCAnimationType,
        direction: MCDirection,
        appearance: ICharacterAppearance
    ): Promise<HTMLCanvasElement> {
        const { source, mirror } = DIRECTION_SOURCE_MAP[direction];
        const dimensions = MC_FRAME_DIMENSIONS_BY_ANIM[animType][direction];
        const frameCount = MC_FRAMES_PER_ANIMATION_BY_ANIM[animType];

        // Load all required images
        const bodyPath = this.getAssetPath(animType, 'body', source);
        const bodyImg = await this.loadImage(bodyPath);
        const headPath = this.getAssetPath(animType, 'head', source);
        const headImg = await this.loadImage(headPath);

        const layers: { img: LoadedImage; type: MCLayerType }[] = [{ img: bodyImg, type: 'body' }];

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

        if (appearance.accessories.neck.equipped) {
            const scarfPath = this.getAssetPath(animType, 'scarf', source);
            try {
                const scarfImg = await this.loadImage(scarfPath);
                layers.push({ img: scarfImg, type: 'scarf' });
            } catch (e) {
                console.warn(`Scarf not found for ${animType}/${source}, skipping`);
            }
        }

        const isNorth = direction === 'N' || direction === 'NE' || direction === 'NW';
        const orderedLayers: { img: LoadedImage; type: MCLayerType }[] = [];

        const bodyLayer = layers.find(layer => layer.type === 'body');
        const capeLayer = layers.find(layer => layer.type === 'cape');
        const scarfLayer = layers.find(layer => layer.type === 'scarf');

        if (bodyLayer) orderedLayers.push(bodyLayer);
        if (capeLayer) orderedLayers.push(capeLayer);

        if (isNorth) {
            orderedLayers.push({ img: headImg, type: 'head' });
            if (scarfLayer) orderedLayers.push(scarfLayer);
        } else {
            if (scarfLayer) orderedLayers.push(scarfLayer);
            orderedLayers.push({ img: headImg, type: 'head' });
        }

        // Create output canvas
        const canvas = document.createElement('canvas');
        canvas.width = dimensions.width * frameCount;
        canvas.height = dimensions.height;
        const ctx = canvas.getContext('2d')!;

        // Get X offset for this direction (applied after mirroring)
        const xOffset = DIRECTION_X_OFFSET[direction] || 0;

        // If mirroring, flip the context
        if (mirror) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }

        // Draw each layer in order (bottom to top) with color shifts applied
        for (const layer of orderedLayers) {
            // Apply color shift to this layer
            const shiftedSource = this.applyLayerColorShift(layer.img, layer.type, appearance);
            ctx.drawImage(shiftedSource, 0, 0);
        }

        // Reset transform if we mirrored
        if (mirror) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }

        // Apply X offset adjustment if needed (shift the entire composited result)
        if (xOffset !== 0) {
            // Create a new canvas with the shifted content
            const shiftedCanvas = document.createElement('canvas');
            shiftedCanvas.width = canvas.width;
            shiftedCanvas.height = canvas.height;
            const shiftedCtx = shiftedCanvas.getContext('2d')!;
            shiftedCtx.drawImage(canvas, xOffset, 0);
            return shiftedCanvas;
        }

        return canvas;
    }

    /**
     * Generate a unique texture key
     */
    private generateTextureKey(animType: MCAnimationType, direction: MCDirection): string {
        const key = `${this.textureKeyPrefix}-${animType}-${direction}-${this.textureCounter++}`;
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
                    frameDimensions.set(direction, MC_FRAME_DIMENSIONS_BY_ANIM[animType][direction]);

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
