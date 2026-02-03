import { Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerInput, IPlayer, PlayerAnim, calculateWorldTime, Season } from "@cfwk/shared";
import { InstanceManager } from "../managers/InstanceManager";
import { CommandProcessor } from "../utils/CommandProcessor";
import User from "../models/User";
import BannedIP from "../models/BannedIP";

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
    @type("boolean") isAfk: boolean = false; // AFK status for transparency
    @type("number") afkSince: number = 0; // Timestamp (ms) when AFK started
    @type("boolean") isGuiOpen: boolean = false; // Main GUI open state
    @type("boolean") isChatOpen: boolean = false; // Chat open/focused state
}

/**
 * World time state synchronized to all clients
 */
export class WorldTimeSchema extends Schema {
    @type("number") year: number = 1;
    @type("number") season: Season = Season.Winter;
    @type("number") dayOfYear: number = 1;
    @type("number") dayOfSeason: number = 1;
    @type("number") hour: number = 0;
    @type("number") minute: number = 0;
    @type("number") second: number = 0;
    @type("number") brightness: number = 0.5;
}

/**
 * Instance room state
 */
export class InstanceState extends Schema {
    @type("string") instanceId: string = "";
    @type("string") locationId: string = "";
    @type("string") mapFile: string = "";
    @type({ map: InstancePlayerSchema }) players = new MapSchema<InstancePlayerSchema>();
    @type(WorldTimeSchema) worldTime = new WorldTimeSchema();
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
    private timeUpdateInterval?: ReturnType<typeof setInterval>;
    private afkCheckInterval?: ReturnType<typeof setInterval>;

    onCreate(options: { instanceId: string; locationId: string; mapFile: string; maxPlayers: number }) {
        console.log(`[InstanceRoom] Creating room for instance: ${options.instanceId}`);
        
        // --- Admin Event Listeners ---
        this.instanceManager.events.on('broadcast', (msg: string) => {
            this.broadcast('chat', {
                username: 'SYSTEM',
                odcid: 'SYSTEM', // Special ID for red system color potentially
                message: msg,
                timestamp: Date.now(),
                isSystem: true // Client can use this to color it red
            });
        });

        this.instanceManager.events.on('ban', (bannedUserId: string) => {
            // Check if user is in this room
            try {
                this.clients.forEach(client => {
                    const player = this.state.players.get(client.sessionId);
                    if (player && player.odcid === bannedUserId) {
                        client.leave(4003, "You have been banned.");
                    }
                });
            } catch (e) {
                console.error("Error processing ban kick:", e);
            }
        });

        this.instanceManager.events.on('msg_user', (data: { userId: string, message: string }) => {
            this.clients.forEach(client => {
                const player = this.state.players.get(client.sessionId);
                if (player && player.odcid === data.userId) {
                    client.send('chat', {
                        username: 'SYSTEM',
                        odcid: 'SYSTEM',
                        message: data.message,
                        timestamp: Date.now(),
                        isSystem: true
                    });
                }
            });
        });

        // Handle send to limbo command
        this.instanceManager.events.on('send_to_limbo', (data: { userId: string, reason: string }) => {
            try {
                this.clients.forEach(client => {
                    const player = this.state.players.get(client.sessionId);
                    if (player && player.odcid === data.userId) {
                        // Send the reason as the leave message (code 4004 = sent to limbo)
                        client.leave(4004, data.reason);
                    }
                });
            } catch (e) {
                console.error("Error processing send_to_limbo:", e);
            }
        });

        this.instanceId = options.instanceId;
        this.maxClients = options.maxPlayers;
        
        // Set up state
        const state = new InstanceState();
        state.instanceId = options.instanceId;
        state.locationId = options.locationId;
        state.mapFile = options.mapFile;
        this.setState(state);

        // Initialize world time
        this.updateWorldTime();

        // Update world time every second (client can interpolate for smoother updates)
        this.timeUpdateInterval = setInterval(() => {
            this.updateWorldTime();
        }, 1000);

        // Server-side AFK kick enforcement (authoritative)
        const afkKickThresholdMs = 300000; // 5 minutes
        this.afkCheckInterval = setInterval(() => {
            const now = Date.now();
            this.clients.forEach(client => {
                const player = this.state.players.get(client.sessionId);
                if (!player || !player.isAfk || !player.afkSince) return;
                if (now - player.afkSince >= afkKickThresholdMs) {
                    console.log(`[InstanceRoom] AFK kick (server) for ${client.sessionId}`);
                    client.leave(4000, "AFK timeout");
                }
            });
        }, 1000);

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

        // Handle AFK status
        this.onMessage("afk", (client, data: { isAfk: boolean }) => {
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.isAfk = data.isAfk;
                player.afkSince = data.isAfk ? Date.now() : 0;
                console.log(`[InstanceRoom] Player ${client.sessionId} AFK: ${data.isAfk}`);
            }
        });

        // Handle GUI open state
        this.onMessage("gui", (client, data: { isOpen: boolean }) => {
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.isGuiOpen = data.isOpen;
            }
        });

        // Handle chat focus state
        this.onMessage("chatFocus", (client, data: { isOpen: boolean }) => {
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.isChatOpen = data.isOpen;
            }
        });

        // Handle shove interactions
        this.onMessage("shove", (client, data: { targetSessionId: string }) => {
            const attacker = this.state.players.get(client.sessionId);
            const target = this.state.players.get(data.targetSessionId);
            
            if (!attacker || !target) {
                console.log(`[InstanceRoom] Shove failed: invalid players`);
                return;
            }

            // Prevent shoving AFK-ghosted players (AFK for >= 1 minute)
            if (target.isAfk && target.afkSince && Date.now() - target.afkSince >= 60000) {
                console.log(`[InstanceRoom] Shove rejected: target is AFK-ghosted`);
                return;
            }
            
            // Calculate distance between players
            const dx = target.x - attacker.x;
            const dy = target.y - attacker.y;
            const distance = Math.hypot(dx, dy);
            
            // Server-side validation: max 60px for shove to work
            const maxShoveDistance = 60;
            if (distance > maxShoveDistance) {
                console.log(`[InstanceRoom] Shove rejected: too far (${distance}px)`);
                return;
            }
            
            // Calculate shove direction (normalized)
            const length = Math.max(distance, 1); // Avoid division by zero
            const dirX = dx / length;
            const dirY = dy / length;
            
            // Shove force (impulse velocity)
            const shoveForce = 60; // pixels to move target
            const knockbackForce = 8; // counter-force on attacker
            
            // Broadcast shove event to all clients
            this.broadcast("shove", {
                attackerSessionId: client.sessionId,
                targetSessionId: data.targetSessionId,
                // Force applied to target (pushed away from attacker)
                targetForceX: dirX * shoveForce,
                targetForceY: dirY * shoveForce,
                // Small counter-force on attacker (pushed back slightly)
                attackerForceX: -dirX * knockbackForce,
                attackerForceY: -dirY * knockbackForce
            });
            
            console.log(`[InstanceRoom] ${attacker.username} shoved ${target.username}`);
        });

        // Handle shove attempts (animation sync even on miss)
        this.onMessage("shoveAttempt", (client, data: { targetSessionId: string }) => {
            this.broadcast("shoveAttempt", {
                attackerSessionId: client.sessionId,
                targetSessionId: data.targetSessionId
            });
        });

        // Handle chat messages
        this.onMessage("chat", async (client, data: { message: string }) => {
            const player = this.state.players.get(client.sessionId);
            
            if (player && data.message) {
                const messageHelper = data.message.trim();

                // --- Command Handling ---
                if (messageHelper.startsWith('/')) {
                    const parts = messageHelper.slice(1).split(' ');
                    const command = parts[0];
                    const args = parts.slice(1);
                    
                    // Execute command logic
                    const result = await CommandProcessor.handleCommand(
                        command, 
                        args, 
                        player.odcid, 
                        player.username
                    );
                    
                    // Send result back to issuer only
                    client.send('chat', {
                        username: 'SYSTEM',
                        odcid: 'SYSTEM',
                        message: result,
                        timestamp: Date.now(),
                        isSystem: true
                    });
                    return;
                }

                // --- Mute Check ---
                // We fetch the latest user data to ensure mute is respected immediately
                try {
                    const user = await User.findById(player.odcid);
                    if (user && user.mutedUntil) {
                        if (user.mutedUntil.getTime() > Date.now()) {
                            client.send('chat', {
                                username: 'SYSTEM',
                                odcid: 'SYSTEM',
                                message: "You are muted.",
                                timestamp: Date.now(),
                                isSystem: true
                            });
                            return;
                        } else {
                            // Expired mute
                            user.mutedUntil = undefined;
                            await user.save();
                        }
                    }
                } catch (err) {
                    console.error("Error checking mute status:", err);
                }

                // Broadcast to all clients in the room (Standard Chat)
                this.broadcast("chat", {
                    sessionId: client.sessionId,
                    username: player.username,
                    odcid: player.odcid,
                    message: data.message.slice(0, 100), // Basic length limit
                    timestamp: Date.now()
                });
                
                console.log(`[InstanceRoom] Chat from ${player.username}: ${data.message}`);
            }
        });
    }

    async onJoin(client: Client, options: { username?: string; odcid?: string }) {
        const odcid = options.odcid || client.sessionId;
        
        // Get client IP address
        const clientIP = this.getClientIP(client);
        
        // --- IP Ban Check (before account check) ---
        if (clientIP) {
            try {
                const ipBan = await BannedIP.findOne({ ip: clientIP });
                if (ipBan && ipBan.bannedUntil.getTime() > Date.now()) {
                    console.log(`[InstanceRoom] Rejecting IP-banned connection: ${clientIP}`);
                    // IP_BANNED format - client shows "BANNED" instead of "ACCOUNT BANNED"
                    throw new Error(`IP_BANNED|${ipBan.bannedUntil.toISOString()}`);
                }
            } catch (err: any) {
                if (err.message && err.message.startsWith("IP_BANNED|")) throw err;
                console.error("Error checking IP ban:", err);
            }
        }
        
        // --- Account Ban Check ---
        if (odcid !== client.sessionId) {
            try {
                const user = await User.findById(odcid);
                if (user && user.bannedUntil && user.bannedUntil.getTime() > Date.now()) {
                    console.log(`[InstanceRoom] Rejecting banned user: ${user.username}`);
                    // Throw special error format for client to parse
                    // Format: ACCOUNT_BANNED|ISO_DATE_STRING
                    throw new Error(`ACCOUNT_BANNED|${user.bannedUntil.toISOString()}`);
                }
                
                // Track user's IP for future ban enforcement
                if (user && clientIP && user.lastKnownIP !== clientIP) {
                    user.lastKnownIP = clientIP;
                    await user.save();
                }
            } catch (err: any) {
                // If it's the ban error, rethrow it
                if (err.message && err.message.startsWith("ACCOUNT_BANNED|")) throw err;
                console.error("Error checking ban status:", err);
            }
        }
        
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
        // Position starts at (0, 0) - client will send actual spawn position immediately
        // Other clients wait for valid (non-zero) position before showing spawn effect
        const player = new InstancePlayerSchema();
        // player.x and player.y default to 0 in schema - client sends actual spawn position
        player.username = options.username || "Guest";
        player.odcid = odcid; // Use odcid for consistent coloring
        player.direction = 0; // Facing down
        
        this.state.players.set(client.sessionId, player);
        
        // Notify instance manager
        this.instanceManager.playerJoined(this.instanceId);
    }

    /**
     * Extract client IP from Colyseus client
     */
    private getClientIP(client: Client): string | null {
        try {
            // Colyseus exposes the underlying WebSocket
            const req = (client as any).req || (client as any)._req;
            if (req) {
                // Check for proxy headers first
                const forwarded = req.headers['x-forwarded-for'];
                if (forwarded) {
                    return forwarded.split(',')[0].trim();
                }
                const realIP = req.headers['x-real-ip'];
                if (realIP) {
                    return realIP;
                }
                // Fallback to socket address
                return req.socket?.remoteAddress || null;
            }
        } catch (e) {
            console.error("[InstanceRoom] Error getting client IP:", e);
        }
        return null;
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
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
        }
        if (this.afkCheckInterval) {
            clearInterval(this.afkCheckInterval);
        }
    }

    /**
     * Calculate and update the world time state
     */
    private updateWorldTime() {
        const time = calculateWorldTime();
        this.state.worldTime.year = time.year;
        this.state.worldTime.season = time.season;
        this.state.worldTime.dayOfYear = time.dayOfYear;
        this.state.worldTime.dayOfSeason = time.dayOfSeason;
        this.state.worldTime.hour = time.hour;
        this.state.worldTime.minute = time.minute;
        this.state.worldTime.second = time.second;
        this.state.worldTime.brightness = time.brightness;
    }
}
