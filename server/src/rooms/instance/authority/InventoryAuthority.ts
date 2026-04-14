import { DEFAULT_INVENTORY_SLOTS, getItemDefinition } from "@cfwk/shared";

export type InventorySlotSnapshot = {
    index: number;
    itemId: string | null;
    count: number;
};

type ValidationResult = {
    valid: boolean;
    reason?: string;
    slots: InventorySlotSnapshot[];
};

function normalizeSlot(input: any, index: number): InventorySlotSnapshot {
    const requestedIndex = Number.isFinite(input?.index) ? Math.floor(Number(input.index)) : index;
    const normalizedIndex = Math.max(0, Math.min(DEFAULT_INVENTORY_SLOTS - 1, requestedIndex));
    const itemId = typeof input?.itemId === "string" && input.itemId.trim().length > 0
        ? input.itemId.trim()
        : null;
    const count = Number.isFinite(input?.count) ? Math.max(0, Math.floor(Number(input.count))) : 0;
    return {
        index: normalizedIndex,
        itemId,
        count
    };
}

function buildCountMap(slots: InventorySlotSnapshot[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const slot of slots) {
        if (!slot.itemId || slot.count <= 0) continue;
        counts.set(slot.itemId, (counts.get(slot.itemId) || 0) + slot.count);
    }
    return counts;
}

function normalizeToFixedSlots(rawSlots: any[]): InventorySlotSnapshot[] {
    const normalized: InventorySlotSnapshot[] = Array.from({ length: DEFAULT_INVENTORY_SLOTS }, (_v, index) => ({
        index,
        itemId: null,
        count: 0
    }));

    for (let i = 0; i < rawSlots.length; i += 1) {
        const slot = normalizeSlot(rawSlots[i], i);
        normalized[slot.index] = slot;
    }

    return normalized;
}

export function validateClientInventorySnapshot(
    currentSlots: InventorySlotSnapshot[],
    candidateSlots: any
): ValidationResult {
    if (!Array.isArray(candidateSlots)) {
        return { valid: false, reason: "invalid-payload", slots: currentSlots };
    }

    const normalizedCandidate = normalizeToFixedSlots(candidateSlots);
    for (const slot of normalizedCandidate) {
        if (!slot.itemId) {
            if (slot.count !== 0) {
                return { valid: false, reason: "invalid-empty-count", slots: currentSlots };
            }
            continue;
        }

        const def = getItemDefinition(slot.itemId);
        if (!def) {
            return { valid: false, reason: "unknown-item", slots: currentSlots };
        }

        if (slot.count <= 0 || slot.count > def.stackSize) {
            return { valid: false, reason: "invalid-stack-size", slots: currentSlots };
        }
    }

    const currentCounts = buildCountMap(currentSlots);
    const candidateCounts = buildCountMap(normalizedCandidate);
    if (currentCounts.size !== candidateCounts.size) {
        return { valid: false, reason: "item-count-mismatch", slots: currentSlots };
    }

    for (const [itemId, currentCount] of currentCounts.entries()) {
        if ((candidateCounts.get(itemId) || 0) !== currentCount) {
            return { valid: false, reason: "item-count-mismatch", slots: currentSlots };
        }
    }

    return {
        valid: true,
        slots: normalizedCandidate
    };
}
