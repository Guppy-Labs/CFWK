import { Client } from "colyseus";
import {
    getShopDefinition,
    getShopItemEntry,
    getShopItemPrice,
    getItemDefinition,
    DEFAULT_PLAYER_MONEY_STATE,
    DEFAULT_INVENTORY_SLOTS,
    IShopStatePayload,
    IShopItemState
} from "@cfwk/shared";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import { grantItemToPlayer } from "./InventoryGrantService";
import User from "../../../models/User";

type PerItemWares = { available: number; nextReplenishAt: number | null };
type ShopWaresMap = Map<string, PerItemWares>;

function catchUpReplenishment(
    entry: PerItemWares,
    maxWares: number,
    replenishMs: number,
    now: number
): void {
    if (entry.available >= maxWares) {
        entry.nextReplenishAt = null;
        return;
    }
    if (entry.nextReplenishAt === null) {
        entry.nextReplenishAt = now + replenishMs;
        return;
    }
    if (now < entry.nextReplenishAt) return;

    const elapsed = now - entry.nextReplenishAt;
    const replenished = 1 + Math.floor(elapsed / replenishMs);
    entry.available = Math.min(maxWares, entry.available + replenished);

    if (entry.available >= maxWares) {
        entry.nextReplenishAt = null;
    } else {
        const remainder = elapsed % replenishMs;
        entry.nextReplenishAt = now + replenishMs - remainder;
    }
}

function getOrCreateUserShopWares(room: InstanceRoomHost, userId: string, shopId: string): ShopWaresMap | null {
    const shopDef = getShopDefinition(shopId);
    if (!shopDef) return null;

    if (!room.shopWaresByUserId) {
        room.shopWaresByUserId = new Map<string, Map<string, ShopWaresMap>>();
    }

    let userShops = room.shopWaresByUserId.get(userId);
    if (!userShops) {
        userShops = new Map<string, ShopWaresMap>();
        room.shopWaresByUserId.set(userId, userShops);
    }

    let shopWares = userShops.get(shopId);
    if (!shopWares) {
        shopWares = new Map<string, PerItemWares>();
        for (const item of shopDef.items) {
            shopWares.set(item.itemId, { available: item.maxWares, nextReplenishAt: null });
        }
        userShops.set(shopId, shopWares);
    }

    const now = Date.now();
    for (const item of shopDef.items) {
        const entry = shopWares.get(item.itemId);
        if (entry) {
            catchUpReplenishment(entry, item.maxWares, item.replenishMinutes * 60_000, now);
        }
    }

    return shopWares;
}

function buildShopStatePayload(shopId: string, shopWares: ShopWaresMap): IShopStatePayload {
    const items: IShopItemState[] = [];
    shopWares.forEach((entry: PerItemWares, itemId: string) => {
        items.push({
            itemId,
            available: entry.available,
            nextReplenishAt: entry.nextReplenishAt
        });
    });
    return { shopId, items };
}

export function loadPersistedShopWares(
    room: InstanceRoomHost,
    userId: string,
    persisted: Record<string, Record<string, { available: number; lastReplenishAt: number | null }>> | undefined | null
): void {
    if (!persisted || typeof persisted !== "object") return;

    if (!room.shopWaresByUserId) {
        room.shopWaresByUserId = new Map<string, Map<string, ShopWaresMap>>();
    }

    const userShops = new Map<string, ShopWaresMap>();

    for (const [shopId, itemEntries] of Object.entries(persisted)) {
        const shopDef = getShopDefinition(shopId);
        if (!shopDef) continue;

        const shopWares: ShopWaresMap = new Map();
        for (const item of shopDef.items) {
            const saved = itemEntries[item.itemId];
            if (saved && typeof saved.available === "number") {
                const available = Math.max(0, Math.min(item.maxWares, Math.floor(saved.available)));
                const lastReplenishAt = typeof saved.lastReplenishAt === "number" ? saved.lastReplenishAt : null;
                shopWares.set(item.itemId, { available, nextReplenishAt: lastReplenishAt });
            } else {
                shopWares.set(item.itemId, { available: item.maxWares, nextReplenishAt: null });
            }
        }
        userShops.set(shopId, shopWares);
    }

    room.shopWaresByUserId.set(userId, userShops);
}

export function serializeShopWaresForSave(
    room: InstanceRoomHost,
    userId: string
): Record<string, Record<string, { available: number; lastReplenishAt: number | null }>> | null {
    if (!room.shopWaresByUserId) return null;
    const userShops = room.shopWaresByUserId.get(userId);
    if (!userShops) return null;

    const result: Record<string, Record<string, { available: number; lastReplenishAt: number | null }>> = {};
    userShops.forEach((shopWares: ShopWaresMap, shopId: string) => {
        const items: Record<string, { available: number; lastReplenishAt: number | null }> = {};
        shopWares.forEach((entry: PerItemWares, itemId: string) => {
            items[itemId] = { available: entry.available, lastReplenishAt: entry.nextReplenishAt };
        });
        result[shopId] = items;
    });
    return result;
}

export function cleanupShopWaresForUser(room: InstanceRoomHost, userId: string): void {
    if (room.shopWaresByUserId) {
        room.shopWaresByUserId.delete(userId);
    }
}

export function registerShopHandlers(room: InstanceRoomHost) {
    room.onMessage("shop:get", (client: Client, data: { shopId?: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        if (!data || typeof data.shopId !== "string" || !data.shopId.trim()) return;

        const shopId = data.shopId.trim();
        const userId = player.odcid || client.sessionId;
        const shopWares = getOrCreateUserShopWares(room, userId, shopId);
        if (!shopWares) return;

        client.send("shop:state", buildShopStatePayload(shopId, shopWares));
    });

    room.onMessage("shop:buy", async (client: Client, data: { shopId?: string; itemId?: string; quantity?: number }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        if (!data || typeof data.shopId !== "string" || typeof data.itemId !== "string") return;

        const shopId = data.shopId.trim();
        const itemId = data.itemId.trim();
        const quantity = data.quantity === 10 ? 10 : 1;

        if (!shopId || !itemId) return;

        const shopEntry = getShopItemEntry(shopId, itemId);
        if (!shopEntry) return;

        const itemDef = getItemDefinition(itemId);
        if (!itemDef) return;

        const userId = player.odcid || client.sessionId;
        const shopWares = getOrCreateUserShopWares(room, userId, shopId);
        if (!shopWares) return;

        const waresEntry = shopWares.get(itemId);
        if (!waresEntry) return;

        if (waresEntry.available < quantity) {
            client.send("shop:state", buildShopStatePayload(shopId, shopWares));
            return;
        }

        let totalCost = 0;
        let tempAvailable = waresEntry.available;
        for (let i = 0; i < quantity; i++) {
            totalCost += getShopItemPrice(shopEntry.baseCost, tempAvailable, shopEntry.maxWares);
            tempAvailable--;
        }

        const currentMoney = room.moneyByUserId.get(userId) ?? DEFAULT_PLAYER_MONEY_STATE.money;
        if (currentMoney < totalCost) {
            client.send("shop:state", buildShopStatePayload(shopId, shopWares));
            return;
        }

        const nextMoney = room.normalizeMoneyAmount(currentMoney - totalCost);
        room.moneyByUserId.set(userId, nextMoney);

        waresEntry.available -= quantity;
        if (waresEntry.available < shopEntry.maxWares && waresEntry.nextReplenishAt === null) {
            waresEntry.nextReplenishAt = Date.now() + shopEntry.replenishMinutes * 60_000;
        }

        await grantItemToPlayer(room, client, {
            itemId,
            amount: quantity,
            userId,
            dropIfNoSpace: true,
            dropX: player.x,
            dropY: player.y,
            notifyIfNoSpace: "Your inventory is full! The items were dropped nearby."
        });

        client.send("player:money", { money: nextMoney });
        client.send("shop:state", buildShopStatePayload(shopId, shopWares));

        if (userId !== client.sessionId) {
            User.updateOne({ _id: userId }, { $set: { money: nextMoney } }).catch((error: unknown) => {
                console.error("[ShopService] Failed to persist money after purchase:", error);
            });
        }
    });
}
