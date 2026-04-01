import { Client } from "colyseus";
import { calculateWorldTime } from "@cfwk/shared";
import { GAME_TPS } from "../InstanceRoomConstants";
import { InstanceRoomHost } from "../context/InstanceRoomHost";

export function updateWorldTime(room: InstanceRoomHost) {
    const time = calculateWorldTime();
    room.state.worldTime.year = time.year;
    room.state.worldTime.season = time.season;
    room.state.worldTime.dayOfYear = time.dayOfYear;
    room.state.worldTime.dayOfSeason = time.dayOfSeason;
    room.state.worldTime.hour = time.hour;
    room.state.worldTime.minute = time.minute;
    room.state.worldTime.second = time.second;
    room.state.worldTime.brightness = time.brightness;
}

export function initializeRoomIntervals(room: InstanceRoomHost) {
    room.timeUpdateInterval = setInterval(() => {
        updateWorldTime(room);
    }, 1000);

    const afkWarnThresholdMs = 60000;
    const afkKickThresholdMs = 300000;
    const premiumAfkKickThresholdMs = 1200000;
    room.afkCheckInterval = setInterval(() => {
        const now = Date.now();
        room.clients.forEach((client: Client) => {
            const player = room.state.players.get(client.sessionId);
            if (!player) return;

            const lastActivity = room.lastActivityBySession.get(client.sessionId) ?? now;
            const idleMs = now - lastActivity;
            const threshold = player.isPremium ? premiumAfkKickThresholdMs : afkKickThresholdMs;

            if (idleMs >= afkWarnThresholdMs) {
                if (!player.isAfk) {
                    player.isAfk = true;
                    player.afkSince = lastActivity + afkWarnThresholdMs;
                }
            } else if (player.isAfk) {
                player.isAfk = false;
                player.afkSince = 0;
            }

            if (idleMs >= threshold) {
                console.log(`[InstanceRoom] AFK kick (server) for ${client.sessionId}`);
                client.leave(4000, "AFK timeout");
            }
        });
    }, 1000);

    const dropExpireMs = 5 * 60 * 1000;
    room.droppedItemCleanupInterval = setInterval(() => {
        const now = Date.now();
        room.state.droppedItems.forEach((drop, dropId) => {
            const createdAt = drop.createdAt || now;
            if (now - createdAt >= dropExpireMs) {
                room.state.droppedItems.delete(dropId);
            }
        });
    }, 15000);

    room.onlineTimeInterval = setInterval(() => {
        room.clients.forEach((client: Client) => {
            const player = room.state.players.get(client.sessionId);
            if (!player) return;
            room.incrementStat(client, player, "timeOnlineMs", 5000);
        });
    }, 5000);

    room.statsBroadcastInterval = setInterval(() => {
        room.clients.forEach((client: Client) => {
            const pending = room.pendingStatsDeltasBySession.get(client.sessionId);
            if (!pending) return;
            if (!room.hasAnyDelta(pending)) return;

            client.send("stats:delta", pending);
            room.pendingStatsDeltasBySession.set(client.sessionId, {});
        });
    }, 1000);

    room.setSimulationInterval((deltaTime) => {
        room.gameTick += 1;
        room.stepHardAuthorityMotion(deltaTime);
        room.stepAiNpcSimulation(deltaTime);
        room.stepSoftEntityCollisions(deltaTime);
        room.stepEnemySpawning();
    }, 1000 / GAME_TPS);
}
