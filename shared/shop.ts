export type IShopItemEntry = {
    itemId: string;
    baseCost: number;
    maxWares: number;
    replenishMinutes: number;
};

export type IShopDefinition = {
    id: string;
    items: IShopItemEntry[];
};

export type IShopItemState = {
    itemId: string;
    available: number;
    nextReplenishAt: number | null;
};

export type IShopStatePayload = {
    shopId: string;
    items: IShopItemState[];
};

export const SHOP_DEFINITIONS: Record<string, IShopDefinition> = {
    merchant_wares: {
        id: 'merchant_wares',
        items: [
            { itemId: 'jar', baseCost: 15, maxWares: 25, replenishMinutes: 5 },
            { itemId: 'yekberries', baseCost: 5, maxWares: 100, replenishMinutes: 2 }
        ]
    }
};

const LIMITED_SUPPLY_THRESHOLD = 0.10;
const LIMITED_SUPPLY_MIN_MARKUP = 0.30;
const LIMITED_SUPPLY_MAX_MARKUP = 0.80;

export function isLimitedSupply(available: number, maxWares: number): boolean {
    if (maxWares <= 0) return false;
    return available / maxWares <= LIMITED_SUPPLY_THRESHOLD;
}

export function getShopItemPrice(baseCost: number, available: number, maxWares: number): number {
    if (maxWares <= 0) return baseCost;
    const ratio = Math.max(0, Math.min(available, maxWares)) / maxWares;
    if (ratio > LIMITED_SUPPLY_THRESHOLD) return baseCost;

    const t = 1 - ratio / LIMITED_SUPPLY_THRESHOLD;
    const markup = LIMITED_SUPPLY_MIN_MARKUP + t * (LIMITED_SUPPLY_MAX_MARKUP - LIMITED_SUPPLY_MIN_MARKUP);
    return Math.ceil(baseCost * (1 + markup));
}

export function getShopDefinition(shopId: string): IShopDefinition | undefined {
    return SHOP_DEFINITIONS[shopId];
}

export function getShopItemEntry(shopId: string, itemId: string): IShopItemEntry | undefined {
    const shop = SHOP_DEFINITIONS[shopId];
    if (!shop) return undefined;
    return shop.items.find((entry) => entry.itemId === itemId);
}
