import User from '../models/User';
import { randomUUID } from 'crypto';
import { FishCombatStats, GlimmerFishTier, GlimmerbowlEntry, getItemDefinition } from '@cfwk/shared';
import { InventoryCache } from './InventoryCache';

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

    async getState(userId: string): Promise<{ entries: GlimmerbowlEntry[]; unlocked: boolean }> {
        const unlocked = await this.isUnlocked(userId);
        const entries = await this.getEntries(userId);
        return { entries, unlocked };
    }

    async isUnlocked(userId: string): Promise<boolean> {
        const user = await User.findById(userId).select('glimmerbowlUnlocked').lean();
        if (!user) {
            throw new Error('User not found');
        }

        return Boolean((user as any).glimmerbowlUnlocked);
    }

    async unlockForUser(userId: string): Promise<{ entries: GlimmerbowlEntry[]; unlocked: boolean; slots?: { index: number; itemId: string | null; count: number }[]; equippedRodId?: string | null; movedFish: boolean }> {
        await User.updateOne(
            { _id: userId },
            { $set: { glimmerbowlUnlocked: true } }
        );
        const migrated = await this.migrateInventoryFishToGlimmerbowl(userId);
        const state = await this.getState(userId);
        return {
            ...state,
            slots: migrated.slots,
            equippedRodId: migrated.equippedRodId,
            movedFish: migrated.movedFish
        };
    }

    async migrateInventoryFishToGlimmerbowl(userId: string): Promise<{ movedFish: boolean; slots?: { index: number; itemId: string | null; count: number }[]; equippedRodId?: string | null }> {
        const inventoryCache = InventoryCache.getInstance();
        const { items: slots, equippedRodId } = await inventoryCache.getInventoryState(userId);
        const fishItemIds: string[] = [];
        let changed = false;

        const nextSlots = slots.map((slot) => {
            if (!slot.itemId || slot.count <= 0) return slot;
            const itemDef = getItemDefinition(slot.itemId);
            if (!itemDef || itemDef.category !== 'Fish') return slot;

            for (let i = 0; i < slot.count; i += 1) {
                fishItemIds.push(slot.itemId);
            }
            changed = true;
            return {
                index: slot.index,
                itemId: null,
                count: 0
            };
        });

        if (!changed) {
            return { movedFish: false };
        }

        inventoryCache.setInventory(userId, nextSlots);

        const entries = await this.getEntries(userId);
        fishItemIds.forEach((itemId) => {
            entries.push(this.createFishEntry(itemId, 'regular'));
        });

        this.markDirty(userId, entries);
        return {
            movedFish: true,
            slots: nextSlots,
            equippedRodId
        };
    }

    async addFish(userId: string, itemId: string, amount: number, tier: GlimmerFishTier = 'regular'): Promise<GlimmerbowlEntry[]> {
        const itemDef = getItemDefinition(itemId);
        if (!itemDef || itemDef.category !== 'Fish') {
            throw new Error(`Item '${itemId}' is not a fish`);
        }

        const entries = await this.getEntries(userId);
        const quantity = Math.max(1, Math.floor(amount || 1));
        for (let i = 0; i < quantity; i += 1) {
            entries.push(this.createFishEntry(itemId, tier));
        }

        this.sortEntries(entries);
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

        const totalAvailable = matching.length;
        if (totalAvailable < quantity) return null;

        const idsToRemove = new Set(matching.slice(0, quantity).map((entry) => entry.id));
        const compacted = entries.filter((entry) => !idsToRemove.has(entry.id));
        if (compacted.length === entries.length) return null;

        entries.length = 0;
        entries.push(...compacted);
        this.sortEntries(entries);

        this.markDirty(userId, entries);
        return entries;
    }

    async awakenFish(userId: string, fishEntryId: string, scarItemId: string): Promise<{ entries: GlimmerbowlEntry[]; slots: { index: number; itemId: string | null; count: number }[] }> {
        const scarDef = getItemDefinition(scarItemId);
        if (!scarDef?.scar) {
            throw new Error(`Item '${scarItemId}' is not a scar`);
        }

        const entries = await this.getEntries(userId);
        const entry = entries.find((item) => item.id === fishEntryId);
        if (!entry) {
            throw new Error('Fish not found');
        }
        if (entry.tier === 'awakened') {
            throw new Error('Fish is already awakened');
        }

        const inventoryCache = InventoryCache.getInstance();
        const updatedSlots = await inventoryCache.removeItem(userId, scarItemId, 1);
        if (!updatedSlots) {
            throw new Error('Scar not owned');
        }

        entry.tier = scarDef.scar.awakenTier ?? 'awakened';
        entry.awakenedByScarId = scarItemId;
        this.sortEntries(entries);

        this.markDirty(userId, entries);
        return {
            entries,
            slots: updatedSlots
        };
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
        const normalized: GlimmerbowlEntry[] = [];

        (entries as any[]).forEach((rawEntry) => {
            if (!rawEntry?.itemId) return;
            const def = getItemDefinition(rawEntry.itemId);
            if (!def || def.category !== 'Fish') return;

            const tier: GlimmerFishTier = rawEntry.tier === 'awakened' ? 'awakened' : 'regular';
            const legacyCount = Math.max(0, Math.floor(rawEntry.count ?? 0));
            if (legacyCount > 0) {
                for (let i = 0; i < legacyCount; i += 1) {
                    normalized.push(this.createFishEntry(rawEntry.itemId, tier));
                }
                return;
            }

            const id = typeof rawEntry.id === 'string' && rawEntry.id.trim().length > 0
                ? rawEntry.id
                : randomUUID();
            const awakenedByScarId = typeof rawEntry.awakenedByScarId === 'string'
                ? rawEntry.awakenedByScarId
                : null;
            const stats = this.normalizeStats(rawEntry.stats, rawEntry.itemId);
            normalized.push({
                id,
                itemId: rawEntry.itemId,
                tier,
                stats,
                awakenedByScarId
            });
        });

        this.sortEntries(normalized);
        return normalized;
    }

    private createFishEntry(itemId: string, tier: GlimmerFishTier): GlimmerbowlEntry {
        return {
            id: randomUUID(),
            itemId,
            tier,
            stats: this.rollFishStats(itemId),
            awakenedByScarId: null
        };
    }

    private rollFishStats(itemId: string): FishCombatStats {
        const itemDef = getItemDefinition(itemId);
        const base = itemDef?.fishBaseStats ?? { damage: 4, speed: 4, energy: 4, critRate: 0.02, critDamage: 1.2 };
        const roll = (value: number, min: number, max: number, precision: number) => {
            const variation = 1 + (Math.random() * 0.16 - 0.08);
            const raw = value * variation;
            const clamped = Math.max(min, Math.min(max, raw));
            return Number(clamped.toFixed(precision));
        };

        return {
            damage: roll(base.damage, 1, 999, 2),
            speed: roll(base.speed, 1, 999, 2),
            energy: roll(base.energy, 1, 999, 2),
            critRate: roll(base.critRate, 0, 1, 4),
            critDamage: roll(base.critDamage, 1, 99, 3)
        };
    }

    private normalizeStats(rawStats: unknown, itemId: string): FishCombatStats {
        const fallback = this.rollFishStats(itemId);
        if (!rawStats || typeof rawStats !== 'object') return fallback;
        const source = rawStats as Partial<FishCombatStats>;
        const toSafeNumber = (value: unknown, defaultValue: number, min: number, max: number, precision: number) => {
            if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
            const clamped = Math.max(min, Math.min(max, value));
            return Number(clamped.toFixed(precision));
        };
        return {
            damage: toSafeNumber(source.damage, fallback.damage, 1, 999, 2),
            speed: toSafeNumber(source.speed, fallback.speed, 1, 999, 2),
            energy: toSafeNumber(source.energy, fallback.energy, 1, 999, 2),
            critRate: toSafeNumber(source.critRate, fallback.critRate, 0, 1, 4),
            critDamage: toSafeNumber(source.critDamage, fallback.critDamage, 1, 99, 3)
        };
    }

    private sortEntries(entries: GlimmerbowlEntry[]) {
        entries.sort((a, b) => {
            if (a.tier !== b.tier) return a.tier === 'regular' ? -1 : 1;
            const itemOrder = a.itemId.localeCompare(b.itemId);
            if (itemOrder !== 0) return itemOrder;
            return a.id.localeCompare(b.id);
        });
    }
}