export function polygonSignedArea(polygon: Array<{ x: number; y: number }>): number {
    if (!Array.isArray(polygon) || polygon.length < 3) return 0;
    let sum = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        sum += (polygon[j].x * polygon[i].y) - (polygon[i].x * polygon[j].y);
    }
    return sum * 0.5;
}

export function polygonArea(polygon: Array<{ x: number; y: number }>): number {
    const area = Math.abs(polygonSignedArea(polygon));
    return Number.isFinite(area) && area > 0 ? area : Number.POSITIVE_INFINITY;
}
