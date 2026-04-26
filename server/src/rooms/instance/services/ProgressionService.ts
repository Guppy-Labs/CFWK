import { Client } from "colyseus";
import {
    calculateWorldTime,
    DEFAULT_PLAYER_MONEY_STATE,
    IAdvancementAlertMessage,
    IAdvancementsState
} from "@cfwk/shared";
import User from "../../../models/User";
import { AI_METERS_TO_PIXELS } from "../../../ai/registry";
import { HEED_THE_WARNING_QUEST_ID } from "../InstanceRoomConstants";
import { InstanceRoomHost } from "../context/InstanceRoomHost";

export async function sendAdvancements(
    room: InstanceRoomHost,
    client: Client,
    updates: { alerts: IAdvancementAlertMessage[]; delayedNewQuestCounts: number[] }
) {
    updates.alerts.forEach((alert) => {
        client.send("advancement:alert", alert);
    });

    const player = room.state.players.get(client.sessionId);
    if (player) {
        await processQuestCompletionRewards(room, client, player.odcid, updates.alerts);
        // Defensive cleanup: drop any lingering Skip to Night offset once
        // the bowl quest has fully completed, even if the client never
        // sent its own quest:time-skip-clear message.
        const bowlCompleted = updates.alerts.some((alert) =>
            alert.type === "quest-completed" && alert.questId === "bowl_that_shines"
        );
        if (bowlCompleted) {
            room.clientTimeOffsetByUserId?.delete(player.odcid);
        }
    }
    if (player) {
        try {
            const advancementsState = await room.advancementsManager.getStateForUser(player.odcid);
            updateHeedTheWarningUnlockState(room, player.odcid, advancementsState);
            room.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial);
            client.send("advancements:state", advancementsState);
        } catch (error) {
            console.error("[InstanceRoom] Failed to push advancements state after update:", error);
        }
    }

    updates.delayedNewQuestCounts.forEach((count) => {
        setTimeout(() => {
            if (!room.state.players.has(client.sessionId)) return;
            client.send("advancement:alert", {
                type: "new-quests",
                count
            } satisfies IAdvancementAlertMessage);
        }, 6000);
    });
}

export async function shouldForceGlimmeringKeyCatch(room: InstanceRoomHost, userId: string, x: number, y: number): Promise<boolean> {
    const clientOffsetMs = Number(room.clientTimeOffsetByUserId?.get(userId) ?? 0);
    if (!isNightWindowForGlimmeringKey(clientOffsetMs)) return false;

    const activeObjective = await room.advancementsManager.getActiveFishNearLocationObjective(userId, "KeyLocation");
    if (!activeObjective) return false;

    const radiusPx = Math.max(1, activeObjective.radiusMeters) * AI_METERS_TO_PIXELS;
    const keyLocations = room.advancementsManager.getPoiPointsByName("KeyLocation");
    if (keyLocations.length === 0) return false;

    return keyLocations.some((location: { x: number; y: number }) => Math.hypot(location.x - x, location.y - y) <= radiusPx);
}

export function isNightWindowForGlimmeringKey(offsetMs: number = 0): boolean {
    const normalizedOffset = Number.isFinite(offsetMs) ? Math.max(0, Math.floor(offsetMs)) : 0;
    const hour = calculateWorldTime(Date.now() + normalizedOffset).hour;
    return hour >= 23 || hour < 4;
}

export async function processQuestCompletionRewards(
    room: InstanceRoomHost,
    client: Client,
    userId: string,
    alerts: IAdvancementAlertMessage[]
) {
    const completedQuestIds = alerts
        .filter((alert) => alert.type === "quest-completed" && typeof alert.questId === "string")
        .map((alert) => alert.questId as string);

    if (!completedQuestIds.includes("village_weirdo")) return;

    const currentMoney = room.moneyByUserId.get(userId) ?? DEFAULT_PLAYER_MONEY_STATE.money;
    const nextMoney = room.normalizeMoneyAmount(currentMoney + 100);
    room.moneyByUserId.set(userId, nextMoney);
    if (userId !== client.sessionId) {
        await User.updateOne({ _id: userId }, { $set: { money: nextMoney } });
    }
    client.send("player:money", { money: nextMoney });
}

export function getItemCountFromSlots(slots: Array<{ itemId: string | null; count: number }>, itemId: string): number {
    return slots.reduce((sum, slot) => {
        if (slot.itemId !== itemId) return sum;
        return sum + Math.max(0, Math.floor(slot.count || 0));
    }, 0);
}

export async function sendInventoryCountObjectiveForItem(
    room: InstanceRoomHost,
    client: Client,
    userId: string,
    itemId: string,
    slots: Array<{ itemId: string | null; count: number }>
) {
    if (!itemId) return;
    const count = getItemCountFromSlots(slots, itemId);
    const updates = await room.advancementsManager.onInventoryCount(userId, itemId, count);
    if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
        await sendAdvancements(room, client, updates);
    }
}

export async function syncInventoryCountObjectives(room: InstanceRoomHost, client: Client, userId: string) {
    const { items } = await room.deps.inventoryCache.getInventoryState(userId);
    const trackedItemIds = new Set<string>();
    items.forEach((slot: { itemId: string | null; count: number }) => {
        if (typeof slot.itemId === "string" && slot.itemId.trim().length > 0) {
            trackedItemIds.add(slot.itemId);
        }
    });
    trackedItemIds.add("yekberries");

    for (const itemId of trackedItemIds) {
        await sendInventoryCountObjectiveForItem(room, client, userId, itemId, items);
    }
}

export function updateHeedTheWarningUnlockState(room: InstanceRoomHost, userId: string, state: IAdvancementsState) {
    const progress = state.questProgress?.[HEED_THE_WARNING_QUEST_ID];
    const unlocked = progress?.status === "active" || progress?.status === "completed";
    const dangerExitHealActive = progress?.status === "active";
    room.enemyBridgeUnlockedByUserId.set(userId, unlocked);
    room.heedTheWarningStayObjectiveByUserId.set(userId, dangerExitHealActive);
}
