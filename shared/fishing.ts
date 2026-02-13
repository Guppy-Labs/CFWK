/**
 * FISHING LOOT TABLE SYSTEM
 * Defines region-specific loot tables for the fishing mechanic.
 * 
 * Each loot entry has:
 * - itemId: The item to drop (must exist in ITEM_DEFINITIONS)
 * - weight: Base drop weight (higher = more common)
 * - minRod: Minimum rod tier required (null = any rod)
 * - bait: Required bait type (null = no bait required)
 * - idealDepth: The depth at which this item is most likely to be caught
 * 
 * Guppy Labs 2026
 */

// ============================================================================
// TYPES
// ============================================================================

import { getItemDefinition, ItemRarity, RodStats } from './items';

export type WaterRegion = 'temperate' | 'tropical' | 'arctic' | 'deep' | 'freshwater';

export type RodTier = 'rickety' | 'fisherman' | 'professional' | 'legendary';

export type BaitType = 'worm' | 'minnow' | 'shrimp' | 'special' | null;

export interface FishingLootEntry {
    /** Item ID that matches an entry in ITEM_DEFINITIONS */
    itemId: string;
    /** Base drop weight - higher values = more common */
    weight: number;
    /** Minimum rod tier required to catch this item (null = any rod) */
    minRod: RodTier | null;
    /** Required bait type (null = no bait required) */
    bait: BaitType;
    /** Ideal depth for catching this item (affects weight modifier) */
    idealDepth: number;
}

export interface FishingLootTable {
    region: WaterRegion;
    entries: FishingLootEntry[];
}

export const DEFAULT_ROD_STATS: RodStats = {
    speedMultiplier: 1,
    rarityMultiplier: 1,
    strength: 1
};

export function getRodStats(itemId?: string | null): RodStats {
    if (!itemId) return DEFAULT_ROD_STATS;
    const def = getItemDefinition(itemId);
    return def?.rodStats ?? DEFAULT_ROD_STATS;
}

// ============================================================================
// ITEM ID TO ASSET FILE MAPPING
// ============================================================================

/**
 * Maps item IDs to their corresponding image filenames.
 * All files are located in public/assets/fish/
 */
export const FISH_ASSET_MAP: Record<string, string> = {
    // Fish
    'tuna': 'tile000.png',
    'mackerel': 'tile001.png',
    'fat_tuna': 'tile002.png',
    'fat_mackerel': 'tile003.png',
    'catfish': 'tile004.png',
    'cod': 'tile005.png',
    'fat_cod': 'tile006.png',
    'salmon': 'tile007.png',
    'fat_salmon': 'tile008.png',
    'coho_salmon': 'tile009.png',
    'fat_catfish': 'tile010.png',
    
    // Rods
    'rickety_rod': 'tile075.png',
    'fisherman_rod': 'tile081.png',
    
    // Junk
    'sea_grass': 'tile225.png',
    'boot': 'tile226.png',
    'infested_boot': 'tile227.png',
    'broken_bottle': 'tile229.png',
    'infested_vase': 'tile230.png',
    'ruined_chest': 'tile236.png',
    'broken_specs': 'tile241.png',
    'apple_core': 'tile242.png',
    'sea_pickle': 'tile243.png',
    'trash_bag': 'tile249.png',
};

/**
 * Get the full asset path for a fishing-related item
 * @param itemId The item ID
 * @returns Full path relative to public folder, or undefined if not a fishing item
 */
export function getFishAssetPath(itemId: string): string | undefined {
    const filename = FISH_ASSET_MAP[itemId];
    if (!filename) return undefined;
    return `assets/fish/${filename}`;
}

// ============================================================================
// LOOT TABLES
// ============================================================================

/**
 * Temperate waters loot table
 * Most common fishing region with balanced variety
 */
export const TEMPERATE_LOOT: FishingLootEntry[] = [
    // Common Fish (High weight)
    { itemId: 'tuna', weight: 80, minRod: null, bait: null, idealDepth: 5 },
    { itemId: 'mackerel', weight: 80, minRod: null, bait: null, idealDepth: 3 },
    { itemId: 'cod', weight: 80, minRod: null, bait: null, idealDepth: 7 },
    { itemId: 'salmon', weight: 80, minRod: null, bait: null, idealDepth: 4 },
    { itemId: 'catfish', weight: 80, minRod: null, bait: null, idealDepth: 12 },

    // Uncommon Fish (Medium weight)
    { itemId: 'fat_tuna', weight: 40, minRod: null, bait: null, idealDepth: 8 },
    { itemId: 'fat_mackerel', weight: 40, minRod: null, bait: null, idealDepth: 6 },
    { itemId: 'fat_cod', weight: 40, minRod: null, bait: null, idealDepth: 10 },
    { itemId: 'fat_salmon', weight: 40, minRod: null, bait: null, idealDepth: 9 },
    { itemId: 'fat_catfish', weight: 40, minRod: null, bait: null, idealDepth: 14 },
    { itemId: 'coho_salmon', weight: 30, minRod: null, bait: null, idealDepth: 5 },

    // Trash / Junk (Variable weight, usually common)
    { itemId: 'sea_grass', weight: 100, minRod: null, bait: null, idealDepth: 2 },
    { itemId: 'boot', weight: 50, minRod: null, bait: null, idealDepth: 15 },
    { itemId: 'broken_bottle', weight: 50, minRod: null, bait: null, idealDepth: 14 },
    { itemId: 'apple_core', weight: 50, minRod: null, bait: null, idealDepth: 1 },
    { itemId: 'trash_bag', weight: 50, minRod: null, bait: null, idealDepth: 1 },
    { itemId: 'sea_pickle', weight: 30, minRod: null, bait: null, idealDepth: 12 },
    { itemId: 'broken_specs', weight: 30, minRod: null, bait: null, idealDepth: 13 },
    
    // Rare Junk / Treasure
    { itemId: 'infested_boot', weight: 20, minRod: null, bait: null, idealDepth: 15 },
    { itemId: 'infested_vase', weight: 20, minRod: null, bait: null, idealDepth: 15 },
    { itemId: 'ruined_chest', weight: 20, minRod: null, bait: null, idealDepth: 15 },
];

/**
 * All water region loot tables
 */
export const FISHING_LOOT_TABLES: Record<WaterRegion, FishingLootEntry[]> = {
    temperate: TEMPERATE_LOOT,
    tropical: [], // TODO: Implement tropical loot table
    arctic: [],   // TODO: Implement arctic loot table
    deep: [],     // TODO: Implement deep water loot table
    freshwater: [], // TODO: Implement freshwater loot table
};

// ============================================================================
// LOOT SELECTION UTILITIES
// ============================================================================

/**
 * Calculate the effective weight of a loot entry based on fishing conditions
 * @param entry The loot entry
 * @param currentDepth The current fishing depth
 * @param rodTier The player's rod tier
 * @param baitType The bait being used
 * @returns The effective weight (0 if item cannot be caught)
 */
export function calculateEffectiveWeight(
    entry: FishingLootEntry,
    currentDepth: number,
    rodTier: RodTier,
    baitType: BaitType,
    rarityMultiplier: number = 1
): number {
    // Check rod requirement
    if (entry.minRod !== null) {
        const rodOrder: RodTier[] = ['rickety', 'fisherman', 'professional', 'legendary'];
        const requiredIndex = rodOrder.indexOf(entry.minRod);
        const playerIndex = rodOrder.indexOf(rodTier);
        if (playerIndex < requiredIndex) {
            return 0; // Rod not good enough
        }
    }

    // Check bait requirement
    if (entry.bait !== null && entry.bait !== baitType) {
        return 0; // Wrong bait or no bait
    }

    // Calculate depth modifier
    // Items are easier to catch at their ideal depth
    const depthDifference = Math.abs(currentDepth - entry.idealDepth);
    const depthModifier = Math.max(0.2, 1 - (depthDifference * 0.05));
    const rarityWeight = getRarityWeight(entry.itemId, rarityMultiplier);

    return entry.weight * depthModifier * rarityWeight;
}

/**
 * Select a random item from a loot table based on weights
 * @param entries The loot entries to choose from
 * @param currentDepth The current fishing depth
 * @param rodTier The player's rod tier
 * @param baitType The bait being used (optional)
 * @returns The selected item ID, or null if no valid items
 */
export function selectFromLootTable(
    entries: FishingLootEntry[],
    currentDepth: number,
    rodTier: RodTier,
    baitType: BaitType = null,
    rarityMultiplier: number = 1
): string | null {
    // Calculate effective weights for all entries
    const weightedEntries = entries.map(entry => ({
        itemId: entry.itemId,
        weight: calculateEffectiveWeight(entry, currentDepth, rodTier, baitType, rarityMultiplier)
    })).filter(e => e.weight > 0);

    if (weightedEntries.length === 0) {
        return null;
    }

    // Calculate total weight
    const totalWeight = weightedEntries.reduce((sum, e) => sum + e.weight, 0);

    // Random selection based on weights
    let random = Math.random() * totalWeight;
    for (const entry of weightedEntries) {
        random -= entry.weight;
        if (random <= 0) {
            return entry.itemId;
        }
    }

    // Fallback to last entry (shouldn't normally reach here)
    return weightedEntries[weightedEntries.length - 1].itemId;
}

const RARITY_ORDER: ItemRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultimate'];

function getRarityWeight(itemId: string, rarityMultiplier: number): number {
    const def = getItemDefinition(itemId);
    const rarity = def?.rarity ?? 'common';
    const tier = Math.max(0, RARITY_ORDER.indexOf(rarity));
    const base = Math.max(0.1, rarityMultiplier);
    const weight = Math.pow(base, tier);
    return Math.max(0.05, weight);
}

/**
 * Get the loot table for a specific water region
 * @param region The water region
 * @returns The loot entries for that region
 */
export function getLootTable(region: WaterRegion): FishingLootEntry[] {
    return FISHING_LOOT_TABLES[region] || [];
}
