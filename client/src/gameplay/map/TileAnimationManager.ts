import Phaser from 'phaser';
import { TilesetEntry } from './TiledTypes';

type AnimationData = {
    frames: { gid: number; duration: number }[];
    currentFrame: number;
    elapsed: number;
};

type AnimatedTileLocation = {
    layer: Phaser.Tilemaps.TilemapLayer;
    x: number;
    y: number;
    baseGid: number;
};

/**
 * Manages animated tiles from Tiled map data
 */
export class TileAnimationManager {
    private animations: Map<number, AnimationData> = new Map();
    private locations: AnimatedTileLocation[] = [];

    /**
     * Parse animation data from tilesets and find all animated tile locations
     */
    setup(map: Phaser.Tilemaps.Tilemap, tilesetKeys: TilesetEntry[]) {
        this.animations.clear();
        this.locations = [];

        // Build animation lookup: gid -> animation data
        tilesetKeys.forEach(({ tileset }) => {
            const firstGid = tileset.firstgid || 1;
            const tiles = tileset.tiles;

            if (!tiles) return;

            tiles.forEach((tileData) => {
                if (!tileData.animation || tileData.animation.length === 0) return;

                const baseGid = firstGid + tileData.id;
                const frames = tileData.animation.map((frame) => ({
                    gid: firstGid + frame.tileid,
                    duration: frame.duration
                }));

                this.animations.set(baseGid, {
                    frames,
                    currentFrame: 0,
                    elapsed: 0
                });
            });
        });

        // Find all tiles in all layers that use animated gids
        map.layers.forEach((layerData) => {
            const layer = map.getLayer(layerData.name)?.tilemapLayer;
            if (!layer) return;

            for (let ty = 0; ty < map.height; ty++) {
                for (let tx = 0; tx < map.width; tx++) {
                    const tile = layer.getTileAt(tx, ty);
                    if (!tile || tile.index === -1) continue;

                    if (this.animations.has(tile.index)) {
                        this.locations.push({
                            layer,
                            x: tx,
                            y: ty,
                            baseGid: tile.index
                        });
                    }
                }
            }
        });
    }

    /**
     * Update all animated tiles based on elapsed time
     */
    update(delta: number) {
        // Update animation timers
        this.animations.forEach((anim) => {
            anim.elapsed += delta;
            const currentFrameDuration = anim.frames[anim.currentFrame].duration;

            while (anim.elapsed >= currentFrameDuration) {
                anim.elapsed -= currentFrameDuration;
                anim.currentFrame = (anim.currentFrame + 1) % anim.frames.length;
            }
        });

        // Update all animated tile locations
        this.locations.forEach(({ layer, x, y, baseGid }) => {
            const anim = this.animations.get(baseGid);
            if (!anim) return;

            const tile = layer.getTileAt(x, y);
            if (!tile) return;

            const newGid = anim.frames[anim.currentFrame].gid;
            if (tile.index !== newGid) {
                layer.putTileAt(newGid, x, y);
            }
        });
    }
}
