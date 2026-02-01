import Phaser from 'phaser';

type TabItem = {
    label: string;
    active: boolean;
    width: number;
    container: Phaser.GameObjects.Container;
    img: Phaser.GameObjects.Image;
    textureKey: string;
};

export class BookUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private cover: Phaser.GameObjects.Image;
    private leftPage: Phaser.GameObjects.Image;
    private rightPage: Phaser.GameObjects.Image;
    private tabsContainer: Phaser.GameObjects.Container;
    private tabs: TabItem[] = [];
    private openState = false;

    private readonly coverWidth = 320;
    private readonly coverHeight = 219;
    private readonly pageWidth = 147;
    private readonly pageHeight = 193;
    private readonly tabHeight = 12;
    private readonly tabBorder = 3;
    private readonly tabMinWidth = 41;
    private readonly tabPaddingLeft = 8;
    private readonly tabPaddingRight = 6;
    private readonly tabBaseOffsetY = 16;
    private readonly tabGap = 2;
    private readonly tabOffsetX = 5;
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

    constructor(scene: Phaser.Scene) {
        this.scene = scene;

        this.cover = this.scene.add.image(0, 0, 'ui-book-cover');
        this.leftPage = this.scene.add.image(0, 0, 'ui-book-page-left');
        this.rightPage = this.scene.add.image(0, 0, 'ui-book-page-right');

        this.cover.setOrigin(0.5, 0.5);
        this.leftPage.setOrigin(0.5, 0.5);
        this.rightPage.setOrigin(0.5, 0.5);

        this.cover.setScrollFactor(0);
        this.leftPage.setScrollFactor(0);
        this.rightPage.setScrollFactor(0);

        this.tabsContainer = this.scene.add.container(0, 0);

        this.container = this.scene.add.container(0, 0, [this.cover, this.leftPage, this.rightPage, this.tabsContainer]);
        this.container.setDepth(12000);
        this.container.setVisible(false);

        this.createTabs();
        this.layout();
    }

    private getScale(): number {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const maxWidth = width * 0.9;
        const maxHeight = height * 0.9;
        return Math.min(maxWidth / this.coverWidth, maxHeight / this.coverHeight) * 0.84;
    }

    layout() {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const scale = this.getScale();
        const cy = height / 2;

        this.cover.setScale(scale);
        this.leftPage.setScale(scale);
        this.rightPage.setScale(scale);

        const pageW = this.pageWidth * scale;
        const coverW = this.coverWidth * scale;

        // Find the longest tab to calculate total unit width
        const longestTabWidth = Math.max(...this.tabs.map(t => t.width)) * scale;
        const tabOffsetX = this.tabOffsetX * scale;

        // Unit bounds: leftmost tab edge to right edge of cover
        const unitWidth = coverW / 2 + pageW - tabOffsetX + longestTabWidth;
        const bookCenterX = width / 2 + (pageW - tabOffsetX + longestTabWidth - coverW / 2) / 2;

        this.cover.setPosition(bookCenterX, cy);
        this.leftPage.setPosition(bookCenterX - pageW / 2, cy);
        this.rightPage.setPosition(bookCenterX + pageW / 2, cy);

        this.layoutTabs(scale, bookCenterX, cy, pageW);
    }

    private createTabs() {
        const labels = ['Inventory', 'Finbook', 'Settings'];
        labels.forEach((label, index) => {
            const active = index === 0;
            const tab = this.buildTab(label, active);
            this.tabsContainer.add(tab.container);
            this.tabs.push(tab);
        });
    }

    private layoutTabs(scale: number, bookCenterX: number, cy: number, pageW: number) {
        const pageH = this.pageHeight * scale;
        const leftPageLeftEdgeX = bookCenterX - pageW / 2 - (this.pageWidth / 2) * scale;

        const baseOffsetY = this.tabBaseOffsetY;
        const tabGap = this.tabGap;
        const tabOffsetX = this.tabOffsetX;

        this.tabs.forEach((tab, index) => {
            const tabWidth = tab.width;
            const tabHeight = this.tabHeight;

            tab.container.setScale(scale);

            // Right edge of tab aligns with left edge of left page
            const x = Math.round(leftPageLeftEdgeX - tabWidth * scale + tabOffsetX * scale);
            const y = Math.round(cy - pageH / 2 + (baseOffsetY + index * (tabHeight + tabGap)) * scale);

            tab.container.setPosition(x, y);
        });
    }

    private buildTab(label: string, active: boolean): TabItem {
        const textWidth = this.measureBitmapTextWidth(label);
        const width = Math.max(this.tabMinWidth, textWidth + this.tabPaddingLeft + this.tabPaddingRight);

        const textureKey = this.createNineSliceTexture(
            active ? 'ui-tab-active' : 'ui-tab-inactive',
            width,
            this.tabHeight,
            this.tabBorder,
            label,
            active
        );

        const img = this.scene.add.image(0, 0, textureKey).setOrigin(0, 0);
        const container = this.scene.add.container(0, 0, [img]);

        img.setInteractive({ useHandCursor: true });
        img.on('pointerdown', () => this.setActiveTab(label));

        return {
            label,
            active,
            width,
            container,
            img,
            textureKey
        };
    }

    private nineSliceCounter = 0;

    private createNineSliceTexture(key: string, width: number, height: number, border: number, label?: string, active?: boolean) {
        const srcW = 41;
        const srcH = 12;
        const centerSrcW = srcW - border * 2;
        const centerSrcH = srcH - border * 2;

        const centerW = Math.max(1, width - border * 2);
        const centerH = Math.max(1, height - border * 2);

        // Generate unique texture key for this nine-slice
        const rtKey = `__nineslice_${this.nineSliceCounter++}`;

        // Create a canvas to composite the nine-slice at 1:1 pixel ratio
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        // Get source image from Phaser's texture manager
        const srcTexture = this.scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;

        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;

        // Draw the 9 parts at 1:1 pixel ratio
        // Top row
        ctx.drawImage(srcImage, 0, 0, border, border, 0, 0, border, border);
        ctx.drawImage(srcImage, border, 0, centerSrcW, border, border, 0, centerW, border);
        ctx.drawImage(srcImage, srcW - border, 0, border, border, border + centerW, 0, border, border);

        // Middle row
        ctx.drawImage(srcImage, 0, border, border, centerSrcH, 0, border, border, centerH);
        ctx.drawImage(srcImage, border, border, centerSrcW, centerSrcH, border, border, centerW, centerH);
        ctx.drawImage(srcImage, srcW - border, border, border, centerSrcH, border + centerW, border, border, centerH);

        // Bottom row
        ctx.drawImage(srcImage, 0, srcH - border, border, border, 0, border + centerH, border, border);
        ctx.drawImage(srcImage, border, srcH - border, centerSrcW, border, border, border + centerH, centerW, border);
        ctx.drawImage(srcImage, srcW - border, srcH - border, border, border, border + centerW, border + centerH, border, border);

        if (label) {
            const textWidth = this.measureBitmapTextWidth(label);
            const textX = Math.max(this.tabPaddingLeft, width - this.tabPaddingRight - textWidth);
            const textY = Math.floor((height - this.fontCharSize) / 2);
            const textColor = active ? '#cfd8e5' : '#4b3435';
            this.drawBitmapText(ctx, fontImage, label, textX, textY, textColor);
        }

        // Add the composited canvas as a texture
        this.scene.textures.addCanvas(rtKey, canvas);

        return rtKey;
    }

    private setActiveTab(label: string) {
        this.tabs.forEach((tab) => {
            const shouldBeActive = tab.label === label;
            if (tab.active === shouldBeActive) return;
            tab.active = shouldBeActive;
            this.updateTabTexture(tab);
        });
    }

    private updateTabTexture(tab: TabItem) {
        const key = tab.active ? 'ui-tab-active' : 'ui-tab-inactive';
        const textureKey = this.createNineSliceTexture(
            key,
            tab.width,
            this.tabHeight,
            this.tabBorder,
            tab.label,
            tab.active
        );

        const oldKey = tab.textureKey;
        tab.textureKey = textureKey;
        tab.img.setTexture(textureKey);

        if (this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private drawBitmapText(
        ctx: CanvasRenderingContext2D,
        fontImage: HTMLImageElement,
        text: string,
        x: number,
        y: number,
        color: string
    ) {
        const charSize = this.fontCharSize;
        const textWidth = this.measureBitmapTextWidth(text);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = Math.max(1, textWidth);
        tempCanvas.height = charSize;
        const tempCtx = tempCanvas.getContext('2d')!;

        let cursorX = 0;
        for (const ch of text) {
            const pos = this.findGlyph(ch);
            if (pos) {
                const sx = pos.col * charSize;
                const sy = pos.row * charSize;
                tempCtx.drawImage(fontImage, sx, sy, charSize, charSize, cursorX, 0, charSize, charSize);

                const glyphWidth = this.getGlyphWidth(fontImage, ch);
                cursorX += glyphWidth + this.fontCharGap;
            } else {
                cursorX += charSize + this.fontCharGap;
            }
        }

        tempCtx.globalCompositeOperation = 'source-in';
        tempCtx.fillStyle = color;
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        ctx.drawImage(tempCanvas, x, y);
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

        const charSize = this.fontCharSize;
        const canvas = document.createElement('canvas');
        canvas.width = charSize;
        canvas.height = charSize;
        const ctx = canvas.getContext('2d')!;

        const sx = pos.col * charSize;
        const sy = pos.row * charSize;
        ctx.drawImage(fontImage, sx, sy, charSize, charSize, 0, 0, charSize, charSize);

        const data = ctx.getImageData(0, 0, charSize, charSize).data;
        let rightmost = -1;
        for (let x = charSize - 1; x >= 0; x--) {
            let hasPixel = false;
            for (let y = 0; y < charSize; y++) {
                const idx = (y * charSize + x) * 4 + 3;
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

    open() {
        this.openState = true;
        this.container.setVisible(true);
    }

    openToTab(tabLabel: string) {
        this.setActiveTab(tabLabel);
        this.open();
    }

    close() {
        this.openState = false;
        this.container.setVisible(false);
    }

    toggle() {
        if (this.openState) {
            this.close();
        } else {
            this.open();
        }
    }

    isOpen(): boolean {
        return this.openState;
    }

    destroy() {
        this.container.destroy();
    }
}
