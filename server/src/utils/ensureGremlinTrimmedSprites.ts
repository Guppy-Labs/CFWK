import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

type GremlinAnimSpec = {
    name: 'idle' | 'walk' | 'attack' | 'death';
    frames: number;
    sourceFile: string;
    outputFile: string;
};

type CropRect = {
    left: number;
    top: number;
    width: number;
    height: number;
};

type TrimMetaAnimation = {
    frameWidth: number;
    frameHeight: number;
    frames: number;
    file: string;
};

type GremlinTrimMeta = {
    version: 1;
    sourceFrame: { width: number; height: number };
    generatedAt: string;
    animations: {
        idle: TrimMetaAnimation;
        walk: TrimMetaAnimation;
        attack: TrimMetaAnimation;
        death: TrimMetaAnimation;
    };
};

type FrameBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

const SOURCE_FRAME_WIDTH = 256;
const SOURCE_FRAME_HEIGHT = 256;
const ALPHA_THRESHOLD = 1;
const META_FILENAME = 'trim.meta.json';

const SPECS: GremlinAnimSpec[] = [
    { name: 'idle', frames: 9, sourceFile: 'idle.png', outputFile: 'idle.trim.png' },
    { name: 'walk', frames: 8, sourceFile: 'walk.png', outputFile: 'walk.trim.png' },
    { name: 'attack', frames: 16, sourceFile: 'attack.png', outputFile: 'attack.trim.png' },
    { name: 'death', frames: 12, sourceFile: 'death.png', outputFile: 'death.trim.png' }
];

function resolveGremlinVariantDir(): string | null {
    const candidates = [
        path.resolve(process.cwd(), 'client/public/assets/npc/gremlin/variant1'),
        path.resolve(process.cwd(), '../client/public/assets/npc/gremlin/variant1'),
        path.resolve(__dirname, '../../../client/public/assets/npc/gremlin/variant1'),
        path.resolve(__dirname, '../../../../client/public/assets/npc/gremlin/variant1')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

async function getFrameBounds(imagePath: string, frameIndex: number): Promise<FrameBounds | null> {
    const { data, info } = await sharp(imagePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const frameStartX = frameIndex * SOURCE_FRAME_WIDTH;

    let minX = SOURCE_FRAME_WIDTH;
    let minY = SOURCE_FRAME_HEIGHT;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < SOURCE_FRAME_HEIGHT; y += 1) {
        for (let x = 0; x < SOURCE_FRAME_WIDTH; x += 1) {
            const globalX = frameStartX + x;
            const idx = (y * info.width + globalX) * channels;
            const alpha = data[idx + 3];
            if (alpha < ALPHA_THRESHOLD) continue;

            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }

    if (maxX < minX || maxY < minY) {
        return null;
    }

    return {
        left: minX,
        top: minY,
        right: maxX,
        bottom: maxY
    };
}

function resolveCropFromBounds(bounds: FrameBounds): CropRect {
    return {
        left: bounds.left,
        top: bounds.top,
        width: bounds.right - bounds.left + 1,
        height: bounds.bottom - bounds.top + 1
    };
}

async function detectBoundsForSpec(baseDir: string, spec: GremlinAnimSpec): Promise<CropRect> {
    const sourcePath = path.join(baseDir, spec.sourceFile);
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`[GremlinTrim] Missing source sheet: ${sourcePath}`);
    }

    let minLeft = SOURCE_FRAME_WIDTH;
    let minTop = SOURCE_FRAME_HEIGHT;
    let maxRight = -1;
    let maxBottom = -1;

    for (let frame = 0; frame < spec.frames; frame += 1) {
        const bounds = await getFrameBounds(sourcePath, frame);
        if (!bounds) continue;
        if (bounds.left < minLeft) minLeft = bounds.left;
        if (bounds.top < minTop) minTop = bounds.top;
        if (bounds.right > maxRight) maxRight = bounds.right;
        if (bounds.bottom > maxBottom) maxBottom = bounds.bottom;
    }

    if (maxRight < minLeft || maxBottom < minTop) {
        throw new Error(`[GremlinTrim] Failed to detect non-transparent bounds for ${spec.name}`);
    }

    return resolveCropFromBounds({
        left: minLeft,
        top: minTop,
        right: maxRight,
        bottom: maxBottom
    });
}

async function writeTrimmedSheet(baseDir: string, spec: GremlinAnimSpec, crop: CropRect) {
    const sourcePath = path.join(baseDir, spec.sourceFile);
    const outputPath = path.join(baseDir, spec.outputFile);

    const compositeInputs: Array<{ input: Buffer; left: number; top: number }> = [];
    for (let frame = 0; frame < spec.frames; frame += 1) {
        const extracted = await sharp(sourcePath)
            .extract({
                left: frame * SOURCE_FRAME_WIDTH + crop.left,
                top: crop.top,
                width: crop.width,
                height: crop.height
            })
            .png()
            .toBuffer();

        compositeInputs.push({
            input: extracted,
            left: frame * crop.width,
            top: 0
        });
    }

    await sharp({
        create: {
            width: crop.width * spec.frames,
            height: crop.height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
        .composite(compositeInputs)
        .png()
        .toFile(outputPath);
}

async function writeTrimMetadata(baseDir: string, animationMeta: GremlinTrimMeta['animations']): Promise<void> {
    const metaPath = path.join(baseDir, META_FILENAME);
    const payload: GremlinTrimMeta = {
        version: 1,
        sourceFrame: {
            width: SOURCE_FRAME_WIDTH,
            height: SOURCE_FRAME_HEIGHT
        },
        generatedAt: new Date().toISOString(),
        animations: animationMeta
    };

    fs.writeFileSync(metaPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function ensureGremlinTrimmedSpritesOnStart(): Promise<void> {
    const baseDir = resolveGremlinVariantDir();
    if (!baseDir) {
        console.warn('[GremlinTrim] Gremlin asset directory not found. Skipping trim generation.');
        return;
    }

    const cropsByAnim = new Map<GremlinAnimSpec['name'], CropRect>();
    for (const spec of SPECS) {
        const crop = await detectBoundsForSpec(baseDir, spec);
        cropsByAnim.set(spec.name, crop);
    }

    const animationMeta = {
        idle: { frameWidth: 0, frameHeight: 0, frames: 0, file: '' },
        walk: { frameWidth: 0, frameHeight: 0, frames: 0, file: '' },
        attack: { frameWidth: 0, frameHeight: 0, frames: 0, file: '' },
        death: { frameWidth: 0, frameHeight: 0, frames: 0, file: '' }
    };

    for (const spec of SPECS) {
        const crop = cropsByAnim.get(spec.name);
        if (!crop) continue;
        await writeTrimmedSheet(baseDir, spec, crop);
        animationMeta[spec.name] = {
            frameWidth: crop.width,
            frameHeight: crop.height,
            frames: spec.frames,
            file: spec.outputFile
        };
    }

    await writeTrimMetadata(baseDir, animationMeta);

    console.log('[GremlinTrim] Generated trim sheets + trim.meta.json on startup.');
}
