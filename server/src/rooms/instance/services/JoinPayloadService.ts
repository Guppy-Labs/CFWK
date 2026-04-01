import { Client } from "colyseus";
import {
    DEFAULT_INVENTORY_SLOTS,
    IGuideTutorialState
} from "@cfwk/shared";
import { InstancePlayerSchema } from "../schema/InstancePlayerSchema";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import { JoinResolvedState } from "./JoinStateResolver";

export function initializeJoinedPlayerState(
    room: InstanceRoomHost,
    client: Client,
    options: { username?: string; odcid?: string },
    joinState: JoinResolvedState
) {
    const player = new InstancePlayerSchema();
    if (typeof joinState.persistedJoinX === "number" && typeof joinState.persistedJoinY === "number") {
        player.x = joinState.persistedJoinX;
        player.y = joinState.persistedJoinY;
    }
    player.username = options.username || "Guest";
    player.isPremium = joinState.isPremium;
    player.odcid = joinState.odcid;
    player.direction = 0;
    player.appearance = joinState.userAppearance;
    player.moveTs = Date.now();

    room.state.players.set(client.sessionId, player);
    room.heartsByUserId.set(joinState.odcid, joinState.initialHearts);
    room.moneyByUserId.set(joinState.odcid, joinState.initialMoney);
    room.lastActivityBySession.set(client.sessionId, Date.now());
    room.pendingStatsDeltasBySession.set(client.sessionId, {});
    room.sprintStateBySession.set(client.sessionId, false);
    room.movementRuntimeBySession.set(client.sessionId, {
        lastSeq: 0,
        lastClientTime: 0,
        lastServerTime: Date.now(),
        vx: 0,
        vy: 0,
        input: { up: false, down: false, left: false, right: false, sprint: false },
        hardAuthorityUntil: 0,
        impulseVx: 0,
        impulseVy: 0,
        impulseActiveUntil: 0
    });
    room.positionHistoryBySession.set(client.sessionId, [{
        tick: room.gameTick,
        time: Date.now(),
        x: player.x,
        y: player.y
    }]);
}

export async function sendInitialJoinPayloads(
    room: InstanceRoomHost,
    client: Client,
    joinState: JoinResolvedState
): Promise<void> {
    try {
        const { items: slots, equippedRodId, equippedUsableIds } = await room.deps.inventoryCache.getInventoryState(joinState.odcid);
        client.send("inventory", { slots, totalSlots: DEFAULT_INVENTORY_SLOTS, equippedRodId, equippedUsableIds });
    } catch (err) {
        console.error("[InstanceRoom] Error sending initial inventory:", err);
    }

    try {
        const debugNpcEnabled = await room.canUseDebugNpc();
        console.log(`[InstanceRoom] Sending initial debug NPC availability: ${debugNpcEnabled}`);
        client.send("debug:npc:availability", { enabled: debugNpcEnabled });
    } catch (err) {
        console.error("[InstanceRoom] Error sending debug NPC availability:", err);
        client.send("debug:npc:availability", { enabled: false });
    }

    room.sendPlayerHeartsSnapshot(client, joinState.initialHearts);
    room.sendPlayerMoneySnapshot(client, joinState.initialMoney);

    try {
        const { entries, unlocked } = await room.deps.glimmerbowlCache.getState(joinState.odcid);
        const hasOwnedScar = await room.hasOwnedScar(joinState.odcid);
        room.glimmerbowlUnlockedByUserId.set(joinState.odcid, unlocked);
        client.send("glimmerbowl", { entries, unlocked, hasOwnedScar });
    } catch (err) {
        console.error("[InstanceRoom] Error sending initial glimmerbowl:", err);
    }

    try {
        const advancementsState = await room.advancementsManager.getStateForUser(joinState.odcid);
        room.updateHeedTheWarningUnlockState(joinState.odcid, advancementsState);
        room.tutorialStateBySession.set(client.sessionId, advancementsState.tutorial as IGuideTutorialState);
        client.send("advancements:state", advancementsState);
    } catch (err) {
        console.error("[InstanceRoom] Error sending initial advancements state:", err);
    }
}
