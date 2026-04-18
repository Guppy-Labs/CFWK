type DropRefinementRecipe = {
    sourceItemId: string;
    requiredSteps: number;
    liquidItemId: string;
};

type LiquidCollectionRecipe = {
    liquidItemId: string;
    containerItemId: string;
    outputItemId: string;
    confirmText: string;
};

export const YEKBUSH_COMPONENT_ID = "yekbush";
export const YEKBUSH_INTERACTION_RADIUS_PX = Math.round(3 * 32 * 0.25);
export const YEKBUSH_COOLDOWN_MS = 40_000;
export const GLIMMERING_CHEST_COMPONENT_ID = "glimmeringchest";
export const GLIMMERING_KEY_ITEM_ID = "glimmeringkey";
export const GLIMMERING_CHEST_INTERACTION_RADIUS_PX = 3 * 32;
export const DROP_REFINEMENT_TOUCH_RADIUS_PX = 18;
export const DROP_REFINEMENT_TOUCH_COOLDOWN_MS = 220;

export const DROP_REFINEMENT_RECIPES_BY_SOURCE = new Map<string, DropRefinementRecipe>([
    ["yekberries", {
        sourceItemId: "yekberries",
        requiredSteps: 3,
        liquidItemId: "yekjuiceliquid"
    }]
]);

export const LIQUID_COLLECTION_RECIPES_BY_LIQUID = new Map<string, LiquidCollectionRecipe>([
    ["yekjuiceliquid", {
        liquidItemId: "yekjuiceliquid",
        containerItemId: "jar",
        outputItemId: "yekjuice",
        confirmText: "Confirm Consuming 1 Jar"
    }]
]);
