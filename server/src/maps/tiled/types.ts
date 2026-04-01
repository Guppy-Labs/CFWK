export type TiledProperty = {
    name: string;
    value: unknown;
    type?: string;
};

export type TiledMapObject = {
    id?: number;
    name?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    polygon?: Array<{ x: number; y: number }>;
    properties?: TiledProperty[] | Record<string, unknown>;
};

export type TiledLayer = {
    name?: string;
    type?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    data?: unknown[];
    objects?: TiledMapObject[];
    properties?: TiledProperty[] | Record<string, unknown>;
};

export type TiledMap = {
    width?: number;
    height?: number;
    tilewidth?: number;
    tileheight?: number;
    properties?: TiledProperty[];
    layers?: TiledLayer[];
};
