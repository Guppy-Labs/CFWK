import { Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import fs from "fs";
import path from "path";
import { IPlayer, PlayerAnim, calculateWorldTime, Season, DEFAULT_CHARACTER_APPEARANCE, getLootTable, selectFromLootTable, getItemDefinition, getRodStats, IPlayerStatsDelta, PlayerStatKey, PLAYER_STAT_KEYS, ClientMovementFrame, MovementInputState, ServerMovementReconcile, AINpcAnim, AINpcKind, SOFT_COLLISION_FORCE, SOFT_COLLISION_PLAYER_FOOT_HITBOX, IAdvancementAlertMessage, IAdvancementsState, IGuideTutorialState, DEFAULT_INVENTORY_SLOTS, DEFAULT_PLAYER_HEARTS_STATE, IPlayerHeartsState, isEquippableUsableItem, DEFAULT_PLAYER_MONEY_STATE, GlimmerbowlEntry } from "@cfwk/shared";
import { InstanceManager } from "../managers/InstanceManager";
import { InventoryCache } from "../managers/InventoryCache";
import { GlimmerbowlCache } from "../managers/GlimmerbowlCache";
import { CommandProcessor } from "../utils/CommandProcessor";
import User from "../models/User";
import BannedIP from "../models/BannedIP";
import { PlayerStatsCache } from "../managers/PlayerStatsCache";
import { AI_METERS_TO_PIXELS, AI_NPC_DEFINITIONS, getAiControllerById } from "../ai/registry";
import { ServerMapNavService } from "../ai/ServerMapNavService";
import { AiNpcRuntimeState } from "../ai/types";
import { AdvancementsManager } from "../managers/AdvancementsManager";
import { CommandAuditLogger } from "../utils/CommandAuditLogger";

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
    @type("number") refinementProgress: number = 0;
    @type("number") refinementRequiredSteps: number = 0;
    @type("string") refinementResultItemId: string = "";
    @type("string") liquidContainerItemId: string = "";
    @type("string") liquidOutputItemId: string = "";
    @type("string") liquidConfirmText: string = "";
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
        @type("number") currentHealth: number = 1;
        @type("number") maxHealth: number = 1;
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
const HARD_DISCREPANCY = 90;
const MAX_LATENCY_ESTIMATE_MS = 350;
const MAX_LATENCY_THRESHOLD_SCALE = 2.25;
const RECONCILE_INTERVAL_MS = 80;
const GAME_TPS = 20;
const YEKBUSH_COMPONENT_ID = 'yekbush';
const YEKBUSH_INTERACTION_RADIUS_PX = 3 * 32;
const YEKBUSH_COOLDOWN_MS = 40_000;
const GLIMMERING_CHEST_COMPONENT_ID = 'glimmeringchest';
const GLIMMERING_KEY_ITEM_ID = 'glimmeringkey';
const GLIMMERING_CHEST_INTERACTION_RADIUS_PX = 3 * 32;
const HEED_THE_WARNING_QUEST_ID = 'heed_the_warning';
const ENEMY_BRIDGE_CUSTOM_ID = 'ah-enemy-dialogue-check';
const ENEMY_BRIDGE_WARN_COOLDOWN_MS = 10_000;
const ENEMY_BRIDGE_IMPULSE_SPEED = 220;
const ENEMY_BRIDGE_IMPULSE_DURATION_MS = 220;
const DANGER_REGION_NAME = 'Danger';
const DROP_REFINEMENT_TOUCH_RADIUS_PX = 18;
const DROP_REFINEMENT_TOUCH_COOLDOWN_MS = 220;

type DropRefinementRecipe = {
    sourceItemId: string;
    requiredSteps: number;
    liquidItemId: string;
};

type LiquidCollectionRecipe = {
    liquidItemId: string;
    containerItemId: string;
    outputItemId: string;
    confirmText: string;
};

const DROP_REFINEMENT_RECIPES_BY_SOURCE = new Map<string, DropRefinementRecipe>([
    ['yekberries', {
        sourceItemId: 'yekberries',
        requiredSteps: 4,
        liquidItemId: 'yekjuiceliquid'
    }]
]);

const LIQUID_COLLECTION_RECIPES_BY_LIQUID = new Map<string, LiquidCollectionRecipe>([
    ['yekjuiceliquid', {
        liquidItemId: 'yekjuiceliquid',
        containerItemId: 'jar',
        outputItemId: 'yekjuice',
        confirmText: 'Confirm Consuming 1 Jar'
    }]
]);

type TiledProperty = { name: string; value: unknown };

type TiledMapObject = {
    id?: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    polygon?: Array<{ x: number; y: number }>;
    properties?: TiledProperty[];
};

type TiledLayer = {
    name?: string;
    type?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    data?: unknown[];
    objects?: TiledMapObject[];
};

type TiledMap = {
    layers?: TiledLayer[];
};

type InteractiveHarvestTarget = {
    objectId: number;
    componentId: string;
    centerX: number;
    centerY: number;
    radiusPx: number;
};

type ChestInteractionTarget = {
    componentId: string;
    centerX: number;
    centerY: number;
    radiusPx: number;
};

type SpawnRegionRuntime = {
    id: number;
    npcKind: AINpcKind;
    polygon: Array<{ x: number; y: number }>;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    maxSpawned: number;
    restoreRateMs: number;
    aliveNpcIds: Set<string>;
    nextSpawnAtMs: number;
};

type CustomTriggerRuntime = {
    customId: string;
    polygon: Array<{ x: number; y: number }>;
    centerX: number;
    centerY: number;
};

type RegionRuntime = {
    name: string;
    polygon: Array<{ x: number; y: number }>;
};

const GREMLIN_DEATH_ANIM_MS = 1400;

type SoftCollisionBody = {
    id: string;
    kind: 'player' | 'ai';
    x: number;
    y: number;
    halfWidth: number;
    halfHeight: number;
    pushX: number;
    pushY: number;
};

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
    private tutorialStateBySession = new Map<string, IGuideTutorialState>();
    private glimmerbowlUnlockedByUserId = new Map<string, boolean>();
    private hasOwnedScarByUserId = new Map<string, boolean>();
    private heartsByUserId = new Map<string, IPlayerHeartsState>();
    private moneyByUserId = new Map<string, number>();
    private wipedUserIds = new Set<string>();
    private harvestTargetsByObjectId = new Map<number, InteractiveHarvestTarget>();
    private harvestCooldownByUserId = new Map<string, Map<number, number>>();
    private chestInteractionTarget: ChestInteractionTarget | null = null;
    private navService = new ServerMapNavService();
    private aiRuntimeById = new Map<string, AiNpcRuntimeState>();
    private spawnRegions: SpawnRegionRuntime[] = [];
    private aiSpawnRegionByNpcId = new Map<string, SpawnRegionRuntime>();
    private customTriggersById = new Map<string, CustomTriggerRuntime>();
    private enemyBridgeWarnCooldownByUserId = new Map<string, number>();
    private enemyBridgeUnlockedByUserId = new Map<string, boolean>();
    private heedTheWarningStayObjectiveByUserId = new Map<string, boolean>();
    private dangerRegion: RegionRuntime | null = null;
    private wasInDangerByUserId = new Map<string, boolean>();
    private dropRefineTouchByUserAndDrop = new Map<string, number>();
    private advancementsManager = new AdvancementsManager('lobby.tmj');

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
            void this.setHasOwnedScarFromInventory(data.userId, data.items);
            this.clients.forEach(client => {
                const player = this.state.players.get(client.sessionId);
                if (player && player.odcid === data.userId) {
                    const equippedRodId = InventoryCache.getInstance().getEquippedRod(data.userId);
                    const equippedUsableIds = InventoryCache.getInstance().getEquippedUsables(data.userId);
                    client.send('inventory', {
                        slots: data.items,
                        totalSlots: DEFAULT_INVENTORY_SLOTS,
                        equippedRodId,
                        equippedUsableIds
                    });
                }
            });
        });

        this.instanceManager.events.on('glimmerbowl_update', (data: { userId: string; entries: GlimmerbowlEntry[]; unlocked?: boolean; hasOwnedScar?: boolean }) => {
            void (async () => {
                const hasOwnedScar = typeof data.hasOwnedScar === 'boolean'
                    ? data.hasOwnedScar
                    : await this.hasOwnedScar(data.userId);
                this.clients.forEach(client => {
                    const player = this.state.players.get(client.sessionId);
                    if (player && player.odcid === data.userId) {
                        client.send('glimmerbowl', {
                            entries: data.entries,
                            unlocked: data.unlocked ?? true,
                            hasOwnedScar
                        });
                    }
                });
            })();
        });

        this.instanceManager.events.on('money_update', (data: { userId: string; money: number }) => {
            const nextMoney = this.normalizeMoneyAmount(data.money);
            this.moneyByUserId.set(data.userId, nextMoney);
            this.clients.forEach((client) => {
                const player = this.state.players.get(client.sessionId);
                if (player && player.odcid === data.userId) {
                    client.send('player:money', { money: nextMoney });
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

        this.instanceManager.events.on('send_user', (data: { userId: string; locationId: string }) => {
            this.clients.forEach(client => {
                const player = this.state.players.get(client.sessionId);
                if (player && player.odcid === data.userId) {
                    client.send('server:transfer', {
                        locationId: data.locationId
                    });
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

        this.instanceManager.events.on('clear_progress', (data: { userId: string }) => {
            this.advancementsManager.clearCachedUser(data.userId);

            this.clients.forEach((client) => {
                const player = this.state.players.get(client.sessionId);
                if (!player || player.odcid !== data.userId) return;

                void this.advancementsManager.getStateForUser(data.userId)
                    .then((state) => {
                        this.updateHeedTheWarningUnlockState(data.userId, state);
                        client.send('advancements:state', state);
                    })
                    .catch((error) => {
                        console.error('[InstanceRoom] Failed to push advancements state after clear_progress:', error);
                    });
            });
        });

        this.instanceManager.events.on('wipe_user', (data: { userId: string }) => {
            this.advancementsManager.clearCachedUser(data.userId);
            PlayerStatsCache.getInstance().resetUser(data.userId);
            this.glimmerbowlUnlockedByUserId.set(data.userId, false);
            this.hasOwnedScarByUserId.set(data.userId, false);
            this.heartsByUserId.set(data.userId, { ...DEFAULT_PLAYER_HEARTS_STATE });
            this.moneyByUserId.set(data.userId, DEFAULT_PLAYER_MONEY_STATE.money);
            this.enemyBridgeWarnCooldownByUserId.delete(data.userId);
            this.enemyBridgeUnlockedByUserId.delete(data.userId);
            this.heedTheWarningStayObjectiveByUserId.delete(data.userId);
            this.wasInDangerByUserId.delete(data.userId);
            this.wipedUserIds.add(data.userId);

            this.clients.forEach((client) => {
                const player = this.state.players.get(client.sessionId);
                if (!player || player.odcid !== data.userId) return;

                this.pendingStatsDeltasBySession.delete(client.sessionId);
                client.leave(4005, 'Your gameplay data was wiped. Please reconnect.');
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

        this.harvestTargetsByObjectId = this.loadHarvestTargets(options.mapFile);
        this.chestInteractionTarget = this.loadChestInteractionTarget(options.mapFile);
        this.harvestCooldownByUserId.clear();
        this.spawnRegions = this.loadSpawnRegions(options.mapFile);
        this.aiSpawnRegionByNpcId.clear();
        this.customTriggersById = this.loadCustomTriggers(options.mapFile);
        this.dangerRegion = this.loadRegionByName(options.mapFile, DANGER_REGION_NAME);
        this.enemyBridgeWarnCooldownByUserId.clear();
        this.enemyBridgeUnlockedByUserId.clear();
        this.heedTheWarningStayObjectiveByUserId.clear();
        this.wasInDangerByUserId.clear();

        this.navService.initializeFromMap(options.mapFile);
        this.advancementsManager = new AdvancementsManager(options.mapFile);

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
            this.stepSoftEntityCollisions(deltaTime);
            this.stepEnemySpawning();
        }, 1000 / GAME_TPS);

        this.onMessage("ai:spawn", (client, data: { kind?: AINpcKind; x?: number; y?: number }) => {
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
            const hasMovementInput = Boolean(
                frame?.input?.up ||
                frame?.input?.down ||
                frame?.input?.left ||
                frame?.input?.right ||
                frame?.input?.sprint
            );
            if (hasMovementInput) {
                this.markActivity(client);
            }
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

        this.onMessage('player:hearts:request', (client) => {
            this.sendPlayerHeartsSnapshot(client);
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
            if (target.isAfk) {
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
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.isFishing = true;
                player.vx = 0;
                player.vy = 0;
                player.anim = 'idle';
                player.moveTs = Date.now();

                const runtime = this.movementRuntimeBySession.get(client.sessionId);
                if (runtime) {
                    runtime.vx = 0;
                    runtime.vy = 0;
                    runtime.input = { up: false, down: false, left: false, right: false, sprint: false };
                    runtime.impulseVx = 0;
                    runtime.impulseVy = 0;
                    runtime.impulseActiveUntil = 0;
                    runtime.lastServerTime = Date.now();
                }
            }
            this.broadcast("fishing:start", {
                sessionId: client.sessionId,
                rodItemId: data?.rodItemId ?? null
            });
        });

        // Handle fishing stop (bubble sync)
        this.onMessage("fishing:stop", (client) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.isFishing = false;
                player.moveTs = Date.now();
            }
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
            const guidedTutorial = this.tutorialStateBySession.get(client.sessionId);
            const forcedItemId = guidedTutorial?.forceSalmonCatch ? 'salmon' : null;
            const itemId = forcedItemId ?? selectFromLootTable(entries, cast.depth, 'rickety', null, rodStats.rarityMultiplier);
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
            const guidedTutorial = this.tutorialStateBySession.get(client.sessionId);
            const forcedItemId = guidedTutorial?.forceSalmonCatch ? 'salmon' : null;
            const forceGlimmeringKey = await this.shouldForceGlimmeringKeyCatch(player.odcid, player.x, player.y);
            const itemId = forceGlimmeringKey
                ? 'glimmeringkey'
                : (forcedItemId ?? cast.itemId ?? selectFromLootTable(entries, cast.depth, 'rickety', null, rodStats.rarityMultiplier));
            this.fishingCasts.delete(client.sessionId);
            if (!itemId) return;

            const itemDef = getItemDefinition(itemId);
            if (!itemDef) return;

            this.incrementStat(client, player, 'catches', 1);
            const advancementUpdates = forceGlimmeringKey
                ? await this.advancementsManager.onFishCatchNearLocation(player.odcid, 'KeyLocation')
                : await this.advancementsManager.onFishCatch(player.odcid);
            await this.sendAdvancements(client, advancementUpdates);

            const glimmerbowlUnlocked = await this.isGlimmerbowlUnlocked(player.odcid);
            if (itemDef.category === 'Fish' && glimmerbowlUnlocked) {
                const migrated = await GlimmerbowlCache.getInstance().migrateInventoryFishToGlimmerbowl(player.odcid);
                if (migrated.movedFish && migrated.slots) {
                    client.send('inventory', {
                        slots: migrated.slots,
                        totalSlots: DEFAULT_INVENTORY_SLOTS,
                        equippedRodId: migrated.equippedRodId ?? null
                    });
                }
                const glimmerEntries = await GlimmerbowlCache.getInstance().addFish(player.odcid, itemId, 1, 'regular');
                client.send('glimmerbowl', {
                    entries: glimmerEntries,
                    unlocked: true,
                    hasOwnedScar: await this.hasOwnedScar(player.odcid)
                });
                client.send('fishing:catchResult', { itemId });
                return;
            }

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
            await this.setHasOwnedScarFromInventory(player.odcid, slots);
            client.send('inventory', { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId: equippedRodIdFromState });
            client.send('fishing:catchResult', { itemId });
        });

        this.onMessage('npc:interact', (client, data: { npcId?: string }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            if (!data || typeof data.npcId !== 'string' || !data.npcId.trim()) return;

            this.incrementStat(client, player, 'npcInteractions', 1);
            void this.advancementsManager.onNpcInteract(player.odcid, data.npcId.trim())
                .then(async (updates) => {
                    await this.sendAdvancements(client, updates);
                    await this.syncInventoryCountObjectives(client, player.odcid);
                })
                .catch((error) => {
                    console.error('[InstanceRoom] npc advancements failed:', error);
                });
        });

        this.onMessage('interactive:harvest', async (client, data: { objectId?: number; componentId?: string }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const componentId = typeof data?.componentId === 'string'
                ? data.componentId.trim().toLowerCase()
                : YEKBUSH_COMPONENT_ID;
            if (componentId !== YEKBUSH_COMPONENT_ID) return;

            const objectId = Number.isFinite(data?.objectId)
                ? Math.floor(Number(data?.objectId))
                : -1;
            if (objectId <= 0) return;

            const target = this.harvestTargetsByObjectId.get(objectId);
            if (!target || target.componentId !== componentId) return;

            const distance = Math.hypot(player.x - target.centerX, player.y - target.centerY);
            if (distance > target.radiusPx) return;

            const now = Date.now();
            const cooldownMap = this.getOrCreateHarvestCooldownMap(player.odcid);
            const readyAt = cooldownMap.get(objectId) ?? 0;
            if (readyAt > now) {
                client.send('interactive:harvest:cooldown', {
                    objectId,
                    componentId,
                    centerX: target.centerX,
                    centerY: target.centerY,
                    cooldownMs: YEKBUSH_COOLDOWN_MS,
                    readyAt,
                    remainingMs: readyAt - now
                });
                return;
            }

            const quantity = Math.random() < 0.2 ? 2 : 1;
            const itemId = 'yekberries';

            const { items: currentSlots } = await InventoryCache.getInstance().getInventoryState(player.odcid);
            const stackSize = getItemDefinition(itemId)?.stackSize ?? 99;
            const hasStackSpace = currentSlots.some((slot) => slot.itemId === itemId && slot.count < stackSize);
            const hasEmptySlot = currentSlots.some((slot) => !slot.itemId || slot.count === 0);

            let updatedSlots = currentSlots;
            if (hasStackSpace || hasEmptySlot) {
                updatedSlots = await InventoryCache.getInstance().addItem(player.odcid, itemId, quantity);
            } else {
                this.createDroppedItem(itemId, quantity, player.x, player.y);
                client.send('inventory:skip', { itemId, quantity });
            }

            const nextReadyAt = now + YEKBUSH_COOLDOWN_MS;
            cooldownMap.set(objectId, nextReadyAt);

            const { equippedRodId, equippedUsableIds } = await InventoryCache.getInstance().getInventoryState(player.odcid);
            client.send('inventory', {
                slots: updatedSlots,
                totalSlots: DEFAULT_INVENTORY_SLOTS,
                equippedRodId,
                equippedUsableIds
            });

            client.send('interactive:harvest:success', {
                objectId,
                componentId,
                centerX: target.centerX,
                centerY: target.centerY,
                quantity,
                itemId,
                cooldownMs: YEKBUSH_COOLDOWN_MS,
                readyAt: nextReadyAt
            });

            void this.advancementsManager.onHarvestInteractive(player.odcid, componentId, objectId)
                .then(async (updates) => {
                    await this.sendAdvancements(client, updates);
                    await this.sendInventoryCountObjectiveForItem(client, player.odcid, itemId, updatedSlots);
                })
                .catch((error) => {
                    console.error('[InstanceRoom] harvest advancements failed:', error);
                });
        });

        this.onMessage('interactive:chest', async (client, data: { objectId?: number; componentId?: string }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const componentId = typeof data?.componentId === 'string'
                ? data.componentId.trim().toLowerCase()
                : '';
            if (componentId !== GLIMMERING_CHEST_COMPONENT_ID) return;

            const target = this.chestInteractionTarget;
            if (!target || target.componentId !== componentId) return;

            const distance = Math.hypot(player.x - target.centerX, player.y - target.centerY);
            if (distance > target.radiusPx) return;

            const activeChestObjective = await this.advancementsManager.getActiveHarvestObjective(player.odcid, componentId);
            if (!activeChestObjective) return;

            const updatedSlots = await InventoryCache.getInstance().removeItem(player.odcid, GLIMMERING_KEY_ITEM_ID, 1);
            if (!updatedSlots) return;

            const unlockState = await GlimmerbowlCache.getInstance().unlockForUser(player.odcid);
            this.glimmerbowlUnlockedByUserId.set(player.odcid, true);

            const inventorySlotsToSend = unlockState.movedFish && Array.isArray(unlockState.slots)
                ? unlockState.slots
                : updatedSlots;
            const { equippedRodId, equippedUsableIds } = await InventoryCache.getInstance().getInventoryState(player.odcid);
            client.send('inventory', {
                slots: inventorySlotsToSend,
                totalSlots: DEFAULT_INVENTORY_SLOTS,
                equippedRodId,
                equippedUsableIds
            });
            client.send('glimmerbowl', {
                entries: unlockState.entries,
                unlocked: true,
                hasOwnedScar: await this.hasOwnedScar(player.odcid)
            });

            const advancementUpdates = await this.advancementsManager.onHarvestInteractive(player.odcid, componentId);
            await this.sendAdvancements(client, advancementUpdates);

            client.send('interactive:chest:opened', {
                componentId,
                centerX: target.centerX,
                centerY: target.centerY
            });
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
            const maxPickupDistance = 42;

            if (distance > maxPickupDistance) return;

            const liquidContainerItemId = typeof droppedItem.liquidContainerItemId === 'string' ? droppedItem.liquidContainerItemId : '';
            const liquidOutputItemId = typeof droppedItem.liquidOutputItemId === 'string' ? droppedItem.liquidOutputItemId : '';
            if (liquidContainerItemId && liquidOutputItemId) {
                const { items: currentSlots } = await InventoryCache.getInstance().getInventoryState(player.odcid);
                const hasContainer = currentSlots.some((slot) => slot.itemId === liquidContainerItemId && slot.count > 0);
                if (!hasContainer) return;

                const removedContainerSlots = await InventoryCache.getInstance().removeItem(player.odcid, liquidContainerItemId, 1);
                if (!removedContainerSlots) return;

                this.state.droppedItems.delete(data.droppedItemId);
                const outputSlots = await InventoryCache.getInstance().addItem(
                    player.odcid,
                    liquidOutputItemId,
                    Math.max(1, Math.floor(droppedItem.amount || 1))
                );
                const { equippedRodId, equippedUsableIds } = await InventoryCache.getInstance().getInventoryState(player.odcid);
                client.send('inventory', {
                    slots: outputSlots,
                    totalSlots: DEFAULT_INVENTORY_SLOTS,
                    equippedRodId,
                    equippedUsableIds
                });

                void this.advancementsManager.onLiquidBottled(
                    player.odcid,
                    droppedItem.itemId,
                    liquidContainerItemId,
                    liquidOutputItemId
                ).then((updates) => this.sendAdvancements(client, updates))
                    .catch((error) => {
                        console.error('[InstanceRoom] liquid bottling advancements failed:', error);
                    });
                return;
            }

            const droppedItemDef = getItemDefinition(droppedItem.itemId);
            if (!droppedItemDef) return;

            const glimmerbowlUnlocked = await this.isGlimmerbowlUnlocked(player.odcid);

            if (droppedItemDef.category === 'Fish' && glimmerbowlUnlocked) {
                const migrated = await GlimmerbowlCache.getInstance().migrateInventoryFishToGlimmerbowl(player.odcid);
                if (migrated.movedFish && migrated.slots) {
                    client.send('inventory', {
                        slots: migrated.slots,
                        totalSlots: DEFAULT_INVENTORY_SLOTS,
                        equippedRodId: migrated.equippedRodId ?? null
                    });
                }
                this.state.droppedItems.delete(data.droppedItemId);
                const entries = await GlimmerbowlCache.getInstance().addFish(
                    player.odcid,
                    droppedItem.itemId,
                    droppedItem.amount,
                    'regular'
                );
                client.send('glimmerbowl', {
                    entries,
                    unlocked: true,
                    hasOwnedScar: await this.hasOwnedScar(player.odcid)
                });
                return;
            }

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
            await this.setHasOwnedScarFromInventory(player.odcid, slots);
            const { equippedRodId } = await InventoryCache.getInstance().getInventoryState(player.odcid);

            client.send('inventory', { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId });
            await this.sendInventoryCountObjectiveForItem(client, player.odcid, droppedItem.itemId, slots);
        });

        // Handle dropping items from player inventory
        this.onMessage("dropItem", async (client, data: { itemId: string; amount: number }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const amount = Math.max(1, Math.floor(data.amount || 1));
            if (!data.itemId) return;

            const itemDef = getItemDefinition(data.itemId);
            if (!itemDef) return;

            const glimmerbowlUnlocked = await this.isGlimmerbowlUnlocked(player.odcid);
            if (itemDef.category === 'Fish' && glimmerbowlUnlocked) {
                const migrated = await GlimmerbowlCache.getInstance().migrateInventoryFishToGlimmerbowl(player.odcid);
                if (migrated.movedFish && migrated.slots) {
                    client.send('inventory', {
                        slots: migrated.slots,
                        totalSlots: DEFAULT_INVENTORY_SLOTS,
                        equippedRodId: migrated.equippedRodId ?? null
                    });
                }
                const glimmerUpdated = await GlimmerbowlCache.getInstance().removeFish(
                    player.odcid,
                    data.itemId,
                    amount
                );
                if (!glimmerUpdated) return;

                this.createDroppedItem(data.itemId, amount, player.x, player.y);
                client.send('glimmerbowl', {
                    entries: glimmerUpdated,
                    unlocked: true,
                    hasOwnedScar: await this.hasOwnedScar(player.odcid)
                });
                return;
            }

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

        this.onMessage('glimmerbowl:awaken', async (client, data: { fishEntryId?: string; scarItemId?: string }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            const fishEntryId = typeof data?.fishEntryId === 'string' ? data.fishEntryId.trim() : '';
            const scarItemId = typeof data?.scarItemId === 'string' ? data.scarItemId.trim() : '';
            if (!fishEntryId || !scarItemId) return;

            const glimmerbowlUnlocked = await this.isGlimmerbowlUnlocked(player.odcid);
            if (!glimmerbowlUnlocked) return;

            try {
                const result = await GlimmerbowlCache.getInstance().awakenFish(player.odcid, fishEntryId, scarItemId);
                const { equippedRodId, equippedUsableIds } = await InventoryCache.getInstance().getInventoryState(player.odcid);
                client.send('inventory', {
                    slots: result.slots,
                    totalSlots: DEFAULT_INVENTORY_SLOTS,
                    equippedRodId,
                    equippedUsableIds
                });
                client.send('glimmerbowl', {
                    entries: result.entries,
                    unlocked: true,
                    hasOwnedScar: await this.hasOwnedScar(player.odcid)
                });
            } catch (error) {
                // Ignore invalid awaken attempts silently to match existing room message behavior.
                console.warn('[InstanceRoom] glimmerbowl awaken rejected:', error);
            }
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
            const equippedUsableIds = InventoryCache.getInstance().getEquippedUsables(player.odcid);
            client.send('inventory', { slots: padded, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId, equippedUsableIds });
        });

        // Handle chat messages
        this.onMessage("chat", async (client, data: { message: string }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            
            if (player && data.message) {
                const messageHelper = data.message.trim();

                // --- Command Handling ---
                if (messageHelper.startsWith('/')) {
                    const parts = messageHelper.slice(1).split(' ').filter(Boolean);
                    const command = (parts[0] || '').toLowerCase();
                    const args = parts.slice(1);
                    const auditBase = {
                        timestamp: new Date().toISOString(),
                        playerId: player.odcid,
                        playerUsername: player.username,
                        command,
                        args
                    };

                    if (command === 'spawn_evil_tim') {
                        const aiId = this.spawnAiNpc('evil_tim', player.x + 48, player.y);
                        const message = aiId
                            ? `Spawned Evil Tim (${aiId}) chase=${AI_NPC_DEFINITIONS.evil_tim.controllerConfig.chaseRangeMeters}m.`
                            : 'Failed to spawn Evil Tim.';
                        await CommandAuditLogger.log({
                            ...auditBase,
                            success: Boolean(aiId),
                            resultMessage: message
                        });
                        client.send('chat', {
                            username: 'SYSTEM',
                            odcid: 'SYSTEM',
                            message,
                            timestamp: Date.now(),
                            isSystem: true
                        });
                        return;
                    }

                    let commandResultMessage = 'Command failed unexpectedly.';
                    let commandSuccess = false;
                    try {
                        const result = await CommandProcessor.handleCommand(
                            command,
                            args,
                            player.odcid,
                            player.username
                        );
                        commandResultMessage = result.message;
                        commandSuccess = result.success;
                    } catch (error) {
                        commandResultMessage = 'Command failed unexpectedly.';
                        commandSuccess = false;
                        console.error('[InstanceRoom] Command execution failed:', error);
                    }

                    await CommandAuditLogger.log({
                        ...auditBase,
                        success: commandSuccess,
                        resultMessage: commandResultMessage
                    });
                    
                    // Send result back to issuer only
                    client.send('chat', {
                        username: 'SYSTEM',
                        odcid: 'SYSTEM',
                        message: commandResultMessage,
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

                const chatText = data.message.slice(0, 100);
                void this.advancementsManager.onChatMessage(player.odcid, player.x, player.y, chatText)
                    .then((alerts) => {
                        alerts.forEach((alert) => client.send('advancement:alert', alert));
                    })
                    .catch((error) => {
                        console.error('[InstanceRoom] chat advancements failed:', error);
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
        const refinementRecipe = DROP_REFINEMENT_RECIPES_BY_SOURCE.get(itemId);
        if (refinementRecipe) {
            drop.refinementProgress = 0;
            drop.refinementRequiredSteps = Math.max(1, refinementRecipe.requiredSteps);
            drop.refinementResultItemId = refinementRecipe.liquidItemId;
        }
        const liquidRecipe = LIQUID_COLLECTION_RECIPES_BY_LIQUID.get(itemId);
        if (liquidRecipe) {
            drop.liquidContainerItemId = liquidRecipe.containerItemId;
            drop.liquidOutputItemId = liquidRecipe.outputItemId;
            drop.liquidConfirmText = liquidRecipe.confirmText;
        }
        this.state.droppedItems.set(drop.id, drop);
    }

    private tryRefineDropsFromMovement(client: Client, player: InstancePlayerSchema, nextX: number, nextY: number, now: number) {
        this.state.droppedItems.forEach((drop, dropId) => {
            if (!drop.refinementResultItemId || drop.refinementRequiredSteps <= 0) return;
            if (!drop.itemId || !DROP_REFINEMENT_RECIPES_BY_SOURCE.has(drop.itemId)) return;
            const distance = Math.hypot(drop.x - nextX, drop.y - nextY);
            if (distance > DROP_REFINEMENT_TOUCH_RADIUS_PX) return;

            const touchKey = `${player.odcid}:${dropId}`;
            const lastTouchAt = this.dropRefineTouchByUserAndDrop.get(touchKey) ?? 0;
            if ((now - lastTouchAt) < DROP_REFINEMENT_TOUCH_COOLDOWN_MS) return;
            this.dropRefineTouchByUserAndDrop.set(touchKey, now);

            drop.refinementProgress = Math.max(0, drop.refinementProgress) + 1;
            if (drop.refinementProgress < Math.max(1, drop.refinementRequiredSteps)) return;

            const fromItemId = drop.itemId;
            const toLiquidItemId = drop.refinementResultItemId;
            const liquidRecipe = LIQUID_COLLECTION_RECIPES_BY_LIQUID.get(toLiquidItemId);
            drop.itemId = toLiquidItemId;
            drop.amount = 1;
            drop.refinementProgress = 0;
            drop.refinementRequiredSteps = 0;
            drop.refinementResultItemId = '';
            drop.liquidContainerItemId = liquidRecipe?.containerItemId ?? '';
            drop.liquidOutputItemId = liquidRecipe?.outputItemId ?? '';
            drop.liquidConfirmText = liquidRecipe?.confirmText ?? '';

            void this.advancementsManager.onFoodRefined(player.odcid, fromItemId, toLiquidItemId)
                .then((updates) => this.sendAdvancements(client, updates))
                .catch((error) => {
                    console.error('[InstanceRoom] food refinement advancements failed:', error);
                });
        });
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
        let initialHearts: IPlayerHeartsState = { ...DEFAULT_PLAYER_HEARTS_STATE };
        let initialMoney = DEFAULT_PLAYER_MONEY_STATE.money;
        let persistedJoinX: number | null = null;
        let persistedJoinY: number | null = null;
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
                const storedHearts = (user as any)?.hearts;
                if (storedHearts && typeof storedHearts === 'object') {
                    initialHearts = this.normalizeHeartsState({
                        currentHearts: Number((storedHearts as any).currentHearts),
                        maxHearts: Number((storedHearts as any).maxHearts)
                    });
                }
                if (typeof (user as any)?.lastPositionX === 'number' && typeof (user as any)?.lastPositionY === 'number') {
                    persistedJoinX = Number((user as any).lastPositionX);
                    persistedJoinY = Number((user as any).lastPositionY);
                }
                initialMoney = this.normalizeMoneyAmount((user as any)?.money);
                
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

        if (odcid !== client.sessionId) {
            await this.advancementsManager.initializeUser(odcid);
        }

        console.log(`[InstanceRoom] ${client.sessionId} joined instance ${this.instanceId}`);
        
        // Register this connection
        if (odcid !== client.sessionId) {
            this.instanceManager.registerUserConnection(odcid, client.sessionId);

            User.updateOne(
                { _id: odcid },
                { $set: { lastLocationId: this.state.locationId } }
            ).catch((err) => {
                console.error('[InstanceRoom] Failed to persist lastLocationId:', err);
            });
        }
        
        // Store odcid on client for cleanup on leave
        (client as any).odcid = odcid;
        
        // Create player state
        // Position starts at (0, 0) - client will send actual spawn position immediately
        // Other clients wait for valid (non-zero) position before showing spawn effect
        const player = new InstancePlayerSchema();
        if (typeof persistedJoinX === 'number' && typeof persistedJoinY === 'number') {
            player.x = persistedJoinX;
            player.y = persistedJoinY;
        }
        player.username = options.username || "Guest";
        player.isPremium = isPremium;
        player.odcid = odcid; // Use odcid for consistent coloring
        player.direction = 0; // Facing down
        player.appearance = userAppearance; // Character customization data
        player.moveTs = Date.now();
        
        this.state.players.set(client.sessionId, player);
        this.heartsByUserId.set(odcid, initialHearts);
        this.moneyByUserId.set(odcid, initialMoney);
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
            const { items: slots, equippedRodId, equippedUsableIds } = await InventoryCache.getInstance().getInventoryState(odcid);
            client.send('inventory', { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId, equippedUsableIds });
        } catch (err) {
            console.error('[InstanceRoom] Error sending initial inventory:', err);
        }

        this.sendPlayerHeartsSnapshot(client, initialHearts);
        this.sendPlayerMoneySnapshot(client, initialMoney);

        try {
            const { entries, unlocked } = await GlimmerbowlCache.getInstance().getState(odcid);
            const hasOwnedScar = await this.hasOwnedScar(odcid);
            this.glimmerbowlUnlockedByUserId.set(odcid, unlocked);
            client.send('glimmerbowl', { entries, unlocked, hasOwnedScar });
        } catch (err) {
            console.error('[InstanceRoom] Error sending initial glimmerbowl:', err);
        }

        try {
            const advancementsState = await this.advancementsManager.getStateForUser(odcid);
            this.updateHeedTheWarningUnlockState(odcid, advancementsState);
            this.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial);
            client.send('advancements:state', advancementsState);
        } catch (err) {
            console.error('[InstanceRoom] Error sending initial advancements state:', err);
        }

        this.onMessage('advancements:get', async (client) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            try {
                const advancementsState = await this.advancementsManager.getStateForUser(player.odcid);
                this.updateHeedTheWarningUnlockState(player.odcid, advancementsState);
                this.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial);
                client.send('advancements:state', advancementsState);
            } catch (err) {
                console.error('[InstanceRoom] Error responding with advancements state:', err);
            }
        });

        this.onMessage('guide:update', async (client, data: { tutorial?: Partial<IGuideTutorialState> }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const tutorialPatch = data?.tutorial;
            if (!tutorialPatch || typeof tutorialPatch !== 'object') return;

            try {
                const advancementsState = await this.advancementsManager.updateTutorialState(player.odcid, tutorialPatch);
                if (!advancementsState) return;
                this.updateHeedTheWarningUnlockState(player.odcid, advancementsState);
                this.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial);
                client.send('advancements:state', advancementsState);
            } catch (error) {
                console.error('[InstanceRoom] Failed to update guide tutorial state:', error);
            }
        });

        // Handle equipment updates from client
        this.onMessage("equipment:set", async (client, data: { equippedRodId?: string | null; equippedUsableIds?: Array<string | null> }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const equippedRodId = data?.equippedRodId ?? null;
            InventoryCache.getInstance().setEquippedRod(player.odcid, equippedRodId);
            if (Array.isArray(data?.equippedUsableIds)) {
                InventoryCache.getInstance().setEquippedUsables(player.odcid, data.equippedUsableIds);
            }

            const { items: slots, equippedUsableIds } = await InventoryCache.getInstance().getInventoryState(player.odcid);
            client.send('inventory', { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId, equippedUsableIds });
        });

        this.onMessage('item:use', async (client, data: { slotIndex?: number }) => {
            this.markActivity(client);
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            const slotIndex = typeof data?.slotIndex === 'number' ? Math.floor(data.slotIndex) : -1;
            if (slotIndex < 0) return;

            const equippedUsables = InventoryCache.getInstance().getEquippedUsables(player.odcid);
            if (slotIndex >= equippedUsables.length) return;

            const equippedItemId = equippedUsables[slotIndex];
            if (!equippedItemId) return;

            const itemDef = getItemDefinition(equippedItemId);
            if (!isEquippableUsableItem(itemDef)) return;

            const { items: currentSlots } = await InventoryCache.getInstance().getInventoryState(player.odcid);
            const inventoryCountForItem = currentSlots
                .filter((slot) => slot.itemId === equippedItemId)
                .reduce((sum, slot) => sum + slot.count, 0);

            let updatedSlots = currentSlots;
            if (inventoryCountForItem > 0) {
                const removed = await InventoryCache.getInstance().removeItem(player.odcid, equippedItemId, 1);
                if (!removed) return;
                updatedSlots = removed;
            }

            const nextUsables = [...equippedUsables];
            nextUsables[slotIndex] = null;
            InventoryCache.getInstance().setEquippedUsables(player.odcid, nextUsables);

            const guidedTutorial = this.tutorialStateBySession.get(client.sessionId);
            const forceGuideFoodHeal = guidedTutorial?.forceFoodGuideHeal === true && equippedItemId === 'yekberries';

            if (itemDef?.category === 'Food') {
                const score = Math.max(0, Math.floor(itemDef.foodScore ?? 0));
                const guaranteed = Math.floor(score / 100);
                const remainder = score - guaranteed * 100;
                const bonus = Math.random() * 100 < remainder ? 1 : 0;
                const restoreHearts = forceGuideFoodHeal ? Math.max(1, guaranteed + bonus) : (guaranteed + bonus);

                if (restoreHearts > 0) {
                    const current = this.heartsByUserId.get(player.odcid) ?? { ...DEFAULT_PLAYER_HEARTS_STATE };
                    const next = this.normalizeHeartsState({
                        currentHearts: current.currentHearts + restoreHearts,
                        maxHearts: current.maxHearts
                    });
                    this.heartsByUserId.set(player.odcid, next);
                    client.send('player:hearts', next);
                    if (player.odcid !== client.sessionId) {
                        await User.updateOne({ _id: player.odcid }, { $set: { hearts: next } });
                    }
                }
            }

            if (forceGuideFoodHeal) {
                try {
                    const advancementsState = await this.advancementsManager.updateTutorialState(player.odcid, {
                        forceFoodGuideHeal: false
                    });
                    if (advancementsState) {
                        this.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial);
                        client.send('advancements:state', advancementsState);
                    }
                } catch (error) {
                    console.error('[InstanceRoom] Failed clearing food guide heal flag:', error);
                }
            }

            const { equippedRodId, equippedUsableIds } = await InventoryCache.getInstance().getInventoryState(player.odcid);
            client.send('inventory', {
                slots: updatedSlots,
                totalSlots: DEFAULT_INVENTORY_SLOTS,
                equippedRodId,
                equippedUsableIds
            });
            client.send('inventory:consumed', {
                itemId: equippedItemId,
                quantity: 1,
                slotIndex
            });
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
        const departingPlayer = this.state.players.get(client.sessionId);
        
        // Unregister user connection
        const odcid = (client as any).odcid;
        if (odcid) {
            this.harvestCooldownByUserId.delete(odcid);
            this.enemyBridgeWarnCooldownByUserId.delete(odcid);
            this.enemyBridgeUnlockedByUserId.delete(odcid);
            this.heedTheWarningStayObjectiveByUserId.delete(odcid);
            this.wasInDangerByUserId.delete(odcid);
            const prefix = `${odcid}:`;
            Array.from(this.dropRefineTouchByUserAndDrop.keys()).forEach((key) => {
                if (key.startsWith(prefix)) {
                    this.dropRefineTouchByUserAndDrop.delete(key);
                }
            });
        }
        if (odcid && odcid !== client.sessionId) {
            this.instanceManager.unregisterUserConnection(odcid);
            this.glimmerbowlUnlockedByUserId.delete(odcid);
            this.hasOwnedScarByUserId.delete(odcid);
            this.heartsByUserId.delete(odcid);
            this.moneyByUserId.delete(odcid);
            const isWipedSession = this.wipedUserIds.has(odcid);

            if (departingPlayer && !isWipedSession) {
                User.updateOne(
                    { _id: odcid },
                    {
                        $set: {
                            lastLocationId: this.state.locationId,
                            lastPositionX: departingPlayer.x,
                            lastPositionY: departingPlayer.y
                        }
                    }
                ).catch((err) => {
                    console.error('[InstanceRoom] Failed to persist last known player position:', err);
                });
            }

            if (isWipedSession) {
                this.wipedUserIds.delete(odcid);
            }
        }
        
        this.state.players.delete(client.sessionId);
        this.fishingCasts.delete(client.sessionId);
        this.tutorialStateBySession.delete(client.sessionId);
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
        this.spawnRegions = [];
        this.aiSpawnRegionByNpcId.clear();
        this.customTriggersById.clear();
        this.enemyBridgeWarnCooldownByUserId.clear();
        this.enemyBridgeUnlockedByUserId.clear();
        this.heedTheWarningStayObjectiveByUserId.clear();
        this.wasInDangerByUserId.clear();
        this.dropRefineTouchByUserAndDrop.clear();
        this.dangerRegion = null;
        this.glimmerbowlUnlockedByUserId.clear();
        this.hasOwnedScarByUserId.clear();
        this.heartsByUserId.clear();
        this.moneyByUserId.clear();
        this.harvestCooldownByUserId.clear();
        this.harvestTargetsByObjectId.clear();
        this.chestInteractionTarget = null;
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

    private async isGlimmerbowlUnlocked(userId: string): Promise<boolean> {
        const cached = this.glimmerbowlUnlockedByUserId.get(userId);
        if (cached !== undefined) return cached;

        const unlocked = await GlimmerbowlCache.getInstance().isUnlocked(userId);
        this.glimmerbowlUnlockedByUserId.set(userId, unlocked);
        return unlocked;
    }

    private async hasOwnedScar(userId: string): Promise<boolean> {
        const cached = this.hasOwnedScarByUserId.get(userId);
        if (cached !== undefined) return cached;

        const user = await User.findById(userId).select('hasOwnedScar').lean();
        const hasOwnedScar = Boolean((user as any)?.hasOwnedScar);
        this.hasOwnedScarByUserId.set(userId, hasOwnedScar);
        return hasOwnedScar;
    }

    private async setHasOwnedScar(userId: string): Promise<void> {
        const cached = this.hasOwnedScarByUserId.get(userId);
        if (cached) return;
        this.hasOwnedScarByUserId.set(userId, true);
        await User.updateOne({ _id: userId }, { $set: { hasOwnedScar: true } });
    }

    private async setHasOwnedScarFromInventory(userId: string, items: Array<{ itemId: string | null; count: number }>): Promise<void> {
        if (await this.hasOwnedScar(userId)) return;
        const hasScarInInventory = items.some((slot) => {
            if (!slot.itemId || slot.count <= 0) return false;
            return Boolean(getItemDefinition(slot.itemId)?.scar);
        });
        if (!hasScarInInventory) return;
        await this.setHasOwnedScar(userId);
        const glimmerState = await GlimmerbowlCache.getInstance().getState(userId);
        this.instanceManager.events.emit('glimmerbowl_update', {
            userId,
            entries: glimmerState.entries,
            unlocked: glimmerState.unlocked,
            hasOwnedScar: true
        });
    }

    private normalizeHeartsState(input: IPlayerHeartsState): IPlayerHeartsState {
        const maxHearts = Math.max(1, Math.floor(Number.isFinite(input.maxHearts) ? input.maxHearts : DEFAULT_PLAYER_HEARTS_STATE.maxHearts));
        const currentHearts = Math.max(0, Math.min(maxHearts, Math.floor(Number.isFinite(input.currentHearts) ? input.currentHearts : maxHearts)));
        return {
            currentHearts,
            maxHearts
        };
    }

    private normalizeMoneyAmount(input: number): number {
        return Math.max(0, Math.floor(Number.isFinite(input) ? input : DEFAULT_PLAYER_MONEY_STATE.money));
    }

    private getOrCreateHarvestCooldownMap(userId: string): Map<number, number> {
        let cooldownMap = this.harvestCooldownByUserId.get(userId);
        if (cooldownMap) return cooldownMap;
        cooldownMap = new Map<number, number>();
        this.harvestCooldownByUserId.set(userId, cooldownMap);
        return cooldownMap;
    }

    private loadHarvestTargets(mapFileName: string): Map<number, InteractiveHarvestTarget> {
        const targets = new Map<number, InteractiveHarvestTarget>();
        const mapPath = this.resolveMapPath(mapFileName);
        if (!mapPath) return targets;

        try {
            const raw = fs.readFileSync(mapPath, 'utf8');
            const map = JSON.parse(raw) as TiledMap;
            const interactivesLayer = (map.layers ?? []).find((layer) => layer.type === 'objectgroup' && layer.name === 'Interactives');
            if (!interactivesLayer || !Array.isArray(interactivesLayer.objects)) return targets;

            for (const object of interactivesLayer.objects) {
                if (!Number.isFinite(object.id)) continue;
                const objectId = Math.floor(Number(object.id));
                if (objectId <= 0) continue;

                const componentId = this.getTiledPropertyValue(object.properties, 'componentid');
                const normalizedComponentId = typeof componentId === 'string' ? componentId.trim().toLowerCase() : '';
                if (normalizedComponentId !== YEKBUSH_COMPONENT_ID) continue;

                const center = this.computeObjectCenter(object);
                if (!center) continue;

                targets.set(objectId, {
                    objectId,
                    componentId: normalizedComponentId,
                    centerX: center.x,
                    centerY: center.y,
                    radiusPx: YEKBUSH_INTERACTION_RADIUS_PX
                });
            }
        } catch (error) {
            console.error('[InstanceRoom] Failed to load harvest targets from map:', error);
        }

        return targets;
    }

    private loadChestInteractionTarget(mapFileName: string): ChestInteractionTarget | null {
        const mapPath = this.resolveMapPath(mapFileName);
        if (!mapPath) return null;

        try {
            const raw = fs.readFileSync(mapPath, 'utf8');
            const map = JSON.parse(raw) as TiledMap;
            const chestLayer = (map.layers ?? []).find(
                (layer) => layer.type === 'tilelayer' && String(layer.name ?? '').toLowerCase() === 'chest'
            );
            if (!chestLayer || !Array.isArray(chestLayer.data)) return null;

            const width = Number.isFinite(chestLayer.width) ? Math.max(1, Math.floor(Number(chestLayer.width))) : 0;
            if (width <= 0) return null;

            const layerOffsetX = Number(chestLayer.x ?? 0);
            const layerOffsetY = Number(chestLayer.y ?? 0);
            const tileSize = 32;

            for (let index = 0; index < chestLayer.data.length; index += 1) {
                const tileId = Number(chestLayer.data[index] ?? 0);
                if (!Number.isFinite(tileId) || tileId <= 0) continue;
                const tileX = index % width;
                const tileY = Math.floor(index / width);
                return {
                    componentId: GLIMMERING_CHEST_COMPONENT_ID,
                    centerX: layerOffsetX + (tileX * tileSize) + tileSize * 0.5,
                    centerY: layerOffsetY + (tileY * tileSize) + tileSize * 0.5,
                    radiusPx: GLIMMERING_CHEST_INTERACTION_RADIUS_PX
                };
            }
        } catch (error) {
            console.error('[InstanceRoom] Failed to load chest interaction target from map:', error);
        }

        return null;
    }

    private computeObjectCenter(object: TiledMapObject): { x: number; y: number } | null {
        const baseX = Number(object.x ?? 0);
        const baseY = Number(object.y ?? 0);

        if (Array.isArray(object.polygon) && object.polygon.length > 0) {
            let sumX = 0;
            let sumY = 0;
            for (const point of object.polygon) {
                sumX += baseX + Number(point.x ?? 0);
                sumY += baseY + Number(point.y ?? 0);
            }
            const count = object.polygon.length;
            if (count <= 0) return null;
            return { x: sumX / count, y: sumY / count };
        }

        const width = Number(object.width ?? 0);
        const height = Number(object.height ?? 0);
        return {
            x: baseX + width * 0.5,
            y: baseY + height * 0.5
        };
    }

    private getTiledPropertyValue(properties: TiledProperty[] | undefined, propertyName: string): unknown {
        if (!Array.isArray(properties)) return undefined;
        const normalized = propertyName.trim().toLowerCase();
        const found = properties.find((property) => String(property.name).trim().toLowerCase() === normalized);
        return found?.value;
    }

    private resolveMapPath(mapFileName: string): string | null {
        const candidates = [
            path.resolve(__dirname, '../../../client/public/maps', mapFileName),
            path.resolve(__dirname, '../../client/public/maps', mapFileName),
            path.resolve(process.cwd(), '../client/public/maps', mapFileName),
            path.resolve(process.cwd(), 'client/public/maps', mapFileName)
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return candidate;
        }

        return null;
    }

    private loadSpawnRegions(mapFileName: string): SpawnRegionRuntime[] {
        const regions: SpawnRegionRuntime[] = [];
        const mapPath = this.resolveMapPath(mapFileName);
        if (!mapPath) return regions;

        try {
            const raw = fs.readFileSync(mapPath, 'utf8');
            const map = JSON.parse(raw) as TiledMap;
            const spawnLayers = (map.layers ?? []).filter((layer) => layer.type === 'objectgroup' && String(layer.name ?? '').toLowerCase() === 'spawn');
            const now = Date.now();

            for (const layer of spawnLayers) {
                for (const object of (layer.objects ?? [])) {
                    if (!Number.isFinite(object.id) || !Array.isArray(object.polygon) || object.polygon.length < 3) continue;
                    const npcRaw = this.getTiledPropertyValue(object.properties, 'npc');
                    const npcKind = typeof npcRaw === 'string' ? npcRaw.trim().toLowerCase() : '';
                    if (!npcKind || !(npcKind in AI_NPC_DEFINITIONS)) continue;

                    const maxSpawnedRaw = Number(this.getTiledPropertyValue(object.properties, 'maxSpawned'));
                    const restoreRateRaw = Number(this.getTiledPropertyValue(object.properties, 'restoreRate'));
                    const maxSpawned = Number.isFinite(maxSpawnedRaw) ? Math.max(1, Math.floor(maxSpawnedRaw)) : 1;
                    const restoreRateMs = Number.isFinite(restoreRateRaw) ? Math.max(250, Math.floor(restoreRateRaw)) : 10000;

                    const baseX = Number(object.x ?? 0);
                    const baseY = Number(object.y ?? 0);
                    const polygon = object.polygon.map((point) => ({
                        x: baseX + Number(point.x ?? 0),
                        y: baseY + Number(point.y ?? 0)
                    }));

                    let minX = Number.POSITIVE_INFINITY;
                    let minY = Number.POSITIVE_INFINITY;
                    let maxX = Number.NEGATIVE_INFINITY;
                    let maxY = Number.NEGATIVE_INFINITY;
                    polygon.forEach((point) => {
                        if (point.x < minX) minX = point.x;
                        if (point.y < minY) minY = point.y;
                        if (point.x > maxX) maxX = point.x;
                        if (point.y > maxY) maxY = point.y;
                    });

                    regions.push({
                        id: Number(object.id),
                        npcKind: npcKind as AINpcKind,
                        polygon,
                        minX,
                        minY,
                        maxX,
                        maxY,
                        maxSpawned,
                        restoreRateMs,
                        aliveNpcIds: new Set<string>(),
                        nextSpawnAtMs: now
                    });
                }
            }
        } catch (error) {
            console.error('[InstanceRoom] Failed to load spawn regions from map:', error);
        }

        return regions;
    }

    private loadCustomTriggers(mapFileName: string): Map<string, CustomTriggerRuntime> {
        const triggers = new Map<string, CustomTriggerRuntime>();
        const mapPath = this.resolveMapPath(mapFileName);
        if (!mapPath) return triggers;

        try {
            const raw = fs.readFileSync(mapPath, 'utf8');
            const map = JSON.parse(raw) as TiledMap;
            const customLayers = (map.layers ?? []).filter(
                (layer) => layer.type === 'objectgroup' && String(layer.name ?? '').toLowerCase() === 'custom'
            );

            for (const layer of customLayers) {
                for (const object of (layer.objects ?? [])) {
                    if (!Array.isArray(object.polygon) || object.polygon.length < 3) continue;
                    const customIdRaw = this.getTiledPropertyValue(object.properties, 'customid');
                    const customId = typeof customIdRaw === 'string' ? customIdRaw.trim().toLowerCase() : '';
                    if (!customId) continue;

                    const baseX = Number(object.x ?? 0);
                    const baseY = Number(object.y ?? 0);
                    const polygon = object.polygon.map((point) => ({
                        x: baseX + Number(point.x ?? 0),
                        y: baseY + Number(point.y ?? 0)
                    }));

                    let sumX = 0;
                    let sumY = 0;
                    polygon.forEach((point) => {
                        sumX += point.x;
                        sumY += point.y;
                    });
                    const count = Math.max(1, polygon.length);

                    triggers.set(customId, {
                        customId,
                        polygon,
                        centerX: sumX / count,
                        centerY: sumY / count
                    });
                }
            }
        } catch (error) {
            console.error('[InstanceRoom] Failed to load custom triggers from map:', error);
        }

        return triggers;
    }

    private loadRegionByName(mapFileName: string, regionName: string): RegionRuntime | null {
        const mapPath = this.resolveMapPath(mapFileName);
        if (!mapPath) return null;

        try {
            const raw = fs.readFileSync(mapPath, 'utf8');
            const map = JSON.parse(raw) as TiledMap;
            const regionLayers = (map.layers ?? []).filter(
                (layer) => layer.type === 'objectgroup' && String(layer.name ?? '').toLowerCase() === 'regions'
            );

            const wantedName = regionName.trim().toLowerCase();
            for (const layer of regionLayers) {
                for (const object of (layer.objects ?? [])) {
                    const objectName = String((object as any).name ?? '').trim();
                    if (!objectName || objectName.toLowerCase() !== wantedName) continue;
                    if (!Array.isArray(object.polygon) || object.polygon.length < 3) continue;

                    const baseX = Number(object.x ?? 0);
                    const baseY = Number(object.y ?? 0);
                    const polygon = object.polygon.map((point) => ({
                        x: baseX + Number(point.x ?? 0),
                        y: baseY + Number(point.y ?? 0)
                    }));

                    return {
                        name: objectName,
                        polygon
                    };
                }
            }
        } catch (error) {
            console.error('[InstanceRoom] Failed to load region polygon from map:', error);
        }

        return null;
    }

    private handleEnemyBridgeGate(client: Client, player: InstancePlayerSchema, x: number, y: number) {
        const trigger = this.customTriggersById.get(ENEMY_BRIDGE_CUSTOM_ID);
        if (!trigger) return;
        if (this.enemyBridgeUnlockedByUserId.get(player.odcid) === true) return;
        if (!this.isPointInPolygon(x, y, trigger.polygon)) return;

        const awayX = x - trigger.centerX;
        const awayY = y - trigger.centerY;
        const magnitude = Math.hypot(awayX, awayY) || 1;
        const dirX = magnitude > 0 ? awayX / magnitude : 0;
        const dirY = magnitude > 0 ? awayY / magnitude : 1;

        this.applyServerImpulse(
            client.sessionId,
            dirX * ENEMY_BRIDGE_IMPULSE_SPEED,
            dirY * ENEMY_BRIDGE_IMPULSE_SPEED,
            ENEMY_BRIDGE_IMPULSE_DURATION_MS,
            client.sessionId
        );

        const now = Date.now();
        const lastWarnAt = this.enemyBridgeWarnCooldownByUserId.get(player.odcid) ?? 0;
        if ((now - lastWarnAt) < ENEMY_BRIDGE_WARN_COOLDOWN_MS) return;

        this.enemyBridgeWarnCooldownByUserId.set(player.odcid, now);
        client.send('quest:bridge-blocked', { npcId: 'guard' });
    }

    private handleDangerExitHeal(client: Client, player: InstancePlayerSchema, x: number, y: number) {
        const userId = player.odcid || client.sessionId;
        const inDangerNow = this.dangerRegion ? this.isPointInPolygon(x, y, this.dangerRegion.polygon) : false;
        const wasInDanger = this.wasInDangerByUserId.get(userId) === true;
        this.wasInDangerByUserId.set(userId, inDangerNow);

        if (!this.heedTheWarningStayObjectiveByUserId.get(userId)) return;
        if (!wasInDanger || inDangerNow) return;

        const current = this.heartsByUserId.get(userId) ?? { ...DEFAULT_PLAYER_HEARTS_STATE };
        const next = this.normalizeHeartsState({
            currentHearts: current.maxHearts,
            maxHearts: current.maxHearts
        });

        this.heartsByUserId.set(userId, next);
        client.send('player:hearts', next);

        if (userId !== client.sessionId) {
            User.updateOne({ _id: userId }, { $set: { hearts: next } }).catch((error) => {
                console.error('[InstanceRoom] Failed to persist danger exit heart refill:', error);
            });
        }
    }

    private stepEnemySpawning() {
        if (this.spawnRegions.length === 0) return;

        const now = Date.now();
        this.spawnRegions.forEach((region) => {
            Array.from(region.aliveNpcIds).forEach((npcId) => {
                if (this.aiRuntimeById.has(npcId)) return;
                region.aliveNpcIds.delete(npcId);
                this.aiSpawnRegionByNpcId.delete(npcId);
            });

            if (region.aliveNpcIds.size >= region.maxSpawned) return;
            if (now < region.nextSpawnAtMs) return;

            const spawned = this.trySpawnFromRegion(region);
            if (!spawned) {
                region.nextSpawnAtMs = now + 1000;
                return;
            }

            if (region.aliveNpcIds.size < region.maxSpawned) {
                region.nextSpawnAtMs = now + 250;
            }
        });
    }

    private trySpawnFromRegion(region: SpawnRegionRuntime): boolean {
        for (let attempt = 0; attempt < 24; attempt += 1) {
            const point = this.getRandomPointInPolygon(region);
            if (!point) continue;
            if (!this.isSpawnPointValid(region.npcKind, point.x, point.y)) continue;

            const id = this.spawnAiNpc(region.npcKind, point.x, point.y, region);
            if (id) return true;
        }

        return false;
    }

    private isSpawnPointValid(kind: AINpcKind, x: number, y: number): boolean {
        const definition = AI_NPC_DEFINITIONS[kind];
        if (!definition) return false;

        const path = this.navService.findPath({ x, y }, { x, y }, definition.hitbox);
        if (!Array.isArray(path) || path.length === 0) return false;
        const first = path[0];
        if (Math.hypot(first.x - x, first.y - y) > 18) return false;

        for (const runtime of this.aiRuntimeById.values()) {
            const minDistance = ((definition.hitbox.width + runtime.hitbox.width) * 0.5) + 4;
            if (Math.hypot(runtime.x - x, runtime.y - y) < minDistance) return false;
        }

        return true;
    }

    private getRandomPointInPolygon(region: SpawnRegionRuntime): { x: number; y: number } | null {
        for (let attempt = 0; attempt < 32; attempt += 1) {
            const x = region.minX + (Math.random() * (region.maxX - region.minX));
            const y = region.minY + (Math.random() * (region.maxY - region.minY));
            if (this.isPointInPolygon(x, y, region.polygon)) {
                return { x, y };
            }
        }

        let sumX = 0;
        let sumY = 0;
        region.polygon.forEach((point) => {
            sumX += point.x;
            sumY += point.y;
        });
        const count = Math.max(1, region.polygon.length);
        return { x: sumX / count, y: sumY / count };
    }

    private isPointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;
            const intersects = ((yi > y) !== (yj > y))
                && (x < ((xj - xi) * (y - yi)) / ((yj - yi) + 0.0000001) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    private scheduleRegionRespawn(region: SpawnRegionRuntime) {
        const jitter = 0.5 + Math.random();
        const delayMs = Math.max(250, Math.floor(region.restoreRateMs * jitter));
        region.nextSpawnAtMs = Date.now() + delayMs;
    }

    private tryEnemyMeleeAttack(attacker: AiNpcRuntimeState, targetSessionId: string, damageHearts: number) {
        if (!Number.isFinite(damageHearts) || damageHearts <= 0) return;
        if (attacker.isDead) return;

        const player = this.state.players.get(targetSessionId);
        if (!player) return;

        const now = Date.now();
        if (this.didPlayerDodgeMeleeAttack(targetSessionId, now)) return;

        this.applyDamageToPlayerHearts(targetSessionId, Math.floor(damageHearts));
    }

    private didPlayerDodgeMeleeAttack(targetSessionId: string, now: number): boolean {
        const runtime = this.movementRuntimeBySession.get(targetSessionId) as (RuntimeMovementState & {
            dodgeUntil?: number;
            dodgeActiveUntil?: number;
            iFrameUntil?: number;
            invulnerableUntil?: number;
        }) | undefined;
        const player = this.state.players.get(targetSessionId) as (InstancePlayerSchema & {
            dodgeUntil?: number;
            iFrameUntil?: number;
            invulnerableUntil?: number;
        }) | undefined;

        const candidates = [
            runtime?.dodgeUntil,
            runtime?.dodgeActiveUntil,
            runtime?.iFrameUntil,
            runtime?.invulnerableUntil,
            player?.dodgeUntil,
            player?.iFrameUntil,
            player?.invulnerableUntil
        ];

        return candidates.some((value) => Number.isFinite(value) && Number(value) > now);
    }

    private applyDamageToPlayerHearts(targetSessionId: string, damageHearts: number) {
        if (!Number.isFinite(damageHearts) || damageHearts <= 0) return;

        const player = this.state.players.get(targetSessionId);
        if (!player) return;

        const userId = player.odcid || targetSessionId;
        const current = this.heartsByUserId.get(userId) ?? { ...DEFAULT_PLAYER_HEARTS_STATE };
        const next = this.normalizeHeartsState({
            currentHearts: current.currentHearts - Math.floor(damageHearts),
            maxHearts: current.maxHearts
        });

        this.heartsByUserId.set(userId, next);
        const client = this.clients.find((entry) => entry.sessionId === targetSessionId);
        if (client) {
            client.send('player:hearts', next);
        }

        if (userId !== targetSessionId) {
            User.updateOne({ _id: userId }, { $set: { hearts: next } }).catch((error) => {
                console.error('[InstanceRoom] Failed to persist enemy melee heart damage:', error);
            });
        }
    }

    private sendPlayerHeartsSnapshot(client: Client, overrideHearts?: IPlayerHeartsState) {
        const player = this.state.players.get(client.sessionId);
        const userId = player?.odcid || (client as any)?.odcid || client.sessionId;
        const hearts = overrideHearts
            ? this.normalizeHeartsState(overrideHearts)
            : this.normalizeHeartsState(this.heartsByUserId.get(userId) ?? DEFAULT_PLAYER_HEARTS_STATE);

        this.heartsByUserId.set(userId, hearts);
        client.send('player:hearts', hearts);
    }

    private sendPlayerMoneySnapshot(client: Client, overrideMoney?: number) {
        const player = this.state.players.get(client.sessionId);
        const userId = player?.odcid || (client as any)?.odcid || client.sessionId;
        const money = this.normalizeMoneyAmount(
            typeof overrideMoney === 'number'
                ? overrideMoney
                : (this.moneyByUserId.get(userId) ?? DEFAULT_PLAYER_MONEY_STATE.money)
        );
        this.moneyByUserId.set(userId, money);
        client.send('player:money', { money });
    }

    private applyEnemyDamage(aiId: string, damageAmount: number): boolean {
        if (!Number.isFinite(damageAmount) || damageAmount <= 0) return false;

        const runtime = this.aiRuntimeById.get(aiId);
        const schema = this.state.aiNpcs.get(aiId);
        if (!runtime || !schema || runtime.isDead) return false;

        runtime.currentHealth = Math.max(0, runtime.currentHealth - Math.floor(damageAmount));
        schema.currentHealth = runtime.currentHealth;

        if (runtime.currentHealth > 0) return true;

        runtime.isDead = true;
        runtime.vx = 0;
        runtime.vy = 0;
        runtime.attackAnimUntilMs = 0;
        runtime.deathAnimUntilMs = Date.now() + GREMLIN_DEATH_ANIM_MS;
        runtime.anim = 'death';
        schema.vx = 0;
        schema.vy = 0;
        schema.anim = 'death';
        schema.moveTs = Date.now();
        return true;
    }

    private despawnAiNpc(id: string) {
        this.state.aiNpcs.delete(id);
        this.aiRuntimeById.delete(id);

        const spawnRegion = this.aiSpawnRegionByNpcId.get(id);
        if (spawnRegion) {
            spawnRegion.aliveNpcIds.delete(id);
            this.scheduleRegionRespawn(spawnRegion);
            this.aiSpawnRegionByNpcId.delete(id);
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
        if (player.isFishing) {
            player.vx = 0;
            player.vy = 0;
            player.anim = 'idle';
            player.moveTs = Date.now();
            runtime.vx = 0;
            runtime.vy = 0;
            runtime.input = { up: false, down: false, left: false, right: false, sprint: false };
            runtime.impulseVx = 0;
            runtime.impulseVy = 0;
            runtime.impulseActiveUntil = 0;
            runtime.lastServerTime = Date.now();
            this.sendMovementReconcile(client, player, runtime.lastSeq, 'hard-server', false, 0, 'fishing-locked');
            return;
        }
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
        const estimatedLatencyMs = this.estimateClientLatencyMs(frame, now);
        const latencyThresholdScale = this.getLatencyThresholdScale(estimatedLatencyMs);
        // Widen thresholds during impulse to tolerate decay timing differences
        const softBaseThreshold = hasActiveImpulse ? SOFT_DISCREPANCY * 3 : SOFT_DISCREPANCY;
        const hardBaseThreshold = hasActiveImpulse ? HARD_DISCREPANCY * 2.5 : HARD_DISCREPANCY;
        const softThreshold = softBaseThreshold * latencyThresholdScale;
        const hardThreshold = hardBaseThreshold * latencyThresholdScale;
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
        this.tryRefineDropsFromMovement(client, player, nextX, nextY, now);
        this.handleEnemyBridgeGate(client, player, nextX, nextY);
        this.handleDangerExitHeal(client, player, nextX, nextY);
        void this.advancementsManager.onPlayerMoved(player.odcid, nextX, nextY)
            .then((alerts) => {
                alerts.forEach((alert) => client.send('advancement:alert', alert));
            })
            .catch((error) => {
                console.error('[InstanceRoom] region advancements failed:', error);
            });
        this.sendMovementReconcile(client, player, frame.seq, authority, hardOverride, errorDistance, reason, hardThreshold);
    }

    private async sendAdvancements(client: Client, updates: { alerts: IAdvancementAlertMessage[]; delayedNewQuestCounts: number[] }) {
        updates.alerts.forEach((alert) => {
            client.send('advancement:alert', alert);
        });

        const player = this.state.players.get(client.sessionId);
        if (player) {
            await this.processQuestCompletionRewards(client, player.odcid, updates.alerts);
        }
        if (player) {
            try {
                const advancementsState = await this.advancementsManager.getStateForUser(player.odcid);
                this.updateHeedTheWarningUnlockState(player.odcid, advancementsState);
                this.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial);
                client.send('advancements:state', advancementsState);
            } catch (error) {
                console.error('[InstanceRoom] Failed to push advancements state after update:', error);
            }
        }

        updates.delayedNewQuestCounts.forEach((count) => {
            setTimeout(() => {
                if (!this.state.players.has(client.sessionId)) return;
                client.send('advancement:alert', {
                    type: 'new-quests',
                    count
                } satisfies IAdvancementAlertMessage);
            }, 6000);
        });
    }

    private async shouldForceGlimmeringKeyCatch(userId: string, x: number, y: number): Promise<boolean> {
        if (!this.isNightWindowForGlimmeringKey()) {
            return false;
        }

        const activeObjective = await this.advancementsManager.getActiveFishNearLocationObjective(userId, 'KeyLocation');
        if (!activeObjective) {
            return false;
        }

        const radiusPx = Math.max(1, activeObjective.radiusMeters) * AI_METERS_TO_PIXELS;
        const keyLocations = this.advancementsManager.getPoiPointsByName('KeyLocation');
        if (keyLocations.length === 0) {
            return false;
        }

        return keyLocations.some((location) => Math.hypot(location.x - x, location.y - y) <= radiusPx);
    }

    private isNightWindowForGlimmeringKey(): boolean {
        const hour = calculateWorldTime().hour;
        return hour >= 23 || hour < 4;
    }

    private async processQuestCompletionRewards(client: Client, userId: string, alerts: IAdvancementAlertMessage[]) {
        const completedQuestIds = alerts
            .filter((alert) => alert.type === 'quest-completed' && typeof alert.questId === 'string')
            .map((alert) => alert.questId as string);

        if (!completedQuestIds.includes('village_weirdo')) return;

        const currentMoney = this.moneyByUserId.get(userId) ?? DEFAULT_PLAYER_MONEY_STATE.money;
        const nextMoney = this.normalizeMoneyAmount(currentMoney + 100);
        this.moneyByUserId.set(userId, nextMoney);
        if (userId !== client.sessionId) {
            await User.updateOne({ _id: userId }, { $set: { money: nextMoney } });
        }
        client.send('player:money', { money: nextMoney });
    }

    private getItemCountFromSlots(slots: Array<{ itemId: string | null; count: number }>, itemId: string): number {
        return slots.reduce((sum, slot) => {
            if (slot.itemId !== itemId) return sum;
            return sum + Math.max(0, Math.floor(slot.count || 0));
        }, 0);
    }

    private async sendInventoryCountObjectiveForItem(
        client: Client,
        userId: string,
        itemId: string,
        slots: Array<{ itemId: string | null; count: number }>
    ) {
        if (!itemId) return;
        const count = this.getItemCountFromSlots(slots, itemId);
        const updates = await this.advancementsManager.onInventoryCount(userId, itemId, count);
        if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
            await this.sendAdvancements(client, updates);
        }
    }

    private async syncInventoryCountObjectives(client: Client, userId: string) {
        const { items } = await InventoryCache.getInstance().getInventoryState(userId);
        const trackedItemIds = new Set<string>();
        items.forEach((slot) => {
            if (typeof slot.itemId === 'string' && slot.itemId.trim().length > 0) {
                trackedItemIds.add(slot.itemId);
            }
        });
        trackedItemIds.add('yekberries');

        for (const itemId of trackedItemIds) {
            await this.sendInventoryCountObjectiveForItem(client, userId, itemId, items);
        }
    }

    private updateHeedTheWarningUnlockState(userId: string, state: IAdvancementsState) {
        const progress = state.questProgress?.[HEED_THE_WARNING_QUEST_ID];
        const unlocked = progress?.status === 'active' || progress?.status === 'completed';
        const onStayObjective = progress?.status === 'active'
            && (typeof progress.objectiveIndex !== 'number' || Math.floor(progress.objectiveIndex) === 0);
        this.enemyBridgeUnlockedByUserId.set(userId, unlocked);
        this.heedTheWarningStayObjectiveByUserId.set(userId, onStayObjective);
    }

    private sendMovementReconcile(
        client: Client,
        player: InstancePlayerSchema,
        seqAck: number,
        authority: ServerMovementReconcile['authority'],
        hardOverride: boolean,
        errorDistance: number,
        reason?: string,
        hardThreshold?: number
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
            hardThreshold,
            reason
        };
        client.send('movement:reconcile', payload);
        this.lastReconcileSentAtBySession.set(client.sessionId, now);
    }

    private estimateClientLatencyMs(frame: ClientMovementFrame, now: number): number {
        if (!Number.isFinite(frame?.clientTime)) return 0;
        const delta = now - Number(frame.clientTime);
        if (!Number.isFinite(delta)) return 0;
        return this.clampNumber(delta, 0, MAX_LATENCY_ESTIMATE_MS);
    }

    private getLatencyThresholdScale(latencyMs: number): number {
        const normalized = this.clampNumber(latencyMs / 220, 0, 1);
        return 1 + normalized * (MAX_LATENCY_THRESHOLD_SCALE - 1);
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
        const despawnIds: string[] = [];
        const players: Array<{ sessionId: string; x: number; y: number }> = [];
        this.state.players.forEach((player, sessionId) => {
            players.push({ sessionId, x: player.x, y: player.y });
        });

        this.aiRuntimeById.forEach((runtime, id) => {
            if (runtime.isDead && runtime.deathAnimUntilMs > 0 && now >= runtime.deathAnimUntilMs) {
                despawnIds.push(id);
                return;
            }

            const controller = getAiControllerById(runtime.controllerId);
            if (!controller) return;

            controller.update(runtime, {
                tick: this.gameTick,
                now,
                deltaSec,
                metersToPixels: (meters) => meters * AI_METERS_TO_PIXELS,
                players,
                nav: this.navService,
                random: () => Math.random(),
                onMeleeAttackAttempt: (attacker, targetSessionId, damageHearts) => {
                    this.tryEnemyMeleeAttack(attacker, targetSessionId, damageHearts);
                }
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
            schema.currentHealth = runtime.currentHealth;
            schema.maxHealth = runtime.maxHealth;
            schema.pathDebug = runtime.chasePath.length > 0
                ? runtime.chasePath.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join(';')
                : '';
        });

        despawnIds.forEach((id) => this.despawnAiNpc(id));
    }

    private stepSoftEntityCollisions(deltaTimeMs: number) {
        const dtSec = this.clampNumber(deltaTimeMs / 1000, 0.001, 0.12);
        const now = Date.now();
        const bodies: SoftCollisionBody[] = [];

        this.state.players.forEach((player, sessionId) => {
            if (player.isAfk) return;
            if (player.isFishing) return;
            if (player.x === 0 && player.y === 0) return;

            bodies.push({
                id: sessionId,
                kind: 'player',
                x: player.x,
                y: player.y,
                halfWidth: SOFT_COLLISION_PLAYER_FOOT_HITBOX.width / 2,
                halfHeight: SOFT_COLLISION_PLAYER_FOOT_HITBOX.height / 2,
                pushX: 0,
                pushY: 0
            });
        });

        this.aiRuntimeById.forEach((runtime, id) => {
            bodies.push({
                id,
                kind: 'ai',
                x: runtime.x,
                y: runtime.y,
                halfWidth: Math.max(1, runtime.hitbox.width) / 2,
                halfHeight: Math.max(1, runtime.hitbox.collidableHeight || runtime.hitbox.height) / 2,
                pushX: 0,
                pushY: 0
            });
        });

        if (bodies.length < 2) return;

        for (let i = 0; i < bodies.length; i += 1) {
            const a = bodies[i];
            for (let j = i + 1; j < bodies.length; j += 1) {
                const b = bodies[j];

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);
                const overlapX = (a.halfWidth + b.halfWidth) - absDx;
                const overlapY = (a.halfHeight + b.halfHeight) - absDy;
                if (overlapX <= 0 || overlapY <= 0) continue;

                let dirX = dx;
                let dirY = dy;
                const dist = Math.hypot(dirX, dirY);
                if (dist > SOFT_COLLISION_FORCE.epsilon) {
                    dirX /= dist;
                    dirY /= dist;
                } else {
                    dirX = a.id < b.id ? 1 : -1;
                    dirY = 0;
                }

                const minOverlap = Math.min(overlapX, overlapY);
                const overlapRatio = Math.min(
                    overlapX / Math.max(1, a.halfWidth + b.halfWidth),
                    overlapY / Math.max(1, a.halfHeight + b.halfHeight)
                );
                const pushMagnitude = this.clampNumber(
                    minOverlap * SOFT_COLLISION_FORCE.pushScalar * (0.45 + overlapRatio * 0.55),
                    0,
                    SOFT_COLLISION_FORCE.maxPushPerStep
                );

                const pushX = dirX * pushMagnitude;
                const pushY = dirY * pushMagnitude;

                a.pushX -= pushX * 0.5;
                a.pushY -= pushY * 0.5;
                b.pushX += pushX * 0.5;
                b.pushY += pushY * 0.5;
            }
        }

        bodies.forEach((body) => {
            const pushLen = Math.hypot(body.pushX, body.pushY);
            if (pushLen < SOFT_COLLISION_FORCE.epsilon) return;

            const velocityPushX = (body.pushX / dtSec) * SOFT_COLLISION_FORCE.velocityTransfer;
            const velocityPushY = (body.pushY / dtSec) * SOFT_COLLISION_FORCE.velocityTransfer;

            if (body.kind === 'player') {
                const player = this.state.players.get(body.id);
                if (!player || player.isAfk) return;

                player.x += body.pushX;
                player.y += body.pushY;
                player.vx = this.clampNumber((player.vx || 0) + velocityPushX, -SPRINT_SPEED, SPRINT_SPEED);
                player.vy = this.clampNumber((player.vy || 0) + velocityPushY, -SPRINT_SPEED, SPRINT_SPEED);
                player.moveTs = now;

                const runtime = this.movementRuntimeBySession.get(body.id);
                if (runtime) {
                    runtime.impulseVx += velocityPushX;
                    runtime.impulseVy += velocityPushY;
                    runtime.impulseActiveUntil = Math.max(runtime.impulseActiveUntil, now + 120);
                    runtime.lastServerTime = now;
                }

                this.recordPositionSnapshot(body.id, player.x, player.y, now);

                const client = this.clients.find((entry) => entry.sessionId === body.id);
                if (client) {
                    this.sendMovementReconcile(client, player, runtime?.lastSeq ?? 0, 'hard-server', false, 0, 'soft-collision');
                }
                return;
            }

            const runtime = this.aiRuntimeById.get(body.id);
            const schema = this.state.aiNpcs.get(body.id);
            if (!runtime || !schema) return;

            runtime.x += body.pushX;
            runtime.y += body.pushY;
            runtime.vx += velocityPushX;
            runtime.vy += velocityPushY;
            runtime.moveTs = now;

            schema.x = runtime.x;
            schema.y = runtime.y;
            schema.vx = runtime.vx;
            schema.vy = runtime.vy;
            schema.moveTs = runtime.moveTs;
        });
    }

    private spawnAiNpc(kind: AINpcKind, x: number, y: number, spawnRegion?: SpawnRegionRuntime): string | null {
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
        npcSchema.currentHealth = definition.maxHealth;
        npcSchema.maxHealth = definition.maxHealth;
        npcSchema.pathDebug = '';
        npcSchema.hitbox.width = definition.hitbox.width;
        npcSchema.hitbox.height = definition.hitbox.height;
        npcSchema.hitbox.collidableHeight = definition.hitbox.collidableHeight;

        this.state.aiNpcs.set(id, npcSchema);

        const pathTickOffset = Math.floor(Math.random() * Math.max(1, definition.controllerConfig.pathRecomputeFrequencyTicks));
        const initialIdleTick = definition.kind === 'gremlin'
            ? this.gameTick + (160 + Math.floor(Math.random() * 81))
            : this.gameTick;
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
            currentHealth: definition.maxHealth,
            maxHealth: definition.maxHealth,
            hitbox: {
                width: definition.hitbox.width,
                height: definition.hitbox.height,
                collidableHeight: definition.hitbox.collidableHeight
            },
            mode: 'idle',
            chasePath: [],
            chasePathIndex: 0,
            lastIdleCheckTick: initialIdleTick,
            lastPathRecomputeTick: this.gameTick - pathTickOffset,
            lastAttackMs: 0,
            attackAnimUntilMs: 0,
            deathAnimUntilMs: 0,
            isDead: false,
            controllerConfig: { ...definition.controllerConfig }
        });

        if (spawnRegion) {
            spawnRegion.aliveNpcIds.add(id);
            this.aiSpawnRegionByNpcId.set(id, spawnRegion);
        }

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
