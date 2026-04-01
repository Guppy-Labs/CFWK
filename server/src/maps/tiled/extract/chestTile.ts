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

    for (let index = 0; index < chestLayer.data.length; index += 1) {
        const tileId = Number(chestLayer.data[index] ?? 0);
        if (!Number.isFinite(tileId) || tileId <= 0) continue;
        const tileX = index % width;
        const tileY = Math.floor(index / width);
        return {
            componentId: options.componentId,
            centerX: layerOffsetX + (tileX * tileSize) + tileSize * 0.5,
            centerY: layerOffsetY + (tileY * tileSize) + tileSize * 0.5,
            radiusPx: options.radiusPx
        };
    }

    return null;
}
