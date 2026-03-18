import { DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG } from '@cfwk/shared';
import { AIController } from './AIController';
import { AiControllerContext, AiNpcRuntimeState, Vec2 } from '../types';

const ATTACK_ANIM_TOTAL_MS = 900;
const ATTACK_IMPACT_DELAY_MS = 320;
const ATTACK_IMPACT_RANGE_SCALE = 1.15;

function toFacingDirectionIndex(vx: number, vy: number, fallback: number): number {
    if (Math.abs(vx) < 0.001 && Math.abs(vy) < 0.001) return fallback;
    const angle = Math.atan2(vy, vx);
    const octant = Math.round((Math.PI / 2 - angle) / (Math.PI / 4));
    return ((octant % 8) + 8) % 8;
}

function numberOrDefault(value: number | undefined, fallback: number, min: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Number(value));
}

export class GeneralEnemyController implements AIController {
    readonly id = 'general-enemy';

    update(entity: AiNpcRuntimeState, context: AiControllerContext): void {
        if (entity.isDead) {
            entity.vx = 0;
            entity.vy = 0;
            entity.anim = 'death';
            return;
        }

        const config = {
            speedPxPerSecond: numberOrDefault(entity.controllerConfig?.speedPxPerSecond, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG.speedPxPerSecond, 1),
            idleCheckFrequencyTicks: numberOrDefault(entity.controllerConfig?.idleCheckFrequencyTicks, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG.idleCheckFrequencyTicks, 1),
            idleMoveChance: numberOrDefault(entity.controllerConfig?.idleMoveChance, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG.idleMoveChance, 0),
            idleMoveRangeMinMeters: numberOrDefault(entity.controllerConfig?.idleMoveRangeMinMeters, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG.idleMoveRangeMinMeters, 0.1),
            idleMoveRangeMaxMeters: numberOrDefault(entity.controllerConfig?.idleMoveRangeMaxMeters, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG.idleMoveRangeMaxMeters, 0.1),
            chaseRangeMeters: numberOrDefault(entity.controllerConfig?.chaseRangeMeters, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG.chaseRangeMeters, 0.1),
            pathRecomputeFrequencyTicks: numberOrDefault(entity.controllerConfig?.pathRecomputeFrequencyTicks, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG.pathRecomputeFrequencyTicks, 1),
            attackCooldownMs: numberOrDefault(entity.controllerConfig?.attackCooldownMs, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG.attackCooldownMs, 1),
            meleeRangePx: numberOrDefault(entity.controllerConfig?.meleeRangePx, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG.meleeRangePx, 1),
            meleeDamageHearts: numberOrDefault(entity.controllerConfig?.meleeDamageHearts, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG.meleeDamageHearts, 0)
        };
        if (config.idleMoveRangeMaxMeters < config.idleMoveRangeMinMeters) {
            config.idleMoveRangeMaxMeters = config.idleMoveRangeMinMeters;
        }
        entity.controllerConfig = config;
        const chaseRangePx = context.metersToPixels(config.chaseRangeMeters);
        let disengagedThisTick = false;

        const existingTarget = entity.targetSessionId
            ? context.players.find((player) => player.sessionId === entity.targetSessionId)
            : undefined;

        if (existingTarget) {
            const distance = Math.hypot(existingTarget.x - entity.x, existingTarget.y - entity.y);
            if (distance > chaseRangePx) {
                entity.targetSessionId = undefined;
                entity.mode = 'idle';
                entity.chasePath = [];
                entity.chasePathIndex = 0;
                entity.wanderTarget = undefined;
                entity.vx = 0;
                entity.vy = 0;
                disengagedThisTick = true;
            }
        }

        if (!entity.targetSessionId && !disengagedThisTick) {
            let nearestSessionId: string | undefined;
            let nearestDistance = Number.POSITIVE_INFINITY;
            context.players.forEach((player) => {
                const distance = Math.hypot(player.x - entity.x, player.y - entity.y);
                if (distance > chaseRangePx) return;
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestSessionId = player.sessionId;
                }
            });

            if (nearestSessionId) {
                entity.targetSessionId = nearestSessionId;
                entity.mode = 'chase';
                entity.chasePath = [];
                entity.chasePathIndex = 0;
                entity.lastPathRecomputeTick = -1;
                entity.wanderTarget = undefined;
            }
        }

        if (entity.targetSessionId) {
            this.stepChase(entity, context);
        } else {
            this.stepIdle(entity, context);
        }

        if (entity.kind === 'gremlin') {
            const target = entity.targetSessionId
                ? context.players.find((player) => player.sessionId === entity.targetSessionId)
                : undefined;
            entity.direction = this.getGremlinDirection(entity, target);
            if (context.now < entity.attackAnimUntilMs) {
                entity.anim = 'attack';
            } else {
                entity.anim = (Math.abs(entity.vx) > 0.2 || Math.abs(entity.vy) > 0.2) ? 'walk' : 'idle';
            }
            return;
        }

        entity.direction = toFacingDirectionIndex(entity.vx, entity.vy, entity.direction);
        entity.anim = (Math.abs(entity.vx) > 0.2 || Math.abs(entity.vy) > 0.2) ? 'walk' : 'idle';
    }

    private stepIdle(entity: AiNpcRuntimeState, context: AiControllerContext) {
        if (entity.kind === 'gremlin') {
            if (!entity.wanderTarget) {
                if (context.tick < entity.lastIdleCheckTick) {
                    entity.vx = 0;
                    entity.vy = 0;
                    return;
                }

                const distanceMeters = 3 + (2 * context.random());
                const distancePx = context.metersToPixels(distanceMeters);
                const angle = context.random() * Math.PI * 2;
                entity.wanderTarget = {
                    x: entity.x + Math.cos(angle) * distancePx,
                    y: entity.y + Math.sin(angle) * distancePx
                };

                const nextDelayTicks = 160 + Math.floor(context.random() * 81);
                entity.lastIdleCheckTick = context.tick + nextDelayTicks;
            }

            const reachedGremlinTarget = this.moveToward(entity, context, entity.wanderTarget, entity.controllerConfig.speedPxPerSecond);
            if (reachedGremlinTarget) {
                entity.wanderTarget = undefined;
                entity.vx = 0;
                entity.vy = 0;
            }
            return;
        }

        const config = entity.controllerConfig;
        if (context.tick - entity.lastIdleCheckTick >= config.idleCheckFrequencyTicks) {
            entity.lastIdleCheckTick = context.tick;
            if (context.random() <= config.idleMoveChance) {
                const distanceMeters = config.idleMoveRangeMinMeters
                    + (config.idleMoveRangeMaxMeters - config.idleMoveRangeMinMeters) * context.random();
                const distancePx = context.metersToPixels(distanceMeters);
                const angle = context.random() * Math.PI * 2;
                entity.wanderTarget = {
                    x: entity.x + Math.cos(angle) * distancePx,
                    y: entity.y + Math.sin(angle) * distancePx
                };
            }
        }

        if (!entity.wanderTarget) {
            entity.vx = 0;
            entity.vy = 0;
            return;
        }

        const reached = this.moveToward(entity, context, entity.wanderTarget, entity.controllerConfig.speedPxPerSecond);
        if (reached) {
            entity.wanderTarget = undefined;
            entity.vx = 0;
            entity.vy = 0;
        }
    }

    private stepChase(entity: AiNpcRuntimeState, context: AiControllerContext) {
        const target = context.players.find((player) => player.sessionId === entity.targetSessionId);
        if (!target) {
            entity.targetSessionId = undefined;
            entity.mode = 'idle';
            entity.vx = 0;
            entity.vy = 0;
            return;
        }

        const chaseRangePx = context.metersToPixels(entity.controllerConfig.chaseRangeMeters);
        const distanceToTarget = Math.hypot(target.x - entity.x, target.y - entity.y);
        const pendingAttackReady = Number.isFinite(entity.pendingMeleeTriggerAtMs) && context.now >= Number(entity.pendingMeleeTriggerAtMs);
        if (pendingAttackReady) {
            const pendingTarget = entity.pendingMeleeTargetSessionId
                ? context.players.find((player) => player.sessionId === entity.pendingMeleeTargetSessionId)
                : undefined;
            const pendingDamage = Number(entity.pendingMeleeDamageHearts || 0);
            if (pendingTarget && pendingDamage > 0) {
                const pendingDistance = Math.hypot(pendingTarget.x - entity.x, pendingTarget.y - entity.y);
                if (pendingDistance <= entity.controllerConfig.meleeRangePx * ATTACK_IMPACT_RANGE_SCALE) {
                    context.onMeleeAttackAttempt(entity, pendingTarget.sessionId, pendingDamage);
                }
            }
            entity.pendingMeleeTargetSessionId = undefined;
            entity.pendingMeleeTriggerAtMs = undefined;
            entity.pendingMeleeDamageHearts = undefined;
        }

        const horizontalDelta = target.x - entity.x;
        const canAttemptMelee = distanceToTarget <= entity.controllerConfig.meleeRangePx
            && Math.abs(horizontalDelta) > 0.5
            && (context.now - entity.lastAttackMs) >= entity.controllerConfig.attackCooldownMs
            && !entity.pendingMeleeTargetSessionId
            && entity.controllerConfig.meleeDamageHearts > 0;

        if (canAttemptMelee) {
            entity.attackAnimUntilMs = context.now + ATTACK_ANIM_TOTAL_MS;
            entity.lastAttackMs = context.now;
            entity.pendingMeleeTargetSessionId = target.sessionId;
            entity.pendingMeleeTriggerAtMs = context.now + ATTACK_IMPACT_DELAY_MS;
            entity.pendingMeleeDamageHearts = entity.controllerConfig.meleeDamageHearts;
        }

        if (distanceToTarget > chaseRangePx) {
            entity.targetSessionId = undefined;
            entity.mode = 'idle';
            entity.chasePath = [];
            entity.chasePathIndex = 0;
            entity.wanderTarget = undefined;
            entity.vx = 0;
            entity.vy = 0;
            return;
        }

        const shouldRecomputePath = entity.lastPathRecomputeTick < 0
            || (context.tick - entity.lastPathRecomputeTick) >= entity.controllerConfig.pathRecomputeFrequencyTicks;

        if (shouldRecomputePath) {
            entity.lastPathRecomputeTick = context.tick;
            const path = context.nav.findPath({ x: entity.x, y: entity.y }, { x: target.x, y: target.y }, entity.hitbox);
            entity.chasePath = path;
            entity.chasePathIndex = path.length > 1 ? 1 : 0;
        }

        let chaseTarget: Vec2 = { x: target.x, y: target.y };
        if (entity.chasePath.length > 0 && entity.chasePathIndex < entity.chasePath.length) {
            chaseTarget = entity.chasePath[entity.chasePathIndex];
        } else {
            entity.vx = 0;
            entity.vy = 0;
            return;
        }

        const reached = this.moveToward(entity, context, chaseTarget, entity.controllerConfig.speedPxPerSecond);
        if (reached && entity.chasePath.length > 0 && entity.chasePathIndex < entity.chasePath.length - 1) {
            entity.chasePathIndex += 1;
        }
    }

    private moveToward(entity: AiNpcRuntimeState, context: AiControllerContext, target: Vec2, speedPxPerSecond: number): boolean {
        const dx = target.x - entity.x;
        const dy = target.y - entity.y;
        const distance = Math.hypot(dx, dy);

        if (distance <= 1.5) {
            return true;
        }

        const nx = dx / Math.max(0.0001, distance);
        const ny = dy / Math.max(0.0001, distance);
        const stepDistance = Math.min(distance, Math.max(0, speedPxPerSecond) * context.deltaSec);

        const desired = {
            x: entity.x + nx * stepDistance,
            y: entity.y + ny * stepDistance
        };

        const resolved = context.nav.resolveMovement({ x: entity.x, y: entity.y }, desired, entity.hitbox);
        entity.vx = (resolved.x - entity.x) / Math.max(0.0001, context.deltaSec);
        entity.vy = (resolved.y - entity.y) / Math.max(0.0001, context.deltaSec);
        entity.x = resolved.x;
        entity.y = resolved.y;
        entity.moveTs = context.now;

        if (Math.abs(resolved.x - desired.x) > 0.01 || Math.abs(resolved.y - desired.y) > 0.01) {
            return true;
        }

        return Math.hypot(target.x - entity.x, target.y - entity.y) <= 2;
    }

    private getGremlinDirection(entity: AiNpcRuntimeState, target?: Vec2): number {
        if (target && Math.abs(target.x - entity.x) > 0.5) {
            return target.x < entity.x ? 6 : 2;
        }
        if (Math.abs(entity.vx) > 0.01) {
            return entity.vx < 0 ? 6 : 2;
        }
        return entity.direction === 6 ? 6 : 2;
    }
}
