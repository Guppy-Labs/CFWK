import {
    DEFAULT_USABLE_EQUIP_SLOTS,
    getItemDefinition,
    isEquippableUsableItem,
    isRodItem
} from "@cfwk/shared";

type InventorySlot = { itemId: string | null; count: number };

function getOwnedCounts(slots: InventorySlot[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const slot of slots) {
        if (!slot?.itemId || !Number.isFinite(slot.count) || slot.count <= 0) continue;
        counts.set(slot.itemId, (counts.get(slot.itemId) || 0) + Math.floor(slot.count));
    }
    return counts;
}

export function sanitizeEquippedRod(
    slots: InventorySlot[],
    requestedRodId: string | null | undefined,
    previousRodId: string | null
): string | null {
    if (!requestedRodId) return null;

    const requestedDef = getItemDefinition(requestedRodId);
    if (!isRodItem(requestedDef)) {
        return previousRodId ?? null;
    }

    const ownedCounts = getOwnedCounts(slots);
    return (ownedCounts.get(requestedRodId) || 0) > 0
        ? requestedRodId
        : (previousRodId ?? null);
}

export function sanitizeEquippedUsables(
    slots: InventorySlot[],
    requestedUsableIds: Array<string | null> | undefined,
    previousUsableIds: Array<string | null>
): Array<string | null> {
    const result = Array.from({ length: DEFAULT_USABLE_EQUIP_SLOTS }, (_v, index) => previousUsableIds[index] ?? null);
    if (!Array.isArray(requestedUsableIds)) {
        return result;
    }

    const ownedCounts = getOwnedCounts(slots);
    for (let index = 0; index < DEFAULT_USABLE_EQUIP_SLOTS; index += 1) {
        const requested = requestedUsableIds[index] ?? null;
        if (!requested) {
            result[index] = null;
            continue;
        }

        const def = getItemDefinition(requested);
        if (!isEquippableUsableItem(def)) {
            result[index] = null;
            continue;
        }

        const available = ownedCounts.get(requested) || 0;
        if (available <= 0) {
            result[index] = null;
            continue;
        }

        result[index] = requested;
        ownedCounts.set(requested, available - 1);
    }

    return result;
}
