import { MovementInputState } from "@cfwk/shared";
import { InstancePlayerSchema } from "../schema/InstancePlayerSchema";

export type PositionSnapshot = {
    tick: number;
    time: number;
    x: number;
    y: number;
};

export type RuntimeMovementState = {
    lastSeq: number;
    lastClientTime: number;
    lastServerTime: number;
    vx: number;
    vy: number;
    input: MovementInputState;
    hardAuthorityUntil: number;
    impulseVx: number;
    impulseVy: number;
    impulseActiveUntil: number;
};

export type EnemyMeleeAttackDodgeRuntime = RuntimeMovementState & {
    dodgeUntil?: number;
    dodgeActiveUntil?: number;
    iFrameUntil?: number;
    invulnerableUntil?: number;
};

export type EnemyMeleeAttackDodgePlayer = InstancePlayerSchema & {
    dodgeUntil?: number;
    iFrameUntil?: number;
    invulnerableUntil?: number;
};
