import { ICharacterAppearance, MCDirection, MC_FRAME_DIMENSIONS, MC_FRAMES_PER_ANIMATION } from '@cfwk/shared';
import { applyColorShift } from '../gameplay/player/ColorShift';

const MC_ASSET_BASE = '/assets/char/mc';

const DIRECTION_SOURCE_MAP: Record<MCDirection, { source: 'N' | 'E' | 'S' | 'NE' | 'SE'; mirror: boolean }> = {
    N: { source: 'N', mirror: false },
    S: { source: 'S', mirror: false },
    E: { source: 'E', mirror: false },
    W: { source: 'E', mirror: true },
    NE: { source: 'NE', mirror: false },
    SE: { source: 'SE', mirror: false },
    NW: { source: 'NE', mirror: true },
    SW: { source: 'SE', mirror: true }
};

type LayerType = 'body' | 'cape' | 'scarf' | 'head';

interface LoadedImage {
    img: HTMLImageElement;
    width: number;
    height: number;
}

interface PreparedLayer {
    image: HTMLCanvasElement | HTMLImageElement;
    type: LayerType;
}

const imageCache = new Map<string, LoadedImage>();

function getAssetPath(animType: 'walk', layerType: LayerType, direction: 'N' | 'E' | 'S' | 'NE' | 'SE'): string {
    if (layerType === 'body') {
        return `${MC_ASSET_BASE}/${animType}/body/${animType}_${direction}_body.png`;
    }
    if (layerType === 'head') {
        return `${MC_ASSET_BASE}/${animType}/head/${animType}_${direction}_head.png`;
    }
    return `${MC_ASSET_BASE}/${animType}/accessories/base/${layerType}/${animType}_${direction}_${layerType}.png`;
}

async function loadImage(path: string): Promise<LoadedImage> {
    if (imageCache.has(path)) {
        return imageCache.get(path)!;
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const loaded: LoadedImage = { img, width: img.width, height: img.height };
            imageCache.set(path, loaded);
            resolve(loaded);
        };
        img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
        img.src = path;
    });
}

function getLayerShift(layerType: LayerType, appearance: ICharacterAppearance) {
    switch (layerType) {
        case 'body':
            return appearance.body;
        case 'head':
            return appearance.head;
        case 'cape':
            return appearance.accessories.cape;
        case 'scarf':
            return appearance.accessories.neck;
        default:
            return { hueShift: 0, brightnessShift: 0 };
    }
}

function drawLayerFrame(
    ctx: CanvasRenderingContext2D,
    source: HTMLCanvasElement | HTMLImageElement,
    frameIndex: number,
    frameWidth: number,
    frameHeight: number,
    mirror: boolean,
    scale: number
) {
    const sx = frameIndex * frameWidth;
    const sy = 0;
    const dw = frameWidth * scale;
    const dh = frameHeight * scale;

    ctx.save();
    if (mirror) {
        ctx.translate(dw, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(source, sx, sy, frameWidth, frameHeight, 0, 0, dw, dh);
    } else {
        ctx.drawImage(source, sx, sy, frameWidth, frameHeight, 0, 0, dw, dh);
    }
    ctx.restore();
}

export async function renderCharacterPreview(
    canvas: HTMLCanvasElement,
    appearance: ICharacterAppearance,
    direction: MCDirection = 'S',
    scale: number = 3
): Promise<void> {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { source, mirror } = DIRECTION_SOURCE_MAP[direction];
    const frameDimensions = MC_FRAME_DIMENSIONS[direction];
    const frameWidth = frameDimensions.width;
    const frameHeight = frameDimensions.height;

    canvas.width = frameWidth * scale;
    canvas.height = frameHeight * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const bodyPath = getAssetPath('walk', 'body', source);
    const headPath = getAssetPath('walk', 'head', source);

    const bodyImg = await loadImage(bodyPath);
    const headImg = await loadImage(headPath);

    const layers: { img: LoadedImage; type: LayerType }[] = [{ img: bodyImg, type: 'body' }];

    if (appearance.accessories.cape.equipped) {
        try {
            const capeImg = await loadImage(getAssetPath('walk', 'cape', source));
            layers.push({ img: capeImg, type: 'cape' });
        } catch {
            // Ignore missing cape
        }
    }

    if (appearance.accessories.neck.equipped) {
        try {
            const scarfImg = await loadImage(getAssetPath('walk', 'scarf', source));
            layers.push({ img: scarfImg, type: 'scarf' });
        } catch {
            // Ignore missing scarf
        }
    }

    const isNorth = direction === 'N' || direction === 'NE' || direction === 'NW';
    const orderedLayers: { img: LoadedImage; type: LayerType }[] = [];

    const bodyLayer = layers.find(layer => layer.type === 'body');
    const capeLayer = layers.find(layer => layer.type === 'cape');
    const scarfLayer = layers.find(layer => layer.type === 'scarf');

    if (bodyLayer) orderedLayers.push(bodyLayer);
    if (capeLayer) orderedLayers.push(capeLayer);

    if (isNorth) {
        orderedLayers.push({ img: headImg, type: 'head' });
        if (scarfLayer) orderedLayers.push(scarfLayer);
    } else {
        if (scarfLayer) orderedLayers.push(scarfLayer);
        orderedLayers.push({ img: headImg, type: 'head' });
    }

    for (const layer of orderedLayers) {
        const shift = getLayerShift(layer.type, appearance);
        const sourceImage = shift.hueShift !== 0 || shift.brightnessShift !== 0
            ? applyColorShift(layer.img.img, shift.hueShift, shift.brightnessShift)
            : layer.img.img;

        drawLayerFrame(ctx, sourceImage, 1, frameWidth, frameHeight, mirror, scale);
    }
}

/**
 * Animated character preview for the skin editor
 */
export class AnimatedCharacterPreview {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private appearance: ICharacterAppearance;
    private direction: MCDirection;
    private scale: number;
    private frameIndex: number = 0;
    private animationId: number | null = null;
    private lastFrameTime: number = 0;
    private frameInterval: number = 100; // ms per frame
    private preparedLayers: PreparedLayer[] = [];
    private frameWidth: number = 0;
    private frameHeight: number = 0;
    private mirror: boolean = false;

    constructor(canvas: HTMLCanvasElement, scale: number = 3) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.appearance = { body: { hueShift: 0, brightnessShift: 0 }, head: { hueShift: 0, brightnessShift: 0 }, accessories: { cape: { equipped: false, hueShift: 0, brightnessShift: 0 }, neck: { equipped: false, hueShift: 0, brightnessShift: 0 } } };
        this.direction = 'S';
        this.scale = scale;
    }

    async setAppearance(appearance: ICharacterAppearance, direction: MCDirection = 'S'): Promise<void> {
        this.appearance = appearance;
        this.direction = direction;
        await this.prepareLayers();
    }

    private async prepareLayers(): Promise<void> {
        const { source, mirror } = DIRECTION_SOURCE_MAP[this.direction];
        this.mirror = mirror;
        const frameDimensions = MC_FRAME_DIMENSIONS[this.direction];
        this.frameWidth = frameDimensions.width;
        this.frameHeight = frameDimensions.height;

        this.canvas.width = this.frameWidth * this.scale;
        this.canvas.height = this.frameHeight * this.scale;

        const bodyPath = getAssetPath('walk', 'body', source);
        const headPath = getAssetPath('walk', 'head', source);

        const bodyImg = await loadImage(bodyPath);
        const headImg = await loadImage(headPath);

        const layers: { img: LoadedImage; type: LayerType }[] = [{ img: bodyImg, type: 'body' }];

        if (this.appearance.accessories.cape.equipped) {
            try {
                const capeImg = await loadImage(getAssetPath('walk', 'cape', source));
                layers.push({ img: capeImg, type: 'cape' });
            } catch {
                // Ignore missing cape
            }
        }

        if (this.appearance.accessories.neck.equipped) {
            try {
                const scarfImg = await loadImage(getAssetPath('walk', 'scarf', source));
                layers.push({ img: scarfImg, type: 'scarf' });
            } catch {
                // Ignore missing scarf
            }
        }

        const isNorth = this.direction === 'N' || this.direction === 'NE' || this.direction === 'NW';
        const orderedLayers: { img: LoadedImage; type: LayerType }[] = [];

        const bodyLayer = layers.find(layer => layer.type === 'body');
        const capeLayer = layers.find(layer => layer.type === 'cape');
        const scarfLayer = layers.find(layer => layer.type === 'scarf');

        if (bodyLayer) orderedLayers.push(bodyLayer);
        if (capeLayer) orderedLayers.push(capeLayer);

        if (isNorth) {
            orderedLayers.push({ img: headImg, type: 'head' });
            if (scarfLayer) orderedLayers.push(scarfLayer);
        } else {
            if (scarfLayer) orderedLayers.push(scarfLayer);
            orderedLayers.push({ img: headImg, type: 'head' });
        }

        // Pre-apply color shifts
        this.preparedLayers = orderedLayers.map(layer => {
            const shift = getLayerShift(layer.type, this.appearance);
            const image = shift.hueShift !== 0 || shift.brightnessShift !== 0
                ? applyColorShift(layer.img.img, shift.hueShift, shift.brightnessShift)
                : layer.img.img;
            return { image, type: layer.type };
        });
    }

    private renderFrame(): void {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.imageSmoothingEnabled = false;

        for (const layer of this.preparedLayers) {
            drawLayerFrame(this.ctx, layer.image, this.frameIndex, this.frameWidth, this.frameHeight, this.mirror, this.scale);
        }
    }

    private animate = (timestamp: number): void => {
        if (timestamp - this.lastFrameTime >= this.frameInterval) {
            this.frameIndex = (this.frameIndex + 1) % MC_FRAMES_PER_ANIMATION;
            this.renderFrame();
            this.lastFrameTime = timestamp;
        }
        this.animationId = requestAnimationFrame(this.animate);
    };

    start(): void {
        if (this.animationId !== null) return;
        this.renderFrame();
        this.animationId = requestAnimationFrame(this.animate);
    }

    stop(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    destroy(): void {
        this.stop();
        this.preparedLayers = [];
    }
}
