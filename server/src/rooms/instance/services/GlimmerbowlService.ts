import { randomUUID } from "crypto";
import { GlimmerbowlCombatStatePayload, GlimmerbowlEntry, GlimmerbowlFishLandEvent, GlimmerbowlFishLaunchEvent, GlimmerbowlFishReturnEvent, GlimmerbowlLaunchRequestPayload } from "@cfwk/shared";
import { Client } from "colyseus";
import { AI_METERS_TO_PIXELS } from "../../../ai/registry";
import {
    FISH_COMBAT_MAX_COOLDOWN_MS,
    FISH_COMBAT_MAX_LAUNCH_RANGE_PX,
    FISH_COMBAT_MIN_COOLDOWN_MS
} from "../InstanceRoomConstants";
import { InstancePlayerSchema } from "../schema/InstancePlayerSchema";
import { FishCombatRuntimeState } from "../types/combat";
import { InstanceRoomHost } from "../context/InstanceRoomHost";

export function getOrCreateFishCombatState(room: InstanceRoomHost, userId: string): FishCombatRuntimeState {
    let runtime = room.fishCombatByUserId.get(userId);
    if (runtime) return runtime;
    runtime = {
        active: false,
        queue: [],
        headIndex: 0,
        cooldownByFishEntryId: new Map<string, number>()
    };
    room.fishCombatByUserId.set(userId, runtime);
    return runtime;
}

export function scheduleFishCombatTimer(room: InstanceRoomHost, callback: () => void, delayMs: number) {
    const timer = setTimeout(() => {
        room.fishCombatTimers.delete(timer);
        callback();
    }, Math.max(0, Math.floor(delayMs)));
    room.fishCombatTimers.add(timer);
}

export function buildAwakenedFishQueue(entries: GlimmerbowlEntry[]): string[] {
    const awakenedIds = entries
        .filter((entry) => entry.tier === "awakened")
        .map((entry) => entry.id);
    for (let i = awakenedIds.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = awakenedIds[i];
        awakenedIds[i] = awakenedIds[j];
        awakenedIds[j] = tmp;
    }
    return awakenedIds;
}

export function isFishCombatLaunchAllowed(player: InstancePlayerSchema): boolean {
    if (player.isFishing) return false;
    if (player.isGuiOpen) return false;
    if (player.isChatOpen) return false;
    if (player.isAfk) return false;
    return true;
}

export function selectFishForLaunch(entries: GlimmerbowlEntry[], runtime: FishCombatRuntimeState, nowMs: number): GlimmerbowlEntry | null {
    const awakenedEntries = entries.filter((entry) => entry.tier === "awakened");
    if (awakenedEntries.length === 0) {
        runtime.queue = [];
        runtime.headIndex = 0;
        return null;
    }

    const awakenedById = new Map<string, GlimmerbowlEntry>();
    awakenedEntries.forEach((entry) => awakenedById.set(entry.id, entry));
    const validIds = new Set(awakenedById.keys());

    runtime.queue = runtime.queue.filter((fishEntryId) => validIds.has(fishEntryId));
    Array.from(runtime.cooldownByFishEntryId.keys()).forEach((fishEntryId) => {
        if (!validIds.has(fishEntryId)) runtime.cooldownByFishEntryId.delete(fishEntryId);
    });

    if (runtime.queue.length === 0) {
        runtime.queue = buildAwakenedFishQueue(awakenedEntries);
        runtime.headIndex = 0;
    }
    if (runtime.queue.length === 0) return null;

    runtime.headIndex = Math.max(0, Math.min(runtime.headIndex, runtime.queue.length - 1));
    const isReady = (fishEntryId: string) => {
        const readyAt = runtime.cooldownByFishEntryId.get(fishEntryId) ?? 0;
        return readyAt <= nowMs;
    };

    const headFishEntryId = runtime.queue[runtime.headIndex];
    let selectedFishEntryId: string | null = null;
    if (headFishEntryId && isReady(headFishEntryId)) {
        selectedFishEntryId = headFishEntryId;
        runtime.headIndex = (runtime.headIndex + 1) % runtime.queue.length;
    } else {
        for (let offset = 1; offset < runtime.queue.length; offset += 1) {
            const idx = (runtime.headIndex + offset) % runtime.queue.length;
            const candidateEntryId = runtime.queue[idx];
            if (!candidateEntryId) continue;
            if (isReady(candidateEntryId)) {
                selectedFishEntryId = candidateEntryId;
                break;
            }
        }
    }

    if (!selectedFishEntryId) return null;
    return awakenedById.get(selectedFishEntryId) ?? null;
}

export function getFishCombatCooldownMs(speed: number): number {
    const safeSpeed = Math.max(0.05, Number.isFinite(speed) ? speed : 0.05);
    const cooldownMs = (1 / safeSpeed) * 3000;
    return Math.max(FISH_COMBAT_MIN_COOLDOWN_MS, Math.min(FISH_COMBAT_MAX_COOLDOWN_MS, Math.round(cooldownMs)));
}

export async function handleGlimmerbowlCombatState(room: InstanceRoomHost, client: Client, data: GlimmerbowlCombatStatePayload): Promise<void> {
    const player = room.state.players.get(client.sessionId);
    if (!player) return;
    const userId = player.odcid;
    const runtime = getOrCreateFishCombatState(room, userId);
    const wantsActive = Boolean(data?.active);

    if (!wantsActive) {
        runtime.active = false;
        runtime.queue = [];
        runtime.headIndex = 0;
        return;
    }

    if (runtime.active) return;
    if (!await room.isGlimmerbowlUnlocked(userId)) return;
    if (!isFishCombatLaunchAllowed(player)) return;

    const entries = await room.deps.glimmerbowlCache.getEntries(userId);
    runtime.queue = buildAwakenedFishQueue(entries);
    runtime.headIndex = 0;
    runtime.active = runtime.queue.length > 0;
}

export async function handleGlimmerbowlLaunch(room: InstanceRoomHost, client: Client, data: GlimmerbowlLaunchRequestPayload): Promise<void> {
    const player = room.state.players.get(client.sessionId);
    if (!player) return;
    if (!Number.isFinite(data?.targetX) || !Number.isFinite(data?.targetY)) return;
    if (!isFishCombatLaunchAllowed(player)) return;

    const userId = player.odcid;
    const runtime = getOrCreateFishCombatState(room, userId);
    if (!runtime.active) return;
    if (!await room.isGlimmerbowlUnlocked(userId)) return;

    const now = Date.now();
    const entries = await room.deps.glimmerbowlCache.getEntries(userId);
    const fishEntry = selectFishForLaunch(entries, runtime, now);
    if (!fishEntry) return;

    const cooldownMs = getFishCombatCooldownMs(fishEntry.stats.speed);

    const fromX = player.x;
    const fromY = player.y;
    const targetX = Number(data.targetX);
    const targetY = Number(data.targetY);
    const distancePx = Math.hypot(targetX - fromX, targetY - fromY);
    if (distancePx > FISH_COMBAT_MAX_LAUNCH_RANGE_PX) return;

    const outboundSpeedPxPerSec = 170 + Math.max(0.1, fishEntry.stats.speed) * 40;
    const outboundMs = Math.max(180, Math.min(950, Math.round((distancePx / outboundSpeedPxPerSec) * 1000)));
    const returnMs = Math.max(120, Math.round(outboundMs * 0.72));
    runtime.cooldownByFishEntryId.set(fishEntry.id, now + outboundMs + returnMs + cooldownMs);
    const arcHeightPx = Math.max(14, Math.min(72, 16 + distancePx * 0.12));
    const eventId = randomUUID();

    const launchPayload: GlimmerbowlFishLaunchEvent = {
        eventId,
        ownerSessionId: client.sessionId,
        fishEntryId: fishEntry.id,
        fishItemId: fishEntry.itemId,
        launchedAt: now,
        fromX,
        fromY,
        targetX,
        targetY,
        outboundMs,
        returnMs,
        arcHeightPx
    };

    room.broadcast("glimmerbowl:fish-launch", launchPayload);
    scheduleFishCombatTimer(room, () => {
        processFishLanding(room, launchPayload, fishEntry);
    }, outboundMs);
}

export function processFishLanding(room: InstanceRoomHost, launchPayload: GlimmerbowlFishLaunchEvent, fishEntry: GlimmerbowlEntry) {
    const landAt = Date.now();
    const stats = fishEntry.stats;
    const radiusPx = Math.max(8, (Math.max(1, Number.isFinite(stats.energy) ? stats.energy : 1) / 3) * AI_METERS_TO_PIXELS);
    const radiusSq = radiusPx * radiusPx;
    const critRate = room.clampNumber(stats.critRate, 0, 1);
    const critDamage = Math.max(1, Number.isFinite(stats.critDamage) ? stats.critDamage : 1);
    const baseDamage = Math.max(1, Number.isFinite(stats.damage) ? stats.damage : 1) * 4;
    const hits: GlimmerbowlFishLandEvent["hits"] = [];

    room.state.aiNpcs.forEach((npc: any, aiId: string) => {
        if (!npc || npc.controllerId !== "general-enemy") return;
        const runtime = room.aiRuntimeById.get(aiId);
        if (runtime?.isDead) return;
        const health = Number(runtime?.currentHealth ?? npc.currentHealth ?? 0);
        if (!Number.isFinite(health) || health <= 0) return;

        const dx = Number(npc.x) - launchPayload.targetX;
        const dy = Number(npc.y) - launchPayload.targetY;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        if ((dx * dx) + (dy * dy) > radiusSq) return;

        const variance = 0.9 + Math.random() * 0.2;
        const isCrit = Math.random() < critRate;
        let rolledDamage = baseDamage * variance;
        if (isCrit) {
            rolledDamage *= critDamage;
        }
        const damage = Math.max(1, Math.floor(rolledDamage));
        room.applyEnemyKnockbackFromFishLaunch(aiId, launchPayload.fromX, launchPayload.fromY, damage);
        if (!room.applyEnemyDamage(aiId, damage)) return;
        hits.push({ aiId, damage, isCrit });
    });

    const landPayload: GlimmerbowlFishLandEvent = {
        eventId: launchPayload.eventId,
        ownerSessionId: launchPayload.ownerSessionId,
        fishEntryId: launchPayload.fishEntryId,
        fishItemId: launchPayload.fishItemId,
        landedAt: landAt,
        targetX: launchPayload.targetX,
        targetY: launchPayload.targetY,
        radiusPx,
        hits
    };
    room.broadcast("glimmerbowl:fish-land", landPayload);

    const owner = room.state.players.get(launchPayload.ownerSessionId);
    const returnPayload: GlimmerbowlFishReturnEvent = {
        eventId: launchPayload.eventId,
        ownerSessionId: launchPayload.ownerSessionId,
        fishEntryId: launchPayload.fishEntryId,
        fishItemId: launchPayload.fishItemId,
        returnStartedAt: landAt,
        fromX: launchPayload.targetX,
        fromY: launchPayload.targetY,
        toX: owner?.x ?? launchPayload.fromX,
        toY: owner?.y ?? launchPayload.fromY,
        returnMs: launchPayload.returnMs,
        arcHeightPx: Math.max(10, launchPayload.arcHeightPx * 0.68)
    };
    room.broadcast("glimmerbowl:fish-return", returnPayload);
}
