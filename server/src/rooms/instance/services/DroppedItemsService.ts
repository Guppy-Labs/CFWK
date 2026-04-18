import { Client } from "colyseus";
import { InstancePlayerSchema } from "../schema/InstancePlayerSchema";
import { DroppedItemSchema } from "../schema/DroppedItemSchema";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import {
    DROP_REFINEMENT_RECIPES_BY_SOURCE,
    DROP_REFINEMENT_TOUCH_COOLDOWN_MS,
    DROP_REFINEMENT_TOUCH_RADIUS_PX,
    LIQUID_COLLECTION_RECIPES_BY_LIQUID
} from "../InstanceRoomConstants";

export function createDroppedItem(room: InstanceRoomHost, itemId: string, amount: number, x: number, y: number) {
    const drop = new DroppedItemSchema();
    drop.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    drop.dropKind = "item";
    drop.itemId = itemId;
    drop.amount = amount;
    drop.coinDenomination = "";
    drop.coinAmount = 0;
    drop.x = x;
    drop.y = y;
    drop.createdAt = Date.now();
    const refinementRecipe = DROP_REFINEMENT_RECIPES_BY_SOURCE.get(itemId);
    if (refinementRecipe) {
        drop.refinementProgress = 0;
        drop.refinementRequiredSteps = Math.max(1, refinementRecipe.requiredSteps);
        drop.refinementResultItemId = refinementRecipe.liquidItemId;
    }
    const liquidRecipe = LIQUID_COLLECTION_RECIPES_BY_LIQUID.get(itemId);
    if (liquidRecipe) {
        drop.liquidContainerItemId = liquidRecipe.containerItemId;
        drop.liquidOutputItemId = liquidRecipe.outputItemId;
        drop.liquidConfirmText = liquidRecipe.confirmText;
    }
    room.state.droppedItems.set(drop.id, drop);
}

export function createDroppedCoins(
    room: InstanceRoomHost,
    amount: number,
    x: number,
    y: number,
    denomination: "bronze" = "bronze"
) {
    const normalizedAmount = Math.max(1, Math.floor(Number.isFinite(amount) ? amount : 0));
    const drop = new DroppedItemSchema();
    drop.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    drop.dropKind = "coins";
    // Keep a stable itemId for grouping/compatibility in clients.
    drop.itemId = `coins:${denomination}`;
    drop.amount = normalizedAmount;
    drop.coinDenomination = denomination;
    drop.coinAmount = normalizedAmount;
    drop.x = x;
    drop.y = y;
    drop.createdAt = Date.now();
    room.state.droppedItems.set(drop.id, drop);
}

export function tryRefineDropsFromMovement(
    room: InstanceRoomHost,
    client: Client,
    player: InstancePlayerSchema,
    nextX: number,
    nextY: number,
    now: number
) {
    if (!(room.dropRefineInsideByUserAndDrop instanceof Map)) {
        room.dropRefineInsideByUserAndDrop = new Map<string, boolean>();
    }

    room.state.droppedItems.forEach((drop: any, dropId: string) => {
        if (!drop.refinementResultItemId || drop.refinementRequiredSteps <= 0) return;
        if (!drop.itemId || !DROP_REFINEMENT_RECIPES_BY_SOURCE.has(drop.itemId)) return;
        const distance = Math.hypot(drop.x - nextX, drop.y - nextY);
        const touchKey = `${player.odcid}:${dropId}`;
        const isInsideRefineRadius = distance <= DROP_REFINEMENT_TOUCH_RADIUS_PX;
        const wasInsideRefineRadius = room.dropRefineInsideByUserAndDrop.get(touchKey) === true;
        if (!isInsideRefineRadius) {
            if (wasInsideRefineRadius) {
                room.dropRefineInsideByUserAndDrop.set(touchKey, false);
            }
            return;
        }
        if (wasInsideRefineRadius) return;

        // Only count a stomp when the player re-enters the drop after leaving it.
        room.dropRefineInsideByUserAndDrop.set(touchKey, true);
        const lastTouchAt = room.dropRefineTouchByUserAndDrop.get(touchKey) ?? 0;
        if ((now - lastTouchAt) < DROP_REFINEMENT_TOUCH_COOLDOWN_MS) return;
        room.dropRefineTouchByUserAndDrop.set(touchKey, now);

        drop.refinementProgress = Math.max(0, drop.refinementProgress) + 1;
        if (drop.refinementProgress < Math.max(1, drop.refinementRequiredSteps)) return;

        const fromItemId = drop.itemId;
        const toLiquidItemId = drop.refinementResultItemId;
        const liquidRecipe = LIQUID_COLLECTION_RECIPES_BY_LIQUID.get(toLiquidItemId);
        const preservedAmount = Math.max(1, Math.floor(Number.isFinite(drop.amount) ? Number(drop.amount) : 1));
        drop.itemId = toLiquidItemId;
        drop.amount = preservedAmount;
        drop.refinementProgress = 0;
        drop.refinementRequiredSteps = 0;
        drop.refinementResultItemId = "";
        drop.liquidContainerItemId = liquidRecipe?.containerItemId ?? "";
        drop.liquidOutputItemId = liquidRecipe?.outputItemId ?? "";
        drop.liquidConfirmText = liquidRecipe?.confirmText ?? "";

        void room.advancementsManager.onFoodRefined(player.odcid, fromItemId, toLiquidItemId)
            .then((updates: any) => room.sendAdvancements(client, updates))
            .catch((error: unknown) => {
                console.error("[InstanceRoom] food refinement advancements failed:", error);
            });
    });
}

export function getOrCreateHarvestCooldownMap(room: InstanceRoomHost, userId: string): Map<number, number> {
    let cooldownMap = room.harvestCooldownByUserId.get(userId);
    if (cooldownMap) return cooldownMap;
    cooldownMap = new Map<number, number>();
    room.harvestCooldownByUserId.set(userId, cooldownMap);
    return cooldownMap;
}
