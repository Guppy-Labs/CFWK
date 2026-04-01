import { ChestInteractionTarget, CustomTriggerRuntime, InteractiveHarvestTarget, RegionRuntime, SpawnRegionRuntime } from "./InstanceRoomSchema";
import { GLIMMERING_CHEST_COMPONENT_ID, GLIMMERING_CHEST_INTERACTION_RADIUS_PX, YEKBUSH_COMPONENT_ID, YEKBUSH_INTERACTION_RADIUS_PX } from "./InstanceRoomConstants";
import { isPointInPolygon as sharedPointInPolygon } from "../../maps/geometry/pointInPolygon";
import { randomPointInPolygon } from "../../maps/geometry/randomInPolygon";
import { loadTiledMap } from "../../maps/tiled/readMap";
import { extractGlimmeringChestTarget } from "../../maps/tiled/extract/chestTile";
import { extractCustomTriggers } from "../../maps/tiled/extract/customTriggers";
import { extractHarvestTargets } from "../../maps/tiled/extract/harvestTargets";
import { extractRegionByName } from "../../maps/tiled/extract/namedRegions";
import { extractSpawnRegions } from "../../maps/tiled/extract/spawnRegions";

export function loadHarvestTargets(mapFileName: string): Map<number, InteractiveHarvestTarget> {
    const map = loadTiledMap(mapFileName);
    if (!map) return new Map<number, InteractiveHarvestTarget>();
    try {
        return extractHarvestTargets(map, {
            componentId: YEKBUSH_COMPONENT_ID,
            radiusPx: YEKBUSH_INTERACTION_RADIUS_PX
        });
    } catch (error) {
        console.error('[InstanceRoom] Failed to load harvest targets from map:', error);
        return new Map<number, InteractiveHarvestTarget>();
    }
}

export function loadChestInteractionTarget(mapFileName: string): ChestInteractionTarget | null {
    const map = loadTiledMap(mapFileName);
    if (!map) return null;
    try {
        return extractGlimmeringChestTarget(map, {
            componentId: GLIMMERING_CHEST_COMPONENT_ID,
            radiusPx: GLIMMERING_CHEST_INTERACTION_RADIUS_PX
        });
    } catch (error) {
        console.error('[InstanceRoom] Failed to load chest interaction target from map:', error);
        return null;
    }
}

export function loadSpawnRegions(mapFileName: string): SpawnRegionRuntime[] {
    const map = loadTiledMap(mapFileName);
    if (!map) return [];
    try {
        return extractSpawnRegions(map);
    } catch (error) {
        console.error('[InstanceRoom] Failed to load spawn regions from map:', error);
        return [];
    }
}

export function loadCustomTriggers(mapFileName: string): Map<string, CustomTriggerRuntime> {
    const map = loadTiledMap(mapFileName);
    if (!map) return new Map<string, CustomTriggerRuntime>();
    try {
        return extractCustomTriggers(map);
    } catch (error) {
        console.error('[InstanceRoom] Failed to load custom triggers from map:', error);
        return new Map<string, CustomTriggerRuntime>();
    }
}

export function loadRegionByName(mapFileName: string, regionName: string): RegionRuntime | null {
    const map = loadTiledMap(mapFileName);
    if (!map) return null;
    try {
        return extractRegionByName(map, regionName);
    } catch (error) {
        console.error('[InstanceRoom] Failed to load region polygon from map:', error);
        return null;
    }
}

export function isPointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
    return sharedPointInPolygon(x, y, polygon);
}

export function getRandomPointInSpawnRegion(region: SpawnRegionRuntime): { x: number; y: number } {
    return randomPointInPolygon(region.polygon, 32);
}
