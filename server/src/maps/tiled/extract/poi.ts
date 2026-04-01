import { findObjectGroupLayer } from "../layers";
import { TiledMap } from "../types";

export function extractPoiPointsByName(map: TiledMap): Map<string, Array<{ x: number; y: number }>> {
    const results = new Map<string, Array<{ x: number; y: number }>>();
    const poiLayer = findObjectGroupLayer(map, "POI");
    if (!poiLayer || !Array.isArray(poiLayer.objects)) return results;

    poiLayer.objects.forEach((object) => {
        const name = typeof object.name === "string" ? object.name.trim() : "";
        if (!name) return;
        const x = Number(object.x ?? 0) + (Number(object.width ?? 0) / 2);
        const y = Number(object.y ?? 0) + (Number(object.height ?? 0) / 2);
        const current = results.get(name) ?? [];
        current.push({ x, y });
        results.set(name, current);
    });

    return results;
}
