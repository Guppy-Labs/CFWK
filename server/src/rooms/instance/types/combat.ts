import { GlimmerbowlEntry } from "@cfwk/shared";
import { AiNpcRuntimeState } from "../../../ai/types";

export type FishCombatRuntimeState = {
    active: boolean;
    queue: string[];
    headIndex: number;
    cooldownByFishEntryId: Map<string, number>;
};

export type SoftCollisionBody = {
    id: string;
    kind: "player" | "ai";
    x: number;
    y: number;
    halfWidth: number;
    halfHeight: number;
    pushX: number;
    pushY: number;
};

export type AppliedEnemyRuntime = AiNpcRuntimeState;
export type GlimmerbowlEntries = GlimmerbowlEntry[];
