import Phaser from 'phaser';
import { TilesetEntry, TiledTilesetData } from './TiledTypes';
import { TileAnimationManager } from './TileAnimationManager';
import { CollisionManager } from './CollisionManager';
import { OcclusionManager } from './OcclusionManager';
import { LightingManager } from '../fx/LightingManager';

export interface MapLoaderConfig {
    groundLayerNames: Set<string>;
    occludableBaseDepth: number;
    playerFrontDepth: number;
}

export interface MapLoadResult {
    map: Phaser.Tilemaps.Tilemap;
    lightingManager: LightingManager;
}

/**
 * Handles map loading, tileset management, and layer creation
 */
export class MapLoader {
    private scene: Phaser.Scene;
    private config: MapLoaderConfig;
    
    private map?: Phaser.Tilemaps.Tilemap;
    private lightingManager?: LightingManager;
    private tileAnimationManager?: TileAnimationManager;

    constructor(scene: Phaser.Scene, config: MapLoaderConfig) {
        this.scene = scene;
        this.config = config;
    }

    /**
     * Preload map JSON file
     */
    preloadMap(mapFile: string): string {
        const mapKey = `map-${mapFile.replace('.tmj', '')}`;
        this.scene.load.tilemapTiledJSON(mapKey, `/maps/${mapFile}`);
        return mapKey;
    }

    /**
     * Load map and tilesets, then build layers
     * Returns a promise that resolves when map is fully loaded
     */
    loadMap(
        mapKey: string,
        collisionManager: CollisionManager,
        occlusionManager: OcclusionManager,
        onComplete: (result: MapLoadResult) => void
    ) {
        const mapCache = this.scene.cache.tilemap.get(mapKey);
        const mapData = mapCache?.data as { tilesets?: TiledTilesetData[] } | undefined;
        this.map = this.scene.make.tilemap({ key: mapKey });

        const tilesets = mapData?.tilesets || [];
        const tilesetKeys: TilesetEntry[] = [];
        const toLoad: string[] = [];

        tilesets.forEach((tileset: TiledTilesetData) => {
            const key = `tileset-${tileset.name}`;
            if (!this.scene.textures.exists(key) && tileset.image) {
                const url = encodeURI(`/maps/${tileset.image}`);
                this.scene.load.image(key, url);
                toLoad.push(key);
            }
            tilesetKeys.push({ tileset, key });
        });

        if (toLoad.length > 0) {
            this.scene.load.once('complete', () => {
                this.buildLayers(tilesetKeys, collisionManager, occlusionManager);
                onComplete(this.getResult());
            });
            this.scene.load.start();
        } else {
            this.buildLayers(tilesetKeys, collisionManager, occlusionManager);
            onComplete(this.getResult());
        }
    }

    /**
     * Build all map layers and setup managers
     */
    private buildLayers(
        tilesetKeys: TilesetEntry[],
        collisionManager: CollisionManager,
        occlusionManager: OcclusionManager
    ) {
        if (!this.map) return;

        // Initialize lighting manager first
        this.lightingManager = new LightingManager(this.scene);
        this.lightingManager.setupFromMap(this.map);

        // Add tilesets to map
        const phaserTilesets = tilesetKeys
            .map(({ tileset, key }) =>
                this.map!.addTilesetImage(tileset.name, key, tileset.tilewidth, tileset.tileheight, tileset.margin, tileset.spacing)
            )
            .filter((ts): ts is Phaser.Tilemaps.Tileset => ts !== null);

        let groundDepthIndex = 0;
        let occludableDepthIndex = 0;

        // Create tile layers
        this.map.layers.forEach((layerData) => {
            const layer = this.map!.createLayer(layerData.name, phaserTilesets, 0, 0);
            if (!layer) return;

            // Enable lighting on all tile layers
            this.lightingManager?.enableLightingOn(layer);

            if (this.config.groundLayerNames.has(layerData.name)) {
                layer.setDepth(groundDepthIndex * 10);
                groundDepthIndex += 1;
            } else {
                const baseDepth = this.config.occludableBaseDepth + occludableDepthIndex * 10;
                layer.setDepth(baseDepth);

                // Register with occlusion manager
                occlusionManager.addOccludableLayer(layer, baseDepth, layerData.name, occludableDepthIndex);
                occludableDepthIndex += 1;
            }
        });

        // Setup collision and occlusion from object layers
        collisionManager.setupFromObjectLayers(this.map);
        occlusionManager.setupFromObjectLayers(this.map);

        // Setup tile animations
        this.tileAnimationManager = new TileAnimationManager();
        this.tileAnimationManager.setup(this.map, tilesetKeys);
    }

    private getResult(): MapLoadResult {
        return {
            map: this.map!,
            lightingManager: this.lightingManager!
        };
    }

    getMap(): Phaser.Tilemaps.Tilemap | undefined {
        return this.map;
    }

    getLightingManager(): LightingManager | undefined {
        return this.lightingManager;
    }

    getTileAnimationManager(): TileAnimationManager | undefined {
        return this.tileAnimationManager;
    }

    /**
     * Update tile animations
     */
    update(delta: number) {
        this.tileAnimationManager?.update(delta);
    }

    destroy() {
        this.lightingManager?.destroy();
    }
}
