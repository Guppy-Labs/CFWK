/**
 * RemotePlayerCompositor - Manages per-player texture generation for remote players
 * 
 * Each remote player can have unique character customization (hue/brightness shifts,
 * equipped accessories). This class uses CharacterCompositor to generate unique
 * textures for each player and handles cleanup when players leave.
 * 
 * Features:
 * - Async texture generation per player
 * - Automatic cleanup on player leave
 * - Fallback to default appearance on parse errors
 * - Animation creation from composited textures
 */

import Phaser from 'phaser';
import { CharacterCompositor, CompositorResult } from './CharacterCompositor';
import {
    ICharacterAppearance,
    DEFAULT_CHARACTER_APPEARANCE,
    MCDirection,
    MC_FRAME_DIMENSIONS_BY_ANIM,
    MC_FRAMES_PER_ANIMATION_BY_ANIM,
    MCAnimationType
} from '@cfwk/shared';

/**
 * Result of compositing for a remote player
 */
export interface RemotePlayerTextureResult {
    /** Compositor result with texture keys */
    compositorResult: CompositorResult;
    /** Animation keys created for this player */
    animationKeys: string[];
}

/**
 * Manages texture generation and cleanup for remote players
 */
export class RemotePlayerCompositor {
    private scene: Phaser.Scene;
    private compositors: Map<string, CharacterCompositor> = new Map();
    private playerTextures: Map<string, RemotePlayerTextureResult> = new Map();
    
    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }
    
    /**
     * Parse appearance JSON string safely
     */
    private parseAppearance(appearanceJson: string): ICharacterAppearance {
        if (!appearanceJson || appearanceJson.trim() === '') {
            return DEFAULT_CHARACTER_APPEARANCE;
        }
        
        try {
            const parsed = JSON.parse(appearanceJson);
            // Basic validation - ensure required fields exist
            if (!parsed.body || !parsed.head || !parsed.accessories) {
                console.warn('[RemotePlayerCompositor] Invalid appearance structure, using default');
                return DEFAULT_CHARACTER_APPEARANCE;
            }
            return parsed as ICharacterAppearance;
        } catch (e) {
            console.warn('[RemotePlayerCompositor] Failed to parse appearance JSON, using default:', e);
            return DEFAULT_CHARACTER_APPEARANCE;
        }
    }
    
    /**
     * Generate unique animation key for a player (internal use)
     */
    private buildAnimationKey(sessionId: string, animType: string, direction: MCDirection): string {
        return `remote-${sessionId}-${animType}-${direction}`;
    }
    
    /**
     * Create Phaser animations from composited textures for a player
     */
    private createAnimations(sessionId: string, compositorResult: CompositorResult): string[] {
        const animationKeys: string[] = [];
        const directions: MCDirection[] = ['N', 'S', 'E', 'W', 'NE', 'SE', 'NW', 'SW'];
        const animTypes: MCAnimationType[] = ['walk', 'idle'];

        for (const animType of animTypes) {
            const frameRate = animType === 'idle' ? 6 : 10;
            const frameCount = MC_FRAMES_PER_ANIMATION_BY_ANIM[animType];

            for (const direction of directions) {
                const textureKey = compositorResult.textureKeys.get(`${animType}-${direction}`);
                if (!textureKey) continue;

                const dimensions = MC_FRAME_DIMENSIONS_BY_ANIM[animType][direction];
                const animKey = this.buildAnimationKey(sessionId, animType, direction);

                // Get the texture and add frame definitions
                const texture = this.scene.textures.get(textureKey);
                if (!texture) continue;

                // Add numbered frames for each animation frame
                for (let i = 0; i < frameCount; i++) {
                    const frameName = String(i);
                    if (!texture.has(frameName)) {
                        texture.add(
                            frameName,
                            0,
                            i * dimensions.width,
                            0,
                            dimensions.width,
                            dimensions.height
                        );
                    }
                }

                // Create the animation
                const frames: Phaser.Types.Animations.AnimationFrame[] = [];
                for (let i = 0; i < frameCount; i++) {
                    frames.push({ key: textureKey, frame: String(i) });
                }

                // Only create if it doesn't exist
                if (!this.scene.anims.exists(animKey)) {
                    this.scene.anims.create({
                        key: animKey,
                        frames: frames,
                        frameRate,
                        repeat: -1
                    });
                    animationKeys.push(animKey);
                }
            }
        }
        
        return animationKeys;
    }
    
    /**
     * Generate textures for a remote player
     * @param sessionId The player's session ID (used for unique texture keys)
     * @param appearanceJson JSON-encoded ICharacterAppearance
     * @returns Promise resolving to the texture result
     */
    async compositeForPlayer(sessionId: string, appearanceJson: string): Promise<RemotePlayerTextureResult> {
        // Check if already generated
        const existing = this.playerTextures.get(sessionId);
        if (existing) {
            return existing;
        }
        
        // Parse appearance
        const appearance = this.parseAppearance(appearanceJson);
        
        // Create compositor for this player
        const compositor = new CharacterCompositor(this.scene, `remote-${sessionId}`);
        this.compositors.set(sessionId, compositor);
        
        // Generate textures
        const compositorResult = await compositor.compositeCharacter(appearance, ['walk', 'idle']);
        
        // Create animations
        const animationKeys = this.createAnimations(sessionId, compositorResult);
        
        // Store result
        const result: RemotePlayerTextureResult = {
            compositorResult,
            animationKeys
        };
        this.playerTextures.set(sessionId, result);
        return result;
    }

    /**
     * Re-generate textures for a player after appearance changes
     */
    async updateForPlayer(sessionId: string, appearanceJson: string): Promise<RemotePlayerTextureResult> {
        this.destroyForPlayer(sessionId);
        return this.compositeForPlayer(sessionId, appearanceJson);
    }
    
    /**
     * Get the animation key for a player's direction (public API)
     */
    getPlayerAnimationKey(sessionId: string, animType: MCAnimationType, direction: MCDirection): string | undefined {
        const result = this.playerTextures.get(sessionId);
        if (!result) return undefined;
        
        const animKey = `remote-${sessionId}-${animType}-${direction}`;
        return result.animationKeys.includes(animKey) ? animKey : undefined;
    }
    
    /**
     * Get the texture key for a player's direction
     */
    getTextureKey(sessionId: string, direction: MCDirection = 'S', animType: MCAnimationType = 'walk'): string | undefined {
        const result = this.playerTextures.get(sessionId);
        if (!result) return undefined;
        
        return result.compositorResult.textureKeys.get(`${animType}-${direction}`);
    }
    
    /**
     * Check if textures have been generated for a player
     */
    hasTexturesForPlayer(sessionId: string): boolean {
        return this.playerTextures.has(sessionId);
    }
    
    /**
     * Clean up textures and animations for a player who left
     */
    destroyForPlayer(sessionId: string): void {
        const result = this.playerTextures.get(sessionId);
        if (result) {
            // Remove animations
            for (const animKey of result.animationKeys) {
                if (this.scene.anims.exists(animKey)) {
                    this.scene.anims.remove(animKey);
                }
            }
        }
        
        // Destroy compositor (which cleans up textures)
        const compositor = this.compositors.get(sessionId);
        if (compositor) {
            compositor.destroy();
            this.compositors.delete(sessionId);
        }
        
        this.playerTextures.delete(sessionId);
        
        console.log(`[RemotePlayerCompositor] Cleaned up textures for player ${sessionId}`);
    }
    
    /**
     * Clean up all player textures
     */
    destroy(): void {
        for (const sessionId of this.playerTextures.keys()) {
            this.destroyForPlayer(sessionId);
        }
        this.compositors.clear();
        this.playerTextures.clear();
    }
}
