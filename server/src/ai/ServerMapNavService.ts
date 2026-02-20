import fs from 'fs';
import path from 'path';
import { IAiNpcHitbox } from '@cfwk/shared';
import { compressPath, findPathAStar } from './AStar';
import { NavCollisionAdapter, Vec2 } from './types';

type TiledProperty = { name: string; type: string; value: unknown };

type TiledMapObject = {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    polygon?: Array<{ x: number; y: number }>;
    properties?: TiledProperty[] | Record<string, unknown>;
};

type TiledObjectLayer = {
    name: string;
    type: string;
    properties?: TiledProperty[] | Record<string, unknown>;
    objects?: TiledMapObject[];
};

type TiledMap = {
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    layers: TiledObjectLayer[];
};

type Rect = { x: number; y: number; width: number; height: number };

type ColliderShape =
    | { kind: 'rect'; rect: Rect }
    | { kind: 'poly'; polygon: Array<{ x: number; y: number }>; bounds: Rect };

function getProp(obj: { properties?: TiledProperty[] | Record<string, unknown> }, name: string): unknown {
    const props = obj.properties;
    if (!props) return undefined;
    if (Array.isArray(props)) {
        return props.find((entry) => entry.name === name)?.value;
    }
    return props[name];
}

function pointInPolygon(pointX: number, pointY: number, polygon: Array<{ x: number; y: number }>): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x;
        const yi = polygon[i].y;
        const xj = polygon[j].x;
        const yj = polygon[j].y;

        const intersects = ((yi > pointY) !== (yj > pointY))
            && (pointX < ((xj - xi) * (pointY - yi)) / (yj - yi + 0.0000001) + xi);

        if (intersects) {
            inside = !inside;
        }
    }
    return inside;
}

export class ServerMapNavService implements NavCollisionAdapter {
    private mapWidthPx = 0;
    private mapHeightPx = 0;
    private cellSizePx = 32;
    private blockedCells = new Set<string>();
    private colliders: ColliderShape[] = [];
    private readonly pathSafetyPaddingPx = 1;
    private readonly movementSafetyPaddingPx = 0.5;
    private readonly gridSubdivision = 4;
    private readonly minCellSizePx = 8;
    private readonly maxAStarExpandedNodes = 12000;

    initializeFromMap(mapFileName: string) {
        const fullPath = this.resolveMapPath(mapFileName);
        if (!fullPath) {
            console.warn(`[ServerMapNavService] Map not found for nav: ${mapFileName}`);
            return;
        }

        const raw = fs.readFileSync(fullPath, 'utf8');
        const map = JSON.parse(raw) as TiledMap;

        this.mapWidthPx = map.width * map.tilewidth;
        this.mapHeightPx = map.height * map.tileheight;
        this.cellSizePx = Math.max(
            this.minCellSizePx,
            Math.floor((map.tilewidth || 32) / this.gridSubdivision)
        );
        this.blockedCells.clear();
        this.colliders = [];

        const objectLayers = (map.layers || []).filter((layer) => layer.type === 'objectgroup');
        const collisionLayers = objectLayers.filter((layer) => {
            const collidableProp = getProp(layer, 'Collidable');
            return collidableProp === true || layer.name.toLowerCase().includes('collision');
        });

        collisionLayers.forEach((layer) => {
            (layer.objects || []).forEach((object) => {
                const inverted = getProp(object, 'Inverted') === true;
                if (inverted) return;

                const baseX = Number(object.x) || 0;
                const baseY = Number(object.y) || 0;

                if (Array.isArray(object.polygon) && object.polygon.length >= 3) {
                    const worldPolygon = object.polygon.map((point) => ({ x: baseX + point.x, y: baseY + point.y }));

                    let minX = Number.POSITIVE_INFINITY;
                    let minY = Number.POSITIVE_INFINITY;
                    let maxX = Number.NEGATIVE_INFINITY;
                    let maxY = Number.NEGATIVE_INFINITY;
                    worldPolygon.forEach((point) => {
                        minX = Math.min(minX, point.x);
                        minY = Math.min(minY, point.y);
                        maxX = Math.max(maxX, point.x);
                        maxY = Math.max(maxY, point.y);
                    });

                    const colliderRect = {
                        x: minX,
                        y: minY,
                        width: Math.max(1, maxX - minX),
                        height: Math.max(1, maxY - minY)
                    };

                    this.colliders.push({
                        kind: 'poly',
                        polygon: worldPolygon,
                        bounds: colliderRect
                    });

                    this.markCellsBySampler(minX, minY, maxX, maxY, (cellCenterX, cellCenterY) =>
                        pointInPolygon(cellCenterX, cellCenterY, worldPolygon)
                    );
                    return;
                }

                const width = Number(object.width) || 0;
                const height = Number(object.height) || 0;
                if (width <= 0 || height <= 0) return;

                this.colliders.push({ kind: 'rect', rect: { x: baseX, y: baseY, width, height } });
                this.markCellsBySampler(baseX, baseY, baseX + width, baseY + height, (cellCenterX, cellCenterY) => {
                    return cellCenterX >= baseX
                        && cellCenterX <= (baseX + width)
                        && cellCenterY >= baseY
                        && cellCenterY <= (baseY + height);
                });
            });
        });

        console.log(`[ServerMapNavService] Loaded nav for ${mapFileName}: ${this.blockedCells.size} blocked cells, ${this.colliders.length} colliders`);
    }

    findPath(start: Vec2, end: Vec2, hitbox: IAiNpcHitbox): Vec2[] {
        const startCellRaw = this.worldToCell(start);
        const endCellRaw = this.worldToCell(end);
        const paddedHitbox = this.getPaddedHitbox(hitbox, this.pathSafetyPaddingPx);

        const startCell = this.findNearestOccupiableCell(startCellRaw.x, startCellRaw.y, 4, paddedHitbox);
        const endCell = this.findNearestOccupiableCell(endCellRaw.x, endCellRaw.y, 10, paddedHitbox);
        if (!startCell || !endCell) return [];

        const gridPath = findPathAStar(startCell, endCell, (cellX, cellY) => {
            if (!this.isWalkableCell(cellX, cellY)) return false;
            const world = this.cellToWorld(cellX, cellY);
            return this.canOccupyAt(world.x, world.y, paddedHitbox);
        }, this.maxAStarExpandedNodes);
        if (gridPath.length === 0) return [];

        const worldPath = gridPath.map((cell) => this.cellToWorld(cell.x, cell.y));
        return compressPath(worldPath);
    }

    resolveMovement(current: Vec2, desired: Vec2, hitbox: IAiNpcHitbox): Vec2 {
        const paddedHitbox = this.getPaddedHitbox(hitbox, this.movementSafetyPaddingPx);
        const currentRect = this.getFeetHitboxRect(current.x, current.y, paddedHitbox);
        const desiredRect = this.getFeetHitboxRect(desired.x, desired.y, paddedHitbox);

        if (!this.intersectsAny(desiredRect) && this.isWithinBounds(desiredRect)) {
            return desired;
        }

        const xAttemptRect = { ...desiredRect, y: currentRect.y };
        const yAttemptRect = { ...desiredRect, x: currentRect.x };

        const nextX = (!this.intersectsAny(xAttemptRect) && this.isWithinBounds(xAttemptRect)) ? desired.x : current.x;
        const nextY = (!this.intersectsAny(yAttemptRect) && this.isWithinBounds(yAttemptRect)) ? desired.y : current.y;

        return { x: nextX, y: nextY };
    }

    private resolveMapPathCandidates(mapFileName: string): string[] {
        return [
            path.resolve(__dirname, '../../../client/public/maps', mapFileName),
            path.resolve(__dirname, '../../client/public/maps', mapFileName),
            path.resolve(process.cwd(), '../client/public/maps', mapFileName),
            path.resolve(process.cwd(), 'client/public/maps', mapFileName)
        ];
    }

    private resolveMapPath(mapFileName: string): string | null {
        const candidates = this.resolveMapPathCandidates(mapFileName);
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    private worldToCell(point: Vec2): { x: number; y: number } {
        return {
            x: Math.floor(point.x / this.cellSizePx),
            y: Math.floor(point.y / this.cellSizePx)
        };
    }

    private cellToWorld(cellX: number, cellY: number): Vec2 {
        return {
            x: cellX * this.cellSizePx + this.cellSizePx / 2,
            y: cellY * this.cellSizePx + this.cellSizePx / 2
        };
    }

    private isWalkableCell(cellX: number, cellY: number): boolean {
        if (cellX < 0 || cellY < 0) return false;
        if (cellX * this.cellSizePx >= this.mapWidthPx) return false;
        if (cellY * this.cellSizePx >= this.mapHeightPx) return false;
        return !this.blockedCells.has(`${cellX},${cellY}`);
    }

    private markCellsBySampler(
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        isBlockedAtCellCenter: (x: number, y: number) => boolean
    ) {
        const startX = Math.floor(minX / this.cellSizePx);
        const startY = Math.floor(minY / this.cellSizePx);
        const endX = Math.floor(maxX / this.cellSizePx);
        const endY = Math.floor(maxY / this.cellSizePx);

        for (let cellY = startY; cellY <= endY; cellY += 1) {
            for (let cellX = startX; cellX <= endX; cellX += 1) {
                const center = this.cellToWorld(cellX, cellY);
                if (isBlockedAtCellCenter(center.x, center.y)) {
                    this.blockedCells.add(`${cellX},${cellY}`);
                }
            }
        }
    }

    private getFeetHitboxRect(x: number, y: number, hitbox: IAiNpcHitbox): Rect {
        const width = Math.max(1, hitbox.width);
        const height = Math.max(1, hitbox.collidableHeight || hitbox.height);
        return {
            x: x - width / 2,
            y: y - (height / 2),
            width,
            height
        };
    }

    private canOccupyAt(x: number, y: number, hitbox: IAiNpcHitbox): boolean {
        const rect = this.getFeetHitboxRect(x, y, hitbox);
        return this.isWithinBounds(rect) && !this.intersectsAny(rect);
    }

    private findNearestOccupiableCell(originX: number, originY: number, maxRadius: number, hitbox: IAiNpcHitbox): { x: number; y: number } | null {
        if (this.isCellOccupiable(originX, originY, hitbox)) {
            return { x: originX, y: originY };
        }

        for (let radius = 1; radius <= maxRadius; radius += 1) {
            for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
                for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
                    if (Math.abs(offsetX) !== radius && Math.abs(offsetY) !== radius) continue;

                    const cellX = originX + offsetX;
                    const cellY = originY + offsetY;
                    if (this.isCellOccupiable(cellX, cellY, hitbox)) {
                        return { x: cellX, y: cellY };
                    }
                }
            }
        }

        return null;
    }

    private isCellOccupiable(cellX: number, cellY: number, hitbox: IAiNpcHitbox): boolean {
        if (!this.isWalkableCell(cellX, cellY)) return false;
        const world = this.cellToWorld(cellX, cellY);
        return this.canOccupyAt(world.x, world.y, hitbox);
    }

    private isWithinBounds(rect: Rect): boolean {
        if (this.mapWidthPx <= 0 || this.mapHeightPx <= 0) return true;
        return rect.x >= 0
            && rect.y >= 0
            && (rect.x + rect.width) <= this.mapWidthPx
            && (rect.y + rect.height) <= this.mapHeightPx;
    }

    private intersectsAny(rect: Rect): boolean {
        return this.colliders.some((collider) => this.intersectsCollider(rect, collider));
    }

    private getPaddedHitbox(hitbox: IAiNpcHitbox, paddingPx: number): IAiNpcHitbox {
        const padding = Math.max(0, paddingPx);
        return {
            width: Math.max(1, hitbox.width + padding * 2),
            height: Math.max(1, hitbox.height),
            collidableHeight: Math.max(1, (hitbox.collidableHeight || hitbox.height) + padding * 2)
        };
    }

    private intersectsCollider(rect: Rect, collider: ColliderShape): boolean {
        if (collider.kind === 'rect') {
            return this.rectsOverlap(rect, collider.rect);
        }

        if (!this.rectsOverlap(rect, collider.bounds)) return false;
        return this.rectIntersectsPolygon(rect, collider.polygon);
    }

    private rectsOverlap(a: Rect, b: Rect): boolean {
        return a.x < b.x + b.width
            && a.x + a.width > b.x
            && a.y < b.y + b.height
            && a.y + a.height > b.y;
    }

    private rectIntersectsPolygon(rect: Rect, polygon: Array<{ x: number; y: number }>): boolean {
        const rectPoints = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.width, y: rect.y },
            { x: rect.x + rect.width, y: rect.y + rect.height },
            { x: rect.x, y: rect.y + rect.height }
        ];

        if (rectPoints.some((point) => pointInPolygon(point.x, point.y, polygon))) {
            return true;
        }

        if (polygon.some((point) => this.pointInRect(point.x, point.y, rect))) {
            return true;
        }

        const rectEdges: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
            [rectPoints[0], rectPoints[1]],
            [rectPoints[1], rectPoints[2]],
            [rectPoints[2], rectPoints[3]],
            [rectPoints[3], rectPoints[0]]
        ];

        for (let index = 0; index < polygon.length; index += 1) {
            const nextIndex = (index + 1) % polygon.length;
            const polyA = polygon[index];
            const polyB = polygon[nextIndex];

            for (const [rectA, rectB] of rectEdges) {
                if (this.segmentsIntersect(rectA, rectB, polyA, polyB)) {
                    return true;
                }
            }
        }

        return false;
    }

    private pointInRect(x: number, y: number, rect: Rect): boolean {
        return x >= rect.x
            && x <= rect.x + rect.width
            && y >= rect.y
            && y <= rect.y + rect.height;
    }

    private segmentsIntersect(
        a1: { x: number; y: number },
        a2: { x: number; y: number },
        b1: { x: number; y: number },
        b2: { x: number; y: number }
    ): boolean {
        const d1 = this.cross(a1, a2, b1);
        const d2 = this.cross(a1, a2, b2);
        const d3 = this.cross(b1, b2, a1);
        const d4 = this.cross(b1, b2, a2);

        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
            && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
            return true;
        }

        return (
            (d1 === 0 && this.onSegment(a1, a2, b1))
            || (d2 === 0 && this.onSegment(a1, a2, b2))
            || (d3 === 0 && this.onSegment(b1, b2, a1))
            || (d4 === 0 && this.onSegment(b1, b2, a2))
        );
    }

    private cross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
        return (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
    }

    private onSegment(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): boolean {
        return p.x >= Math.min(a.x, b.x)
            && p.x <= Math.max(a.x, b.x)
            && p.y >= Math.min(a.y, b.y)
            && p.y <= Math.max(a.y, b.y);
    }
}
