/**
 * THIS FILE IS ALL TEMPLATE CODE AND WILL BE REMOVED/REPLACED AT A LATER DATE.
 * Guppy Labs 2026
 */

import Phaser from 'phaser';
import * as Colyseus from 'colyseus.js';
import { PlayerInput } from '@cfwk/shared';
import { Config } from '../config';

export class GameScene extends Phaser.Scene {
    private client!: Colyseus.Client;
    private room!: Colyseus.Room;
    private players: Map<string, Phaser.GameObjects.Sprite> = new Map();
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private currentPlayerId: string | null = null;
    private lastInput: PlayerInput | undefined;

    constructor() {
        super('GameScene');
    }

    async create() {
        this.client = new Colyseus.Client(Config.WS_URL);
        
        try {
            this.room = await this.client.joinOrCreate('game_room', { username: 'Player_' + Math.floor(Math.random() * 1000) });
            console.log('Joined successfully!');
            this.currentPlayerId = this.room.sessionId;
            this.setupRoomListeners();
        } catch (e) {
            console.error('Join error', e);
        }

        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
        }

        this.add.image(400, 300, 'water');
    }

    private setupRoomListeners() {
        this.room.state.players.onAdd((player: any, sessionId: string) => {
            const entity = this.add.sprite(player.x, player.y, 'player');
            this.players.set(sessionId, entity);

            player.onChange(() => {
                entity.x = player.x;
                entity.y = player.y;
            });
        });

        this.room.state.players.onRemove((_player: any, sessionId: string) => {
            const entity = this.players.get(sessionId);
            if (entity) {
                entity.destroy();
                this.players.delete(sessionId);
            }
        });
    }

    update() {
        if (!this.room || !this.cursors) return;

        const input: PlayerInput = {
            up: this.cursors.up.isDown,
            down: this.cursors.down.isDown,
            left: this.cursors.left.isDown,
            right: this.cursors.right.isDown,
            action: this.cursors.space.isDown
        };

        if (!this.lastInput || 
            input.up !== this.lastInput.up ||
            input.down !== this.lastInput.down ||
            input.left !== this.lastInput.left ||
            input.right !== this.lastInput.right ||
            input.action !== this.lastInput.action) {
            
            this.room.send('input', input);
            this.lastInput = input;
        }
    }
}
