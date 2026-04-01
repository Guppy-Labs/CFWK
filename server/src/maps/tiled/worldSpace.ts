import { TiledMapObject } from "./types";

export function tiledObjectCenter(object: TiledMapObject): { x: number; y: number } | null {
    const baseX = Number(object.x ?? 0);
    const baseY = Number(object.y ?? 0);

    if (Array.isArray(object.polygon) && object.polygon.length > 0) {
        let sumX = 0;
        let sumY = 0;
        for (const point of object.polygon) {
            sumX += baseX + Number(point.x ?? 0);
            sumY += baseY + Number(point.y ?? 0);
        }
        const count = object.polygon.length;
        if (count <= 0) return null;
        return { x: sumX / count, y: sumY / count };
    }

    const width = Number(object.width ?? 0);
    const height = Number(object.height ?? 0);
    return {
        x: baseX + width * 0.5,
        y: baseY + height * 0.5
    };
}

export function worldPolygonFromObject(object: TiledMapObject): Array<{ x: number; y: number }> {
    const baseX = Number(object.x ?? 0);
    const baseY = Number(object.y ?? 0);
    if (!Array.isArray(object.polygon)) return [];
    return object.polygon.map((point) => ({
        x: baseX + Number(point.x ?? 0),
        y: baseY + Number(point.y ?? 0)
    }));
}
