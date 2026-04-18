import { Client } from "colyseus";
import { DEFAULT_INVENTORY_SLOTS, DEFAULT_PLAYER_HEARTS_STATE, DEFAULT_PLAYER_MONEY_STATE, GlimmerbowlEntry } from "@cfwk/shared";
import { PlayerStatsCache } from "../../../managers/PlayerStatsCache";
import { InstanceRoomHost } from "../context/InstanceRoomHost";

export function registerAdminEventListeners(room: InstanceRoomHost) {
    room.instanceManager.events.on("broadcast", (msg: string) => {
        room.broadcast("chat", {
            username: "SYSTEM",
            odcid: "SYSTEM",
            message: msg,
            timestamp: Date.now(),
            isSystem: true
        });
    });

    room.instanceManager.events.on("ban", (bannedUserId: string) => {
        try {
            room.clients.forEach((client: Client) => {
                const player = room.state.players.get(client.sessionId);
                if (player && player.odcid === bannedUserId) {
                    client.leave(4003, "You have been banned.");
                }
            });
        } catch (e) {
            console.error("Error processing ban kick:", e);
        }
    });

    room.instanceManager.events.on("msg_user", (data: { userId: string; message: string }) => {
        room.clients.forEach((client: Client) => {
            const player = room.state.players.get(client.sessionId);
            if (player && player.odcid === data.userId) {
                client.send("chat", {
                    username: "SYSTEM",
                    odcid: "SYSTEM",
                    message: data.message,
                    timestamp: Date.now(),
                    isSystem: true
                });
            }
        });
    });

    room.instanceManager.events.on("inventory_update", (data: { userId: string; items: { index: number; itemId: string | null; count: number }[] }) => {
        void room.setHasOwnedScarFromInventory(data.userId, data.items);
        room.clients.forEach((client: Client) => {
            const player = room.state.players.get(client.sessionId);
            if (player && player.odcid === data.userId) {
                const equippedRodId = room.deps.inventoryCache.getEquippedRod(data.userId);
                const equippedUsableIds = room.deps.inventoryCache.getEquippedUsables(data.userId);
                const equippedUsableCounts = room.deps.inventoryCache.getEquippedUsableCounts(data.userId);
                client.send("inventory", {
                    slots: data.items,
                    totalSlots: DEFAULT_INVENTORY_SLOTS,
                    equippedRodId,
                    equippedUsableIds,
                    equippedUsableCounts
                });
            }
        });
    });

    room.instanceManager.events.on("glimmerbowl_update", (data: { userId: string; entries: GlimmerbowlEntry[]; unlocked?: boolean; hasOwnedScar?: boolean }) => {
        void (async () => {
            const hasOwnedScar = typeof data.hasOwnedScar === "boolean"
                ? data.hasOwnedScar
                : await room.hasOwnedScar(data.userId);
            room.clients.forEach((client: Client) => {
                const player = room.state.players.get(client.sessionId);
                if (player && player.odcid === data.userId) {
                    client.send("glimmerbowl", {
                        entries: data.entries,
                        unlocked: data.unlocked ?? true,
                        hasOwnedScar
                    });
                }
            });
        })();
    });

    room.instanceManager.events.on("money_update", (data: { userId: string; money: number }) => {
        const nextMoney = room.normalizeMoneyAmount(data.money);
        room.moneyByUserId.set(data.userId, nextMoney);
        room.clients.forEach((client: Client) => {
            const player = room.state.players.get(client.sessionId);
            if (player && player.odcid === data.userId) {
                client.send("player:money", { money: nextMoney });
            }
        });
    });

    room.instanceManager.events.on("drop_item", (data: { userId: string; itemId: string; amount: number }) => {
        room.clients.forEach((client: Client) => {
            const player = room.state.players.get(client.sessionId);
            if (player && player.odcid === data.userId) {
                room.createDroppedItem(data.itemId, data.amount, player.x, player.y);
            }
        });
    });

    room.instanceManager.events.on("send_user", (data: { userId: string; locationId: string }) => {
        room.clients.forEach((client: Client) => {
            const player = room.state.players.get(client.sessionId);
            if (player && player.odcid === data.userId) {
                client.send("server:transfer", {
                    locationId: data.locationId
                });
            }
        });
    });

    room.instanceManager.events.on("beta_kick", (data: { userIds: string[]; reason?: string }) => {
        const idSet = new Set(data.userIds || []);
        if (idSet.size === 0) return;
        room.clients.forEach((client: Client) => {
            const player = room.state.players.get(client.sessionId);
            if (player && idSet.has(player.odcid)) {
                client.leave(4004, data.reason || "Beta access ended");
            }
        });
    });

    room.instanceManager.events.on("clear_progress", (data: { userId: string }) => {
        room.advancementsManager.clearCachedUser(data.userId);
        room.clients.forEach((client: Client) => {
            const player = room.state.players.get(client.sessionId);
            if (!player || player.odcid !== data.userId) return;

            void room.advancementsManager.getStateForUser(data.userId)
                .then((state: any) => {
                    room.updateHeedTheWarningUnlockState(data.userId, state);
                    client.send("advancements:state", state);
                })
                .catch((error: unknown) => {
                    console.error("[InstanceRoom] Failed to push advancements state after clear_progress:", error);
                });
        });
    });

    room.instanceManager.events.on("wipe_user", (data: { userId: string }) => {
        room.advancementsManager.clearCachedUser(data.userId);
        PlayerStatsCache.getInstance().resetUser(data.userId);
        room.glimmerbowlUnlockedByUserId.set(data.userId, false);
        room.hasOwnedScarByUserId.set(data.userId, false);
        room.fishCombatByUserId.delete(data.userId);
        room.heartsByUserId.set(data.userId, { ...DEFAULT_PLAYER_HEARTS_STATE });
        room.moneyByUserId.set(data.userId, DEFAULT_PLAYER_MONEY_STATE.money);
        room.enemyBridgeWarnCooldownByUserId.delete(data.userId);
        room.enemyBridgeUnlockedByUserId.delete(data.userId);
        room.heedTheWarningStayObjectiveByUserId.delete(data.userId);
        room.wasInDangerByUserId.delete(data.userId);
        room.wipedUserIds.add(data.userId);

        room.clients.forEach((client: Client) => {
            const player = room.state.players.get(client.sessionId);
            if (!player || player.odcid !== data.userId) return;

            room.pendingStatsDeltasBySession.delete(client.sessionId);
            client.leave(4005, "Your gameplay data was wiped. Please reconnect.");
        });
    });
}
