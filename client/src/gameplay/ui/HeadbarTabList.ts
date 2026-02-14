import Phaser from 'phaser';
import { LocaleManager } from '../i18n/LocaleManager';
import { BitmapFontRenderer } from './BitmapFontRenderer';

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
    private localeManager = LocaleManager.getInstance();
    private localeChangedHandler?: (event: Event) => void;

    private textureCounter = 0;
    private headerTextureKey?: string;
    private playerTextureKeys: string[] = [];

    // Font rendering (shared with HeadbarUI)
    private readonly fontCharSize = 8;
    private readonly fontRenderer: BitmapFontRenderer;
    private readonly textScale = 1.5;
    private readonly scaledCharGap = 2;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config: HeadbarTabListConfig = {}) {
        this.scene = scene;
        this.fontRenderer = new BitmapFontRenderer(scene, this.fontCharSize);
        this.config = {
            textColor: config.textColor ?? DEFAULT_CONFIG.textColor,
            localPlayerColor: config.localPlayerColor ?? DEFAULT_CONFIG.localPlayerColor,
            headerText: this.localeManager.t('headbar.playersOnline', undefined, config.headerText ?? DEFAULT_CONFIG.headerText),
            rowHeight: config.rowHeight ?? DEFAULT_CONFIG.rowHeight,
            paddingX: config.paddingX ?? DEFAULT_CONFIG.paddingX,
            paddingTop: config.paddingTop ?? DEFAULT_CONFIG.paddingTop
        };

        this.localeChangedHandler = () => this.refreshLocaleText();
        window.addEventListener('locale:changed', this.localeChangedHandler as EventListener);

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

    private refreshLocaleText() {
        const nextHeader = this.localeManager.t('headbar.playersOnline', undefined, DEFAULT_CONFIG.headerText);
        if (nextHeader === this.config.headerText) return;

        this.config.headerText = nextHeader;
        const oldKey = this.headerTextureKey;
        this.headerTextureKey = this.createTextTexture(this.config.headerText, this.config.textColor);
        this.headerImage.setTexture(this.headerTextureKey);

        if (oldKey && oldKey !== this.headerTextureKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private createTextTexture(text: string, color: string): string {
        const rtKey = `__headbar_tablist_${this.textureCounter++}`;
        const canvas = document.createElement('canvas');

        const width = this.measureText(text);
        const height = Math.floor(this.fontCharSize * this.textScale);

        canvas.width = Math.max(1, width);
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        this.fontRenderer.drawText(ctx, text, 0, 0, {
            scale: this.textScale,
            charGap: this.scaledCharGap
        });

        // Apply text color
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        this.scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private measureText(text: string): number {
        return this.fontRenderer.measureTextWidth(text, {
            scale: this.textScale,
            charGap: this.scaledCharGap
        });
    }

    destroy() {
        if (this.localeChangedHandler) {
            window.removeEventListener('locale:changed', this.localeChangedHandler as EventListener);
            this.localeChangedHandler = undefined;
        }

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
