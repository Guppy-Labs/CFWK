import Phaser from 'phaser';

export class PlayerHud {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private slots: Phaser.GameObjects.Image[] = [];
    private armorSlots: Phaser.GameObjects.Image[] = [];
    private rodSlot: Phaser.GameObjects.Image;
    private rightAccessorySlot: Phaser.GameObjects.Image;
    private rodIcon?: Phaser.GameObjects.Image;
    private rodKeyIcon: Phaser.GameObjects.Image;
    private rodSlotShine: Phaser.GameObjects.Image;
    private rodShineTween?: Phaser.Tweens.Tween;
    private rodNearWater = false;
    private onRodUse?: () => void;
    private hearts: Phaser.GameObjects.Image[] = [];
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
            this.slots.push(slot);
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

        this.container.add([
            ...this.armorSlots,
            this.rodSlot,
            this.rightAccessorySlot,
            ...this.slots,
            ...this.hearts,
            this.staminaBarBg,
            this.staminaFill,
            this.rodSlotShine,
            this.rodKeyIcon
        ]);
        this.layout();
        this.updateStaminaVisual();
    }

    setStamina(value: number) {
        this.stamina = Phaser.Math.Clamp(value, 0, 1);
    }

    setEquippedRod(itemId: string | null) {
        if (itemId === null) {
            this.rodIcon?.destroy();
            this.rodIcon = undefined;
            this.rodSlot.setTexture(this.rodSlotTextureKey);
            this.updateRodShine();
            return;
        }

        const textureKey = `item-${itemId}-18`;
        if (!this.scene.textures.exists(textureKey)) {
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

    setRodNearWater(isNearWater: boolean) {
        this.rodNearWater = isNearWater;
        this.updateRodShine();
    }

    setOnRodUse(handler?: () => void) {
        this.onRodUse = handler;
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

        const heartsStartX = width / 2 - heartsRowWidth / 2 + heartWidth / 2;
        const heartsY = slotsY - slotSize / 2 - this.heartSpacing - heartHeight / 2;

        this.hearts.forEach((heart, index) => {
            const x = heartsStartX + index * (heartWidth + heartGap);
            heart.setPosition(x, heartsY);
        });

        const staminaBarWidth = Math.round(slotsRowWidth * this.staminaBarWidthScale);
        const staminaY = heartsY - heartHeight / 2 - this.staminaSpacing - staminaBarHeight / 2;

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
        this.staminaFill.clearMask(true);
        this.staminaFillMask?.destroy();
        this.staminaFillMaskGraphics.destroy();
        this.rodShineTween?.stop();
        this.rodIcon?.destroy();
        this.rodKeyIcon.destroy();
        this.container.destroy();
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

    private createNineSliceTexture(key: string, width: number, height: number, borderX: number, borderY: number) {
        const srcTexture = this.scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = srcImage.width;
        const srcH = srcImage.height;

        const centerSrcW = srcW - borderX * 2;
        const centerSrcH = srcH - borderY * 2;
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const rtKey = `__hud_stamina_${this.staminaTextureCounter++}`;
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
}
