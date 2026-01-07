/**
 * THIS FILE IS ALL TEMPLATE CODE AND WILL BE REMOVED/REPLACED AT A LATER DATE.
 * Guppy Labs 2026
 */

import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        this.make.graphics({ x: 0, y: 0 })
            .fillStyle(0x00ff00)
            .fillRect(0, 0, 32, 32)
            .generateTexture('player', 32, 32);
            
        this.make.graphics({ x: 0, y: 0 })
            .fillStyle(0x0000ff)
            .fillRect(0, 0, 800, 600)
            .generateTexture('water', 800, 600);
    }

    create() {
        this.scene.start('GameScene');
        this.scene.launch('MapMakerScene');
        this.scene.sleep('MapMakerScene');
    }
}
