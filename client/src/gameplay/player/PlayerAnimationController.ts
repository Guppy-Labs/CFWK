import Phaser from 'phaser';

/**
 * Direction enum for 8-directional movement
 * Rows in spritesheet: Down=0, DownRight=1, Right=2, UpRight=3, Up=4
 * Left directions mirror the right ones
 */
export enum Direction {
    Down = 0,
    DownRight = 1,
    Right = 2,
    UpRight = 3,
    Up = 4,
    UpLeft = 5,    // mirrors UpRight
    Left = 6,      // mirrors Right
    DownLeft = 7   // mirrors DownRight
}

export type AnimationSet = 'idle' | 'walk' | 'run' | 'turn';

export type PlayerAnimationConfig = {
    frameWidth?: number;
    frameHeight?: number;
    idleFrames?: number;
    walkFrames?: number;
    runFrames?: number;
    idleFrameRate?: number;
    walkFrameRate?: number;
    runFrameRate?: number;
};

/**
 * Manages player sprite animations from tilesheets
 */
export class PlayerAnimationController {
    private scene: Phaser.Scene;
    private config: Required<PlayerAnimationConfig>;
    private currentDirection: Direction = Direction.Down;
    private currentAnimation: AnimationSet = 'idle';
    private animationsCreated = false;

    // Movement smoothing
    private currentRotation: number = Math.PI / 2; // Start facing Down
    private readonly moveThreshold = 0.1;

    // Externally controlled sprint state
    private isSprinting = false;

    constructor(scene: Phaser.Scene, config: PlayerAnimationConfig = {}) {
        this.scene = scene;
        this.config = {
            frameWidth: config.frameWidth ?? 16,
            frameHeight: config.frameHeight ?? 32,
            idleFrames: config.idleFrames ?? 4,
            walkFrames: config.walkFrames ?? 4,
            runFrames: config.runFrames ?? 6,
            idleFrameRate: config.idleFrameRate ?? 6,
            walkFrameRate: config.walkFrameRate ?? 8,
            runFrameRate: config.runFrameRate ?? 10
        };
    }

    /**
     * Load spritesheets in the preload phase
     */
    preload() {
        const { frameWidth, frameHeight } = this.config;

        this.scene.load.spritesheet('player-idle', '/assets/char/test/idle.png', {
            frameWidth,
            frameHeight
        });

        this.scene.load.spritesheet('player-walk', '/assets/char/test/walk.png', {
            frameWidth,
            frameHeight
        });

        this.scene.load.spritesheet('player-run', '/assets/char/test/run.png', {
            frameWidth,
            frameHeight
        });

        this.scene.load.spritesheet('player-rotate', '/assets/char/test/rotate.png', {
            frameWidth,
            frameHeight
        });
    }

    /**
     * Create all animations after assets are loaded
     */
    createAnimations() {
        if (this.animationsCreated) return;

        const { idleFrames, walkFrames, runFrames, idleFrameRate, walkFrameRate, runFrameRate } = this.config;

        // Create animations for each direction (5 rows in sheet)
        // Rows: 0=Down, 1=DownRight, 2=Right, 3=UpRight, 4=Up
        const directions: { name: string; row: number }[] = [
            { name: 'down', row: 0 },
            { name: 'down-right', row: 1 },
            { name: 'right', row: 2 },
            { name: 'up-right', row: 3 },
            { name: 'up', row: 4 }
        ];

        // Idle animations
        directions.forEach(({ name, row }) => {
            const frames = this.scene.anims.generateFrameNumbers('player-idle', {
                start: row * idleFrames,
                end: row * idleFrames + idleFrames - 1
            });

            this.scene.anims.create({
                key: `player-idle-${name}`,
                frames,
                frameRate: idleFrameRate,
                repeat: -1
            });
        });

        // Walk animations
        directions.forEach(({ name, row }) => {
            const frames = this.scene.anims.generateFrameNumbers('player-walk', {
                start: row * walkFrames,
                end: row * walkFrames + walkFrames - 1
            });

            this.scene.anims.create({
                key: `player-walk-${name}`,
                frames,
                frameRate: walkFrameRate,
                repeat: -1
            });
        });

        // Run animations
        directions.forEach(({ name, row }) => {
            const frames = this.scene.anims.generateFrameNumbers('player-run', {
                start: row * runFrames,
                end: row * runFrames + runFrames - 1
            });

            this.scene.anims.create({
                key: `player-run-${name}`,
                frames,
                frameRate: runFrameRate,
                repeat: -1
            });
        });

        this.animationsCreated = true;
    }

    /**
     * Set whether the player is sprinting
     */
    setSprinting(sprinting: boolean) {
        this.isSprinting = sprinting;
    }

    /**
     * Get the current facing rotation logic helper
     */
    getCurrentRotation() {
        return this.currentRotation;
    }

    /**
     * Update player animation based on velocity
     */
    update(player: Phaser.Physics.Matter.Sprite, vx: number, vy: number, manualRotation?: number) {
        if (!this.animationsCreated) return;

        // Use input/target velocity to determine INTENT (isMoving) and TARGET ANGLE
        const inputSpeed = Math.hypot(vx, vy);
        const isInputMoving = inputSpeed > this.moveThreshold;

        // Use ACTUAL body speed to determine momentum/turn rate
        const bodyVel = player.body?.velocity as MatterJS.Vector;
        const actualSpeed = bodyVel ? Math.hypot(bodyVel.x, bodyVel.y) : 0;

        // If manual rotation is provided, use that (physics driven rotation), otherwise calculate
        if (manualRotation !== undefined) {
             this.currentRotation = manualRotation;
        } else {
            // Calculate target angle
            let targetAngle = this.currentRotation;
            if (isInputMoving) {
                targetAngle = Math.atan2(vy, vx);
            }

            // Determine rotation animation speed based on ACTUAL BODY SPEED
            // "changing direction while standing still should be fast, while walking should be slightly slower, and while running should be slower"
            let turnRate = 0.4; // Default fast (Standing still / starting)
            if (actualSpeed > 2.5) {
                // Running (Sprint speed is ~3.2)
                turnRate = 0.08; 
            } else if (actualSpeed > 0.5) {
                // Walking (Walk speed is ~1.6)
                turnRate = 0.15;
            }

            // Smoothly rotate current angle towards target
            this.currentRotation = Phaser.Math.Angle.RotateTo(this.currentRotation, targetAngle, turnRate);
        }

        // Calculate target from input again for the diff check if we aren't using physics rotation directly?
        // Actually if we move rotation to physics, we just compare current physics rotation vs input rotation
        const targetAngleFromInput = isInputMoving ? Math.atan2(vy, vx) : this.currentRotation;
        
        const diff = Math.abs(Phaser.Math.Angle.Wrap(this.currentRotation - targetAngleFromInput));
        // Use a threshold to decide if we show the turning frame (sliding/momentum effect)
        const isTurning = isInputMoving && diff > 0.35;

        if (isTurning) {
             // Override animation with static rotation frame
            player.setTexture('player-rotate');
            player.setFlipX(false);
            const frameIndex = this.getRotateFrameFromAngle(this.currentRotation);
            player.setFrame(frameIndex);
            this.currentAnimation = 'turn';
            return;
        }

        // --- Standard Animation Logic (Aligned) ---

        // Snap direction to the current smooth rotation
        this.currentDirection = this.getDirectionFromAngle(this.currentRotation);

        // Determine animation set based on movement and sprint state
        let newAnimation: AnimationSet;
        if (!isInputMoving) {
            newAnimation = 'idle';
        } else if (this.isSprinting) {
            newAnimation = 'run';
        } else {
            newAnimation = 'walk';
        }

        // Get animation key and handle mirroring
        const { animKey, flipX } = this.getAnimationKey(newAnimation, this.currentDirection);

        // Apply flip for left-facing directions
        player.setFlipX(flipX);

        // Only change animation if needed
        if (this.currentAnimation !== newAnimation || player.anims.currentAnim?.key !== animKey) {
            this.currentAnimation = newAnimation;
            player.play(animKey, true);
        }
    }

    /**
     * Get the initial animation key (idle facing down)
     */
    getInitialAnimationKey(): string {
        return 'player-idle-down';
    }

    /**
     * Get the initial texture key for spawning
     */
    getInitialTextureKey(): string {
        return 'player-idle';
    }

    /**
     * Get appropriate frame index from rotate.png based on angle
     * Sheet Layout (Row-major):
     * 0: Down, 1: DownRight, 2: Right
     * 3: UpRight, 4: Up, 5: UpLeft
     * 6: Left, 7: DownLeft, 8: Unused
     */
    private getRotateFrameFromAngle(radians: number): number {
        const deg = Phaser.Math.RadToDeg(radians);
        
        // Map 45-degree sectors to frame indices
        if (deg >= 67.5 && deg < 112.5) return 0;   // Down (90)
        if (deg >= 22.5 && deg < 67.5) return 1;    // DownRight (45)
        if (deg >= -22.5 && deg < 22.5) return 2;   // Right (0)
        if (deg >= -67.5 && deg < -22.5) return 3;  // UpRight (-45)
        if (deg >= -112.5 && deg < -67.5) return 4; // Up (-90)
        if (deg >= -157.5 && deg < -112.5) return 5; // UpLeft (-135)
        if (deg >= 157.5 || deg < -157.5) return 6; // Left (180/-180)
        if (deg >= 112.5 && deg < 157.5) return 7;  // DownLeft (135)
        
        return 0; // Default Down
    }

    /**
     * Convert angle to 8-directional direction enum
     */
    private getDirectionFromAngle(radians: number): Direction {
        const deg = Phaser.Math.RadToDeg(radians);

        if (deg >= -22.5 && deg < 22.5) return Direction.Right;
        if (deg >= 22.5 && deg < 67.5) return Direction.DownRight;
        if (deg >= 67.5 && deg < 112.5) return Direction.Down;
        if (deg >= 112.5 && deg < 157.5) return Direction.DownLeft;
        if (deg >= 157.5 || deg < -157.5) return Direction.Left;
        if (deg >= -157.5 && deg < -112.5) return Direction.UpLeft;
        if (deg >= -112.5 && deg < -67.5) return Direction.Up;
        if (deg >= -67.5 && deg < -22.5) return Direction.UpRight;

        return Direction.Down;
    }

    /**
     * Get animation key and flip state for a direction
     */
    private getAnimationKey(anim: AnimationSet, direction: Direction): { animKey: string; flipX: boolean } {
        const directionMap: { [key in Direction]: { name: string; flip: boolean } } = {
            [Direction.Down]: { name: 'down', flip: false },
            [Direction.DownRight]: { name: 'down-right', flip: false },
            [Direction.Right]: { name: 'right', flip: false },
            [Direction.UpRight]: { name: 'up-right', flip: false },
            [Direction.Up]: { name: 'up', flip: false },
            [Direction.UpLeft]: { name: 'up-right', flip: true },
            [Direction.Left]: { name: 'right', flip: true },
            [Direction.DownLeft]: { name: 'down-right', flip: true }
        };

        const { name, flip } = directionMap[direction];
        return {
            animKey: `player-${anim}-${name}`,
            flipX: flip
        };
    }

    /**
     * Get the current direction (0-7)
     */
    getDirection(): number {
        return this.currentDirection;
    }

    /**
     * Get the current animation type
     */
    getAnimation(): AnimationSet {
        return this.currentAnimation;
    }
}
