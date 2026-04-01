import { Client } from "colyseus";
import {
    DEFAULT_INVENTORY_SLOTS,
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

export async function handleJoinLifecycle(
    room: InstanceRoomHost,
    client: Client,
    options: { username?: string; odcid?: string }
) {
    const odcid = options.odcid || client.sessionId;
    const clientIP = getClientIP(client);

    await enforceIpBan(clientIP);
    const joinState = await resolveJoinState(room, client, odcid, clientIP);

    registerJoinConnection(room, client, joinState.odcid);
    initializeJoinedPlayerState(room, client, options, joinState);
    await sendInitialJoinPayloads(room, client, joinState);
    registerJoinInventoryAndProgressionHandlers(room);

    room.instanceManager.playerJoined(room.instanceId);
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
            const advancementsState = await room.advancementsManager.updateTutorialState(player.odcid, tutorialPatch);
            if (!advancementsState) return;
            room.updateHeedTheWarningUnlockState(player.odcid, advancementsState);
            room.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial);
            client.send("advancements:state", advancementsState);
        } catch (error) {
            console.error("[InstanceRoom] Failed to update guide tutorial state:", error);
        }
    });

    room.onMessage("equipment:set", async (client, data: { equippedRodId?: string | null; equippedUsableIds?: Array<string | null> }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const equippedRodId = data?.equippedRodId ?? null;
        room.deps.inventoryCache.setEquippedRod(player.odcid, equippedRodId);
        if (Array.isArray(data?.equippedUsableIds)) {
            room.deps.inventoryCache.setEquippedUsables(player.odcid, data.equippedUsableIds);
        }

        const { items: slots, equippedUsableIds } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        client.send("inventory", { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId, equippedUsableIds });
    });

    room.onMessage("item:use", async (client, data: { slotIndex?: number }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const slotIndex = typeof data?.slotIndex === "number" ? Math.floor(data.slotIndex) : -1;
        if (slotIndex < 0) return;

        const equippedUsables = room.deps.inventoryCache.getEquippedUsables(player.odcid);
        if (slotIndex >= equippedUsables.length) return;

        const equippedItemId = equippedUsables[slotIndex];
        if (!equippedItemId) return;

        const itemDef = getItemDefinition(equippedItemId);
        if (!isEquippableUsableItem(itemDef)) return;

        const { items: currentSlots } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        const inventoryCountForItem = currentSlots
            .filter((slot: { itemId: string | null; count: number }) => slot.itemId === equippedItemId)
            .reduce((sum: number, slot: { itemId: string | null; count: number }) => sum + slot.count, 0);

        let updatedSlots = currentSlots;
        if (inventoryCountForItem > 0) {
            const removed = await room.deps.inventoryCache.removeItem(player.odcid, equippedItemId, 1);
            if (!removed) return;
            updatedSlots = removed;
        }

        const nextUsables = [...equippedUsables];
        nextUsables[slotIndex] = null;
        room.deps.inventoryCache.setEquippedUsables(player.odcid, nextUsables);

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

        const { equippedRodId, equippedUsableIds } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        client.send("inventory", {
            slots: updatedSlots,
            totalSlots: DEFAULT_INVENTORY_SLOTS,
            equippedRodId,
            equippedUsableIds
        });
        client.send("inventory:consumed", {
            itemId: equippedItemId,
            quantity: 1,
            slotIndex
        });
    });
}
