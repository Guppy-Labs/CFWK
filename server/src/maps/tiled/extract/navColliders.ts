import { polygonAxisAlignedBounds } from "../../geometry/bounds";
import { getTiledProperty } from "../properties";
import { worldPolygonFromObject } from "../worldSpace";
import { TiledMap } from "../types";

export type NavRect = { x: number; y: number; width: number; height: number };

export type NavColliderShape =
    | { kind: "rect"; rect: NavRect }
    | { kind: "poly"; polygon: Array<{ x: number; y: number }>; bounds: NavRect };

export function extractNavColliderShapes(map: TiledMap): NavColliderShape[] {
    const objectLayers = (map.layers || []).filter((layer) => layer.type === "objectgroup");
    const collisionLayers = objectLayers.filter((layer) => {
        const collidableProp = getTiledProperty(layer.properties, "Collidable");
        const normalizedName = String(layer.name || "").toLowerCase();
        return collidableProp === true
            || normalizedName.includes("collision")
            || normalizedName.includes("avoidance");
    });

    const colliders: NavColliderShape[] = [];

    collisionLayers.forEach((layer) => {
        (layer.objects || []).forEach((object) => {
            const inverted = getTiledProperty(object.properties, "Inverted") === true;
            if (inverted) return;

            if (Array.isArray(object.polygon) && object.polygon.length >= 3) {
                const worldPolygon = worldPolygonFromObject(object);
                const bounds = polygonAxisAlignedBounds(worldPolygon);

                colliders.push({
                    kind: "poly",
                    polygon: worldPolygon,
                    bounds: {
                        x: bounds.minX,
                        y: bounds.minY,
                        width: Math.max(1, bounds.maxX - bounds.minX),
                        height: Math.max(1, bounds.maxY - bounds.minY)
                    }
                });
                return;
            }

            const baseX = Number(object.x) || 0;
            const baseY = Number(object.y) || 0;
            const width = Number(object.width) || 0;
            const height = Number(object.height) || 0;
            if (width <= 0 || height <= 0) return;

            colliders.push({ kind: "rect", rect: { x: baseX, y: baseY, width, height } });
        });
    });

    return colliders;
}
