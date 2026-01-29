import { Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerInput, IPlayer, PlayerAnim } from "@cfwk/shared";
import { InstanceManager } from "../managers/InstanceManager";

/**
 * Player state for instance rooms
 */
export class InstancePlayerSchema extends Schema implements IPlayer {
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("string") anim: PlayerAnim = 'idle';
    @type("boolean") isFishing: boolean = false;
    @type("string") username: string = "";
    @type("string") odcid: string = ""; // MongoDB ObjectId for consistent color
    @type("number") direction: number = 0; // 0-7 for 8-way direction
}

/**
 * Instance room state
 */
export class InstanceState extends Schema {
    @type("string") instanceId: string = "";
    @type("string") locationId: string = "";
    @type("string") mapFile: string = "";
    @type({ map: InstancePlayerSchema }) players = new MapSchema<InstancePlayerSchema>();
}

/**
 * InstanceRoom - A Colyseus room representing a game world instance.
 * 
 * Each instance is bound to a specific map and has a player limit.
 * Multiple instances of the same location can exist simultaneously.
 */
export class InstanceRoom extends Room<InstanceState> {
    private instanceId: string = "";
    private instanceManager = InstanceManager.getInstance();

    onCreate(options: { instanceId: string; locationId: string; mapFile: string; maxPlayers: number }) {
        console.log(`[InstanceRoom] Creating room for instance: ${options.instanceId}`);
        
        this.instanceId = options.instanceId;
        this.maxClients = options.maxPlayers;
        
        // Set up state
        const state = new InstanceState();
        state.instanceId = options.instanceId;
        state.locationId = options.locationId;
        state.mapFile = options.mapFile;
        this.setState(state);

        // Handle player input
        this.onMessage("input", (client, input: PlayerInput) => {
            const player = this.state.players.get(client.sessionId);
            if (player) {
                const speed = 2;
                if (input.left) player.x -= speed;
                if (input.right) player.x += speed;
                if (input.up) player.y -= speed;
                if (input.down) player.y += speed;

                if (input.left || input.right || input.up || input.down) {
                    player.anim = 'walk';
                } else {
                    player.anim = 'idle';
                }
            }
        });

        // Handle position sync (client sends authoritative position for now)
        this.onMessage("position", (client, data: { x: number; y: number }) => {
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.x = data.x;
                player.y = data.y;
            }
        });

        // Handle animation sync
        this.onMessage("animation", (client, data: { anim: PlayerAnim; direction: number }) => {
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.anim = data.anim;
                if (typeof data.direction === 'number') {
                    player.direction = data.direction;
                }
            }
        });
    }

    async onJoin(client: Client, options: { username?: string; odcid?: string }) {
        const odcid = options.odcid || client.sessionId;
        
        // Check for duplicate connection
        if (odcid !== client.sessionId && this.instanceManager.isUserConnected(odcid)) {
            console.log(`[InstanceRoom] Rejecting duplicate connection for user: ${odcid}`);
            throw new Error("DUPLICATE_CONNECTION");
        }

        console.log(`[InstanceRoom] ${client.sessionId} joined instance ${this.instanceId}`);
        
        // Register this connection
        if (odcid !== client.sessionId) {
            this.instanceManager.registerUserConnection(odcid, client.sessionId);
        }
        
        // Store odcid on client for cleanup on leave
        (client as any).odcid = odcid;
        
        // Create player state
        const player = new InstancePlayerSchema();
        player.x = 400; // TODO: Get spawn point from map
        player.y = 300;
        player.username = options.username || "Guest";
        player.odcid = odcid; // Use odcid for consistent coloring
        player.direction = 0; // Facing down
        
        this.state.players.set(client.sessionId, player);
        
        // Notify instance manager
        this.instanceManager.playerJoined(this.instanceId);
    }

    onLeave(client: Client, consented: boolean) {
        console.log(`[InstanceRoom] ${client.sessionId} left instance ${this.instanceId}`);
        
        // Unregister user connection
        const odcid = (client as any).odcid;
        if (odcid && odcid !== client.sessionId) {
            this.instanceManager.unregisterUserConnection(odcid);
        }
        
        this.state.players.delete(client.sessionId);
        
        // Notify instance manager
        this.instanceManager.playerLeft(this.instanceId);
    }

    onDispose() {
        console.log(`[InstanceRoom] Instance ${this.instanceId} disposed`);
    }
}
