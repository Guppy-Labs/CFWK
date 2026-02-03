import Phaser from 'phaser';

export type InventoryItemDetailsConfig = {
    width?: number;
    height?: number;
    offsetX?: number;
    offsetY?: number;
    frameTextureKey?: string;
    dividerTextureKey?: string;
    dividerPaddingX?: number;
    nameOffsetX?: number;
    nameOffsetY?: number;
    descriptionOffsetX?: number;
    descriptionOffsetY?: number;
    textColor?: string;
    descriptionTextColor?: string;
};

export type InventoryItemDetailsData = {
    name: string;
    description: string;
};

export const DEFAULT_ITEM_DETAILS_CONFIG: Required<InventoryItemDetailsConfig> = {
    width: 134,
    height: 72,
    offsetX: 9,
    offsetY: 6,
    frameTextureKey: 'ui-item-info-frame',
    dividerTextureKey: 'ui-item-info-divider',
    dividerPaddingX: 4,
    nameOffsetX: 6,
    nameOffsetY: 3,
    descriptionOffsetX: 6,
    descriptionOffsetY: 2,
    textColor: '#BABEC7',
    descriptionTextColor: '#9A9EA7'
};

export class InventoryItemDetailsUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private frame: Phaser.GameObjects.Image;
    private divider: Phaser.GameObjects.Image;
    private nameImage: Phaser.GameObjects.Image;
    private descriptionImage: Phaser.GameObjects.Image;

    private labelTextureCounter = 0;
    private dividerTextureCounter = 0;
    private nameTextureKey?: string;
    private descriptionTextureKey?: string;
    private frameTextureKey?: string;
    private dividerTextureKey?: string;

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
    private fontGlyphWidths = new Map<string, number>();

    private config: Required<InventoryItemDetailsConfig>;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config: InventoryItemDetailsConfig = {}) {
        this.scene = scene;
        this.config = {
            width: config.width ?? DEFAULT_ITEM_DETAILS_CONFIG.width,
            height: config.height ?? DEFAULT_ITEM_DETAILS_CONFIG.height,
            offsetX: config.offsetX ?? DEFAULT_ITEM_DETAILS_CONFIG.offsetX,
            offsetY: config.offsetY ?? DEFAULT_ITEM_DETAILS_CONFIG.offsetY,
            frameTextureKey: config.frameTextureKey ?? DEFAULT_ITEM_DETAILS_CONFIG.frameTextureKey,
            dividerTextureKey: config.dividerTextureKey ?? DEFAULT_ITEM_DETAILS_CONFIG.dividerTextureKey,
            dividerPaddingX: config.dividerPaddingX ?? DEFAULT_ITEM_DETAILS_CONFIG.dividerPaddingX,
            nameOffsetX: config.nameOffsetX ?? DEFAULT_ITEM_DETAILS_CONFIG.nameOffsetX,
            nameOffsetY: config.nameOffsetY ?? DEFAULT_ITEM_DETAILS_CONFIG.nameOffsetY,
            descriptionOffsetX: config.descriptionOffsetX ?? DEFAULT_ITEM_DETAILS_CONFIG.descriptionOffsetX,
            descriptionOffsetY: config.descriptionOffsetY ?? DEFAULT_ITEM_DETAILS_CONFIG.descriptionOffsetY,
            textColor: config.textColor ?? DEFAULT_ITEM_DETAILS_CONFIG.textColor,
            descriptionTextColor: config.descriptionTextColor ?? DEFAULT_ITEM_DETAILS_CONFIG.descriptionTextColor
        };

        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.frameTextureKey = this.createFrameTexture();
        this.frame = this.scene.add.image(0, 0, this.frameTextureKey).setOrigin(0, 0);

        this.dividerTextureKey = this.createDividerTexture();
        this.divider = this.scene.add.image(0, 0, this.dividerTextureKey).setOrigin(0, 0);

        this.nameTextureKey = this.createTextTexture('', this.config.width - this.config.nameOffsetX * 2);
        this.nameImage = this.scene.add.image(0, 0, this.nameTextureKey).setOrigin(0, 0);

        this.descriptionTextureKey = this.createTextTexture('', this.config.width - this.config.descriptionOffsetX * 2);
        this.descriptionImage = this.scene.add.image(0, 0, this.descriptionTextureKey).setOrigin(0, 0);

        this.container.add([this.frame, this.divider, this.nameImage, this.descriptionImage]);
        this.container.setVisible(false);
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    setItem(data: InventoryItemDetailsData | null) {
        if (!data) {
            this.setVisible(false);
            return;
        }

        const nameKey = this.createTextTexture(data.name, this.config.width - this.config.nameOffsetX * 2);
        const descKey = this.createTextTexture(data.description, this.config.width - this.config.descriptionOffsetX * 2, true, this.config.descriptionTextColor);

        const oldName = this.nameTextureKey;
        const oldDesc = this.descriptionTextureKey;

        this.nameTextureKey = nameKey;
        this.descriptionTextureKey = descKey;
        this.nameImage.setTexture(nameKey);
        this.descriptionImage.setTexture(descKey);

        if (oldName && this.scene.textures.exists(oldName)) this.scene.textures.remove(oldName);
        if (oldDesc && this.scene.textures.exists(oldDesc)) this.scene.textures.remove(oldDesc);

        this.setVisible(true);
    }

    layout(leftPageLeftEdgeX: number, leftPageTopEdgeY: number, pageHeight: number, scale: number) {
        const startX = leftPageLeftEdgeX + this.config.offsetX * scale;
        const startY = leftPageTopEdgeY + pageHeight * scale - (this.config.height + this.config.offsetY) * scale;

        this.container.setPosition(Math.floor(startX), Math.floor(startY));
        this.container.setScale(scale);

        this.frame.setPosition(0, 0);

        const dividerY = this.config.nameOffsetY + this.fontCharSize + 2;
        this.divider.setPosition(this.config.dividerPaddingX, dividerY);

        this.nameImage.setPosition(this.config.nameOffsetX, this.config.nameOffsetY);

        const descriptionY = dividerY + this.getDividerHeight() + this.config.descriptionOffsetY;
        this.descriptionImage.setPosition(this.config.descriptionOffsetX, descriptionY);
    }

    getReservedHeight(): number {
        return this.config.height - 4;
    }

    private createFrameTexture() {
        const rtKey = `__inv_item_frame_${this.labelTextureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = this.config.width;
        canvas.height = this.config.height;
        const ctx = canvas.getContext('2d')!;

        const srcTexture = this.scene.textures.get(this.config.frameTextureKey);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const border = 3;
        const srcW = srcImage.width;
        const srcH = srcImage.height;
        const centerSrcW = srcW - border * 2;
        const centerSrcH = srcH - border * 2;
        const centerW = this.config.width - border * 2;
        const centerH = this.config.height - border * 2;

        ctx.drawImage(srcImage, 0, 0, border, border, 0, 0, border, border);
        ctx.drawImage(srcImage, border, 0, centerSrcW, border, border, 0, centerW, border);
        ctx.drawImage(srcImage, srcW - border, 0, border, border, border + centerW, 0, border, border);

        ctx.drawImage(srcImage, 0, border, border, centerSrcH, 0, border, border, centerH);
        ctx.drawImage(srcImage, border, border, centerSrcW, centerSrcH, border, border, centerW, centerH);
        ctx.drawImage(srcImage, srcW - border, border, border, centerSrcH, border + centerW, border, border, centerH);

        ctx.drawImage(srcImage, 0, srcH - border, border, border, 0, border + centerH, border, border);
        ctx.drawImage(srcImage, border, srcH - border, centerSrcW, border, border, border + centerH, centerW, border);
        ctx.drawImage(srcImage, srcW - border, srcH - border, border, border, border + centerW, border + centerH, border, border);

        this.scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private createDividerTexture() {
        const rtKey = `__inv_item_divider_${this.dividerTextureCounter++}`;
        const canvas = document.createElement('canvas');

        const srcTexture = this.scene.textures.get(this.config.dividerTextureKey);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = srcImage.width;
        const srcH = srcImage.height;
        const left = 1;
        const right = 1;
        const centerSrcW = srcW - left - right;
        const centerW = Math.max(1, this.config.width - this.config.dividerPaddingX * 2 - left - right);

        canvas.width = left + centerW + right;
        canvas.height = srcH;
        const ctx = canvas.getContext('2d')!;

        ctx.drawImage(srcImage, 0, 0, left, srcH, 0, 0, left, srcH);
        ctx.drawImage(srcImage, left, 0, centerSrcW, srcH, left, 0, centerW, srcH);
        ctx.drawImage(srcImage, srcW - right, 0, right, srcH, left + centerW, 0, right, srcH);

        this.scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private getDividerHeight() {
        const texture = this.scene.textures.get(this.dividerTextureKey!);
        const image = texture.getSourceImage() as HTMLImageElement;
        return image.height;
    }

    private createTextTexture(text: string, maxWidth: number, wrap = false, color?: string) {
        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;

        const lines = wrap ? this.wrapText(text, maxWidth) : [text];
        const lineHeights = lines.length * this.fontCharSize + Math.max(0, lines.length - 1) * 2;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, maxWidth);
        canvas.height = Math.max(1, lineHeights);
        const ctx = canvas.getContext('2d')!;

        let y = 0;
        lines.forEach((line) => {
            const lineWidth = this.measureBitmapTextWidth(line);
            let x = 0;
            for (const ch of line) {
                const pos = this.findGlyph(ch);
                if (pos) {
                    const sx = pos.col * this.fontCharSize;
                    const sy = pos.row * this.fontCharSize;
                    ctx.drawImage(fontImage, sx, sy, this.fontCharSize, this.fontCharSize, x, y, this.fontCharSize, this.fontCharSize);

                    const glyphWidth = this.getGlyphWidth(fontImage, ch);
                    x += glyphWidth + this.fontCharGap;
                } else {
                    x += this.fontCharSize + this.fontCharGap;
                }
            }
            y += this.fontCharSize + 2;
        });

        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color ?? this.config.textColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__inv_item_text_${this.labelTextureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    private wrapText(text: string, maxWidth: number) {
        if (!text) return [''];
        const words = text.split(' ');
        const lines: string[] = [];
        let current = '';

        words.forEach((word) => {
            const test = current ? `${current} ${word}` : word;
            if (this.measureBitmapTextWidth(test) <= maxWidth) {
                current = test;
            } else {
                if (current) lines.push(current);
                current = word;
            }
        });

        if (current) lines.push(current);
        return lines;
    }

    private findGlyph(ch: string) {
        for (let row = 0; row < this.fontMap.length; row++) {
            const col = this.fontMap[row].indexOf(ch);
            if (col !== -1) return { row, col };
        }
        return null;
    }

    private measureBitmapTextWidth(text: string): number {
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
