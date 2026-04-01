import { polygonArea } from "../../geometry/polygonArea";
import { findObjectGroupLayer } from "../layers";
import { worldPolygonFromObject } from "../worldSpace";
import { TiledMap } from "../types";

export type AdvancementRegion = {
    name: string;
    polygon: Array<{ x: number; y: number }>;
    area: number;
};

export function extractAdvancementRegions(map: TiledMap): AdvancementRegion[] {
    const regionLayer = findObjectGroupLayer(map, "Regions");
    if (!regionLayer || !Array.isArray(regionLayer.objects)) return [];

    const results: AdvancementRegion[] = [];
    for (const object of regionLayer.objects) {
        if (!object.name || !Array.isArray(object.polygon) || object.polygon.length < 3) continue;
        const polygon = worldPolygonFromObject(object);
        results.push({
            name: object.name,
            polygon,
            area: polygonArea(polygon)
        });
    }
    return results;
}
