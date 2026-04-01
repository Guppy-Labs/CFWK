import fs from "fs";
import path from "path";

export function resolveServerMapPath(mapFileName: string): string | null {
    const candidates = [
        path.resolve(__dirname, '../../../../client/public/maps', mapFileName),
        path.resolve(__dirname, '../../../client/public/maps', mapFileName),
        path.resolve(process.cwd(), '../client/public/maps', mapFileName),
        path.resolve(process.cwd(), 'client/public/maps', mapFileName)
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
}
