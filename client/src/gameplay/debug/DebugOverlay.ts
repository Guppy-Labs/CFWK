import Phaser from 'phaser';
import { OccluderRegion } from '../map/TiledTypes';
import { WorldTimeState, formatFullDateTime } from '@cfwk/shared';

/**
 * Debug overlay for visualizing collision bodies, occluders, and player state
 */
export class DebugOverlay {
    private scene: Phaser.Scene;
    private uiScene: Phaser.Scene;
    private graphics?: Phaser.GameObjects.Graphics;
    private timeText?: Phaser.GameObjects.Text;
    private enabled = false;
    private textOnly = false;

    constructor(scene: Phaser.Scene, uiScene?: Phaser.Scene) {
        this.scene = scene;
        this.uiScene = uiScene ?? scene;
    }

    /**
     * Check if debug mode is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Toggle debug visibility
     */
    toggle(textOnly = false) {
        this.enabled = !this.enabled;
        this.textOnly = textOnly;

        if (!this.graphics) {
            this.graphics = this.scene.add.graphics();
            this.graphics.setDepth(2000);
            this.graphics.setScrollFactor(1);
        }

        if (!this.timeText) {
            this.timeText = this.uiScene.add.text(
                10,
                10,
                'Debug Mode Active',
                {
                    fontFamily: 'Arial, sans-serif',
                    fontSize: '14px',
                    color: '#00ff00',
                    backgroundColor: '#000000',
                    padding: { x: 8, y: 6 }
                }
            );
            this.timeText.setOrigin(0, 0); // Top-left alignment
            this.timeText.setScrollFactor(0); // Fixed to camera
            this.timeText.setDepth(9999); // Very high depth to ensure visibility
        }

        this.graphics.setVisible(this.enabled && !this.textOnly);
        this.timeText.setVisible(this.enabled);
        
        // Force immediate text update when toggling on
        if (this.enabled) {
            this.updateTimeDisplay();
        }
    }

    /**
     * Redraw all debug visualizations
     */
    draw(
        collisionBodies: MatterJS.BodyType[],
        occluderRegions: OccluderRegion[],
        spawnPoint?: Phaser.Math.Vector2,
        player?: Phaser.Physics.Matter.Sprite,
        worldTime?: WorldTimeState
    ) {
        if (!this.graphics || !this.enabled) return;
        this.graphics.clear();

        if (!this.textOnly) {
            this.drawOccluders(occluderRegions);
            this.drawColliders(collisionBodies);
            this.drawSpawnPoint(spawnPoint);
            this.drawPlayer(player);
        }
        this.updateTimeDisplay(worldTime);
    }

    /**
     * Update the time display text
     */
    private updateTimeDisplay(worldTime?: WorldTimeState) {
        if (!this.timeText) return;
        
        if (!worldTime) {
            this.timeText.setText('World Time: Loading...');
            return;
        }
        
        const timeStr = formatFullDateTime(worldTime);
        const brightnessStr = `Brightness: ${(worldTime.brightness * 100).toFixed(1)}%`;
        const dayNightStr = worldTime.isDaytime ? 'Day' : 'Night';
        
        this.timeText.setText(`${timeStr}\n${brightnessStr} | ${dayNightStr}`);
    }

    private drawOccluders(regions: OccluderRegion[]) {
        if (regions.length === 0) return;

        this.graphics!.lineStyle(2, 0x00c8ff, 0.9);
        this.graphics!.fillStyle(0x00c8ff, 0.15);

        regions.forEach((region) => {
            const poly = region.polygon;
            if (poly.length < 3) return;

            this.graphics!.beginPath();
            this.graphics!.moveTo(poly[0].x, poly[0].y);
            for (let i = 1; i < poly.length; i++) {
                this.graphics!.lineTo(poly[i].x, poly[i].y);
            }
            this.graphics!.closePath();
            this.graphics!.fillPath();
            this.graphics!.strokePath();
        });
    }

    private drawColliders(bodies: MatterJS.BodyType[]) {
        this.graphics!.lineStyle(2, 0xff00ff, 0.9);
        this.graphics!.fillStyle(0xff00ff, 0.2);

        bodies.forEach((body) => {
            if (!body.vertices || body.vertices.length === 0) return;

            this.graphics!.beginPath();
            this.graphics!.moveTo(body.vertices[0].x, body.vertices[0].y);
            for (let i = 1; i < body.vertices.length; i++) {
                this.graphics!.lineTo(body.vertices[i].x, body.vertices[i].y);
            }
            this.graphics!.closePath();
            this.graphics!.fillPath();
            this.graphics!.strokePath();
        });
    }

    private drawSpawnPoint(spawnPoint?: Phaser.Math.Vector2) {
        if (!spawnPoint) return;

        this.graphics!.fillStyle(0x00ff00, 0.9);
        this.graphics!.fillCircle(spawnPoint.x, spawnPoint.y, 4);
        this.graphics!.lineStyle(1, 0x00ff00, 0.9);
        this.graphics!.strokeCircle(spawnPoint.x, spawnPoint.y, 10);
    }

    private drawPlayer(player?: Phaser.Physics.Matter.Sprite) {
        if (!player?.body) return;

        const body = player.body as MatterJS.BodyType;
        if (body.vertices && body.vertices.length > 0) {
            this.graphics!.lineStyle(2, 0x00ff00, 1);
            this.graphics!.fillStyle(0x00ff00, 0.2);
            this.graphics!.beginPath();
            this.graphics!.moveTo(body.vertices[0].x, body.vertices[0].y);
            for (let i = 1; i < body.vertices.length; i++) {
                this.graphics!.lineTo(body.vertices[i].x, body.vertices[i].y);
            }
            this.graphics!.closePath();
            this.graphics!.fillPath();
            this.graphics!.strokePath();
        }

        // Occlusion check line
        const bottomLeft = player.getBottomLeft();
        const bottomRight = player.getBottomRight();
        this.graphics!.lineStyle(2, 0xffd000, 1);
        this.graphics!.beginPath();
        this.graphics!.moveTo(bottomLeft.x, bottomLeft.y);
        this.graphics!.lineTo(bottomRight.x, bottomRight.y);
        this.graphics!.strokePath();
    }
}
