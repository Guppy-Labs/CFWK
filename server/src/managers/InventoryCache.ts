import User from '../models/User';

export type InventoryItem = { itemId: string; count: number };

type CacheEntry = {
    items: InventoryItem[];
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

        const user = await User.findById(userId).select('inventory');
        if (!user) {
            throw new Error('User not found');
        }

        const items = (user.inventory || []) as InventoryItem[];
        this.cache.set(userId, {
            items: [...items],
            dirty: false,
            lastLoaded: Date.now()
        });

        return items;
    }

    async addItem(userId: string, itemId: string, amount: number): Promise<InventoryItem[]> {
        const items = await this.getInventory(userId);
        const entry = items.find((inv) => inv.itemId === itemId);
        if (entry) {
            entry.count += amount;
        } else {
            items.push({ itemId, count: amount });
        }

        this.markDirty(userId, items);
        return items;
    }

    async removeItem(userId: string, itemId: string, amount: number): Promise<InventoryItem[] | null> {
        const items = await this.getInventory(userId);
        const entry = items.find((inv) => inv.itemId === itemId);
        if (!entry || entry.count < amount) return null;

        entry.count -= amount;
        if (entry.count <= 0) {
            const index = items.indexOf(entry);
            if (index >= 0) items.splice(index, 1);
        }

        this.markDirty(userId, items);
        return items;
    }

    setInventory(userId: string, items: InventoryItem[]) {
        this.cache.set(userId, {
            items: [...items],
            dirty: true,
            lastLoaded: Date.now()
        });
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
                await User.updateOne({ _id: userId }, { $set: { inventory: entry.items } });
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
}