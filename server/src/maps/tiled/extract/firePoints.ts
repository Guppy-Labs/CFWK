import { findObjectGroupLayer } from "../layers";
import { TiledMap } from "../types";

export function extractFirePoints(map: TiledMap): Array<{ x: number; y: number }> {
    const poiLayer = findObjectGroupLayer(map, "POI");
    if (!poiLayer || !Array.isArray(poiLayer.objects)) return [];

    return poiLayer.objects
        .filter((object) => object.name === "Fire")
        .map((object) => {
            const x = Number(object.x ?? 0) + (Number(object.width ?? 0) / 2);
            const y = Number(object.y ?? 0) + (Number(object.height ?? 0) / 2);
            return { x, y };
        });
}
