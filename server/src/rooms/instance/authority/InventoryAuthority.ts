import {
    DEFAULT_INVENTORY_SLOTS,
    DEFAULT_USABLE_EQUIP_SLOTS,
    getItemDefinition,
    isEquippableUsableItem,
    isRodItem
} from "@cfwk/shared";

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

type InventoryEquipmentValidationResult = {
    valid: boolean;
    reason?: string;
    slots: InventorySlotSnapshot[];
    equippedRodId: string | null;
    equippedUsableIds: Array<string | null>;
    equippedUsableCounts: number[];
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

function buildCombinedCountMap(
    slots: InventorySlotSnapshot[],
    equippedRodId: string | null,
    equippedUsableIds: Array<string | null>,
    equippedUsableCounts: number[]
): Map<string, number> {
    const counts = buildCountMap(slots);
    if (equippedRodId) {
        counts.set(equippedRodId, (counts.get(equippedRodId) || 0) + 1);
    }
    for (let i = 0; i < DEFAULT_USABLE_EQUIP_SLOTS; i += 1) {
        const itemId = equippedUsableIds[i] ?? null;
        const amount = Number.isFinite(equippedUsableCounts[i]) ? Math.max(0, Math.floor(equippedUsableCounts[i])) : 0;
        if (!itemId || amount <= 0) continue;
        counts.set(itemId, (counts.get(itemId) || 0) + amount);
    }
    return counts;
}

function normalizeEquippedUsableIds(input: any): Array<string | null> {
    const next = Array.from({ length: DEFAULT_USABLE_EQUIP_SLOTS }, () => null as string | null);
    if (!Array.isArray(input)) return next;
    for (let i = 0; i < Math.min(input.length, DEFAULT_USABLE_EQUIP_SLOTS); i += 1) {
        const value = input[i];
        next[i] = typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    }
    return next;
}

function normalizeEquippedUsableCounts(input: any, equippedUsableIds: Array<string | null>): number[] {
    const next = Array.from({ length: DEFAULT_USABLE_EQUIP_SLOTS }, () => 0);
    const values = Array.isArray(input) ? input : [];
    for (let i = 0; i < DEFAULT_USABLE_EQUIP_SLOTS; i += 1) {
        if (!equippedUsableIds[i]) {
            next[i] = 0;
            continue;
        }
        const parsed = Number.isFinite(values[i]) ? Math.floor(Number(values[i])) : 0;
        next[i] = Math.max(1, parsed);
    }
    return next;
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

function normalizeAndValidateCandidateSlots(
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

    return {
        valid: true,
        slots: normalizedCandidate
    };
}

export function validateClientInventorySnapshot(
    currentSlots: InventorySlotSnapshot[],
    candidateSlots: any
): ValidationResult {
    const normalized = normalizeAndValidateCandidateSlots(currentSlots, candidateSlots);
    if (!normalized.valid) {
        return normalized;
    }
    const normalizedCandidate = normalized.slots;

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

export function validateClientInventoryEquipmentSnapshot(params: {
    currentSlots: InventorySlotSnapshot[];
    currentEquippedRodId: string | null;
    currentEquippedUsableIds: Array<string | null>;
    currentEquippedUsableCounts: number[];
    candidateSlots: any;
    candidateEquippedRodId: any;
    candidateEquippedUsableIds: any;
    candidateEquippedUsableCounts: any;
}): InventoryEquipmentValidationResult {
    const currentEquippedUsableIds = normalizeEquippedUsableIds(params.currentEquippedUsableIds);
    const currentEquippedUsableCounts = normalizeEquippedUsableCounts(
        params.currentEquippedUsableCounts,
        currentEquippedUsableIds
    );
    const candidateEquippedUsableIds = normalizeEquippedUsableIds(params.candidateEquippedUsableIds);
    const candidateEquippedUsableCounts = normalizeEquippedUsableCounts(
        params.candidateEquippedUsableCounts,
        candidateEquippedUsableIds
    );
    const candidateEquippedRodId = typeof params.candidateEquippedRodId === "string" && params.candidateEquippedRodId.trim().length > 0
        ? params.candidateEquippedRodId.trim()
        : null;

    const inventoryValidation = normalizeAndValidateCandidateSlots(params.currentSlots, params.candidateSlots);
    if (!inventoryValidation.valid) {
        return {
            valid: false,
            reason: inventoryValidation.reason,
            slots: params.currentSlots,
            equippedRodId: params.currentEquippedRodId ?? null,
            equippedUsableIds: currentEquippedUsableIds,
            equippedUsableCounts: currentEquippedUsableCounts
        };
    }

    if (candidateEquippedRodId) {
        const rodDef = getItemDefinition(candidateEquippedRodId);
        if (!isRodItem(rodDef)) {
            return {
                valid: false,
                reason: "invalid-equipped-rod",
                slots: params.currentSlots,
                equippedRodId: params.currentEquippedRodId ?? null,
                equippedUsableIds: currentEquippedUsableIds,
                equippedUsableCounts: currentEquippedUsableCounts
            };
        }
    }

    for (let i = 0; i < DEFAULT_USABLE_EQUIP_SLOTS; i += 1) {
        const itemId = candidateEquippedUsableIds[i];
        const count = candidateEquippedUsableCounts[i] ?? 0;
        if (!itemId) {
            if (count !== 0) {
                return {
                    valid: false,
                    reason: "invalid-equipped-usable-count",
                    slots: params.currentSlots,
                    equippedRodId: params.currentEquippedRodId ?? null,
                    equippedUsableIds: currentEquippedUsableIds,
                    equippedUsableCounts: currentEquippedUsableCounts
                };
            }
            continue;
        }

        const def = getItemDefinition(itemId);
        if (!isEquippableUsableItem(def) || count <= 0) {
            return {
                valid: false,
                reason: "invalid-equipped-usable",
                slots: params.currentSlots,
                equippedRodId: params.currentEquippedRodId ?? null,
                equippedUsableIds: currentEquippedUsableIds,
                equippedUsableCounts: currentEquippedUsableCounts
            };
        }
    }

    const currentCounts = buildCombinedCountMap(
        params.currentSlots,
        params.currentEquippedRodId ?? null,
        currentEquippedUsableIds,
        currentEquippedUsableCounts
    );
    const candidateCounts = buildCombinedCountMap(
        inventoryValidation.slots,
        candidateEquippedRodId,
        candidateEquippedUsableIds,
        candidateEquippedUsableCounts
    );
    if (currentCounts.size !== candidateCounts.size) {
        return {
            valid: false,
            reason: "item-count-mismatch",
            slots: params.currentSlots,
            equippedRodId: params.currentEquippedRodId ?? null,
            equippedUsableIds: currentEquippedUsableIds,
            equippedUsableCounts: currentEquippedUsableCounts
        };
    }
    for (const [itemId, amount] of currentCounts.entries()) {
        if ((candidateCounts.get(itemId) || 0) !== amount) {
            return {
                valid: false,
                reason: "item-count-mismatch",
                slots: params.currentSlots,
                equippedRodId: params.currentEquippedRodId ?? null,
                equippedUsableIds: currentEquippedUsableIds,
                equippedUsableCounts: currentEquippedUsableCounts
            };
        }
    }

    return {
        valid: true,
        slots: inventoryValidation.slots,
        equippedRodId: candidateEquippedRodId,
        equippedUsableIds: candidateEquippedUsableIds,
        equippedUsableCounts: candidateEquippedUsableCounts
    };
}
