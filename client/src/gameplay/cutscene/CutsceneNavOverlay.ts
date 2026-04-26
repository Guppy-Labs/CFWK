import Phaser from 'phaser';
import { ENTITY_BASE } from '../rendering/DepthBands';

export class CutsceneNavOverlay {
    private scene: Phaser.Scene;
    private directionArrow: Phaser.GameObjects.Triangle;
    private targetMarker: Phaser.GameObjects.Container;
    private targetX = 0;
    private targetY = 0;
    private arrivalRadius: number;
    private destroyed = false;

    constructor(scene: Phaser.Scene, arrivalRadiusPx: number = 48) {
        this.scene = scene;
        this.arrivalRadius = arrivalRadiusPx;

        this.directionArrow = scene.add.triangle(0, 0, -8, -5, 9, 0, -8, 5, 0xffc04d, 0.85);
        this.directionArrow.setVisible(false);
        this.directionArrow.setDepth(ENTITY_BASE - 1);

        const markerStem = scene.add.rectangle(0, -6.5, 3.2, 10.5, 0xff9a2e, 0.9).setOrigin(0.5, 1);
        const markerDot = scene.add.circle(0, -2.1, 2.1, 0xff9a2e, 0.9);
        this.targetMarker = scene.add.container(0, 0, [markerStem, markerDot]);
        this.targetMarker.setVisible(false);
        this.targetMarker.setDepth(ENTITY_BASE + 2001);
        this.targetMarker.setScale(1.08);
    }

    setTarget(x: number, y: number): void {
        this.targetX = x;
        this.targetY = y;
        this.targetMarker.setVisible(true);
        this.directionArrow.setVisible(true);
    }

    getTargetX(): number { return this.targetX; }
    getTargetY(): number { return this.targetY; }
    getArrivalRadius(): number { return this.arrivalRadius; }

    update(playerX: number, playerY: number, playerDepth: number, time: number): void {
        if (this.destroyed) return;

        const dx = this.targetX - playerX;
        const dy = this.targetY - playerY;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const dirX = dx / distance;
        const dirY = dy / distance;

        const hideArrowDist = 100;
        const arrowPushOut = 34;
        const arrowX = playerX + dirX * arrowPushOut;
        const arrowY = playerY - 8 + dirY * arrowPushOut;
        const angle = Math.atan2(dy, dx);
        const warp = 0.62 + 0.22 * Math.abs(dirX);

        if (distance <= hideArrowDist) {
            this.directionArrow.setVisible(false);
        } else {
            this.directionArrow.setVisible(true);
            this.directionArrow.setPosition(arrowX, arrowY);
            this.directionArrow.setRotation(angle);
            this.directionArrow.setScale(0.82, warp);
            this.directionArrow.setAlpha(0.7 + Math.sin(time * 0.01) * 0.08);
            this.directionArrow.setDepth(playerDepth - 1);
        }

        const bobOffset = Math.sin(time * 0.0045) * 1.2;
        this.targetMarker.setPosition(this.targetX, this.targetY - 54 + bobOffset);
        this.targetMarker.setDepth(ENTITY_BASE + 2001);
    }

    destroy(): void {
        this.destroyed = true;
        this.directionArrow.destroy();
        this.targetMarker.destroy();
    }
}
