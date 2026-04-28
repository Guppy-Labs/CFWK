import { Client } from "colyseus";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import { grantItemToPlayer } from "./InventoryGrantService";

type DialogueGiveItemPayload = {
    npcId?: string;
    itemId?: string;
    amount?: number;
    ifMissing?: boolean;
};

const DIALOGUE_ITEM_GRANTS: Record<string, Record<string, { amount: number; ifMissingOnly: boolean; noSpaceMessage?: string }>> = {
    fisherman: {
        rickety_rod: {
            amount: 1,
            ifMissingOnly: true,
            noSpaceMessage: "Clear one inventory slot so the Fisherman can hand you a rod."
        }
    },
    merchant: {
        jar: {
            amount: 1,
            ifMissingOnly: true,
            noSpaceMessage: "Clear one inventory slot so the Merchant can hand you a jar."
        }
    },
    wizard: {
        nightfire_scar: {
            amount: 1,
            ifMissingOnly: true,
            noSpaceMessage: "Clear one inventory slot so the Wizard can hand you the scar."
        }
    }
};

export function registerNpcAndDebugHandlers(room: InstanceRoomHost) {
    room.onMessage("npc:interact", async (client, data: { npcId?: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        if (!data || typeof data.npcId !== "string" || !data.npcId.trim()) return;
        const npcId = data.npcId.trim();

        room.incrementStat(client, player, "npcInteractions", 1);
        void room.advancementsManager.onNpcInteract(player.odcid, npcId)
            .then(async (updates: any) => {
                await room.sendAdvancements(client, updates);
                await room.syncInventoryCountObjectives(client, player.odcid);
            })
            .catch((error: unknown) => {
                console.error("[InstanceRoom] npc advancements failed:", error);
            });
    });

    room.onMessage("dialogue:give-item", async (client, data: DialogueGiveItemPayload) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const npcId = typeof data?.npcId === "string" ? data.npcId.trim().toLowerCase() : "";
        const itemId = typeof data?.itemId === "string" ? data.itemId.trim() : "";
        if (!npcId || !itemId) return;

        const grantRule = DIALOGUE_ITEM_GRANTS[npcId]?.[itemId];
        if (!grantRule) {
            console.warn(`[InstanceRoom] Rejected dialogue:give-item request npc=${npcId} item=${itemId}`);
            return;
        }

        const {
            items: slots,
            equippedRodId,
            equippedUsableIds
        } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        const enforceIfMissing = grantRule.ifMissingOnly || data?.ifMissing === true;
        const alreadyHasItem = slots.some((slot: { itemId: string | null; count: number }) => slot.itemId === itemId && slot.count > 0)
            || equippedRodId === itemId
            || (Array.isArray(equippedUsableIds) && equippedUsableIds.some((equippedItemId: string | null) => equippedItemId === itemId));
        if (enforceIfMissing && alreadyHasItem) return;

        await grantItemToPlayer(room, client, {
            itemId,
            amount: grantRule.amount,
            userId: player.odcid,
            notifyIfNoSpace: grantRule.noSpaceMessage
        });
    });

    room.onMessage("debug:npc:action", async (client, data: { action?: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const action = typeof data?.action === "string" ? data.action.trim().toLowerCase() : "";
        if (!action) return;

        const canUseDebugNpc = await room.canUseDebugNpc();
        if (!canUseDebugNpc) {
            console.log(`[InstanceRoom] Debug NPC action denied for ${player.odcid}: feature disabled.`);
            client.send("debug:npc:availability", { enabled: false });
            return;
        }

        if (action === "reset_game") {
            await room.wipePlayerGameplayData(player.odcid);
            return;
        }

        if (action === "get_scar") {
            const updated = await room.giveDebugNpcItem(client, player, "nightfire_scar", 1);
            if (updated) {
                await room.setHasOwnedScarFromInventory(player.odcid, updated);
            }
            return;
        }

        if (action === "get_dev_rod") {
            await room.giveDebugNpcItem(client, player, "developer_rod", 1);
        }
    });

    room.onMessage("debug:npc:get-availability", async (client) => {
        room.markActivity(client);
        const enabled = await room.canUseDebugNpc();
        console.log(`[InstanceRoom] debug:npc:get-availability -> ${enabled}`);
        client.send("debug:npc:availability", { enabled });
    });
}
