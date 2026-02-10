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
import { MCPlayerController } from '../player/MCPlayerController';
import { CharacterService } from '../player/CharacterService';
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
import { DroppedItemManager } from '../items/DroppedItemManager';
import { Toast } from '../../ui/Toast';
import { DisconnectModal } from '../../ui/DisconnectModal';
import { AfkModal } from '../../ui/AfkModal';
import { LimboModal } from '../../ui/LimboModal';
import { IInstanceInfo, ICharacterAppearance, DEFAULT_CHARACTER_APPEARANCE } from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';
import { hideLoader, setLoaderText, currentUser } from '../index';
import { SharedMCTextures } from '../player/SharedMCTextures';

interface GameSceneData {
    instance: IInstanceInfo;
}

export class GameScene extends Phaser.Scene {
    private instanceInfo?: IInstanceInfo;
    private networkManager = NetworkManager.getInstance();
    private worldTimeManager = WorldTimeManager.getInstance();
    private characterService = CharacterService.getInstance();
    private unsubscribeDisconnect?: () => void;
    private inventoryUpdateHandler?: (event: Event) => void;
    private isFishingTransition = false;
    private fishingFadeTimer?: Phaser.Time.TimerEvent;

    // Managers
    private mapLoader?: MapLoader;
    private collisionManager?: CollisionManager;
    private occlusionManager?: OcclusionManager;
    private mcPlayerController?: MCPlayerController;
    private cameraController?: CameraController;
    private remotePlayerManager?: RemotePlayerManager;
    private droppedItemManager?: DroppedItemManager;
    private debugOverlay?: DebugOverlay;
    private dustParticles?: DustParticleSystem;
    private waterSystem?: WaterSystem;
    private lightingManager?: LightingManager;
    private visualEffectsManager?: VisualEffectsManager;
    private seasonalEffectsManager?: SeasonalEffectsManager;
    private audioManager?: AudioManager;
    private groundLayers?: Phaser.Tilemaps.TilemapLayer[];
    private fires: FireParticleSystem[] = [];
    private lastTablistSnapshot = '';
    
    // Character appearance (fetched async)
    private characterAppearance: ICharacterAppearance = DEFAULT_CHARACTER_APPEARANCE;

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

        this.load.image('ui-joystick-base', '/ui/Joystick01a.png');
        this.load.image('ui-joystick-handle', '/ui/Handle01a.png');
        
        // Initialize map loader and preload map
        this.mapLoader = new MapLoader(this, {
            groundLayerNames: this.groundLayerNames,
            occludableBaseDepth: this.occludableBaseDepth,
            playerFrontDepth: this.playerFrontDepth
        });
        this.mapLoader.preloadMap(mapFile);

        // MC character doesn't need traditional preload - assets are composited at runtime
        this.mcPlayerController = new MCPlayerController(this, {
            speed: 1.6,
            sprintSpeed: 2.4,
            accel: 0.10,
            drag: 0.7,
            depth: this.playerFrontDepth
        });

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
        
        this.mcPlayerController?.setOcclusionManager(this.occlusionManager);
        this.mcPlayerController?.setOnFishingStart((rodItemId) => {
            this.startFishingTransition(rodItemId);
        });
        
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

        // If using MC character, we need to:
        // 1. Fetch character appearance
        // 2. Initialize MC controller (composites sprites)
        // 3. Then load the map
        this.initializeMCCharacterAndLoadMap();
    }

    /**
     * Initialize MC character with appearance data, then load the map
     */
    private async initializeMCCharacterAndLoadMap() {
        try {
            // Update loader text
            setLoaderText('Loading character...');
            
            // Fetch character appearance from server
            this.characterAppearance = await this.characterService.fetchAppearance();
            console.log('[GameScene] Character appearance loaded:', this.characterAppearance);
            
            // Initialize MC controller (this composites all the sprite layers)
            setLoaderText('Preparing character...');
            await this.mcPlayerController?.initialize(this.characterAppearance);
            console.log('[GameScene] MC character initialized');
            
            // Initialize shared MC textures for remote players
            setLoaderText('Preparing world...');
            await SharedMCTextures.getInstance().initialize(this);
            console.log('[GameScene] Shared MC textures initialized for remote players');
            
            // Now load the map
            setLoaderText('Loading world...');
            this.loadMapLegacy();
        } catch (error) {
            console.error('[GameScene] Error initializing MC character:', error);
            Toast.error('Failed to load character, using default');
            
            // Fall back to default appearance
            this.characterAppearance = DEFAULT_CHARACTER_APPEARANCE;
            await this.mcPlayerController?.initialize(this.characterAppearance);
            await SharedMCTextures.getInstance().initialize(this);
            this.loadMapLegacy();
        }
    }

    /**
     * Load the map (shared between MC and legacy paths)
     */
    private loadMapLegacy() {
        const mapFile = this.instanceInfo?.mapFile || 'limbo.tmj';
        const mapKey = `map-${mapFile.replace('.tmj', '')}`;
        
        if (!this.collisionManager || !this.occlusionManager) {
            console.error('[GameScene] Collision or occlusion manager not initialized');
            return;
        }
        
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
        
        // Meow sound (key 'Z')
        this.input.keyboard?.on('keydown-Z', () => {
            if (this.registry.get('chatFocused') === true) return;
            if (this.registry.get('guiOpen') === true) return;
            
            this.audioManager?.playMeow();
        });
        
        // Default to enabled
        this.registry.set('visualEffectsEnabled', true);
        this.registry.set('seasonalEffectsEnabled', true);
    }

    private showConnectionStatus() {
        // Intentionally no-op: connection toasts removed to reduce UI clutter.
    }

    /**
     * Get the active player sprite
     */
    private getActivePlayer(): Phaser.Physics.Matter.Sprite | undefined {
        return this.mcPlayerController?.getPlayer();
    }

    getAudioManager(): AudioManager | undefined {
        return this.audioManager;
    }

    updateAfkOnly(delta: number) {
        this.mcPlayerController?.updateAfkOnly(delta);
    }

    private onMapLoaded(map: Phaser.Tilemaps.Tilemap, groundLayers: Phaser.Tilemaps.TilemapLayer[]) {
        this.groundLayers = groundLayers;
        // Spawn player using active controller
        let player: Phaser.Physics.Matter.Sprite | undefined;
        
        player = this.mcPlayerController?.spawn(map);
        
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

        // Map is fully loaded - hide the loader and show controls
        hideLoader();
        this.mcPlayerController?.getMobileControls()?.show();
        this.mcPlayerController?.getDesktopInteractButton()?.show();

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
            lightingManager: this.lightingManager,
            groundLayers: this.groundLayers
        });
        this.remotePlayerManager.initialize();

        this.droppedItemManager = new DroppedItemManager(this, {
            occlusionManager: this.occlusionManager,
            baseDepth: this.playerFrontDepth - 40
        });
        this.droppedItemManager.initialize();

        // Connect remote player manager to player controller for interaction detection
        const activeController = this.mcPlayerController;
        if (activeController && this.remotePlayerManager) {
            activeController.setRemotePlayerManager(this.remotePlayerManager);
        }
        if (activeController && this.droppedItemManager) {
            activeController.setDroppedItemManager(this.droppedItemManager);
        }

        // Listen for chat messages (relayed from UIScene) for chat bubbles
        this.game.events.on('chat-message', this.handleChatMessage, this);

        this.inventoryUpdateHandler = (event: Event) => {
            const customEvent = event as CustomEvent<{ equippedRodId?: string | null }>;
            const equippedRodId = customEvent.detail?.equippedRodId ?? null;
            this.mcPlayerController?.setEquippedRodId(equippedRodId);
        };
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
        this.networkManager.getInventory().then((data) => {
            if (data?.equippedRodId !== undefined) {
                this.mcPlayerController?.setEquippedRodId(data.equippedRodId ?? null);
            }
        });
        
        // Listen for shove events from server
        this.setupShoveListener();
        this.setupShoveAttemptListener();
        this.setupFishingListener();
        
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
             if (this.inventoryUpdateHandler) {
                 window.removeEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
             }
             this.events.off('stop-audio', this.stopAllAudio, this);
             this.events.off('fishing:stop', this.stopFishing, this);
        });

        this.events.on('fishing:stop', this.stopFishing, this);
    }

    private stopAllAudio() {
        this.audioManager?.destroy();
    }

    private handleChatMessage(data: { sessionId: string; message: string }) {
        const mySessionId = this.networkManager.getSessionId();
        if (data.sessionId === mySessionId) {
            this.mcPlayerController?.showChat(data.message);
        } else {
            this.remotePlayerManager?.showChat(data.sessionId, data.message);
        }
    }

    private startFishingTransition(rodItemId: string) {
        if (this.isFishingTransition) return;
        this.isFishingTransition = true;

        if (this.fishingFadeTimer) {
            this.fishingFadeTimer.remove(false);
        }

        this.fishingFadeTimer = this.time.delayedCall(2000, () => {
            this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
                this.scene.launch('FishingScene', { rodItemId });
                this.scene.pause();
            });
            this.cameras.main.fadeOut(500, 0, 0, 0);
        });
    }

    private stopFishing() {
        this.isFishingTransition = false;
        this.fishingFadeTimer?.remove(false);
        this.fishingFadeTimer = undefined;
        this.mcPlayerController?.setFishingActive(false);
        this.cameras.main.fadeIn(300, 0, 0, 0);
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
            const player = this.getActivePlayer();
            
            if (!player) return;

            // Apply force if we're the target
            if (data.targetSessionId === mySessionId) {
                this.applyShoveForce(player, data.targetForceX, data.targetForceY);
                this.mcPlayerController?.playInteractAnimation();
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

    private setupFishingListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.onMessage("fishing:start", (data: { sessionId: string; rodItemId: string | null }) => {
            if (!data?.rodItemId) return;
            const mySessionId = this.networkManager.getSessionId();
            if (data.sessionId === mySessionId) {
                return;
            }
            this.remotePlayerManager?.showFishingBubble(data.sessionId, data.rodItemId);
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
        const impulseScale = 0.03; // Reduced from 0.05 for gentler shove
        sprite.setVelocity(
            currentVx + forceX * impulseScale,
            currentVy + forceY * impulseScale
        );
        
        // Enforce containment immediately after shove to prevent going through walls
        if (this.collisionManager) {
            this.collisionManager.enforceContainment(sprite);
        }
    }

    update(_time: number, delta: number) {
        // Update map (tile animations)
        this.mapLoader?.update(delta);

        // Update player movement using active controller
        this.mcPlayerController?.update(delta);

        // Enforce containment zones
        const player = this.getActivePlayer();
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
        const nearWater = this.waterSystem?.isNearWater(0.5) ?? false;
        if (this.registry.get('nearWater') !== nearWater) {
            this.registry.set('nearWater', nearWater);
        }
        
        // Apply water effects to player
        const activeController = this.mcPlayerController;
        if (activeController && this.waterSystem) {
            activeController.setSpeedMultiplier(this.waterSystem.getSpeedMultiplier());
            // Hide shadow when player is in water
            activeController.setShadowVisible(!this.waterSystem.getIsInWater());
        }

        // Update footstep sounds based on player movement and water state
        if (activeController) {
            const isMoving = activeController.getIsMoving();
            const isSprinting = activeController.getIsSprinting();
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
        this.remotePlayerManager?.update(delta);

        // Update dropped item fade
        this.droppedItemManager?.update();

        // Update tablist registry
        this.updateTablistRegistry();

        // Update debug overlay
        if (this.debugOverlay?.isEnabled()) {
            const activeController = this.mcPlayerController;
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
                isMoving: activeController?.getIsMoving(),
                isSprinting: activeController?.getIsSprinting(),
                stamina: activeController?.getStamina(),
                
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
                activeController?.getSpawnPoint(),
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
        this.droppedItemManager?.destroy();
        this.fires.forEach(fire => fire.destroy());
        this.fires = [];
        this.waterSystem?.destroy();
        this.seasonalEffectsManager?.destroy();
        this.mapLoader?.destroy();
        this.mcPlayerController?.destroy();
    }
}
