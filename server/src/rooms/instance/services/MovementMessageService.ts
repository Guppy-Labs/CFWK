import { Client } from "colyseus";
import {
    AINpcKind,
    ClientMovementFrame,
    MovementInputState,
    PlayerAnim,
    ServerMovementReconcile
} from "@cfwk/shared";
import { AI_NPC_DEFINITIONS } from "../../../ai/registry";
import User from "../../../models/User";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import { InstancePlayerSchema } from "../schema/InstancePlayerSchema";
import { PositionSnapshot, RuntimeMovementState } from "../types/movement";
import { hasGameAdminCapability } from "../authority/AdminCapability";
import {
    ACCEL,
    DRAG,
    HARD_DISCREPANCY,
    HISTORY_SIZE,
    MAX_LATENCY_ESTIMATE_MS,
    MAX_LATENCY_THRESHOLD_SCALE,
    MAX_STEP_DT_MS,
    RECONCILE_INTERVAL_MS,
    SOFT_DISCREPANCY,
    PLAYER_RECOVERY_INVULNERABILITY_MS,
    SPRINT_SPEED,
    WALK_SPEED
} from "../InstanceRoomConstants";

export function registerMovementAndPresenceHandlers(room: InstanceRoomHost) {
    room.onMessage("ai:spawn", async (client, data: { kind?: AINpcKind; x?: number; y?: number }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        const isAdmin = await hasGameAdminCapability(player.odcid);
        if (!isAdmin) {
            client.send("chat", {
                username: "SYSTEM",
                odcid: "SYSTEM",
                message: "You do not have permission to spawn AI NPCs.",
                timestamp: Date.now(),
                isSystem: true
            });
            return;
        }
        const kind = data?.kind || "evil_tim";
        const spawnX = Number.isFinite(data?.x) ? Number(data.x) : ((player?.x || 0) + 48);
        const spawnY = Number.isFinite(data?.y) ? Number(data.y) : (player?.y || 0);
        const id = room.spawnAiNpc(kind, spawnX, spawnY);

        if (!id) {
            client.send("chat", {
                username: "SYSTEM",
                odcid: "SYSTEM",
                message: "Failed to spawn AI NPC.",
                timestamp: Date.now(),
                isSystem: true
            });
            return;
        }

        client.send("chat", {
            username: "SYSTEM",
            odcid: "SYSTEM",
            message: `Spawned ${kind} (${id}) chase=${AI_NPC_DEFINITIONS[kind].controllerConfig.chaseRangeMeters}m.`,
            timestamp: Date.now(),
            isSystem: true
        });
    });

    room.onMessage("movement:frame", (client, frame: ClientMovementFrame) => {
        const hasMovementInput = Boolean(
            frame?.input?.up ||
            frame?.input?.down ||
            frame?.input?.left ||
            frame?.input?.right ||
            frame?.input?.sprint
        );
        if (hasMovementInput) {
            room.markActivity(client);
        }
        handleMovementFrame(room, client, frame);
    });

    room.onMessage("position", (client, data: { x: number; y: number }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        const userId = player.odcid || client.sessionId;
        if (room.defeatedByUserId.get(userId)) return;

        const runtime = ensureRuntimeState(room, client, player);
        runtime.lastSeq += 1;
        const syntheticFrame: ClientMovementFrame = {
            seq: runtime.lastSeq,
            clientTime: Date.now(),
            x: Number(data?.x) || player.x,
            y: Number(data?.y) || player.y,
            vx: player.vx || 0,
            vy: player.vy || 0,
            speedMultiplier: 1,
            input: { up: false, down: false, left: false, right: false, sprint: false },
            anim: player.anim,
            direction: player.direction
        };
        handleMovementFrame(room, client, syntheticFrame);
    });

    room.onMessage("animation", (client, data: { anim: PlayerAnim; direction: number; isSprinting?: boolean }) => {
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        const userId = player.odcid || client.sessionId;
        if (room.defeatedByUserId.get(userId)) return;

        player.anim = data.anim;
        if (typeof data.direction === "number") {
            player.direction = data.direction;
        }
        if (typeof data.isSprinting === "boolean") {
            room.sprintStateBySession.set(client.sessionId, data.isSprinting);
        } else {
            room.sprintStateBySession.set(client.sessionId, data.anim === "run");
        }
    });

    room.onMessage("afk", (client, data: { isAfk: boolean }) => {
        const player = room.state.players.get(client.sessionId);
        if (player) {
            if (data.isAfk) {
                player.isAfk = true;
                player.afkSince = player.afkSince || Date.now();
            } else {
                room.markActivity(client);
            }
            console.log(`[InstanceRoom] Player ${client.sessionId} AFK: ${data.isAfk}`);
        }
    });

    room.onMessage("gui", (client, data: { isOpen: boolean }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (player) {
            player.isGuiOpen = data.isOpen;
        }
    });

    room.onMessage("chatFocus", (client, data: { isOpen: boolean }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (player) {
            player.isChatOpen = data.isOpen;
        }
    });

    room.onMessage("player:hearts:request", (client) => {
        room.sendPlayerHeartsSnapshot(client);
    });

    room.onMessage("player:recover", async (client) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        const userId = player.odcid || client.sessionId;
        if (!room.defeatedByUserId.get(userId)) return;

        const now = Date.now();
        const respawn = room.playerRespawnPoint ?? { x: 64, y: 64 };
        player.x = Number(respawn.x) || 64;
        player.y = Number(respawn.y) || 64;
        player.vx = 0;
        player.vy = 0;
        player.anim = "idle";
        player.isFishing = false;
        player.moveTs = now;

        const runtime = ensureRuntimeState(room, client, player);
        runtime.vx = 0;
        runtime.vy = 0;
        runtime.input = { up: false, down: false, left: false, right: false, sprint: false };
        runtime.impulseVx = 0;
        runtime.impulseVy = 0;
        runtime.impulseActiveUntil = 0;
        runtime.lastServerTime = now;
        (runtime as any).invulnerableUntil = now + PLAYER_RECOVERY_INVULNERABILITY_MS;

        const current = room.heartsByUserId.get(userId);
        const next = room.normalizeHeartsState({
            currentHearts: current?.maxHearts ?? 9,
            maxHearts: current?.maxHearts ?? 9
        });
        room.heartsByUserId.set(userId, next);
        room.defeatedByUserId.delete(userId);

        if (userId !== client.sessionId) {
            await User.updateOne(
                { _id: userId },
                {
                    $set: {
                        hearts: next,
                        lastPositionX: player.x,
                        lastPositionY: player.y
                    }
                }
            ).catch((error) => {
                console.error("[InstanceRoom] Failed to persist recovery state:", error);
            });
        }

        client.send("player:hearts", next);
        client.send("player:recovered", {
            x: player.x,
            y: player.y,
            invulnerableUntil: (runtime as any).invulnerableUntil
        });
        sendMovementReconcile(room, client, player, runtime.lastSeq, "hard-server", true, 0, "recovered");
    });

    room.onMessage("shove", (client, data: { targetSessionId: string; clientTime?: number }) => {
        room.markActivity(client);
        const attacker = room.state.players.get(client.sessionId);
        const target = room.state.players.get(data.targetSessionId);

        if (!attacker || !target) {
            console.log("[InstanceRoom] Shove failed: invalid players");
            return;
        }
        if (room.defeatedByUserId.get(attacker.odcid || client.sessionId)) return;
        if (room.defeatedByUserId.get(target.odcid || data.targetSessionId)) return;

        if (target.isAfk) {
            console.log("[InstanceRoom] Shove rejected: target is AFK-ghosted");
            return;
        }

        const now = Date.now();
        const latencyMs = Number.isFinite(data?.clientTime) ? clampNumber(now - Number(data.clientTime), 0, 250) : 0;
        const rewindTime = now - latencyMs;
        const rewoundAttacker = getSnapshotAtTime(room, client.sessionId, rewindTime);
        const rewoundTarget = getSnapshotAtTime(room, data.targetSessionId, rewindTime);

        const attackerX = rewoundAttacker?.x ?? attacker.x;
        const attackerY = rewoundAttacker?.y ?? attacker.y;
        const targetX = rewoundTarget?.x ?? target.x;
        const targetY = rewoundTarget?.y ?? target.y;

        const dx = targetX - attackerX;
        const dy = targetY - attackerY;
        const distance = Math.hypot(dx, dy);
        const maxShoveDistance = 60;
        if (distance > maxShoveDistance) {
            console.log(`[InstanceRoom] Shove rejected: too far (${distance}px)`);
            return;
        }

        const length = Math.max(distance, 1);
        const dirX = dx / length;
        const dirY = dy / length;
        const shoveVelocity = 300;
        const impulseDurationMs = 180;

        applyServerImpulse(room, data.targetSessionId, dirX * shoveVelocity, dirY * shoveVelocity, impulseDurationMs, client.sessionId);
        room.broadcast("shove", {
            attackerSessionId: client.sessionId,
            targetSessionId: data.targetSessionId
        });
        console.log(`[InstanceRoom] ${attacker.username} shoved ${target.username}`);
    });

    room.onMessage("shoveAttempt", (client, data: { targetSessionId: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);
        if (player && room.defeatedByUserId.get(player.odcid || client.sessionId)) return;
        room.broadcast("shoveAttempt", {
            attackerSessionId: client.sessionId,
            targetSessionId: data.targetSessionId
        });
    });
}

export function stepHardAuthorityMotion(room: InstanceRoomHost, deltaTimeMs: number) {
    const now = Date.now();
    const dtSec = clampNumber(deltaTimeMs / 1000, 0.001, 0.12);

    room.clients.forEach((client: Client) => {
        const player = room.state.players.get(client.sessionId);
        if (!player) return;
        const runtime = room.movementRuntimeBySession.get(client.sessionId);
        if (!runtime) return;
        const userId = player.odcid || client.sessionId;
        if (room.defeatedByUserId.get(userId)) {
            player.vx = 0;
            player.vy = 0;
            runtime.vx = 0;
            runtime.vy = 0;
            return;
        }
        if (now >= runtime.hardAuthorityUntil) return;

        const prevX = player.x;
        const prevY = player.y;

        runtime.vx *= 0.9;
        runtime.vy *= 0.9;
        player.x += runtime.vx * dtSec;
        player.y += runtime.vy * dtSec;
        player.vx = runtime.vx;
        player.vy = runtime.vy;
        player.moveTs = now;

        const movedDistance = Math.hypot(player.x - prevX, player.y - prevY);
        if (movedDistance > 0.01) {
            const isSprinting = room.sprintStateBySession.get(client.sessionId) === true || player.anim === "run";
            if (isSprinting) {
                room.incrementStat(client, player, "distanceRan", movedDistance);
            } else {
                room.incrementStat(client, player, "distanceWalked", movedDistance);
            }
        }

        recordPositionSnapshot(room, client.sessionId, player.x, player.y, now);
        sendMovementReconcile(room, client, player, runtime.lastSeq, "hard-server", false, 0, "external-force");
    });
}

export function ensureRuntimeState(room: InstanceRoomHost, client: Client, player: InstancePlayerSchema): RuntimeMovementState {
    const existing = room.movementRuntimeBySession.get(client.sessionId);
    if (existing) return existing;

    const runtime: RuntimeMovementState = {
        lastSeq: 0,
        lastClientTime: 0,
        lastServerTime: Date.now(),
        vx: player.vx || 0,
        vy: player.vy || 0,
        input: { up: false, down: false, left: false, right: false, sprint: false },
        hardAuthorityUntil: 0,
        impulseVx: 0,
        impulseVy: 0,
        impulseActiveUntil: 0
    };
    room.movementRuntimeBySession.set(client.sessionId, runtime);
    return runtime;
}

export function sanitizeMovementInput(input?: Partial<MovementInputState>): MovementInputState {
    return {
        up: input?.up === true,
        down: input?.down === true,
        left: input?.left === true,
        right: input?.right === true,
        sprint: input?.sprint === true
    };
}

export function predictKinematicStep(
    baseX: number,
    baseY: number,
    baseVx: number,
    baseVy: number,
    input: MovementInputState,
    dtSec: number,
    speedMultiplier = 1
) {
    let moveX = 0;
    let moveY = 0;
    if (input.left) moveX -= 1;
    if (input.right) moveX += 1;
    if (input.up) moveY -= 1;
    if (input.down) moveY += 1;

    const len = Math.hypot(moveX, moveY);
    if (len > 0) {
        moveX /= len;
        moveY /= len;
    }

    const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
    const speedScale = clampNumber(speedMultiplier, 0.35, 1.2);
    const targetVx = moveX * speed * speedScale;
    const targetVy = moveY * speed * speedScale;

    let nextVx = baseVx;
    let nextVy = baseVy;
    if (len > 0) {
        nextVx = baseVx + (targetVx - baseVx) * ACCEL;
        nextVy = baseVy + (targetVy - baseVy) * ACCEL;
    } else {
        nextVx = baseVx * (1 - DRAG);
        nextVy = baseVy * (1 - DRAG);
    }

    return {
        x: baseX + nextVx * dtSec,
        y: baseY + nextVy * dtSec,
        vx: nextVx,
        vy: nextVy
    };
}

export function handleMovementFrame(room: InstanceRoomHost, client: Client, frame: ClientMovementFrame) {
    const player = room.state.players.get(client.sessionId);
    if (!player) return;

    const runtime = ensureRuntimeState(room, client, player);
    const userId = player.odcid || client.sessionId;
    if (room.defeatedByUserId.get(userId)) {
        player.vx = 0;
        player.vy = 0;
        player.anim = "idle";
        player.moveTs = Date.now();
        runtime.vx = 0;
        runtime.vy = 0;
        runtime.input = { up: false, down: false, left: false, right: false, sprint: false };
        runtime.impulseVx = 0;
        runtime.impulseVy = 0;
        runtime.impulseActiveUntil = 0;
        runtime.lastServerTime = Date.now();
        sendMovementReconcile(room, client, player, runtime.lastSeq, "hard-server", true, 0, "defeated-locked");
        return;
    }
    if (player.isFishing) {
        player.vx = 0;
        player.vy = 0;
        player.anim = "idle";
        player.moveTs = Date.now();
        runtime.vx = 0;
        runtime.vy = 0;
        runtime.input = { up: false, down: false, left: false, right: false, sprint: false };
        runtime.impulseVx = 0;
        runtime.impulseVy = 0;
        runtime.impulseActiveUntil = 0;
        runtime.lastServerTime = Date.now();
        sendMovementReconcile(room, client, player, runtime.lastSeq, "hard-server", false, 0, "fishing-locked");
        return;
    }
    if (!Number.isFinite(frame?.seq) || frame.seq <= runtime.lastSeq) {
        return;
    }

    const now = Date.now();
    const input = sanitizeMovementInput(frame.input);
    const speedMultiplier = Number.isFinite(frame.speedMultiplier) ? frame.speedMultiplier : 1;
    const dtMs = clampNumber(now - runtime.lastServerTime, 8, MAX_STEP_DT_MS);
    const dtSec = dtMs / 1000;

    const expected = predictKinematicStep(player.x, player.y, runtime.vx, runtime.vy, input, dtSec, speedMultiplier);

    const hasActiveImpulse = now < runtime.impulseActiveUntil &&
        (Math.abs(runtime.impulseVx) > 0.5 || Math.abs(runtime.impulseVy) > 0.5);
    const inputOnlyVx = expected.vx;
    const inputOnlyVy = expected.vy;
    if (hasActiveImpulse) {
        expected.x += runtime.impulseVx * dtSec;
        expected.y += runtime.impulseVy * dtSec;
        const decayFactor = Math.pow(0.88, dtMs / 16.667);
        runtime.impulseVx *= decayFactor;
        runtime.impulseVy *= decayFactor;
        if (Math.abs(runtime.impulseVx) < 0.5) runtime.impulseVx = 0;
        if (Math.abs(runtime.impulseVy) < 0.5) runtime.impulseVy = 0;
    }

    const clientX = Number.isFinite(frame.x) ? frame.x : expected.x;
    const clientY = Number.isFinite(frame.y) ? frame.y : expected.y;
    const clientVx = Number.isFinite(frame.vx) ? frame.vx : expected.vx;
    const clientVy = Number.isFinite(frame.vy) ? frame.vy : expected.vy;

    const errorDistance = Math.hypot(clientX - expected.x, clientY - expected.y);
    const estimatedLatencyMs = estimateClientLatencyMs(frame, now);
    const latencyThresholdScale = getLatencyThresholdScale(estimatedLatencyMs);
    const softBaseThreshold = hasActiveImpulse ? SOFT_DISCREPANCY * 3 : SOFT_DISCREPANCY;
    const hardBaseThreshold = hasActiveImpulse ? HARD_DISCREPANCY * 2.5 : HARD_DISCREPANCY;
    const softThreshold = softBaseThreshold * latencyThresholdScale;
    const hardThreshold = hardBaseThreshold * latencyThresholdScale;
    const isSpawnBootstrap = runtime.lastSeq === 0 && player.x === 0 && player.y === 0 && frame.seq === 1;

    let nextX = expected.x;
    let nextY = expected.y;
    let nextVx = expected.vx;
    let nextVy = expected.vy;
    let authority: ServerMovementReconcile["authority"] = "soft-client";
    let hardOverride = false;
    let reason = "soft-accept";

    if (isSpawnBootstrap) {
        nextX = clientX;
        nextY = clientY;
        nextVx = clientVx;
        nextVy = clientVy;
        authority = "soft-client";
        reason = "spawn-bootstrap";
    } else if (errorDistance <= softThreshold) {
        nextX = clientX;
        nextY = clientY;
        nextVx = clientVx;
        nextVy = clientVy;
        authority = "soft-client";
        reason = "soft-accept";
    } else if (errorDistance <= hardThreshold) {
        nextX = lerpNumber(expected.x, clientX, 0.35);
        nextY = lerpNumber(expected.y, clientY, 0.35);
        nextVx = lerpNumber(expected.vx, clientVx, 0.35);
        nextVy = lerpNumber(expected.vy, clientVy, 0.35);
        authority = "soft-client";
        reason = "soft-correct";
    } else {
        authority = "hard-server";
        hardOverride = true;
        reason = "speed-clamp";
    }

    const prevX = player.x;
    const prevY = player.y;

    player.x = nextX;
    player.y = nextY;
    player.vx = nextVx;
    player.vy = nextVy;
    player.moveTs = now;

    runtime.vx = hasActiveImpulse ? inputOnlyVx : nextVx;
    runtime.vy = hasActiveImpulse ? inputOnlyVy : nextVy;
    runtime.input = input;
    runtime.lastSeq = frame.seq;
    runtime.lastClientTime = Number.isFinite(frame.clientTime) ? frame.clientTime : now;
    runtime.lastServerTime = now;

    const isSprintingNow = input.sprint || frame.anim === "run";
    room.sprintStateBySession.set(client.sessionId, isSprintingNow);

    const movedDistance = Math.hypot(nextX - prevX, nextY - prevY);
    if (movedDistance > 0.01) {
        if (isSprintingNow) {
            room.incrementStat(client, player, "distanceRan", movedDistance);
        } else {
            room.incrementStat(client, player, "distanceWalked", movedDistance);
        }
    }

    if (typeof frame.anim === "string") {
        player.anim = frame.anim;
    }
    if (typeof frame.direction === "number") {
        player.direction = frame.direction;
    }

    recordPositionSnapshot(room, client.sessionId, nextX, nextY, now);
    room.tryRefineDropsFromMovement(client, player, nextX, nextY, now);
    room.handleEnemyBridgeGate(client, player, nextX, nextY);
    room.handleDangerExitHeal(client, player, nextX, nextY);
    const clientTimeOffsetMs = Number(room.clientTimeOffsetByUserId?.get(player.odcid) ?? 0);
    void room.advancementsManager.onPlayerMoved(player.odcid, nextX, nextY, clientTimeOffsetMs)
        .then((alerts: any[]) => {
            alerts.forEach((alert) => client.send("advancement:alert", alert));
        })
        .catch((error: unknown) => {
            console.error("[InstanceRoom] region advancements failed:", error);
        });
    sendMovementReconcile(room, client, player, frame.seq, authority, hardOverride, errorDistance, reason, hardThreshold);
}

export function sendMovementReconcile(
    room: InstanceRoomHost,
    client: Client,
    player: InstancePlayerSchema,
    seqAck: number,
    authority: ServerMovementReconcile["authority"],
    hardOverride: boolean,
    errorDistance: number,
    reason?: string,
    hardThreshold?: number
) {
    const now = Date.now();
    const lastSentAt = room.lastReconcileSentAtBySession.get(client.sessionId) || 0;
    if (!hardOverride && now - lastSentAt < RECONCILE_INTERVAL_MS) {
        return;
    }

    const payload: ServerMovementReconcile = {
        seqAck,
        serverTick: room.gameTick,
        serverTime: now,
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        authority,
        hardOverride,
        errorDistance,
        hardThreshold,
        reason
    };
    client.send("movement:reconcile", payload);
    room.lastReconcileSentAtBySession.set(client.sessionId, now);
}

export function estimateClientLatencyMs(frame: ClientMovementFrame, now: number): number {
    if (!Number.isFinite(frame?.clientTime)) return 0;
    const delta = now - Number(frame.clientTime);
    if (!Number.isFinite(delta)) return 0;
    return clampNumber(delta, 0, MAX_LATENCY_ESTIMATE_MS);
}

export function getLatencyThresholdScale(latencyMs: number): number {
    const normalized = clampNumber(latencyMs / 220, 0, 1);
    return 1 + normalized * (MAX_LATENCY_THRESHOLD_SCALE - 1);
}

export function recordPositionSnapshot(room: InstanceRoomHost, sessionId: string, x: number, y: number, time: number) {
    const history = room.positionHistoryBySession.get(sessionId) || [];
    history.push({ tick: room.gameTick, time, x, y });
    if (history.length > HISTORY_SIZE) {
        history.splice(0, history.length - HISTORY_SIZE);
    }
    room.positionHistoryBySession.set(sessionId, history);
}

export function getSnapshotAtTime(room: InstanceRoomHost, sessionId: string, timestamp: number): PositionSnapshot | null {
    const history = room.positionHistoryBySession.get(sessionId);
    if (!history || history.length === 0) return null;

    if (timestamp <= history[0].time) {
        return history[0];
    }

    const last = history[history.length - 1];
    if (timestamp >= last.time) {
        return last;
    }

    for (let i = 1; i < history.length; i += 1) {
        const prev = history[i - 1];
        const next = history[i];
        if (timestamp < prev.time || timestamp > next.time) continue;

        const span = Math.max(1, next.time - prev.time);
        const t = clampNumber((timestamp - prev.time) / span, 0, 1);
        return {
            tick: next.tick,
            time: timestamp,
            x: lerpNumber(prev.x, next.x, t),
            y: lerpNumber(prev.y, next.y, t)
        };
    }

    return last;
}

export function applyServerImpulse(
    room: InstanceRoomHost,
    sessionId: string,
    vx: number,
    vy: number,
    durationMs: number,
    sourceSessionId: string,
    options?: { accumulate?: boolean; recoveryTailMs?: number }
) {
    const player = room.state.players.get(sessionId);
    if (!player) return;
    const userId = player.odcid || sessionId;
    if (room.defeatedByUserId.get(userId)) return;

    const now = Date.now();

    const runtime = room.movementRuntimeBySession.get(sessionId) || {
        lastSeq: 0,
        lastClientTime: 0,
        lastServerTime: now,
        vx: player.vx || 0,
        vy: player.vy || 0,
        input: { up: false, down: false, left: false, right: false, sprint: false },
        hardAuthorityUntil: 0,
        impulseVx: 0,
        impulseVy: 0,
        impulseActiveUntil: 0
    };
    room.movementRuntimeBySession.set(sessionId, runtime);

    if (options?.accumulate === false) {
        runtime.impulseVx = vx;
        runtime.impulseVy = vy;
    } else {
        runtime.impulseVx += vx;
        runtime.impulseVy += vy;
    }
    const recoveryTailMs = clampNumber(options?.recoveryTailMs ?? 500, 0, 2000);
    runtime.impulseActiveUntil = Math.max(runtime.impulseActiveUntil, now + durationMs + recoveryTailMs);
    runtime.lastServerTime = now;

    player.moveTs = now;
    recordPositionSnapshot(room, sessionId, player.x, player.y, now);

    const targetClient = room.clients.find((entry: Client) => entry.sessionId === sessionId);
    if (targetClient) {
        targetClient.send("movement:impulse", {
            sourceSessionId,
            vx,
            vy,
            durationMs,
            authority: "soft-client",
            serverTick: room.gameTick,
            serverTime: now
        });
    }
}

export function clampNumber(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function lerpNumber(a: number, b: number, t: number): number {
    const alpha = clampNumber(t, 0, 1);
    return a + (b - a) * alpha;
}
