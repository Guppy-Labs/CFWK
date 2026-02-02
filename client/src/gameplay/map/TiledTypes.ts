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
    tiles?: {
        id: number;
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
