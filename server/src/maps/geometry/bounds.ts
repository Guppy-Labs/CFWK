export type PolygonBounds = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

export function polygonAxisAlignedBounds(polygon: Array<{ x: number; y: number }>): PolygonBounds {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    polygon.forEach((point) => {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
    });

    return { minX, minY, maxX, maxY };
}
