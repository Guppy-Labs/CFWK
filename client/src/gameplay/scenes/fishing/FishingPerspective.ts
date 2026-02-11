import Phaser from 'phaser';
import { DAYLIGHT_HOURS } from '@cfwk/shared';
import type { WorldTime } from './types';

export const WATER_TILESET_KEY = 'fishing-water-tileset';
export const WATER_TILESET_URL = encodeURI('/assets/special/ocean0a.png');

export class FishingPerspective {
    private readonly waterTileSize = 32;
    private readonly waterTilesetColumns = 8;
    private readonly waterAnimTileIds = [0, 1, 2, 3, 4, 5, 6, 7];
    private readonly waterFrameDuration = 0.1;

    private perspectiveCanvas?: HTMLCanvasElement;
    private perspectiveCtx?: CanvasRenderingContext2D;
    private perspectiveImage?: Phaser.GameObjects.Image;
    private perspectiveTextureKey?: string;

    constructor(private readonly scene: Phaser.Scene) {}

    static preload(scene: Phaser.Scene) {
        if (!scene.textures.exists(WATER_TILESET_KEY)) {
            scene.load.image(WATER_TILESET_KEY, WATER_TILESET_URL);
        }
    }

    create() {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;

        this.perspectiveCanvas = document.createElement('canvas');
        this.perspectiveCanvas.width = width;
        this.perspectiveCanvas.height = height;
        this.perspectiveCtx = this.perspectiveCanvas.getContext('2d')!;

        this.perspectiveTextureKey = '__fishing_perspective_0';
        this.scene.textures.addCanvas(this.perspectiveTextureKey, this.perspectiveCanvas);

        this.perspectiveImage = this.scene.add.image(width / 2, height / 2, this.perspectiveTextureKey).setOrigin(0.5);
        this.perspectiveImage.setDepth(0);

        if (this.scene.textures.exists(WATER_TILESET_KEY)) {
            this.scene.textures.get(WATER_TILESET_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
        }
    }

    render(worldTime: WorldTime, waterTime: number, breathTime: number, waterBreathCycleSeconds: number, waterBreathRangePx: number) {
        if (!this.perspectiveCanvas || !this.perspectiveCtx) return;
        if (!this.scene.textures.exists(WATER_TILESET_KEY)) return;

        const canvas = this.perspectiveCanvas;
        const ctx = this.perspectiveCtx;
        const screenW = this.scene.scale.width;
        const screenH = this.scene.scale.height;

        if (canvas.width !== screenW || canvas.height !== screenH) {
            canvas.width = screenW;
            canvas.height = screenH;
        }

        ctx.imageSmoothingEnabled = false;

        const tilesetImage = this.scene.textures.get(WATER_TILESET_KEY).getSourceImage() as HTMLImageElement | undefined;
        if (!tilesetImage) return;

        const breathOffset = Math.sin(breathTime * (Math.PI * 2) / waterBreathCycleSeconds) * waterBreathRangePx;
        const horizonY = screenH * 0.42 + breathOffset;
        const waterTop = horizonY;
        const waterBottom = screenH + breathOffset;

        const skyColor = this.getSkyColor(worldTime);
        ctx.fillStyle = skyColor;
        ctx.fillRect(0, 0, screenW, waterTop);

        ctx.fillStyle = '#1c4f7e';
        ctx.fillRect(0, waterTop, screenW, waterBottom - waterTop);

        const baseTileSize = this.waterTileSize * 3;
        const rows = Math.max(12, Math.ceil((waterBottom - waterTop) / (baseTileSize * 0.45))) + 1;
        const frameCount = this.waterAnimTileIds.length;

        for (let i = 0; i < rows - 1; i++) {
            const t = i / Math.max(1, rows - 1);
            const depth = Math.pow(t, 2.2);
            const nextDepth = Math.pow(Math.min(1, (i + 1) / Math.max(1, rows - 1)), 2.2);

            const y0 = waterTop + (waterBottom - waterTop) * depth;
            const y1 = waterTop + (waterBottom - waterTop) * nextDepth;
            const rowHeight = Math.max(1, y1 - y0);
            const scale = rowHeight / baseTileSize;
            const tileWidth = baseTileSize * scale;
            const cols = Math.ceil(screenW / tileWidth) + 4;

            const startX = screenW / 2 - (cols * tileWidth) / 2;

            for (let col = 0; col < cols; col++) {
                const animIndex = Math.floor((waterTime / this.waterFrameDuration + i * 0.3 + col * 0.2) % frameCount);
                const tileId = this.waterAnimTileIds[(animIndex + frameCount) % frameCount];
                const srcX = (tileId % this.waterTilesetColumns) * this.waterTileSize;
                const srcY = Math.floor(tileId / this.waterTilesetColumns) * this.waterTileSize;

                const drawX = startX + col * tileWidth;
                const drawY = y0;

                ctx.drawImage(
                    tilesetImage,
                    srcX,
                    srcY,
                    this.waterTileSize,
                    this.waterTileSize,
                    drawX,
                    drawY,
                    tileWidth + 1,
                    rowHeight + 1
                );
            }
        }

        if (this.perspectiveTextureKey && this.perspectiveCanvas) {
            if (!this.scene.textures.exists(this.perspectiveTextureKey)) {
                this.scene.textures.addCanvas(this.perspectiveTextureKey, this.perspectiveCanvas);
            } else {
                (this.scene.textures.get(this.perspectiveTextureKey) as Phaser.Textures.CanvasTexture).refresh();
            }
            this.perspectiveImage?.setTexture(this.perspectiveTextureKey);
        }
    }

    layout() {
        if (!this.perspectiveImage) return;
        this.perspectiveImage.setPosition(this.scene.scale.width / 2, this.scene.scale.height / 2);
        this.perspectiveImage.setDisplaySize(this.scene.scale.width, this.scene.scale.height);
    }

    getImage() {
        return this.perspectiveImage;
    }

    destroy() {
        this.perspectiveImage?.destroy();
        this.perspectiveImage = undefined;
        if (this.perspectiveTextureKey && this.scene.textures.exists(this.perspectiveTextureKey)) {
            this.scene.textures.remove(this.perspectiveTextureKey);
        }
        this.perspectiveTextureKey = undefined;
    }

    private getSkyColor(worldTime: WorldTime) {
        const NIGHT_COLOR = { r: 160, g: 175, b: 255 };
        const DAWN_COLOR = { r: 255, g: 200, b: 180 };
        const DAY_COLOR = { r: 170, g: 210, b: 240 };
        const DUSK_COLOR = { r: 255, g: 170, b: 140 };

        const { sunrise, sunset } = DAYLIGHT_HOURS[worldTime.season as keyof typeof DAYLIGHT_HOURS];
        const currentHour = worldTime.hour + worldTime.minute / 60 + worldTime.second / 3600;
        const transitionDuration = 1.5;

        const lerpColor = (c1: typeof NIGHT_COLOR, c2: typeof NIGHT_COLOR, t: number) => ({
            r: Math.floor(Phaser.Math.Linear(c1.r, c2.r, t)),
            g: Math.floor(Phaser.Math.Linear(c1.g, c2.g, t)),
            b: Math.floor(Phaser.Math.Linear(c1.b, c2.b, t))
        });

        let baseColor = NIGHT_COLOR;
        if (currentHour < sunrise - transitionDuration) {
            baseColor = NIGHT_COLOR;
        } else if (currentHour < sunrise + transitionDuration) {
            if (currentHour < sunrise) {
                const t = (currentHour - (sunrise - transitionDuration)) / transitionDuration;
                baseColor = lerpColor(NIGHT_COLOR, DAWN_COLOR, t);
            } else {
                const t = (currentHour - sunrise) / transitionDuration;
                baseColor = lerpColor(DAWN_COLOR, DAY_COLOR, t);
            }
        } else if (currentHour < sunset - transitionDuration) {
            baseColor = DAY_COLOR;
        } else if (currentHour < sunset + transitionDuration) {
            if (currentHour < sunset) {
                const t = (currentHour - (sunset - transitionDuration)) / transitionDuration;
                baseColor = lerpColor(DAY_COLOR, DUSK_COLOR, t);
            } else {
                const t = (currentHour - sunset) / transitionDuration;
                baseColor = lerpColor(DUSK_COLOR, NIGHT_COLOR, t);
            }
        } else {
            baseColor = NIGHT_COLOR;
        }

        const brightness = Phaser.Math.Clamp(worldTime.brightness, 0, 1);
        const r = Phaser.Math.Clamp(Math.floor(baseColor.r * brightness), 0, 255);
        const g = Phaser.Math.Clamp(Math.floor(baseColor.g * brightness), 0, 255);
        const b = Phaser.Math.Clamp(Math.floor(baseColor.b * brightness), 0, 255);

        return `rgb(${r}, ${g}, ${b})`;
    }
}
