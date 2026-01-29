/**
 * GAMEPLAY BOOTSTRAP SCENE
 * Guppy Labs 2026
 */

import Phaser from 'phaser';
import { SYSTEM_TILES, IInstanceInfo } from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';
import { currentUser } from '../index';

export class BootScene extends Phaser.Scene {
    private instanceInfo: IInstanceInfo | null = null;
    private loadingText!: Phaser.GameObjects.Text;
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
        // Show loading text
        this.loadingText = this.add.text(
            this.scale.width / 2,
            this.scale.height / 2,
            'Connecting to world...',
            { fontSize: '24px', color: '#ffffff' }
        ).setOrigin(0.5);

        // Request instance from server
        this.requestInstance();
    }

    private async requestInstance() {
        const TIMEOUT_MS = 5000;
        const limboFallback: IInstanceInfo = { 
            instanceId: 'local',
            locationId: 'limbo',
            mapFile: 'limbo.tmj',
            roomName: 'instance',
            currentPlayers: 1,
            maxPlayers: 50
        };

        // Race between instance request and timeout
        const instancePromise = (async () => {
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
                return null;
            }
            
            return instance;
        })();

        const timeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), TIMEOUT_MS);
        });

        const result = await Promise.race([instancePromise, timeoutPromise]);
        
        // Handle duplicate connection error
        if (result === "DUPLICATE_CONNECTION") {
            this.showDuplicateConnectionError();
            return;
        }
        
        if (result && typeof result !== 'string') {
            this.startGame(result);
        } else {
            // Timeout or failure - go to limbo silently
            this.startGame(limboFallback);
        }
    }

    private showDuplicateConnectionError() {
        // Clear loading text
        this.loadingText.destroy();
        
        // Show error message
        const errorText = this.add.text(
            this.scale.width / 2,
            this.scale.height / 2 - 20,
            'Already Connected',
            { fontSize: '28px', color: '#ff6b6b', fontFamily: 'Minecraft, monospace' }
        ).setOrigin(0.5);

        this.add.text(
            this.scale.width / 2,
            this.scale.height / 2 + 30,
            'You are already playing in another window.\nPlease close other tabs to continue.',
            { fontSize: '14px', color: '#ffffff', fontFamily: 'Minecraft, monospace', align: 'center', lineSpacing: 10 }
        ).setOrigin(0.5);
    }

    private startGame(instance: IInstanceInfo) {
        this.scene.start('GameScene', { instance });
    }
}
