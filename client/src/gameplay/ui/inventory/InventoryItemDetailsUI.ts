import Phaser from 'phaser';
import { LocaleManager } from '../../i18n/LocaleManager';
import { BitmapFontRenderer } from '../BitmapFontRenderer';

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
    amountTextColor?: string;
};

export type InventoryItemDetailsData = {
    name: string;
    description: string;
    itemId: string;
    slotIndex: number;
    amount?: number;
    stackSize?: number;
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
    descriptionTextColor: '#9A9EA7',
    amountTextColor: '#9A9EA7'
};

export class InventoryItemDetailsUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private frame: Phaser.GameObjects.Image;
    private divider: Phaser.GameObjects.Image;
    private nameImage: Phaser.GameObjects.Image;
    private amountImage: Phaser.GameObjects.Image;
    private descriptionImage: Phaser.GameObjects.Image;
    private dropButtonBg: Phaser.GameObjects.Image;
    private dropButtonLabel: Phaser.GameObjects.Image;
    private dropButton: Phaser.GameObjects.Container;
    private dropButtonTextureKey?: string;
    private dropLabelTextureKey?: string;
    private dropButtonTextureCounter = 0;
    private dropButtonWidth = 0;
    private dropButtonHeight = 0;
    private onDrop?: (itemId: string, amount: number, slotIndex: number) => void;
    private currentItem?: { itemId: string; amount: number; slotIndex: number };
    private localeManager = LocaleManager.getInstance();
    private localeChangedHandler?: (event: Event) => void;

    private labelTextureCounter = 0;
    private dividerTextureCounter = 0;
    private nameTextureKey?: string;
    private amountTextureKey?: string;
    private descriptionTextureKey?: string;
    private frameTextureKey?: string;
    private dividerTextureKey?: string;

    private readonly fontCharSize = 8;
    private readonly fontCharGap = 1;
    private readonly fontRenderer: BitmapFontRenderer;

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
            descriptionTextColor: config.descriptionTextColor ?? DEFAULT_ITEM_DETAILS_CONFIG.descriptionTextColor,
            amountTextColor: config.amountTextColor ?? DEFAULT_ITEM_DETAILS_CONFIG.amountTextColor
        };
        this.fontRenderer = new BitmapFontRenderer(this.scene, this.fontCharSize);

        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.frameTextureKey = this.createFrameTexture();
        this.frame = this.scene.add.image(0, 0, this.frameTextureKey).setOrigin(0, 0);

        this.dividerTextureKey = this.createDividerTexture();
        this.divider = this.scene.add.image(0, 0, this.dividerTextureKey).setOrigin(0, 0);

        this.nameTextureKey = this.createTextTexture('', this.config.width - this.config.nameOffsetX * 2);
        this.nameImage = this.scene.add.image(0, 0, this.nameTextureKey).setOrigin(0, 0);

        this.amountTextureKey = this.createTextTexture('', 1, false, this.config.amountTextColor);
        this.amountImage = this.scene.add.image(0, 0, this.amountTextureKey).setOrigin(1, -0.5);
        this.amountImage.setScale(0.7);

        this.descriptionTextureKey = this.createTextTexture('', this.config.width - this.config.descriptionOffsetX * 2);
        this.descriptionImage = this.scene.add.image(0, 0, this.descriptionTextureKey).setOrigin(0, 0);

        const dropLabel = this.localeManager.t('inventory.details.drop', undefined, 'Drop');
        const dropLabelWidth = Math.max(1, this.measureBitmapTextWidth(dropLabel));
        this.dropLabelTextureKey = this.createTextTexture(dropLabel, dropLabelWidth, false, '#f2e9dd');
        this.dropButtonLabel = this.scene.add.image(0, 0, this.dropLabelTextureKey).setOrigin(0.5, 0.5);
        this.dropButtonBg = this.scene.add.image(0, 0, 'ui-group-button-selected').setOrigin(0.5, 0.5);
        this.dropButton = this.scene.add.container(0, 0, [this.dropButtonBg, this.dropButtonLabel]);
        this.dropButtonBg.setInteractive({ useHandCursor: false });
        this.dropButtonBg.on('pointerdown', () => this.handleDrop());

        this.dropButton.setVisible(false);

        this.container.add([this.frame, this.divider, this.nameImage, this.amountImage, this.descriptionImage, this.dropButton]);
        this.container.setVisible(false);

        this.localeChangedHandler = () => this.refreshLocalizedLabels();
        window.addEventListener('locale:changed', this.localeChangedHandler as EventListener);
    }

    setOnDrop(callback?: (itemId: string, amount: number, slotIndex: number) => void) {
        this.onDrop = callback;
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    setItem(data: InventoryItemDetailsData | null) {
        if (!data) {
            this.setVisible(false);
            this.dropButton.setVisible(false);
            this.currentItem = undefined;
            return;
        }

        const nameKey = this.createTextTexture(data.name, this.config.width - this.config.nameOffsetX * 2);
        const amountText = this.getAmountText(data);
        const amountWidth = Math.max(1, this.measureBitmapTextWidth(amountText));
        const amountKey = this.createTextTexture(amountText, amountWidth, false, this.config.amountTextColor);
        const descKey = this.createTextTexture(data.description, this.config.width - this.config.descriptionOffsetX * 2, true, this.config.descriptionTextColor);

        const oldName = this.nameTextureKey;
        const oldAmount = this.amountTextureKey;
        const oldDesc = this.descriptionTextureKey;

        this.nameTextureKey = nameKey;
        this.amountTextureKey = amountKey;
        this.descriptionTextureKey = descKey;
        this.nameImage.setTexture(nameKey);
        this.amountImage.setTexture(amountKey);
        this.descriptionImage.setTexture(descKey);

        if (oldName && this.scene.textures.exists(oldName)) this.scene.textures.remove(oldName);
        if (oldAmount && this.scene.textures.exists(oldAmount)) this.scene.textures.remove(oldAmount);
        if (oldDesc && this.scene.textures.exists(oldDesc)) this.scene.textures.remove(oldDesc);

        this.currentItem = {
            itemId: data.itemId,
            amount: Math.max(1, data.amount ?? 1),
            slotIndex: data.slotIndex
        };
        this.dropButton.setVisible(data.slotIndex >= 0);
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

        const amountX = this.config.width - this.config.nameOffsetX;
        this.amountImage.setPosition(amountX, this.config.nameOffsetY);

        const descriptionY = dividerY + this.getDividerHeight() + this.config.descriptionOffsetY;
        this.descriptionImage.setPosition(this.config.descriptionOffsetX, descriptionY);

        this.updateDropButtonLayout();
    }

    getReservedHeight(): number {
        return this.config.height - 4;
    }

    private updateDropButtonLayout() {
        const targetWidth = Math.round(Math.max(30, Math.min(36, this.config.width * 0.25)));
        const targetHeight = 12;
        this.updateDropButtonTexture(targetWidth, targetHeight);

        this.dropButtonBg.setDisplaySize(targetWidth, targetHeight);
        this.dropButtonLabel.setPosition(0, -1);

        const leftPadding = this.config.nameOffsetX;
        const x = leftPadding + targetWidth / 2;
        const y = this.config.height - targetHeight / 2 - 6;
        this.dropButton.setPosition(x, y);
    }

    private refreshLocalizedLabels() {
        const dropLabel = this.localeManager.t('inventory.details.drop', undefined, 'Drop');
        const dropLabelWidth = Math.max(1, this.measureBitmapTextWidth(dropLabel));
        const newKey = this.createTextTexture(dropLabel, dropLabelWidth, false, '#f2e9dd');
        const oldKey = this.dropLabelTextureKey;
        this.dropLabelTextureKey = newKey;
        this.dropButtonLabel.setTexture(newKey);
        if (oldKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private updateDropButtonTexture(width: number, height: number) {
        if (width === this.dropButtonWidth && height === this.dropButtonHeight && this.dropButtonTextureKey) {
            return;
        }
        this.dropButtonWidth = width;
        this.dropButtonHeight = height;

        const newKey = this.createNineSliceTexture('ui-group-button-selected', width, height, 6, 6, `__inv_drop_btn_${this.dropButtonTextureCounter++}`);
        const oldKey = this.dropButtonTextureKey;
        this.dropButtonTextureKey = newKey;
        this.dropButtonBg.setTexture(newKey);

        if (oldKey && oldKey !== newKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
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

    private createNineSliceTexture(key: string, width: number, height: number, borderX: number, borderY: number, overrideKey?: string) {
        const srcTexture = this.scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = srcImage.width;
        const srcH = srcImage.height;

        const centerSrcW = srcW - borderX * 2;
        const centerSrcH = srcH - borderY * 2;
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const rtKey = overrideKey ?? `__inv_drop_btn_${this.dropButtonTextureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        ctx.drawImage(srcImage, 0, 0, borderX, borderY, 0, 0, borderX, borderY);
        ctx.drawImage(srcImage, borderX, 0, centerSrcW, borderY, borderX, 0, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, 0, borderX, borderY, borderX + centerW, 0, borderX, borderY);

        ctx.drawImage(srcImage, 0, borderY, borderX, centerSrcH, 0, borderY, borderX, centerH);
        ctx.drawImage(srcImage, borderX, borderY, centerSrcW, centerSrcH, borderX, borderY, centerW, centerH);
        ctx.drawImage(srcImage, srcW - borderX, borderY, borderX, centerSrcH, borderX + centerW, borderY, borderX, centerH);

        ctx.drawImage(srcImage, 0, srcH - borderY, borderX, borderY, 0, borderY + centerH, borderX, borderY);
        ctx.drawImage(srcImage, borderX, srcH - borderY, centerSrcW, borderY, borderX, borderY + centerH, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, srcH - borderY, borderX, borderY, borderX + centerW, borderY + centerH, borderX, borderY);

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

    private getAmountText(data: InventoryItemDetailsData) {
        if (data.amount === undefined || data.stackSize === undefined) return '';
        return `${data.amount}/${data.stackSize}`;
    }

    private handleDrop() {
        if (!this.currentItem) return;
        if (this.currentItem.slotIndex < 0) return;
        this.onDrop?.(this.currentItem.itemId, this.currentItem.amount, this.currentItem.slotIndex);
    }

    private createTextTexture(text: string, maxWidth: number, wrap = false, color?: string) {
        const lines = wrap ? this.wrapText(text, maxWidth) : [text];
        const lineHeights = lines.length * this.fontCharSize + Math.max(0, lines.length - 1) * 2;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, maxWidth);
        canvas.height = Math.max(1, lineHeights);
        const ctx = canvas.getContext('2d')!;

        let y = 0;
        lines.forEach((line) => {
            this.fontRenderer.drawText(ctx, line, 0, y, { charGap: this.fontCharGap });
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

    destroy() {
        if (this.localeChangedHandler) {
            window.removeEventListener('locale:changed', this.localeChangedHandler as EventListener);
            this.localeChangedHandler = undefined;
        }
        this.container.destroy();
    }

    private measureBitmapTextWidth(text: string): number {
        return this.fontRenderer.measureTextWidth(text, { charGap: this.fontCharGap });
    }
}
