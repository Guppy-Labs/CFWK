import { TiledProperty } from "./types";

export function getTiledProperty(
    properties: TiledProperty[] | Record<string, unknown> | undefined,
    propertyName: string
): unknown {
    if (!properties) return undefined;
    if (Array.isArray(properties)) {
        const normalized = propertyName.trim().toLowerCase();
        const found = properties.find((property) => String(property.name).trim().toLowerCase() === normalized);
        return found?.value;
    }
    return properties[propertyName];
}
