import { TiledLayer, TiledMap } from "./types";

export function findObjectGroupLayer(map: TiledMap, layerName: string): TiledLayer | undefined {
    const wanted = layerName.trim().toLowerCase();
    return (map.layers ?? []).find(
        (layer) => layer.type === "objectgroup" && String(layer.name ?? "").trim().toLowerCase() === wanted
    );
}

export function findTileLayer(map: TiledMap, layerName: string): TiledLayer | undefined {
    const wanted = layerName.trim().toLowerCase();
    return (map.layers ?? []).find(
        (layer) => layer.type === "tilelayer" && String(layer.name ?? "").trim().toLowerCase() === wanted
    );
}

export function findObjectGroupLayersByName(map: TiledMap, layerName: string): TiledLayer[] {
    const wanted = layerName.trim().toLowerCase();
    return (map.layers ?? []).filter(
        (layer) => layer.type === "objectgroup" && String(layer.name ?? "").trim().toLowerCase() === wanted
    );
}
