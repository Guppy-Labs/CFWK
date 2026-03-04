import Phaser from 'phaser';
import { GlimmerFishTier, GlimmerbowlEntry, getItemDefinition } from '@cfwk/shared';
import { InventoryItemDetailsUI } from '../inventory/InventoryItemDetailsUI';
import { InventoryDisplayItem, InventorySlotDisplay, InventorySlotsUI } from '../inventory/InventorySlotsUI';
import { LocaleManager } from '../../i18n/LocaleManager';
import { getLocalizedItemDescription, getLocalizedItemName } from '../../i18n/itemLocale';
import { BitmapFontRenderer } from '../BitmapFontRenderer';

type TierButton = {
    tier: GlimmerFishTier;
    button: Phaser.GameObjects.Image;
    labelImage: Phaser.GameObjects.Image;
    container: Phaser.GameObjects.Container;
    labelKey?: string;
    buttonTextureKey?: string;
};

type GlimmerDisplayEntry = {
    entry: GlimmerbowlEntry;
    display: InventoryDisplayItem;
};

export class GlimmerbowlTabUI {
    private readonly detailsReserveExtra = 10;
    private readonly tierButtonWidth = 62;
    private readonly tierButtonHeight = 18;
    private readonly tierButtonGap = 5;
    private readonly tierButtonBorderX = 6;
    private readonly tierButtonBorderY = 6;

    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private localeManager = LocaleManager.getInstance();

    private bowlPlaceholder: Phaser.GameObjects.Rectangle;
    private bowlOutline: Phaser.GameObjects.Rectangle;
    private bowlLabel: Phaser.GameObjects.Image;
    private bowlLabelKey?: string;

    private regularButton: TierButton;
    private awakenedButton: TierButton;

    private slotsUI: InventorySlotsUI;
    private detailsUI: InventoryItemDetailsUI;

    private entries: GlimmerbowlEntry[] = [];
    private activeTier: GlimmerFishTier = 'regular';
    private displayEntries: GlimmerDisplayEntry[] = [];
    private slotEntryMap = new Map<number, GlimmerDisplayEntry>();

    private onDrop?: (itemId: string, amount: number) => void;
    private onView?: (itemId: string, amount: number) => void;

    private lastLayout?: {
        leftPageLeftEdgeX: number;
        leftPageTopEdgeY: number;
        rightPageLeftEdgeX: number;
        rightPageTopEdgeY: number;
        pageHeight: number;
        scale: number;
    };

    private localeChangedHandler?: (event: Event) => void;
    private readonly fontCharSize = 8;
    private readonly fontCharGap = 1;
    private readonly tierLabelScale = 0.92;
    private readonly fontRenderer: BitmapFontRenderer;
    private labelTextureCounter = 0;
    private buttonTextureCounter = 0;
    private generatedTextureKeys = new Set<string>();

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
        this.scene = scene;
        this.fontRenderer = new BitmapFontRenderer(scene, this.fontCharSize);

        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.bowlPlaceholder = this.scene.add.rectangle(0, 0, 120, 104, 0x1a1f29, 0.72).setOrigin(0, 0);
        this.bowlOutline = this.scene.add.rectangle(0, 0, 120, 104, 0xffffff, 0).setOrigin(0, 0);
        this.bowlOutline.setStrokeStyle(2, 0x4f5563, 0.9);
        this.bowlLabelKey = this.createTextTexture(this.localeManager.t('glimmerbowl.placeholder', undefined, 'Fishbowl Preview'), '#9A9EA7');
        this.bowlLabel = this.scene.add.image(0, 0, this.bowlLabelKey).setOrigin(0, 0);

        this.regularButton = this.createTierButton('regular');
        this.awakenedButton = this.createTierButton('awakened');

        this.slotsUI = new InventorySlotsUI(this.scene, this.container, {
            rows: 24,
            unlockedSlots: 120,
            gridOffsetX: 9,
            gridOffsetY: 5,
            gridBottomPadding: 5,
            bottomReservedHeight: 0,
            scrollbarOffsetX: 3,
            scrollbarThumbOffsetX: -2,
            scrollbarThumbOffsetY: 0
        });
        this.detailsUI = new InventoryItemDetailsUI(this.scene, this.container, {
            width: 134,
            height: 72,
            offsetX: 9,
            offsetY: 6,
            secondaryActionLabel: this.localeManager.t('glimmerbowl.details.view', undefined, 'View')
        });

        this.detailsUI.setOnDrop((itemId, amount, _slotIndex) => {
            this.onDrop?.(itemId, amount);
            this.detailsUI.setItem(null);
            this.slotsUI.setBottomReservedHeight(0);
            this.slotsUI.clearSelection();
        });
        this.detailsUI.setSecondaryAction((itemId, amount, _slotIndex) => {
            this.onView?.(itemId, amount);
        }, this.localeManager.t('glimmerbowl.details.view', undefined, 'View'));

        this.slotsUI.setOnItemSelect((item, slotIndex, stackCount) => {
            if (!item || slotIndex < 0) {
                this.detailsUI.setItem(null);
                this.slotsUI.setBottomReservedHeight(0);
                return;
            }

            this.detailsUI.setItem({
                name: item.name,
                description: item.description,
                itemId: item.id,
                slotIndex,
                amount: stackCount ?? item.count,
                stackSize: item.stackSize
            });
            this.slotsUI.setBottomReservedHeight(this.detailsUI.getReservedHeight() + this.detailsReserveExtra);
        });

        this.container.add([
            this.bowlPlaceholder,
            this.bowlOutline,
            this.bowlLabel,
            this.regularButton.container,
            this.awakenedButton.container
        ]);
        this.container.setVisible(false);

        this.localeChangedHandler = () => this.refreshLocalizedLabels();
        window.addEventListener('locale:changed', this.localeChangedHandler as EventListener);

        this.render();
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
        this.slotsUI.setVisible(visible);
        this.detailsUI.setVisible(visible && Boolean(this.slotsUI.getSelectedItem()));
    }

    setEntries(entries: GlimmerbowlEntry[]) {
        this.entries = entries
            .map((entry) => ({
                itemId: entry.itemId,
                count: Math.max(0, Math.floor(entry.count ?? 0)),
                tier: (entry.tier === 'awakened' ? 'awakened' : 'regular') as GlimmerFishTier
            }))
            .filter((entry) => entry.itemId && entry.count > 0);

        if (this.activeTier === 'awakened' && !this.hasAwakenedFish()) {
            this.activeTier = 'regular';
        }

        this.render();
    }

    setOnDrop(callback?: (itemId: string, amount: number) => void) {
        this.onDrop = callback;
    }

    setOnView(callback?: (itemId: string, amount: number) => void) {
        this.onView = callback;
    }

    layout(
        leftPageLeftEdgeX: number,
        leftPageTopEdgeY: number,
        rightPageLeftEdgeX: number,
        rightPageTopEdgeY: number,
        pageHeight: number,
        scale: number
    ) {
        this.lastLayout = {
            leftPageLeftEdgeX,
            leftPageTopEdgeY,
            rightPageLeftEdgeX,
            rightPageTopEdgeY,
            pageHeight,
            scale
        };

        const leftPad = 9;
        const topPad = 5;
        const contentWidth = 129;
        const bowlHeight = Math.floor(pageHeight * 0.6);
        const leftInwardOffset = 5;
        const leftVerticalOffset = 6;
        const rightInwardOffset = -5;

        const bowlX = Math.floor(leftPageLeftEdgeX + (leftPad + leftInwardOffset) * scale);
        const bowlY = Math.floor(leftPageTopEdgeY + (topPad + leftVerticalOffset) * scale);
        const bowlW = Math.floor(contentWidth * scale);
        const bowlH = Math.floor((bowlHeight - topPad) * scale);

        this.bowlPlaceholder.setPosition(bowlX, bowlY);
        this.bowlPlaceholder.setSize(bowlW, bowlH);
        this.bowlOutline.setPosition(bowlX, bowlY);
        this.bowlOutline.setSize(bowlW, bowlH);

        const bowlLabelW = this.getTextureWidth(this.bowlLabel.texture.key);
        const bowlLabelH = this.getTextureHeight(this.bowlLabel.texture.key);
        this.bowlLabel.setPosition(
            Math.floor(bowlX + (bowlW - bowlLabelW * scale) / 2),
            Math.floor(bowlY + (bowlH - bowlLabelH * scale) / 2)
        );
        this.bowlLabel.setScale(scale);

        const buttonY = Math.floor(leftPageTopEdgeY + (bowlHeight + 8 + leftVerticalOffset) * scale);
        const leftButtonX = Math.floor(leftPageLeftEdgeX + (leftPad + leftInwardOffset) * scale);
        const rightButtonX = Math.floor(leftButtonX + (this.tierButtonWidth + this.tierButtonGap) * scale);

        this.layoutTierButton(this.regularButton, leftButtonX, buttonY, scale);
        this.layoutTierButton(this.awakenedButton, rightButtonX, buttonY, scale);

        const rightContentX = Math.floor(rightPageLeftEdgeX + rightInwardOffset * scale);
        this.slotsUI.layout(rightContentX, rightPageTopEdgeY, pageHeight, scale);
        this.detailsUI.layout(rightContentX, rightPageTopEdgeY, pageHeight, scale);
    }

    destroy() {
        if (this.localeChangedHandler) {
            window.removeEventListener('locale:changed', this.localeChangedHandler as EventListener);
            this.localeChangedHandler = undefined;
        }

        this.generatedTextureKeys.forEach((key) => {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        });
        this.generatedTextureKeys.clear();

        this.slotsUI.destroy();
        this.detailsUI.destroy();
        this.container.destroy();
    }

    private createTierButton(tier: GlimmerFishTier): TierButton {
        const label = this.getTierLabel(tier);
        const key = this.createTextTexture(label, '#f2e9dd');
        const labelImage = this.scene.add.image(0, 0, key).setOrigin(0.5, 0.5);
        const button = this.scene.add.image(0, 0, 'ui-group-button-unselected').setOrigin(0, 0);
        const container = this.scene.add.container(0, 0, [button, labelImage]);

        button.setInteractive({ useHandCursor: true });
        button.on('pointerdown', () => {
            if (tier === 'awakened' && !this.hasAwakenedFish()) return;
            this.activeTier = tier;
            this.render();
        });

        return {
            tier,
            button,
            labelImage,
            container,
            labelKey: key
        };
    }

    private layoutTierButton(tierButton: TierButton, x: number, y: number, scale: number) {
        tierButton.container.setPosition(x, y);
        tierButton.button.setPosition(0, 0);
        tierButton.container.setScale(scale);

        const labelH = this.getTextureHeight(tierButton.labelImage.texture.key);
        tierButton.labelImage.setScale(this.tierLabelScale);
        tierButton.labelImage.setPosition(
            Math.floor(this.tierButtonWidth / 2),
            Math.floor(this.tierButtonHeight / 2 - Math.max(1, labelH * 0.04 * this.tierLabelScale))
        );
    }

    private render() {
        this.displayEntries = this.getFilteredDisplayEntries(this.activeTier);
        this.slotEntryMap.clear();

        const totalSlots = 120;
        const slots: InventorySlotDisplay[] = Array.from({ length: totalSlots }, (_v, index) => ({
            index,
            item: null,
            count: 0
        }));

        this.displayEntries.forEach((entry, index) => {
            if (index >= totalSlots) return;
            slots[index] = {
                index,
                item: entry.display,
                count: entry.entry.count,
                sourceIndex: index
            };
            this.slotEntryMap.set(index, entry);
        });

        this.slotsUI.setSlots(slots, null);
        this.updateButtons();

        if (this.lastLayout) {
            this.layout(
                this.lastLayout.leftPageLeftEdgeX,
                this.lastLayout.leftPageTopEdgeY,
                this.lastLayout.rightPageLeftEdgeX,
                this.lastLayout.rightPageTopEdgeY,
                this.lastLayout.pageHeight,
                this.lastLayout.scale
            );
        }
    }

    private getFilteredDisplayEntries(tier: GlimmerFishTier): GlimmerDisplayEntry[] {
        return this.entries
            .filter((entry) => entry.tier === tier)
            .map((entry) => {
                const def = getItemDefinition(entry.itemId);
                if (!def || def.category !== 'Fish') return null;

                const display: InventoryDisplayItem = {
                    id: def.id,
                    name: getLocalizedItemName(def.id, def.name),
                    description: getLocalizedItemDescription(def.id, def.description),
                    count: entry.count,
                    stackSize: def.stackSize,
                    iconKey: `item-${def.id}-18`,
                    category: def.category
                };

                return { entry, display };
            })
            .filter((entry): entry is GlimmerDisplayEntry => Boolean(entry));
    }

    private updateButtons() {
        const awakenedDisabled = !this.hasAwakenedFish();

        this.applyButtonState(this.regularButton, this.activeTier === 'regular', false);
        this.applyButtonState(this.awakenedButton, this.activeTier === 'awakened', awakenedDisabled);
    }

    private applyButtonState(button: TierButton, active: boolean, disabled: boolean) {
        this.updateTierButtonTexture(button, active);

        if (disabled) {
            button.button.setTint(0x4f5563);
            button.button.setAlpha(0.86);
            button.labelImage.setTint(0x8e949f);
            button.labelImage.setAlpha(0.92);
            return;
        }

        button.button.clearTint();
        button.button.setAlpha(1);
        button.labelImage.clearTint();
        button.labelImage.setAlpha(1);
    }

    private updateTierButtonTexture(button: TierButton, active: boolean) {
        const baseTexture = active ? 'ui-group-button-selected' : 'ui-group-button-unselected';
        const newKey = this.createNineSliceTexture(
            baseTexture,
            this.tierButtonWidth,
            this.tierButtonHeight,
            this.tierButtonBorderX,
            this.tierButtonBorderY,
            `__glimmer_btn_${button.tier}_${this.buttonTextureCounter++}`
        );
        const oldKey = button.buttonTextureKey;
        button.buttonTextureKey = newKey;
        button.button.setTexture(newKey);

        if (oldKey && oldKey !== newKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
            this.generatedTextureKeys.delete(oldKey);
        }
    }

    private hasAwakenedFish() {
        return this.entries.some((entry) => entry.tier === 'awakened' && entry.count > 0);
    }

    private refreshLocalizedLabels() {
        this.updateTierLabel(this.regularButton, this.getTierLabel('regular'));
        this.updateTierLabel(this.awakenedButton, this.getTierLabel('awakened'));

        const newBowlLabelKey = this.createTextTexture(this.localeManager.t('glimmerbowl.placeholder', undefined, 'Fishbowl Preview'), '#9A9EA7');
        const oldBowlKey = this.bowlLabelKey;
        this.bowlLabelKey = newBowlLabelKey;
        this.bowlLabel.setTexture(newBowlLabelKey);
        if (oldBowlKey && this.scene.textures.exists(oldBowlKey)) {
            this.scene.textures.remove(oldBowlKey);
        }

        this.detailsUI.setSecondaryAction(this.onView ? (itemId, amount, _slotIndex) => this.onView?.(itemId, amount) : undefined, this.localeManager.t('glimmerbowl.details.view', undefined, 'View'));

        if (this.lastLayout) {
            this.layout(
                this.lastLayout.leftPageLeftEdgeX,
                this.lastLayout.leftPageTopEdgeY,
                this.lastLayout.rightPageLeftEdgeX,
                this.lastLayout.rightPageTopEdgeY,
                this.lastLayout.pageHeight,
                this.lastLayout.scale
            );
        }
    }

    private updateTierLabel(button: TierButton, label: string) {
        const newKey = this.createTextTexture(label, '#f2e9dd');
        const oldKey = button.labelKey;
        button.labelKey = newKey;
        button.labelImage.setTexture(newKey);
        if (oldKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private getTierLabel(tier: GlimmerFishTier) {
        if (tier === 'regular') {
            return this.localeManager.t('glimmerbowl.section.regular', undefined, 'Regular');
        }
        return this.localeManager.t('glimmerbowl.section.awakened', undefined, 'Awakened');
    }

    private createTextTexture(text: string, color: string) {
        const width = Math.max(1, this.fontRenderer.measureTextWidth(text, { charGap: this.fontCharGap }));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = this.fontCharSize;
        const ctx = canvas.getContext('2d')!;

        this.fontRenderer.drawText(ctx, text, 0, 0, { charGap: this.fontCharGap });

        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__glimmer_text_${this.labelTextureCounter++}`;
        if (this.scene.textures.exists(key)) {
            this.scene.textures.remove(key);
        }
        this.scene.textures.addCanvas(key, canvas);
        this.generatedTextureKeys.add(key);
        return key;
    }

    private createNineSliceTexture(
        key: string,
        width: number,
        height: number,
        borderX: number,
        borderY: number,
        overrideKey?: string
    ) {
        const srcTexture = this.scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = srcImage.width;
        const srcH = srcImage.height;

        const centerSrcW = srcW - borderX * 2;
        const centerSrcH = srcH - borderY * 2;
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const rtKey = overrideKey ?? `__glimmer_btn_${this.buttonTextureCounter++}`;
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

        if (this.scene.textures.exists(rtKey)) {
            this.scene.textures.remove(rtKey);
        }
        this.scene.textures.addCanvas(rtKey, canvas);
        this.generatedTextureKeys.add(rtKey);
        return rtKey;
    }

    private getTextureWidth(textureKey: string): number {
        const texture = this.scene.textures.get(textureKey);
        const source = texture.getSourceImage() as HTMLImageElement;
        return source?.width ?? 1;
    }

    private getTextureHeight(textureKey: string): number {
        const texture = this.scene.textures.get(textureKey);
        const source = texture.getSourceImage() as HTMLImageElement;
        return source?.height ?? 1;
    }
}
