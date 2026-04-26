import { Client } from "colyseus";
import {
    DEFAULT_INVENTORY_SLOTS,
    DEFAULT_GUIDE_TUTORIAL_STATE,
    DEFAULT_PLAYER_HEARTS_STATE,
    IGuideTutorialState,
    isEquippableUsableItem,
    getItemDefinition,
    REAL_MS_PER_GAME_SECOND
} from "@cfwk/shared";
import User from "../../../models/User";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import { sendAdvancements } from "./ProgressionService";
import {
    enforceIpBan,
    getClientIP,
    registerJoinConnection,
    resolveJoinState
} from "./JoinStateResolver";
import { initializeJoinedPlayerState, sendInitialJoinPayloads } from "./JoinPayloadService";
import { sendMovementReconcile } from "./MovementMessageService";
import { wipePlayerGameplayData } from "./PlayerStateService";
import { verifyJoinToken } from "../authority/JoinTokenAuthority";
import { sanitizeEquippedRod, sanitizeEquippedUsables } from "../authority/EquipmentAuthority";
import { sanitizeTutorialPatch } from "../authority/TutorialAuthority";
import { validateClientInventoryEquipmentSnapshot } from "../authority/InventoryAuthority";
import { DEFAULT_FIRST_CONNECT_LOCATION_ID } from "../../../config/instance";

const DEMO_DURATION_MS = 15 * 60 * 1000;
const DEMO_START_RESEND_DELAY_MS = 800;

export async function handleJoinLifecycle(
    room: InstanceRoomHost,
    client: Client,
    options: { username?: string; joinToken?: string }
) {
    const verification = verifyJoinToken(options?.joinToken || "");
    if (!verification.valid || !verification.payload) {
        console.warn("[InstanceRoom] Rejected join: invalid token", {
            reason: verification.reason || "unknown",
            instanceId: room.instanceId || room.state?.instanceId,
            locationId: room.state?.locationId
        });
        throw new Error("UNAUTHORIZED_JOIN");
    }

    const expectedInstanceId = String(room.instanceId || room.state?.instanceId || "");
    const expectedLocationId = String(room.state?.locationId || "");
    const expectedRoomName = typeof room.roomName === "string" ? room.roomName : "instance";
    if (
        verification.payload.iid !== expectedInstanceId ||
        verification.payload.lid !== expectedLocationId ||
        verification.payload.room !== expectedRoomName
    ) {
        console.warn("[InstanceRoom] Rejected join: token scope mismatch", {
            expectedInstanceId,
            expectedLocationId,
            expectedRoomName,
            tokenInstanceId: verification.payload.iid,
            tokenLocationId: verification.payload.lid,
            tokenRoomName: verification.payload.room
        });
        throw new Error("UNAUTHORIZED_JOIN");
    }

    const odcid = verification.payload.uid;
    const clientIP = getClientIP(client);
    const forceMapSpawn = verification.payload.rsp === 1;

    await enforceIpBan(clientIP);
    const joinState = await resolveJoinState(room, client, odcid, clientIP, { forceMapSpawn });

    registerJoinConnection(room, client, joinState.odcid);
    initializeJoinedPlayerState(room, client, options, joinState);
    await sendInitialJoinPayloads(room, client, joinState);
    applyIntroCutsceneSpawnOverride(room, client);
    registerJoinInventoryAndProgressionHandlers(room);

    room.instanceManager.playerJoined(room.instanceId);

    await startDemoTimerIfNeeded(room, client, joinState.odcid);
}

function applyIntroCutsceneSpawnOverride(room: InstanceRoomHost, client: Client): void {
    if (room.state.locationId !== DEFAULT_FIRST_CONNECT_LOCATION_ID) return;

    const tutorial = room.tutorialStateBySession.get(client.sessionId);
    if (!tutorial || tutorial.introCutsceneCompleted) return;

    const poiPoints = room.advancementsManager.getPoiPointsByName('IntroPlayerLocation');
    if (poiPoints.length === 0) return;

    const poi = poiPoints[0];
    const player = room.state.players.get(client.sessionId);
    if (!player) return;

    player.x = poi.x;
    player.y = poi.y;
    player.vx = 0;
    player.vy = 0;

    const history = room.positionHistoryBySession.get(client.sessionId);
    if (history) {
        history.length = 0;
        history.push({ tick: room.gameTick, time: Date.now(), x: poi.x, y: poi.y });
    }

    const runtime = room.movementRuntimeBySession.get(client.sessionId);
    if (runtime) {
        runtime.hardAuthorityUntil = Date.now() + 2000;
    }

    sendMovementReconcile(room, client, player, 0, 'hard-server', true, 0, 'intro-cutscene-spawn');
}

async function startDemoTimerIfNeeded(room: InstanceRoomHost, client: Client, odcid: string) {
    try {
        const user = await User.findById(odcid);
        if (!user?.isDemo) return;

        if (!room.demoTimers) room.demoTimers = new Map<string, ReturnType<typeof setTimeout>>();

        const existing = room.demoTimers.get(client.sessionId);
        if (existing) clearTimeout(existing);

        const expiresAt = Date.now() + DEMO_DURATION_MS;
        const demoPayload = { durationMs: DEMO_DURATION_MS, expiresAt };
        sendDemoStartMessage(room, client, demoPayload, "initial");
        // Resend shortly after join to avoid message timing races on client startup.
        setTimeout(() => sendDemoStartMessage(room, client, demoPayload, "resend"), DEMO_START_RESEND_DELAY_MS);

        console.log("[DemoMode] Demo session started", {
            odcid,
            sessionId: client.sessionId,
            expiresAt
        });

        const timer = setTimeout(async () => {
            room.demoTimers?.delete(client.sessionId);
            try {
                room.wipedUserIds.add(odcid);
                client.leave(4006, "Demo session expired.");
                await wipePlayerGameplayData(room, odcid);
            } catch (err) {
                console.error("[DemoMode] Failed to wipe demo user:", err);
            }
        }, DEMO_DURATION_MS);

        room.demoTimers.set(client.sessionId, timer);
    } catch (err) {
        console.error("[DemoMode] Error checking demo status:", err);
    }
}

function sendDemoStartMessage(
    room: InstanceRoomHost,
    client: Client,
    payload: { durationMs: number; expiresAt: number },
    attempt: "initial" | "resend"
) {
    const stillConnected = room.state?.players?.has(client.sessionId);
    if (!stillConnected) return;
    try {
        client.send("demo:start", payload);
        console.log(`[DemoMode] Sent demo:start (${attempt}) for session ${client.sessionId}`);
    } catch (err) {
        console.error(`[DemoMode] Failed to send demo:start (${attempt}):`, err);
    }
}

const MAX_CLIENT_TIME_OFFSET_MS = 24 * 60 * 60 * REAL_MS_PER_GAME_SECOND; // one full game day
const BOWL_QUEST_ID = "bowl_that_shines";
const BOWL_QUEST_SKIP_OBJECTIVE_INDICES = new Set([2, 3]);

export function registerJoinInventoryAndProgressionHandlers(room: InstanceRoomHost) {
    room.onMessage("quest:time-skip", async (client, data: { offsetMs?: number }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const rawOffset = Number(data?.offsetMs);
        if (!Number.isFinite(rawOffset)) return;
        const offsetMs = Math.max(0, Math.min(MAX_CLIENT_TIME_OFFSET_MS, Math.floor(rawOffset)));
        if (offsetMs <= 0) return;

        try {
            const advancementsState = await room.advancementsManager.getStateForUser(player.odcid);
            const progress = advancementsState.questProgress?.[BOWL_QUEST_ID];
            if (!progress || progress.status !== "active") return;
            const objectiveIndex = typeof progress.objectiveIndex === "number"
                ? Math.floor(progress.objectiveIndex)
                : -1;
            if (!BOWL_QUEST_SKIP_OBJECTIVE_INDICES.has(objectiveIndex)) return;

            room.clientTimeOffsetByUserId.set(player.odcid, offsetMs);

            const updates = await room.advancementsManager.applyTimeWindowForUser(player.odcid, offsetMs);
            if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
                await sendAdvancements(room, client, updates);
            } else {
                const refreshedState = await room.advancementsManager.getStateForUser(player.odcid);
                client.send("advancements:state", refreshedState);
            }
        } catch (error) {
            console.error("[InstanceRoom] quest:time-skip failed:", error);
        }
    });

    room.onMessage("quest:time-skip-clear", (client) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        room.clientTimeOffsetByUserId.delete(player.odcid);
    });

    room.onMessage("advancements:get", async (client) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        try {
            const advancementsState = await room.advancementsManager.getStateForUser(player.odcid);
            room.updateHeedTheWarningUnlockState(player.odcid, advancementsState);
            room.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial);
            client.send("advancements:state", advancementsState);
        } catch (err) {
            console.error("[InstanceRoom] Error responding with advancements state:", err);
        }
    });

    room.onMessage("guide:update", async (client, data: { tutorial?: Partial<IGuideTutorialState> }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const tutorialPatch = data?.tutorial;
        if (!tutorialPatch || typeof tutorialPatch !== "object") return;

        try {
            const currentTutorial = room.tutorialStateBySession.get(client.sessionId)
                ?? { ...DEFAULT_GUIDE_TUTORIAL_STATE };
            const sanitizedPatch = sanitizeTutorialPatch(currentTutorial, tutorialPatch);
            if (!sanitizedPatch) return;
            const advancementsState = await room.advancementsManager.updateTutorialState(player.odcid, sanitizedPatch);
            if (!advancementsState) return;
            room.updateHeedTheWarningUnlockState(player.odcid, advancementsState);
            room.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial);
            client.send("advancements:state", advancementsState);
        } catch (error) {
            console.error("[InstanceRoom] Failed to update guide tutorial state:", error);
        }
    });

    room.onMessage("guide:tutorial-stab", async (client) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const sessionId = client.sessionId;
        if (room.tutorialStabAppliedBySession.get(sessionId) === true) return;

        const tutorial = room.tutorialStateBySession.get(sessionId);
        if (!tutorial) return;
        if (tutorial.foodStep !== "consume_quickslot_1") return;
        if (tutorial.forceFoodGuideHeal !== true) return;

        const userId = player.odcid;
        const current = room.heartsByUserId.get(userId) ?? { ...DEFAULT_PLAYER_HEARTS_STATE };
        room.tutorialStabAppliedBySession.set(sessionId, true);
        if (current.currentHearts <= 0) return;

        const next = room.normalizeHeartsState({
            currentHearts: current.currentHearts - 1,
            maxHearts: current.maxHearts
        });
        room.heartsByUserId.set(userId, next);
        client.send("player:hearts", next);

        if (userId && userId !== sessionId) {
            try {
                await User.updateOne({ _id: userId }, { $set: { hearts: next } });
            } catch (error) {
                console.error("[InstanceRoom] Failed to persist tutorial stab hearts:", error);
            }
        }
    });

    room.onMessage("equipment:set", async (client, data: {
        slots?: Array<{ index: number; itemId: string | null; count: number }>;
        equippedRodId?: string | null;
        equippedUsableIds?: Array<string | null>;
        equippedUsableCounts?: number[];
    }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const {
            items: slots,
            equippedRodId: previousRodId,
            equippedUsableIds: previousUsables,
            equippedUsableCounts: previousUsableCounts
        } = await room.deps.inventoryCache.getInventoryState(player.odcid);

        if (Array.isArray(data?.slots)) {
            const validation = validateClientInventoryEquipmentSnapshot({
                currentSlots: slots,
                currentEquippedRodId: previousRodId,
                currentEquippedUsableIds: previousUsables,
                currentEquippedUsableCounts: previousUsableCounts,
                candidateSlots: data.slots,
                candidateEquippedRodId: data?.equippedRodId,
                candidateEquippedUsableIds: data?.equippedUsableIds,
                candidateEquippedUsableCounts: data?.equippedUsableCounts
            });
            if (!validation.valid) {
                console.warn(`[InstanceRoom] Rejected equipment:set for ${player.odcid}: ${validation.reason}`);
                client.send("inventory", {
                    slots,
                    totalSlots: DEFAULT_INVENTORY_SLOTS,
                    equippedRodId: previousRodId,
                    equippedUsableIds: previousUsables,
                    equippedUsableCounts: previousUsableCounts
                });
                return;
            }

            room.deps.inventoryCache.setInventory(player.odcid, validation.slots);
            room.deps.inventoryCache.setEquippedRod(player.odcid, validation.equippedRodId);
            room.deps.inventoryCache.setEquippedUsables(
                player.odcid,
                validation.equippedUsableIds,
                validation.equippedUsableCounts
            );

            client.send("inventory", {
                slots: validation.slots,
                totalSlots: DEFAULT_INVENTORY_SLOTS,
                equippedRodId: validation.equippedRodId,
                equippedUsableIds: validation.equippedUsableIds,
                equippedUsableCounts: validation.equippedUsableCounts
            });
            return;
        }

        const equippedRodId = sanitizeEquippedRod(slots, data?.equippedRodId, previousRodId);
        const equippedUsableIds = sanitizeEquippedUsables(slots, data?.equippedUsableIds, previousUsables);
        const equippedUsableCounts = equippedUsableIds.map((itemId) => (itemId ? 1 : 0));

        room.deps.inventoryCache.setEquippedRod(player.odcid, equippedRodId);
        room.deps.inventoryCache.setEquippedUsables(player.odcid, equippedUsableIds, equippedUsableCounts);

        client.send("inventory", {
            slots,
            totalSlots: DEFAULT_INVENTORY_SLOTS,
            equippedRodId,
            equippedUsableIds,
            equippedUsableCounts
        });
    });

    room.onMessage("item:use", async (client, data: { slotIndex?: number }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        if (room.defeatedByUserId.get(player.odcid || client.sessionId)) return;

        const slotIndex = typeof data?.slotIndex === "number" ? Math.floor(data.slotIndex) : -1;
        if (slotIndex < 0) return;

        const equippedUsables = room.deps.inventoryCache.getEquippedUsables(player.odcid);
        const equippedUsableCounts = room.deps.inventoryCache.getEquippedUsableCounts(player.odcid);
        if (slotIndex >= equippedUsables.length) return;

        const equippedItemId = equippedUsables[slotIndex];
        if (!equippedItemId) return;

        const itemDef = getItemDefinition(equippedItemId);
        if (!isEquippableUsableItem(itemDef)) return;

        const { items: currentSlots } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        const equippedCount = Number.isFinite(equippedUsableCounts[slotIndex])
            ? Math.max(0, Math.floor(equippedUsableCounts[slotIndex]))
            : 0;
        if (equippedCount <= 0) return;
        const nextUsables = [...equippedUsables];
        const nextUsableCounts = [...equippedUsableCounts];
        const remainingCount = equippedCount - 1;
        if (remainingCount <= 0) {
            nextUsables[slotIndex] = null;
            nextUsableCounts[slotIndex] = 0;
        } else {
            nextUsables[slotIndex] = equippedItemId;
            nextUsableCounts[slotIndex] = remainingCount;
        }
        room.deps.inventoryCache.setEquippedUsables(player.odcid, nextUsables, nextUsableCounts);

        const guidedTutorial = room.tutorialStateBySession.get(client.sessionId);
        const forceGuideFoodHeal = guidedTutorial?.forceFoodGuideHeal === true && equippedItemId === "yekberries";

        if (itemDef?.category === "Food") {
            const score = Math.max(0, Math.floor(itemDef.foodScore ?? 0));
            const guaranteed = Math.floor(score / 100);
            const remainder = score - guaranteed * 100;
            const bonus = Math.random() * 100 < remainder ? 1 : 0;
            const restoreHearts = forceGuideFoodHeal ? 1 : (guaranteed + bonus);

            if (restoreHearts > 0) {
                const current = room.heartsByUserId.get(player.odcid) ?? { ...DEFAULT_PLAYER_HEARTS_STATE };
                const next = room.normalizeHeartsState({
                    currentHearts: current.currentHearts + restoreHearts,
                    maxHearts: current.maxHearts
                });
                room.heartsByUserId.set(player.odcid, next);
                client.send("player:hearts", next);
                if (player.odcid !== client.sessionId) {
                    await User.updateOne({ _id: player.odcid }, { $set: { hearts: next } });
                }
            }
        }

        if (forceGuideFoodHeal) {
            try {
                const advancementsState = await room.advancementsManager.updateTutorialState(player.odcid, {
                    forceFoodGuideHeal: false
                });
                if (advancementsState) {
                    room.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial);
                    client.send("advancements:state", advancementsState);
                }
            } catch (error) {
                console.error("[InstanceRoom] Failed clearing food guide heal flag:", error);
            }
        }

        const {
            equippedRodId,
            equippedUsableIds,
            equippedUsableCounts: equippedUsableCountsAfterUse
        } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        client.send("inventory", {
            slots: currentSlots,
            totalSlots: DEFAULT_INVENTORY_SLOTS,
            equippedRodId,
            equippedUsableIds,
            equippedUsableCounts: equippedUsableCountsAfterUse
        });
        client.send("inventory:consumed", {
            itemId: equippedItemId,
            quantity: 1,
            slotIndex
        });
    });
}
