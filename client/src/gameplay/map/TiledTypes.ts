/**
 * Type definitions for Tiled map data structures
 */

export type TiledMapObject = {
    id?: number;
    name?: string;
    type?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    gid?: number;
    flippedHorizontal?: boolean;
    flippedVertical?: boolean;
    flippedAntiDiagonal?: boolean;
    rotation?: number;
    visible?: boolean;
    point?: boolean;
    polygon?: { x: number; y: number }[];
    properties?: { name: string; type: string; value: any }[];
};

export type TiledObjectLayer = {
    name: string;
    type: 'objectgroup';
    properties?: { name: string; type: string; value: any }[];
    objects: TiledMapObject[];
};

// Use a custom type for tileset data since Phaser's internal types may vary
export type TiledTilesetData = {
    name: string;
    firstgid: number;
    tilewidth?: number;
    tileheight?: number;
    margin?: number;
    spacing?: number;
    image?: string;
    columns?: number;
    tilecount?: number;
    tileoffset?: {
        x?: number;
        y?: number;
    };
    tiles?: {
        id: number;
        image?: string;
        imagewidth?: number;
        imageheight?: number;
        animation?: { duration: number; tileid: number }[];
    }[];
};

export type TilesetEntry = {
    tileset: TiledTilesetData;
    key: string;
    padding?: number;
};

export type OccludableLayer = {
    layer: Phaser.Tilemaps.TilemapLayer;
    baseDepth: number;
    tag: string;
    order: number;
};

/**
 * An object-tile layer (Tiled `objectgroup` containing tile GID objects).
 * Rendered as individual `Phaser.GameObjects.Image` instances that share
 * the same depth and can be elevated by the OcclusionManager.
 */
export type OccludableObjectGroup = {
    images: Phaser.GameObjects.Image[];
    baseDepth: number;
    tag: string;
    order: number;
};

export type OccluderRegion = {
    polygon: Phaser.Math.Vector2[];
    targetTags: string[] | null;
};

/**
 * Helper to get a property value from a Tiled layer or object
 */
export function getTiledProperty(
    obj: { properties?: { name: string; type: string; value: any }[] },
    name: string
): any {
    const props = obj.properties as any;
    if (Array.isArray(props)) {
        return props.find((p: { name: string }) => p.name === name)?.value;
    }
    if (props && typeof props === 'object') {
        return props[name];
    }
    return undefined;
}
