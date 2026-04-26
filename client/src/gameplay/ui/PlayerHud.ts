import Phaser from 'phaser';
import { ItemTextureLoader } from '../assets/ItemTextureLoader';
import { LocaleManager } from '../i18n/LocaleManager';

export class PlayerHud {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private slots: Phaser.GameObjects.Image[] = [];
    private usableIcons: Array<Phaser.GameObjects.Image | undefined> = [];
    private usableCountTexts: Phaser.GameObjects.Text[] = [];
    private armorSlots: Phaser.GameObjects.Image[] = [];
    private rodSlot: Phaser.GameObjects.Image;
    private rightAccessorySlot: Phaser.GameObjects.Image;
    private rodIcon?: Phaser.GameObjects.Image;
    private rodKeyIcon: Phaser.GameObjects.Image;
    private rodSlotShine: Phaser.GameObjects.Image;
    private rodShineTween?: Phaser.Tweens.Tween;
    private rodNearWater = false;
    private onRodUse?: () => void;
    private onUsableSlotUse?: (slotIndex: number) => void;
    private localeManager = LocaleManager.getInstance();
    private skipToNightButton?: Phaser.GameObjects.Container;
    private skipToNightBg?: Phaser.GameObjects.Image;
    private skipToNightLabel?: Phaser.GameObjects.Text;
    private skipToNightTextureKey?: string;
    private skipToNightTextureCounter = 0;
    private skipToNightCurrentW = 0;
    private skipToNightCurrentH = 0;
    private skipToNightVisible = false;
    private onSkipToNight?: () => void;
    private equippedRodItemId: string | null = null;
    private equippedUsableItemIds: Array<string | null> = Array.from({ length: 4 }, () => null);
    private equippedUsableCounts: number[] = Array.from({ length: 4 }, () => 0);
    private readonly itemTextureLoader = ItemTextureLoader.getInstance();
    private hearts: Phaser.GameObjects.Image[] = [];
    private currentHearts = 9;
    private maxHearts = 9;
    private staminaBarBg: Phaser.GameObjects.Image;
    private staminaFill: Phaser.GameObjects.TileSprite;
    private staminaFillMaskGraphics: Phaser.GameObjects.Graphics;
    private staminaFillMask?: Phaser.Display.Masks.GeometryMask;

    private stamina = 1;
    private displayStamina = 1;

    private currentBarWidth = 0;
    private currentBarHeight = 0;
    private staminaTextureKey?: string;
    private staminaTextureCounter = 0;
    private staminaInnerWidth = 0;
    private staminaInnerHeight = 0;

    private readonly slotCount = 4;
    private readonly slotScale = 2;
    private readonly slotGap = 6;
    private readonly armorSlotScale = 1.4;
    private readonly armorSlotGap = 4;
    private readonly armorStackGapX = 8;
    private readonly rodSlotGapX = 6;
    private readonly rodSlotTextureKey = 'ui-hud-slot';
    private readonly filledSlotTextureKey = 'ui-hud-slot-filled';
    private readonly heartCount = 9;
    private readonly heartScale = 2;
    private readonly bottomPadding = 12;
    private readonly heartSpacing = 6;
    private readonly staminaSpacing = 8;
    private readonly barScale = 1.3;
    private readonly staminaBarWidthScale = 1;
    private readonly barBorderX = 4;
    private readonly barBorderY = 2;

    private readonly staminaLerpSpeed = 8;
    private readonly normalColor = 0xfcb97c;
    private readonly lowColor = 0xe04040;
    private readonly lowThreshold = 0.3;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.container = this.scene.add.container(0, 0);
        this.container.setDepth(3000);

        for (let i = 0; i < this.slotCount; i++) {
            const slot = this.scene.add.image(0, 0, 'ui-hud-slot').setOrigin(0.5, 0.5);
            slot.setScale(this.slotScale);
            slot.setInteractive({ useHandCursor: true });
            slot.on('pointerdown', () => this.handleUsableSlotUse(i));
            this.slots.push(slot);
            const countText = this.scene.add.text(0, 0, '', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '10px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 2
            }).setOrigin(1, 1);
            countText.setVisible(false);
            this.usableCountTexts.push(countText);
        }

        for (let i = 0; i < 4; i++) {
            const slot = this.scene.add.image(0, 0, 'ui-hud-slot').setOrigin(0.5, 0.5);
            slot.setScale(this.armorSlotScale);
            this.armorSlots.push(slot);
        }

        this.rodSlot = this.scene.add.image(0, 0, this.rodSlotTextureKey).setOrigin(0.5, 0.5);
        this.rodSlot.setScale(this.armorSlotScale);
        this.rodSlot.setInteractive({ useHandCursor: true });
        this.rodSlot.on('pointerdown', () => this.handleRodUse());
        this.rightAccessorySlot = this.scene.add.image(0, 0, this.rodSlotTextureKey).setOrigin(0.5, 0.5);
        this.rightAccessorySlot.setScale(this.armorSlotScale);
        this.rodSlotShine = this.scene.add.image(0, 0, this.rodSlotTextureKey).setOrigin(0.5, 0.5);
        this.rodSlotShine.setScale(this.armorSlotScale);
        this.rodSlotShine.setTintFill(0xffe36a);
        this.rodSlotShine.setAlpha(0);
        this.rodSlotShine.setBlendMode(Phaser.BlendModes.NORMAL);
        this.rodSlotShine.setVisible(false);
        this.rodKeyIcon = this.scene.add.image(0, 0, 'ui-hud-key-r').setOrigin(0, 0);
        this.rodKeyIcon.setScale(2);
        this.rodKeyIcon.setVisible(false);

        for (let i = 0; i < this.heartCount; i++) {
            const heart = this.scene.add.image(0, 0, 'ui-hud-heart').setOrigin(0.5, 0.5);
            heart.setScale(this.heartScale);
            this.hearts.push(heart);
        }

        this.staminaFill = this.scene.add.tileSprite(0, 0, 1, 1, 'ui-hud-stamina-fill').setOrigin(0, 0.5);
        this.staminaBarBg = this.scene.add.image(0, 0, 'ui-hud-stamina-bg').setOrigin(0.5, 0.5);
        this.staminaFillMaskGraphics = this.scene.add.graphics();
        this.staminaFillMaskGraphics.setVisible(false);
        this.staminaFillMask = this.staminaFillMaskGraphics.createGeometryMask();
        this.staminaFill.setMask(this.staminaFillMask);

        this.skipToNightLabel = this.scene.add.text(0, 0, this.localeManager.t('hud.skipToNight', undefined, 'Skip to Night'), {
            fontFamily: 'Minecraft, monospace',
            fontSize: '16px',
            color: '#f2e9dd'
        }).setOrigin(0.5).setAlign('center');
        this.skipToNightBg = this.scene.add.image(0, 0, 'ui-group-button-selected').setOrigin(0.5);
        this.skipToNightBg.setAlpha(0.6);
        this.skipToNightButton = this.scene.add.container(0, 0, [this.skipToNightBg, this.skipToNightLabel]);
        this.skipToNightButton.setVisible(false);
        this.skipToNightBg.setInteractive({ useHandCursor: true });
        this.skipToNightBg.on('pointerdown', () => this.handleSkipToNight());

        this.container.add([
            ...this.armorSlots,
            this.rodSlot,
            this.rightAccessorySlot,
            ...this.slots,
            ...this.usableCountTexts,
            ...this.hearts,
            this.staminaBarBg,
            this.staminaFill,
            this.rodSlotShine,
            this.rodKeyIcon,
            this.skipToNightButton
        ]);
        this.layout();
        this.updateHeartsVisual();
        this.updateStaminaVisual();
    }

    setHearts(currentHearts: number, maxHearts: number) {
        const normalizedMax = Math.max(1, Math.floor(maxHearts || 0));
        const normalizedCurrent = Math.max(0, Math.min(normalizedMax, Math.floor(currentHearts || 0)));
        this.maxHearts = normalizedMax;
        this.currentHearts = normalizedCurrent;
        this.updateHeartsVisual();
    }

    setStamina(value: number) {
        this.stamina = Phaser.Math.Clamp(value, 0, 1);
    }

    setEquippedRod(itemId: string | null) {
        this.equippedRodItemId = itemId;
        if (itemId === null) {
            this.rodIcon?.destroy();
            this.rodIcon = undefined;
            this.rodSlot.setTexture(this.rodSlotTextureKey);
            this.updateRodShine();
            return;
        }

        const textureKey = `item-${itemId}-18`;
        if (!this.scene.textures.exists(textureKey)) {
            void this.itemTextureLoader.ensureItemIconTexture(this.scene, itemId, 18).then(() => {
                if (this.equippedRodItemId !== itemId) return;
                this.setEquippedRod(itemId);
            });
            return;
        }

        if (this.rodIcon && this.rodIcon.texture.key === textureKey) {
            return;
        }

        this.rodIcon?.destroy();
        this.rodIcon = this.scene.add.image(0, 0, textureKey).setOrigin(0.5, 0.5);
        this.container.add(this.rodIcon);
        this.rodSlot.setTexture(this.filledSlotTextureKey);
        this.layout();
        this.container.bringToTop(this.rodSlotShine);
        this.updateRodShine();
    }

    setEquippedUsables(itemIds: Array<string | null>, counts?: number[]) {
        for (let index = 0; index < this.slotCount; index++) {
            const itemId = itemIds[index] ?? null;
            this.equippedUsableItemIds[index] = itemId;
            const existingIcon = this.usableIcons[index];
            if (!itemId) {
                this.equippedUsableCounts[index] = 0;
                existingIcon?.destroy();
                this.usableIcons[index] = undefined;
                this.slots[index].setTexture(this.rodSlotTextureKey);
                this.updateUsableCountText(index);
                continue;
            }

            const providedCount = Array.isArray(counts) && Number.isFinite(counts[index])
                ? Math.max(1, Math.floor(Number(counts[index])))
                : null;
            this.equippedUsableCounts[index] = providedCount ?? Math.max(1, this.equippedUsableCounts[index] || 1);
            this.slots[index].setTexture(this.filledSlotTextureKey);
            this.updateUsableCountText(index);

            const textureKey = `item-${itemId}-18`;
            if (!this.scene.textures.exists(textureKey)) {
                void this.itemTextureLoader.ensureItemIconTexture(this.scene, itemId, 18).then(() => {
                    if (this.equippedUsableItemIds[index] !== itemId) return;
                    this.setEquippedUsables([...this.equippedUsableItemIds], [...this.equippedUsableCounts]);
                });
                continue;
            }

            if (existingIcon && existingIcon.texture.key === textureKey) {
                this.slots[index].setTexture(this.filledSlotTextureKey);
                continue;
            }

            existingIcon?.destroy();
            const icon = this.scene.add.image(0, 0, textureKey).setOrigin(0.5, 0.5);
            this.usableIcons[index] = icon;
            this.container.add(icon);
            this.slots[index].setTexture(this.filledSlotTextureKey);
        }

        this.layout();
    }

    setRodNearWater(isNearWater: boolean) {
        this.rodNearWater = isNearWater;
        this.updateRodShine();
    }

    setOnRodUse(handler?: () => void) {
        this.onRodUse = handler;
    }

    setOnUsableSlotUse(handler?: (slotIndex: number) => void) {
        this.onUsableSlotUse = handler;
    }

    triggerUsableSlotUse(slotIndex: number) {
        this.handleUsableSlotUse(slotIndex);
    }

    getRodSlotScreenRect(): Phaser.Geom.Rectangle {
        const bounds = this.rodSlot.getBounds();
        return new Phaser.Geom.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);
    }

    getUsableSlotScreenRect(slotIndex: number): Phaser.Geom.Rectangle | null {
        if (slotIndex < 0 || slotIndex >= this.slots.length) return null;
        const slot = this.slots[slotIndex];
        const bounds = slot.getBounds();
        return new Phaser.Geom.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);
    }

    getHeartsRowScreenRect(): Phaser.Geom.Rectangle | null {
        if (this.hearts.length === 0) return null;

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const heart of this.hearts) {
            const bounds = heart.getBounds();
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.right);
            maxY = Math.max(maxY, bounds.bottom);
        }

        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            return null;
        }

        const padding = 6;
        return new Phaser.Geom.Rectangle(
            Math.max(0, minX - padding),
            Math.max(0, minY - padding),
            Math.max(1, (maxX - minX) + padding * 2),
            Math.max(1, (maxY - minY) + padding * 2)
        );
    }

    update(delta: number) {
        const deltaSeconds = delta / 1000;
        const diff = this.stamina - this.displayStamina;
        if (Math.abs(diff) > 0.001) {
            this.displayStamina += diff * this.staminaLerpSpeed * deltaSeconds;
            if (diff > 0) {
                this.displayStamina = Math.min(this.displayStamina, this.stamina);
            } else {
                this.displayStamina = Math.max(this.displayStamina, this.stamina);
            }
        } else {
            this.displayStamina = this.stamina;
        }

        this.updateStaminaVisual();
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    layout() {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const slotSize = 24 * this.slotScale;
        const armorSlotSize = 24 * this.armorSlotScale;
        const heartWidth = 9 * this.heartScale;
        const heartHeight = 7 * this.heartScale;
        const staminaBarHeight = Math.round(7 * this.barScale);

        const slotsRowWidth = this.slotCount * slotSize + (this.slotCount - 1) * this.slotGap;
        const heartGap = Math.max(1, (slotsRowWidth - this.heartCount * heartWidth) / Math.max(1, this.heartCount - 1));
        const heartsRowWidth = this.heartCount * heartWidth + (this.heartCount - 1) * heartGap;

        const slotsStartX = width / 2 - slotsRowWidth / 2 + slotSize / 2;
        const slotsY = height - this.bottomPadding - slotSize / 2;

        this.slots.forEach((slot, index) => {
            const x = slotsStartX + index * (slotSize + this.slotGap);
            slot.setPosition(x, slotsY);
        });

        this.usableIcons.forEach((icon, index) => {
            if (!icon) return;
            const slot = this.slots[index];
            const targetSize = slotSize * 0.65;
            const iconScale = targetSize / 18;
            icon.setScale(iconScale);
            icon.setPosition(slot.x, slot.y);
        });

        this.usableCountTexts.forEach((countText, index) => {
            const slot = this.slots[index];
            const countX = slot.x + slotSize / 2 - 3;
            const countY = slot.y + slotSize / 2 - 2;
            countText.setPosition(Math.round(countX), Math.round(countY));
        });

        const bottomEdgeY = slotsY + slotSize / 2;
        const armorBottomY = bottomEdgeY - armorSlotSize / 2;
        const armorTopY = armorBottomY - armorSlotSize - this.armorSlotGap;
        const leftStackX = slotsStartX - slotSize / 2 - this.armorStackGapX - armorSlotSize / 2;
        const rightStackX = slotsStartX + slotsRowWidth - slotSize / 2 + this.armorStackGapX + armorSlotSize / 2;

        this.armorSlots[0].setPosition(leftStackX, armorTopY);
        this.armorSlots[1].setPosition(leftStackX, armorBottomY);
        this.armorSlots[2].setPosition(rightStackX, armorTopY);
        this.armorSlots[3].setPosition(rightStackX, armorBottomY);

        const rodX = leftStackX - armorSlotSize / 2 - this.rodSlotGapX - armorSlotSize / 2;
        const rodY = armorBottomY;
        this.rodSlot.setPosition(rodX, rodY);
        this.rodSlotShine.setPosition(rodX, rodY);
        this.rodSlotShine.setScale(this.armorSlotScale);
        const slotHalf = armorSlotSize / 2;
        this.rodKeyIcon.setPosition(rodX - slotHalf - 4, rodY - slotHalf - 4);

        const rightAccessoryX = rightStackX + armorSlotSize / 2 + this.rodSlotGapX + armorSlotSize / 2;
        this.rightAccessorySlot.setPosition(rightAccessoryX, armorBottomY);

        if (this.rodIcon) {
            const targetSize = armorSlotSize * 0.75;
            const iconScale = targetSize / 18;
            this.rodIcon.setScale(iconScale);
            this.rodIcon.setPosition(rodX, rodY);
        }
        this.container.bringToTop(this.rodKeyIcon);
        this.usableIcons.forEach((icon) => {
            if (icon) {
                this.container.bringToTop(icon);
            }
        });
        this.usableCountTexts.forEach((countText) => {
            this.container.bringToTop(countText);
        });

        const heartsStartX = width / 2 - heartsRowWidth / 2 + heartWidth / 2;
        const heartsY = slotsY - slotSize / 2 - this.heartSpacing - heartHeight / 2;

        this.hearts.forEach((heart, index) => {
            const x = heartsStartX + index * (heartWidth + heartGap);
            heart.setPosition(x, heartsY);
        });
        this.updateHeartsVisual();

        const staminaBarWidth = Math.round(slotsRowWidth * this.staminaBarWidthScale);
        const staminaY = heartsY - heartHeight / 2 - this.staminaSpacing - staminaBarHeight / 2;

        this.layoutSkipToNightButton(width, staminaY, staminaBarHeight);

        this.updateStaminaBarTexture(staminaBarWidth, staminaBarHeight);

        this.staminaBarBg.setPosition(width / 2, staminaY);

        this.staminaInnerWidth = Math.max(1, staminaBarWidth - this.barBorderX * 2);
        this.staminaInnerHeight = Math.max(1, staminaBarHeight - this.barBorderY * 2);
        const fillX = width / 2 - staminaBarWidth / 2 + this.barBorderX - 1;

        this.staminaFill.setPosition(fillX, staminaY);
        const fillTexture = this.scene.textures.get('ui-hud-stamina-fill');
        const source = fillTexture.getSourceImage() as HTMLImageElement | undefined;
        if (source && source.height > 0) {
            const scaleY = this.staminaInnerHeight / source.height;
            this.staminaFill.setTileScale(1, scaleY);
        }

        this.updateStaminaVisual();
    }

    destroy() {
        if (this.staminaTextureKey && this.scene.textures.exists(this.staminaTextureKey)) {
            this.scene.textures.remove(this.staminaTextureKey);
        }
        if (this.skipToNightTextureKey && this.scene.textures.exists(this.skipToNightTextureKey)) {
            this.scene.textures.remove(this.skipToNightTextureKey);
        }
        this.staminaFill.clearMask(true);
        this.staminaFillMask?.destroy();
        this.staminaFillMaskGraphics.destroy();
        this.rodShineTween?.stop();
        this.rodIcon?.destroy();
        this.usableIcons.forEach((icon) => icon?.destroy());
        this.usableCountTexts.forEach((countText) => countText.destroy());
        this.rodKeyIcon.destroy();
        this.skipToNightButton?.destroy();
        this.container.destroy();
    }

    setSkipToNightVisible(visible: boolean) {
        if (this.skipToNightVisible === visible) return;
        this.skipToNightVisible = visible;
        this.skipToNightButton?.setVisible(visible);
    }

    setOnSkipToNight(handler?: () => void) {
        this.onSkipToNight = handler;
    }

    private handleSkipToNight() {
        if (!this.skipToNightVisible) return;
        if (this.scene.registry.get('guiOpen') === true) return;
        if (this.scene.registry.get('inputBlocked') === true) return;
        this.onSkipToNight?.();
    }

    private layoutSkipToNightButton(width: number, staminaY: number, staminaBarHeight: number) {
        if (!this.skipToNightButton || !this.skipToNightBg || !this.skipToNightLabel) return;

        const targetButtonWidth = Math.round(Math.max(140, this.skipToNightLabel.width + 28));
        const targetButtonHeight = Math.max(30, Math.ceil(this.skipToNightLabel.height + 10));
        this.updateSkipToNightTexture(targetButtonWidth, targetButtonHeight);

        this.skipToNightBg.setDisplaySize(targetButtonWidth, targetButtonHeight);
        this.skipToNightLabel.setPosition(0, -2);

        const buttonX = width / 2;
        const buttonY = staminaY - staminaBarHeight / 2 - 6 - targetButtonHeight / 2;
        this.skipToNightButton.setPosition(buttonX, buttonY);
    }

    private updateSkipToNightTexture(width: number, height: number) {
        if (
            width === this.skipToNightCurrentW
            && height === this.skipToNightCurrentH
            && this.skipToNightTextureKey
            && this.scene.textures.exists(this.skipToNightTextureKey)
        ) {
            return;
        }
        this.skipToNightCurrentW = width;
        this.skipToNightCurrentH = height;

        const newKey = this.createNineSliceTexture('ui-group-button-selected', width, height, 6, 6, `__hud_skip_night_${this.skipToNightTextureCounter++}`);
        const oldKey = this.skipToNightTextureKey;
        this.skipToNightTextureKey = newKey;
        this.skipToNightBg?.setTexture(newKey);
        if (oldKey && oldKey !== newKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private updateUsableCountText(slotIndex: number) {
        const countText = this.usableCountTexts[slotIndex];
        const hasItem = Boolean(this.equippedUsableItemIds[slotIndex]);
        const count = Math.max(0, Math.floor(this.equippedUsableCounts[slotIndex] ?? 0));
        if (!hasItem || count <= 1) {
            countText.setVisible(false);
            return;
        }
        countText.setText(String(count));
        countText.setVisible(true);
    }

    private updateRodShine() {
        const shouldShow = this.rodNearWater && !!this.rodIcon;
        if (!shouldShow) {
            this.rodShineTween?.stop();
            this.rodShineTween = undefined;
            this.rodSlotShine.setVisible(false);
            this.rodSlotShine.setAlpha(0);
            this.rodKeyIcon.setVisible(false);
            return;
        }

        this.rodSlotShine.setVisible(true);
        this.rodKeyIcon.setVisible(!this.isMobileDevice());
        if (!this.rodShineTween) {
            this.rodSlotShine.setAlpha(0.55);
            this.rodShineTween = this.scene.tweens.add({
                targets: this.rodSlotShine,
                alpha: { from: 0.45, to: 0.85 },
                duration: 550,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.inOut'
            });
        }
    }

    private handleRodUse() {
        if (!this.rodNearWater || !this.rodIcon) return;
        const guiOpen = this.scene.registry.get('guiOpen') === true;
        if (guiOpen) return;
        this.onRodUse?.();
    }

    private handleUsableSlotUse(slotIndex: number) {
        if (slotIndex < 0 || slotIndex >= this.equippedUsableItemIds.length) return;
        if (!this.equippedUsableItemIds[slotIndex]) return;
        const guiOpen = this.scene.registry.get('guiOpen') === true;
        if (guiOpen) return;
        this.onUsableSlotUse?.(slotIndex);
    }

    private isMobileDevice(): boolean {
        const os = this.scene.sys.game.device.os;
        return Boolean(os.android || os.iOS || os.iPad || os.iPhone || os.windowsPhone);
    }

    private updateStaminaBarTexture(width: number, height: number) {
        if (width === this.currentBarWidth && height === this.currentBarHeight) return;
        this.currentBarWidth = width;
        this.currentBarHeight = height;

        const newKey = this.createNineSliceTexture('ui-hud-stamina-bg', width, height, this.barBorderX, this.barBorderY);
        const oldKey = this.staminaTextureKey;
        this.staminaTextureKey = newKey;

        this.staminaBarBg.setTexture(newKey);

        if (oldKey && oldKey !== newKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
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

        const rtKey = overrideKey ?? `__hud_stamina_${this.staminaTextureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        // Top row
        ctx.drawImage(srcImage, 0, 0, borderX, borderY, 0, 0, borderX, borderY);
        ctx.drawImage(srcImage, borderX, 0, centerSrcW, borderY, borderX, 0, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, 0, borderX, borderY, borderX + centerW, 0, borderX, borderY);

        // Middle row
        ctx.drawImage(srcImage, 0, borderY, borderX, centerSrcH, 0, borderY, borderX, centerH);
        ctx.drawImage(srcImage, borderX, borderY, centerSrcW, centerSrcH, borderX, borderY, centerW, centerH);
        ctx.drawImage(srcImage, srcW - borderX, borderY, borderX, centerSrcH, borderX + centerW, borderY, borderX, centerH);

        // Bottom row
        ctx.drawImage(srcImage, 0, srcH - borderY, borderX, borderY, 0, borderY + centerH, borderX, borderY);
        ctx.drawImage(srcImage, borderX, srcH - borderY, centerSrcW, borderY, borderX, borderY + centerH, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, srcH - borderY, borderX, borderY, borderX + centerW, borderY + centerH, borderX, borderY);

        this.scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private updateStaminaVisual() {
        const maxFillWidth = this.staminaInnerWidth + 4;
        const fillWidth = Math.max(0, Math.round(maxFillWidth * this.displayStamina));
        if (fillWidth <= 0) {
            this.staminaFill.setVisible(false);
            return;
        }

        this.staminaFill.setVisible(true);
        this.staminaFill.setSize(fillWidth, this.staminaInnerHeight);
        this.staminaFill.setDisplaySize(fillWidth, this.staminaInnerHeight);
        this.staminaFill.setTint(this.getBarColor());
        this.updateStaminaMask(fillWidth);
    }

    private updateStaminaMask(fillWidth: number) {
        this.staminaFillMaskGraphics.clear();
        if (fillWidth <= 0) return;

        const edgeHeight = Math.min(3, this.staminaInnerHeight);
        const fillTop = this.staminaFill.y - this.staminaInnerHeight / 2;
        const edgeTop = this.staminaFill.y - edgeHeight / 2;
        const baseX = this.staminaFill.x;
        const mainWidth = Math.max(0, fillWidth - 2);

        this.staminaFillMaskGraphics.fillStyle(0xffffff, 1);

        if (mainWidth > 0) {
            this.staminaFillMaskGraphics.fillRect(baseX + 1, fillTop, mainWidth, this.staminaInnerHeight);
        }

        if (fillWidth >= 1) {
            this.staminaFillMaskGraphics.fillRect(baseX, edgeTop, 1, edgeHeight);
        }

        if (fillWidth >= 2) {
            this.staminaFillMaskGraphics.fillRect(baseX + fillWidth - 1, edgeTop, 1, edgeHeight);
        }
    }

    private getBarColor(): number {
        if (this.displayStamina >= this.lowThreshold) {
            return this.normalColor;
        }

        const t = this.displayStamina / this.lowThreshold;
        const normalR = (this.normalColor >> 16) & 0xff;
        const normalG = (this.normalColor >> 8) & 0xff;
        const normalB = this.normalColor & 0xff;

        const lowR = (this.lowColor >> 16) & 0xff;
        const lowG = (this.lowColor >> 8) & 0xff;
        const lowB = this.lowColor & 0xff;

        const r = Math.round(lowR + (normalR - lowR) * t);
        const g = Math.round(lowG + (normalG - lowG) * t);
        const b = Math.round(lowB + (normalB - lowB) * t);
        return (r << 16) | (g << 8) | b;
    }

    private updateHeartsVisual() {
        const cappedMax = Math.max(1, this.maxHearts);
        this.hearts.forEach((heart, index) => {
            const logicalIndex = index + 1;
            if (logicalIndex > cappedMax) {
                heart.setVisible(false);
                return;
            }

            heart.setVisible(true);
            const filled = logicalIndex <= this.currentHearts;
            heart.setAlpha(filled ? 1 : 0.26);
        });
    }
}
