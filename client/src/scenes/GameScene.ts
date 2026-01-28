/**
 * MAIN GAME ENTRY (MAP RENDERING REMOVED)
 * The legacy custom map renderer has been retired in favor of upcoming TMX
 * tilemap handling via Phaser. This scene is intentionally minimal so the new
 * map pipeline can be introduced cleanly.
 * Guppy Labs 2026
 */

import Phaser from 'phaser';

export class GameScene extends Phaser.Scene {
    
    constructor() {
        super('GameScene');
    }

    create() {
        // Intentionally blank. Legacy map rendering has been removed.
        // New TMX tilemap handling will be introduced here in the future.
        this.cameras.main.setBackgroundColor('#121212');
    }

    update() {
        // No-op for now.
    }
}
