import { Client } from "colyseus";
import User from "../../../models/User";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import { wipePlayerGameplayData } from "./PlayerStateService";
import { serializeShopWaresForSave, cleanupShopWaresForUser } from "./ShopService";

export async function handleLeave(room: InstanceRoomHost, client: Client, consented: boolean) {
    console.log(`[InstanceRoom] ${client.sessionId} left instance ${room.instanceId}`);
    const departingPlayer = room.state.players.get(client.sessionId);

    const odcid = (client as any).odcid;
    let shouldWipeDemoOnDisconnect = false;

    if (odcid && odcid !== client.sessionId && consented === false && !room.wipedUserIds.has(odcid)) {
        try {
            const user = await User.findById(odcid).select("isDemo").lean();
            if ((user as { isDemo?: boolean } | null)?.isDemo === true) {
                shouldWipeDemoOnDisconnect = true;
                room.wipedUserIds.add(odcid);
                console.log(`[DemoMode] Non-consented disconnect detected for demo user ${odcid}; wiping progress.`);
            }
        } catch (error) {
            console.error("[DemoMode] Failed to determine demo status during leave:", error);
        }
    }

    if (shouldWipeDemoOnDisconnect && odcid) {
        try {
            await wipePlayerGameplayData(room, odcid);
            console.log(`[DemoMode] Wiped demo progress on disconnect for ${odcid}.`);
        } catch (error) {
            console.error("[DemoMode] Failed to wipe demo progress on disconnect:", error);
        }
    }

    if (odcid) {
        room.harvestCooldownByUserId.delete(odcid);
        room.fishCombatByUserId.delete(odcid);
        room.enemyBridgeWarnCooldownByUserId.delete(odcid);
        room.enemyBridgeUnlockedByUserId.delete(odcid);
        room.heedTheWarningStayObjectiveByUserId.delete(odcid);
        room.wasInDangerByUserId.delete(odcid);
        room.clientTimeOffsetByUserId?.delete(odcid);
        const prefix = `${odcid}:`;
        Array.from(room.dropRefineTouchByUserAndDrop.keys()).forEach((key: unknown) => {
            const touchKey = typeof key === "string" ? key : "";
            if (touchKey.startsWith(prefix)) {
                room.dropRefineTouchByUserAndDrop.delete(touchKey);
            }
        });
        Array.from(room.dropRefineInsideByUserAndDrop.keys()).forEach((key: unknown) => {
            const touchKey = typeof key === "string" ? key : "";
            if (touchKey.startsWith(prefix)) {
                room.dropRefineInsideByUserAndDrop.delete(touchKey);
            }
        });
    }
    if (odcid && odcid !== client.sessionId) {
        room.instanceManager.unregisterUserConnection(odcid);
        room.glimmerbowlUnlockedByUserId.delete(odcid);
        room.hasOwnedScarByUserId.delete(odcid);
        room.heartsByUserId.delete(odcid);
        room.moneyByUserId.delete(odcid);
        room.defeatedByUserId.delete(odcid);

        const isWipedSession = room.wipedUserIds.has(odcid);
        if (departingPlayer && !isWipedSession) {
            const shopWaresData = serializeShopWaresForSave(room, odcid);
            const updateFields: Record<string, unknown> = {
                lastLocationId: room.state.locationId,
                lastPositionX: departingPlayer.x,
                lastPositionY: departingPlayer.y
            };
            if (shopWaresData) {
                updateFields.shopWares = shopWaresData;
            }
            User.updateOne(
                { _id: odcid },
                { $set: updateFields }
            ).catch((err) => {
                console.error("[InstanceRoom] Failed to persist last known player position:", err);
            });
        }
        cleanupShopWaresForUser(room, odcid);

        if (isWipedSession) {
            room.wipedUserIds.delete(odcid);
        }
    }

    if (room.demoTimers?.has(client.sessionId)) {
        clearTimeout(room.demoTimers.get(client.sessionId));
        room.demoTimers.delete(client.sessionId);
    }

    room.state.players.delete(client.sessionId);
    room.fishingCasts.delete(client.sessionId);
    room.tutorialStateBySession.delete(client.sessionId);
    room.tutorialStabAppliedBySession.delete(client.sessionId);
    room.lastActivityBySession.delete(client.sessionId);
    room.pendingStatsDeltasBySession.delete(client.sessionId);
    room.sprintStateBySession.delete(client.sessionId);
    room.movementRuntimeBySession.delete(client.sessionId);
    room.positionHistoryBySession.delete(client.sessionId);
    room.lastReconcileSentAtBySession.delete(client.sessionId);

    room.instanceManager.playerLeft(room.instanceId);
}

export function handleDispose(room: InstanceRoomHost) {
    console.log(`[InstanceRoom] Instance ${room.instanceId} disposed`);
    room.aiRuntimeById.clear();
    room.spawnRegions = [];
    room.aiSpawnRegionByNpcId.clear();
    room.customTriggersById.clear();
    room.enemyBridgeWarnCooldownByUserId.clear();
    room.enemyBridgeUnlockedByUserId.clear();
    room.heedTheWarningStayObjectiveByUserId.clear();
    room.wasInDangerByUserId.clear();
    room.dropRefineTouchByUserAndDrop.clear();
    room.dropRefineInsideByUserAndDrop.clear();
    room.dangerRegion = null;
    room.glimmerbowlUnlockedByUserId.clear();
    room.hasOwnedScarByUserId.clear();
    room.fishCombatByUserId.clear();
    room.heartsByUserId.clear();
    room.moneyByUserId.clear();
    room.defeatedByUserId.clear();
    room.harvestCooldownByUserId.clear();
    room.clientTimeOffsetByUserId?.clear();
    if (room.shopWaresByUserId) room.shopWaresByUserId.clear();
    room.harvestTargetsByObjectId.clear();
    room.chestInteractionTarget = null;
    room.playerRespawnPoint = { x: 64, y: 64 };
    if (room.timeUpdateInterval) clearInterval(room.timeUpdateInterval);
    if (room.afkCheckInterval) clearInterval(room.afkCheckInterval);
    if (room.droppedItemCleanupInterval) clearInterval(room.droppedItemCleanupInterval);
    if (room.onlineTimeInterval) clearInterval(room.onlineTimeInterval);
    if (room.statsBroadcastInterval) clearInterval(room.statsBroadcastInterval);
    room.fishCombatTimers.forEach((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
    room.fishCombatTimers.clear();
    if (room.demoTimers) {
        room.demoTimers.forEach((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
        room.demoTimers.clear();
    }
}
