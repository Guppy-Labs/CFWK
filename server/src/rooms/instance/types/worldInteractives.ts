import { AINpcKind } from "@cfwk/shared";

export type InteractiveHarvestTarget = {
    objectId: number;
    componentId: string;
    centerX: number;
    centerY: number;
    radiusPx: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    polygon?: Array<{ x: number; y: number }>;
};

export type ChestInteractionTarget = {
    componentId: string;
    centerX: number;
    centerY: number;
    radiusPx: number;
};

export type SpawnRegionRuntime = {
    id: number;
    npcKind: AINpcKind;
    polygon: Array<{ x: number; y: number }>;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    maxSpawned: number;
    restoreRateMs: number;
    aliveNpcIds: Set<string>;
    nextSpawnAtMs: number;
};

export type CustomTriggerRuntime = {
    customId: string;
    polygon: Array<{ x: number; y: number }>;
    centerX: number;
    centerY: number;
};

export type RegionRuntime = {
    name: string;
    polygon: Array<{ x: number; y: number }>;
};

export type SpawnPolygonPoint = { x: number; y: number };
