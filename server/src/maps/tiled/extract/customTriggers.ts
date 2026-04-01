import { CustomTriggerRuntime } from "../../../rooms/instance/InstanceRoomSchema";
import { findObjectGroupLayersByName } from "../layers";
import { getTiledProperty } from "../properties";
import { worldPolygonFromObject } from "../worldSpace";
import { TiledMap } from "../types";

export function extractCustomTriggers(map: TiledMap): Map<string, CustomTriggerRuntime> {
    const triggers = new Map<string, CustomTriggerRuntime>();
    const customLayers = findObjectGroupLayersByName(map, "custom");

    for (const layer of customLayers) {
        for (const object of (layer.objects ?? [])) {
            if (!Array.isArray(object.polygon) || object.polygon.length < 3) continue;
            const customIdRaw = getTiledProperty(object.properties, "customid");
            const customId = typeof customIdRaw === "string" ? customIdRaw.trim().toLowerCase() : "";
            if (!customId) continue;

            const polygon = worldPolygonFromObject(object);
            let sumX = 0;
            let sumY = 0;
            polygon.forEach((point) => {
                sumX += point.x;
                sumY += point.y;
            });
            const count = Math.max(1, polygon.length);

            triggers.set(customId, {
                customId,
                polygon,
                centerX: sumX / count,
                centerY: sumY / count
            });
        }
    }

    return triggers;
}
