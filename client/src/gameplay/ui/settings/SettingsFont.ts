import Phaser from 'phaser';
import { BitmapFontRenderer } from '../BitmapFontRenderer';

export class SettingsFont {
    private static instanceCounter = 0;
    private scene: Phaser.Scene;
    private textureCounter = 0;
    private readonly instanceId: number;
    private readonly fontRenderer: BitmapFontRenderer;

    private readonly fontCharSize = 8;
    private readonly fontCharGap = 1;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.instanceId = SettingsFont.instanceCounter++;
        this.fontRenderer = new BitmapFontRenderer(scene, this.fontCharSize);
    }

    createTextTexture(text: string, color: string): string {
        const width = Math.max(1, this.measureBitmapTextWidth(text));
        const height = this.fontCharSize;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        this.fontRenderer.drawText(ctx, text, 0, 0, { charGap: this.fontCharGap });

        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__settings_text_${this.instanceId}_${this.textureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    measureBitmapTextWidth(text: string): number {
        return this.fontRenderer.measureTextWidth(text, { charGap: this.fontCharGap });
    }
}
