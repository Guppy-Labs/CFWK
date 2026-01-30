import Phaser from 'phaser';
import { TiledObjectLayer, OccludableLayer, OccluderRegion, getTiledProperty } from './TiledTypes';

/**
 * Manages depth-based occlusion for layered sprites
 */
export class OcclusionManager {
    private regions: OccluderRegion[] = [];
    private layers: OccludableLayer[] = [];
    private playerFrontDepth: number;
    private playerOccludedDepthOffset: number;
    private activeTags: Set<string> = new Set();

    constructor(playerFrontDepth: number = 260, playerOccludedDepthOffset: number = 20) {
        this.playerFrontDepth = playerFrontDepth;
        this.playerOccludedDepthOffset = playerOccludedDepthOffset;
    }

    /**
     * Get occluder regions for debug drawing
     */
    getRegions(): OccluderRegion[] {
        return this.regions;
    }

    /**
     * Get occludable layers
     */
    getLayers(): OccludableLayer[] {
        return this.layers;
    }

    /**
     * Register an occludable layer
     */
    addOccludableLayer(layer: Phaser.Tilemaps.TilemapLayer, baseDepth: number, tag: string, order: number) {
        this.layers.push({ layer, baseDepth, tag, order });
    }

    /**
     * Setup occluder regions from the Occluders object layer
     */
    setupFromObjectLayers(map: Phaser.Tilemaps.Tilemap) {
        const objectLayers = map.objects as TiledObjectLayer[];
        const occluderLayer = objectLayers.find(
            (layer) => layer.type === 'objectgroup' && layer.name.toLowerCase() === 'occluders'
        );

        if (!occluderLayer) return;

        occluderLayer.objects.forEach((obj) => {
            if (!obj.polygon || obj.polygon.length < 3) return;

            const points = obj.polygon.map(
                (p) => new Phaser.Math.Vector2((obj.x || 0) + p.x, (obj.y || 0) + p.y)
            );

            const targetsRaw = getTiledProperty(obj, 'Targets')
                ?? getTiledProperty(obj, 'Occludes')
                ?? getTiledProperty(obj, 'OcclusionTags');

            const targetTags = typeof targetsRaw === 'string'
                ? targetsRaw.split(',').map((t) => t.trim()).filter(Boolean)
                : null;

            this.regions.push({ polygon: points, targetTags });
        });
    }

    /**
     * Update layer depths based on player position
     */
    update(player: Phaser.Physics.Matter.Sprite) {
        // Clear active tags
        this.activeTags.clear();
        
        if (this.regions.length === 0) return;

        // Reset layers to base depth
        this.layers.forEach((entry) => entry.layer.setDepth(entry.baseDepth));

        const bottomLeft = player.getBottomLeft();
        const bottomRight = player.getBottomRight();
        const y = bottomLeft.y;

        this.regions.forEach((region) => {
            if (!this.isSegmentIntersectingPolygon(bottomLeft.x, y, bottomRight.x, y, region.polygon)) return;

            if (region.targetTags && region.targetTags.length > 0) {
                region.targetTags.forEach((tag) => this.activeTags.add(tag));
            } else {
                this.layers.forEach((entry) => this.activeTags.add(entry.tag));
            }
        });

        if (this.activeTags.size === 0) return;

        // Find the lowest-order occluded layer to preserve ordering above it
        let minActiveOrder = Infinity;
        this.activeTags.forEach((tag) => {
            const layer = this.layers.find(l => l.tag === tag);
            if (layer && layer.order < minActiveOrder) minActiveOrder = layer.order;
        });

        this.layers.forEach((entry) => {
            const shouldElevate = entry.order >= minActiveOrder;
            if (!shouldElevate) return;

            const elevatedDepth = this.playerFrontDepth + this.playerOccludedDepthOffset + entry.order;
            const maxDepth = this.getMaxDepthBelowHigherLayers(entry);
            const finalDepth = maxDepth !== null ? Math.min(elevatedDepth, maxDepth) : elevatedDepth;
            entry.layer.setDepth(finalDepth);
        });
    }

    /**
     * Get the highest depth a layer can be raised to without surpassing higher layers
     */
    private getMaxDepthBelowHigherLayers(entry: OccludableLayer): number | null {
        let nearestHigher: OccludableLayer | null = null;

        for (const layer of this.layers) {
            if (layer.baseDepth <= entry.baseDepth) continue;
            if (layer.layer.depth <= this.playerFrontDepth) continue;
            if (!nearestHigher || layer.baseDepth < nearestHigher.baseDepth) {
                nearestHigher = layer;
            }
        }

        if (!nearestHigher) return null;

        // Keep this layer just below the nearest higher layer's current depth
        const higherDepth = nearestHigher.layer.depth;
        return higherDepth - 1;
    }

    /**
     * Check if a layer tag is currently being occluded (elevated in front of player)
     */
    isTagOccluded(tag: string): boolean {
        return this.activeTags.has(tag);
    }

    /**
     * Get a copy of currently active occlusion tags
     */
    getActiveTags(): Set<string> {
        return new Set(this.activeTags);
    }

    /**
     * Get the elevated depth for a layer when it's occluded
     */
    getOccludedDepth(tag: string): number {
        const layer = this.layers.find(l => l.tag === tag);
        if (layer) {
            return this.playerFrontDepth + this.playerOccludedDepthOffset + layer.order;
        }
        return this.playerFrontDepth + this.playerOccludedDepthOffset;
    }

    /**
     * Get the maximum occluded depth for a set of tags
     */
    getMaxOccludedDepthForTags(tags: Set<string>): number {
        if (tags.size === 0) return this.playerFrontDepth + this.playerOccludedDepthOffset;
        let max = -Infinity;
        tags.forEach((tag) => {
            const depth = this.getOccludedDepth(tag);
            if (depth > max) max = depth;
        });
        return max === -Infinity ? this.playerFrontDepth + this.playerOccludedDepthOffset : max;
    }

    /**
     * Get the base depth for a layer by tag
     */
    getBaseDepthForTag(tag: string): number {
        const layer = this.layers.find(l => l.tag === tag);
        return layer?.baseDepth ?? 200;
    }

    /**
     * Check if a sprite is inside an occlusion region
     * Returns true if the sprite should be occluded (behind layers)
     */
    isInOcclusionRegion(x: number, y: number, halfWidth: number = 4): boolean {
        if (this.regions.length === 0) return false;

        const footLeftX = x - halfWidth;
        const footRightX = x + halfWidth;

        for (const region of this.regions) {
            if (this.isSegmentIntersectingPolygon(footLeftX, y, footRightX, y, region.polygon)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get the set of occlusion tags affecting a position
     */
    getOcclusionTagsAt(x: number, y: number, halfWidth: number = 4): Set<string> {
        const tags = new Set<string>();
        if (this.regions.length === 0) return tags;

        const footLeftX = x - halfWidth;
        const footRightX = x + halfWidth;

        for (const region of this.regions) {
            if (!this.isSegmentIntersectingPolygon(footLeftX, y, footRightX, y, region.polygon)) continue;

            if (region.targetTags && region.targetTags.length > 0) {
                region.targetTags.forEach((tag) => tags.add(tag));
            } else {
                this.layers.forEach((entry) => tags.add(entry.tag));
            }
        }

        return tags;
    }

    /**
     * Get the minimum base depth for a set of tags
     */
    getMinBaseDepthForTags(tags: Set<string>): number {
        if (tags.size === 0) return this.getOccludableBaseDepth();
        let min = Infinity;
        tags.forEach((tag) => {
            const depth = this.getBaseDepthForTag(tag);
            if (depth < min) min = depth;
        });
        return min === Infinity ? this.getOccludableBaseDepth() : min;
    }

    /**
     * Get the base depth for occludable layers
     */
    getOccludableBaseDepth(): number {
        // Return the lowest base depth of any occludable layer
        if (this.layers.length === 0) return 200;
        return Math.min(...this.layers.map(l => l.baseDepth));
    }

    private isPointInPolygon(x: number, y: number, polygon: Phaser.Math.Vector2[]): boolean {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;

            const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
            if (intersect) inside = !inside;
        }
        return inside;
    }

    private isSegmentIntersectingPolygon(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        polygon: Phaser.Math.Vector2[]
    ): boolean {
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        if (this.isPointInPolygon(midX, midY, polygon)) return true;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const x3 = polygon[j].x;
            const y3 = polygon[j].y;
            const x4 = polygon[i].x;
            const y4 = polygon[i].y;

            if (this.segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4)) return true;
        }

        return false;
    }

    private segmentsIntersect(
        x1: number, y1: number, x2: number, y2: number,
        x3: number, y3: number, x4: number, y4: number
    ): boolean {
        const d1 = this.direction(x3, y3, x4, y4, x1, y1);
        const d2 = this.direction(x3, y3, x4, y4, x2, y2);
        const d3 = this.direction(x1, y1, x2, y2, x3, y3);
        const d4 = this.direction(x1, y1, x2, y2, x4, y4);

        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
            return true;
        }

        return (
            (d1 === 0 && this.onSegment(x3, y3, x4, y4, x1, y1)) ||
            (d2 === 0 && this.onSegment(x3, y3, x4, y4, x2, y2)) ||
            (d3 === 0 && this.onSegment(x1, y1, x2, y2, x3, y3)) ||
            (d4 === 0 && this.onSegment(x1, y1, x2, y2, x4, y4))
        );
    }

    private direction(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): number {
        return (x3 - x1) * (y2 - y1) - (x2 - x1) * (y3 - y1);
    }

    private onSegment(x1: number, y1: number, x2: number, y2: number, x: number, y: number): boolean {
        return (
            Math.min(x1, x2) <= x && x <= Math.max(x1, x2) &&
            Math.min(y1, y2) <= y && y <= Math.max(y1, y2)
        );
    }
}
