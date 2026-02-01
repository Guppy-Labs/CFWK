import { Server, Room } from "colyseus";
import { ILocationConfig, IInstanceInfo } from "@cfwk/shared";
import { EventEmitter } from "events";

/**
 * Represents an active instance of a location
 */
interface ActiveInstance {
    instanceId: string;
    locationId: string;
    roomId: string;         // Colyseus room ID
    currentPlayers: number;
    maxPlayers: number;
    mapFile: string;
}

/**
 * Manages game world instances.
 * 
 * An "instance" is a specific running copy of a location (like a lobby).
 * When one instance fills up, a new one is created automatically.
 * 
 * This manager:
 * - Tracks all active instances
 * - Creates new instances when needed
 * - Routes players to available instances
 * - Cleans up empty instances
 */
export class InstanceManager {
    private static instance: InstanceManager;
    private gameServer?: Server;
    public events: EventEmitter = new EventEmitter();
    
    // All registered location configs (lobby, forest, etc.)
    private locationConfigs: Map<string, ILocationConfig> = new Map();
    
    // All active instances keyed by instanceId
    private activeInstances: Map<string, ActiveInstance> = new Map();
    
    // Track instance counts per location for naming (lobby-1, lobby-2, etc.)
    private instanceCounters: Map<string, number> = new Map();

    // Track connected users by odcid to prevent duplicate connections
    private connectedUsers: Map<string, string> = new Map(); // odcid -> sessionId

    private constructor() {
        this.registerDefaultLocations();
    }

    static getInstance(): InstanceManager {
        if (!InstanceManager.instance) {
            InstanceManager.instance = new InstanceManager();
        }
        return InstanceManager.instance;
    }

    /**
     * Initialize with Colyseus server reference
     */
    initialize(server: Server) {
        this.gameServer = server;
        console.log("[InstanceManager] Initialized");
    }

    /**
     * Set the Colyseus game server reference
     */
    setGameServer(server: Server) {
        this.gameServer = server;
        console.log("[InstanceManager] Game server set");
    }

    /**
     * Register default game locations
     */
    private registerDefaultLocations() {
        // Main lobby - where players spawn by default
        this.registerLocation({
            id: "lobby",
            name: "Main Lobby",
            mapFile: "lobby.tmj",
            maxPlayers: 20,
            isPublic: true
        });

        // Limbo - fallback location
        this.registerLocation({
            id: "limbo",
            name: "Limbo",
            mapFile: "limbo.tmj",
            maxPlayers: 50,
            isPublic: true
        });
    }

    /**
     * Register a new location type
     */
    registerLocation(config: ILocationConfig) {
        this.locationConfigs.set(config.id, config);
        this.instanceCounters.set(config.id, 0);
        console.log(`[InstanceManager] Registered location: ${config.name} (${config.id})`);
    }

    /**
     * Get the best instance for a player to join at a location.
     * Creates a new instance if none available or all are full.
     */
    async getOrCreateInstance(locationId: string): Promise<IInstanceInfo | null> {
        const config = this.locationConfigs.get(locationId);
        if (!config) {
            console.error(`[InstanceManager] Unknown location: ${locationId}`);
            return null;
        }

        const instances = Array.from(this.activeInstances.values())
            .filter((instance) => instance.locationId === locationId);

        // Always keep at least one lobby open
        if (locationId === "lobby" && instances.length === 0) {
            return this.createInstance(locationId);
        }

        // Find the least-loaded instance with space
        const available = instances
            .filter((instance) => instance.currentPlayers < instance.maxPlayers)
            .sort((a, b) => a.currentPlayers - b.currentPlayers);

        if (locationId === "lobby") {
            const threshold = Math.ceil(config.maxPlayers * 0.75);

            if (available.length > 0) {
                const leastLoaded = available[0];
                if (leastLoaded.currentPlayers >= threshold) {
                    return this.createInstance(locationId);
                }
                return this.toInstanceInfo(leastLoaded);
            }

            // No available lobby instance with space, create a new one
            return this.createInstance(locationId);
        }

        if (available.length > 0) {
            return this.toInstanceInfo(available[0]);
        }

        // No available instance, create a new one
        return this.createInstance(locationId);
    }

    /**
     * Create a new instance of a location
     */
    private async createInstance(locationId: string): Promise<IInstanceInfo | null> {
        const config = this.locationConfigs.get(locationId);
        if (!config) return null;

        // Generate instance ID
        const counter = (this.instanceCounters.get(locationId) || 0) + 1;
        this.instanceCounters.set(locationId, counter);
        const instanceId = `${locationId}-${counter}`;

        // The room name for Colyseus - we use a convention
        const roomName = "instance_room";

        const instance: ActiveInstance = {
            instanceId,
            locationId,
            roomId: instanceId, // Will be updated when room is created
            currentPlayers: 0,
            maxPlayers: config.maxPlayers,
            mapFile: config.mapFile
        };

        this.activeInstances.set(instanceId, instance);
        console.log(`[InstanceManager] Created instance: ${instanceId} for ${config.name}`);

        return this.toInstanceInfo(instance);
    }

    /**
     * Check if a user is already connected
     */
    isUserConnected(odcid: string): boolean {
        return this.connectedUsers.has(odcid);
    }

    /**
     * Register a user connection
     */
    registerUserConnection(odcid: string, sessionId: string) {
        this.connectedUsers.set(odcid, sessionId);
        console.log(`[InstanceManager] Registered user connection: ${odcid}`);
    }

    /**
     * Unregister a user connection
     */
    unregisterUserConnection(odcid: string) {
        this.connectedUsers.delete(odcid);
        console.log(`[InstanceManager] Unregistered user connection: ${odcid}`);
    }

    /**
     * Called when a player joins an instance
     */
    playerJoined(instanceId: string) {
        const instance = this.activeInstances.get(instanceId);
        if (instance) {
            instance.currentPlayers++;
            console.log(`[InstanceManager] Player joined ${instanceId}. Count: ${instance.currentPlayers}/${instance.maxPlayers}`);
        }
    }

    /**
     * Called when a player leaves an instance
     */
    playerLeft(instanceId: string) {
        const instance = this.activeInstances.get(instanceId);
        if (instance) {
            instance.currentPlayers = Math.max(0, instance.currentPlayers - 1);
            console.log(`[InstanceManager] Player left ${instanceId}. Count: ${instance.currentPlayers}/${instance.maxPlayers}`);

            // Clean up empty instances (except keep at least one lobby)
            if (instance.currentPlayers === 0 && instance.locationId !== "lobby") {
                this.destroyInstance(instanceId);
            }
        }
    }

    /**
     * Destroy an instance
     */
    private destroyInstance(instanceId: string) {
        const instance = this.activeInstances.get(instanceId);
        if (instance) {
            this.activeInstances.delete(instanceId);
            console.log(`[InstanceManager] Destroyed instance: ${instanceId}`);
        }
    }

    /**
     * Get instance info by ID
     */
    getInstanceInfo(instanceId: string): IInstanceInfo | null {
        const instance = this.activeInstances.get(instanceId);
        return instance ? this.toInstanceInfo(instance) : null;
    }

    /**
     * Convert internal instance to public info
     */
    private toInstanceInfo(instance: ActiveInstance): IInstanceInfo {
        return {
            instanceId: instance.instanceId,
            locationId: instance.locationId,
            mapFile: instance.mapFile,
            roomName: "instance",  // Matches the room definition in index.ts
            currentPlayers: instance.currentPlayers,
            maxPlayers: instance.maxPlayers
        };
    }

    /**
     * Get all active instances (for debugging/admin)
     */
    getAllInstances(): IInstanceInfo[] {
        return Array.from(this.activeInstances.values()).map(i => this.toInstanceInfo(i));
    }

    /**
     * Get location config
     */
    getLocationConfig(locationId: string): ILocationConfig | undefined {
        return this.locationConfigs.get(locationId);
    }
}
