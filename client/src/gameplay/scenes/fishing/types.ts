export type TileSnapshotData = {
    canvas: HTMLCanvasElement;
    playerTileCol: number;
    playerTileRow: number;
};

export type FishingSceneData = {
    rodItemId?: string;
    tileSnapshot?: TileSnapshotData | null;
};

export type WorldTime = {
    season: number;
    hour: number;
    minute: number;
    second: number;
    brightness: number;
};
