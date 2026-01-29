/**
 * MAIN GAME ENTRY
 * Orchestrates map loading, physics, player, occlusion, and debug systems
 * using modular components.
 * Guppy Labs 2026
 */

import Phaser from 'phaser';
import { CameraController } from '../camera/CameraController';
import { MapLoader } from '../map/MapLoader';
import { CollisionManager } from '../map/CollisionManager';
import { OcclusionManager } from '../map/OcclusionManager';
import { PlayerController } from '../player/PlayerController';
import { RemotePlayerManager } from '../player/RemotePlayerManager';
import { DebugOverlay } from '../debug/DebugOverlay';
import { DustParticleSystem } from '../fx/DustParticleSystem';
import { FireParticleSystem } from '../fx/FireParticleSystem';
import { LightingManager } from '../fx/LightingManager';
import { WorldTimeManager } from '../time/WorldTimeManager';
import { Toast } from '../../ui/Toast';
import { IInstanceInfo } from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';
import { hideLoader } from '../index';

interface GameSceneData {
    instance: IInstanceInfo;
}

export class GameScene extends Phaser.Scene {
    private instanceInfo?: IInstanceInfo;
    private networkManager = NetworkManager.getInstance();
    private worldTimeManager = WorldTimeManager.getInstance();

    // Managers
    private mapLoader?: MapLoader;
    private collisionManager?: CollisionManager;
    private occlusionManager?: OcclusionManager;
    private playerController?: PlayerController;
    private cameraController?: CameraController;
    private remotePlayerManager?: RemotePlayerManager;
    private debugOverlay?: DebugOverlay;
    private dustParticles?: DustParticleSystem;
    private lightingManager?: LightingManager;
    private fires: FireParticleSystem[] = [];

    // Constants
    private readonly groundLayerNames = new Set(['Ground', 'Water']);
    private readonly occludableBaseDepth = 200;
    private readonly playerFrontDepth = 260;
    private readonly playerOccludedDepthOffset = 20;

    constructor() {
        super('GameScene');
    }

    init(data: GameSceneData) {
        this.instanceInfo = data.instance;
        console.log('[GameScene] Received instance:', this.instanceInfo);
    }

    preload() {
        const mapFile = this.instanceInfo?.mapFile || 'limbo.tmj';
        
        // Initialize map loader and preload map
        this.mapLoader = new MapLoader(this, {
            groundLayerNames: this.groundLayerNames,
            occludableBaseDepth: this.occludableBaseDepth,
            playerFrontDepth: this.playerFrontDepth
        });
        this.mapLoader.preloadMap(mapFile);

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
        
        // Launch UI Scene
        this.scene.launch('UIScene');
        const uiScene = this.scene.get('UIScene');
        
        this.debugOverlay = new DebugOverlay(this, uiScene);
        this.setupDebugToggle();

        // Show instance connection status
        this.showConnectionStatus();

        // Load the map
        const mapFile = this.instanceInfo?.mapFile || 'limbo.tmj';
        const mapKey = `map-${mapFile.replace('.tmj', '')}`;
        
        this.mapLoader?.loadMap(mapKey, this.collisionManager, this.occlusionManager, (result) => {
            this.lightingManager = result.lightingManager;
            this.onMapLoaded(result.map);
        });
    }

    private setupDebugToggle() {
        this.input.keyboard?.on('keydown-H', () => {
            const shiftDown = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)?.isDown ?? false;
            this.debugOverlay?.toggle(shiftDown);
        });
    }

    private showConnectionStatus() {
        if (this.instanceInfo?.instanceId === 'local') {
            Toast.info('Could not Connect to Game Server (Offline Mode)', 4000);
        } else if (this.networkManager.isConnected()) {
            Toast.success(`Joined ${this.instanceInfo?.locationId || 'world'}`, 3000);
        }
    }

    private onMapLoaded(map: Phaser.Tilemaps.Tilemap) {
        // Spawn player
        const player = this.playerController?.spawn(map);
        if (player) {
            this.lightingManager?.enableLightingOn(player);

            if (this.cameraController) {
                this.cameraController.destroy();
            }
            this.cameraController = new CameraController(this, map, player, { zoom: 2 });

            // Initialize dust particle system for player
            this.dustParticles = new DustParticleSystem(this, player, map);
        }

        // Create fire effects from POI points in the map
        this.setupFireEffects(map);

        // Initial occlusion update
        if (player) {
            this.occlusionManager?.update(player);
        }

        // Setup multiplayer and world time
        this.setupMultiplayer();
        this.worldTimeManager.initialize();

        // Map is fully loaded - hide the loader and show mobile controls
        hideLoader();
        this.playerController?.getMobileControls()?.show();
    }

    private setupFireEffects(map: Phaser.Tilemaps.Tilemap) {
        if (!this.lightingManager) return;
        
        this.fires = FireParticleSystem.createFromMap(this, map, this.playerFrontDepth - 10);
        this.fires.forEach(fire => {
            fire.setupLight(this.lightingManager!, 120, 1.5);
        });
    }

    private setupMultiplayer() {
        this.remotePlayerManager = new RemotePlayerManager(this, {
            playerFrontDepth: this.playerFrontDepth,
            occlusionManager: this.occlusionManager,
            lightingManager: this.lightingManager
        });
        this.remotePlayerManager.initialize();
    }

    update(_time: number, delta: number) {
        // Update map (tile animations)
        this.mapLoader?.update(delta);

        // Update player movement
        this.playerController?.update(delta);

        // Enforce containment zones
        const player = this.playerController?.getPlayer();
        if (player && this.collisionManager) {
            this.collisionManager.enforceContainment(player);
        }

        // Update dust particles
        this.dustParticles?.update();

        // Update world time and lighting
        this.worldTimeManager.update(delta);
        const worldTime = this.worldTimeManager.getTime();
        this.lightingManager?.updateFromWorldTime(worldTime);

        // Update occlusion
        if (player) {
            this.occlusionManager?.update(player);
        }

        // Update fire effects
        if (this.occlusionManager) {
            this.fires.forEach(fire => {
                fire.updateOcclusion(this.occlusionManager!);
                fire.updateLight(delta);
            });
        }

        // Update remote players
        this.remotePlayerManager?.update();

        // Update debug overlay
        if (this.debugOverlay?.isEnabled()) {
            this.debugOverlay.draw(
                this.collisionManager?.getBodies() || [],
                this.occlusionManager?.getRegions() || [],
                this.playerController?.getSpawnPoint(),
                player,
                worldTime
            );
        }
    }
    
    shutdown() {
        this.remotePlayerManager?.destroy();
        this.fires.forEach(fire => fire.destroy());
        this.fires = [];
        this.mapLoader?.destroy();
        this.playerController?.destroy();
    }
}
