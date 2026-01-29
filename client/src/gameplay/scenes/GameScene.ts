/**
 * MAIN GAME ENTRY
 * Orchestrates map loading, physics, player, occlusion, and debug systems
 * using modular components.
 * Guppy Labs 2026
 */

import Phaser from 'phaser';
import { CameraController } from '../camera/CameraController';
import { TilesetEntry, TiledTilesetData } from '../map/TiledTypes';
import { TileAnimationManager } from '../map/TileAnimationManager';
import { CollisionManager } from '../map/CollisionManager';
import { OcclusionManager } from '../map/OcclusionManager';
import { PlayerController } from '../player/PlayerController';
import { DebugOverlay } from '../debug/DebugOverlay';

export class GameScene extends Phaser.Scene {
    private map?: Phaser.Tilemaps.Tilemap;

    // Managers
    private collisionManager?: CollisionManager;
    private occlusionManager?: OcclusionManager;
    private tileAnimationManager?: TileAnimationManager;
    private playerController?: PlayerController;
    private cameraController?: CameraController;
    private debugOverlay?: DebugOverlay;

    // Constants
    private readonly groundLayerNames = new Set(['Ground', 'Water']);
    private readonly occludableBaseDepth = 200;
    private readonly playerFrontDepth = 260;
    private readonly playerOccludedDepthOffset = 20;

    constructor() {
        super('GameScene');
    }

    preload() {
        this.load.tilemapTiledJSON('default-map', '/maps/default.tmj');
        this.load.image('player-front', '/assets/char/cat-front-0.png');
    }

    create() {
        this.cameras.main.setBackgroundColor('#121212');

        // Initialize managers
        this.collisionManager = new CollisionManager(this);
        this.occlusionManager = new OcclusionManager(this.playerFrontDepth, this.playerOccludedDepthOffset);
        this.tileAnimationManager = new TileAnimationManager();
        this.playerController = new PlayerController(this, {
            speed: 2.2,
            accel: 0.18,
            drag: 0.7,
            width: 22,
            height: 44,
            textureKey: 'player-front',
            depth: this.playerFrontDepth
        });
        this.debugOverlay = new DebugOverlay(this);

        // Setup debug toggle
        this.input.keyboard?.on('keydown-H', () => {
            this.debugOverlay?.toggle();
        });

        // Load map and tilesets
        const mapCache = this.cache.tilemap.get('default-map');
        const mapData = mapCache?.data as { tilesets?: TiledTilesetData[] } | undefined;
        this.map = this.make.tilemap({ key: 'default-map' });
        const tilesets = mapData?.tilesets || [];
        const tilesetKeys: TilesetEntry[] = [];
        const toLoad: string[] = [];

        tilesets.forEach((tileset: TiledTilesetData) => {
            const key = `tileset-${tileset.name}`;
            if (!this.textures.exists(key) && tileset.image) {
                const url = encodeURI(`/maps/${tileset.image}`);
                this.load.image(key, url);
                toLoad.push(key);
            }
            tilesetKeys.push({ tileset, key });
        });

        if (toLoad.length > 0) {
            this.load.once('complete', () => {
                this.buildMapLayers(tilesetKeys);
            });
            this.load.start();
        } else {
            this.buildMapLayers(tilesetKeys);
        }
    }

    private buildMapLayers(tilesetKeys: TilesetEntry[]) {
        if (!this.map) return;

        const phaserTilesets = tilesetKeys
            .map(({ tileset, key }) =>
                this.map!.addTilesetImage(tileset.name, key, tileset.tilewidth, tileset.tileheight, tileset.margin, tileset.spacing)
            )
            .filter((ts): ts is Phaser.Tilemaps.Tileset => ts !== null);

        let groundDepthIndex = 0;
        let occludableDepthIndex = 0;

        this.map.layers.forEach((layerData) => {
            const layer = this.map!.createLayer(layerData.name, phaserTilesets, 0, 0);
            if (!layer) return;

            if (this.groundLayerNames.has(layerData.name)) {
                layer.setDepth(groundDepthIndex * 10);
                groundDepthIndex += 1;
            } else {
                const baseDepth = this.occludableBaseDepth + occludableDepthIndex * 10;
                layer.setDepth(baseDepth);

                // Register with occlusion manager
                this.occlusionManager?.addOccludableLayer(layer, baseDepth, layerData.name, occludableDepthIndex);
                occludableDepthIndex += 1;
            }
        });

        // Setup systems
        this.collisionManager?.setupFromObjectLayers(this.map);
        this.collisionManager?.setupWalkableBounds(this.map, 'Ground', 9);
        this.occlusionManager?.setupFromObjectLayers(this.map);
        this.tileAnimationManager?.setup(this.map, tilesetKeys);

        // Spawn player
        const player = this.playerController?.spawn(this.map);
        if (player && this.map) {
            if (this.cameraController) {
                this.cameraController.destroy();
            }
            this.cameraController = new CameraController(this, this.map, player, { zoom: 2 });
        }

        // Initial occlusion update
        if (player) {
            this.occlusionManager?.update(player);
        }
    }

    update(_time: number, delta: number) {
        // Update tile animations
        this.tileAnimationManager?.update(delta);

        // Update player movement
        this.playerController?.update();

        // Update occlusion
        const player = this.playerController?.getPlayer();
        if (player) {
            this.occlusionManager?.update(player);
        }

        // Update debug overlay
        if (this.debugOverlay?.isEnabled()) {
            this.debugOverlay.draw(
                this.collisionManager?.getBodies() || [],
                this.occlusionManager?.getRegions() || [],
                this.playerController?.getSpawnPoint(),
                player
            );
        }
    }
}
