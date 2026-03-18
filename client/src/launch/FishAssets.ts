import { Assets, Texture } from 'pixi.js';

// Match the game loading screen pool exactly:
// top 4 rows from the fish tilesheet (18 columns x 4 rows = 72 entries).
const LOADER_TILE_COLUMNS = 18;
const LOADER_TILE_ROWS = 4;
const FISH_TILE_ID_POOL: number[] = Array.from(
    { length: LOADER_TILE_COLUMNS * LOADER_TILE_ROWS },
    (_v, index) => index
);

function tilePath(tileId: number): string {
    return `/assets/fish/tile${String(tileId).padStart(3, '0')}.png`;
}

function pickTileIdsWithReplacement(count: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < count; i += 1) {
        const randomIndex = Math.floor(Math.random() * FISH_TILE_ID_POOL.length);
        result.push(FISH_TILE_ID_POOL[randomIndex]);
    }
    return result;
}

export async function createFishTexturePool(size: number): Promise<Texture[]> {
    const uniqueIds = Array.from(new Set(FISH_TILE_ID_POOL));
    const textureById = new Map<number, Texture>();

    await Promise.all(uniqueIds.map(async (id) => {
        const texture = await Assets.load<Texture>(tilePath(id));
        textureById.set(id, texture);
    }));

    const pickedIds = pickTileIdsWithReplacement(size);
    return pickedIds
        .map((id) => textureById.get(id))
        .filter((texture): texture is Texture => Boolean(texture));
}

export function randomFishCountForHighDensity(width: number, height: number): number {
    const area = width * height;
    const baseline = Math.floor(area / 19000);
    const randomized = baseline + Math.floor(Math.random() * 18) - 8;
    return Math.max(45, Math.min(90, randomized));
}
