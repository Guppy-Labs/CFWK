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
import { RemotePlayer } from '../player/RemotePlayer';
import { DebugOverlay } from '../debug/DebugOverlay';
import { VisualEffectsManager } from '../fx/VisualEffectsManager';
import { DustParticleSystem } from '../fx/DustParticleSystem';
import { Toast } from '../../ui/Toast';
import { IInstanceInfo } from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';

interface GameSceneData {
    instance: IInstanceInfo;
}

export class GameScene extends Phaser.Scene {
    private map?: Phaser.Tilemaps.Tilemap;
    private instanceInfo?: IInstanceInfo;
    private networkManager = NetworkManager.getInstance();

    // Managers
    private collisionManager?: CollisionManager;
    private occlusionManager?: OcclusionManager;
    private tileAnimationManager?: TileAnimationManager;
    private playerController?: PlayerController;
    private cameraController?: CameraController;
    private debugOverlay?: DebugOverlay;
    private visualEffects?: VisualEffectsManager;
    private dustParticles?: DustParticleSystem;

    // Remote players
    private remotePlayers: Map<string, RemotePlayer> = new Map();

    // Constants
    private readonly groundLayerNames = new Set(['Ground', 'Water']);
    private readonly occludableBaseDepth = 200;
    private readonly playerFrontDepth = 260;
    private readonly playerOccludedDepthOffset = 20;

    constructor() {
        super('GameScene');
    }

    init(data: GameSceneData) {
        // Receive instance info from BootScene
        this.instanceInfo = data.instance;
        console.log('[GameScene] Received instance:', this.instanceInfo);
    }

    preload() {
        // Determine which map to load from instance info
        const mapFile = this.instanceInfo?.mapFile || 'limbo.tmj';
        const mapKey = `map-${mapFile.replace('.tmj', '')}`;
        
        this.load.tilemapTiledJSON(mapKey, `/maps/${mapFile}`);

        // Initialize player controller early so it can preload assets
        this.playerController = new PlayerController(this, {
            speed: 1.6,
            sprintSpeed: 2.4,
            accel: 0.10,
            drag: 0.7,
            width: 16,
            height: 32,
            depth: this.playerFrontDepth
        });
        this.playerController.preload();
    }

    create() {
        this.cameras.main.setBackgroundColor('#121212');

        // Initialize managers
        this.collisionManager = new CollisionManager(this);
        this.occlusionManager = new OcclusionManager(this.playerFrontDepth, this.playerOccludedDepthOffset);
        this.tileAnimationManager = new TileAnimationManager();
        
        // Launch UI Scene
        this.scene.launch('UIScene');
        
        // PlayerController was initialized in preload
        this.debugOverlay = new DebugOverlay(this);

        // Setup debug toggle
        this.input.keyboard?.on('keydown-H', () => {
            this.debugOverlay?.toggle();
        });

        // Load map from instance info
        const mapFile = this.instanceInfo?.mapFile || 'limbo.tmj';
        const mapKey = `map-${mapFile.replace('.tmj', '')}`;
        
        const mapCache = this.cache.tilemap.get(mapKey);
        const mapData = mapCache?.data as { tilesets?: TiledTilesetData[] } | undefined;
        this.map = this.make.tilemap({ key: mapKey });

        // Show instance connection status
        if (this.instanceInfo?.instanceId === 'local') {
            Toast.info('Could not Connect to Game Server (Offline Mode)', 4000);
        } else if (this.networkManager.isConnected()) {
            Toast.success(`Joined ${this.instanceInfo?.locationId || 'world'}`, 3000);
        }
        
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
        this.occlusionManager?.setupFromObjectLayers(this.map);
        this.tileAnimationManager?.setup(this.map, tilesetKeys);

        // Spawn player
        const player = this.playerController?.spawn(this.map);
        if (player && this.map) {
            if (this.cameraController) {
                this.cameraController.destroy();
            }
            this.cameraController = new CameraController(this, this.map, player, { zoom: 2 });

            // Initialize dust particle system for player
            this.dustParticles = new DustParticleSystem(this, player, this.map);
        }

        // Initialize visual effects (must be after camera is set up)
        this.visualEffects = new VisualEffectsManager(this);

        // Initial occlusion update
        if (player) {
            this.occlusionManager?.update(player);
        }

        // Setup multiplayer state listeners
        this.setupMultiplayer();
    }

    /**
     * Setup listeners for multiplayer state changes
     */
    private setupMultiplayer() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        const mySessionId = this.networkManager.getSessionId();
        
        // Track whether initial state sync is complete
        // Players added during initial sync were already in the room - no spawn effect
        let initialSyncComplete = false;
        this.time.delayedCall(500, () => {
            initialSyncComplete = true;
        });

        // Listen for player state changes
        room.state.players.onAdd((player: any, sessionId: string) => {
            // Skip local player
            if (sessionId === mySessionId) return;

            console.log(`[GameScene] Remote player joined: ${sessionId} (${player.username}) - initial: ${!initialSyncComplete}`);
            
            const remotePlayer = new RemotePlayer(this, {
                sessionId,
                username: player.username || 'Guest',
                odcid: player.odcid || sessionId,
                x: player.x,
                y: player.y,
                direction: player.direction || 0,
                depth: this.playerFrontDepth,
                occlusionManager: this.occlusionManager,
                skipSpawnEffect: !initialSyncComplete // Skip effect for existing players
            });
            
            this.remotePlayers.set(sessionId, remotePlayer);

            // Listen for position changes
            player.onChange(() => {
                const remote = this.remotePlayers.get(sessionId);
                if (remote) {
                    remote.setPosition(player.x, player.y);
                    remote.setAnimation(player.anim || 'idle', player.direction || 0);
                }
            });
        });

        room.state.players.onRemove((_player: any, sessionId: string) => {
            console.log(`[GameScene] Remote player left: ${sessionId}`);
            const remotePlayer = this.remotePlayers.get(sessionId);
            if (remotePlayer) {
                // Start despawn effect, then remove from map when complete
                remotePlayer.startDespawnEffect(() => {
                    remotePlayer.destroy();
                    this.remotePlayers.delete(sessionId);
                });
            }
        });
    }

    update(_time: number, delta: number) {
        // Update tile animations
        this.tileAnimationManager?.update(delta);

        // Update player movement
        this.playerController?.update(delta);

        // Update dust particles
        this.dustParticles?.update();

        // Update occlusion
        const player = this.playerController?.getPlayer();
        if (player) {
            this.occlusionManager?.update(player);
        }

        // Update remote players (position interpolation)
        this.remotePlayers.forEach(remote => remote.update());

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
    
    shutdown() {
        // Clean up remote players
        this.remotePlayers.forEach(remote => remote.destroy());
        this.remotePlayers.clear();
        
        // Clean up player controller (including mobile controls)
        this.playerController?.destroy();
    }
}
