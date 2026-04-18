import { Client } from "colyseus";
import {
    DEFAULT_GUIDE_TUTORIAL_STATE,
    DEFAULT_INVENTORY_SLOTS,
    DEFAULT_PLAYER_HEARTS_STATE,
    DEFAULT_PLAYER_MONEY_STATE,
    DEFAULT_PLAYER_STATS,
    DEFAULT_USER_ADVANCEMENTS,
    getItemDefinition,
    IGuideTutorialState,
    IPlayerHeartsState,
    IPlayerStatsDelta,
    PLAYER_STAT_KEYS,
    PlayerStatKey
} from "@cfwk/shared";
import User from "../../../models/User";
import { getBetaModels } from "../../../db/betaStorage";
import { DEFAULT_FIRST_CONNECT_LOCATION_ID } from "../../../config/instance";
import { isPointInPolygon } from "../../../maps/geometry/pointInPolygon";
import {
    ENEMY_BRIDGE_CUSTOM_ID,
    ENEMY_BRIDGE_IMPULSE_DURATION_MS,
    ENEMY_BRIDGE_IMPULSE_SPEED,
    ENEMY_BRIDGE_WARN_COOLDOWN_MS
} from "../InstanceRoomConstants";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import { InstancePlayerSchema } from "../schema/InstancePlayerSchema";
import { grantItemToPlayer } from "./InventoryGrantService";

export function markActivity(room: InstanceRoomHost, client: Client) {
    const now = Date.now();
    room.lastActivityBySession.set(client.sessionId, now);
    const player = room.state.players.get(client.sessionId);
    if (player && player.isAfk) {
        player.isAfk = false;
        player.afkSince = 0;
    }
}

export async function isGlimmerbowlUnlocked(room: InstanceRoomHost, userId: string): Promise<boolean> {
    const cached = room.glimmerbowlUnlockedByUserId.get(userId);
    if (cached !== undefined) return cached;

    const unlocked = await room.deps.glimmerbowlCache.isUnlocked(userId);
    room.glimmerbowlUnlockedByUserId.set(userId, unlocked);
    return unlocked;
}

export async function hasOwnedScar(room: InstanceRoomHost, userId: string): Promise<boolean> {
    const cached = room.hasOwnedScarByUserId.get(userId);
    if (cached !== undefined) return cached;

    const user = await User.findById(userId).select("hasOwnedScar").lean();
    const hasOwnedScarValue = Boolean((user as any)?.hasOwnedScar);
    room.hasOwnedScarByUserId.set(userId, hasOwnedScarValue);
    return hasOwnedScarValue;
}

export async function setHasOwnedScar(room: InstanceRoomHost, userId: string): Promise<void> {
    const cached = room.hasOwnedScarByUserId.get(userId);
    if (cached) return;
    room.hasOwnedScarByUserId.set(userId, true);
    await User.updateOne({ _id: userId }, { $set: { hasOwnedScar: true } });
}

export async function setHasOwnedScarFromInventory(
    room: InstanceRoomHost,
    userId: string,
    items: Array<{ itemId: string | null; count: number }>
): Promise<void> {
    if (await hasOwnedScar(room, userId)) return;
    const hasScarInInventory = items.some((slot) => {
        if (!slot.itemId || slot.count <= 0) return false;
        return Boolean(getItemDefinition(slot.itemId)?.scar);
    });
    if (!hasScarInInventory) return;
    await setHasOwnedScar(room, userId);
    const glimmerState = await room.deps.glimmerbowlCache.getState(userId);
    room.instanceManager.events.emit("glimmerbowl_update", {
        userId,
        entries: glimmerState.entries,
        unlocked: glimmerState.unlocked,
        hasOwnedScar: true
    });
}

export function isDebugLocation(): boolean {
    return String(process.env.IS_DEV || "").toLowerCase() === "true";
}

export async function isBetaCampaignActive(): Promise<boolean> {
    let isActive = false;
    try {
        const { BetaCampaign } = await getBetaModels();
        const now = new Date();
        const active = await BetaCampaign.findOne({ active: true, endsAt: { $gt: now } })
            .select("_id")
            .lean();
        isActive = Boolean(active);
    } catch (error) {
        console.error("[InstanceRoom] Failed to check active beta campaign:", error);
        isActive = false;
    }
    return isActive;
}

export async function initializeDebugNpcAvailabilityOnStartup(room: InstanceRoomHost) {
    const isDev = isDebugLocation();
    if (!isDev) {
        room.debugNpcFeatureEnabled = false;
        room.debugNpcFeatureInitialized = true;
        console.log("[InstanceRoom] Debug NPC disabled at startup (IS_DEV is not true).");
        return;
    }

    const campaignActive = await isBetaCampaignActive();
    room.debugNpcFeatureEnabled = campaignActive;
    room.debugNpcFeatureInitialized = true;
    console.log(`[InstanceRoom] Debug NPC startup availability: isDev=${isDev} betaCampaignActive=${campaignActive} enabled=${room.debugNpcFeatureEnabled}`);
}

export async function canUseDebugNpc(room: InstanceRoomHost): Promise<boolean> {
    if (!room.debugNpcFeatureInitialized) {
        await initializeDebugNpcAvailabilityOnStartup(room);
    }
    return room.debugNpcFeatureEnabled;
}

export function createEmptyInventorySlots() {
    return Array.from({ length: DEFAULT_INVENTORY_SLOTS }, (_v, index) => ({
        index,
        itemId: null as string | null,
        count: 0
    }));
}

export async function wipePlayerGameplayData(room: InstanceRoomHost, userId: string): Promise<void> {
    await User.updateOne(
        { _id: userId },
        {
            $set: {
                inventory: createEmptyInventorySlots(),
                glimmerbowl: [],
                equippedRodId: null,
                playerStats: { ...DEFAULT_PLAYER_STATS },
                money: 0,
                advancements: {
                    enrolled: DEFAULT_USER_ADVANCEMENTS.enrolled,
                    questProgress: {},
                    completedAchievements: [],
                    discoveredRegions: {},
                    tutorial: { ...DEFAULT_GUIDE_TUTORIAL_STATE }
                },
                glimmerbowlUnlocked: false,
                hasOwnedScar: false,
                hearts: { ...DEFAULT_PLAYER_HEARTS_STATE },
                lastLocationId: DEFAULT_FIRST_CONNECT_LOCATION_ID,
                lastPositionX: null,
                lastPositionY: null
            }
        }
    );

    const items = room.deps.inventoryCache.resetUserInventory(userId);
    const entries = room.deps.glimmerbowlCache.resetUser(userId);
    room.deps.playerStatsCache.resetUser(userId);

    room.glimmerbowlUnlockedByUserId.set(userId, false);
    room.hasOwnedScarByUserId.set(userId, false);
    room.heartsByUserId.set(userId, { ...DEFAULT_PLAYER_HEARTS_STATE });
    room.moneyByUserId.set(userId, 0);

    room.instanceManager.events.emit("clear_progress", { userId });
    room.instanceManager.events.emit("inventory_update", { userId, items });
    room.instanceManager.events.emit("glimmerbowl_update", { userId, entries, unlocked: false });
    room.instanceManager.events.emit("money_update", { userId, money: 0 });
    room.instanceManager.events.emit("wipe_user", { userId });
}

export async function giveDebugNpcItem(
    room: InstanceRoomHost,
    client: Client,
    player: InstancePlayerSchema,
    itemId: string,
    amount: number
): Promise<Array<{ itemId: string | null; count: number }> | null> {
    return grantItemToPlayer(room, client, {
        itemId,
        amount,
        userId: player.odcid,
        dropIfNoSpace: true,
        dropX: player.x,
        dropY: player.y
    });
}

export function normalizeHeartsState(input: IPlayerHeartsState): IPlayerHeartsState {
    const maxHearts = Math.max(1, Math.floor(Number.isFinite(input.maxHearts) ? input.maxHearts : DEFAULT_PLAYER_HEARTS_STATE.maxHearts));
    const currentHearts = Math.max(0, Math.min(maxHearts, Math.floor(Number.isFinite(input.currentHearts) ? input.currentHearts : maxHearts)));
    return { currentHearts, maxHearts };
}

export function normalizeMoneyAmount(input: number): number {
    return Math.max(0, Math.floor(Number.isFinite(input) ? input : DEFAULT_PLAYER_MONEY_STATE.money));
}

export function handleEnemyBridgeGate(room: InstanceRoomHost, client: Client, player: InstancePlayerSchema, x: number, y: number) {
    const trigger = room.customTriggersById.get(ENEMY_BRIDGE_CUSTOM_ID);
    if (!trigger) return;
    if (room.enemyBridgeUnlockedByUserId.get(player.odcid) === true) return;
    if (!isPointInPolygon(x, y, trigger.polygon)) return;

    const awayX = x - trigger.centerX;
    const awayY = y - trigger.centerY;
    const magnitude = Math.hypot(awayX, awayY) || 1;
    const dirX = magnitude > 0 ? awayX / magnitude : 0;
    const dirY = magnitude > 0 ? awayY / magnitude : 1;

    room.applyServerImpulse(
        client.sessionId,
        dirX * ENEMY_BRIDGE_IMPULSE_SPEED,
        dirY * ENEMY_BRIDGE_IMPULSE_SPEED,
        ENEMY_BRIDGE_IMPULSE_DURATION_MS,
        client.sessionId
    );

    const now = Date.now();
    const lastWarnAt = room.enemyBridgeWarnCooldownByUserId.get(player.odcid) ?? 0;
    if ((now - lastWarnAt) < ENEMY_BRIDGE_WARN_COOLDOWN_MS) return;

    room.enemyBridgeWarnCooldownByUserId.set(player.odcid, now);
    client.send("quest:bridge-blocked", { npcId: "guard" });
}

export function handleDangerExitHeal(room: InstanceRoomHost, client: Client, player: InstancePlayerSchema, x: number, y: number) {
    const userId = player.odcid || client.sessionId;
    const inDangerNow = room.dangerRegion ? isPointInPolygon(x, y, room.dangerRegion.polygon) : false;
    const wasInDanger = room.wasInDangerByUserId.get(userId) === true;
    room.wasInDangerByUserId.set(userId, inDangerNow);

    if (!room.heedTheWarningStayObjectiveByUserId.get(userId)) return;
    if (!wasInDanger || inDangerNow) return;

    const current = room.heartsByUserId.get(userId) ?? { ...DEFAULT_PLAYER_HEARTS_STATE };
    const next = normalizeHeartsState({
        currentHearts: current.maxHearts,
        maxHearts: current.maxHearts
    });

    room.heartsByUserId.set(userId, next);
    client.send("player:hearts", next);

    if (userId !== client.sessionId) {
        User.updateOne({ _id: userId }, { $set: { hearts: next } }).catch((error) => {
            console.error("[InstanceRoom] Failed to persist danger exit heart refill:", error);
        });
    }
}

export function sendPlayerHeartsSnapshot(room: InstanceRoomHost, client: Client, overrideHearts?: IPlayerHeartsState) {
    const player = room.state.players.get(client.sessionId);
    const userId = player?.odcid || (client as any)?.odcid || client.sessionId;
    const hearts = overrideHearts
        ? normalizeHeartsState(overrideHearts)
        : normalizeHeartsState(room.heartsByUserId.get(userId) ?? DEFAULT_PLAYER_HEARTS_STATE);

    room.heartsByUserId.set(userId, hearts);
    client.send("player:hearts", hearts);
}

export function sendPlayerMoneySnapshot(room: InstanceRoomHost, client: Client, overrideMoney?: number) {
    const player = room.state.players.get(client.sessionId);
    const userId = player?.odcid || (client as any)?.odcid || client.sessionId;
    const money = normalizeMoneyAmount(
        typeof overrideMoney === "number"
            ? overrideMoney
            : (room.moneyByUserId.get(userId) ?? DEFAULT_PLAYER_MONEY_STATE.money)
    );
    room.moneyByUserId.set(userId, money);
    client.send("player:money", { money });
}

export function getStatsUserId(client: Client, player: InstancePlayerSchema): string | null {
    if (!player.odcid || player.odcid === client.sessionId) return null;
    return player.odcid;
}

export function incrementStat(room: InstanceRoomHost, client: Client, player: InstancePlayerSchema, key: PlayerStatKey, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const statsUserId = getStatsUserId(client, player);
    if (!statsUserId) return;

    room.deps.playerStatsCache.incrementStat(statsUserId, key, amount);
    const pending = room.pendingStatsDeltasBySession.get(client.sessionId) || {};
    pending[key] = (pending[key] || 0) + amount;
    room.pendingStatsDeltasBySession.set(client.sessionId, pending);
}

export function hasAnyDelta(delta: IPlayerStatsDelta): boolean {
    for (const key of PLAYER_STAT_KEYS) {
        if ((delta[key] || 0) > 0) return true;
    }
    return false;
}
