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
import { DebugOverlay, ExtendedDebugInfo } from '../debug/DebugOverlay';
import { DustParticleSystem } from '../fx/DustParticleSystem';
import { FireParticleSystem } from '../fx/FireParticleSystem';
import { WaterSystem } from '../fx/water/WaterSystem';
import { LightingManager } from '../fx/LightingManager';
import { VisualEffectsManager } from '../fx/VisualEffectsManager';
import { SeasonalEffectsManager } from '../fx/SeasonalEffectsManager';
import { WorldTimeManager } from '../time/WorldTimeManager';
import { AudioManager } from '../audio/AudioManager';
import { Toast } from '../../ui/Toast';
import { DisconnectModal } from '../../ui/DisconnectModal';
import { AfkModal } from '../../ui/AfkModal';
import { LimboModal } from '../../ui/LimboModal';
import { IInstanceInfo } from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';
import { hideLoader, currentUser } from '../index';

interface GameSceneData {
    instance: IInstanceInfo;
}

export class GameScene extends Phaser.Scene {
    private instanceInfo?: IInstanceInfo;
    private networkManager = NetworkManager.getInstance();
    private worldTimeManager = WorldTimeManager.getInstance();
    private unsubscribeDisconnect?: () => void;

    // Managers
    private mapLoader?: MapLoader;
    private collisionManager?: CollisionManager;
    private occlusionManager?: OcclusionManager;
    private playerController?: PlayerController;
    private cameraController?: CameraController;
    private remotePlayerManager?: RemotePlayerManager;
    private debugOverlay?: DebugOverlay;
    private dustParticles?: DustParticleSystem;
    private waterSystem?: WaterSystem;
    private lightingManager?: LightingManager;
    private visualEffectsManager?: VisualEffectsManager;
    private seasonalEffectsManager?: SeasonalEffectsManager;
    private audioManager?: AudioManager;
    private fires: FireParticleSystem[] = [];
    private lastTablistSnapshot = '';

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

        // Initialize audio manager and preload audio assets
        this.audioManager = new AudioManager(this);
        this.audioManager.preload();
    }

    create() {
        this.cameras.main.setBackgroundColor('#121212');

        // Allow other systems to stop audio (e.g., disconnect/AFK)
        this.events.on('stop-audio', this.stopAllAudio, this);

        // Initialize managers
        this.collisionManager = new CollisionManager(this);
        this.occlusionManager = new OcclusionManager(this.playerFrontDepth, this.playerOccludedDepthOffset);
        this.playerController?.setOcclusionManager(this.occlusionManager);
        
        // Initialize visual effects (Post-processing)
        this.visualEffectsManager = new VisualEffectsManager(this);
        
        // Initialize seasonal effects (weather particles + color tints)
        this.seasonalEffectsManager = new SeasonalEffectsManager(this);

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
            this.onMapLoaded(result.map, result.groundLayers);
        });
    }

    private setupDebugToggle() {
        this.input.keyboard?.on('keydown-H', () => {
            // Ignore if chat is focused
            if (this.registry.get('chatFocused') === true) return;
            if (this.registry.get('guiOpen') === true) return;
            
            const shiftDown = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)?.isDown ?? false;
            this.debugOverlay?.toggle(shiftDown);
        });

        // Add toggle for visual effects (key 'V')
        this.input.keyboard?.on('keydown-V', () => {
            if (this.registry.get('chatFocused') === true) return;
            if (this.registry.get('guiOpen') === true) return;
            
            const enabled = !this.registry.get('visualEffectsEnabled');
            this.registry.set('visualEffectsEnabled', enabled);
            this.visualEffectsManager?.setAllEffectsEnabled(enabled);
            Toast.info(`Visual Effects: ${enabled ? 'ON' : 'OFF'}`, 2000);
        });
        
        // Add toggle for seasonal effects (key 'P')
        this.input.keyboard?.on('keydown-P', () => {
            if (this.registry.get('chatFocused') === true) return;
            if (this.registry.get('guiOpen') === true) return;
            
            const enabled = !this.registry.get('seasonalEffectsEnabled');
            this.registry.set('seasonalEffectsEnabled', enabled);
            this.seasonalEffectsManager?.setEnabled(enabled);
            Toast.info(`Seasonal Effects: ${enabled ? 'ON' : 'OFF'}`, 2000);
        });
        
        // Default to enabled
        this.registry.set('visualEffectsEnabled', true);
        this.registry.set('seasonalEffectsEnabled', true);
    }

    private showConnectionStatus() {
        if (this.instanceInfo?.instanceId === 'local') {
            Toast.info('Could not Connect to Game Server (Offline Mode)', 4000);
        } else if (this.networkManager.isConnected()) {
            Toast.success(`Joined ${this.instanceInfo?.locationId || 'world'}`, 3000);
        }
    }

    private onMapLoaded(map: Phaser.Tilemaps.Tilemap, groundLayers: Phaser.Tilemaps.TilemapLayer[]) {
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

            // Initialize water system (splash, footprints, depth effects)
            this.waterSystem = new WaterSystem(this, player, groundLayers);
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
        
        // Initialize seasonal effects with current season
        this.seasonalEffectsManager?.initialize();
        this.seasonalEffectsManager?.setInitialSeason(this.worldTimeManager.getTime().season);

        // Initialize audio (music and ambient sounds for this map)
        const mapFile = this.instanceInfo?.mapFile || 'limbo.tmj';
        const mapKey = `map-${mapFile.replace('.tmj', '')}`;
        this.audioManager?.initialize(mapKey);

        // Map is fully loaded - hide the loader and show mobile controls
        hideLoader();
        this.playerController?.getMobileControls()?.show();

        // If AFK flag is set and we're in limbo, show AFK modal
        if (this.instanceInfo?.locationId === 'limbo' && localStorage.getItem('cfwk_afk') === 'true') {
            localStorage.removeItem('cfwk_afk');
            AfkModal.show(
                () => {
                    // Close only
                },
                () => {
                    DisconnectModal.clearDisconnectedFlag();
                    this.scene.stop('UIScene');
                    this.scene.start('BootScene');
                }
            );
        }

        if (this.instanceInfo?.locationId === 'limbo') {
            const reason = localStorage.getItem('cfwk_limbo_reason');
            const message = localStorage.getItem('cfwk_limbo_message') || '';
            if (reason) {
                localStorage.removeItem('cfwk_limbo_reason');
                localStorage.removeItem('cfwk_limbo_message');

                const isBan = reason === 'ban';
                const isAdmin = reason === 'admin';
                
                let title: string;
                let displayMessage: string;
                let showRejoin: boolean;
                
                if (isBan) {
                    title = 'BANNED';
                    displayMessage = message || 'You have been banned from Cute Fish With Knives.';
                    showRejoin = false;
                } else if (isAdmin) {
                    title = 'Sent to Limbo';
                    displayMessage = message || 'You were sent to limbo by an admin.';
                    showRejoin = true;
                } else {
                    title = 'Server Offline';
                    displayMessage = message || 'The connection to the game server was lost.<br>Please try again later.';
                    showRejoin = true;
                }

                LimboModal.show(title, displayMessage, {
                    showRejoin,
                    onClose: () => {
                        // Close only
                    },
                    onRejoin: () => {
                        this.scene.stop('UIScene');
                        this.scene.start('BootScene');
                    }
                });
            }
        }
    }

    private setupFireEffects(map: Phaser.Tilemaps.Tilemap) {
        if (!this.lightingManager) return;
        
        this.fires = FireParticleSystem.createFromMap(this, map, this.playerFrontDepth - 10);
        this.fires.forEach(fire => {
            fire.setupLight(this.lightingManager!, 120, 1.5);
        });
        
        // Register fire positions with audio manager for distance-based volume
        const firePositions = this.fires.map(fire => fire.getPosition());
        this.audioManager?.setFirePositions(firePositions);
    }

    private setupMultiplayer() {
        this.remotePlayerManager = new RemotePlayerManager(this, {
            playerFrontDepth: this.playerFrontDepth,
            occlusionManager: this.occlusionManager,
            lightingManager: this.lightingManager
        });
        this.remotePlayerManager.initialize();

        // Connect remote player manager to player controller for interaction detection
        if (this.playerController && this.remotePlayerManager) {
            this.playerController.setRemotePlayerManager(this.remotePlayerManager);
        }

        // Listen for chat messages (relayed from UIScene) for chat bubbles
        this.game.events.on('chat-message', this.handleChatMessage, this);
        
        // Listen for shove events from server
        this.setupShoveListener();
        this.setupShoveAttemptListener();
        
        // Listen for server disconnection
        this.unsubscribeDisconnect = this.networkManager.onDisconnect((code) => {
            console.log(`[GameScene] Server disconnected with code: ${code}`);
            this.stopAllAudio();
            const afkFlag = localStorage.getItem('cfwk_afk') === 'true';
            if (!afkFlag) {
                const error = this.networkManager.getConnectionError();
                if (code === 4003) {
                    localStorage.setItem('cfwk_limbo_reason', 'ban');
                    localStorage.setItem('cfwk_limbo_message', 'You have been banned from Cute Fish With Knives.');
                } else if (code === 4004) {
                    localStorage.setItem('cfwk_limbo_reason', 'admin');
                    localStorage.setItem('cfwk_limbo_message', 'You were sent to limbo by an admin.');
                } else {
                    const detail = error ? ` (${error})` : ` (code ${code})`;
                    localStorage.setItem('cfwk_limbo_reason', 'offline');
                    localStorage.setItem('cfwk_limbo_message', `The connection to the game server was lost${detail}.<br>Please try again later.`);
                }
            }

            this.scene.stop('UIScene');
            this.scene.start('BootScene');
        });
        
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
             this.game.events.off('chat-message', this.handleChatMessage, this);
             this.unsubscribeDisconnect?.();
             this.events.off('stop-audio', this.stopAllAudio, this);
        });
    }

    private stopAllAudio() {
        this.audioManager?.destroy();
    }

    private handleChatMessage(data: { sessionId: string; message: string }) {
        const mySessionId = this.networkManager.getSessionId();
        if (data.sessionId === mySessionId) {
            this.playerController?.showChat(data.message);
        } else {
            this.remotePlayerManager?.showChat(data.sessionId, data.message);
        }
    }

    /**
     * Setup listener for shove events from server
     */
    private setupShoveListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.onMessage("shove", (data: {
            attackerSessionId: string;
            targetSessionId: string;
            targetForceX: number;
            targetForceY: number;
            attackerForceX: number;
            attackerForceY: number;
        }) => {
            const mySessionId = this.networkManager.getSessionId();
            const player = this.playerController?.getPlayer();
            
            if (!player) return;

            // Apply force if we're the target
            if (data.targetSessionId === mySessionId) {
                this.applyShoveForce(player, data.targetForceX, data.targetForceY);
                this.playerController?.playInteractAnimation();
                console.log('[GameScene] We got shoved!');
            } else {
                const remoteTarget = this.remotePlayerManager?.getPlayers().get(data.targetSessionId);
                remoteTarget?.playInteractAnimation();
            }
            
            // Apply counter-force if we're the attacker
            if (data.attackerSessionId === mySessionId) {
                this.applyShoveForce(player, data.attackerForceX, data.attackerForceY);
                console.log('[GameScene] We shoved someone!');
            }
        });
    }

    /**
     * Setup listener for shove attempts (play animation even on miss)
     */
    private setupShoveAttemptListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.onMessage("shoveAttempt", (data: {
            attackerSessionId: string;
            targetSessionId: string;
        }) => {
            const mySessionId = this.networkManager.getSessionId();

            if (data.attackerSessionId === mySessionId) {
                // Local player already plays animation on input
                return;
            }

            const remoteAttacker = this.remotePlayerManager?.getPlayers().get(data.attackerSessionId);
            remoteAttacker?.playInteractAnimation();
        });
    }

    /**
     * Apply a shove force to a physics sprite
     */
    private applyShoveForce(sprite: Phaser.Physics.Matter.Sprite, forceX: number, forceY: number) {
        // Matter.js uses setVelocity for impulse-like behavior
        // We add to existing velocity for more natural feel
        const body = sprite.body as MatterJS.BodyType;
        if (!body) return;
        
        const currentVx = body.velocity.x || 0;
        const currentVy = body.velocity.y || 0;
        
        // Apply as a velocity impulse (scaled down since force values are in pixels)
        const impulseScale = 0.05; // Tune this for feel
        sprite.setVelocity(
            currentVx + forceX * impulseScale,
            currentVy + forceY * impulseScale
        );
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
        
        // Update camera zoom based on player feet line segment
        if (player && this.cameraController) {
            const bottomLeft = player.getBottomLeft();
            const bottomRight = player.getBottomRight();
            this.cameraController.update(bottomLeft.x, bottomRight.x, bottomLeft.y);
        }

        // Update dust particles
        this.dustParticles?.update();

        // Update water system (splash, footprints, depth effects)
        this.waterSystem?.update(delta);
        
        // Apply water effects to player
        if (this.playerController && this.waterSystem) {
            this.playerController.setSpeedMultiplier(this.waterSystem.getSpeedMultiplier());
            // Hide shadow when player is in water
            this.playerController.setShadowVisible(!this.waterSystem.getIsInWater());
        }

        // Update footstep sounds based on player movement and water state
        if (this.playerController) {
            const isMoving = this.playerController.getIsMoving();
            const isSprinting = this.playerController.getIsSprinting();
            const inWater = this.waterSystem?.getIsInWater() ?? false;
            const isWet = this.waterSystem?.getIsWet() ?? false;
            const waterDepth = this.waterSystem?.getDepth() ?? 0;
            this.audioManager?.updateFootsteps(isMoving, isSprinting, inWater, isWet, waterDepth);
        }
        
        // Update fire volume based on player distance to nearest fire
        if (player && this.audioManager) {
            this.audioManager.updateFireVolume(player.x, player.y);
        }

        // Update world time and lighting
        this.worldTimeManager.update(delta);
        const worldTime = this.worldTimeManager.getTime();
        this.lightingManager?.updateFromWorldTime(worldTime);
        
        // Update seasonal effects (particles + color tints)
        const playerVel = (player?.body as any)?.velocity || { x: 0, y: 0 };
        this.seasonalEffectsManager?.update(worldTime, delta, playerVel);

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

        // Update tablist registry
        this.updateTablistRegistry();

        // Update debug overlay
        if (this.debugOverlay?.isEnabled()) {
            // Gather extended debug info
            const extendedDebug: ExtendedDebugInfo = {
                // Camera
                cameraZoom: this.cameraController?.getCurrentZoom(),
                targetZoom: this.cameraController?.getTargetZoom(),
                zoomRegions: this.cameraController?.getZoomRegions(),
                
                // Player
                playerX: player?.x,
                playerY: player?.y,
                playerVelX: (player?.body as MatterJS.BodyType)?.velocity?.x,
                playerVelY: (player?.body as MatterJS.BodyType)?.velocity?.y,
                playerDepth: player?.depth,
                isMoving: this.playerController?.getIsMoving(),
                isSprinting: this.playerController?.getIsSprinting(),
                stamina: this.playerController?.getStamina(),
                
                // Fire POIs
                firePositions: this.fires.map(f => f.getPosition()),
                
                // Network
                isConnected: this.networkManager.isConnected(),
                remotePlayerCount: this.remotePlayerManager?.getPlayers().size,
                instanceId: this.instanceInfo?.instanceId,
                
                // Performance
                fps: this.game.loop.actualFps,
                
                // Generated border
                generatedBorder: this.collisionManager?.getGeneratedBorderPolygon(),
            };
            
            this.debugOverlay.draw(
                this.collisionManager?.getBodies() || [],
                this.occlusionManager?.getRegions() || [],
                this.playerController?.getSpawnPoint(),
                player,
                worldTime,
                this.waterSystem?.getDebugInfo(),
                extendedDebug
            );
        }
    }

    private updateTablistRegistry() {
        const localName = currentUser?.username || 'Guest';
        const entries = [{ name: localName, isLocal: true }];

        if (this.remotePlayerManager) {
            const remotes = Array.from(this.remotePlayerManager.getPlayers().values());
            remotes.forEach((remote) => {
                entries.push({ name: remote.getUsername(), isLocal: false });
            });
        }

        const snapshot = entries.map(e => `${e.isLocal ? '1' : '0'}:${e.name}`).join('|');
        if (snapshot === this.lastTablistSnapshot) return;

        this.lastTablistSnapshot = snapshot;
        this.registry.set('tablistPlayers', entries);
    }
    
    shutdown() {
        this.audioManager?.destroy();
        this.remotePlayerManager?.destroy();
        this.fires.forEach(fire => fire.destroy());
        this.fires = [];
        this.waterSystem?.destroy();
        this.seasonalEffectsManager?.destroy();
        this.mapLoader?.destroy();
        this.playerController?.destroy();
    }
}
