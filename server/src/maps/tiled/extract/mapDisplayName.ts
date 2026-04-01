import { TiledMap } from "../types";

function humanizeMapName(mapFileName: string): string {
    const base = mapFileName.replace(/\.tmj$/i, "").replace(/[-_]+/g, " ").trim();
    if (!base) return "Unknown Region";
    return base
        .split(" ")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

export function extractMapDisplayName(map: TiledMap | null, mapFileName: string): string {
    if (!map || !Array.isArray(map.properties)) return humanizeMapName(mapFileName);
    const nameProp = map.properties.find((property) => property.name === "Name");
    if (nameProp && typeof nameProp.value === "string" && nameProp.value.trim().length > 0) {
        return nameProp.value.trim();
    }
    return humanizeMapName(mapFileName);
}
