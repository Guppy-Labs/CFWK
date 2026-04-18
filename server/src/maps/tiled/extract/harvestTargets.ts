import { InteractiveHarvestTarget } from "../../../rooms/instance/InstanceRoomSchema";
import { getTiledProperty } from "../properties";
import { tiledObjectCenter } from "../worldSpace";
import { findObjectGroupLayer } from "../layers";
import { TiledMap, TiledMapObject } from "../types";

function getObjectBounds(object: TiledMapObject): { minX: number; maxX: number; minY: number; maxY: number } | null {
    const baseX = Number(object.x ?? 0);
    const baseY = Number(object.y ?? 0);
    if (Array.isArray(object.polygon) && object.polygon.length > 0) {
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const point of object.polygon) {
            const worldX = baseX + Number(point.x ?? 0);
            const worldY = baseY + Number(point.y ?? 0);
            minX = Math.min(minX, worldX);
            maxX = Math.max(maxX, worldX);
            minY = Math.min(minY, worldY);
            maxY = Math.max(maxY, worldY);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return null;
        }
        return { minX, maxX, minY, maxY };
    }

    const width = Number(object.width ?? 0);
    const height = Number(object.height ?? 0);
    const minX = Math.min(baseX, baseX + width);
    const maxX = Math.max(baseX, baseX + width);
    const minY = Math.min(baseY, baseY + height);
    const maxY = Math.max(baseY, baseY + height);
    return { minX, maxX, minY, maxY };
}

function getObjectPolygon(object: TiledMapObject): Array<{ x: number; y: number }> | null {
    const baseX = Number(object.x ?? 0);
    const baseY = Number(object.y ?? 0);
    if (Array.isArray(object.polygon) && object.polygon.length >= 3) {
        const polygon = object.polygon.map((point) => ({
            x: baseX + Number(point.x ?? 0),
            y: baseY + Number(point.y ?? 0)
        }));
        if (polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
            return polygon;
        }
        return null;
    }

    const bounds = getObjectBounds(object);
    if (!bounds) return null;
    return [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY }
    ];
}

export function extractHarvestTargets(
    map: TiledMap,
    options: { componentId: string; radiusPx: number }
): Map<number, InteractiveHarvestTarget> {
    const targets = new Map<number, InteractiveHarvestTarget>();
    const interactivesLayer = findObjectGroupLayer(map, "Interactives");
    if (!interactivesLayer || !Array.isArray(interactivesLayer.objects)) return targets;

    for (const object of interactivesLayer.objects) {
        if (!Number.isFinite(object.id)) continue;
        const objectId = Math.floor(Number(object.id));
        if (objectId <= 0) continue;

        const componentId = getTiledProperty(object.properties, "componentid");
        const normalizedComponentId = typeof componentId === "string" ? componentId.trim().toLowerCase() : "";
        if (normalizedComponentId !== options.componentId) continue;

        const center = tiledObjectCenter(object);
        if (!center) continue;
        const bounds = getObjectBounds(object);
        if (!bounds) continue;
        const polygon = getObjectPolygon(object);
        if (!polygon) continue;

        targets.set(objectId, {
            objectId,
            componentId: normalizedComponentId,
            centerX: center.x,
            centerY: center.y,
            radiusPx: options.radiusPx,
            minX: bounds.minX,
            maxX: bounds.maxX,
            minY: bounds.minY,
            maxY: bounds.maxY,
            polygon
        });
    }

    return targets;
}
