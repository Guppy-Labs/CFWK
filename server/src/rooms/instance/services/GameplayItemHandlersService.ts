import {
    DEFAULT_INVENTORY_SLOTS,
    DEFAULT_PLAYER_MONEY_STATE,
    getItemDefinition,
    getLootTable,
    isRodItem,
    getRodStats,
    selectFromLootTable
} from "@cfwk/shared";
import User from "../../../models/User";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import { validateClientInventorySnapshot } from "../authority/InventoryAuthority";
import {
    GLIMMERING_CHEST_COMPONENT_ID,
    GLIMMERING_KEY_ITEM_ID,
    YEKBUSH_COMPONENT_ID,
    YEKBUSH_COOLDOWN_MS
} from "../InstanceRoomConstants";

export function registerInteractiveWorldHandlers(room: InstanceRoomHost) {
    room.onMessage("interactive:harvest", async (client, data: { objectId?: number; componentId?: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const componentId = typeof data?.componentId === "string"
            ? data.componentId.trim().toLowerCase()
            : YEKBUSH_COMPONENT_ID;
        if (componentId !== YEKBUSH_COMPONENT_ID) return;

        const objectId = Number.isFinite(data?.objectId)
            ? Math.floor(Number(data?.objectId))
            : -1;
        if (objectId <= 0) return;

        const target = room.harvestTargetsByObjectId.get(objectId);
        if (!target || target.componentId !== componentId) return;

        const distance = Math.hypot(player.x - target.centerX, player.y - target.centerY);
        if (distance > target.radiusPx) return;

        const now = Date.now();
        const cooldownMap = room.getOrCreateHarvestCooldownMap(player.odcid);
        const readyAt = cooldownMap.get(objectId) ?? 0;
        if (readyAt > now) {
            client.send("interactive:harvest:cooldown", {
                objectId,
                componentId,
                centerX: target.centerX,
                centerY: target.centerY,
                cooldownMs: YEKBUSH_COOLDOWN_MS,
                readyAt,
                remainingMs: readyAt - now
            });
            return;
        }

        const quantity = Math.random() < 0.2 ? 2 : 1;
        const itemId = "yekberries";

        const { items: currentSlots } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        const stackSize = getItemDefinition(itemId)?.stackSize ?? 99;
        const hasStackSpace = currentSlots.some((slot: { itemId: string | null; count: number }) => slot.itemId === itemId && slot.count < stackSize);
        const hasEmptySlot = currentSlots.some((slot: { itemId: string | null; count: number }) => !slot.itemId || slot.count === 0);

        let updatedSlots = currentSlots;
        if (hasStackSpace || hasEmptySlot) {
            updatedSlots = await room.deps.inventoryCache.addItem(player.odcid, itemId, quantity);
        } else {
            room.createDroppedItem(itemId, quantity, player.x, player.y);
            client.send("inventory:skip", { itemId, quantity });
        }

        const nextReadyAt = now + YEKBUSH_COOLDOWN_MS;
        cooldownMap.set(objectId, nextReadyAt);

        const { equippedRodId, equippedUsableIds } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        client.send("inventory", {
            slots: updatedSlots,
            totalSlots: DEFAULT_INVENTORY_SLOTS,
            equippedRodId,
            equippedUsableIds
        });

        client.send("interactive:harvest:success", {
            objectId,
            componentId,
            centerX: target.centerX,
            centerY: target.centerY,
            quantity,
            itemId,
            cooldownMs: YEKBUSH_COOLDOWN_MS,
            readyAt: nextReadyAt
        });

        void room.advancementsManager.onHarvestInteractive(player.odcid, componentId, objectId)
            .then(async (updates: any) => {
                await room.sendAdvancements(client, updates);
                await room.sendInventoryCountObjectiveForItem(client, player.odcid, itemId, updatedSlots);
            })
            .catch((error: unknown) => {
                console.error("[InstanceRoom] harvest advancements failed:", error);
            });
    });

    room.onMessage("interactive:chest", async (client, data: { objectId?: number; componentId?: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const componentId = typeof data?.componentId === "string"
            ? data.componentId.trim().toLowerCase()
            : "";
        if (componentId !== GLIMMERING_CHEST_COMPONENT_ID) return;

        const target = room.chestInteractionTarget;
        if (!target || target.componentId !== componentId) return;

        const distance = Math.hypot(player.x - target.centerX, player.y - target.centerY);
        if (distance > target.radiusPx) return;

        const activeChestObjective = await room.advancementsManager.getActiveHarvestObjective(player.odcid, componentId);
        if (!activeChestObjective) return;

        const updatedSlots = await room.deps.inventoryCache.removeItem(player.odcid, GLIMMERING_KEY_ITEM_ID, 1);
        if (!updatedSlots) return;

        const unlockState = await room.deps.glimmerbowlCache.unlockForUser(player.odcid);
        room.glimmerbowlUnlockedByUserId.set(player.odcid, true);

        const inventorySlotsToSend = unlockState.movedFish && Array.isArray(unlockState.slots)
            ? unlockState.slots
            : updatedSlots;
        const { equippedRodId, equippedUsableIds } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        client.send("inventory", {
            slots: inventorySlotsToSend,
            totalSlots: DEFAULT_INVENTORY_SLOTS,
            equippedRodId,
            equippedUsableIds
        });
        client.send("glimmerbowl", {
            entries: unlockState.entries,
            unlocked: true,
            hasOwnedScar: await room.hasOwnedScar(player.odcid)
        });

        const advancementUpdates = await room.advancementsManager.onHarvestInteractive(player.odcid, componentId);
        await room.sendAdvancements(client, advancementUpdates);

        client.send("interactive:chest:opened", {
            componentId,
            centerX: target.centerX,
            centerY: target.centerY
        });
    });
}

export function registerInventoryAndGlimmerbowlHandlers(room: InstanceRoomHost) {
    room.onMessage("pickupItem", async (client, data: { droppedItemId: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const droppedItem = room.state.droppedItems.get(data.droppedItemId);
        if (!droppedItem) return;

        const dx = droppedItem.x - player.x;
        const dy = droppedItem.y - player.y;
        const distance = Math.hypot(dx, dy);
        const maxPickupDistance = 42;
        if (distance > maxPickupDistance) return;

        const liquidContainerItemId = typeof droppedItem.liquidContainerItemId === "string" ? droppedItem.liquidContainerItemId : "";
        const liquidOutputItemId = typeof droppedItem.liquidOutputItemId === "string" ? droppedItem.liquidOutputItemId : "";
        const dropKind = typeof droppedItem.dropKind === "string" ? droppedItem.dropKind : "item";
        if (dropKind === "coins") {
            const coinAmount = Math.max(
                0,
                Math.floor(
                    Number.isFinite(droppedItem.coinAmount)
                        ? droppedItem.coinAmount
                        : droppedItem.amount
                )
            );
            room.state.droppedItems.delete(data.droppedItemId);
            if (coinAmount <= 0) return;

            const userId = player.odcid || client.sessionId;
            const currentMoney = room.moneyByUserId.get(userId) ?? DEFAULT_PLAYER_MONEY_STATE.money;
            const nextMoney = room.normalizeMoneyAmount(currentMoney + coinAmount);
            room.moneyByUserId.set(userId, nextMoney);
            client.send("player:money", { money: nextMoney });

            if (userId !== client.sessionId) {
                User.updateOne({ _id: userId }, { $set: { money: nextMoney } }).catch((error) => {
                    console.error("[InstanceRoom] Failed to persist coin pickup money:", error);
                });
            }
            return;
        }
        if (liquidContainerItemId && liquidOutputItemId) {
            const { items: currentSlots } = await room.deps.inventoryCache.getInventoryState(player.odcid);
            const hasContainer = currentSlots.some((slot: { itemId: string | null; count: number }) => slot.itemId === liquidContainerItemId && slot.count > 0);
            if (!hasContainer) return;

            const removedContainerSlots = await room.deps.inventoryCache.removeItem(player.odcid, liquidContainerItemId, 1);
            if (!removedContainerSlots) return;

            room.state.droppedItems.delete(data.droppedItemId);
            const outputSlots = await room.deps.inventoryCache.addItem(
                player.odcid,
                liquidOutputItemId,
                Math.max(1, Math.floor(droppedItem.amount || 1))
            );
            const { equippedRodId, equippedUsableIds } = await room.deps.inventoryCache.getInventoryState(player.odcid);
            client.send("inventory", {
                slots: outputSlots,
                totalSlots: DEFAULT_INVENTORY_SLOTS,
                equippedRodId,
                equippedUsableIds
            });

            void room.advancementsManager.onLiquidBottled(
                player.odcid,
                droppedItem.itemId,
                liquidContainerItemId,
                liquidOutputItemId
            ).then((updates: any) => room.sendAdvancements(client, updates))
                .catch((error: unknown) => {
                    console.error("[InstanceRoom] liquid bottling advancements failed:", error);
                });
            return;
        }

        const droppedItemDef = getItemDefinition(droppedItem.itemId);
        if (!droppedItemDef) return;

        const glimmerbowlUnlocked = await room.isGlimmerbowlUnlocked(player.odcid);
        if (droppedItemDef.category === "Fish" && glimmerbowlUnlocked) {
            const migrated = await room.deps.glimmerbowlCache.migrateInventoryFishToGlimmerbowl(player.odcid);
            if (migrated.movedFish && migrated.slots) {
                client.send("inventory", {
                    slots: migrated.slots,
                    totalSlots: DEFAULT_INVENTORY_SLOTS,
                    equippedRodId: migrated.equippedRodId ?? null
                });
            }
            room.state.droppedItems.delete(data.droppedItemId);
            const entries = await room.deps.glimmerbowlCache.addFish(
                player.odcid,
                droppedItem.itemId,
                droppedItem.amount,
                "regular"
            );
            client.send("glimmerbowl", {
                entries,
                unlocked: true,
                hasOwnedScar: await room.hasOwnedScar(player.odcid)
            });
            return;
        }

        const { items: currentSlots, equippedRodId: equippedRodIdFromState } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        const stackSize = getItemDefinition(droppedItem.itemId)?.stackSize ?? 99;
        const hasStackSpace = currentSlots.some((slot: { itemId: string | null; count: number }) => slot.itemId === droppedItem.itemId && slot.count < stackSize);
        const hasEmptySlot = currentSlots.some((slot: { itemId: string | null; count: number }) => !slot.itemId || slot.count === 0);
        if (!hasStackSpace && !hasEmptySlot) {
            client.send("inventory", { slots: currentSlots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId: equippedRodIdFromState });
            client.send("inventory:skip", { itemId: droppedItem.itemId, quantity: droppedItem.amount });
            return;
        }

        room.state.droppedItems.delete(data.droppedItemId);
        const slots = await room.deps.inventoryCache.addItem(player.odcid, droppedItem.itemId, droppedItem.amount);
        await room.setHasOwnedScarFromInventory(player.odcid, slots);
        const { equippedRodId } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        client.send("inventory", { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId });
        await room.sendInventoryCountObjectiveForItem(client, player.odcid, droppedItem.itemId, slots);
    });

    room.onMessage("dropItem", async (client, data: { itemId: string; amount: number }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;

        const amount = Math.max(1, Math.floor(data.amount || 1));
        if (!data.itemId) return;
        if (data.itemId.startsWith("coins:")) return;

        const itemDef = getItemDefinition(data.itemId);
        if (!itemDef) return;

        const glimmerbowlUnlocked = await room.isGlimmerbowlUnlocked(player.odcid);
        if (itemDef.category === "Fish" && glimmerbowlUnlocked) {
            const migrated = await room.deps.glimmerbowlCache.migrateInventoryFishToGlimmerbowl(player.odcid);
            if (migrated.movedFish && migrated.slots) {
                client.send("inventory", {
                    slots: migrated.slots,
                    totalSlots: DEFAULT_INVENTORY_SLOTS,
                    equippedRodId: migrated.equippedRodId ?? null
                });
            }
            const glimmerUpdated = await room.deps.glimmerbowlCache.removeFish(player.odcid, data.itemId, amount);
            if (!glimmerUpdated) return;
            room.createDroppedItem(data.itemId, amount, player.x, player.y);
            client.send("glimmerbowl", {
                entries: glimmerUpdated,
                unlocked: true,
                hasOwnedScar: await room.hasOwnedScar(player.odcid)
            });
            return;
        }

        const updated = await room.deps.inventoryCache.removeItem(player.odcid, data.itemId, amount);
        if (!updated) return;
        room.createDroppedItem(data.itemId, amount, player.x, player.y);
        const { equippedRodId } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        client.send("inventory", { slots: updated, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId });
    });

    room.onMessage("glimmerbowl:awaken", async (client, data: { fishEntryId?: string; scarItemId?: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        const fishEntryId = typeof data?.fishEntryId === "string" ? data.fishEntryId.trim() : "";
        const scarItemId = typeof data?.scarItemId === "string" ? data.scarItemId.trim() : "";
        if (!fishEntryId || !scarItemId) return;

        const glimmerbowlUnlocked = await room.isGlimmerbowlUnlocked(player.odcid);
        if (!glimmerbowlUnlocked) return;

        try {
            const result = await room.deps.glimmerbowlCache.awakenFish(player.odcid, fishEntryId, scarItemId);
            const { equippedRodId, equippedUsableIds } = await room.deps.inventoryCache.getInventoryState(player.odcid);
            client.send("inventory", {
                slots: result.slots,
                totalSlots: DEFAULT_INVENTORY_SLOTS,
                equippedRodId,
                equippedUsableIds
            });
            client.send("glimmerbowl", {
                entries: result.entries,
                unlocked: true,
                hasOwnedScar: await room.hasOwnedScar(player.odcid)
            });
        } catch (error) {
            console.warn("[InstanceRoom] glimmerbowl awaken rejected:", error);
        }
    });

    room.onMessage("glimmerbowl:combat-state", async (client, data: any) => {
        room.markActivity(client);
        await room.handleGlimmerbowlCombatState(client, data);
    });

    room.onMessage("glimmerbowl:launch", async (client, data: any) => {
        room.markActivity(client);
        await room.handleGlimmerbowlLaunch(client, data);
    });

    room.onMessage("inventory:set", async (client, data: { slots: { index: number; itemId: string | null; count: number }[] }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        if (!data || !Array.isArray(data.slots)) return;
        const {
            items: currentSlots,
            equippedRodId,
            equippedUsableIds
        } = await room.deps.inventoryCache.getInventoryState(player.odcid);

        const validation = validateClientInventorySnapshot(currentSlots, data.slots);
        if (!validation.valid) {
            console.warn(`[InstanceRoom] Rejected inventory:set for ${player.odcid}: ${validation.reason}`);
            client.send("inventory", { slots: currentSlots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId, equippedUsableIds });
            return;
        }

        room.deps.inventoryCache.setInventory(player.odcid, validation.slots);
        client.send("inventory", { slots: validation.slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId, equippedUsableIds });
    });
}

export function registerFishingHandlers(room: InstanceRoomHost) {
    room.onMessage("fishing:start", async (client, data: { rodItemId: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        if (room.defeatedByUserId.get(player.odcid || client.sessionId)) return;

        const { items: slots, equippedRodId } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        const ownedRodCount = slots
            .filter((slot: { itemId: string | null; count: number }) => slot.itemId === equippedRodId)
            .reduce((sum: number, slot: { itemId: string | null; count: number }) => sum + slot.count, 0);
        const rodDef = equippedRodId ? getItemDefinition(equippedRodId) : undefined;
        if (!equippedRodId || !isRodItem(rodDef) || ownedRodCount <= 0) {
            client.send("chat", {
                username: "SYSTEM",
                odcid: "SYSTEM",
                message: "Equip a valid fishing rod before fishing.",
                timestamp: Date.now(),
                isSystem: true
            });
            return;
        }

        player.isFishing = true;
        player.vx = 0;
        player.vy = 0;
        player.anim = "idle";
        player.moveTs = Date.now();

        const runtime = room.movementRuntimeBySession.get(client.sessionId);
        if (runtime) {
            runtime.vx = 0;
            runtime.vy = 0;
            runtime.input = { up: false, down: false, left: false, right: false, sprint: false };
            runtime.impulseVx = 0;
            runtime.impulseVy = 0;
            runtime.impulseActiveUntil = 0;
            runtime.lastServerTime = Date.now();
        }
        room.broadcast("fishing:start", {
            sessionId: client.sessionId,
            rodItemId: equippedRodId ?? data?.rodItemId ?? null
        });
    });

    room.onMessage("fishing:stop", (client) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (player) {
            player.isFishing = false;
            player.moveTs = Date.now();
        }
        room.broadcast("fishing:stop", { sessionId: client.sessionId });
    });

    room.onMessage("fishing:cast", (client, data: { depth?: number; region?: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player || !player.isFishing) return;
        if (room.defeatedByUserId.get(player.odcid || client.sessionId)) return;

        const depthRaw = typeof data?.depth === "number" ? data.depth : 1;
        const depth = Math.max(1, Math.min(12, depthRaw));
        const rawRegion = typeof data?.region === "string" ? data.region.trim().toLowerCase() : "";
        const region = (rawRegion === "temperate"
            || rawRegion === "tropical"
            || rawRegion === "arctic"
            || rawRegion === "deep"
            || rawRegion === "freshwater")
            ? rawRegion
            : "temperate";
        room.fishingCasts.set(client.sessionId, { depth, region, castAt: Date.now() });
    });

    room.onMessage("fishing:hook", async (client) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        if (room.defeatedByUserId.get(player.odcid || client.sessionId)) return;
        const cast = room.fishingCasts.get(client.sessionId);
        if (!cast) return;
        if (cast.itemId && cast.clicksRequired) {
            client.send("fishing:hooked", { itemId: cast.itemId, clicksRequired: cast.clicksRequired });
            return;
        }

        const entries = getLootTable(cast.region as any);
        const equippedRodIdCurrent = room.deps.inventoryCache.getEquippedRod(player.odcid);
        const rodStats = getRodStats(equippedRodIdCurrent);
        const guidedTutorial = room.tutorialStateBySession.get(client.sessionId);
        const forcedItemId = guidedTutorial?.forceSalmonCatch ? "salmon" : null;
        const itemId = forcedItemId ?? selectFromLootTable(entries, cast.depth, "rickety", null, rodStats.rarityMultiplier);
        if (!itemId) return;

        const mass = getItemDefinition(itemId)?.mass ?? 1;
        const baseClicks = Math.ceil(mass * 1.5);
        const strength = Math.max(0.1, rodStats.strength);
        const clicksRequired = Math.max(1, Math.ceil(baseClicks * (1 / strength)));

        cast.itemId = itemId;
        cast.clicksRequired = clicksRequired;
        room.fishingCasts.set(client.sessionId, cast);
        client.send("fishing:hooked", { itemId, clicksRequired });
    });

    room.onMessage("fishing:catch", async (client) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        if (room.defeatedByUserId.get(player.odcid || client.sessionId)) return;

        const cast = room.fishingCasts.get(client.sessionId);
        if (!cast) return;

        const entries = getLootTable(cast.region as any);
        const equippedRodIdCurrent = room.deps.inventoryCache.getEquippedRod(player.odcid);
        const rodStats = getRodStats(equippedRodIdCurrent);
        const guidedTutorial = room.tutorialStateBySession.get(client.sessionId);
        const forcedItemId = guidedTutorial?.forceSalmonCatch ? "salmon" : null;
        const forceGlimmeringKey = await room.shouldForceGlimmeringKeyCatch(player.odcid, player.x, player.y);
        const itemId = forceGlimmeringKey
            ? "glimmeringkey"
            : (forcedItemId ?? cast.itemId ?? selectFromLootTable(entries, cast.depth, "rickety", null, rodStats.rarityMultiplier));
        room.fishingCasts.delete(client.sessionId);
        if (!itemId) return;

        const itemDef = getItemDefinition(itemId);
        if (!itemDef) return;

        room.incrementStat(client, player, "catches", 1);
        const advancementUpdates = forceGlimmeringKey
            ? await room.advancementsManager.onFishCatchNearLocation(player.odcid, "KeyLocation")
            : await room.advancementsManager.onFishCatch(player.odcid);
        await room.sendAdvancements(client, advancementUpdates);

        const glimmerbowlUnlocked = await room.isGlimmerbowlUnlocked(player.odcid);
        if (itemDef.category === "Fish" && glimmerbowlUnlocked) {
            const migrated = await room.deps.glimmerbowlCache.migrateInventoryFishToGlimmerbowl(player.odcid);
            if (migrated.movedFish && migrated.slots) {
                client.send("inventory", {
                    slots: migrated.slots,
                    totalSlots: DEFAULT_INVENTORY_SLOTS,
                    equippedRodId: migrated.equippedRodId ?? null
                });
            }
            const glimmerEntries = await room.deps.glimmerbowlCache.addFish(player.odcid, itemId, 1, "regular");
            client.send("glimmerbowl", {
                entries: glimmerEntries,
                unlocked: true,
                hasOwnedScar: await room.hasOwnedScar(player.odcid)
            });
            client.send("fishing:catchResult", { itemId });
            return;
        }

        const { items: currentSlots, equippedRodId: equippedRodIdFromState } = await room.deps.inventoryCache.getInventoryState(player.odcid);
        const stackSize = getItemDefinition(itemId)?.stackSize ?? 99;
        const hasStackSpace = currentSlots.some((slot: { itemId: string | null; count: number }) => slot.itemId === itemId && slot.count < stackSize);
        const hasEmptySlot = currentSlots.some((slot: { itemId: string | null; count: number }) => !slot.itemId || slot.count === 0);

        if (!hasStackSpace && !hasEmptySlot) {
            room.createDroppedItem(itemId, 1, player.x, player.y);
            client.send("inventory", { slots: currentSlots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId: equippedRodIdFromState });
            client.send("inventory:skip", { itemId, quantity: 1 });
            client.send("fishing:catchResult", { itemId });
            return;
        }

        const slots = await room.deps.inventoryCache.addItem(player.odcid, itemId, 1);
        await room.setHasOwnedScarFromInventory(player.odcid, slots);
        client.send("inventory", { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId: equippedRodIdFromState });
        client.send("fishing:catchResult", { itemId });
    });
}
