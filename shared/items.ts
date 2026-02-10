export type ItemCategory = 'Food' | 'Tools' | 'Loot' | 'Fish' | 'Junk' | 'Treasure';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultimate';

export type RodStats = {
    speedMultiplier: number;
    rarityMultiplier: number;
    strength: number;
};

export type ItemConsumeEffect = {
    type: 'heal' | 'none' | string;
    amount?: number;
    [key: string]: unknown;
};

export type ItemDefinition = {
    id: string;
    name: string;
    category: ItemCategory;
    description: string;
    rarity?: ItemRarity;
    mass?: number;
    stackSize: number;
    consumeEffect: ItemConsumeEffect;
    rodStats?: RodStats;
    /**
     * Optional custom file path relative to /public for the item image.
     * If not specified, defaults to: items/{category}/{id}.png
     * Example: 'assets/fish/tile000.png'
     */
    file?: string;
};

export const ITEM_DEFINITIONS: ItemDefinition[] = [
    // === FOOD ===
    {
        id: 'goldenberries',
        name: 'Golden Berries',
        category: 'Food',
        description: 'A rare, sweet berry that restores vitality.',
        stackSize: 80,
        consumeEffect: {
            type: 'heal',
            amount: 0
        }
    },

    // === FISH (Common) ===
    {
        id: 'tuna',
        name: 'Tuna',
        category: 'Fish',
        description: 'A common tuna fish. Delicious when prepared properly.',
        rarity: 'common',
        mass: 3,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile000.png'
    },
    {
        id: 'mackerel',
        name: 'Mackerel',
        category: 'Fish',
        description: 'A sleek mackerel with shimmering scales.',
        rarity: 'common',
        mass: 2,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile001.png'
    },
    {
        id: 'cod',
        name: 'Cod',
        category: 'Fish',
        description: 'A plump cod fish, common in temperate waters.',
        rarity: 'common',
        mass: 3,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile005.png'
    },
    {
        id: 'salmon',
        name: 'Salmon',
        category: 'Fish',
        description: 'A pink salmon, prized for its rich flavor.',
        rarity: 'common',
        mass: 5,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile007.png'
    },
    {
        id: 'catfish',
        name: 'Catfish',
        category: 'Fish',
        description: 'A whiskered catfish that lurks in deeper waters.',
        rarity: 'common',
        mass: 4,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile004.png'
    },

    // === FISH (Uncommon) ===
    {
        id: 'fat_tuna',
        name: 'Fat Tuna',
        category: 'Fish',
        description: 'An exceptionally plump tuna. Worth more than its regular counterpart.',
        rarity: 'uncommon',
        mass: 6,
        stackSize: 30,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile002.png'
    },
    {
        id: 'fat_mackerel',
        name: 'Fat Mackerel',
        category: 'Fish',
        description: 'A chunky mackerel with extra meat.',
        rarity: 'uncommon',
        mass: 5,
        stackSize: 30,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile003.png'
    },
    {
        id: 'fat_cod',
        name: 'Fat Cod',
        category: 'Fish',
        description: 'An oversized cod, quite the catch!',
        rarity: 'uncommon',
        mass: 7,
        stackSize: 30,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile006.png'
    },
    {
        id: 'fat_salmon',
        name: 'Fat Salmon',
        category: 'Fish',
        description: 'A hefty salmon bursting with flavor.',
        rarity: 'uncommon',
        mass: 9,
        stackSize: 30,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile008.png'
    },
    {
        id: 'fat_catfish',
        name: 'Fat Catfish',
        category: 'Fish',
        description: 'A massive catfish. Its whiskers are impressively long.',
        rarity: 'uncommon',
        mass: 8,
        stackSize: 30,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile010.png'
    },
    {
        id: 'coho_salmon',
        name: 'Coho Salmon',
        category: 'Fish',
        description: 'A beautiful coho salmon with distinctive silver markings.',
        rarity: 'uncommon',
        mass: 6,
        stackSize: 30,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile009.png'
    },

    // === TOOLS (Fishing Rods) ===
    {
        id: 'rickety_rod',
        name: 'Rickety Rod',
        category: 'Tools',
        description: 'A worn fishing rod held together with hope and string.',
        rodStats: { speedMultiplier: 0.75, rarityMultiplier: 0.4, strength: 0.5 },
        stackSize: 1,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile075.png'
    },
    {
        id: 'fisherman_rod',
        name: "Fisherman's Rod",
        category: 'Tools',
        description: 'A reliable fishing rod used by experienced anglers.',
        rodStats: { speedMultiplier: 0.75, rarityMultiplier: 0.5, strength: 0.75 },
        stackSize: 1,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile081.png'
    },

    // === JUNK (Common Trash) ===
    {
        id: 'sea_grass',
        name: 'Sea Grass',
        category: 'Junk',
        description: 'A clump of sea grass. Not particularly useful.',
        rarity: 'common',
        mass: 1,
        stackSize: 99,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile225.png'
    },
    {
        id: 'boot',
        name: 'Old Boot',
        category: 'Junk',
        description: 'A waterlogged boot. Someone lost this ages ago.',
        rarity: 'common',
        mass: 2,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile226.png'
    },
    {
        id: 'broken_bottle',
        name: 'Broken Bottle',
        category: 'Junk',
        description: 'Shards of a broken glass bottle. Handle with care.',
        rarity: 'common',
        mass: 1,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile229.png'
    },
    {
        id: 'apple_core',
        name: 'Apple Core',
        category: 'Junk',
        description: 'The remains of someone\'s snack. Very fresh, oddly.',
        rarity: 'common',
        mass: 1,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile242.png'
    },
    {
        id: 'trash_bag',
        name: 'Trash Bag',
        category: 'Junk',
        description: 'A soggy trash bag. Who throws these in the water?',
        rarity: 'common',
        mass: 4,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile249.png'
    },
    {
        id: 'sea_pickle',
        name: 'Sea Pickle',
        category: 'Junk',
        description: 'A bioluminescent sea pickle. Kinda cute, actually.',
        rarity: 'common',
        mass: 2,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile243.png'
    },
    {
        id: 'broken_specs',
        name: 'Broken Spectacles',
        category: 'Junk',
        description: 'Someone\'s lost glasses. They probably can\'t read now.',
        rarity: 'uncommon',
        mass: 1,
        stackSize: 50,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile241.png'
    },

    // === TREASURE (Rare Junk) ===
    {
        id: 'infested_boot',
        name: 'Infested Boot',
        category: 'Treasure',
        description: 'An old boot now home to mysterious sea creatures.',
        rarity: 'uncommon',
        mass: 3,
        stackSize: 20,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile227.png'
    },
    {
        id: 'invested_vase',
        name: 'Invested Vase',
        category: 'Treasure',
        description: 'An ancient vase covered in barnacles. Could be valuable!',
        rarity: 'uncommon',
        mass: 10,
        stackSize: 20,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile230.png'
    },
    {
        id: 'ruined_chest',
        name: 'Ruined Chest',
        category: 'Treasure',
        description: 'A waterlogged treasure chest. Most contents have rotted away.',
        rarity: 'uncommon',
        mass: 12,
        stackSize: 10,
        consumeEffect: { type: 'none' },
        file: 'assets/fish/tile236.png'
    }
];

export const ITEM_DEFINITION_MAP: Record<string, ItemDefinition> = ITEM_DEFINITIONS.reduce(
    (acc, item) => {
        acc[item.id] = item;
        return acc;
    },
    {} as Record<string, ItemDefinition>
);

export function getItemDefinition(id: string): ItemDefinition | undefined {
    return ITEM_DEFINITION_MAP[id];
}

/**
 * Get the image path for an item.
 * If the item has a custom `file` property, use that path.
 * Otherwise, construct the default path: items/{category}/{id}.png
 * 
 * @param id The item ID
 * @returns The image path relative to /public, or undefined if item not found
 */
export function getItemImagePath(id: string): string | undefined {
    const item = getItemDefinition(id);
    if (!item) return undefined;
    
    // Use custom file path if specified
    if (item.file) {
        return item.file;
    }
    
    // Default path: items/{category_lowercase}/{id}.png
    const categoryPath = item.category.toLowerCase();
    return `items/${categoryPath}/${id}.png`;
}

/**
 * Get all items of a specific category
 * @param category The item category to filter by
 * @returns Array of item definitions in that category
 */
export function getItemsByCategory(category: ItemCategory): ItemDefinition[] {
    return ITEM_DEFINITIONS.filter(item => item.category === category);
}

/**
 * Get all fish items (convenience function)
 */
export function getAllFish(): ItemDefinition[] {
    return getItemsByCategory('Fish');
}

/**
 * Get all junk items (convenience function)
 */
export function getAllJunk(): ItemDefinition[] {
    return getItemsByCategory('Junk');
}

/**
 * Get all treasure items (convenience function)
 */
export function getAllTreasure(): ItemDefinition[] {
    return getItemsByCategory('Treasure');
}

/**
 * Get all fishing-related items (fish, junk, treasure)
 */
export function getAllFishingItems(): ItemDefinition[] {
    return ITEM_DEFINITIONS.filter(
        item => item.category === 'Fish' || item.category === 'Junk' || item.category === 'Treasure'
    );
}
