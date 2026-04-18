import { DEFAULT_INVENTORY_SLOTS, getItemDefinition } from "@cfwk/shared";
import { Client } from "colyseus";
import { InstanceRoomHost } from "../context/InstanceRoomHost";

type GrantItemOptions = {
    itemId: string;
    amount: number;
    userId: string;
    dropIfNoSpace?: boolean;
    dropX?: number;
    dropY?: number;
    notifyIfNoSpace?: string;
};

export async function grantItemToPlayer(
    room: InstanceRoomHost,
    client: Client,
    options: GrantItemOptions
): Promise<Array<{ itemId: string | null; count: number }> | null> {
    const amount = Math.max(1, Math.floor(options.amount));
    const itemId = options.itemId;
    if (!itemId || amount <= 0) return null;

    const {
        items: currentSlots,
        equippedRodId,
        equippedUsableIds,
        equippedUsableCounts
    } = await room.deps.inventoryCache.getInventoryState(options.userId);

    const stackSize = getItemDefinition(itemId)?.stackSize ?? 99;
    const hasStackSpace = currentSlots.some((slot: { itemId: string | null; count: number }) => slot.itemId === itemId && slot.count < stackSize);
    const hasEmptySlot = currentSlots.some((slot: { itemId: string | null; count: number }) => !slot.itemId || slot.count === 0);

    if (!hasStackSpace && !hasEmptySlot) {
        if (options.dropIfNoSpace && Number.isFinite(options.dropX) && Number.isFinite(options.dropY)) {
            room.createDroppedItem(itemId, amount, Number(options.dropX), Number(options.dropY));
        }
        client.send("inventory", {
            slots: currentSlots,
            totalSlots: DEFAULT_INVENTORY_SLOTS,
            equippedRodId,
            equippedUsableIds,
            equippedUsableCounts
        });
        client.send("inventory:skip", { itemId, quantity: amount });
        if (options.notifyIfNoSpace && options.notifyIfNoSpace.trim().length > 0) {
            client.send("chat", {
                username: "SYSTEM",
                odcid: "SYSTEM",
                message: options.notifyIfNoSpace,
                timestamp: Date.now(),
                isSystem: true
            });
        }
        return null;
    }

    const updatedSlots = await room.deps.inventoryCache.addItem(options.userId, itemId, amount);
    client.send("inventory", {
        slots: updatedSlots,
        totalSlots: DEFAULT_INVENTORY_SLOTS,
        equippedRodId,
        equippedUsableIds,
        equippedUsableCounts
    });
    return updatedSlots;
}
