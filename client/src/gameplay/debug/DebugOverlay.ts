import Phaser from 'phaser';
import { OccluderRegion } from '../map/TiledTypes';
import { WorldTimeState, formatFullDateTime } from '@cfwk/shared';
import { ZoomRegion } from '../camera/CameraController';
import type { JoystickDebugInfo } from '../ui/MobileControls';

/**
 * Water debug info from WaterSystem
 */
export interface WaterDebugInfo {
    inWater: boolean;
    isWet: boolean;
    depth: number;
    speedMult: number;
}

/**
 * Extended debug info for the overlay
 */
export interface ExtendedDebugInfo {
    // Camera
    cameraZoom?: number;
    targetZoom?: number;
    zoomRegions?: ZoomRegion[];
    
    // Player
    playerX?: number;
    playerY?: number;
    playerVelX?: number;
    playerVelY?: number;
    playerSpeed?: number;
    playerHeadingDeg?: number;
    playerDepth?: number;
    isMoving?: boolean;
    isSprinting?: boolean;
    stamina?: number;
    
    // Fire POIs
    firePositions?: { x: number; y: number }[];
    
    // Generated border
    generatedBorder?: { x: number; y: number }[];
    
    // Network
    isConnected?: boolean;
    remotePlayerCount?: number;
    instanceId?: string;
    
    // Performance
    fps?: number;

    // UI
    joystickDebug?: JoystickDebugInfo;
}

/**
 * Debug overlay for visualizing collision bodies, occluders, and player state
 */
export class DebugOverlay {
    private scene: Phaser.Scene;
    private uiScene: Phaser.Scene;
    private graphics?: Phaser.GameObjects.Graphics;
    private uiGraphics?: Phaser.GameObjects.Graphics;
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

        if (!this.uiGraphics) {
            this.uiGraphics = this.uiScene.add.graphics();
            this.uiGraphics.setDepth(9998);
            this.uiGraphics.setScrollFactor(0);
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
        this.uiGraphics.setVisible(this.enabled && !this.textOnly);
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
        worldTime?: WorldTimeState,
        waterDebug?: WaterDebugInfo,
        extendedDebug?: ExtendedDebugInfo
    ) {
        if (!this.graphics || !this.enabled) return;
        this.graphics.clear();
        this.uiGraphics?.clear();

        if (!this.textOnly) {
            this.drawOccluders(occluderRegions);
            this.drawColliders(collisionBodies);
            this.drawZoomRegions(extendedDebug?.zoomRegions);
            this.drawFirePositions(extendedDebug?.firePositions);
            this.drawGeneratedBorder(extendedDebug?.generatedBorder);
            this.drawSpawnPoint(spawnPoint);
            this.drawPlayer(player);
            this.drawJoystickDebug(extendedDebug?.joystickDebug);
        }
        this.updateTimeDisplay(worldTime, waterDebug, extendedDebug);
    }

    /**
     * Update the time display text
     */
    private updateTimeDisplay(worldTime?: WorldTimeState, waterDebug?: WaterDebugInfo, extendedDebug?: ExtendedDebugInfo) {
        if (!this.timeText) return;
        
        const lines: string[] = [];
        
        // Performance
        if (extendedDebug?.fps !== undefined) {
            lines.push(`FPS: ${extendedDebug.fps.toFixed(0)}`);
        }
        
        // World Time
        if (worldTime) {
            const timeStr = formatFullDateTime(worldTime);
            const brightnessStr = `${(worldTime.brightness * 100).toFixed(0)}%`;
            const dayNightStr = worldTime.isDaytime ? 'DAY' : 'NIGHT';
            lines.push(`${timeStr} | ${brightnessStr} ${dayNightStr}`);
        } else {
            lines.push('World Time: Loading...');
        }
        
        // Camera / Zoom
        if (extendedDebug?.cameraZoom !== undefined) {
            const zoomStr = `Zoom: ${extendedDebug.cameraZoom.toFixed(2)}x`;
            const targetStr = extendedDebug.targetZoom !== undefined && 
                Math.abs(extendedDebug.cameraZoom - extendedDebug.targetZoom) > 0.01
                ? ` → ${extendedDebug.targetZoom.toFixed(2)}x`
                : '';
            lines.push(zoomStr + targetStr);
        }
        
        // Player position & movement
        if (extendedDebug?.playerX !== undefined && extendedDebug?.playerY !== undefined) {
            const posStr = `Pos: (${extendedDebug.playerX.toFixed(0)}, ${extendedDebug.playerY.toFixed(0)})`;
            const velStr = extendedDebug.playerVelX !== undefined && extendedDebug.playerVelY !== undefined
                ? ` V: <${extendedDebug.playerVelX.toFixed(2)}, ${extendedDebug.playerVelY.toFixed(2)}>`
                : '';
            lines.push(posStr + velStr);

            if (
                extendedDebug.playerSpeed !== undefined &&
                extendedDebug.playerHeadingDeg !== undefined
            ) {
                lines.push(
                    `|V|: ${extendedDebug.playerSpeed.toFixed(2)} | Heading: ${extendedDebug.playerHeadingDeg.toFixed(1)}°`
                );
            }
            
            // Movement state
            const moveState = extendedDebug.isMoving 
                ? (extendedDebug.isSprinting ? 'SPRINT' : 'WALK') 
                : 'IDLE';
            const staminaStr = extendedDebug.stamina !== undefined 
                ? ` | Stamina: ${(extendedDebug.stamina * 100).toFixed(0)}%`
                : '';
            const depthStr = extendedDebug.playerDepth !== undefined
                ? ` | Depth: ${extendedDebug.playerDepth.toFixed(1)}`
                : '';
            lines.push(moveState + staminaStr + depthStr);
        }
        
        // Water debug
        if (waterDebug) {
            const depthStr = `Depth: ${waterDebug.depth.toFixed(2)}`;
            const speedStr = `Speed: ${(waterDebug.speedMult * 100).toFixed(0)}%`;
            const stateStr = waterDebug.inWater ? 'IN WATER' : (waterDebug.isWet ? 'WET' : 'DRY');
            lines.push(`Water ${depthStr} | ${speedStr} | ${stateStr}`);
        }
        
        // Network status
        if (extendedDebug?.isConnected !== undefined) {
            const connStr = extendedDebug.isConnected ? 'ONLINE' : 'OFFLINE';
            const playersStr = extendedDebug.remotePlayerCount !== undefined 
                ? ` | Players: ${extendedDebug.remotePlayerCount + 1}` // +1 for local player
                : '';
            const instanceStr = extendedDebug.instanceId 
                ? ` | ${extendedDebug.instanceId.substring(0, 8)}...`
                : '';
            lines.push(connStr + playersStr + instanceStr);
        }

        // Joystick debug
        if (extendedDebug?.joystickDebug) {
            const jd = extendedDebug.joystickDebug;
            lines.push(
                `Joystick: ${jd.joystickVisible ? 'VISIBLE' : 'HIDDEN'} | `
                + `Mobile:${jd.isMobileDevice ? 'Y' : 'N'} `
                + `Show:${jd.showTouchControls ? 'Y' : 'N'} `
                + `GUI:${jd.guiOpen ? 'Y' : 'N'} `
                + `KB:${jd.keyboardUsed ? 'Y' : 'N'}`
            );
            lines.push(
                `JS Pos: (${jd.baseX.toFixed(1)}, ${jd.baseY.toFixed(1)}) `
                + `R:${jd.radius.toFixed(1)} Z:${jd.zoom.toFixed(2)} `
                + `View:${jd.viewWidth.toFixed(0)}x${jd.viewHeight.toFixed(0)}`
            );
            lines.push(
                `JS Tex: base:${jd.hasBaseTexture ? 'Y' : 'N'} `
                + `handle:${jd.hasHandleTexture ? 'Y' : 'N'} `
                + `sprites:${jd.spritesReady ? 'Y' : 'N'} `
                + `container:${jd.containerVisible ? 'Y' : 'N'}`
            );
            lines.push(
                `JS Alpha: base:${jd.baseAlpha.toFixed(2)} `
                + `handle:${jd.handleAlpha.toFixed(2)} `
                + `Depth: ${jd.baseDepth}/${jd.handleDepth} `
                + `Scene: ${jd.renderScene}`
            );
        }
        
        this.timeText.setText(lines.join('\n'));
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
    
    private drawZoomRegions(regions?: ZoomRegion[]) {
        if (!regions || regions.length === 0) return;

        // Yellow/gold color for zoom regions
        this.graphics!.lineStyle(2, 0xffc400, 0.8);
        this.graphics!.fillStyle(0xffc400, 0.1);

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
            
            // Draw zoom multiplier label at centroid
            const cx = poly.reduce((sum, p) => sum + p.x, 0) / poly.length;
            const cy = poly.reduce((sum, p) => sum + p.y, 0) / poly.length;
            this.graphics!.fillStyle(0xffc400, 1);
            this.graphics!.fillCircle(cx, cy, 3);
        });
    }
    
    private drawFirePositions(positions?: { x: number; y: number }[]) {
        if (!positions || positions.length === 0) return;

        // Orange/red color for fire POIs
        positions.forEach((pos) => {
            // Outer glow
            this.graphics!.fillStyle(0xff6600, 0.3);
            this.graphics!.fillCircle(pos.x, pos.y, 12);
            
            // Inner core
            this.graphics!.fillStyle(0xff3300, 0.8);
            this.graphics!.fillCircle(pos.x, pos.y, 5);
            
            // Cross marker
            this.graphics!.lineStyle(1, 0xffcc00, 1);
            this.graphics!.beginPath();
            this.graphics!.moveTo(pos.x - 8, pos.y);
            this.graphics!.lineTo(pos.x + 8, pos.y);
            this.graphics!.moveTo(pos.x, pos.y - 8);
            this.graphics!.lineTo(pos.x, pos.y + 8);
            this.graphics!.strokePath();
        });
    }
    
    private drawGeneratedBorder(polygon?: { x: number; y: number }[]) {
        if (!polygon || polygon.length < 3) return;

        // Lime green color for generated border
        this.graphics!.lineStyle(2, 0x00ff88, 0.9);
        this.graphics!.fillStyle(0x00ff88, 0.08);

        this.graphics!.beginPath();
        this.graphics!.moveTo(polygon[0].x, polygon[0].y);
        for (let i = 1; i < polygon.length; i++) {
            this.graphics!.lineTo(polygon[i].x, polygon[i].y);
        }
        this.graphics!.closePath();
        this.graphics!.fillPath();
        this.graphics!.strokePath();
        
        // Draw small dots at each vertex to show smoothing
        this.graphics!.fillStyle(0x00ff88, 0.7);
        polygon.forEach((p) => {
            this.graphics!.fillCircle(p.x, p.y, 2);
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

    private drawJoystickDebug(debug?: JoystickDebugInfo) {
        if (!debug || !this.uiGraphics) return;

        const color = debug.joystickVisible ? 0x00ffd0 : 0xff8800;
        this.uiGraphics.lineStyle(2, color, 0.85);
        this.uiGraphics.strokeRect(0, 0, debug.viewWidth, debug.viewHeight);

        if (debug.radius > 0) {
            this.uiGraphics.strokeCircle(debug.baseX, debug.baseY, debug.radius);
        }

        this.uiGraphics.lineStyle(2, 0xffffff, 0.9);
        this.uiGraphics.strokeCircle(debug.baseX, debug.baseY, 4);
        this.uiGraphics.strokeCircle(debug.handleX, debug.handleY, 3);
        this.uiGraphics.lineBetween(debug.baseX, debug.baseY, debug.handleX, debug.handleY);
    }
}
