import { InteractiveHarvestTarget } from "../../../rooms/instance/InstanceRoomSchema";
import { getTiledProperty } from "../properties";
import { tiledObjectCenter } from "../worldSpace";
import { findObjectGroupLayer } from "../layers";
import { TiledMap } from "../types";

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

        targets.set(objectId, {
            objectId,
            componentId: normalizedComponentId,
            centerX: center.x,
            centerY: center.y,
            radiusPx: options.radiusPx
        });
    }

    return targets;
}
