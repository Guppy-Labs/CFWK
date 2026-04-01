import { AINpcKind } from "@cfwk/shared";
import { AI_NPC_DEFINITIONS } from "../../../ai/registry";
import { SpawnRegionRuntime } from "../../../rooms/instance/InstanceRoomSchema";
import { polygonAxisAlignedBounds } from "../../geometry/bounds";
import { getTiledProperty } from "../properties";
import { worldPolygonFromObject } from "../worldSpace";
import { findObjectGroupLayersByName } from "../layers";
import { TiledMap } from "../types";

export function extractSpawnRegions(map: TiledMap, now = Date.now()): SpawnRegionRuntime[] {
    const regions: SpawnRegionRuntime[] = [];
    const spawnLayers = findObjectGroupLayersByName(map, "spawn");

    for (const layer of spawnLayers) {
        for (const object of (layer.objects ?? [])) {
            if (!Number.isFinite(object.id) || !Array.isArray(object.polygon) || object.polygon.length < 3) continue;
            const npcRaw = getTiledProperty(object.properties, "npc");
            const npcKind = typeof npcRaw === "string" ? npcRaw.trim().toLowerCase() : "";
            if (!npcKind || !(npcKind in AI_NPC_DEFINITIONS)) continue;

            const maxSpawnedRaw = Number(getTiledProperty(object.properties, "maxSpawned"));
            const restoreRateRaw = Number(getTiledProperty(object.properties, "restoreRate"));
            const maxSpawned = Number.isFinite(maxSpawnedRaw) ? Math.max(1, Math.floor(maxSpawnedRaw)) : 1;
            const restoreRateMs = Number.isFinite(restoreRateRaw) ? Math.max(250, Math.floor(restoreRateRaw)) : 10000;
            const polygon = worldPolygonFromObject(object);
            if (polygon.length < 3) continue;
            const bounds = polygonAxisAlignedBounds(polygon);

            regions.push({
                id: Number(object.id),
                npcKind: npcKind as AINpcKind,
                polygon,
                minX: bounds.minX,
                minY: bounds.minY,
                maxX: bounds.maxX,
                maxY: bounds.maxY,
                maxSpawned,
                restoreRateMs,
                aliveNpcIds: new Set<string>(),
                nextSpawnAtMs: now
            });
        }
    }

    return regions;
}
