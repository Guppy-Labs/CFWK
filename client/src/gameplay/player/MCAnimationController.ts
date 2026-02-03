/**
 * MCAnimationController - Animation controller for the Main Character (cat)
 * 
 * Key differences from the test character:
 * - Uses horizontal animation strips instead of tilesheets
 * - Different frame dimensions per direction (16x27 for N/S, 19x27 for E/W)
 * - 8 frames per animation
 * - Handles mirrored directions
 * - Works with composited textures from CharacterCompositor
 */

import Phaser from 'phaser';
import {
    MCDirection,
    MCAnimationType,
    MC_FRAME_DIMENSIONS,
    MC_FRAMES_PER_ANIMATION,
    ICharacterAppearance,
    DEFAULT_CHARACTER_APPEARANCE
} from '@cfwk/shared';
import { CharacterCompositor, CompositorResult } from './CharacterCompositor';

/**
 * Direction enum (compatible with network sync)
 * Maps to the 8-directional system used elsewhere
 */
export enum MCDirectionIndex {
    Down = 0,
    DownRight = 1,
    Right = 2,
    UpRight = 3,
    Up = 4,
    UpLeft = 5,
    Left = 6,
    DownLeft = 7
}

/**
 * Configuration for MC animations
 */
export interface MCAnimationConfig {
    walkFrameRate?: number;
    idleFrameRate?: number;
    runFrameRate?: number;
    scale?: number;
}

const DEFAULT_CONFIG: Required<MCAnimationConfig> = {
    walkFrameRate: 10,
    idleFrameRate: 6,
    runFrameRate: 12,
    scale: 1.0
};

/**
 * Mapping from direction index to MCDirection string
 */
const INDEX_TO_DIRECTION: Record<MCDirectionIndex, MCDirection> = {
    [MCDirectionIndex.Down]: 'S',
    [MCDirectionIndex.DownRight]: 'SE',
    [MCDirectionIndex.Right]: 'E',
    [MCDirectionIndex.UpRight]: 'NE',
    [MCDirectionIndex.Up]: 'N',
    [MCDirectionIndex.UpLeft]: 'NW',
    [MCDirectionIndex.Left]: 'W',
    [MCDirectionIndex.DownLeft]: 'SW'
};

export class MCAnimationController {
    private scene: Phaser.Scene;
    private config: Required<MCAnimationConfig>;
    private compositor: CharacterCompositor;
    private compositorResult?: CompositorResult;
    private animationsCreated = false;

    // Current state
    private currentDirection: MCDirectionIndex = MCDirectionIndex.Down;
    private currentAnimation: MCAnimationType = 'walk';
    private currentRotation: number = Math.PI / 2; // Start facing down (south)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private _isSprinting = false;

    // Movement thresholds
    private readonly moveThreshold = 0.1;

    constructor(scene: Phaser.Scene, config: MCAnimationConfig = {}) {
        this.scene = scene;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.compositor = new CharacterCompositor(scene);
    }

    /**
     * Initialize the character with appearance data
     * This composites all the layers and creates animations
     */
    async initialize(appearance: ICharacterAppearance = DEFAULT_CHARACTER_APPEARANCE): Promise<void> {
        // Composite all layers into textures
        this.compositorResult = await this.compositor.compositeCharacter(appearance, ['walk']);
        
        // Create Phaser animations from composited textures
        this.createAnimations();
    }

    /**
     * Create Phaser animations from composited textures
     */
    private createAnimations() {
        if (this.animationsCreated || !this.compositorResult) return;

        const directions: MCDirection[] = ['N', 'S', 'E', 'W', 'NE', 'SE', 'NW', 'SW'];
        const animTypes: MCAnimationType[] = ['walk'];

        for (const animType of animTypes) {
            for (const direction of directions) {
                const textureKey = this.compositorResult.textureKeys.get(`${animType}-${direction}`);
                if (!textureKey) continue;

                const dimensions = MC_FRAME_DIMENSIONS[direction];
                const animKey = this.getAnimationKey(animType, direction);

                // Get the texture and add frame definitions manually
                const texture = this.scene.textures.get(textureKey);
                if (!texture) continue;

                // Remove the default '__BASE' frame that addCanvas creates
                // and add numbered frames for each animation frame
                for (let i = 0; i < MC_FRAMES_PER_ANIMATION; i++) {
                    texture.add(
                        i,              // Frame name (number)
                        0,              // Source index
                        i * dimensions.width,  // x
                        0,              // y
                        dimensions.width,      // width
                        dimensions.height      // height
                    );
                }

                // Get frame rate
                let frameRate = this.config.walkFrameRate;
                if (animType === 'idle') frameRate = this.config.idleFrameRate;
                if (animType === 'run') frameRate = this.config.runFrameRate;

                // Create the animation with explicit frame references
                const frames: Phaser.Types.Animations.AnimationFrame[] = [];
                for (let i = 0; i < MC_FRAMES_PER_ANIMATION; i++) {
                    frames.push({
                        key: textureKey,
                        frame: i
                    });
                }

                this.scene.anims.create({
                    key: animKey,
                    frames: frames,
                    frameRate,
                    repeat: -1
                });
            }
        }

        this.animationsCreated = true;
    }

    /**
     * Generate animation key
     */
    private getAnimationKey(animType: MCAnimationType, direction: MCDirection): string {
        return `mc-${animType}-${direction}`;
    }

    /**
     * Set whether the player is sprinting
     */
    setSprinting(sprinting: boolean) {
        this.isSprinting = sprinting;
    }

    /**
     * Get current rotation
     */
    getCurrentRotation(): number {
        return this.currentRotation;
    }

    /**
     * Update animation based on velocity
     */
    update(player: Phaser.Physics.Matter.Sprite, vx: number, vy: number, manualRotation?: number) {
        if (!this.animationsCreated || !this.compositorResult) return;

        // Calculate input speed
        const inputSpeed = Math.hypot(vx, vy);
        const isMoving = inputSpeed > this.moveThreshold;

        // Get actual body velocity for turn rate
        const bodyVel = player.body?.velocity as MatterJS.Vector;
        const actualSpeed = bodyVel ? Math.hypot(bodyVel.x, bodyVel.y) : 0;

        // Update rotation
        if (manualRotation !== undefined) {
            this.currentRotation = manualRotation;
        } else {
            let targetAngle = this.currentRotation;
            if (isMoving) {
                targetAngle = Math.atan2(vy, vx);
            }

            // Turn rate based on speed
            let turnRate = 0.4; // Fast when standing
            if (actualSpeed > 2.5) {
                turnRate = 0.04; // Slow when running
            } else if (actualSpeed > 0.5) {
                turnRate = 0.15; // Medium when walking
            }

            this.currentRotation = Phaser.Math.Angle.RotateTo(this.currentRotation, targetAngle, turnRate);
        }

        // Convert rotation to direction
        this.currentDirection = this.getDirectionIndexFromAngle(this.currentRotation);
        const dirString = INDEX_TO_DIRECTION[this.currentDirection];

        // Determine animation type
        let newAnimation: MCAnimationType = 'walk';
        // When we have idle/run, we'll use them:
        // if (!isMoving) newAnimation = 'idle';
        // else if (this.isSprinting) newAnimation = 'run';

        // Get animation key
        const animKey = this.getAnimationKey(newAnimation, dirString);

        // Note: W/NW/SW textures are already pre-flipped in the compositor,
        // so we don't need to use setFlipX here
        player.setFlipX(false);

        // Update display size based on direction (E/W are wider)
        const dimensions = MC_FRAME_DIMENSIONS[dirString];
        const scale = this.config.scale;
        player.setDisplaySize(dimensions.width * scale, dimensions.height * scale);

        // Play animation if changed
        if (this.currentAnimation !== newAnimation || player.anims.currentAnim?.key !== animKey) {
            this.currentAnimation = newAnimation;
            if (this.scene.anims.exists(animKey)) {
                player.play(animKey, true);
            }
        }
    }

    /**
     * Convert angle to direction index
     */
    private getDirectionIndexFromAngle(radians: number): MCDirectionIndex {
        const deg = Phaser.Math.RadToDeg(radians);

        if (deg >= -22.5 && deg < 22.5) return MCDirectionIndex.Right;
        if (deg >= 22.5 && deg < 67.5) return MCDirectionIndex.DownRight;
        if (deg >= 67.5 && deg < 112.5) return MCDirectionIndex.Down;
        if (deg >= 112.5 && deg < 157.5) return MCDirectionIndex.DownLeft;
        if (deg >= 157.5 || deg < -157.5) return MCDirectionIndex.Left;
        if (deg >= -157.5 && deg < -112.5) return MCDirectionIndex.UpLeft;
        if (deg >= -112.5 && deg < -67.5) return MCDirectionIndex.Up;
        if (deg >= -67.5 && deg < -22.5) return MCDirectionIndex.UpRight;

        return MCDirectionIndex.Down;
    }

    /**
     * Get the initial texture key for spawning
     * Returns the south-facing walk first frame
     */
    getInitialTextureKey(): string {
        return this.compositorResult?.textureKeys.get('walk-S') || 'mc-walk-S-0';
    }

    /**
     * Get the initial animation key
     */
    getInitialAnimationKey(): string {
        return this.getAnimationKey('walk', 'S');
    }

    /**
     * Get current direction (0-7 for network sync)
     */
    getDirection(): number {
        return this.currentDirection;
    }

    /**
     * Get current animation type
     */
    getAnimation(): MCAnimationType {
        return this.currentAnimation;
    }

    /**
     * Get frame dimensions for current direction
     */
    getCurrentFrameDimensions(): { width: number; height: number } {
        const dirString = INDEX_TO_DIRECTION[this.currentDirection];
        return MC_FRAME_DIMENSIONS[dirString];
    }

    /**
     * Check if character is facing east (for hitbox alignment)
     * E, NE, SE all face right
     */
    isFacingEast(): boolean {
        return this.currentDirection === MCDirectionIndex.Right ||
               this.currentDirection === MCDirectionIndex.UpRight ||
               this.currentDirection === MCDirectionIndex.DownRight;
    }

    /**
     * Check if character is facing west (for hitbox alignment)
     * W, NW, SW all face left
     */
    isFacingWest(): boolean {
        return this.currentDirection === MCDirectionIndex.Left ||
               this.currentDirection === MCDirectionIndex.UpLeft ||
               this.currentDirection === MCDirectionIndex.DownLeft;
    }

    /**
     * Get the hitbox offset for current direction
     * E/W directions need offset because visual is 19px but hitbox is 16px
     */
    getHitboxOffset(): { x: number; y: number } {
        const dirString = INDEX_TO_DIRECTION[this.currentDirection];
        const dimensions = MC_FRAME_DIMENSIONS[dirString];
        
        // N/S have 16px width, no offset needed
        if (dimensions.width === 16) {
            return { x: 0, y: 0 };
        }

        // E/W have 19px width - the extra 3px is cape on the back
        // When facing East, cape is on the left, so offset right
        // When facing West (flipped), cape is on the right, so offset left
        const capeWidth = dimensions.width - 16; // 3px
        
        if (this.isFacingEast()) {
            return { x: capeWidth / 2, y: 0 }; // Shift hitbox right
        } else if (this.isFacingWest()) {
            return { x: -capeWidth / 2, y: 0 }; // Shift hitbox left
        }

        return { x: 0, y: 0 };
    }

    /**
     * Play interact animation (placeholder until we have interact sprites)
     */
    playInteract(_player: Phaser.Physics.Matter.Sprite, _facingAngle: number): number {
        // For now, just return a default duration
        // Will implement properly when interact sprites are ready
        return 300;
    }

    /**
     * Get interact frame duration
     */
    getInteractFrameDurationMs(): number {
        return 1000 / 16; // ~62ms
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.compositor.destroy();
    }
}
