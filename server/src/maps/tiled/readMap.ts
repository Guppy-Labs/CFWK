import fs from "fs";
import { TiledMap } from "./types";
import { resolveServerMapPath } from "./resolveMapPath";

type MapCacheEntry = {
    map: TiledMap;
    path: string;
    mtimeMs: number;
};

const mapCacheByFile = new Map<string, MapCacheEntry>();

export function readTiledMapFromPath(fullPath: string): TiledMap {
    const raw = fs.readFileSync(fullPath, "utf8");
    return JSON.parse(raw) as TiledMap;
}

export function loadTiledMap(mapFileName: string): TiledMap | null {
    const fullPath = resolveServerMapPath(mapFileName);
    if (!fullPath) return null;

    try {
        const stat = fs.statSync(fullPath);
        const mtimeMs = Number(stat.mtimeMs || 0);
        const cached = mapCacheByFile.get(mapFileName);
        if (cached && cached.path === fullPath && cached.mtimeMs === mtimeMs) {
            return cached.map;
        }

        const map = readTiledMapFromPath(fullPath);
        mapCacheByFile.set(mapFileName, { map, path: fullPath, mtimeMs });
        return map;
    } catch {
        return readTiledMapFromPath(fullPath);
    }
}
