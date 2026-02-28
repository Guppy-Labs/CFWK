import Phaser from 'phaser';
import type { LightingManager } from '../fx/LightingManager';
import { ENTITY_BASE, SHADOW_OFFSET } from '../rendering/DepthBands';

type ShadowTarget = {
    x: number;
    y: number;
    active?: boolean;
    visible?: boolean;
    depth?: number;
};

/**
 * Creates a simple circular shadow at a player's feet.
 * Works with both Matter sprites and plain sprites.
 * Optionally scales alpha based on nearby lighting (ambient + point lights).
 */
export class PlayerShadow {
    private target: ShadowTarget;
    private shadow: Phaser.GameObjects.Ellipse;
    private lightingManager?: LightingManager;
    private manuallyHidden = false;

    // Configuration
    private readonly width = 14;
    private readonly height = 6;
    private readonly baseAlpha = 0.35;
    private readonly color = 0x000000;
    private readonly offsetY = 2;

    constructor(
        scene: Phaser.Scene,
        target: ShadowTarget,
        lightingManager?: LightingManager
    ) {
        this.target = target;
        this.lightingManager = lightingManager;

        this.shadow = scene.add.ellipse(
            target.x,
            target.y + this.offsetY,
            this.width,
            this.height,
            this.color,
            this.baseAlpha
        );

        this.shadow.setDepth((target.depth ?? ENTITY_BASE) + SHADOW_OFFSET);
    }

    /**
     * Update shadow position and light-dependent alpha
     */
    update() {
        if (this.manuallyHidden) {
            this.shadow.setVisible(false);
            return;
        }

        const active = (this.target as any).active ?? true;
        const visible = (this.target as any).visible ?? true;
        if (!active || !visible) {
            this.shadow.setVisible(false);
            return;
        }
        this.shadow.setVisible(true);

        this.shadow.setPosition(this.target.x, this.target.y + this.offsetY);

        const targetDepth = (this.target as any).depth ?? ENTITY_BASE;
        this.shadow.setDepth(targetDepth + SHADOW_OFFSET);

        // Scale alpha based on lighting
        if (this.lightingManager) {
            const lightLevel = this.lightingManager.getLightInfluenceAt(this.target.x, this.target.y);
            this.shadow.setAlpha(this.baseAlpha * lightLevel);
        }
    }

    setAlpha(alpha: number) {
        this.shadow.setAlpha(this.baseAlpha * alpha);
    }

    setVisible(visible: boolean) {
        this.manuallyHidden = !visible;
        this.shadow.setVisible(visible);
    }

    destroy() {
        this.shadow.destroy();
    }
}
