import Phaser from 'phaser';
import { GlimmerFishTier, GlimmerbowlEntry, getItemDefinition } from '@cfwk/shared';
import { InventoryItemDetailsUI } from '../inventory/InventoryItemDetailsUI';
import { InventoryDisplayItem, InventorySlotDisplay, InventorySlotsUI } from '../inventory/InventorySlotsUI';
import { LocaleManager } from '../../i18n/LocaleManager';
import { getLocalizedItemDescription, getLocalizedItemName } from '../../i18n/itemLocale';
import { BitmapFontRenderer } from '../BitmapFontRenderer';
import { ItemTextureLoader } from '../../assets/ItemTextureLoader';

type TierButton = {
    tier: 'all' | 'awakened';
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
    private static readonly BOWL_TEXTURE_KEY = 'ui-glimmerbowl';
    private static readonly BOWL_ANIM_KEY = 'ui-glimmerbowl-idle';

    private readonly detailsReserveExtra = 10;
    private readonly tierButtonWidth = 62;
    private readonly tierButtonHeight = 18;
    private readonly tierButtonGap = 5;
    private readonly tierButtonBorderX = 6;
    private readonly tierButtonBorderY = 6;

    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private localeManager = LocaleManager.getInstance();

    private bowlSprite: Phaser.GameObjects.Sprite;

    private regularButton: TierButton;
    private awakenedButton: TierButton;

    private slotsUI: InventorySlotsUI;
    private detailsUI: InventoryItemDetailsUI;

    private entries: GlimmerbowlEntry[] = [];
    private activeTier: 'all' | 'awakened' = 'all';
    private displayEntries: GlimmerDisplayEntry[] = [];
    private slotEntryMap = new Map<number, GlimmerDisplayEntry>();

    private onDrop?: (itemId: string, amount: number) => void;
    private onView?: (entry: GlimmerbowlEntry) => void;
    private onAwakenRequest?: (fishEntryId: string, scarItemId: string) => void;
    private ownedScars: Array<{ itemId: string; count: number; name: string }> = [];
    private hasOwnedScar = false;
    private scarPopup?: Phaser.GameObjects.Container;
    private scarPopupButtons: Phaser.GameObjects.Container[] = [];
    private transientMessageText?: Phaser.GameObjects.Text;

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
    private readonly itemTextureLoader = ItemTextureLoader.getInstance();
    private textureRefreshQueued = false;
    private labelTextureCounter = 0;
    private buttonTextureCounter = 0;
    private generatedTextureKeys = new Set<string>();

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
        this.scene = scene;
        this.fontRenderer = new BitmapFontRenderer(scene, this.fontCharSize);

        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.ensureBowlAnimation();
        this.bowlSprite = this.scene.add.sprite(0, 0, GlimmerbowlTabUI.BOWL_TEXTURE_KEY, 0).setOrigin(0.5, 0.5);
        this.bowlSprite.play(GlimmerbowlTabUI.BOWL_ANIM_KEY);

        this.regularButton = this.createTierButton('all');
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
        this.detailsUI.setSecondaryAction((_itemId, _amount, _slotIndex) => {
            const selectedEntry = this.getSelectedEntry();
            if (!selectedEntry) return;
            this.onView?.(selectedEntry.entry);
        }, this.localeManager.t('glimmerbowl.details.view', undefined, 'View'));
        this.detailsUI.setTertiaryAction(undefined, this.localeManager.t('glimmerbowl.action.awake', undefined, 'Awake'));

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
            this.refreshAwakeDetailsAction(slotIndex);
            this.slotsUI.setBottomReservedHeight(this.detailsUI.getReservedHeight() + this.detailsReserveExtra);
        });

        this.container.add([
            this.bowlSprite,
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
                id: entry.id,
                itemId: entry.itemId,
                tier: (entry.tier === 'awakened' ? 'awakened' : 'regular') as GlimmerFishTier,
                stats: entry.stats,
                awakenedByScarId: entry.awakenedByScarId ?? null
            }))
            .filter((entry) => Boolean(entry.id) && Boolean(entry.itemId));

        if (this.activeTier === 'awakened' && !this.hasAwakenedFish()) {
            this.activeTier = 'all';
        }

        this.render();
    }

    setOnDrop(callback?: (itemId: string, amount: number) => void) {
        this.onDrop = callback;
    }

    setOnView(callback?: (entry: GlimmerbowlEntry) => void) {
        this.onView = callback;
    }

    setOnAwakenRequest(callback?: (fishEntryId: string, scarItemId: string) => void) {
        this.onAwakenRequest = callback;
    }

    setOwnedScars(scars: Array<{ itemId: string; count: number; name: string }>) {
        this.ownedScars = scars.filter((entry) => entry.count > 0);
    }

    setHasOwnedScar(value: boolean) {
        this.hasOwnedScar = value;
        this.refreshAwakeDetailsAction(this.slotsUI.getSelectedDisplayIndex());
        this.updateButtons();
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

        this.bowlSprite.setPosition(
            Math.floor(bowlX + bowlW / 2),
            Math.floor(bowlY + bowlH / 2)
        );
        const bowlScale = Math.max(0.1, Math.min(bowlW / 32, bowlH / 32));
        this.bowlSprite.setScale(bowlScale);

        const buttonY = Math.floor(leftPageTopEdgeY + (bowlHeight + 8 + leftVerticalOffset) * scale);
        const leftButtonX = Math.floor(leftPageLeftEdgeX + (leftPad + leftInwardOffset) * scale);
        const rightButtonX = Math.floor(leftButtonX + (this.tierButtonWidth + this.tierButtonGap) * scale);

        this.layoutTierButton(this.regularButton, leftButtonX, buttonY, scale);
        this.layoutTierButton(this.awakenedButton, rightButtonX, buttonY, scale);

        const rightContentX = Math.floor(rightPageLeftEdgeX + rightInwardOffset * scale);
        this.slotsUI.layout(rightContentX, rightPageTopEdgeY, pageHeight, scale);
        this.detailsUI.layout(rightContentX, rightPageTopEdgeY, pageHeight, scale);
        this.layoutScarPopup();
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
        this.closeScarPopup();
        this.transientMessageText?.destroy();
        this.transientMessageText = undefined;

        this.slotsUI.destroy();
        this.detailsUI.destroy();
        this.container.destroy();
    }

    private createTierButton(tier: 'all' | 'awakened'): TierButton {
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
                count: 1,
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

    private getFilteredDisplayEntries(tier: 'all' | 'awakened'): GlimmerDisplayEntry[] {
        return this.entries
            .filter((entry) => (tier === 'all' ? true : entry.tier === 'awakened'))
            .map((entry) => {
                const def = getItemDefinition(entry.itemId);
                if (!def || def.category !== 'Fish') return null;

                const display: InventoryDisplayItem = {
                    id: def.id,
                    name: getLocalizedItemName(def.id, def.name),
                    description: getLocalizedItemDescription(def.id, def.description),
                    count: 1,
                    stackSize: def.stackSize,
                    iconKey: `item-${def.id}-18`,
                    category: def.category,
                    glowColor: entry.tier === 'awakened' ? this.getRarityGlowColor(def.rarity) : undefined,
                    backgroundIconKey: entry.tier === 'awakened' && entry.awakenedByScarId ? `item-${entry.awakenedByScarId}-18` : undefined,
                    backgroundAlpha: entry.tier === 'awakened' ? 0.9 : undefined,
                    suppressRarityFrame: entry.tier === 'awakened'
                };

                const fishIconKey = `item-${def.id}-18`;
                if (!this.scene.textures.exists(fishIconKey)) {
                    void this.itemTextureLoader.ensureItemIconTexture(this.scene, def.id, 18).then(() => {
                        this.queueTextureRefresh();
                    });
                }
                if (entry.awakenedByScarId) {
                    const scarIconKey = `item-${entry.awakenedByScarId}-18`;
                    if (!this.scene.textures.exists(scarIconKey)) {
                        void this.itemTextureLoader.ensureItemIconTexture(this.scene, entry.awakenedByScarId, 18).then(() => {
                            this.queueTextureRefresh();
                        });
                    }
                }

                return { entry, display };
            })
            .filter((entry): entry is GlimmerDisplayEntry => Boolean(entry));
    }

    private queueTextureRefresh() {
        if (this.textureRefreshQueued) return;
        this.textureRefreshQueued = true;
        this.scene.time.delayedCall(0, () => {
            this.textureRefreshQueued = false;
            if (!this.container.active) return;
            this.render();
        });
    }

    private updateButtons() {
        const awakenedDisabled = !this.hasAwakenedFish();

        this.applyButtonState(this.regularButton, this.activeTier === 'all', false);
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
        return this.entries.some((entry) => entry.tier === 'awakened');
    }

    private refreshLocalizedLabels() {
        this.updateTierLabel(this.regularButton, this.getTierLabel('all'));
        this.updateTierLabel(this.awakenedButton, this.getTierLabel('awakened'));

        this.detailsUI.setSecondaryAction(
            this.onView
                ? (_itemId, _amount, _slotIndex) => {
                    const selectedEntry = this.getSelectedEntry();
                    if (!selectedEntry) return;
                    this.onView?.(selectedEntry.entry);
                }
                : undefined,
            this.localeManager.t('glimmerbowl.details.view', undefined, 'View')
        );
        this.refreshAwakeDetailsAction(this.slotsUI.getSelectedDisplayIndex());

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

    private getTierLabel(tier: 'all' | 'awakened') {
        if (tier === 'all') {
            return this.localeManager.t('glimmerbowl.section.all', undefined, 'All');
        }
        return this.localeManager.t('glimmerbowl.section.awakened', undefined, 'Awakened');
    }

    private getSelectedEntry(): GlimmerDisplayEntry | null {
        const selectedDisplayIndex = this.slotsUI.getSelectedDisplayIndex();
        if (selectedDisplayIndex === undefined || selectedDisplayIndex < 0) return null;
        return this.slotEntryMap.get(selectedDisplayIndex) ?? null;
    }

    private refreshAwakeDetailsAction(selectedDisplayIndex?: number) {
        const selectedEntry = selectedDisplayIndex === undefined
            ? null
            : this.slotEntryMap.get(selectedDisplayIndex) ?? null;
        const canShowAwake = this.hasOwnedScar && Boolean(selectedEntry) && selectedEntry?.entry.tier === 'regular';
        this.detailsUI.setTertiaryAction(
            canShowAwake
                ? (_itemId, _amount, _slotIndex) => {
                    if (this.ownedScars.length <= 0) {
                        this.showTransientMessage(this.localeManager.t('glimmerbowl.popup.noScarsOwned', undefined, 'No Scars Owned'));
                        return;
                    }
                    if (!selectedEntry) return;
                    this.openScarPopup(selectedEntry.entry.id);
                }
                : undefined,
            this.localeManager.t('glimmerbowl.action.awake', undefined, 'Awake')
        );
    }

    private openScarPopup(fishEntryId: string) {
        this.closeScarPopup();
        const popupWidth = 180;
        const popupHeight = 130;
        const bg = this.scene.add.rectangle(0, 0, popupWidth, popupHeight, 0x1a120f, 0.95).setOrigin(0.5, 0.5);
        bg.setStrokeStyle(2, 0x9e7a4f, 1);
        const title = this.scene.add.text(0, -50, this.localeManager.t('glimmerbowl.popup.scarsTitle', undefined, 'Select Scar'), {
            fontFamily: 'Minecraft, monospace',
            fontSize: '14px',
            color: '#f2e9dd'
        }).setOrigin(0.5, 0.5);
        const container = this.scene.add.container(0, 0, [bg, title]);
        this.scarPopup = container;
        this.container.add(container);
        this.scarPopupButtons = [];

        const scarButtons = this.ownedScars.slice(0, 4);
        scarButtons.forEach((scar, index) => {
            const y = -24 + index * 22;
            const buttonBg = this.scene.add.rectangle(0, y, 150, 18, 0x3a2a21, 1).setOrigin(0.5, 0.5);
            buttonBg.setStrokeStyle(1, 0xb28a5d, 1);
            const label = this.scene.add.text(0, y, `${scar.name} x${scar.count}`, {
                fontFamily: 'Minecraft, monospace',
                fontSize: '11px',
                color: '#ffd84d'
            }).setOrigin(0.5, 0.5);
            buttonBg.setInteractive({ useHandCursor: true });
            buttonBg.on('pointerdown', () => {
                this.onAwakenRequest?.(fishEntryId, scar.itemId);
                this.closeScarPopup();
            });
            const row = this.scene.add.container(0, 0, [buttonBg, label]);
            this.scarPopupButtons.push(row);
            container.add(row);
        });

        const backBg = this.scene.add.rectangle(0, 45, 72, 16, 0x4b2e20, 1).setOrigin(0.5, 0.5);
        backBg.setStrokeStyle(1, 0xb28a5d, 1);
        const backLabel = this.scene.add.text(0, 45, this.localeManager.t('glimmerbowl.popup.back', undefined, 'Back'), {
            fontFamily: 'Minecraft, monospace',
            fontSize: '10px',
            color: '#f2e9dd'
        }).setOrigin(0.5, 0.5);
        backBg.setInteractive({ useHandCursor: true });
        backBg.on('pointerdown', () => this.closeScarPopup());
        container.add([backBg, backLabel]);
        this.layoutScarPopup();
    }

    private closeScarPopup() {
        this.scarPopupButtons.forEach((button) => button.destroy());
        this.scarPopupButtons = [];
        this.scarPopup?.destroy();
        this.scarPopup = undefined;
    }

    private layoutScarPopup() {
        if (!this.scarPopup || !this.lastLayout) return;
        const x = Math.floor(this.lastLayout.rightPageLeftEdgeX + 70 * this.lastLayout.scale);
        const y = Math.floor(this.lastLayout.rightPageTopEdgeY + 66 * this.lastLayout.scale);
        this.scarPopup.setPosition(x, y);
    }

    private showTransientMessage(text: string) {
        if (!this.transientMessageText) {
            this.transientMessageText = this.scene.add.text(0, 0, '', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '14px',
                color: '#ffd84d',
                stroke: '#3a1f12',
                strokeThickness: 3
            }).setOrigin(0.5, 0.5).setDepth(13010).setVisible(false);
            this.container.add(this.transientMessageText);
        }
        this.transientMessageText.setText(text);
        this.transientMessageText.setPosition(205, 24);
        this.transientMessageText.setAlpha(1);
        this.transientMessageText.setVisible(true);
        this.scene.tweens.killTweensOf(this.transientMessageText);
        this.scene.tweens.add({
            targets: this.transientMessageText,
            alpha: 0,
            duration: 1000,
            delay: 650,
            onComplete: () => this.transientMessageText?.setVisible(false)
        });
    }

    private getRarityGlowColor(rarity?: string): number {
        switch ((rarity ?? 'common').toLowerCase()) {
            case 'uncommon':
                return 0xb7ff63;
            case 'rare':
                return 0x8fd7ff;
            case 'epic':
                return 0xd2a3ff;
            case 'legendary':
                return 0xffbf52;
            case 'mythic':
                return 0xff7fd1;
            case 'divine':
                return 0x8fd7ff;
            case 'supreme':
                return 0x8fd7ff;
            case 'common':
            default:
                return 0xffffff;
        }
    }

    private ensureBowlAnimation() {
        if (this.scene.anims.exists(GlimmerbowlTabUI.BOWL_ANIM_KEY)) return;

        this.scene.anims.create({
            key: GlimmerbowlTabUI.BOWL_ANIM_KEY,
            frames: this.scene.anims.generateFrameNumbers(GlimmerbowlTabUI.BOWL_TEXTURE_KEY, { start: 0, end: 8 }),
            frameRate: 6,
            repeat: -1
        });
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

    private getTextureHeight(textureKey: string): number {
        const texture = this.scene.textures.get(textureKey);
        const source = texture.getSourceImage() as HTMLImageElement;
        return source?.height ?? 1;
    }
}
