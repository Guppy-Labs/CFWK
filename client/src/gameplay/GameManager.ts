import Phaser from 'phaser';

/**
 * LEGACY MAP RENDERER REMOVED
 * This manager previously handled drawing legacy custom map data. It is now
 * intentionally minimal so the main game can be rebuilt around Phaser's native
 * TMX tilemap pipeline.
 */
export class GameManager {
    private static instance: GameManager;
    private scene: Phaser.Scene | null = null;

    private constructor() {}

    public static getInstance(): GameManager {
        if (!GameManager.instance) {
            GameManager.instance = new GameManager();
        }
        return GameManager.instance;
    }

    public initialize(scene: Phaser.Scene) {
        this.scene = scene;
    }

    public loadMap(_mapId: string) {
        // Legacy map rendering has been removed.
        // TMX tilemaps will be loaded here in the future.
    }

    public unloadMap() {
        // No-op: legacy map rendering removed.
    }

    public update() {
        // No-op: legacy update loop removed.
    }
}
