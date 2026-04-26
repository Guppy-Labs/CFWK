import Phaser from 'phaser';
import type { FootstepSurface } from './AudioManager';

const TRACKED_LAYERS = new Set(['Ground', 'Stone', 'Dock']);

const LAYER_TO_SURFACE: Record<string, FootstepSurface> = {
    Dock: 'wood',
    Stone: 'stone',
    Ground: 'grass'
};

export function getFootstepSurfaceAt(
    map: Phaser.Tilemaps.Tilemap,
    worldX: number,
    worldY: number,
    mapFile: string
): FootstepSurface {
    if (!mapFile.startsWith('anchor-hollow')) {
        return 'sand';
    }

    let bestDepth = Number.NEGATIVE_INFINITY;
    let bestLayerName: string | null = null;

    map.layers.forEach((layerData) => {
        if (!TRACKED_LAYERS.has(layerData.name)) return;
        const layer = layerData.tilemapLayer;
        if (!layer || !layer.visible || layer.alpha <= 0) return;
        const tile = layer.getTileAtWorldXY(worldX, worldY, false);
        if (!tile || tile.index < 0) return;

        const depth = layer.depth ?? 0;
        if (depth >= bestDepth) {
            bestDepth = depth;
            bestLayerName = layerData.name;
        }
    });

    return (bestLayerName && LAYER_TO_SURFACE[bestLayerName]) ?? 'sand';
}
