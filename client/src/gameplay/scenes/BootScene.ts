/**
 * GAMEPLAY BOOTSTRAP SCENE
 * Guppy Labs 2026
 */

import Phaser from 'phaser';
import { SYSTEM_TILES, IInstanceInfo } from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';
import { DisconnectModal } from '../../ui/DisconnectModal';
import { currentUser, setLoaderText } from '../index';

export class BootScene extends Phaser.Scene {
    private instanceInfo: IInstanceInfo | null = null;
    private networkManager = NetworkManager.getInstance();

    constructor() {
        super('BootScene');
    }

    preload() {
        this.make.graphics({ x: 0, y: 0 })
            .fillStyle(0x00ff00)
            .fillRect(0, 0, 24, 51)
            .generateTexture('player', 24, 51);

        this.make.graphics({ x: 0, y: 0 })
            .fillStyle(0x0000ff)
            .fillRect(0, 0, 800, 600)
            .generateTexture('water', 800, 600);

        // Generate Invisible Collision Tile
        // #000000 with Alpha 1/255 (approx 0.004)
        const g = this.make.graphics({ x: 0, y: 0 });
        g.fillStyle(0x000000, 1/255);
        g.fillRect(0, 0, 32, 32);
        g.generateTexture(SYSTEM_TILES.INVISIBLE, 32, 32);
    }

    create() {
        // Update loader text (HTML loader is already visible)
        setLoaderText(`Connecting...`);

        // Request instance from server
        this.requestInstance();
    }

    private async requestInstance() {
        const limboFallback: IInstanceInfo = { 
            instanceId: 'local',
            locationId: 'limbo',
            mapFile: 'limbo.tmj',
            roomName: 'instance',
            currentPlayers: 1,
            maxPlayers: 50
        };

        // If AFK flag is set, send to limbo
        if (localStorage.getItem('cfwk_afk') === 'true') {
            console.warn('[BootScene] Limbo route: AFK flag detected');
            this.startGame(limboFallback);
            return;
        }

        // If limbo reason is set (disconnect/ban), send to limbo
        const limboReason = localStorage.getItem('cfwk_limbo_reason');
        if (limboReason) {
            console.warn(`[BootScene] Limbo route: reason=${limboReason}`);
            this.startGame(limboFallback);
            return;
        }

        // Check if user was previously disconnected - send them to limbo
        if (DisconnectModal.wasDisconnected()) {
            DisconnectModal.clearDisconnectedFlag();
            console.warn('[BootScene] Limbo route: previously disconnected flag');
            this.startGame(limboFallback);
            return;
        }

        const attemptJoin = async () => {
            const instance = await this.networkManager.requestInstance('lobby');
            if (!instance) return null;
            
            this.instanceInfo = instance;
            // Pass user data when connecting
            const room = await this.networkManager.connectToInstance(
                currentUser?.username || 'Guest',
                currentUser?._id
            );
            
            // Check for duplicate connection - return special marker
            if (!room) {
                const connectionError = this.networkManager.getConnectionError();
                if (connectionError === "DUPLICATE_CONNECTION") {
                    return "DUPLICATE_CONNECTION" as const;
                }
                // Check for IP ban or account ban
                if (connectionError && (connectionError.startsWith("IP_BANNED|") || connectionError.startsWith("ACCOUNT_BANNED|"))) {
                    return connectionError;
                }
                return null;
            }
            
            return instance;
        };

        let result: IInstanceInfo | "DUPLICATE_CONNECTION" | string | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            result = await attemptJoin();

            if (result) break;

            // Small delay before retry
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        
        // Handle duplicate connection error
        if (result === "DUPLICATE_CONNECTION") {
            this.showDuplicateConnectionError();
            return;
        }

        // Handle IP Ban (shows "BANNED" - not account-specific)
        if (typeof result === "string" && result.startsWith("IP_BANNED|")) {
            const dateStr = result.split('|')[1];
            const date = new Date(dateStr);
            
            const fiftyYearsMs = 50 * 365 * 24 * 60 * 60 * 1000;
            const isPermanent = date.getTime() - Date.now() > fiftyYearsMs;
            
            const banMessage = isPermanent 
                ? "You are permanently banned."
                : `You are banned until ${date.toLocaleString()}`;

            localStorage.setItem('cfwk_limbo_reason', 'ban');
            localStorage.setItem('cfwk_limbo_message', banMessage);
            console.warn('[BootScene] Limbo route: IP banned');
            this.startGame(limboFallback);
            return;
        }

        // Handle Account Ban (shows "ACCOUNT BANNED")
        if (typeof result === "string" && result.startsWith("ACCOUNT_BANNED|")) {
            const dateStr = result.split('|')[1];
            const date = new Date(dateStr);
            
            const fiftyYearsMs = 50 * 365 * 24 * 60 * 60 * 1000;
            const isPermanent = date.getTime() - Date.now() > fiftyYearsMs;
            
            const banMessage = isPermanent 
                ? "Your account is permanently banned."
                : `Your account is banned until ${date.toLocaleString()}`;

            localStorage.setItem('cfwk_limbo_reason', 'ban');
            localStorage.setItem('cfwk_limbo_message', banMessage);
            console.warn('[BootScene] Limbo route: account banned');
            this.startGame(limboFallback);
            return;
        }
        
        if (result && typeof result !== 'string') {
            this.startGame(result);
        } else {
            // Timeout or failure - go to limbo
            const error = this.networkManager.getConnectionError();
            console.warn(`[BootScene] Limbo route: instance request/connect failed${error ? ` (${error})` : ''}`);
            this.startGame(limboFallback);
        }
    }

    private showDuplicateConnectionError() {
        // Update loader to show error (keeps same visual style)
        const loader = document.getElementById('game-loader');
        if (loader) {
            loader.innerHTML = `
                <div style="text-align: center;">
                    <div style="font-size: 1.5rem; color: #ff6b6b; margin-bottom: 20px; font-family: 'Minecraft', monospace; text-transform: uppercase; letter-spacing: 2px;">Already Connected</div>
                    <div style="font-size: 0.8rem; color: #aaa; font-family: 'Minecraft', monospace; line-height: 1.8;">You are already playing in another window.<br>Please close other tabs to continue.</div>
                </div>
            `;
        }
    }

    private startGame(instance: IInstanceInfo) {
        this.scene.start('GameScene', { instance });
    }
}
