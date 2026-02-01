import Phaser from 'phaser';
import { RemotePlayer } from './RemotePlayer';
import { OcclusionManager } from '../map/OcclusionManager';
import { LightingManager } from '../fx/LightingManager';
import { NetworkManager } from '../network/NetworkManager';

export interface RemotePlayerManagerConfig {
    playerFrontDepth: number;
    occlusionManager?: OcclusionManager;
    lightingManager?: LightingManager;
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

    constructor(scene: Phaser.Scene, config: RemotePlayerManagerConfig) {
        this.scene = scene;
        this.config = config;
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

            console.log(`[RemotePlayerManager] Remote player joined: ${sessionId} (${player.username}) - initial: ${!this.initialSyncComplete}`);
            
            const remotePlayer = new RemotePlayer(this.scene, {
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
                isChatOpen: player.isChatOpen || false
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
            
            this.remotePlayers.set(sessionId, remotePlayer);

            // Listen for position changes
            player.onChange(() => {
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
                });
            }
        });
    }

    /**
     * Update all remote players (position interpolation)
     */
    update() {
        this.remotePlayers.forEach(remote => remote.update());
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

    /**
     * Cleanup all remote players
     */
    destroy() {
        this.remotePlayers.forEach(remote => remote.destroy());
        this.remotePlayers.clear();
    }
}
