import { isPointInPolygon } from "./pointInPolygon";
import { polygonAxisAlignedBounds } from "./bounds";

export function randomPointInPolygon(
    polygon: Array<{ x: number; y: number }>,
    maxAttempts = 32
): { x: number; y: number } {
    const bounds = polygonAxisAlignedBounds(polygon);
    for (let attempt = 0; attempt < Math.max(1, Math.floor(maxAttempts)); attempt += 1) {
        const x = bounds.minX + (Math.random() * (bounds.maxX - bounds.minX));
        const y = bounds.minY + (Math.random() * (bounds.maxY - bounds.minY));
        if (isPointInPolygon(x, y, polygon)) {
            return { x, y };
        }
    }

    let sumX = 0;
    let sumY = 0;
    polygon.forEach((point) => {
        sumX += point.x;
        sumY += point.y;
    });
    const count = Math.max(1, polygon.length);
    return { x: sumX / count, y: sumY / count };
}
