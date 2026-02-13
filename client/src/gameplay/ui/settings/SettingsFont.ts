import Phaser from 'phaser';

export class SettingsFont {
    private static instanceCounter = 0;
    private scene: Phaser.Scene;
    private fontGlyphWidths = new Map<string, number>();
    private textureCounter = 0;
    private readonly instanceId: number;

    private readonly fontCharSize = 8;
    private readonly fontCharGap = 1;
    private readonly fontMap = [
        '                ',
        '                ',
        ' !"#$%&\'()*+,-./',
        '0123456789:;<=>?',
        '@ABCDEFGHIJKLMNO',
        'PQRSTUVWXYZ[\\]^_',
        '`abcdefghijklmno',
        'pqrstuvwxyz{|}~ '
    ];

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.instanceId = SettingsFont.instanceCounter++;
    }

    createTextTexture(text: string, color: string): string {
        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;
        const width = Math.max(1, this.measureBitmapTextWidth(text));
        const height = this.fontCharSize;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        let cursorX = 0;
        for (const ch of text) {
            const pos = this.findGlyph(ch);
            if (pos) {
                const sx = pos.col * this.fontCharSize;
                const sy = pos.row * this.fontCharSize;
                ctx.drawImage(fontImage, sx, sy, this.fontCharSize, this.fontCharSize, cursorX, 0, this.fontCharSize, this.fontCharSize);

                const glyphWidth = this.getGlyphWidth(fontImage, ch);
                cursorX += glyphWidth + this.fontCharGap;
            } else {
                cursorX += this.fontCharSize + this.fontCharGap;
            }
        }

        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__settings_text_${this.instanceId}_${this.textureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    measureBitmapTextWidth(text: string): number {
        if (!text.length) return 0;

        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;

        let width = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const glyphWidth = this.getGlyphWidth(fontImage, ch);
            width += glyphWidth;
            if (i < text.length - 1) width += this.fontCharGap;
        }
        return width;
    }

    private findGlyph(ch: string) {
        for (let row = 0; row < this.fontMap.length; row++) {
            const col = this.fontMap[row].indexOf(ch);
            if (col !== -1) return { row, col };
        }
        return null;
    }

    private getGlyphWidth(fontImage: HTMLImageElement, ch: string): number {
        if (this.fontGlyphWidths.has(ch)) {
            return this.fontGlyphWidths.get(ch)!;
        }

        const pos = this.findGlyph(ch);
        if (!pos) {
            this.fontGlyphWidths.set(ch, this.fontCharSize);
            return this.fontCharSize;
        }

        const canvas = document.createElement('canvas');
        canvas.width = this.fontCharSize;
        canvas.height = this.fontCharSize;
        const ctx = canvas.getContext('2d')!;

        const sx = pos.col * this.fontCharSize;
        const sy = pos.row * this.fontCharSize;
        ctx.drawImage(fontImage, sx, sy, this.fontCharSize, this.fontCharSize, 0, 0, this.fontCharSize, this.fontCharSize);

        const data = ctx.getImageData(0, 0, this.fontCharSize, this.fontCharSize).data;
        let rightmost = -1;
        for (let x = this.fontCharSize - 1; x >= 0; x--) {
            let hasPixel = false;
            for (let y = 0; y < this.fontCharSize; y++) {
                const idx = (y * this.fontCharSize + x) * 4 + 3;
                if (data[idx] > 0) {
                    hasPixel = true;
                    break;
                }
            }
            if (hasPixel) {
                rightmost = x;
                break;
            }
        }

        const width = Math.max(1, rightmost + 1);
        this.fontGlyphWidths.set(ch, width);
        return width;
    }
}
