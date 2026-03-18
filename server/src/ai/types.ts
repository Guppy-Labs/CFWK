import { AINpcAnim, AINpcControllerId, AINpcKind, IAiNpcHitbox, IGeneralEnemyControllerConfig } from '@cfwk/shared';

export type Vec2 = { x: number; y: number };

export type EnemyBrainMode = 'idle' | 'chase';

export type AiNpcRuntimeState = {
    id: string;
    kind: AINpcKind;
    controllerId: AINpcControllerId;
    x: number;
    y: number;
    vx: number;
    vy: number;
    moveTs: number;
    direction: number;
    anim: AINpcAnim;
    tint: number;
    hitbox: IAiNpcHitbox;
    currentHealth: number;
    maxHealth: number;
    mode: EnemyBrainMode;
    targetSessionId?: string;
    wanderTarget?: Vec2;
    chasePath: Vec2[];
    chasePathIndex: number;
    lastIdleCheckTick: number;
    lastPathRecomputeTick: number;
    lastAttackMs: number;
    attackAnimUntilMs: number;
    pendingMeleeTargetSessionId?: string;
    pendingMeleeTriggerAtMs?: number;
    pendingMeleeDamageHearts?: number;
    deathAnimUntilMs: number;
    isDead: boolean;
    controllerConfig: IGeneralEnemyControllerConfig;
};

export interface NavCollisionAdapter {
    findPath(start: Vec2, end: Vec2, hitbox: IAiNpcHitbox): Vec2[];
    resolveMovement(current: Vec2, desired: Vec2, hitbox: IAiNpcHitbox): Vec2;
}

export type AiObservedPlayer = {
    sessionId: string;
    x: number;
    y: number;
};

export interface AiControllerContext {
    tick: number;
    now: number;
    deltaSec: number;
    metersToPixels: (meters: number) => number;
    players: AiObservedPlayer[];
    nav: NavCollisionAdapter;
    random: () => number;
    onMeleeAttackAttempt: (attacker: AiNpcRuntimeState, targetSessionId: string, damageHearts: number) => void;
}
