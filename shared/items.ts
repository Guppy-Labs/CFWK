export type ItemCategory = 'Food' | 'Tools' | 'Loot';

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
    stackSize: number;
    consumeEffect: ItemConsumeEffect;
};

export const ITEM_DEFINITIONS: ItemDefinition[] = [
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
