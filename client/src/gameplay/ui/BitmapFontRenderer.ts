import Phaser from 'phaser';

type FontProvider = {
    type: string;
    file: string;
    height?: number;
    ascent?: number;
    chars: string[];
};

type FontMapJson = {
    providers?: FontProvider[];
};

type GlyphPosition = {
    textureKey: string;
    glyphWidth: number;
    col: number;
    row: number;
    glyphHeight: number;
    ascent: number;
};

type DrawTextOptions = {
    scale?: number;
    charGap?: number;
};

const FILE_TO_TEXTURE_KEY: Record<string, string> = {
    'ascii.png': 'ui-font-ascii',
    'accented.png': 'ui-font-accented',
    'nonlatin_european.png': 'ui-font-nonlatin-european'
};

export class BitmapFontRenderer {
    private readonly scene: Phaser.Scene;
    private readonly baseGlyphWidth: number;
    private readonly baseGlyphHeight: number;
    private readonly baseAscent: number;
    private readonly glyphMap = new Map<string, GlyphPosition>();
    private readonly glyphWidths = new Map<string, number>();
    private readonly atlasByTextureKey = new Map<string, HTMLImageElement | HTMLCanvasElement>();
    private mapLoaded = false;

    constructor(scene: Phaser.Scene, glyphSize = 8) {
        this.scene = scene;
        this.baseGlyphWidth = glyphSize;
        this.baseGlyphHeight = glyphSize;
        this.baseAscent = glyphSize - 1;
    }

    measureTextWidth(text: string, options: DrawTextOptions = {}): number {
        if (!text.length) return 0;

        const scale = options.scale ?? 1;
        const charGap = options.charGap ?? 1;
        const chars = Array.from(text);
        let width = 0;

        chars.forEach((ch, index) => {
            width += Math.round(this.getGlyphWidth(ch) * scale);
            if (index < chars.length - 1) {
                width += charGap;
            }
        });

        return width;
    }

    drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, options: DrawTextOptions = {}): number {
        if (!text.length) return 0;

        const scale = options.scale ?? 1;
        const charGap = options.charGap ?? 1;
        const chars = Array.from(text);

        let cursorX = x;
        chars.forEach((ch, index) => {
            const glyph = this.getGlyphPosition(ch);
            if (glyph) {
                const atlas = this.getAtlasImage(glyph.textureKey);
                if (atlas) {
                    const sx = glyph.col * glyph.glyphWidth;
                    const sy = glyph.row * glyph.glyphHeight;
                    const drawY = y + Math.round((this.baseAscent - glyph.ascent) * scale);
                    ctx.drawImage(
                        atlas,
                        sx,
                        sy,
                        glyph.glyphWidth,
                        glyph.glyphHeight,
                        cursorX,
                        drawY,
                        Math.round(glyph.glyphWidth * scale),
                        Math.round(glyph.glyphHeight * scale)
                    );
                }
            }

            cursorX += Math.round(this.getGlyphWidth(ch) * scale);
            if (index < chars.length - 1) {
                cursorX += charGap;
            }
        });

        return cursorX - x;
    }

    private ensureMapLoaded() {
        if (this.mapLoaded) return;
        this.mapLoaded = true;

        const map = this.scene.cache.json.get('ui-font-map') as FontMapJson | undefined;
        const providers = map?.providers;
        if (!providers || !Array.isArray(providers)) return;

        providers.forEach((provider) => {
            const textureKey = FILE_TO_TEXTURE_KEY[provider.file];
            if (!textureKey) return;
            if (!this.scene.textures.exists(textureKey)) return;

            const atlas = this.getAtlasImage(textureKey);
            if (!atlas) return;

            const maxColumns = provider.chars.reduce((max, row) => Math.max(max, Array.from(row ?? '').length), 0);
            const providerGlyphWidth = maxColumns > 0 ? Math.floor(atlas.width / maxColumns) : this.baseGlyphWidth;
            const providerGlyphHeight = Number.isFinite(provider.height) ? Number(provider.height) : this.baseGlyphHeight;
            const providerAscent = Number.isFinite(provider.ascent) ? Number(provider.ascent) : this.baseAscent;

            for (let row = 0; row < provider.chars.length; row++) {
                const glyphRow = provider.chars[row] ?? '';
                const chars = Array.from(glyphRow);
                for (let col = 0; col < chars.length; col++) {
                    const ch = chars[col];
                    if (!ch || ch === '\u0000' || this.glyphMap.has(ch)) continue;
                    this.glyphMap.set(ch, {
                        textureKey,
                        glyphWidth: providerGlyphWidth,
                        col,
                        row,
                        glyphHeight: providerGlyphHeight,
                        ascent: providerAscent
                    });
                }
            }
        });
    }

    private getGlyphPosition(ch: string): GlyphPosition | null {
        this.ensureMapLoaded();
        return this.glyphMap.get(ch) ?? null;
    }

    private getAtlasImage(textureKey: string): HTMLImageElement | HTMLCanvasElement | null {
        const cached = this.atlasByTextureKey.get(textureKey);
        if (cached) return cached;
        if (!this.scene.textures.exists(textureKey)) return null;

        const texture = this.scene.textures.get(textureKey);
        const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement | null;
        if (!source) return null;

        this.atlasByTextureKey.set(textureKey, source);
        return source;
    }

    private getGlyphWidth(ch: string): number {
        if (this.glyphWidths.has(ch)) {
            return this.glyphWidths.get(ch)!;
        }

        const glyph = this.getGlyphPosition(ch);
        if (!glyph) {
            this.glyphWidths.set(ch, this.baseGlyphWidth);
            return this.baseGlyphWidth;
        }

        const atlas = this.getAtlasImage(glyph.textureKey);
        if (!atlas) {
            this.glyphWidths.set(ch, this.baseGlyphWidth);
            return this.baseGlyphWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = glyph.glyphWidth;
        canvas.height = glyph.glyphHeight;
        const ctx = canvas.getContext('2d')!;

        const sx = glyph.col * glyph.glyphWidth;
        const sy = glyph.row * glyph.glyphHeight;
        ctx.drawImage(atlas, sx, sy, glyph.glyphWidth, glyph.glyphHeight, 0, 0, glyph.glyphWidth, glyph.glyphHeight);

        const data = ctx.getImageData(0, 0, glyph.glyphWidth, glyph.glyphHeight).data;
        let rightmost = -1;

        for (let x = glyph.glyphWidth - 1; x >= 0; x--) {
            let hasPixel = false;
            for (let y = 0; y < glyph.glyphHeight; y++) {
                const idx = (y * glyph.glyphWidth + x) * 4 + 3;
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
        this.glyphWidths.set(ch, width);
        return width;
    }
}
