import {
    GuideFishingStep,
    GuideFoodStep,
    GuideInteractionStep,
    GuideRodStep,
    IGuideTutorialState
} from "@cfwk/shared";

const ROD_ORDER: GuideRodStep[] = [
    "idle",
    "open_inventory",
    "select_rod",
    "equip_rod",
    "close_inventory",
    "completed"
];

const FISHING_ORDER: GuideFishingStep[] = [
    "idle",
    "use_rod",
    "hold_cast",
    "wait_bite",
    "reel",
    "stop_fishing",
    "completed"
];

const FOOD_ORDER: GuideFoodStep[] = [
    "idle",
    "open_inventory",
    "select_berry",
    "explain_food_score",
    "equip_quickslot_1",
    "close_inventory",
    "consume_quickslot_1",
    "completed"
];

const INTERACTION_ORDER: GuideInteractionStep[] = [
    "idle",
    "press_interact",
    "completed"
];

const FORCE_SALMON_STEPS = new Set<GuideFishingStep>(["hold_cast", "wait_bite", "reel", "stop_fishing"]);

function canTransition<T extends string>(current: T, next: unknown, order: T[]): next is T {
    if (typeof next !== "string") return false;
    const currentIndex = order.indexOf(current);
    const nextIndex = order.indexOf(next as T);
    if (currentIndex < 0 || nextIndex < 0) return false;
    if (currentIndex === nextIndex) return true;
    return nextIndex === currentIndex + 1;
}

export function sanitizeTutorialPatch(
    current: IGuideTutorialState,
    patch: Partial<IGuideTutorialState>
): Partial<IGuideTutorialState> | null {
    if (!patch || typeof patch !== "object") return null;

    const next: IGuideTutorialState = { ...current };

    if (canTransition(current.rodStep, patch.rodStep, ROD_ORDER)) {
        next.rodStep = patch.rodStep;
    }
    if (canTransition(current.fishingStep, patch.fishingStep, FISHING_ORDER)) {
        next.fishingStep = patch.fishingStep;
    }
    if (canTransition(current.foodStep, patch.foodStep, FOOD_ORDER)) {
        next.foodStep = patch.foodStep;
    }
    if (canTransition(current.interactionStep, patch.interactionStep, INTERACTION_ORDER)) {
        next.interactionStep = patch.interactionStep;
    }

    // Derive completion flags on the server instead of trusting client booleans.
    next.rodCompleted = next.rodStep === "completed";
    next.fishingCompleted = next.fishingStep === "completed";
    next.foodCompleted = next.foodStep === "completed";
    next.interactionCompleted = next.interactionStep === "completed";

    // Server-managed tutorial force flags.
    next.forceSalmonCatch = !next.fishingCompleted && FORCE_SALMON_STEPS.has(next.fishingStep);
    next.forceFoodGuideHeal = !next.foodCompleted && next.foodStep === "consume_quickslot_1";

    const updates: Partial<IGuideTutorialState> = {};
    if (next.rodStep !== current.rodStep) updates.rodStep = next.rodStep;
    if (next.fishingStep !== current.fishingStep) updates.fishingStep = next.fishingStep;
    if (next.foodStep !== current.foodStep) updates.foodStep = next.foodStep;
    if (next.interactionStep !== current.interactionStep) updates.interactionStep = next.interactionStep;
    if (next.rodCompleted !== current.rodCompleted) updates.rodCompleted = next.rodCompleted;
    if (next.fishingCompleted !== current.fishingCompleted) updates.fishingCompleted = next.fishingCompleted;
    if (next.foodCompleted !== current.foodCompleted) updates.foodCompleted = next.foodCompleted;
    if (next.interactionCompleted !== current.interactionCompleted) updates.interactionCompleted = next.interactionCompleted;
    if (next.forceSalmonCatch !== current.forceSalmonCatch) updates.forceSalmonCatch = next.forceSalmonCatch;
    if (next.forceFoodGuideHeal !== current.forceFoodGuideHeal) updates.forceFoodGuideHeal = next.forceFoodGuideHeal;

    return Object.keys(updates).length > 0 ? updates : null;
}
