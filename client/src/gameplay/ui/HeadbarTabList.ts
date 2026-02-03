import Phaser from 'phaser';

export type TabListEntry = {
    name: string;
    isLocal: boolean;
};

export type HeadbarTabListConfig = {
    textColor?: string;
    localPlayerColor?: string;
    headerText?: string;
    rowHeight?: number;
    paddingX?: number;
    paddingTop?: number;
};

const DEFAULT_CONFIG: Required<HeadbarTabListConfig> = {
    textColor: '#BABEC7',
    localPlayerColor: '#ffd86b',
    headerText: 'Players Online',
    rowHeight: 15,
    paddingX: 16,
    paddingTop: 16  // Matches HeadbarUI's content area start
};

/**
 * Manages the player list content that appears when Tab is held.
 * This is designed to be used within the HeadbarUI's expanded state.
 */
export class HeadbarTabList {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private headerImage: Phaser.GameObjects.Image;
    private playerImages: Phaser.GameObjects.Image[] = [];
    private players: TabListEntry[] = [];
    private config: Required<HeadbarTabListConfig>;

    private textureCounter = 0;
    private headerTextureKey?: string;
    private playerTextureKeys: string[] = [];

    // Font rendering (shared with HeadbarUI)
    private readonly fontCharSize = 8;
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
    private readonly textScale = 1.5;
    private readonly scaledCharGap = 2;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config: HeadbarTabListConfig = {}) {
        this.scene = scene;
        this.config = {
            textColor: config.textColor ?? DEFAULT_CONFIG.textColor,
            localPlayerColor: config.localPlayerColor ?? DEFAULT_CONFIG.localPlayerColor,
            headerText: config.headerText ?? DEFAULT_CONFIG.headerText,
            rowHeight: config.rowHeight ?? DEFAULT_CONFIG.rowHeight,
            paddingX: config.paddingX ?? DEFAULT_CONFIG.paddingX,
            paddingTop: config.paddingTop ?? DEFAULT_CONFIG.paddingTop
        };

        this.container = this.scene.add.container(0, 0);
        this.container.setAlpha(0);
        parent.add(this.container);

        // Create header text
        this.headerTextureKey = this.createTextTexture(this.config.headerText, this.config.textColor);
        this.headerImage = this.scene.add.image(0, 0, this.headerTextureKey).setOrigin(0.5, 0);
        this.container.add(this.headerImage);
    }

    setPlayers(players: TabListEntry[]) {
        this.players = players.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        this.rebuildPlayerList();
    }

    getPlayers(): TabListEntry[] {
        return this.players;
    }

    getContainer(): Phaser.GameObjects.Container {
        return this.container;
    }

    /**
     * Calculate the required height for the player list content
     */
    getRequiredHeight(): number {
        const scaledFontSize = Math.floor(this.fontCharSize * this.textScale);
        const headerHeight = scaledFontSize;
        const playerCount = Math.max(1, this.players.length);
        const playersHeight = playerCount * this.config.rowHeight;
        return this.config.paddingTop + headerHeight + 8 + playersHeight + this.config.paddingTop;
    }

    /**
     * Get the maximum width needed for player names
     */
    getRequiredWidth(): number {
        let maxWidth = this.measureText(this.config.headerText);
        for (const player of this.players) {
            maxWidth = Math.max(maxWidth, this.measureText(player.name));
        }
        return maxWidth + this.config.paddingX * 2;
    }

    /**
     * Layout the content within the given banner dimensions
     */
    layout(_bannerWidth: number, startY: number) {
        // Position header centered
        this.headerImage.setPosition(0, startY + this.config.paddingTop);

        // Position player names centered below header
        const scaledFontSize = Math.floor(this.fontCharSize * this.textScale);
        let y = startY + this.config.paddingTop + scaledFontSize + 8;

        for (let i = 0; i < this.playerImages.length; i++) {
            this.playerImages[i].setPosition(0, y);
            y += this.config.rowHeight;
        }
    }

    private rebuildPlayerList() {
        // Clean up old player images and textures
        for (const img of this.playerImages) {
            img.destroy();
        }
        this.playerImages = [];

        for (const key of this.playerTextureKeys) {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        }
        this.playerTextureKeys = [];

        // Create new player images
        for (const player of this.players) {
            const color = player.isLocal ? this.config.localPlayerColor : this.config.textColor;
            const textureKey = this.createTextTexture(player.name, color);
            this.playerTextureKeys.push(textureKey);

            const img = this.scene.add.image(0, 0, textureKey).setOrigin(0.5, 0);
            this.playerImages.push(img);
            this.container.add(img);
        }
    }

    private createTextTexture(text: string, color: string): string {
        const rtKey = `__headbar_tablist_${this.textureCounter++}`;
        const canvas = document.createElement('canvas');

        if (!this.scene.textures.exists('ui-font')) {
            canvas.width = 1;
            canvas.height = 1;
            this.scene.textures.addCanvas(rtKey, canvas);
            return rtKey;
        }

        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;

        this.buildFontGlyphWidths(fontImage);

        const width = this.measureText(text);
        const height = Math.floor(this.fontCharSize * this.textScale);

        canvas.width = Math.max(1, width);
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        // Draw text at scaled size
        let x = 0;
        for (const char of text) {
            const pos = this.getCharPos(char);
            if (pos) {
                const glyphW = this.fontGlyphWidths.get(char) ?? this.fontCharSize;
                const scaledGlyphW = Math.round(glyphW * this.textScale);
                const scaledCharSize = Math.round(this.fontCharSize * this.textScale);
                ctx.drawImage(fontImage, pos.x, pos.y, this.fontCharSize, this.fontCharSize, x, 0, scaledCharSize, scaledCharSize);
                x += scaledGlyphW + this.scaledCharGap;
            } else {
                x += Math.round(this.fontCharSize * this.textScale) + this.scaledCharGap;
            }
        }

        // Apply text color
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        this.scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private measureText(text: string): number {
        // Ensure glyph widths are built
        if (this.fontGlyphWidths.size === 0 && this.scene.textures.exists('ui-font')) {
            const fontTexture = this.scene.textures.get('ui-font');
            const fontImage = fontTexture.getSourceImage() as HTMLImageElement;
            this.buildFontGlyphWidths(fontImage);
        }

        let width = 0;
        for (const char of text) {
            const glyphW = this.fontGlyphWidths.get(char) ?? this.fontCharSize;
            width += Math.round(glyphW * this.textScale) + this.scaledCharGap;
        }
        return Math.max(0, width - this.scaledCharGap);
    }

    private buildFontGlyphWidths(fontImage: HTMLImageElement) {
        if (this.fontGlyphWidths.size > 0) return;

        const canvas = document.createElement('canvas');
        canvas.width = fontImage.width;
        canvas.height = fontImage.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(fontImage, 0, 0);

        for (let row = 0; row < this.fontMap.length; row++) {
            for (let col = 0; col < this.fontMap[row].length; col++) {
                const char = this.fontMap[row][col];
                if (char === ' ') {
                    this.fontGlyphWidths.set(char, 4);
                    continue;
                }
                const gx = col * this.fontCharSize;
                const gy = row * this.fontCharSize;
                const imgData = ctx.getImageData(gx, gy, this.fontCharSize, this.fontCharSize);
                let maxX = 0;
                for (let y = 0; y < this.fontCharSize; y++) {
                    for (let x = 0; x < this.fontCharSize; x++) {
                        const idx = (y * this.fontCharSize + x) * 4;
                        if (imgData.data[idx + 3] > 0) {
                            maxX = Math.max(maxX, x);
                        }
                    }
                }
                this.fontGlyphWidths.set(char, maxX + 1);
            }
        }
    }

    private getCharPos(char: string): { x: number; y: number } | null {
        for (let row = 0; row < this.fontMap.length; row++) {
            const col = this.fontMap[row].indexOf(char);
            if (col !== -1) {
                return { x: col * this.fontCharSize, y: row * this.fontCharSize };
            }
        }
        return null;
    }

    destroy() {
        if (this.headerTextureKey && this.scene.textures.exists(this.headerTextureKey)) {
            this.scene.textures.remove(this.headerTextureKey);
        }

        for (const key of this.playerTextureKeys) {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        }

        this.container.destroy();
    }
}
