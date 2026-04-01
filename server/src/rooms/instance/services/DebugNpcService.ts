import { InstanceRoomHost } from "../context/InstanceRoomHost";

export function registerNpcAndDebugHandlers(room: InstanceRoomHost) {
    room.onMessage("npc:interact", (client, data: { npcId?: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        if (!data || typeof data.npcId !== "string" || !data.npcId.trim()) return;

        room.incrementStat(client, player, "npcInteractions", 1);
        void room.advancementsManager.onNpcInteract(player.odcid, data.npcId.trim())
            .then(async (updates: any) => {
                await room.sendAdvancements(client, updates);
                await room.syncInventoryCountObjectives(client, player.odcid);
            })
            .catch((error: unknown) => {
                console.error("[InstanceRoom] npc advancements failed:", error);
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
