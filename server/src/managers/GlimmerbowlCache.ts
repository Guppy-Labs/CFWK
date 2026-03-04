import User from '../models/User';
import { GlimmerFishTier, GlimmerbowlEntry, getItemDefinition } from '@cfwk/shared';

type CacheEntry = {
    entries: GlimmerbowlEntry[];
    dirty: boolean;
    lastLoaded: number;
};

export class GlimmerbowlCache {
    private static instance: GlimmerbowlCache;
    private cache = new Map<string, CacheEntry>();
    private flushTimer?: NodeJS.Timeout;

    private constructor() {}

    public static getInstance(): GlimmerbowlCache {
        if (!GlimmerbowlCache.instance) {
            GlimmerbowlCache.instance = new GlimmerbowlCache();
        }
        return GlimmerbowlCache.instance;
    }

    async getEntries(userId: string): Promise<GlimmerbowlEntry[]> {
        const existing = this.cache.get(userId);
        if (existing) return existing.entries;

        const user = await User.findById(userId).select('glimmerbowl');
        if (!user) {
            throw new Error('User not found');
        }

        const entries = this.normalizeEntries((user.glimmerbowl || []) as GlimmerbowlEntry[]);
        this.cache.set(userId, {
            entries: [...entries],
            dirty: false,
            lastLoaded: Date.now()
        });

        return entries;
    }

    async getState(userId: string): Promise<{ entries: GlimmerbowlEntry[] }> {
        const entries = await this.getEntries(userId);
        return { entries };
    }

    async addFish(userId: string, itemId: string, amount: number, tier: GlimmerFishTier = 'regular'): Promise<GlimmerbowlEntry[]> {
        const itemDef = getItemDefinition(itemId);
        if (!itemDef || itemDef.category !== 'Fish') {
            throw new Error(`Item '${itemId}' is not a fish`);
        }

        const entries = await this.getEntries(userId);
        const quantity = Math.max(1, Math.floor(amount || 1));
        const existing = entries.find((entry) => entry.itemId === itemId && entry.tier === tier);
        if (existing) {
            existing.count += quantity;
        } else {
            entries.push({ itemId, count: quantity, tier });
        }

        this.markDirty(userId, entries);
        return entries;
    }

    async removeFish(userId: string, itemId: string, amount: number, tier?: GlimmerFishTier): Promise<GlimmerbowlEntry[] | null> {
        const entries = await this.getEntries(userId);
        const quantity = Math.max(1, Math.floor(amount || 1));

        const matching = entries
            .filter((entry) => entry.itemId === itemId && (!tier || entry.tier === tier))
            .sort((a, b) => {
                if (a.tier === b.tier) return 0;
                return a.tier === 'regular' ? -1 : 1;
            });

        const totalAvailable = matching.reduce((sum, entry) => sum + entry.count, 0);
        if (totalAvailable < quantity) return null;

        let remaining = quantity;
        for (const entry of matching) {
            if (remaining <= 0) break;
            const used = Math.min(entry.count, remaining);
            entry.count -= used;
            remaining -= used;
        }

        const compacted = entries.filter((entry) => entry.count > 0);
        entries.length = 0;
        entries.push(...compacted);

        this.markDirty(userId, entries);
        return entries;
    }

    resetUser(userId: string): GlimmerbowlEntry[] {
        const entries: GlimmerbowlEntry[] = [];
        this.cache.set(userId, {
            entries,
            dirty: false,
            lastLoaded: Date.now()
        });
        return entries;
    }

    markDirty(userId: string, entries: GlimmerbowlEntry[]) {
        const existing = this.cache.get(userId);
        if (existing) {
            existing.entries = entries;
            existing.dirty = true;
            return;
        }

        this.cache.set(userId, {
            entries: [...entries],
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
                    { $set: { glimmerbowl: entry.entries } }
                );
                entry.dirty = false;
            })
        );
    }

    startAutoFlush(intervalMs: number = 5 * 60 * 1000) {
        if (this.flushTimer) return;
        this.flushTimer = setInterval(() => {
            this.flushDirty().catch((err) => {
                console.error('[GlimmerbowlCache] Error flushing glimmerbowls:', err);
            });
        }, intervalMs);
    }

    stopAutoFlush() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
    }

    private normalizeEntries(entries: GlimmerbowlEntry[]): GlimmerbowlEntry[] {
        const merged = new Map<string, GlimmerbowlEntry>();

        entries.forEach((entry) => {
            if (!entry?.itemId) return;
            const def = getItemDefinition(entry.itemId);
            if (!def || def.category !== 'Fish') return;

            const tier: GlimmerFishTier = entry.tier === 'awakened' ? 'awakened' : 'regular';
            const count = Math.max(0, Math.floor(entry.count ?? 0));
            if (count <= 0) return;

            const key = `${entry.itemId}::${tier}`;
            const existing = merged.get(key);
            if (existing) {
                existing.count += count;
                return;
            }

            merged.set(key, {
                itemId: entry.itemId,
                count,
                tier
            });
        });

        return [...merged.values()].sort((a, b) => {
            if (a.tier !== b.tier) return a.tier === 'regular' ? -1 : 1;
            return a.itemId.localeCompare(b.itemId);
        });
    }
}