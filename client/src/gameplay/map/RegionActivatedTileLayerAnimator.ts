import Phaser from 'phaser';
import { getTiledProperty, TiledMapObject, TiledObjectLayer } from './TiledTypes';

export type RegionActivatedTileLayerAnimationSpec = {
    activationComponentId: string;
    layerSpecialId: string;
    frameRateFps?: number;
    onActiveChanged?: (active: boolean) => void;
};

type ResolvedAnimationSpec = {
    activationComponentId: string;
    layerSpecialId: string;
    frameRateFps: number;
    onActiveChanged?: (active: boolean) => void;
};

type ActivationRegion =
    | {
        kind: 'polygon';
        points: Array<{ x: number; y: number }>;
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    }
    | {
        kind: 'rect';
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };

type AnimatedTile = {
    tile: Phaser.Tilemaps.Tile;
    baseIndex: number;
    localColumn: number;
};

type LayerBinding = {
    spec: ResolvedAnimationSpec;
    tiles: AnimatedTile[];
    frameStrideTiles: number;
    maxFrameIndex: number;
    frameValue: number;
    renderedFrame: number;
    isActive: boolean;
    hasResolvedInitialState: boolean;
    regions: ActivationRegion[];
};

/**
 * Animates tile-layer components while the player is inside matching
 * interactive regions. It shifts tile GIDs horizontally across frame columns,
 * preserving the layer's existing render/depth/occlusion behavior.
 */
export class RegionActivatedTileLayerAnimator {
    private readonly bindings: LayerBinding[] = [];

    constructor(
        map: Phaser.Tilemaps.Tilemap,
        specs: RegionActivatedTileLayerAnimationSpec[]
    ) {
        const normalizedSpecs: ResolvedAnimationSpec[] = specs
            .map((spec) => ({
                activationComponentId: spec.activationComponentId.trim().toLowerCase(),
                layerSpecialId: spec.layerSpecialId.trim().toLowerCase(),
                frameRateFps: Number.isFinite(spec.frameRateFps) && Number(spec.frameRateFps) > 0
                    ? Number(spec.frameRateFps)
                    : 14,
                onActiveChanged: spec.onActiveChanged
            }))
            .filter((spec) => spec.activationComponentId.length > 0 && spec.layerSpecialId.length > 0);

        if (normalizedSpecs.length === 0) return;

        const regionsByComponentId = this.extractRegionsByComponentId(map);
        for (const spec of normalizedSpecs) {
            const regions = regionsByComponentId.get(spec.activationComponentId) || [];
            if (regions.length === 0) continue;

            const layerData = map.layers.find((layer) => {
                const specialIdRaw = getTiledProperty(layer as unknown as { properties?: { name: string; type: string; value: unknown }[] }, 'specialid');
                const specialId = typeof specialIdRaw === 'string' ? specialIdRaw.trim().toLowerCase() : '';
                return specialId === spec.layerSpecialId;
            });
            if (!layerData?.tilemapLayer) continue;

            const tileRows = layerData.tilemapLayer.layer?.data;
            if (!Array.isArray(tileRows) || tileRows.length === 0) continue;

            const animatedTiles: AnimatedTile[] = [];
            let minTileX = Number.POSITIVE_INFINITY;
            let maxTileX = Number.NEGATIVE_INFINITY;
            let sampleTileIndex = -1;

            for (const row of tileRows) {
                for (const tile of row) {
                    if (!tile || !Number.isFinite(tile.index) || tile.index < 0) continue;
                    const index = Number(tile.index);
                    if (!Number.isFinite(index) || index <= 0) continue;
                    if (sampleTileIndex < 0) sampleTileIndex = index;
                    minTileX = Math.min(minTileX, tile.x);
                    maxTileX = Math.max(maxTileX, tile.x);
                    animatedTiles.push({
                        tile,
                        baseIndex: index,
                        localColumn: 0
                    });
                }
            }

            if (animatedTiles.length === 0 || !Number.isFinite(minTileX) || !Number.isFinite(maxTileX)) continue;
            const frameStrideTiles = Math.max(1, Math.floor(maxTileX - minTileX + 1));

            const tileset = map.tilesets.find((set) => {
                const total = Number(set.total ?? 0);
                return sampleTileIndex >= set.firstgid && sampleTileIndex < (set.firstgid + total);
            });
            if (!tileset) continue;

            const tilesetColumns = Number(tileset.columns ?? 0);
            if (!Number.isFinite(tilesetColumns) || tilesetColumns <= 0) continue;

            let maxFrameIndex = Number.POSITIVE_INFINITY;
            for (const animatedTile of animatedTiles) {
                const localIndex = animatedTile.baseIndex - tileset.firstgid;
                const localColumn = localIndex % tilesetColumns;
                animatedTile.localColumn = localColumn;
                const maxAdditionalFrames = Math.floor((tilesetColumns - 1 - localColumn) / frameStrideTiles);
                maxFrameIndex = Math.min(maxFrameIndex, maxAdditionalFrames);
            }

            const resolvedMaxFrameIndex = Number.isFinite(maxFrameIndex)
                ? Math.max(0, Math.floor(maxFrameIndex))
                : 0;
            if (resolvedMaxFrameIndex <= 0) continue;

            this.bindings.push({
                spec,
                tiles: animatedTiles,
                frameStrideTiles,
                maxFrameIndex: resolvedMaxFrameIndex,
                frameValue: 0,
                renderedFrame: 0,
                isActive: false,
                hasResolvedInitialState: false,
                regions
            });
        }
    }

    update(playerX: number, playerY: number, deltaMs: number) {
        if (this.bindings.length === 0) return;
        const dtSec = Math.max(0, deltaMs) / 1000;

        for (const binding of this.bindings) {
            const active = binding.regions.some((region) => this.isPointInsideRegion(playerX, playerY, region));
            if (!binding.hasResolvedInitialState) {
                binding.isActive = active;
                binding.hasResolvedInitialState = true;
            } else if (active !== binding.isActive) {
                binding.isActive = active;
                try {
                    binding.spec.onActiveChanged?.(active);
                } catch (error) {
                    console.error('[RegionActivatedTileLayerAnimator] Active-change callback failed:', error);
                }
            }
            const targetFrameValue = active ? binding.maxFrameIndex : 0;

            if (binding.frameValue < targetFrameValue) {
                binding.frameValue = Math.min(
                    targetFrameValue,
                    binding.frameValue + binding.spec.frameRateFps * dtSec
                );
            } else if (binding.frameValue > targetFrameValue) {
                binding.frameValue = Math.max(
                    targetFrameValue,
                    binding.frameValue - binding.spec.frameRateFps * dtSec
                );
            }

            const nextFrame = Math.max(0, Math.min(binding.maxFrameIndex, Math.round(binding.frameValue)));
            if (nextFrame === binding.renderedFrame) continue;

            const tileOffset = nextFrame * binding.frameStrideTiles;
            for (const animatedTile of binding.tiles) {
                animatedTile.tile.index = animatedTile.baseIndex + tileOffset;
            }
            binding.renderedFrame = nextFrame;
        }
    }

    destroy() {
        for (const binding of this.bindings) {
            for (const animatedTile of binding.tiles) {
                animatedTile.tile.index = animatedTile.baseIndex;
            }
        }
    }

    private extractRegionsByComponentId(map: Phaser.Tilemaps.Tilemap): Map<string, ActivationRegion[]> {
        const byComponentId = new Map<string, ActivationRegion[]>();
        const objectLayers = map.objects as TiledObjectLayer[];
        const interactivesLayer = objectLayers.find((layer) => layer.name === 'Interactives');
        if (!interactivesLayer || !Array.isArray(interactivesLayer.objects)) {
            return byComponentId;
        }

        for (const object of interactivesLayer.objects) {
            const componentIdRaw = getTiledProperty(object, 'componentid');
            const componentId = typeof componentIdRaw === 'string' ? componentIdRaw.trim().toLowerCase() : '';
            if (!componentId) continue;

            const region = this.toActivationRegion(object);
            if (!region) continue;

            const existing = byComponentId.get(componentId) || [];
            existing.push(region);
            byComponentId.set(componentId, existing);
        }

        return byComponentId;
    }

    private toActivationRegion(object: TiledMapObject): ActivationRegion | null {
        const baseX = Number(object.x ?? 0);
        const baseY = Number(object.y ?? 0);

        if (Array.isArray(object.polygon) && object.polygon.length >= 3) {
            const points = object.polygon.map((point) => ({
                x: baseX + Number(point.x ?? 0),
                y: baseY + Number(point.y ?? 0)
            }));
            const bounds = this.getPolygonBounds(points);
            if (!bounds) return null;
            return {
                kind: 'polygon',
                points,
                minX: bounds.minX,
                maxX: bounds.maxX,
                minY: bounds.minY,
                maxY: bounds.maxY
            };
        }

        const width = Number(object.width ?? 0);
        const height = Number(object.height ?? 0);
        const minX = Math.min(baseX, baseX + width);
        const maxX = Math.max(baseX, baseX + width);
        const minY = Math.min(baseY, baseY + height);
        const maxY = Math.max(baseY, baseY + height);
        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return null;
        }
        return {
            kind: 'rect',
            minX,
            maxX,
            minY,
            maxY
        };
    }

    private getPolygonBounds(points: Array<{ x: number; y: number }>): { minX: number; maxX: number; minY: number; maxY: number } | null {
        if (points.length < 3) return null;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const point of points) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return null;
        }
        return { minX, maxX, minY, maxY };
    }

    private isPointInsideRegion(x: number, y: number, region: ActivationRegion): boolean {
        if (x < region.minX || x > region.maxX || y < region.minY || y > region.maxY) {
            return false;
        }
        if (region.kind === 'rect') return true;
        return this.isPointInPolygon(x, y, region.points);
    }

    private isPointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;
            const intersects = ((yi > y) !== (yj > y))
                && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }
}
