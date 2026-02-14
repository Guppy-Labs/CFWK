import { DEFAULT_PLAYER_STATS, IPlayerStats, IPlayerStatRanks, PlayerStatKey, PLAYER_STAT_KEYS } from '@cfwk/shared';
import User from '../models/User';

type StatsCacheEntry = {
    delta: IPlayerStats;
    dirty: boolean;
};

const createEmptyStats = (): IPlayerStats => ({ ...DEFAULT_PLAYER_STATS });

const hasAnyDelta = (stats: IPlayerStats): boolean => {
    for (const key of PLAYER_STAT_KEYS) {
        if (stats[key] > 0) return true;
    }
    return false;
};

export class PlayerStatsCache {
    private static instance: PlayerStatsCache;
    private cache = new Map<string, StatsCacheEntry>();
    private flushTimer?: NodeJS.Timeout;

    private constructor() {}

    public static getInstance(): PlayerStatsCache {
        if (!PlayerStatsCache.instance) {
            PlayerStatsCache.instance = new PlayerStatsCache();
        }
        return PlayerStatsCache.instance;
    }

    incrementStat(userId: string, key: PlayerStatKey, amount: number) {
        if (!userId || !Number.isFinite(amount) || amount <= 0) return;

        const entry = this.getOrCreateEntry(userId);
        entry.delta[key] += amount;
        entry.dirty = true;
    }

    addDistance(userId: string, walkedDelta: number, ranDelta: number) {
        if (walkedDelta > 0) this.incrementStat(userId, 'distanceWalked', walkedDelta);
        if (ranDelta > 0) this.incrementStat(userId, 'distanceRan', ranDelta);
    }

    addOnlineTime(userId: string, ms: number) {
        this.incrementStat(userId, 'timeOnlineMs', ms);
    }

    async getPlayerStats(userId: string): Promise<IPlayerStats> {
        const user = await User.findById(userId).select('playerStats').lean();
        if (!user) {
            throw new Error('User not found');
        }

        const persisted = {
            ...DEFAULT_PLAYER_STATS,
            ...(user.playerStats || {})
        } as IPlayerStats;

        const pending = this.cache.get(userId)?.delta;
        if (!pending) return persisted;

        return {
            distanceWalked: persisted.distanceWalked + pending.distanceWalked,
            distanceRan: persisted.distanceRan + pending.distanceRan,
            timeOnlineMs: persisted.timeOnlineMs + pending.timeOnlineMs,
            catches: persisted.catches + pending.catches,
            npcInteractions: persisted.npcInteractions + pending.npcInteractions
        };
    }

    async getRanksForStats(stats: IPlayerStats, maxRank = 999): Promise<IPlayerStatRanks> {
        const ranks: IPlayerStatRanks = {};

        await Promise.all(PLAYER_STAT_KEYS.map(async (key) => {
            const value = stats[key];
            if (!Number.isFinite(value) || value <= 0) {
                ranks[key] = null;
                return;
            }

            const rank = await this.getRankForValue(key, value);
            ranks[key] = rank <= maxRank ? rank : null;
        }));

        return ranks;
    }

    async flushDirty(): Promise<void> {
        const dirtyEntries = Array.from(this.cache.entries()).filter(([, entry]) => entry.dirty && hasAnyDelta(entry.delta));
        if (dirtyEntries.length === 0) return;

        await Promise.all(
            dirtyEntries.map(async ([userId, entry]) => {
                const delta = entry.delta;
                await User.updateOne(
                    { _id: userId },
                    {
                        $inc: {
                            'playerStats.distanceWalked': delta.distanceWalked,
                            'playerStats.distanceRan': delta.distanceRan,
                            'playerStats.timeOnlineMs': delta.timeOnlineMs,
                            'playerStats.catches': delta.catches,
                            'playerStats.npcInteractions': delta.npcInteractions
                        }
                    }
                );

                entry.delta = createEmptyStats();
                entry.dirty = false;
            })
        );
    }

    startAutoFlush(intervalMs: number = 60_000) {
        if (this.flushTimer) return;
        this.flushTimer = setInterval(() => {
            this.flushDirty().catch((err) => {
                console.error('[PlayerStatsCache] Error flushing stats:', err);
            });
        }, intervalMs);
    }

    stopAutoFlush() {
        if (!this.flushTimer) return;
        clearInterval(this.flushTimer);
        this.flushTimer = undefined;
    }

    private getOrCreateEntry(userId: string): StatsCacheEntry {
        const existing = this.cache.get(userId);
        if (existing) return existing;

        const created: StatsCacheEntry = {
            delta: createEmptyStats(),
            dirty: false
        };

        this.cache.set(userId, created);
        return created;
    }

    private async getRankForValue(key: PlayerStatKey, value: number): Promise<number> {
        const field = `playerStats.${key}`;
        const betterCount = await User.countDocuments({ [field]: { $gt: value } });
        return betterCount + 1;
    }
}
