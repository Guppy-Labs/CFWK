import Phaser from 'phaser';
import { RemotePlayer } from './RemotePlayer';
import { OcclusionManager } from '../map/OcclusionManager';
import { LightingManager } from '../fx/LightingManager';
import { NetworkManager } from '../network/NetworkManager';
import { RemotePlayerCompositor } from './RemotePlayerCompositor';

export interface RemotePlayerManagerConfig {
    playerFrontDepth: number;
    occlusionManager?: OcclusionManager;
    lightingManager?: LightingManager;
    groundLayers?: Phaser.Tilemaps.TilemapLayer[];
}

/**
 * Manages remote player creation, state synchronization, and cleanup
 */
export class RemotePlayerManager {
    private scene: Phaser.Scene;
    private config: RemotePlayerManagerConfig;
    private networkManager = NetworkManager.getInstance();
    private remotePlayers: Map<string, RemotePlayer> = new Map();
    private initialSyncComplete = false;
    private remoteCompositor: RemotePlayerCompositor;
    private lastAppearanceBySession: Map<string, string> = new Map();

    constructor(scene: Phaser.Scene, config: RemotePlayerManagerConfig) {
        this.scene = scene;
        this.config = config;
        this.remoteCompositor = new RemotePlayerCompositor(scene);
    }

    /**
     * Setup listeners for multiplayer state changes
     */
    initialize() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        const mySessionId = this.networkManager.getSessionId();
        
        // Track whether initial state sync is complete
        // Players added during initial sync were already in the room - no spawn effect
        this.scene.time.delayedCall(500, () => {
            this.initialSyncComplete = true;
        });

        // Listen for player state changes
        room.state.players.onAdd((player: any, sessionId: string) => {
            // Skip local player
            if (sessionId === mySessionId) return;

            let remotePlayer: RemotePlayer | undefined;
            let isCreatingPlayer = false; // Prevent duplicate async creation

            const createRemotePlayer = async () => {
                if (remotePlayer || isCreatingPlayer) return;
                isCreatingPlayer = true;

                // Composite custom textures for this player
                const appearance = player.appearance || '';
                let animationKeyGetter: ((direction: string) => string | undefined) | undefined;
                
                if (appearance && appearance.trim() !== '') {
                    try {
                        await this.remoteCompositor.compositeForPlayer(sessionId, appearance);
                        // Create a function to get animation keys for this player
                        animationKeyGetter = (direction: string) => {
                            return this.remoteCompositor.getPlayerAnimationKey(sessionId, direction as any);
                        };
                    } catch (err) {
                        console.warn(`[RemotePlayerManager] Failed to composite textures for ${sessionId}, using default:`, err);
                    }
                }

                remotePlayer = new RemotePlayer(this.scene, {
                    sessionId,
                    username: player.username || 'Guest',
                    odcid: player.odcid || sessionId,
                    x: player.x,
                    y: player.y,
                    direction: player.direction || 0,
                    depth: this.config.playerFrontDepth,
                    occlusionManager: this.config.occlusionManager,
                    skipSpawnEffect: !this.initialSyncComplete, // Skip effect for existing players
                    isAfk: player.isAfk || false,
                    afkSince: player.afkSince || 0,
                    isGuiOpen: player.isGuiOpen || false,
                    isChatOpen: player.isChatOpen || false,
                    isPremium: player.isPremium || false,
                    groundLayers: this.config.groundLayers,
                    customAnimationKeyGetter: animationKeyGetter
                });

                // Enable lighting on remote player sprite
                const remoteSprite = remotePlayer.getSprite();
                if (remoteSprite && this.config.lightingManager) {
                    this.config.lightingManager.enableLightingOn(remoteSprite);
                }
                
                // Set initial AFK state
                if (player.isAfk) {
                    remotePlayer.setAfk(true, player.afkSince || 0);
                }

                remotePlayer.setGuiOpen(player.isGuiOpen || false);
                remotePlayer.setChatOpen(player.isChatOpen || false);

                this.remotePlayers.set(sessionId, remotePlayer);
                this.lastAppearanceBySession.set(sessionId, appearance);
            };

            if (!this.initialSyncComplete) {
                // Existing players (initial sync) - spawn immediately without effect
                // But if position is at default (0,0), wait for valid position via onChange
                if (player.x !== 0 || player.y !== 0) {
                    createRemotePlayer();
                }
                // If position is (0,0), onChange will create the player when valid position arrives
            }

            // Listen for position changes
            player.onChange((changes: any[]) => {
                if (!remotePlayer) {
                    // Wait for valid (non-zero) position before creating the remote player
                    // Server sends (0,0) initially, client sends actual position immediately after spawn
                    if (player.x === 0 && player.y === 0) {
                        return;
                    }
                    createRemotePlayer();
                }

                // If appearance changed/arrived, re-composite and update animations
                const appearanceChanged = changes?.some((change: any) => change.field === 'appearance');
                if (appearanceChanged && player.appearance) {
                    const newAppearance = player.appearance || '';
                    const lastAppearance = this.lastAppearanceBySession.get(sessionId) || '';
                    if (newAppearance !== lastAppearance) {
                        this.lastAppearanceBySession.set(sessionId, newAppearance);
                        this.remoteCompositor
                            .updateForPlayer(sessionId, newAppearance)
                            .then(() => {
                                const remote = this.remotePlayers.get(sessionId);
                                if (remote) {
                                    remote.setCustomAnimationKeyGetter((direction: any) =>
                                        this.remoteCompositor.getPlayerAnimationKey(sessionId, direction)
                                    );
                                }
                            })
                            .catch(err => {
                                console.warn(`[RemotePlayerManager] Failed to re-composite textures for ${sessionId}:`, err);
                            });
                    }
                }
                const remote = this.remotePlayers.get(sessionId);
                if (remote) {
                    remote.setPosition(player.x, player.y);
                    remote.setAnimation(player.anim || 'idle', player.direction || 0);
                    remote.setAfk(player.isAfk || false, player.afkSince || 0);
                    remote.setGuiOpen(player.isGuiOpen || false);
                    remote.setChatOpen(player.isChatOpen || false);
                }
            });
        });

        room.state.players.onRemove((_player: any, sessionId: string) => {
            console.log(`[RemotePlayerManager] Remote player left: ${sessionId}`);
            const remotePlayer = this.remotePlayers.get(sessionId);
            if (remotePlayer) {
                // Start despawn effect, then remove from map when complete
                remotePlayer.startDespawnEffect(() => {
                    remotePlayer.destroy();
                    this.remotePlayers.delete(sessionId);
                    this.lastAppearanceBySession.delete(sessionId);
                    // Clean up compositor textures for this player
                    this.remoteCompositor.destroyForPlayer(sessionId);
                });
            }
        });
    }

    /**
     * Update all remote players (position interpolation)
     */
    update(delta: number) {
        this.remotePlayers.forEach(remote => remote.update(delta));
    }

    /**
     * Get all remote players
     */
    getPlayers(): Map<string, RemotePlayer> {
        return this.remotePlayers;
    }

    showChat(sessionId: string, message: string) {
        const player = this.remotePlayers.get(sessionId);
        if (player) {
            player.showChat(message);
        }
    }

    showFishingBubble(sessionId: string, rodItemId: string) {
        const player = this.remotePlayers.get(sessionId);
        if (player) {
            player.showFishingBubble(rodItemId);
        }
    }

    /**
     * Cleanup all remote players
     */
    destroy() {
        this.remotePlayers.forEach(remote => remote.destroy());
        this.remotePlayers.clear();
        this.remoteCompositor.destroy();
    }
}
