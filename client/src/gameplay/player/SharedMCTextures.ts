/**
 * SharedMCTextures - Manages shared MC character textures for remote players
 * 
 * Since each player can have different appearances, remote players need
 * a default set of textures to render. This creates those textures using
 * the default character appearance.
 * 
 * The texture keys follow the format: mc-{anim}-{direction}
 * where direction is N, S, E, W, NE, SE, NW, SW
 */

import Phaser from 'phaser';
import { CharacterCompositor, CompositorResult } from './CharacterCompositor';
import {
    DEFAULT_CHARACTER_APPEARANCE,
    MC_FRAME_DIMENSIONS_BY_ANIM,
    MC_FRAMES_PER_ANIMATION_BY_ANIM,
    MCDirection,
    MCAnimationType
} from '@cfwk/shared';

export class SharedMCTextures {
    private static instance: SharedMCTextures;
    private compositor?: CharacterCompositor;
    private initialized = false;
    private compositorResult?: CompositorResult;
    private readonly animationKeyPrefix = 'mc-remote-default';
    private createdAnimationKeys = new Set<string>();
    private animationScene?: Phaser.Scene;

    private constructor() {}

    public static getInstance(): SharedMCTextures {
        if (!SharedMCTextures.instance) {
            SharedMCTextures.instance = new SharedMCTextures();
        }
        return SharedMCTextures.instance;
    }

    /**
     * Initialize shared MC textures with default appearance
     * This should be called once during game loading, after the local player's
     * MCAnimationController has initialized (so animations are created)
     */
    async initialize(scene: Phaser.Scene): Promise<void> {
        if (this.initialized) return;
        this.animationScene = scene;
        // Always create dedicated default textures for remote players.
        // Reusing local "mc-*" animations can accidentally mirror local appearance.
        this.compositor = new CharacterCompositor(scene, 'remote-default-shared');
        
        try {
            this.compositorResult = await this.compositor.compositeCharacter(
                DEFAULT_CHARACTER_APPEARANCE,
                ['walk', 'run', 'idle']
            );

            // Create animations (matching format in MCAnimationController)
            const directions: MCDirection[] = ['N', 'S', 'E', 'W', 'NE', 'SE', 'NW', 'SW'];
            const animTypes: MCAnimationType[] = ['walk', 'run', 'idle'];

            for (const animType of animTypes) {
                const frameRate = animType === 'idle' ? 6 : (animType === 'run' ? 14 : 10);
                const frameCount = MC_FRAMES_PER_ANIMATION_BY_ANIM[animType];

                for (const direction of directions) {
                    const textureKey = this.compositorResult.textureKeys.get(`${animType}-${direction}`);
                    if (!textureKey) continue;

                    const dimensions = MC_FRAME_DIMENSIONS_BY_ANIM[animType][direction];
                    const animKey = `${this.animationKeyPrefix}-${animType}-${direction}`;

                    // Add frame definitions to texture
                    const texture = scene.textures.get(textureKey);
                    if (!texture) continue;

                    for (let i = 0; i < frameCount; i++) {
                        if (!texture.has(String(i))) {
                            texture.add(i, 0, i * dimensions.width, 0, dimensions.width, dimensions.height);
                        }
                    }

                    // Create animation if it doesn't exist
                    if (!scene.anims.exists(animKey)) {
                        const frames: Phaser.Types.Animations.AnimationFrame[] = [];
                        const reversed = direction === 'W' || direction === 'NW' || direction === 'SW';
                        if (reversed) {
                            for (let i = frameCount - 1; i >= 0; i--) {
                                frames.push({ key: textureKey, frame: i });
                            }
                        } else {
                            for (let i = 0; i < frameCount; i++) {
                                frames.push({ key: textureKey, frame: i });
                            }
                        }

                        scene.anims.create({
                            key: animKey,
                            frames: frames,
                            frameRate,
                            repeat: -1
                        });
                    }
                    this.createdAnimationKeys.add(animKey);
                }
            }
            
            this.initialized = true;
            console.log('[SharedMCTextures] Initialized dedicated remote default textures');
        } catch (e) {
            console.error('[SharedMCTextures] Failed to initialize:', e);
        }
    }

    /**
     * Check if initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Get texture key for a direction
     */
    getTextureKey(direction: MCDirection, animType: MCAnimationType = 'walk'): string | undefined {
        return this.compositorResult?.textureKeys.get(`${animType}-${direction}`);
    }

    /**
     * Get animation key for remote default fallback animations.
     */
    getAnimationKey(direction: MCDirection, animType: MCAnimationType = 'walk'): string {
        return `${this.animationKeyPrefix}-${animType}-${direction}`;
    }

    /**
     * Clean up
     */
    destroy() {
        if (this.animationScene) {
            for (const key of this.createdAnimationKeys) {
                if (this.animationScene.anims.exists(key)) {
                    this.animationScene.anims.remove(key);
                }
            }
        }
        this.compositor?.destroy();
        this.initialized = false;
        this.compositorResult = undefined;
        this.createdAnimationKeys.clear();
        this.animationScene = undefined;
    }
}
