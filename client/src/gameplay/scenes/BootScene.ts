/**
 * GAMEPLAY BOOTSTRAP SCENE
 * Guppy Labs 2026
 */

import Phaser from 'phaser';
import { SYSTEM_TILES } from '@cfwk/shared';

export class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        this.make.graphics({ x: 0, y: 0 })
            .fillStyle(0x00ff00)
            .fillRect(0, 0, 24, 51)
            .generateTexture('player', 24, 51);

        this.make.graphics({ x: 0, y: 0 })
            .fillStyle(0x0000ff)
            .fillRect(0, 0, 800, 600)
            .generateTexture('water', 800, 600);

        // Generate Invisible Collision Tile
        // #000000 with Alpha 1/255 (approx 0.004)
        const g = this.make.graphics({ x: 0, y: 0 });
        g.fillStyle(0x000000, 1/255);
        g.fillRect(0, 0, 32, 32);
        g.generateTexture(SYSTEM_TILES.INVISIBLE, 32, 32);
    }

    create() {
        this.scene.start('GameScene');
    }
}
