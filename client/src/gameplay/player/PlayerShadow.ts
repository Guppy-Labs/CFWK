import Phaser from 'phaser';

/**
 * Creates a simple circular shadow at the player's feet
 * simulating light from directly above.
 */
export class PlayerShadow {
    private scene: Phaser.Scene;
    private target: Phaser.Physics.Matter.Sprite;
    private shadow: Phaser.GameObjects.Ellipse;

    // Configuration
    private readonly width = 14;
    private readonly height = 6;
    private readonly alpha = 0.35;
    private readonly color = 0x000000;
    private readonly offsetY = 2; // Offset to position at feet

    constructor(scene: Phaser.Scene, target: Phaser.Physics.Matter.Sprite) {
        this.scene = scene;
        this.target = target;

        // Create ellipse shadow at player's feet
        this.shadow = scene.add.ellipse(
            target.x,
            target.y + this.offsetY,
            this.width,
            this.height,
            this.color,
            this.alpha
        );
        
        // Draw behind the player
        this.shadow.setDepth(this.target.depth - 1);
    }

    /**
     * Update shadow position to follow player
     */
    update() {
        if (!this.target.active || !this.target.visible) {
            this.shadow.setVisible(false);
            return;
        }
        this.shadow.setVisible(true);

        // Position at player's feet
        this.shadow.setPosition(
            this.target.x,
            this.target.y + this.offsetY
        );

        // Keep depth relative to player
        this.shadow.setDepth(this.target.depth - 1);
    }

    /**
     * Set shadow alpha (for AFK transparency)
     */
    setAlpha(alpha: number) {
        this.shadow.setAlpha(this.alpha * alpha);
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.shadow.destroy();
    }
}
