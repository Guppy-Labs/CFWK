import Phaser from 'phaser';
import { getTiledProperty } from '../map/TiledTypes';

export interface ZoomRegion {
    polygon: { x: number; y: number }[];
    zoomMultiplier: number;
}

export type CameraControllerOptions = {
    zoom?: number;
    /** Reference viewport size in world pixels - all screens will see this much area */
    referenceViewport?: { width: number; height: number };
    /** Smooth zoom transition speed (0-1, higher = faster) */
    zoomLerpSpeed?: number;
};

export class CameraController {
    private scene: Phaser.Scene;
    private camera: Phaser.Cameras.Scene2D.Camera;
    private map: Phaser.Tilemaps.Tilemap;
    private target: Phaser.GameObjects.GameObject;
    private baseZoom: number;
    private referenceViewport: { width: number; height: number };
    
    // Zoom regions
    private zoomRegions: ZoomRegion[] = [];
    private currentZoom: number;
    private targetZoom: number;
    private zoomLerpSpeed: number;

    constructor(
        scene: Phaser.Scene,
        map: Phaser.Tilemaps.Tilemap,
        target: Phaser.GameObjects.GameObject,
        options: CameraControllerOptions = {}
    ) {
        this.scene = scene;
        this.camera = scene.cameras.main;
        this.map = map;
        this.target = target;

        this.baseZoom = options.zoom ?? 2;
        this.zoomLerpSpeed = options.zoomLerpSpeed ?? 0.05;
        // Reference viewport: all players see at most this many world pixels
        // Default to 384x288 (12x9 tiles at 32px) for a fair view
        this.referenceViewport = options.referenceViewport ?? { width: 384, height: 288 };
        
        // Initialize zoom tracking
        this.currentZoom = this.baseZoom;
        this.targetZoom = this.baseZoom;
        
        this.camera.setZoom(this.baseZoom);
        this.camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        this.camera.setRoundPixels(false);
        this.camera.startFollow(target, false, 1, 1);
        this.camera.setDeadzone(0, 0);

        // Load zoom regions from map
        this.loadZoomRegions();

        this.scene.scale.on('resize', this.handleResize, this);
        this.handleResize(this.scene.scale.gameSize);
    }

    /**
     * Load zoom regions from the map's "Zooms" object layer
     */
    private loadZoomRegions() {
        const zoomsLayer = this.map.objects?.find(layer => layer.name === 'Zooms');
        if (!zoomsLayer) {
            console.log('[CameraController] No Zooms layer found in map');
            return;
        }

        zoomsLayer.objects.forEach(obj => {
            if (!obj.polygon) return;
            
            const zoomMultiplier = getTiledProperty(obj, 'Zoom') as number | undefined;
            if (zoomMultiplier === undefined) return;
            
            // Convert polygon points to world coordinates (add object x,y offset)
            const worldPolygon = obj.polygon.map((point: { x: number; y: number }) => ({
                x: (obj.x ?? 0) + point.x,
                y: (obj.y ?? 0) + point.y
            }));
            
            this.zoomRegions.push({
                polygon: worldPolygon,
                zoomMultiplier
            });
            
            console.log(`[CameraController] Added zoom region with multiplier ${zoomMultiplier}`);
        });
        
        console.log(`[CameraController] Loaded ${this.zoomRegions.length} zoom region(s)`);
    }

    /**
     * Update camera zoom based on player feet line segment
     * Call this from the game update loop
     */
    update(feetLeftX: number, feetRightX: number, feetY: number) {
        // Check if feet line segment intersects any zoom region
        let newTargetZoom = this.baseZoom;
        
        for (const region of this.zoomRegions) {
            if (this.isSegmentIntersectingPolygon(feetLeftX, feetY, feetRightX, feetY, region.polygon)) {
                newTargetZoom = this.baseZoom * region.zoomMultiplier;
                break; // Use first matching region
            }
        }
        
        this.targetZoom = newTargetZoom;
        
        // Smoothly lerp toward target zoom
        if (Math.abs(this.currentZoom - this.targetZoom) > 0.001) {
            this.currentZoom = Phaser.Math.Linear(this.currentZoom, this.targetZoom, this.zoomLerpSpeed);
            this.camera.setZoom(this.currentZoom);
        }
    }
    
    /**
     * Check if a line segment intersects a polygon
     */
    private isSegmentIntersectingPolygon(
        x1: number, y1: number,
        x2: number, y2: number,
        polygon: { x: number; y: number }[]
    ): boolean {
        // Check if midpoint is inside
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        if (this.isPointInPolygon(midX, midY, polygon)) return true;
        
        // Check if segment intersects any polygon edge
        const n = polygon.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const x3 = polygon[j].x;
            const y3 = polygon[j].y;
            const x4 = polygon[i].x;
            const y4 = polygon[i].y;
            
            if (this.segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4)) return true;
        }
        
        return false;
    }
    
    /**
     * Check if two line segments intersect
     */
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
    
    /**
     * Point-in-polygon test using ray casting algorithm
     */
    private isPointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
        let inside = false;
        const n = polygon.length;
        
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }
    
    /**
     * Get current zoom level
     */
    getCurrentZoom(): number {
        return this.currentZoom;
    }
    
    /**
     * Get target zoom level
     */
    getTargetZoom(): number {
        return this.targetZoom;
    }
    
    /**
     * Get all zoom regions for debug display
     */
    getZoomRegions(): ZoomRegion[] {
        return this.zoomRegions;
    }

    destroy() {
        this.scene.scale.off('resize', this.handleResize, this);
    }

    private handleResize(gameSize: Phaser.Structs.Size) {
        this.camera.setViewport(0, 0, gameSize.width, gameSize.height);

        // Calculate zoom so that viewport shows at most referenceViewport world pixels
        // Use the smaller dimension ratio (max zoom) so no one sees more than the reference
        const zoomX = gameSize.width / this.referenceViewport.width;
        const zoomY = gameSize.height / this.referenceViewport.height;
        const fairZoom = Math.min(zoomX, zoomY);

        // Also ensure we fill the map (no black bars) if the map is smaller than reference
        const fillZoomX = gameSize.width / this.map.widthInPixels;
        const fillZoomY = gameSize.height / this.map.heightInPixels;
        const fillZoom = Math.max(fillZoomX, fillZoomY);

        // Update base zoom and recalculate current/target zoom proportionally
        const newBaseZoom = Math.max(fairZoom, fillZoom);
        const currentRatio = this.currentZoom / this.baseZoom;
        const targetRatio = this.targetZoom / this.baseZoom;
        
        this.baseZoom = newBaseZoom;
        this.currentZoom = newBaseZoom * currentRatio;
        this.targetZoom = newBaseZoom * targetRatio;
        
        this.camera.setZoom(this.currentZoom);
    }
}
