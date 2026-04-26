import { ChestInteractionTarget } from "../../../rooms/instance/InstanceRoomSchema";
import { findTileLayer } from "../layers";
import { TiledMap } from "../types";

export function extractGlimmeringChestTarget(
    map: TiledMap,
    options: { componentId: string; radiusPx: number }
): ChestInteractionTarget | null {
    const chestLayer = findTileLayer(map, "chest");
    if (!chestLayer || !Array.isArray(chestLayer.data)) return null;

    const width = Number.isFinite(chestLayer.width) ? Math.max(1, Math.floor(Number(chestLayer.width))) : 0;
    if (width <= 0) return null;

    const layerOffsetX = Number(chestLayer.x ?? 0);
    const layerOffsetY = Number(chestLayer.y ?? 0);
    const tileSize = 32;

    // Use the bounding-box centroid of every non-empty tile so multi-tile
    // chests anchor to their visual center instead of the first tile in
    // scan order (client uses the same math in findTileLayerCenter).
    let minTx = Number.POSITIVE_INFINITY;
    let minTy = Number.POSITIVE_INFINITY;
    let maxTx = Number.NEGATIVE_INFINITY;
    let maxTy = Number.NEGATIVE_INFINITY;
    let found = false;

    for (let index = 0; index < chestLayer.data.length; index += 1) {
        const tileId = Number(chestLayer.data[index] ?? 0);
        if (!Number.isFinite(tileId) || tileId <= 0) continue;
        const tileX = index % width;
        const tileY = Math.floor(index / width);
        if (tileX < minTx) minTx = tileX;
        if (tileY < minTy) minTy = tileY;
        if (tileX > maxTx) maxTx = tileX;
        if (tileY > maxTy) maxTy = tileY;
        found = true;
    }

    if (!found) return null;

    return {
        componentId: options.componentId,
        centerX: layerOffsetX + ((minTx + maxTx + 1) * 0.5) * tileSize,
        centerY: layerOffsetY + ((minTy + maxTy + 1) * 0.5) * tileSize,
        radiusPx: options.radiusPx
    };
}
