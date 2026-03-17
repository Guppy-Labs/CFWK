import Phaser from 'phaser';
import { BitmapFontRenderer } from '../BitmapFontRenderer';

type CoinBarConfig = {
    offsetX?: number;
    offsetY?: number;
    width?: number;
    height?: number;
    iconSize?: number;
    iconTextGap?: number;
    contentPaddingX?: number;
};

type CoinAmountParts = {
    platinum: number;
    gold: number;
    silver: number;
    bronze: number;
};

const DEFAULT_CONFIG: Required<CoinBarConfig> = {
    offsetX: 6,
    offsetY: 6,
    width: 130,
    height: 16,
    iconSize: 12,
    iconTextGap: 3,
    contentPaddingX: 8
};

export class CoinBarUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private background: Phaser.GameObjects.Image;
    private config: Required<CoinBarConfig>;
    private barTextureKey: string;
    private static instanceCounter = 0;
    private readonly instanceId: number;
    private readonly fontRenderer: BitmapFontRenderer;
    private readonly fontCharSize = 8;
    private readonly fontCharGap = 1;
    private textTextureCounter = 0;
    private amountTextTextureKeys: string[] = [];
    private amountTextImages: Phaser.GameObjects.Image[] = [];
    private coinIcons: Phaser.GameObjects.Image[] = [];
    private amountValues = [0, 0, 0, 0];

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config: CoinBarConfig = {}) {
        this.scene = scene;
        this.config = {
            offsetX: config.offsetX ?? DEFAULT_CONFIG.offsetX,
            offsetY: config.offsetY ?? DEFAULT_CONFIG.offsetY,
            width: config.width ?? DEFAULT_CONFIG.width,
            height: config.height ?? DEFAULT_CONFIG.height,
            iconSize: config.iconSize ?? DEFAULT_CONFIG.iconSize,
            iconTextGap: config.iconTextGap ?? DEFAULT_CONFIG.iconTextGap,
            contentPaddingX: config.contentPaddingX ?? DEFAULT_CONFIG.contentPaddingX
        };
        this.instanceId = CoinBarUI.instanceCounter++;
        this.fontRenderer = new BitmapFontRenderer(this.scene, this.fontCharSize);
        this.barTextureKey = this.createBarTexture(this.config.width, this.config.height);

        this.background = this.scene.add.image(0, 0, this.barTextureKey).setOrigin(0, 0);
        this.container = this.scene.add.container(0, 0, [this.background]);
        this.container.setVisible(false);
        parent.add(this.container);

        const iconKeys = [
            'ui-money-platinum',
            'ui-money-gold',
            'ui-money-silver',
            'ui-money-bronze'
        ];

        for (let index = 0; index < iconKeys.length; index += 1) {
            const icon = this.scene.add.image(0, 0, iconKeys[index]).setOrigin(0.5, 0.5);
            icon.setDisplaySize(this.config.iconSize, this.config.iconSize);
            this.coinIcons.push(icon);
            this.container.add(icon);

            const textKey = this.createAmountTextTexture('0');
            const textImage = this.scene.add.image(0, 0, textKey).setOrigin(0, 0.5);
            this.amountTextTextureKeys.push(textKey);
            this.amountTextImages.push(textImage);
            this.container.add(textImage);
        }

        this.layoutLocalChildren();
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    layout(rightPageLeftEdgeX: number, rightPageTopEdgeY: number, scale: number) {
        const x = rightPageLeftEdgeX + this.config.offsetX * scale;
        const y = rightPageTopEdgeY + this.config.offsetY * scale;
        this.container.setPosition(x, y);
        this.container.setScale(scale);
        this.layoutLocalChildren();
    }

    setMoney(totalMoney: number) {
        const normalizedMoney = Math.max(0, Math.floor(Number.isFinite(totalMoney) ? totalMoney : 0));
        const parts = this.toCoinParts(normalizedMoney);
        const nextValues = [parts.platinum, parts.gold, parts.silver, parts.bronze];

        nextValues.forEach((value, index) => {
            if (value === this.amountValues[index]) return;
            this.amountValues[index] = value;
            this.updateAmountText(index, String(value));
        });
    }

    destroy() {
        this.amountTextTextureKeys.forEach((key) => {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        });
        if (this.scene.textures.exists(this.barTextureKey)) {
            this.scene.textures.remove(this.barTextureKey);
        }
        this.container.destroy();
    }

    private toCoinParts(money: number): CoinAmountParts {
        const bronze = money % 100;
        const silver = Math.floor(money / 100) % 100;
        const gold = Math.floor(money / 10000) % 100;
        const platinum = Math.floor(money / 1000000);
        return { platinum, gold, silver, bronze };
    }

    private layoutLocalChildren() {
        const segmentWidth = (this.config.width - this.config.contentPaddingX * 2) / 4;
        const centerY = this.config.height / 2;
        for (let index = 0; index < 4; index += 1) {
            const segmentX = this.config.contentPaddingX + segmentWidth * (index + 0.5);
            const iconX = segmentX - segmentWidth * 0.2;
            const icon = this.coinIcons[index];
            const text = this.amountTextImages[index];
            icon.setPosition(iconX, centerY);
            text.setPosition(iconX + this.config.iconSize / 2 + this.config.iconTextGap, centerY);
        }
    }

    private updateAmountText(index: number, text: string) {
        const oldKey = this.amountTextTextureKeys[index];
        const nextKey = this.createAmountTextTexture(text);
        this.amountTextTextureKeys[index] = nextKey;
        this.amountTextImages[index].setTexture(nextKey);

        if (oldKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private createAmountTextTexture(text: string): string {
        const width = Math.max(1, this.fontRenderer.measureTextWidth(text, { charGap: this.fontCharGap }));
        const height = this.fontCharSize;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        this.fontRenderer.drawText(ctx, text, 0, 0, { charGap: this.fontCharGap });
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = '#e6e6e6';
        ctx.fillRect(0, 0, width, height);

        const key = `__coin_amount_${this.instanceId}_${this.textTextureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    private createBarTexture(width: number, height: number): string {
        const srcTexture = this.scene.textures.get('ui-slider-track');
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const key = `__coin_bar_${this.instanceId}`;

        const borderX = 4;
        const borderY = 2;
        const srcCenterW = Math.max(1, srcImage.width - borderX * 2);
        const srcCenterH = Math.max(1, srcImage.height - borderY * 2);
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(srcImage, 0, 0, borderX, borderY, 0, 0, borderX, borderY);
        ctx.drawImage(srcImage, borderX, 0, srcCenterW, borderY, borderX, 0, centerW, borderY);
        ctx.drawImage(srcImage, srcImage.width - borderX, 0, borderX, borderY, borderX + centerW, 0, borderX, borderY);

        ctx.drawImage(srcImage, 0, borderY, borderX, srcCenterH, 0, borderY, borderX, centerH);
        ctx.drawImage(srcImage, borderX, borderY, srcCenterW, srcCenterH, borderX, borderY, centerW, centerH);
        ctx.drawImage(srcImage, srcImage.width - borderX, borderY, borderX, srcCenterH, borderX + centerW, borderY, borderX, centerH);

        ctx.drawImage(srcImage, 0, srcImage.height - borderY, borderX, borderY, 0, borderY + centerH, borderX, borderY);
        ctx.drawImage(srcImage, borderX, srcImage.height - borderY, srcCenterW, borderY, borderX, borderY + centerH, centerW, borderY);
        ctx.drawImage(srcImage, srcImage.width - borderX, srcImage.height - borderY, borderX, borderY, borderX + centerW, borderY + centerH, borderX, borderY);

        this.scene.textures.addCanvas(key, canvas);
        return key;
    }
}
