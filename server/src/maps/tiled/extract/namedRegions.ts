import { RegionRuntime } from "../../../rooms/instance/InstanceRoomSchema";
import { findObjectGroupLayersByName } from "../layers";
import { worldPolygonFromObject } from "../worldSpace";
import { TiledMap } from "../types";

export function extractRegionByName(map: TiledMap, regionName: string): RegionRuntime | null {
    const regionLayers = findObjectGroupLayersByName(map, "regions");
    const wantedName = regionName.trim().toLowerCase();

    for (const layer of regionLayers) {
        for (const object of (layer.objects ?? [])) {
            const objectName = String(object.name ?? "").trim();
            if (!objectName || objectName.toLowerCase() !== wantedName) continue;
            if (!Array.isArray(object.polygon) || object.polygon.length < 3) continue;
            const polygon = worldPolygonFromObject(object);
            return {
                name: objectName,
                polygon
            };
        }
    }

    return null;
}
