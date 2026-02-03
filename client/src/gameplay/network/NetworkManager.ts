import * as Colyseus from "colyseus.js";
import { Config } from "../../config";
import { IInstanceInfo, IJoinInstanceResponse, IInventoryResponse } from "@cfwk/shared";

/**
 * NetworkManager - Handles all server communication for multiplayer.
 * 
 * Responsibilities:
 * - Request instance assignments from the server
 * - Manage Colyseus room connections
 * - Handle connection state and reconnection
 * - Expose room state to the game
 */
export class NetworkManager {
    private static instance: NetworkManager;
    
    private client: Colyseus.Client;
    private currentRoom: Colyseus.Room | null = null;
    private currentInstance: IInstanceInfo | null = null;
    
    private isConnecting: boolean = false;
    private connectionError: string | null = null;
    
    // Disconnect detection
    private disconnectCallbacks: Array<(code: number) => void> = [];
    private wasConnected: boolean = false;

    private constructor() {
        this.client = new Colyseus.Client(Config.WS_URL);
        console.log("[NetworkManager] Initialized with WS URL:", Config.WS_URL);
    }

    static getInstance(): NetworkManager {
        if (!NetworkManager.instance) {
            NetworkManager.instance = new NetworkManager();
        }
        return NetworkManager.instance;
    }

    /**
     * Request an instance assignment from the server.
     * This asks the server "where should I go?" and gets back instance info.
     */
    async requestInstance(locationId: string = "lobby"): Promise<IInstanceInfo | null> {
        console.log(`[NetworkManager] Requesting instance for location: ${locationId}`);
        
        try {
            const response = await fetch(Config.getApiUrl('/instance/join'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ locationId })
            });

            if (!response.ok) {
                throw new Error(`Failed to get instance: ${response.statusText}`);
            }

            const data: IJoinInstanceResponse = await response.json();
            
            if (!data.success || !data.instance) {
                throw new Error(data.error || "Failed to get instance info");
            }

            this.currentInstance = data.instance;
            console.log("[NetworkManager] Received instance:", this.currentInstance);
            
            return this.currentInstance;
        } catch (error) {
            console.error("[NetworkManager] Error requesting instance:", error);
            this.connectionError = error instanceof Error ? error.message : "Unknown error";
            return null;
        }
    }

    async getInventory(): Promise<IInventoryResponse | null> {
        try {
            // Use relative URL to go through same-origin proxy (for session cookies)
            const response = await fetch('/api/inventory', {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch inventory: ${response.statusText}`);
            }

            const data: IInventoryResponse = await response.json();
            return data;
        } catch (error) {
            console.error('[NetworkManager] Error fetching inventory:', error);
            return null;
        }
    }

    /**
     * Connect to the assigned instance room.
     * Call this after requestInstance() succeeds.
     */
    async connectToInstance(username: string = "Guest", odcid?: string): Promise<Colyseus.Room | null> {
        if (!this.currentInstance) {
            console.error("[NetworkManager] No instance assigned. Call requestInstance() first.");
            return null;
        }

        if (this.isConnecting) {
            console.warn("[NetworkManager] Already connecting...");
            return null;
        }

        this.isConnecting = true;
        this.connectionError = null;

        try {
            console.log(`[NetworkManager] Connecting to instance: ${this.currentInstance.instanceId}`);
            
            // Join the room with instance info
            this.currentRoom = await this.client.joinOrCreate(this.currentInstance.roomName, {
                instanceId: this.currentInstance.instanceId,
                locationId: this.currentInstance.locationId,
                mapFile: this.currentInstance.mapFile,
                maxPlayers: this.currentInstance.maxPlayers,
                username,
                odcid: odcid || 'guest'
            });

            console.log(`[NetworkManager] Connected to room: ${this.currentRoom.id}`);
            
            // Set up room event handlers
            this.setupRoomHandlers();

            return this.currentRoom;
        } catch (error) {
            console.error("[NetworkManager] Error connecting to instance:", error);
            const errorMsg = error instanceof Error ? error.message : "Connection failed";
            
            // Check for duplicate connection error
            if (errorMsg.includes("DUPLICATE_CONNECTION")) {
                this.connectionError = "DUPLICATE_CONNECTION";
            } else {
                this.connectionError = errorMsg;
            }
            return null;
        } finally {
            this.isConnecting = false;
        }
    }

    /**
     * Set up handlers for room events
     */
    private setupRoomHandlers() {
        if (!this.currentRoom) return;

        this.currentRoom.onError((code, message) => {
            console.error(`[NetworkManager] Room error [${code}]:`, message);
            this.connectionError = message || `Error code: ${code}`;
        });

        this.currentRoom.onLeave((code) => {
            console.log(`[NetworkManager] Left room with code: ${code}`);
            const hadConnection = this.wasConnected;
            this.currentRoom = null;
            this.wasConnected = false;
            
            // Handle bans specifically
            if (code === 4003) {
                // For bans, we want to notify immediately, no delay
                // The callback mechanism in GameScene will handle the UI
                this.disconnectCallbacks.forEach(cb => cb(code));
                return;
            }

            // Handle sent to limbo
            if (code === 4004) {
                this.disconnectCallbacks.forEach(cb => cb(code));
                return;
            }

            // Notify listeners if we had an active connection (server went offline)
            if (hadConnection) {
                this.disconnectCallbacks.forEach(cb => cb(code));
            }
        });
        
        // Mark that we have an active connection
        this.wasConnected = true;
    }
    
    /**
     * Register a callback for when the connection is lost
     */
    onDisconnect(callback: (code: number) => void): () => void {
        this.disconnectCallbacks.push(callback);
        // Return unsubscribe function
        return () => {
            const index = this.disconnectCallbacks.indexOf(callback);
            if (index > -1) {
                this.disconnectCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Send player position to the server
     */
    sendPosition(x: number, y: number) {
        if (this.currentRoom) {
            this.currentRoom.send("position", { x, y });
        }
    }

    /**
     * Send player animation state to the server
     */
    sendAnimation(anim: string, direction: number) {
        if (this.currentRoom) {
            this.currentRoom.send("animation", { anim, direction });
        }
    }

    /**
     * Send AFK status to the server
     */
    sendAfk(isAfk: boolean) {
        if (this.currentRoom) {
            this.currentRoom.send("afk", { isAfk });
        }
    }

    /**
     * Send GUI open state to the server
     */
    sendGuiOpen(isOpen: boolean) {
        if (this.currentRoom) {
            this.currentRoom.send("gui", { isOpen });
        }
    }

    /**
     * Send chat focus/open state to the server
     */
    sendChatFocus(isOpen: boolean) {
        if (this.currentRoom) {
            this.currentRoom.send("chatFocus", { isOpen });
        }
    }

    /**
     * Send a chat message to the server
     */
    sendChatMessage(message: string) {
        if (this.currentRoom) {
            this.currentRoom.send("chat", { message });
        }
    }

    /**
     * Send a shove request to the server
     */
    sendShove(targetSessionId: string) {
        if (this.currentRoom) {
            this.currentRoom.send("shove", { targetSessionId });
        }
    }

    /**
     * Send a shove attempt to the server (for animation sync)
     */
    sendShoveAttempt(targetSessionId: string) {
        if (this.currentRoom) {
            this.currentRoom.send("shoveAttempt", { targetSessionId });
        }
    }

    /**
     * Get the local player's session ID
     */
    getSessionId(): string | null {
        return this.currentRoom?.sessionId || null;
    }

    /**
     * Get the last connection error
     */
    getConnectionError(): string | null {
        return this.connectionError;
    }

    /**
     * Disconnect from the current room
     */
    disconnect() {
        if (this.currentRoom) {
            this.currentRoom.leave();
            this.currentRoom = null;
        }
        this.currentInstance = null;
    }

    /**
     * Get the current room
     */
    getRoom(): Colyseus.Room | null {
        return this.currentRoom;
    }

    /**
     * Get the current instance info
     */
    getCurrentInstance(): IInstanceInfo | null {
        return this.currentInstance;
    }

    /**
     * Check if connected to a room
     */
    isConnected(): boolean {
        return this.currentRoom !== null;
    }

    /**
     * Get any connection error
     */
    getError(): string | null {
        return this.connectionError;
    }
}
