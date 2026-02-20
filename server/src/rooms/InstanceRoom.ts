import { Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { IPlayer, PlayerAnim, calculateWorldTime, Season, DEFAULT_CHARACTER_APPEARANCE, getLootTable, selectFromLootTable, getItemDefinition, getRodStats, IPlayerStatsDelta, PlayerStatKey, PLAYER_STAT_KEYS, ClientMovementFrame, MovementInputState, ServerMovementReconcile, AINpcAnim } from "@cfwk/shared";
import { InstanceManager } from "../managers/InstanceManager";
import { InventoryCache } from "../managers/InventoryCache";
import { DEFAULT_INVENTORY_SLOTS } from "@cfwk/shared";
import { CommandProcessor } from "../utils/CommandProcessor";
import User from "../models/User";
import BannedIP from "../models/BannedIP";
import { PlayerStatsCache } from "../managers/PlayerStatsCache";
import { AI_METERS_TO_PIXELS, AI_NPC_DEFINITIONS, getAiControllerById } from "../ai/registry";
import { ServerMapNavService } from "../ai/ServerMapNavService";
import { AiNpcRuntimeState } from "../ai/types";

/**
 * Player state for instance rooms
 */
export class InstancePlayerSchema extends Schema implements IPlayer {
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("number") vx: number = 0;
    @type("number") vy: number = 0;
    @type("number") moveTs: number = 0;
    @type("string") anim: PlayerAnim = 'idle';
    @type("boolean") isFishing: boolean = false;
    @type("string") username: string = "";
    @type("boolean") isPremium: boolean = false; // Shark tier badge
    @type("string") odcid: string = ""; // MongoDB ObjectId for consistent color
    @type("number") direction: number = 0; // 0-7 for 8-way direction
    @type("boolean") isAfk: boolean = false; // AFK status for transparency
    @type("number") afkSince: number = 0; // Timestamp (ms) when AFK started
    @type("boolean") isGuiOpen: boolean = false; // Main GUI open state
    @type("boolean") isChatOpen: boolean = false; // Chat open/focused state
    @type("string") appearance: string = ""; // JSON-encoded ICharacterAppearance
}

/**
 * Dropped item state
 */
export class DroppedItemSchema extends Schema {
    @type("string") id: string = "";
    @type("string") itemId: string = "";
    @type("number") amount: number = 1;
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("number") createdAt: number = 0;
}

export class AiNpcHitboxSchema extends Schema {
    @type("number") width: number = 16;
    @type("number") height: number = 25;
    @type("number") collidableHeight: number = 6;
}

export class InstanceAiNpcSchema extends Schema {
    @type("string") id: string = "";
    @type("string") kind: string = "";
    @type("string") controllerId: string = "";
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("number") vx: number = 0;
    @type("number") vy: number = 0;
    @type("number") moveTs: number = 0;
    @type("number") direction: number = 0;
    @type("string") anim: AINpcAnim = 'idle';
    @type("number") tint: number = 0xffffff;
    @type("string") pathDebug: string = "";
    @type(AiNpcHitboxSchema) hitbox = new AiNpcHitboxSchema();
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
    @type({ map: InstanceAiNpcSchema }) aiNpcs = new MapSchema<InstanceAiNpcSchema>();
    @type({ map: DroppedItemSchema }) droppedItems = new MapSchema<DroppedItemSchema>();
    @type(WorldTimeSchema) worldTime = new WorldTimeSchema();
}

type PositionSnapshot = {
    tick: number;
    time: number;
    x: number;
    y: number;
};

type RuntimeMovementState = {
    lastSeq: number;
    lastClientTime: number;
    lastServerTime: number;
    vx: number;
    vy: number;
    input: MovementInputState;
    hardAuthorityUntil: number;
    impulseVx: number;
    impulseVy: number;
    impulseActiveUntil: number;
};

const WALK_SPEED = 96;
const SPRINT_SPEED = 192;
const ACCEL = 0.35;
const DRAG = 0.5;
const MAX_STEP_DT_MS = 120;
const HISTORY_SIZE = 120;
const SOFT_DISCREPANCY = 18;
const HARD_DISCREPANCY = 60;
const RECONCILE_INTERVAL_MS = 80;
const GAME_TPS = 20;

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
    private droppedItemCleanupInterval?: ReturnType<typeof setInterval>;
    private onlineTimeInterval?: ReturnType<typeof setInterval>;
    private statsBroadcastInterval?: ReturnType<typeof setInterval>;
    private fishingCasts = new Map<string, { depth: number; region: string; castAt: number; itemId?: string; clicksRequired?: number }>();
    private lastActivityBySession = new Map<string, number>();
    private movementRuntimeBySession = new Map<string, RuntimeMovementState>();
    private positionHistoryBySession = new Map<string, PositionSnapshot[]>();
    private lastReconcileSentAtBySession = new Map<string, number>();
    private gameTick: number = 0;
    private sprintStateBySession = new Map<string, boolean>();
    private pendingStatsDeltasBySession = new Map<string, IPlayerStatsDelta>();
    private navService = new ServerMapNavService();
    private aiRuntimeById = new Map<string, AiNpcRuntimeState>();

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

        this.instanceManager.events.on('inventory_update', (data: { userId: string; items: { index: number; itemId: string | null; count: number }[] }) => {
            this.clients.forEach(client => {
                const player = this.state.players.get(client.sessionId);
                if (player && player.odcid === data.userId) {
                    const equippedRodId = InventoryCache.getInstance().getEquippedRod(data.userId);
                    client.send('inventory', {
                        slots: data.items,
                        totalSlots: DEFAULT_INVENTORY_SLOTS,
                        equippedRodId
                    });
                }
            });
        });

        // Handle admin drop item command
        this.instanceManager.events.on('drop_item', (data: { userId: string; itemId: string; amount: number }) => {
            this.clients.forEach(client => {
                const player = this.state.players.get(client.sessionId);
                if (player && player.odcid === data.userId) {
                    this.createDroppedItem(data.itemId, data.amount, player.x, player.y);
                }
            });
        });

        this.instanceManager.events.on('beta_kick', (data: { userIds: string[]; reason?: string }) => {
            const idSet = new Set(data.userIds || []);
            if (idSet.size === 0) return;
            this.clients.forEach(client => {
                const player = this.state.players.get(client.sessionId);
                if (player && idSet.has(player.odcid)) {
                    client.leave(4004, data.reason || 'Beta access ended');
                }
            });
        });

        this.instanceId = options.instanceId;
        this.maxClients = options.maxPlayers;
        
        // Set up state
        const state = new InstanceState();
        state.instanceId = options.instanceId;
        state.locationId = options.locationId;
        state.mapFile = options.mapFile;
        this.setState(state);

        this.navService.initializeFromMap(options.mapFile);

        // Initialize world time
        this.updateWorldTime();

        // Update world time every second (client can interpolate for smoother updates)
        this.timeUpdateInterval = setInterval(() => {
            this.updateWorldTime();
        }, 1000);

        // Server-side AFK enforcement (authoritative)
        const afkWarnThresholdMs = 60000; // 1 minute before AFK state
        const afkKickThresholdMs = 300000; // 5 minutes base
        const premiumAfkKickThresholdMs = 1200000; // 20 minutes for Shark tier
        this.afkCheckInterval = setInterval(() => {
            const now = Date.now();
            this.clients.forEach(client => {
                const player = this.state.players.get(client.sessionId);
                if (!player) return;

                const lastActivity = this.lastActivityBySession.get(client.sessionId) ?? now;
                const idleMs = now - lastActivity;
                const threshold = player.isPremium ? premiumAfkKickThresholdMs : afkKickThresholdMs;

                if (idleMs >= afkWarnThresholdMs) {
                    if (!player.isAfk) {
                        player.isAfk = true;
                        player.afkSince = lastActivity + afkWarnThresholdMs;
                    }
                } else if (player.isAfk) {
                    player.isAfk = false;
                    player.afkSince = 0;
                }

                if (idleMs >= threshold) {
                    console.log(`[InstanceRoom] AFK kick (server) for ${client.sessionId}`);
                    client.leave(4000, "AFK timeout");
                }
            });
        }, 1000);

        const dropExpireMs = 5 * 60 * 1000;
        this.droppedItemCleanupInterval = setInterval(() => {
            const now = Date.now();
            this.state.droppedItems.forEach((drop, dropId) => {
                const createdAt = drop.createdAt || now;
                if (now - createdAt >= dropExpireMs) {
                    this.state.droppedItems.delete(dropId);
                }
            });
        }, 15000);

        this.onlineTimeInterval = setInterval(() => {
            this.clients.forEach((client) => {
                const player = this.state.players.get(client.sessionId);
                if (!player) return;

                this.incrementStat(client, player, 'timeOnlineMs', 5000);
            });
        }, 5000);

        this.statsBroadcastInterval = setInterval(() => {
            this.clients.forEach((client) => {
                const pending = this.pendingStatsDeltasBySession.get(client.sessionId);
                if (!pending) return;
                if (!this.hasAnyDelta(pending)) return;

                client.send('stats:delta', pending);
                this.pendingStatsDeltasBySession.set(client.sessionId, {});
            });
        }, 1000);

        this.setSimulationInterval((deltaTime) => {
            this.gameTick += 1;
            this.stepHardAuthorityMotion(deltaTime);
            this.stepAiNpcSimulation(deltaTime);
        }, 1000 / GAME_TPS);

        this.onMessage("ai:spawn", (client, data: { kind?: 'evil_tim'; x?: number; y?: number }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            const kind = data?.kind || 'evil_tim';
            const spawnX = Number.isFinite(data?.x) ? Number(data.x) : ((player?.x || 0) + 48);
            const spawnY = Number.isFinite(data?.y) ? Number(data.y) : (player?.y || 0);
            const id = this.spawnAiNpc(kind, spawnX, spawnY);

            if (!id) {
                client.send('chat', {
                    username: 'SYSTEM',
                    odcid: 'SYSTEM',
                    message: 'Failed to spawn AI NPC.',
                    timestamp: Date.now(),
                    isSystem: true
                });
                return;
            }

            client.send('chat', {
                username: 'SYSTEM',
                odcid: 'SYSTEM',
                message: `Spawned ${kind} (${id}) chase=${AI_NPC_DEFINITIONS[kind].controllerConfig.chaseRangeMeters}m.`,
                timestamp: Date.now(),
                isSystem: true
            });
        });

        this.onMessage("movement:frame", (client, frame: ClientMovementFrame) => {
            this.markActivity(client);
            this.handleMovementFrame(client, frame);
        });

        // Compatibility path during rollout: treat plain position as a hard override request.
        this.onMessage("position", (client, data: { x: number; y: number }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const runtime = this.ensureRuntimeState(client, player);
            runtime.lastSeq += 1;
            const syntheticFrame: ClientMovementFrame = {
                seq: runtime.lastSeq,
                clientTime: Date.now(),
                x: Number(data?.x) || player.x,
                y: Number(data?.y) || player.y,
                vx: player.vx || 0,
                vy: player.vy || 0,
                speedMultiplier: 1,
                input: {
                    up: false,
                    down: false,
                    left: false,
                    right: false,
                    sprint: false
                },
                anim: player.anim,
                direction: player.direction
            };
            this.handleMovementFrame(client, syntheticFrame);
        });

        // Handle animation sync
        this.onMessage("animation", (client, data: { anim: PlayerAnim; direction: number; isSprinting?: boolean }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.anim = data.anim;
                if (typeof data.direction === 'number') {
                    player.direction = data.direction;
                }
                if (typeof data.isSprinting === 'boolean') {
                    this.sprintStateBySession.set(client.sessionId, data.isSprinting);
                } else {
                    this.sprintStateBySession.set(client.sessionId, data.anim === 'run');
                }
            }
        });

        // Handle AFK status
        this.onMessage("afk", (client, data: { isAfk: boolean }) => {
            const player = this.state.players.get(client.sessionId);
            if (player) {
                if (data.isAfk) {
                    player.isAfk = true;
                    player.afkSince = player.afkSince || Date.now();
                } else {
                    this.markActivity(client);
                }
                console.log(`[InstanceRoom] Player ${client.sessionId} AFK: ${data.isAfk}`);
            }
        });

        // Handle GUI open state
        this.onMessage("gui", (client, data: { isOpen: boolean }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.isGuiOpen = data.isOpen;
            }
        });

        // Handle chat focus state
        this.onMessage("chatFocus", (client, data: { isOpen: boolean }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.isChatOpen = data.isOpen;
            }
        });

        // Handle shove interactions
        this.onMessage("shove", (client, data: { targetSessionId: string; clientTime?: number }) => {
            this.markActivity(client);
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
            
            const now = Date.now();
            const latencyMs = Number.isFinite(data?.clientTime) ? this.clampNumber(now - Number(data.clientTime), 0, 250) : 0;
            const rewindTime = now - latencyMs;
            const rewoundAttacker = this.getSnapshotAtTime(client.sessionId, rewindTime);
            const rewoundTarget = this.getSnapshotAtTime(data.targetSessionId, rewindTime);

            const attackerX = rewoundAttacker?.x ?? attacker.x;
            const attackerY = rewoundAttacker?.y ?? attacker.y;
            const targetX = rewoundTarget?.x ?? target.x;
            const targetY = rewoundTarget?.y ?? target.y;

            // Calculate distance between players (lag-compensated)
            const dx = targetX - attackerX;
            const dy = targetY - attackerY;
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
            
            // External impulse on target
            const shoveVelocity = 300;
            const impulseDurationMs = 180;

            this.applyServerImpulse(data.targetSessionId, dirX * shoveVelocity, dirY * shoveVelocity, impulseDurationMs, client.sessionId);

            // Broadcast interaction event for animation/effects.
            this.broadcast("shove", {
                attackerSessionId: client.sessionId,
                targetSessionId: data.targetSessionId
            });
            
            console.log(`[InstanceRoom] ${attacker.username} shoved ${target.username}`);
        });

        // Handle shove attempts (animation sync even on miss)
        this.onMessage("shoveAttempt", (client, data: { targetSessionId: string }) => {
            this.markActivity(client);
            this.broadcast("shoveAttempt", {
                attackerSessionId: client.sessionId,
                targetSessionId: data.targetSessionId
            });
        });

        // Handle fishing start (bubble sync)
        this.onMessage("fishing:start", (client, data: { rodItemId: string }) => {
            this.markActivity(client);
            this.broadcast("fishing:start", {
                sessionId: client.sessionId,
                rodItemId: data?.rodItemId ?? null
            });
        });

        // Handle fishing stop (bubble sync)
        this.onMessage("fishing:stop", (client) => {
            this.markActivity(client);
            this.broadcast("fishing:stop", {
                sessionId: client.sessionId
            });
        });

        // Handle fishing cast (server-side loot selection setup)
        this.onMessage("fishing:cast", (client, data: { depth?: number; region?: string }) => {
            this.markActivity(client);
            const depthRaw = typeof data?.depth === 'number' ? data.depth : 1;
            const depth = Math.max(1, Math.min(12, depthRaw));
            const region = typeof data?.region === 'string' && data.region ? data.region : 'temperate';
            this.fishingCasts.set(client.sessionId, { depth, region, castAt: Date.now() });
        });

        // Handle fishing hook (determine target item + required clicks)
        this.onMessage("fishing:hook", async (client) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const cast = this.fishingCasts.get(client.sessionId);
            if (!cast) return;

            if (cast.itemId && cast.clicksRequired) {
                client.send('fishing:hooked', { itemId: cast.itemId, clicksRequired: cast.clicksRequired });
                return;
            }

            const entries = getLootTable(cast.region as any);
            const equippedRodIdCurrent = InventoryCache.getInstance().getEquippedRod(player.odcid);
            const rodStats = getRodStats(equippedRodIdCurrent);
            const itemId = selectFromLootTable(entries, cast.depth, 'rickety', null, rodStats.rarityMultiplier);
            if (!itemId) return;

            const mass = getItemDefinition(itemId)?.mass ?? 1;
            const baseClicks = Math.ceil(mass * 1.5);
            const strength = Math.max(0.1, rodStats.strength);
            const clicksRequired = Math.max(1, Math.ceil(baseClicks * (1 / strength)));

            cast.itemId = itemId;
            cast.clicksRequired = clicksRequired;
            this.fishingCasts.set(client.sessionId, cast);
            client.send('fishing:hooked', { itemId, clicksRequired });
        });

        // Handle fishing catch (award item if cast exists)
        this.onMessage("fishing:catch", async (client) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const cast = this.fishingCasts.get(client.sessionId);
            if (!cast) return;

            const entries = getLootTable(cast.region as any);
            const equippedRodIdCurrent = InventoryCache.getInstance().getEquippedRod(player.odcid);
            const rodStats = getRodStats(equippedRodIdCurrent);
            const itemId = cast.itemId ?? selectFromLootTable(entries, cast.depth, 'rickety', null, rodStats.rarityMultiplier);
            this.fishingCasts.delete(client.sessionId);
            if (!itemId) return;

            this.incrementStat(client, player, 'catches', 1);

            const { items: currentSlots, equippedRodId: equippedRodIdFromState } = await InventoryCache.getInstance().getInventoryState(player.odcid);
            const stackSize = getItemDefinition(itemId)?.stackSize ?? 99;
            const hasStackSpace = currentSlots.some((slot) => slot.itemId === itemId && slot.count < stackSize);
            const hasEmptySlot = currentSlots.some((slot) => !slot.itemId || slot.count === 0);

            if (!hasStackSpace && !hasEmptySlot) {
                this.createDroppedItem(itemId, 1, player.x, player.y);
                client.send('inventory', { slots: currentSlots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId: equippedRodIdFromState });
                client.send('inventory:skip', { itemId, quantity: 1 });
                client.send('fishing:catchResult', { itemId });
                return;
            }

            const slots = await InventoryCache.getInstance().addItem(player.odcid, itemId, 1);
            client.send('inventory', { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId: equippedRodIdFromState });
            client.send('fishing:catchResult', { itemId });
        });

        this.onMessage('npc:interact', (client, data: { npcId?: string }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            if (!data || typeof data.npcId !== 'string' || !data.npcId.trim()) return;

            this.incrementStat(client, player, 'npcInteractions', 1);
        });

        // Handle pickup item interactions
        this.onMessage("pickupItem", async (client, data: { droppedItemId: string }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const droppedItem = this.state.droppedItems.get(data.droppedItemId);
            if (!droppedItem) return;

            const dx = droppedItem.x - player.x;
            const dy = droppedItem.y - player.y;
            const distance = Math.hypot(dx, dy);
            const maxPickupDistance = 18;

            if (distance > maxPickupDistance) return;

            const { items: currentSlots, equippedRodId: equippedRodIdFromState } = await InventoryCache.getInstance().getInventoryState(player.odcid);
            const stackSize = getItemDefinition(droppedItem.itemId)?.stackSize ?? 99;
            const hasStackSpace = currentSlots.some((slot) => slot.itemId === droppedItem.itemId && slot.count < stackSize);
            const hasEmptySlot = currentSlots.some((slot) => !slot.itemId || slot.count === 0);
            if (!hasStackSpace && !hasEmptySlot) {
                client.send('inventory', { slots: currentSlots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId: equippedRodIdFromState });
                client.send('inventory:skip', { itemId: droppedItem.itemId, quantity: droppedItem.amount });
                return;
            }

            this.state.droppedItems.delete(data.droppedItemId);

            const slots = await InventoryCache.getInstance().addItem(
                player.odcid,
                droppedItem.itemId,
                droppedItem.amount
            );
            const { equippedRodId } = await InventoryCache.getInstance().getInventoryState(player.odcid);

            client.send('inventory', { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId });
        });

        // Handle dropping items from player inventory
        this.onMessage("dropItem", async (client, data: { itemId: string; amount: number }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const amount = Math.max(1, Math.floor(data.amount || 1));
            if (!data.itemId) return;

            const updated = await InventoryCache.getInstance().removeItem(
                player.odcid,
                data.itemId,
                amount
            );

            if (!updated) return;

            this.createDroppedItem(data.itemId, amount, player.x, player.y);
            const { equippedRodId } = await InventoryCache.getInstance().getInventoryState(player.odcid);
            client.send('inventory', { slots: updated, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId });
        });

        // Handle inventory slot updates from client
        this.onMessage("inventory:set", async (client, data: { slots: { index: number; itemId: string | null; count: number }[] }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            if (!data || !Array.isArray(data.slots)) return;

            const normalized = data.slots
                .filter((slot) => typeof slot.index === 'number' && slot.index >= 0)
                .map((slot) => ({
                    index: Math.floor(slot.index),
                    itemId: slot.itemId ?? null,
                    count: Math.max(0, Math.floor(slot.count ?? 0))
                }))
                .slice(0, DEFAULT_INVENTORY_SLOTS)
                .sort((a, b) => a.index - b.index);

            // Pad to full size
            const padded = Array.from({ length: DEFAULT_INVENTORY_SLOTS }, (_v, i) => {
                const existing = normalized.find((s) => s.index === i);
                return existing ?? { index: i, itemId: null, count: 0 };
            });

            InventoryCache.getInstance().setInventory(player.odcid, padded);
            const equippedRodId = InventoryCache.getInstance().getEquippedRod(player.odcid);
            client.send('inventory', { slots: padded, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId });
        });

        // Handle chat messages
        this.onMessage("chat", async (client, data: { message: string }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            
            if (player && data.message) {
                const messageHelper = data.message.trim();

                // --- Command Handling ---
                if (messageHelper.startsWith('/')) {
                    if (messageHelper === '/spawn_evil_tim') {
                        const aiId = this.spawnAiNpc('evil_tim', player.x + 48, player.y);
                        client.send('chat', {
                            username: 'SYSTEM',
                            odcid: 'SYSTEM',
                            message: aiId
                                ? `Spawned Evil Tim (${aiId}) chase=${AI_NPC_DEFINITIONS.evil_tim.controllerConfig.chaseRangeMeters}m.`
                                : 'Failed to spawn Evil Tim.',
                            timestamp: Date.now(),
                            isSystem: true
                        });
                        return;
                    }

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
                    timestamp: Date.now(),
                    isPremium: player.isPremium
                });
                
                console.log(`[InstanceRoom] Chat from ${player.username}: ${data.message}`);
            }
        });
    }

    private createDroppedItem(itemId: string, amount: number, x: number, y: number) {
        const drop = new DroppedItemSchema();
        drop.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        drop.itemId = itemId;
        drop.amount = amount;
        drop.x = x;
        drop.y = y;
        drop.createdAt = Date.now();
        this.state.droppedItems.set(drop.id, drop);
    }

    private markActivity(client: Client) {
        const now = Date.now();
        this.lastActivityBySession.set(client.sessionId, now);

        const player = this.state.players.get(client.sessionId);
        if (player && player.isAfk) {
            player.isAfk = false;
            player.afkSince = 0;
        }
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
        let isPremium = false;
        let hasGameAccess = false;
        let userAppearance: string = ""; // JSON-encoded appearance
        if (odcid !== client.sessionId) {
            try {
                const user = await User.findById(odcid);
                if (user && user.bannedUntil && user.bannedUntil.getTime() > Date.now()) {
                    console.log(`[InstanceRoom] Rejecting banned user: ${user.username}`);
                    // Throw special error format for client to parse
                    // Format: ACCOUNT_BANNED|ISO_DATE_STRING
                    throw new Error(`ACCOUNT_BANNED|${user.bannedUntil.toISOString()}`);
                }

                if (user && Array.isArray(user.permissions)) {
                    isPremium = user.permissions.includes('premium.shark');
                    hasGameAccess = user.permissions.includes('access.game');
                }

                if (user && user.betaAccessUntil && user.betaAccessUntil.getTime() > Date.now()) {
                    hasGameAccess = true;
                }
                
                // Load character appearance for remote player rendering (always include, use defaults if missing)
                const appearance = user?.characterAppearance || DEFAULT_CHARACTER_APPEARANCE;
                userAppearance = JSON.stringify(appearance);
                
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

        if (odcid !== client.sessionId && !hasGameAccess) {
            console.log(`[InstanceRoom] Rejecting connection without access: ${odcid}`);
            throw new Error("NO_ACCESS");
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
        player.isPremium = isPremium;
        player.odcid = odcid; // Use odcid for consistent coloring
        player.direction = 0; // Facing down
        player.appearance = userAppearance; // Character customization data
        player.moveTs = Date.now();
        
        this.state.players.set(client.sessionId, player);
        this.lastActivityBySession.set(client.sessionId, Date.now());
        this.pendingStatsDeltasBySession.set(client.sessionId, {});
        this.sprintStateBySession.set(client.sessionId, false);
        this.movementRuntimeBySession.set(client.sessionId, {
            lastSeq: 0,
            lastClientTime: 0,
            lastServerTime: Date.now(),
            vx: 0,
            vy: 0,
            input: { up: false, down: false, left: false, right: false, sprint: false },
            hardAuthorityUntil: 0,
            impulseVx: 0,
            impulseVy: 0,
            impulseActiveUntil: 0
        });
        this.positionHistoryBySession.set(client.sessionId, [{
            tick: this.gameTick,
            time: Date.now(),
            x: player.x,
            y: player.y
        }]);

        // Send initial inventory to the client on join
        try {
            const { items: slots, equippedRodId } = await InventoryCache.getInstance().getInventoryState(odcid);
            client.send('inventory', { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId });
        } catch (err) {
            console.error('[InstanceRoom] Error sending initial inventory:', err);
        }

        // Handle equipment updates from client
        this.onMessage("equipment:set", async (client, data: { equippedRodId: string | null }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const equippedRodId = data?.equippedRodId ?? null;
            InventoryCache.getInstance().setEquippedRod(player.odcid, equippedRodId);

            const { items: slots } = await InventoryCache.getInstance().getInventoryState(player.odcid);
            client.send('inventory', { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId });
        });
        
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
        this.fishingCasts.delete(client.sessionId);
        this.lastActivityBySession.delete(client.sessionId);
        this.pendingStatsDeltasBySession.delete(client.sessionId);
        this.sprintStateBySession.delete(client.sessionId);
        this.movementRuntimeBySession.delete(client.sessionId);
        this.positionHistoryBySession.delete(client.sessionId);
        this.lastReconcileSentAtBySession.delete(client.sessionId);
        
        // Notify instance manager
        this.instanceManager.playerLeft(this.instanceId);
    }

    onDispose() {
        console.log(`[InstanceRoom] Instance ${this.instanceId} disposed`);
        this.aiRuntimeById.clear();
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
        }
        if (this.afkCheckInterval) {
            clearInterval(this.afkCheckInterval);
        }
        if (this.droppedItemCleanupInterval) {
            clearInterval(this.droppedItemCleanupInterval);
        }
        if (this.onlineTimeInterval) {
            clearInterval(this.onlineTimeInterval);
        }
        if (this.statsBroadcastInterval) {
            clearInterval(this.statsBroadcastInterval);
        }
    }

    private stepHardAuthorityMotion(deltaTimeMs: number) {
        const now = Date.now();
        const dtSec = this.clampNumber(deltaTimeMs / 1000, 0.001, 0.12);

        this.clients.forEach((client) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const runtime = this.movementRuntimeBySession.get(client.sessionId);
            if (!runtime) return;
            if (now >= runtime.hardAuthorityUntil) return;

            const prevX = player.x;
            const prevY = player.y;

            runtime.vx *= 0.9;
            runtime.vy *= 0.9;
            player.x += runtime.vx * dtSec;
            player.y += runtime.vy * dtSec;
            player.vx = runtime.vx;
            player.vy = runtime.vy;
            player.moveTs = now;

            const movedDistance = Math.hypot(player.x - prevX, player.y - prevY);
            if (movedDistance > 0.01) {
                const isSprinting = this.sprintStateBySession.get(client.sessionId) === true || player.anim === 'run';
                if (isSprinting) {
                    this.incrementStat(client, player, 'distanceRan', movedDistance);
                } else {
                    this.incrementStat(client, player, 'distanceWalked', movedDistance);
                }
            }

            this.recordPositionSnapshot(client.sessionId, player.x, player.y, now);
            this.sendMovementReconcile(client, player, runtime.lastSeq, 'hard-server', false, 0, 'external-force');
        });
    }

    private ensureRuntimeState(client: Client, player: InstancePlayerSchema): RuntimeMovementState {
        const existing = this.movementRuntimeBySession.get(client.sessionId);
        if (existing) return existing;

        const runtime: RuntimeMovementState = {
            lastSeq: 0,
            lastClientTime: 0,
            lastServerTime: Date.now(),
            vx: player.vx || 0,
            vy: player.vy || 0,
            input: { up: false, down: false, left: false, right: false, sprint: false },
            hardAuthorityUntil: 0,
            impulseVx: 0,
            impulseVy: 0,
            impulseActiveUntil: 0
        };
        this.movementRuntimeBySession.set(client.sessionId, runtime);
        return runtime;
    }

    private sanitizeMovementInput(input?: Partial<MovementInputState>): MovementInputState {
        return {
            up: input?.up === true,
            down: input?.down === true,
            left: input?.left === true,
            right: input?.right === true,
            sprint: input?.sprint === true
        };
    }

    private predictKinematicStep(
        baseX: number,
        baseY: number,
        baseVx: number,
        baseVy: number,
        input: MovementInputState,
        dtSec: number,
        speedMultiplier = 1
    ) {
        let moveX = 0;
        let moveY = 0;
        if (input.left) moveX -= 1;
        if (input.right) moveX += 1;
        if (input.up) moveY -= 1;
        if (input.down) moveY += 1;

        const len = Math.hypot(moveX, moveY);
        if (len > 0) {
            moveX /= len;
            moveY /= len;
        }

        const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
        const speedScale = this.clampNumber(speedMultiplier, 0.35, 1.2);
        const targetVx = moveX * speed * speedScale;
        const targetVy = moveY * speed * speedScale;

        let nextVx = baseVx;
        let nextVy = baseVy;
        if (len > 0) {
            nextVx = baseVx + (targetVx - baseVx) * ACCEL;
            nextVy = baseVy + (targetVy - baseVy) * ACCEL;
        } else {
            nextVx = baseVx * (1 - DRAG);
            nextVy = baseVy * (1 - DRAG);
        }

        return {
            x: baseX + nextVx * dtSec,
            y: baseY + nextVy * dtSec,
            vx: nextVx,
            vy: nextVy
        };
    }

    private handleMovementFrame(client: Client, frame: ClientMovementFrame) {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;

        const runtime = this.ensureRuntimeState(client, player);
        if (!Number.isFinite(frame?.seq) || frame.seq <= runtime.lastSeq) {
            return;
        }

        const now = Date.now();
        const input = this.sanitizeMovementInput(frame.input);
        const speedMultiplier = Number.isFinite(frame.speedMultiplier) ? frame.speedMultiplier : 1;
        const dtMs = this.clampNumber(now - runtime.lastServerTime, 8, MAX_STEP_DT_MS);
        const dtSec = dtMs / 1000;

        const expected = this.predictKinematicStep(player.x, player.y, runtime.vx, runtime.vy, input, dtSec, speedMultiplier);

        // Additive impulse: incorporate decaying impulse into position prediction
        const hasActiveImpulse = now < runtime.impulseActiveUntil &&
            (Math.abs(runtime.impulseVx) > 0.5 || Math.abs(runtime.impulseVy) > 0.5);
        const inputOnlyVx = expected.vx;
        const inputOnlyVy = expected.vy;
        if (hasActiveImpulse) {
            expected.x += runtime.impulseVx * dtSec;
            expected.y += runtime.impulseVy * dtSec;
            // Time-based decay matching client's per-frame 0.88 at 60fps
            const decayFactor = Math.pow(0.88, dtMs / 16.667);
            runtime.impulseVx *= decayFactor;
            runtime.impulseVy *= decayFactor;
            if (Math.abs(runtime.impulseVx) < 0.5) runtime.impulseVx = 0;
            if (Math.abs(runtime.impulseVy) < 0.5) runtime.impulseVy = 0;
        }

        const clientX = Number.isFinite(frame.x) ? frame.x : expected.x;
        const clientY = Number.isFinite(frame.y) ? frame.y : expected.y;
        const clientVx = Number.isFinite(frame.vx) ? frame.vx : expected.vx;
        const clientVy = Number.isFinite(frame.vy) ? frame.vy : expected.vy;

        const errorDistance = Math.hypot(clientX - expected.x, clientY - expected.y);
        // Widen thresholds during impulse to tolerate decay timing differences
        const softThreshold = hasActiveImpulse ? SOFT_DISCREPANCY * 3 : SOFT_DISCREPANCY;
        const hardThreshold = hasActiveImpulse ? HARD_DISCREPANCY * 2.5 : HARD_DISCREPANCY;
        const isSpawnBootstrap = runtime.lastSeq === 0 && player.x === 0 && player.y === 0 && frame.seq === 1;

        let nextX = expected.x;
        let nextY = expected.y;
        let nextVx = expected.vx;
        let nextVy = expected.vy;
        let authority: ServerMovementReconcile['authority'] = 'soft-client';
        let hardOverride = false;
        let reason = 'soft-accept';

        if (isSpawnBootstrap) {
            nextX = clientX;
            nextY = clientY;
            nextVx = clientVx;
            nextVy = clientVy;
            authority = 'soft-client';
            reason = 'spawn-bootstrap';
        } else if (errorDistance <= softThreshold) {
            nextX = clientX;
            nextY = clientY;
            nextVx = clientVx;
            nextVy = clientVy;
            authority = 'soft-client';
            reason = 'soft-accept';
        } else if (errorDistance <= hardThreshold) {
            nextX = this.lerpNumber(expected.x, clientX, 0.35);
            nextY = this.lerpNumber(expected.y, clientY, 0.35);
            nextVx = this.lerpNumber(expected.vx, clientVx, 0.35);
            nextVy = this.lerpNumber(expected.vy, clientVy, 0.35);
            authority = 'soft-client';
            reason = 'soft-correct';
        } else {
            authority = 'hard-server';
            hardOverride = true;
            reason = 'speed-clamp';
        }

        const prevX = player.x;
        const prevY = player.y;

        player.x = nextX;
        player.y = nextY;
        player.vx = nextVx;
        player.vy = nextVy;
        player.moveTs = now;

        runtime.vx = hasActiveImpulse ? inputOnlyVx : nextVx;
        runtime.vy = hasActiveImpulse ? inputOnlyVy : nextVy;
        runtime.input = input;
        runtime.lastSeq = frame.seq;
        runtime.lastClientTime = Number.isFinite(frame.clientTime) ? frame.clientTime : now;
        runtime.lastServerTime = now;

        const isSprintingNow = input.sprint || frame.anim === 'run';
        this.sprintStateBySession.set(client.sessionId, isSprintingNow);

        const movedDistance = Math.hypot(nextX - prevX, nextY - prevY);
        if (movedDistance > 0.01) {
            if (isSprintingNow) {
                this.incrementStat(client, player, 'distanceRan', movedDistance);
            } else {
                this.incrementStat(client, player, 'distanceWalked', movedDistance);
            }
        }

        if (typeof frame.anim === 'string') {
            player.anim = frame.anim;
        }
        if (typeof frame.direction === 'number') {
            player.direction = frame.direction;
        }

        this.recordPositionSnapshot(client.sessionId, nextX, nextY, now);
        this.sendMovementReconcile(client, player, frame.seq, authority, hardOverride, errorDistance, reason);
    }

    private sendMovementReconcile(
        client: Client,
        player: InstancePlayerSchema,
        seqAck: number,
        authority: ServerMovementReconcile['authority'],
        hardOverride: boolean,
        errorDistance: number,
        reason?: string
    ) {
        const now = Date.now();
        const lastSentAt = this.lastReconcileSentAtBySession.get(client.sessionId) || 0;
        if (!hardOverride && now - lastSentAt < RECONCILE_INTERVAL_MS) {
            return;
        }

        const payload: ServerMovementReconcile = {
            seqAck,
            serverTick: this.gameTick,
            serverTime: now,
            x: player.x,
            y: player.y,
            vx: player.vx,
            vy: player.vy,
            authority,
            hardOverride,
            errorDistance,
            reason
        };
        client.send('movement:reconcile', payload);
        this.lastReconcileSentAtBySession.set(client.sessionId, now);
    }

    private recordPositionSnapshot(sessionId: string, x: number, y: number, time: number) {
        const history = this.positionHistoryBySession.get(sessionId) || [];
        history.push({ tick: this.gameTick, time, x, y });
        if (history.length > HISTORY_SIZE) {
            history.splice(0, history.length - HISTORY_SIZE);
        }
        this.positionHistoryBySession.set(sessionId, history);
    }

    private getSnapshotAtTime(sessionId: string, timestamp: number): PositionSnapshot | null {
        const history = this.positionHistoryBySession.get(sessionId);
        if (!history || history.length === 0) return null;

        if (timestamp <= history[0].time) {
            return history[0];
        }

        const last = history[history.length - 1];
        if (timestamp >= last.time) {
            return last;
        }

        for (let i = 1; i < history.length; i += 1) {
            const prev = history[i - 1];
            const next = history[i];
            if (timestamp < prev.time || timestamp > next.time) continue;

            const span = Math.max(1, next.time - prev.time);
            const t = this.clampNumber((timestamp - prev.time) / span, 0, 1);
            return {
                tick: next.tick,
                time: timestamp,
                x: this.lerpNumber(prev.x, next.x, t),
                y: this.lerpNumber(prev.y, next.y, t)
            };
        }

        return last;
    }

    private applyServerImpulse(sessionId: string, vx: number, vy: number, durationMs: number, sourceSessionId: string) {
        const player = this.state.players.get(sessionId);
        if (!player) return;

        const now = Date.now();

        const runtime = this.movementRuntimeBySession.get(sessionId) || {
            lastSeq: 0,
            lastClientTime: 0,
            lastServerTime: now,
            vx: player.vx || 0,
            vy: player.vy || 0,
            input: { up: false, down: false, left: false, right: false, sprint: false },
            hardAuthorityUntil: 0,
            impulseVx: 0,
            impulseVy: 0,
            impulseActiveUntil: 0
        };
        this.movementRuntimeBySession.set(sessionId, runtime);

        runtime.impulseVx += vx;
        runtime.impulseVy += vy;
        runtime.impulseActiveUntil = Math.max(runtime.impulseActiveUntil, now + durationMs + 500);
        runtime.lastServerTime = now;

        player.moveTs = now;

        this.recordPositionSnapshot(sessionId, player.x, player.y, now);

        const targetClient = this.clients.find((entry) => entry.sessionId === sessionId);
        if (targetClient) {
            targetClient.send('movement:impulse', {
                sourceSessionId,
                vx,
                vy,
                durationMs,
                authority: 'soft-client',
                serverTick: this.gameTick,
                serverTime: now
            });
        }
    }

    private stepAiNpcSimulation(deltaTimeMs: number) {
        if (this.aiRuntimeById.size === 0) return;

        const now = Date.now();
        const deltaSec = this.clampNumber(deltaTimeMs / 1000, 0.001, 0.2);
        const players: Array<{ sessionId: string; x: number; y: number }> = [];
        this.state.players.forEach((player, sessionId) => {
            players.push({ sessionId, x: player.x, y: player.y });
        });

        this.aiRuntimeById.forEach((runtime, id) => {
            const controller = getAiControllerById(runtime.controllerId);
            if (!controller) return;

            controller.update(runtime, {
                tick: this.gameTick,
                now,
                deltaSec,
                metersToPixels: (meters) => meters * AI_METERS_TO_PIXELS,
                players,
                nav: this.navService,
                random: () => Math.random()
            });

            const schema = this.state.aiNpcs.get(id);
            if (!schema) return;

            schema.x = runtime.x;
            schema.y = runtime.y;
            schema.vx = runtime.vx;
            schema.vy = runtime.vy;
            schema.moveTs = runtime.moveTs || now;
            schema.direction = runtime.direction;
            schema.anim = runtime.anim;
            schema.tint = runtime.tint;
            schema.pathDebug = runtime.chasePath.length > 0
                ? runtime.chasePath.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join(';')
                : '';
        });
    }

    private spawnAiNpc(kind: 'evil_tim', x: number, y: number): string | null {
        const definition = AI_NPC_DEFINITIONS[kind];
        if (!definition) return null;

        const id = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const npcSchema = new InstanceAiNpcSchema();
        npcSchema.id = id;
        npcSchema.kind = definition.kind;
        npcSchema.controllerId = definition.controllerId;
        npcSchema.x = x;
        npcSchema.y = y;
        npcSchema.vx = 0;
        npcSchema.vy = 0;
        npcSchema.moveTs = Date.now();
        npcSchema.direction = 0;
        npcSchema.anim = 'idle';
        npcSchema.tint = definition.tint;
        npcSchema.pathDebug = '';
        npcSchema.hitbox.width = definition.hitbox.width;
        npcSchema.hitbox.height = definition.hitbox.height;
        npcSchema.hitbox.collidableHeight = definition.hitbox.collidableHeight;

        this.state.aiNpcs.set(id, npcSchema);

        const pathTickOffset = Math.floor(Math.random() * Math.max(1, definition.controllerConfig.pathRecomputeFrequencyTicks));
        this.aiRuntimeById.set(id, {
            id,
            kind: definition.kind,
            controllerId: definition.controllerId,
            x,
            y,
            vx: 0,
            vy: 0,
            moveTs: npcSchema.moveTs,
            direction: 0,
            anim: 'idle',
            tint: definition.tint,
            hitbox: {
                width: definition.hitbox.width,
                height: definition.hitbox.height,
                collidableHeight: definition.hitbox.collidableHeight
            },
            mode: 'idle',
            chasePath: [],
            chasePathIndex: 0,
            lastIdleCheckTick: this.gameTick,
            lastPathRecomputeTick: this.gameTick - pathTickOffset,
            controllerConfig: { ...definition.controllerConfig }
        });

        return id;
    }

    private clampNumber(value: number, min: number, max: number): number {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    private lerpNumber(a: number, b: number, t: number): number {
        const alpha = this.clampNumber(t, 0, 1);
        return a + (b - a) * alpha;
    }

    private getStatsUserId(client: Client, player: InstancePlayerSchema): string | null {
        if (!player.odcid || player.odcid === client.sessionId) return null;
        return player.odcid;
    }

    private incrementStat(client: Client, player: InstancePlayerSchema, key: PlayerStatKey, amount: number) {
        if (!Number.isFinite(amount) || amount <= 0) return;

        const statsUserId = this.getStatsUserId(client, player);
        if (!statsUserId) return;

        PlayerStatsCache.getInstance().incrementStat(statsUserId, key, amount);

        const pending = this.pendingStatsDeltasBySession.get(client.sessionId) || {};
        pending[key] = (pending[key] || 0) + amount;
        this.pendingStatsDeltasBySession.set(client.sessionId, pending);
    }

    private hasAnyDelta(delta: IPlayerStatsDelta): boolean {
        for (const key of PLAYER_STAT_KEYS) {
            if ((delta[key] || 0) > 0) return true;
        }
        return false;
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
