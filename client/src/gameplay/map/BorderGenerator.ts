import Phaser from 'phaser';

/**
 * Configuration for generated border
 */
export interface BorderConfig {
    /** Number of tile-widths of padding beyond the last ground tile */
    padding: number;
    /** Smoothing factor for corners (higher = smoother, 0 = no smoothing) */
    smoothingIterations?: number;
    /** Minimum distance between polygon points */
    minPointDistance?: number;
}

/**
 * Result of border generation
 */
export interface GeneratedBorder {
    /** The smoothed polygon points in world coordinates */
    polygon: { x: number; y: number }[];
    /** Whether a border was actually generated */
    generated: boolean;
}

/**
 * BorderGenerator - Automatically generates smooth containment borders
 * based on the walkable Ground layer tiles.
 * 
 * Features:
 * - Analyzes Ground layer to find walkable area
 * - Adds configurable padding beyond tiles
 * - Smooths corners using Chaikin's algorithm
 * - Creates a containment polygon for CollisionManager
 */
export class BorderGenerator {
    private scene: Phaser.Scene;
    // Adjust this to control how rounded the border is (higher = rounder)
    private readonly borderRoundnessIterations = 2;
    
    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }
    
    /**
     * Check if a map has the Border Pad property and generate border if so
     */
    generateFromMap(
        map: Phaser.Tilemaps.Tilemap,
        groundLayers: Phaser.Tilemaps.TilemapLayer[],
        mapKey: string
    ): GeneratedBorder {
        // Get raw map data to check for Border Pad property
        const mapCache = this.scene.cache.tilemap.get(mapKey);
        const mapData = mapCache?.data as { properties?: { name: string; value: any }[] } | undefined;
        
        // Look for Border Pad property
        const borderPadProp = mapData?.properties?.find(p => p.name === 'Border Pad');
        if (!borderPadProp) {
            console.log('[BorderGenerator] No "Border Pad" property found on map');
            return { polygon: [], generated: false };
        }
        
        const padding = Number(borderPadProp.value) || 1;
        console.log(`[BorderGenerator] Found Border Pad: ${padding} tiles`);
        
        return this.generateBorder(map, groundLayers, {
            padding,
            smoothingIterations: this.borderRoundnessIterations,
            minPointDistance: 8
        });
    }
    
    /**
     * Generate a smoothed border polygon from ground layers
     */
    private generateBorder(
        map: Phaser.Tilemaps.Tilemap,
        groundLayers: Phaser.Tilemaps.TilemapLayer[],
        config: BorderConfig
    ): GeneratedBorder {
        const tileWidth = map.tileWidth;
        const tileHeight = map.tileHeight;
        
        // Create a grid to track which tiles have ground
        const gridWidth = map.width;
        const gridHeight = map.height;
        const hasGround: boolean[][] = Array(gridHeight).fill(null).map(() => Array(gridWidth).fill(false));
        
        // Prefer ground layers that are not water for containment borders
        const sourceLayers = groundLayers.filter((layer) => {
            const name = layer.layer?.name?.toLowerCase() ?? '';
            return name !== 'water';
        });

        const layersToUse = sourceLayers.length > 0 ? sourceLayers : groundLayers;

        if (sourceLayers.length === 0 && groundLayers.length > 0) {
            console.warn('[BorderGenerator] No non-water ground layers found; falling back to all ground layers');
        }

        // Mark all tiles that have ground
        for (const layer of layersToUse) {
            for (let y = 0; y < gridHeight; y++) {
                for (let x = 0; x < gridWidth; x++) {
                    const tile = layer.getTileAt(x, y);
                    if (tile && tile.index !== -1) {
                        hasGround[y][x] = true;
                    }
                }
            }
        }
        
        // Expand grid outward by padding tiles (square/chebyshev distance)
        const paddingTiles = Math.max(0, Math.round(config.padding));
        const expandedGrid = paddingTiles > 0
            ? this.expandGrid(hasGround, gridWidth, gridHeight, paddingTiles)
            : hasGround;

        // Trace the boundary from the expanded grid (ordered polygon)
        const boundaryPoints = this.extractBoundary(expandedGrid, gridWidth, gridHeight, tileWidth, tileHeight);
        
        if (boundaryPoints.length < 3) {
            console.warn('[BorderGenerator] Not enough boundary points found');
            return { polygon: [], generated: false };
        }
        
        // Smooth the polygon using Chaikin's algorithm
        let smoothedPoints = boundaryPoints;
        const iterations = config.smoothingIterations ?? this.borderRoundnessIterations;
        for (let i = 0; i < iterations; i++) {
            smoothedPoints = this.chaikinSmooth(smoothedPoints);
        }

        // Simplify to remove points that are too close together
        const minDist = config.minPointDistance ?? 8;
        const finalPoints = this.simplifyPolygon(smoothedPoints, minDist);
        
        console.log(`[BorderGenerator] Generated border with ${finalPoints.length} points (from ${boundaryPoints.length} boundary points)`);
        
        return {
            polygon: finalPoints,
            generated: true
        };
    }
    
    /**
     * Extract boundary points from a boolean grid using marching squares
     */
    private extractBoundary(
        grid: boolean[][],
        width: number,
        height: number,
        tileWidth: number,
        tileHeight: number
    ): { x: number; y: number }[] {
        type Edge = { start: string; end: string };

        const edges: Edge[] = [];
        const edgesByStart = new Map<string, number[]>();

        const addEdge = (sx: number, sy: number, ex: number, ey: number) => {
            const start = `${sx},${sy}`;
            const end = `${ex},${ey}`;
            const index = edges.length;
            edges.push({ start, end });
            const list = edgesByStart.get(start);
            if (list) {
                list.push(index);
            } else {
                edgesByStart.set(start, [index]);
            }
        };

        // Build boundary edges in tile units (CCW around filled cells)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (!grid[y][x]) continue;

                const upEmpty = y === 0 || !grid[y - 1]?.[x];
                const rightEmpty = x === width - 1 || !grid[y]?.[x + 1];
                const downEmpty = y === height - 1 || !grid[y + 1]?.[x];
                const leftEmpty = x === 0 || !grid[y]?.[x - 1];

                if (upEmpty) addEdge(x, y, x + 1, y);
                if (rightEmpty) addEdge(x + 1, y, x + 1, y + 1);
                if (downEmpty) addEdge(x + 1, y + 1, x, y + 1);
                if (leftEmpty) addEdge(x, y + 1, x, y);
            }
        }

        if (edges.length === 0) {
            return [];
        }

        // Trace loops from directed edges
        const used = new Set<number>();
        const loops: { x: number; y: number }[][] = [];

        for (let i = 0; i < edges.length; i++) {
            if (used.has(i)) continue;

            const loop: { x: number; y: number }[] = [];
            let currentIndex = i;
            const startKey = edges[i].start;

            while (true) {
                if (used.has(currentIndex)) break;
                used.add(currentIndex);

                const edge = edges[currentIndex];
                const [sx, sy] = edge.start.split(',').map(Number);
                loop.push({ x: sx * tileWidth, y: sy * tileHeight });

                const nextStart = edge.end;
                if (nextStart === startKey) {
                    break;
                }

                const nextEdges = edgesByStart.get(nextStart) ?? [];
                const nextIndex = nextEdges.find((idx) => !used.has(idx));
                if (nextIndex === undefined) {
                    break;
                }
                currentIndex = nextIndex;
            }

            if (loop.length >= 3) {
                loops.push(loop);
            }
        }

        if (loops.length === 0) {
            return [];
        }

        // Choose the largest loop by absolute area
        let bestLoop = loops[0];
        let bestArea = Math.abs(this.computePolygonArea(bestLoop));
        for (let i = 1; i < loops.length; i++) {
            const area = Math.abs(this.computePolygonArea(loops[i]));
            if (area > bestArea) {
                bestArea = area;
                bestLoop = loops[i];
            }
        }

        return bestLoop;
    }

    /**
     * Expand grid by padding tiles (square/chebyshev distance)
     */
    private expandGrid(
        grid: boolean[][],
        width: number,
        height: number,
        padding: number
    ): boolean[][] {
        const expanded: boolean[][] = Array(height)
            .fill(null)
            .map(() => Array(width).fill(false));

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (!grid[y][x]) continue;

                for (let dy = -padding; dy <= padding; dy++) {
                    for (let dx = -padding; dx <= padding; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                        if (Math.max(Math.abs(dx), Math.abs(dy)) <= padding) {
                            expanded[ny][nx] = true;
                        }
                    }
                }
            }
        }

        return expanded;
    }

    /**
     * Compute signed polygon area
     */
    private computePolygonArea(points: { x: number; y: number }[]): number {
        let area = 0;
        const n = points.length;
        for (let i = 0; i < n; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % n];
            area += p1.x * p2.y - p2.x * p1.y;
        }
        return area / 2;
    }
    
    
    /**
     * Smooth a polygon using Chaikin's corner-cutting algorithm
     */
    private chaikinSmooth(points: { x: number; y: number }[]): { x: number; y: number }[] {
        if (points.length < 3) return points;
        
        const result: { x: number; y: number }[] = [];
        const n = points.length;
        
        for (let i = 0; i < n; i++) {
            const p0 = points[i];
            const p1 = points[(i + 1) % n];
            
            // Add two new points at 25% and 75% of each edge
            result.push({
                x: p0.x * 0.75 + p1.x * 0.25,
                y: p0.y * 0.75 + p1.y * 0.25
            });
            result.push({
                x: p0.x * 0.25 + p1.x * 0.75,
                y: p0.y * 0.25 + p1.y * 0.75
            });
        }
        
        return result;
    }
    
    /**
     * Simplify polygon by removing points closer than minDistance
     */
    private simplifyPolygon(
        points: { x: number; y: number }[],
        minDistance: number
    ): { x: number; y: number }[] {
        if (points.length < 3) return points;
        
        const result: { x: number; y: number }[] = [points[0]];
        const minDistSq = minDistance * minDistance;
        
        for (let i = 1; i < points.length; i++) {
            const last = result[result.length - 1];
            const curr = points[i];
            const dx = curr.x - last.x;
            const dy = curr.y - last.y;
            
            if (dx * dx + dy * dy >= minDistSq) {
                result.push(curr);
            }
        }
        
        // Check if first and last points are too close
        if (result.length > 2) {
            const first = result[0];
            const last = result[result.length - 1];
            const dx = first.x - last.x;
            const dy = first.y - last.y;
            if (dx * dx + dy * dy < minDistSq) {
                result.pop();
            }
        }
        
        return result;
    }
}
