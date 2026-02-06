import User from '../models/User';
import { DEFAULT_INVENTORY_SLOTS, getItemDefinition } from '@cfwk/shared';

export type InventoryItem = { index: number; itemId: string | null; count: number };

type CacheEntry = {
    items: InventoryItem[];
    equippedRodId: string | null;
    dirty: boolean;
    lastLoaded: number;
};

export class InventoryCache {
    private static instance: InventoryCache;
    private cache = new Map<string, CacheEntry>();
    private flushTimer?: NodeJS.Timeout;

    private constructor() {}

    public static getInstance(): InventoryCache {
        if (!InventoryCache.instance) {
            InventoryCache.instance = new InventoryCache();
        }
        return InventoryCache.instance;
    }

    async getInventory(userId: string): Promise<InventoryItem[]> {
        const existing = this.cache.get(userId);
        if (existing) return existing.items;

        const user = await User.findById(userId).select('inventory equippedRodId');
        if (!user) {
            throw new Error('User not found');
        }

        const rawInventory = (user.inventory || []) as any[];
        const isLegacy = rawInventory.length > 0 && rawInventory[0].index === undefined;
        const items = this.normalizeInventory(rawInventory);
        this.cache.set(userId, {
            items: [...items],
            equippedRodId: user.equippedRodId ?? null,
            dirty: isLegacy,
            lastLoaded: Date.now()
        });

        return items;
    }

    async getInventoryState(userId: string): Promise<{ items: InventoryItem[]; equippedRodId: string | null }> {
        const items = await this.getInventory(userId);
        const entry = this.cache.get(userId);
        return {
            items,
            equippedRodId: entry?.equippedRodId ?? null
        };
    }

    async addItem(userId: string, itemId: string, amount: number): Promise<InventoryItem[]> {
        const items = await this.getInventory(userId);
        const stackSize = this.getStackSize(itemId);

        let remaining = amount;

        // Fill existing stacks first
        for (const slot of items) {
            if (remaining <= 0) break;
            if (slot.itemId !== itemId) continue;
            if (slot.count >= stackSize) continue;

            const canAdd = Math.min(stackSize - slot.count, remaining);
            slot.count += canAdd;
            remaining -= canAdd;
        }

        // Fill empty slots
        for (const slot of items) {
            if (remaining <= 0) break;
            if (slot.itemId !== null) continue;

            const toAdd = Math.min(stackSize, remaining);
            slot.itemId = itemId;
            slot.count = toAdd;
            remaining -= toAdd;
        }

        this.markDirty(userId, items);
        return items;
    }

    async removeItem(userId: string, itemId: string, amount: number): Promise<InventoryItem[] | null> {
        const items = await this.getInventory(userId);
        const totalAvailable = items
            .filter((slot) => slot.itemId === itemId)
            .reduce((sum, slot) => sum + slot.count, 0);

        if (totalAvailable < amount) return null;

        let remaining = amount;
        for (const slot of items) {
            if (remaining <= 0) break;
            if (slot.itemId !== itemId) continue;

            const toRemove = Math.min(slot.count, remaining);
            slot.count -= toRemove;
            remaining -= toRemove;

            if (slot.count <= 0) {
                slot.itemId = null;
                slot.count = 0;
            }
        }

        this.markDirty(userId, items);
        return items;
    }

    setInventory(userId: string, items: InventoryItem[]) {
        const existing = this.cache.get(userId);
        this.cache.set(userId, {
            items: [...items],
            equippedRodId: existing?.equippedRodId ?? null,
            dirty: true,
            lastLoaded: Date.now()
        });
    }

    setEquippedRod(userId: string, equippedRodId: string | null) {
        const existing = this.cache.get(userId);
        if (existing) {
            existing.equippedRodId = equippedRodId;
            existing.dirty = true;
            return;
        }

        this.cache.set(userId, {
            items: this.createEmptySlots(DEFAULT_INVENTORY_SLOTS),
            equippedRodId,
            dirty: true,
            lastLoaded: Date.now()
        });
    }

    getEquippedRod(userId: string): string | null {
        const existing = this.cache.get(userId);
        return existing?.equippedRodId ?? null;
    }

    markDirty(userId: string, items: InventoryItem[]) {
        const existing = this.cache.get(userId);
        if (existing) {
            existing.items = items;
            existing.dirty = true;
            return;
        }

        this.cache.set(userId, {
            items: [...items],
            equippedRodId: null,
            dirty: true,
            lastLoaded: Date.now()
        });
    }

    async flushDirty(): Promise<void> {
        const dirtyEntries: Array<[string, CacheEntry]> = [];
        for (const entry of this.cache.entries()) {
            if (entry[1].dirty) dirtyEntries.push(entry);
        }

        if (dirtyEntries.length === 0) return;

        await Promise.all(
            dirtyEntries.map(async ([userId, entry]) => {
                await User.updateOne(
                    { _id: userId },
                    { $set: { inventory: entry.items, equippedRodId: entry.equippedRodId ?? null } }
                );
                entry.dirty = false;
            })
        );
    }

    startAutoFlush(intervalMs: number = 5 * 60 * 1000) {
        if (this.flushTimer) return;
        this.flushTimer = setInterval(() => {
            this.flushDirty().catch((err) => {
                console.error('[InventoryCache] Error flushing inventories:', err);
            });
        }, intervalMs);
    }

    stopAutoFlush() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
    }

    private normalizeInventory(rawInventory: Array<{ itemId?: string; count?: number; index?: number }>): InventoryItem[] {
        // Detect legacy format (no index field)
        const isLegacy = rawInventory.length > 0 && rawInventory[0].index === undefined;

        if (isLegacy) {
            const slots = this.createEmptySlots(DEFAULT_INVENTORY_SLOTS);

            for (const entry of rawInventory) {
                const itemId = entry.itemId;
                const count = Math.max(0, entry.count ?? 0);
                if (!itemId || count <= 0) continue;

                this.placeItemInSlots(slots, itemId, count);
            }

            return slots;
        }

        // Slot-based format
        const slots: InventoryItem[] = rawInventory
            .map((slot, index) => ({
                index: slot.index ?? index,
                itemId: slot.itemId ?? null,
                count: Math.max(0, slot.count ?? 0)
            }))
            .sort((a, b) => a.index - b.index);

        // Pad to default size
        if (slots.length < DEFAULT_INVENTORY_SLOTS) {
            const start = slots.length;
            for (let i = start; i < DEFAULT_INVENTORY_SLOTS; i++) {
                slots.push({ index: i, itemId: null, count: 0 });
            }
        }

        return slots;
    }

    private createEmptySlots(count: number): InventoryItem[] {
        return Array.from({ length: count }, (_v, index) => ({ index, itemId: null, count: 0 }));
    }

    private getStackSize(itemId: string): number {
        const def = getItemDefinition(itemId);
        return def?.stackSize ?? 99;
    }

    private placeItemInSlots(slots: InventoryItem[], itemId: string, amount: number) {
        const stackSize = this.getStackSize(itemId);
        let remaining = amount;

        // Fill existing stacks
        for (const slot of slots) {
            if (remaining <= 0) break;
            if (slot.itemId !== itemId) continue;
            if (slot.count >= stackSize) continue;

            const canAdd = Math.min(stackSize - slot.count, remaining);
            slot.count += canAdd;
            remaining -= canAdd;
        }

        // Fill empty slots
        for (const slot of slots) {
            if (remaining <= 0) break;
            if (slot.itemId !== null) continue;

            const toAdd = Math.min(stackSize, remaining);
            slot.itemId = itemId;
            slot.count = toAdd;
            remaining -= toAdd;
        }
    }
}