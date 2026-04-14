import { Client } from "colyseus";
import {
    AINpcKind,
    DEFAULT_PLAYER_HEARTS_STATE,
    getItemDefinition,
    IPlayerHeartsState,
    SOFT_COLLISION_FORCE,
    SOFT_COLLISION_PLAYER_FOOT_HITBOX
} from "@cfwk/shared";
import User from "../../../models/User";
import { AI_METERS_TO_PIXELS, AI_NPC_DEFINITIONS, getAiControllerById } from "../../../ai/registry";
import { AiNpcRuntimeState } from "../../../ai/types";
import { InstanceRoomHost } from "../context/InstanceRoomHost";
import { InstanceAiNpcSchema } from "../schema/InstanceAiNpcSchema";
import { SoftCollisionBody, SpawnRegionRuntime } from "../InstanceRoomSchema";
import { getRandomPointInSpawnRegion } from "../InstanceRoomMapRuntime";
import {
    AI_TO_AI_COLLISION_MAX_PUSH_PER_STEP,
    AI_TO_AI_COLLISION_MIN_PUSH_PER_STEP,
    ENEMY_MELEE_KNOCKBACK_DURATION_MS,
    ENEMY_MELEE_KNOCKBACK_RECOVERY_TAIL_MS,
    ENEMY_MELEE_KNOCKBACK_SPEED,
    GREMLIN_DEATH_ANIM_MS,
    SPRINT_SPEED
} from "../InstanceRoomConstants";

export function stepEnemySpawning(room: InstanceRoomHost) {
    if (room.spawnRegions.length === 0) return;

    const now = Date.now();
    room.spawnRegions.forEach((region: SpawnRegionRuntime) => {
        Array.from(region.aliveNpcIds).forEach((npcId) => {
            if (room.aiRuntimeById.has(npcId)) return;
            region.aliveNpcIds.delete(npcId);
            room.aiSpawnRegionByNpcId.delete(npcId);
        });

        if (region.aliveNpcIds.size >= region.maxSpawned) return;
        if (now < region.nextSpawnAtMs) return;

        const spawned = trySpawnFromRegion(room, region);
        if (!spawned) {
            region.nextSpawnAtMs = now + 1000;
            return;
        }

        if (region.aliveNpcIds.size < region.maxSpawned) {
            region.nextSpawnAtMs = now + 250;
        }
    });
}

export function trySpawnFromRegion(room: InstanceRoomHost, region: SpawnRegionRuntime): boolean {
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const point = getRandomPointInSpawnRegion(region);
        if (!point) continue;
        if (!isSpawnPointValid(room, region.npcKind, point.x, point.y)) continue;

        const id = spawnAiNpc(room, region.npcKind, point.x, point.y, region);
        if (id) return true;
    }
    return false;
}

export function isSpawnPointValid(room: InstanceRoomHost, kind: AINpcKind, x: number, y: number): boolean {
    const definition = AI_NPC_DEFINITIONS[kind];
    if (!definition) return false;

    const path = room.navService.findPath({ x, y }, { x, y }, definition.hitbox);
    if (!Array.isArray(path) || path.length === 0) return false;
    const first = path[0];
    if (Math.hypot(first.x - x, first.y - y) > 18) return false;

    for (const runtime of room.aiRuntimeById.values()) {
        const minDistance = ((definition.hitbox.width + runtime.hitbox.width) * 0.5) + 4;
        if (Math.hypot(runtime.x - x, runtime.y - y) < minDistance) return false;
    }
    return true;
}

export function scheduleRegionRespawn(region: SpawnRegionRuntime) {
    const jitter = 0.5 + Math.random();
    const delayMs = Math.max(250, Math.floor(region.restoreRateMs * jitter));
    region.nextSpawnAtMs = Date.now() + delayMs;
}

export function tryEnemyMeleeAttack(room: InstanceRoomHost, attacker: AiNpcRuntimeState, targetSessionId: string, damageHearts: number) {
    if (!Number.isFinite(damageHearts) || damageHearts <= 0) return;
    if (attacker.isDead) return;

    const player = room.state.players.get(targetSessionId);
    if (!player) return;
    const userId = player.odcid || targetSessionId;
    if (room.defeatedByUserId.get(userId)) return;

    const now = Date.now();
    if (didPlayerDodgeMeleeAttack(room, targetSessionId, now)) return;

    const targetDx = player.x - attacker.x;
    const targetDy = player.y - attacker.y;
    const distance = Math.hypot(targetDx, targetDy);
    const pushDirX = distance > 0.001 ? targetDx / distance : 1;
    const pushDirY = distance > 0.001 ? targetDy / distance : 0;
    room.applyServerImpulse(
        targetSessionId,
        pushDirX * ENEMY_MELEE_KNOCKBACK_SPEED,
        pushDirY * ENEMY_MELEE_KNOCKBACK_SPEED,
        ENEMY_MELEE_KNOCKBACK_DURATION_MS,
        attacker.id,
        { accumulate: false, recoveryTailMs: ENEMY_MELEE_KNOCKBACK_RECOVERY_TAIL_MS }
    );
    applyDamageToPlayerHearts(room, targetSessionId, Math.floor(damageHearts));
}

export function didPlayerDodgeMeleeAttack(room: InstanceRoomHost, targetSessionId: string, now: number): boolean {
    const runtime = room.movementRuntimeBySession.get(targetSessionId) as (any | undefined);
    const player = room.state.players.get(targetSessionId) as (any | undefined);
    const candidates = [
        runtime?.dodgeUntil,
        runtime?.dodgeActiveUntil,
        runtime?.iFrameUntil,
        runtime?.invulnerableUntil,
        player?.dodgeUntil,
        player?.iFrameUntil,
        player?.invulnerableUntil
    ];

    return candidates.some((value) => Number.isFinite(value) && Number(value) > now);
}

export function applyDamageToPlayerHearts(room: InstanceRoomHost, targetSessionId: string, damageHearts: number) {
    if (!Number.isFinite(damageHearts) || damageHearts <= 0) return;

    const player = room.state.players.get(targetSessionId);
    if (!player) return;

    const userId = player.odcid || targetSessionId;
    if (room.defeatedByUserId.get(userId)) return;
    const current = room.heartsByUserId.get(userId) ?? { ...DEFAULT_PLAYER_HEARTS_STATE };
    if (current.currentHearts <= 0) return;
    const next = room.normalizeHeartsState({
        currentHearts: current.currentHearts - Math.floor(damageHearts),
        maxHearts: current.maxHearts
    });

    room.heartsByUserId.set(userId, next);
    const client = room.clients.find((entry: Client) => entry.sessionId === targetSessionId);
    const now = Date.now();
    if (current.currentHearts > 0 && next.currentHearts <= 0) {
        room.defeatedByUserId.set(userId, {
            defeatedAt: now,
            reason: "hearts_depleted"
        });
        room.aiRuntimeById.forEach((runtime: AiNpcRuntimeState) => {
            if (runtime.targetSessionId === targetSessionId) {
                runtime.targetSessionId = undefined;
                runtime.mode = "idle";
                runtime.chasePath = [];
                runtime.chasePathIndex = 0;
            }
            if (runtime.pendingMeleeTargetSessionId === targetSessionId) {
                runtime.pendingMeleeTargetSessionId = undefined;
                runtime.pendingMeleeTriggerAtMs = undefined;
                runtime.pendingMeleeDamageHearts = undefined;
            }
        });

        player.isFishing = false;
        player.vx = 0;
        player.vy = 0;
        player.anim = "idle";
        player.moveTs = now;

        const runtime = room.movementRuntimeBySession.get(targetSessionId);
        if (runtime) {
            runtime.vx = 0;
            runtime.vy = 0;
            runtime.input = { up: false, down: false, left: false, right: false, sprint: false };
            runtime.impulseVx = 0;
            runtime.impulseVy = 0;
            runtime.impulseActiveUntil = 0;
            runtime.lastServerTime = now;
        }
    }

    if (client) {
        client.send("player:hearts", next);
        if (next.currentHearts <= 0) {
            client.send("player:defeat", {
                reason: "hearts_depleted",
                defeatedAt: now
            });
            const runtime = room.movementRuntimeBySession.get(targetSessionId);
            room.sendMovementReconcile(
                client,
                player,
                runtime?.lastSeq ?? 0,
                "hard-server",
                true,
                0,
                "defeated"
            );
        }
    }

    if (userId !== targetSessionId) {
        User.updateOne({ _id: userId }, { $set: { hearts: next } }).catch((error) => {
            console.error("[InstanceRoom] Failed to persist enemy melee heart damage:", error);
        });
    }
}

export function applyEnemyDamage(room: InstanceRoomHost, aiId: string, damageAmount: number): boolean {
    if (!Number.isFinite(damageAmount) || damageAmount <= 0) return false;

    const runtime = room.aiRuntimeById.get(aiId);
    const schema = room.state.aiNpcs.get(aiId);
    if (!runtime || !schema || runtime.isDead) return false;

    runtime.currentHealth = Math.max(0, runtime.currentHealth - Math.floor(damageAmount));
    schema.currentHealth = runtime.currentHealth;

    if (runtime.currentHealth > 0) return true;

    runtime.isDead = true;
    runtime.vx = 0;
    runtime.vy = 0;
    runtime.attackAnimUntilMs = 0;
    runtime.pendingMeleeTargetSessionId = undefined;
    runtime.pendingMeleeTriggerAtMs = undefined;
    runtime.pendingMeleeDamageHearts = undefined;
    runtime.deathAnimUntilMs = Date.now() + GREMLIN_DEATH_ANIM_MS;
    runtime.anim = "death";
    schema.vx = 0;
    schema.vy = 0;
    schema.anim = "death";
    schema.moveTs = Date.now();
    spawnNpcLootDrops(room, runtime.kind, runtime.x, runtime.y);
    return true;
}

export function applyEnemyKnockbackFromFishLaunch(
    room: InstanceRoomHost,
    aiId: string,
    launchFromX: number,
    launchFromY: number,
    damageAmount: number
): void {
    const runtime = room.aiRuntimeById.get(aiId);
    const schema = room.state.aiNpcs.get(aiId);
    if (!runtime || !schema || runtime.isDead) return;

    const dx = runtime.x - launchFromX;
    const dy = runtime.y - launchFromY;
    const distance = Math.hypot(dx, dy);
    const dirX = distance > 0.001 ? dx / distance : 1;
    const dirY = distance > 0.001 ? dy / distance : 0;
    const knockbackPx = Math.max(6, Math.min(20, 6 + damageAmount * 0.16));
    const nextX = runtime.x + dirX * knockbackPx;
    const nextY = runtime.y + dirY * knockbackPx;
    const now = Date.now();

    runtime.x = nextX;
    runtime.y = nextY;
    runtime.vx = dirX * Math.min(80, knockbackPx * 5);
    runtime.vy = dirY * Math.min(80, knockbackPx * 5);
    runtime.moveTs = now;

    schema.x = nextX;
    schema.y = nextY;
    schema.vx = runtime.vx;
    schema.vy = runtime.vy;
    schema.moveTs = now;
}

export function despawnAiNpc(room: InstanceRoomHost, id: string) {
    room.state.aiNpcs.delete(id);
    room.aiRuntimeById.delete(id);

    const spawnRegion = room.aiSpawnRegionByNpcId.get(id);
    if (spawnRegion) {
        spawnRegion.aliveNpcIds.delete(id);
        scheduleRegionRespawn(spawnRegion);
        room.aiSpawnRegionByNpcId.delete(id);
    }
}

export function stepAiNpcSimulation(room: InstanceRoomHost, deltaTimeMs: number) {
    if (room.aiRuntimeById.size === 0) return;

    const now = Date.now();
    const deltaSec = room.clampNumber(deltaTimeMs / 1000, 0.001, 0.2);
    const despawnIds: string[] = [];
    const players: Array<{ sessionId: string; x: number; y: number }> = [];
    room.state.players.forEach((player: any, sessionId: string) => {
        const userId = player?.odcid || sessionId;
        if (room.defeatedByUserId.get(userId)) return;
        players.push({ sessionId, x: player.x, y: player.y });
    });

    room.aiRuntimeById.forEach((runtime: AiNpcRuntimeState, id: string) => {
        if (runtime.isDead && runtime.deathAnimUntilMs > 0 && now >= runtime.deathAnimUntilMs) {
            despawnIds.push(id);
            return;
        }

        const controller = getAiControllerById(runtime.controllerId);
        if (!controller) return;

        controller.update(runtime, {
            tick: room.gameTick,
            now,
            deltaSec,
            metersToPixels: (meters) => meters * AI_METERS_TO_PIXELS,
            players,
            nav: room.navService,
            random: () => Math.random(),
            onMeleeAttackAttempt: (attacker, targetSessionId, damageHearts) => {
                tryEnemyMeleeAttack(room, attacker, targetSessionId, damageHearts);
            }
        });

        const schema = room.state.aiNpcs.get(id);
        if (!schema) return;

        schema.x = runtime.x;
        schema.y = runtime.y;
        schema.vx = runtime.vx;
        schema.vy = runtime.vy;
        schema.moveTs = runtime.moveTs || now;
        schema.direction = runtime.direction;
        schema.anim = runtime.anim;
        schema.tint = runtime.tint;
        schema.currentHealth = runtime.currentHealth;
        schema.maxHealth = runtime.maxHealth;
        schema.pathDebug = runtime.chasePath.length > 0
            ? runtime.chasePath.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join(";")
            : "";
    });

    despawnIds.forEach((id) => despawnAiNpc(room, id));
}

export function stepSoftEntityCollisions(room: InstanceRoomHost, deltaTimeMs: number) {
    const dtSec = room.clampNumber(deltaTimeMs / 1000, 0.001, 0.12);
    const now = Date.now();
    const bodies: SoftCollisionBody[] = [];

    room.state.players.forEach((player: any, sessionId: string) => {
        if (player.isAfk) return;
        if (player.isFishing) return;
        if (player.x === 0 && player.y === 0) return;
        const userId = player?.odcid || sessionId;
        if (room.defeatedByUserId.get(userId)) return;

        bodies.push({
            id: sessionId,
            kind: "player",
            x: player.x,
            y: player.y,
            halfWidth: SOFT_COLLISION_PLAYER_FOOT_HITBOX.width / 2,
            halfHeight: SOFT_COLLISION_PLAYER_FOOT_HITBOX.height / 2,
            pushX: 0,
            pushY: 0
        });
    });

    room.aiRuntimeById.forEach((runtime: AiNpcRuntimeState, id: string) => {
        bodies.push({
            id,
            kind: "ai",
            x: runtime.x,
            y: runtime.y,
            halfWidth: Math.max(1, runtime.hitbox.width) / 2,
            halfHeight: Math.max(1, runtime.hitbox.collidableHeight || runtime.hitbox.height) / 2,
            pushX: 0,
            pushY: 0
        });
    });

    if (bodies.length < 2) return;

    for (let i = 0; i < bodies.length; i += 1) {
        const a = bodies[i];
        for (let j = i + 1; j < bodies.length; j += 1) {
            const b = bodies[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            const overlapX = (a.halfWidth + b.halfWidth) - absDx;
            const overlapY = (a.halfHeight + b.halfHeight) - absDy;
            if (overlapX <= 0 || overlapY <= 0) continue;

            let dirX = dx;
            let dirY = dy;
            const dist = Math.hypot(dirX, dirY);
            if (dist > SOFT_COLLISION_FORCE.epsilon) {
                dirX /= dist;
                dirY /= dist;
            } else {
                dirX = a.id < b.id ? 1 : -1;
                dirY = 0;
            }

            const minOverlap = Math.min(overlapX, overlapY);
            const overlapRatio = Math.min(
                overlapX / Math.max(1, a.halfWidth + b.halfWidth),
                overlapY / Math.max(1, a.halfHeight + b.halfHeight)
            );
            const pushMagnitude = room.clampNumber(
                minOverlap * SOFT_COLLISION_FORCE.pushScalar * (0.45 + overlapRatio * 0.55),
                0,
                SOFT_COLLISION_FORCE.maxPushPerStep
            );
            const bothAi = a.kind === "ai" && b.kind === "ai";
            const adjustedPushMagnitude = bothAi
                ? room.clampNumber(
                    Math.max(AI_TO_AI_COLLISION_MIN_PUSH_PER_STEP, pushMagnitude * 1.2),
                    0,
                    AI_TO_AI_COLLISION_MAX_PUSH_PER_STEP
                )
                : pushMagnitude;

            const pushX = dirX * adjustedPushMagnitude;
            const pushY = dirY * adjustedPushMagnitude;
            a.pushX -= pushX * 0.5;
            a.pushY -= pushY * 0.5;
            b.pushX += pushX * 0.5;
            b.pushY += pushY * 0.5;
        }
    }

    bodies.forEach((body) => {
        const pushLen = Math.hypot(body.pushX, body.pushY);
        if (pushLen < SOFT_COLLISION_FORCE.epsilon) return;

        const velocityPushX = (body.pushX / dtSec) * SOFT_COLLISION_FORCE.velocityTransfer;
        const velocityPushY = (body.pushY / dtSec) * SOFT_COLLISION_FORCE.velocityTransfer;

        if (body.kind === "player") {
            const player = room.state.players.get(body.id);
            if (!player || player.isAfk) return;

            player.x += body.pushX;
            player.y += body.pushY;
            player.vx = room.clampNumber((player.vx || 0) + velocityPushX, -SPRINT_SPEED, SPRINT_SPEED);
            player.vy = room.clampNumber((player.vy || 0) + velocityPushY, -SPRINT_SPEED, SPRINT_SPEED);
            player.moveTs = now;

            const runtime = room.movementRuntimeBySession.get(body.id);
            if (runtime) {
                runtime.impulseVx += velocityPushX;
                runtime.impulseVy += velocityPushY;
                runtime.impulseActiveUntil = Math.max(runtime.impulseActiveUntil, now + 120);
                runtime.lastServerTime = now;
            }

            room.recordPositionSnapshot(body.id, player.x, player.y, now);

            const client = room.clients.find((entry: Client) => entry.sessionId === body.id);
            if (client) {
                room.sendMovementReconcile(client, player, runtime?.lastSeq ?? 0, "hard-server", false, 0, "soft-collision");
            }
            return;
        }

        const runtime = room.aiRuntimeById.get(body.id);
        const schema = room.state.aiNpcs.get(body.id);
        if (!runtime || !schema) return;

        runtime.x += body.pushX;
        runtime.y += body.pushY;
        runtime.vx += velocityPushX;
        runtime.vy += velocityPushY;
        runtime.moveTs = now;

        schema.x = runtime.x;
        schema.y = runtime.y;
        schema.vx = runtime.vx;
        schema.vy = runtime.vy;
        schema.moveTs = runtime.moveTs;
    });
}

export function spawnAiNpc(room: InstanceRoomHost, kind: AINpcKind, x: number, y: number, spawnRegion?: SpawnRegionRuntime): string | null {
    const definition = AI_NPC_DEFINITIONS[kind];
    if (!definition) return null;

    const id = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const npcSchema = new InstanceAiNpcSchema();
    npcSchema.id = id;
    npcSchema.kind = definition.kind;
    npcSchema.controllerId = definition.controllerId;
    npcSchema.x = x;
    npcSchema.y = y;
    npcSchema.vx = 0;
    npcSchema.vy = 0;
    npcSchema.moveTs = Date.now();
    npcSchema.direction = 0;
    npcSchema.anim = "idle";
    npcSchema.tint = definition.tint;
    npcSchema.currentHealth = definition.maxHealth;
    npcSchema.maxHealth = definition.maxHealth;
    npcSchema.pathDebug = "";
    npcSchema.hitbox.width = definition.hitbox.width;
    npcSchema.hitbox.height = definition.hitbox.height;
    npcSchema.hitbox.collidableHeight = definition.hitbox.collidableHeight;

    room.state.aiNpcs.set(id, npcSchema);

    const pathTickOffset = Math.floor(Math.random() * Math.max(1, definition.controllerConfig.pathRecomputeFrequencyTicks));
    const initialIdleTick = definition.kind === "gremlin"
        ? room.gameTick + (160 + Math.floor(Math.random() * 81))
        : room.gameTick;
    room.aiRuntimeById.set(id, {
        id,
        kind: definition.kind,
        controllerId: definition.controllerId,
        x,
        y,
        vx: 0,
        vy: 0,
        moveTs: npcSchema.moveTs,
        direction: 0,
        anim: "idle",
        tint: definition.tint,
        currentHealth: definition.maxHealth,
        maxHealth: definition.maxHealth,
        hitbox: {
            width: definition.hitbox.width,
            height: definition.hitbox.height,
            collidableHeight: definition.hitbox.collidableHeight
        },
        mode: "idle",
        chasePath: [],
        chasePathIndex: 0,
        lastIdleCheckTick: initialIdleTick,
        lastPathRecomputeTick: room.gameTick - pathTickOffset,
        lastAttackMs: 0,
        attackAnimUntilMs: 0,
        pendingMeleeTargetSessionId: undefined,
        pendingMeleeTriggerAtMs: undefined,
        pendingMeleeDamageHearts: undefined,
        deathAnimUntilMs: 0,
        isDead: false,
        controllerConfig: { ...definition.controllerConfig }
    });

    if (spawnRegion) {
        spawnRegion.aliveNpcIds.add(id);
        room.aiSpawnRegionByNpcId.set(id, spawnRegion);
    }

    return id;
}

type RolledNpcDrop = {
    kind: "item";
    itemId: string;
    amount: number;
} | {
    kind: "coins";
    denomination: "bronze";
    amount: number;
};

function spawnNpcLootDrops(room: InstanceRoomHost, kind: AINpcKind, x: number, y: number) {
    const rolledDrops = rollNpcLootDrops(kind);
    if (rolledDrops.length === 0) return;

    rolledDrops.forEach((drop, index) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 4 + (Math.random() * 8) + (index * 1.5);
        const dropX = x + Math.cos(angle) * radius;
        const dropY = y + Math.sin(angle) * radius;

        if (drop.kind === "coins") {
            room.createDroppedCoins(drop.amount, dropX, dropY, drop.denomination);
            return;
        }

        if (!getItemDefinition(drop.itemId)) return;
        room.createDroppedItem(drop.itemId, drop.amount, dropX, dropY);
    });
}

function rollNpcLootDrops(kind: AINpcKind): RolledNpcDrop[] {
    const definition = AI_NPC_DEFINITIONS[kind];
    const table = definition?.lootTable;
    if (!table) return [];

    const drops: RolledNpcDrop[] = [];

    if (table.coins && Math.random() < clampChance(table.coins.chance)) {
        const minAmount = Math.max(1, Math.floor(table.coins.minAmount));
        const maxAmount = Math.max(minAmount, Math.floor(table.coins.maxAmount));
        const amount = randomIntInclusive(minAmount, maxAmount);
        drops.push({
            kind: "coins",
            denomination: table.coins.denomination,
            amount
        });
    }

    if (table.itemSubpool && Math.random() < clampChance(table.itemSubpool.chance)) {
        const itemId = selectItemFromSubpool(
            table.itemSubpool.itemIds,
            table.itemSubpool.jackpotItemId,
            table.itemSubpool.jackpotChanceWithinSubpool
        );
        if (itemId) {
            drops.push({
                kind: "item",
                itemId,
                amount: 1
            });
        }
    }

    return drops;
}

function selectItemFromSubpool(
    itemIds: string[],
    jackpotItemId?: string,
    jackpotChanceWithinSubpool?: number
): string | null {
    const pool = Array.isArray(itemIds)
        ? itemIds.filter((itemId) => typeof itemId === "string" && itemId.trim().length > 0)
        : [];
    if (pool.length === 0 && !jackpotItemId) return null;

    const jackpotChance = clampChance(
        Number.isFinite(jackpotChanceWithinSubpool)
            ? Number(jackpotChanceWithinSubpool)
            : 0
    );
    const hasJackpot = typeof jackpotItemId === "string" && jackpotItemId.trim().length > 0;
    if (hasJackpot && Math.random() < jackpotChance) {
        return jackpotItemId;
    }

    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

function randomIntInclusive(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clampChance(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}
