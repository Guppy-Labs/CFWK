import { Client } from "colyseus";
import {
    DEFAULT_INVENTORY_SLOTS,
    DEFAULT_GUIDE_TUTORIAL_STATE,
    DEFAULT_PLAYER_HEARTS_STATE,
    IGuideTutorialState,
    isEquippableUsableItem,
    getItemDefinition
} from "@cfwk/shared";
import User from "../../../models/User";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import {
    enforceIpBan,
    getClientIP,
    registerJoinConnection,
    resolveJoinState
} from "./JoinStateResolver";
import { initializeJoinedPlayerState, sendInitialJoinPayloads } from "./JoinPayloadService";
import { wipePlayerGameplayData } from "./PlayerStateService";
import { verifyJoinToken } from "../authority/JoinTokenAuthority";
import { sanitizeEquippedRod, sanitizeEquippedUsables } from "../authority/EquipmentAuthority";
import { sanitizeTutorialPatch } from "../authority/TutorialAuthority";
import { validateClientInventoryEquipmentSnapshot } from "../authority/InventoryAuthority";

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
    registerJoinInventoryAndProgressionHandlers(room);

    room.instanceManager.playerJoined(room.instanceId);

    await startDemoTimerIfNeeded(room, client, joinState.odcid);
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

export function registerJoinInventoryAndProgressionHandlers(room: InstanceRoomHost) {
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
            const restoreHearts = forceGuideFoodHeal ? Math.max(1, guaranteed + bonus) : (guaranteed + bonus);

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
