import Phaser from 'phaser';
import { FishCombatStats, GlimmerbowlEntry, ItemDefinition } from '@cfwk/shared';
import { LocaleManager } from '../../i18n/LocaleManager';
import { ItemTextureLoader } from '../../assets/ItemTextureLoader';

type FishViewCardData = {
    entry: GlimmerbowlEntry;
    fishDef: ItemDefinition;
    fishName: string;
    fishDescription: string;
    scarDef?: ItemDefinition | null;
    scarName?: string;
};

export class FishViewCardUI {
    private static readonly CARD_DEPTH = 13050;
    private static readonly OVERLAY_DEPTH = 13040;
    private static readonly BACK_BUTTON_DEPTH = 13060;

    private readonly scene: Phaser.Scene;
    private readonly localeManager = LocaleManager.getInstance();
    private readonly itemTextureLoader = ItemTextureLoader.getInstance();
    private readonly container: Phaser.GameObjects.Container;
    private readonly blocker: Phaser.GameObjects.Rectangle;
    private readonly cardContainer: Phaser.GameObjects.Container;
    private readonly contentContainer: Phaser.GameObjects.Container;
    private readonly backButtonContainer: Phaser.GameObjects.Container;
    private readonly backButtonBg: Phaser.GameObjects.Rectangle;
    private readonly backButtonText: Phaser.GameObjects.Text;

    private openState = false;
    private onClose?: () => void;
    private bannerTextureKey?: string;
    private scarFlickerTween?: Phaser.Tweens.Tween;
    private cardWidth = 120;
    private cardHeight = 168;
    // Scale is recomputed per render so short viewports (e.g. mobile landscape)
    // can shrink the card to avoid clipping top/bottom content.
    private cardScale = 3;
    private readonly maxCardScale = 3;
    private readonly minCardScale = 1.75;
    // Vertical space reserved below the card for the Back button + margins.
    private readonly backButtonReservePx = 88;
    private lastRenderEntryId?: string;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.blocker = this.scene.add.rectangle(0, 0, 1, 1, 0x000000, 0.58)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(FishViewCardUI.OVERLAY_DEPTH)
            .setInteractive({ useHandCursor: true });
        this.blocker.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (!this.openState) return;
            if (this.isPointerInsideCard(pointer.x, pointer.y)) return;
            this.close();
        });

        this.contentContainer = this.scene.add.container(0, 0);
        this.cardContainer = this.scene.add.container(0, 0, [this.contentContainer]);
        this.cardContainer.setDepth(FishViewCardUI.CARD_DEPTH);
        this.cardContainer.setScrollFactor(0);

        this.backButtonBg = this.scene.add.rectangle(0, 0, 132, 28, 0x503424, 1).setOrigin(0.5, 0.5);
        this.backButtonBg.setStrokeStyle(2, 0xb58b60, 1);
        this.backButtonBg.setInteractive({ useHandCursor: true });
        this.backButtonBg.on('pointerdown', () => this.close());
        this.backButtonText = this.scene.add.text(0, 0, '', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '15px',
            color: '#f5eadf'
        }).setOrigin(0.5, 0.5);
        this.backButtonContainer = this.scene.add.container(0, 0, [this.backButtonBg, this.backButtonText]);
        this.backButtonContainer.setDepth(FishViewCardUI.BACK_BUTTON_DEPTH);
        this.backButtonContainer.setScrollFactor(0);

        this.container = this.scene.add.container(0, 0, [
            this.blocker,
            this.cardContainer,
            this.backButtonContainer
        ]);
        this.container.setDepth(FishViewCardUI.OVERLAY_DEPTH);
        this.container.setVisible(false);
    }

    open(data: FishViewCardData, onClose?: () => void) {
        this.onClose = onClose;
        this.openState = true;
        this.backButtonText.setText(this.localeManager.t('glimmerbowl.view.back', undefined, 'Back'));
        this.renderCard(data);
        this.layout();
        this.container.setVisible(true);
    }

    close() {
        if (!this.openState) return;
        this.openState = false;
        this.container.setVisible(false);
        this.onClose?.();
        this.onClose = undefined;
    }

    isOpen() {
        return this.openState;
    }

    layout() {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        this.blocker.setSize(width, height);
        // Vertically recenter the card inside the budget (card + back button reserve)
        // rather than always shifting by -12 — keeps short viewports from pushing
        // the top of the card off screen.
        const scaledCardHeight = this.cardHeight * this.cardScale;
        const contentHeight = scaledCardHeight + this.backButtonReservePx;
        const contentTop = Math.max(8, Math.floor((height - contentHeight) / 2));
        const cardCenterY = contentTop + Math.floor(scaledCardHeight / 2);
        this.cardContainer.setPosition(Math.floor(width / 2), cardCenterY);
        // Place back button below the card, but clamp so it never clips the bottom.
        const desiredButtonY = cardCenterY + Math.floor(scaledCardHeight / 2) + 38;
        const clampedButtonY = Math.min(desiredButtonY, height - 24);
        this.backButtonContainer.setPosition(Math.floor(width / 2), clampedButtonY);
    }

    destroy() {
        this.clearCardContent();
        if (this.bannerTextureKey && this.scene.textures.exists(this.bannerTextureKey)) {
            this.scene.textures.remove(this.bannerTextureKey);
        }
        this.container.destroy();
    }

    private clearCardContent() {
        this.scarFlickerTween?.stop();
        this.scarFlickerTween = undefined;
        this.contentContainer.removeAll(true);
        if (this.bannerTextureKey && this.scene.textures.exists(this.bannerTextureKey)) {
            this.scene.textures.remove(this.bannerTextureKey);
        }
        this.bannerTextureKey = undefined;
    }

    private renderCard(data: FishViewCardData) {
        this.clearCardContent();
        this.lastRenderEntryId = data.entry.id;
        const awakened = data.entry.tier === 'awakened';

        // Pick a base square size, then fit the scaled card inside the viewport
        // so short screens (phone landscape, small windows) don't clip the
        // name or rarity icon.
        const viewportWidth = this.scene.scale.width;
        const viewportHeight = this.scene.scale.height;
        const baseWidth = Math.max(108, Math.min(136, Math.floor(viewportWidth / (this.maxCardScale * 1.65))));
        const baseHeight = Math.max(150, Math.min(186, Math.floor(viewportHeight / (this.maxCardScale * 1.5))));
        const squareSize = Math.max(baseWidth, baseHeight);
        this.cardWidth = squareSize;
        this.cardHeight = squareSize;

        const heightBudget = Math.max(1, viewportHeight - this.backButtonReservePx);
        const widthBudget = Math.max(1, viewportWidth - 16);
        const heightFitScale = heightBudget / this.cardHeight;
        const widthFitScale = widthBudget / this.cardWidth;
        const fitScale = Math.min(heightFitScale, widthFitScale, this.maxCardScale);
        this.cardScale = Math.max(this.minCardScale, fitScale);

        const bannerBaseKey = awakened ? 'ui-banner-a' : 'ui-banner-b';
        this.bannerTextureKey = this.createNineSliceTexture(
            bannerBaseKey,
            this.cardWidth,
            this.cardHeight,
            Math.floor((57 - 1) / 2),
            Math.floor((22 - 1) / 2)
        );
        const bg = this.scene.add.image(0, 0, this.bannerTextureKey).setOrigin(0.5, 0.5);
        bg.setScale(this.cardScale);
        this.contentContainer.add(bg);

        if (awakened && data.scarDef && this.scene.textures.exists(`item-${data.scarDef.id}`)) {
            const overlayInset = 4 * this.cardScale;
            const scarOverlay = this.scene.add.image(0, 0, `item-${data.scarDef.id}`).setOrigin(0.5, 0.5);
            scarOverlay.setDisplaySize(
                this.cardWidth * this.cardScale - overlayInset * 2,
                this.cardHeight * this.cardScale - overlayInset * 2
            );
            scarOverlay.setAlpha(0.5);
            this.contentContainer.add(scarOverlay);
        }

        const fullFishTextureKey = `item-${data.fishDef.id}`;
        const fallbackFishTextureKey = `item-${data.fishDef.id}-18`;
        const fishTextureKey = this.scene.textures.exists(fullFishTextureKey) ? fullFishTextureKey : fallbackFishTextureKey;
        const fishX = 0;
        const fishY = -this.cardHeight * this.cardScale * 0.505;
        const fishTargetSize = this.cardWidth * this.cardScale * 0.42;

        const fishShadow = this.scene.add.image(fishX + 3, fishY + 5, fishTextureKey).setOrigin(0.5, 0.5);
        fishShadow.setDisplaySize(fishTargetSize, fishTargetSize);
        fishShadow.setAngle(45);
        fishShadow.setTint(0x000000);
        fishShadow.setAlpha(0.3);
        this.contentContainer.add(fishShadow);

        const fishImage = this.scene.add.image(fishX, fishY, fishTextureKey).setOrigin(0.5, 0.5);
        fishImage.setDisplaySize(fishTargetSize, fishTargetSize);
        fishImage.setAngle(45);
        this.contentContainer.add(fishImage);

        const nameText = this.scene.add.text(0, -this.cardHeight * this.cardScale * 0.39, data.fishName, {
            fontFamily: 'Minecraft, monospace',
            fontSize: '50px',
            color: '#f6efe7',
            stroke: '#2b1d16',
            strokeThickness: 5,
            align: 'center'
        }).setOrigin(0.5, 0);
        this.contentContainer.add(nameText);

        let cursorY = nameText.y + nameText.height + 6;
        if (awakened && data.scarDef && data.scarName) {
            const scarColor = this.getRarityColorHex(data.scarDef.rarity);
            const scarText = this.scene.add.text(0, cursorY, data.scarName, {
                fontFamily: 'Minecraft, monospace',
                fontSize: '19px',
                color: scarColor,
                stroke: '#21140f',
                strokeThickness: 4,
                align: 'center'
            }).setOrigin(0.5, 0);
            this.contentContainer.add(scarText);
            this.scarFlickerTween = this.scene.tweens.add({
                targets: scarText,
                alpha: { from: 0.76, to: 1 },
                duration: 360,
                yoyo: true,
                repeat: -1
            });
            cursorY += scarText.height + 10;
        } else {
            cursorY += 10;
        }

        this.contentContainer.add(this.createDivider(cursorY));
        cursorY += 14;

        const descText = this.scene.add.text(0, cursorY, data.fishDescription, {
            fontFamily: 'Minecraft, monospace',
            fontSize: '15px',
            color: '#e9dccd',
            align: 'center',
            wordWrap: { width: this.cardWidth * this.cardScale * 0.78 }
        }).setOrigin(0.5, 0);
        this.contentContainer.add(descText);
        cursorY += descText.height + 10;

        this.contentContainer.add(this.createDivider(cursorY));
        cursorY += 12;

        if (awakened) {
            cursorY = this.addStatsGrid(data.entry.stats, cursorY);
            cursorY += 12;
        }

        if (awakened) {
            const knifeCard = this.scene.add.rectangle(0, cursorY + 22, this.cardWidth * this.cardScale * 0.62, 42, 0x2f2018, 0.60).setOrigin(0.5, 0.5);
            knifeCard.setStrokeStyle(2, 0x9c724f, 1);
            this.contentContainer.add(knifeCard);
            const knifeIcon = this.scene.add.image(-knifeCard.width * 0.36, cursorY + 22, 'ui-slot-placeholder-knife').setOrigin(0.5, 0.5);
            knifeIcon.setScale(1.45);
            this.contentContainer.add(knifeIcon);
            const knifeLabel = this.scene.add.text(-knifeCard.width * 0.15, cursorY + 22, this.localeManager.t('glimmerbowl.view.knifePlaceholder', undefined, 'Equip a Knife'), {
                fontFamily: 'Minecraft, monospace',
                fontSize: '16px',
                color: '#f2e9dd'
            }).setOrigin(0, 0.5);
            this.contentContainer.add(knifeLabel);
        }

        const rarityKey = this.getRarityIconKey(data.fishDef.rarity);
        const rarityIcon = this.scene.add.image(this.cardWidth * this.cardScale * 0.57, this.cardHeight * this.cardScale * 0.58, rarityKey).setOrigin(1, 1);
        rarityIcon.setScale(2.0);
        if (rarityKey === 'ui-rarity-supreme') {
            rarityIcon.y += 4;
        }
        this.contentContainer.add(rarityIcon);
        this.ensureMissingItemTextures(data);
    }

    private ensureMissingItemTextures(data: FishViewCardData) {
        const pending: Promise<unknown>[] = [];
        if (!this.scene.textures.exists(`item-${data.fishDef.id}`)) {
            pending.push(this.itemTextureLoader.ensureItemTexture(this.scene, data.fishDef.id));
        }
        if (!this.scene.textures.exists(`item-${data.fishDef.id}-18`)) {
            pending.push(this.itemTextureLoader.ensureItemIconTexture(this.scene, data.fishDef.id, 18));
        }
        if (data.scarDef && !this.scene.textures.exists(`item-${data.scarDef.id}`)) {
            pending.push(this.itemTextureLoader.ensureItemTexture(this.scene, data.scarDef.id));
        }
        if (pending.length === 0) return;
        Promise.allSettled(pending).then(() => {
            if (!this.openState) return;
            if (this.lastRenderEntryId !== data.entry.id) return;
            this.renderCard(data);
            this.layout();
        });
    }

    private addStatsGrid(stats: FishCombatStats, topY: number): number {
        const entries: Array<{ label: string; value: string; color: string }> = [
            { label: this.localeManager.t('glimmerbowl.view.stats.damage', undefined, 'Damage'), value: `${Math.round(stats.damage)}`, color: '#ff9d6b' },
            { label: this.localeManager.t('glimmerbowl.view.stats.speed', undefined, 'Speed'), value: `${Math.round(stats.speed)}`, color: '#7fd4ff' },
            { label: this.localeManager.t('glimmerbowl.view.stats.critDamage', undefined, 'Crit Damage'), value: `${this.formatCritDamage(stats.critDamage)}x`, color: '#f5a4ff' },
            { label: this.localeManager.t('glimmerbowl.view.stats.critRate', undefined, 'Crit Rate'), value: `${Math.round(stats.critRate * 100)}%`, color: '#ffd477' },
            { label: this.localeManager.t('glimmerbowl.view.stats.energy', undefined, 'Energy'), value: `${Math.round(stats.energy)}`, color: '#bff582' }
        ];
        const leftX = -this.cardWidth * this.cardScale * 0.34;
        const rightX = this.cardWidth * this.cardScale * 0.04;
        const rowHeight = 21;
        entries.forEach((entry, index) => {
            const x = index % 2 === 0 ? leftX : rightX;
            const y = topY + Math.floor(index / 2) * rowHeight;
            const text = this.scene.add.text(x, y, `${entry.label}: ${entry.value}`, {
                fontFamily: 'Minecraft, monospace',
                fontSize: '13px',
                color: entry.color
            }).setOrigin(0, 0);
            this.contentContainer.add(text);
        });
        const rows = Math.ceil(entries.length / 2);
        return topY + rows * rowHeight;
    }

    private createDivider(y: number) {
        return this.scene.add.rectangle(0, y, this.cardWidth * this.cardScale * 0.84, 2, 0xb88d66, 1).setOrigin(0.5, 0.5);
    }

    private formatCritDamage(value: number) {
        const rounded = Math.round(value * 100) / 100;
        return Number.isInteger(rounded) ? `${rounded.toFixed(0)}` : `${rounded.toFixed(2)}`;
    }

    private isPointerInsideCard(x: number, y: number) {
        const centerX = this.cardContainer.x;
        const centerY = this.cardContainer.y;
        const rect = new Phaser.Geom.Rectangle(
            centerX - (this.cardWidth * this.cardScale) / 2,
            centerY - (this.cardHeight * this.cardScale) / 2,
            this.cardWidth * this.cardScale,
            this.cardHeight * this.cardScale
        );
        return Phaser.Geom.Rectangle.Contains(rect, x, y);
    }

    private createNineSliceTexture(key: string, width: number, height: number, borderX: number, borderY: number) {
        const srcTexture = this.scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = srcImage.width;
        const srcH = srcImage.height;

        const centerSrcW = Math.max(1, srcW - borderX * 2);
        const centerSrcH = Math.max(1, srcH - borderY * 2);
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const textureKey = `__fishview_card_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
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

        this.scene.textures.addCanvas(textureKey, canvas);
        return textureKey;
    }

    private getRarityIconKey(rarity?: string) {
        switch ((rarity ?? 'common').toLowerCase()) {
            case 'uncommon': return 'ui-rarity-uncommon';
            case 'rare': return 'ui-rarity-rare';
            case 'epic': return 'ui-rarity-epic';
            case 'legendary': return 'ui-rarity-legendary';
            case 'mythic': return 'ui-rarity-mythic';
            case 'divine': return 'ui-rarity-divine';
            case 'supreme': return 'ui-rarity-supreme';
            case 'common':
            default:
                return 'ui-rarity-common';
        }
    }

    private getRarityColorHex(rarity?: string) {
        switch ((rarity ?? 'common').toLowerCase()) {
            case 'uncommon': return '#b7ff63';
            case 'rare': return '#8fd7ff';
            case 'epic': return '#d2a3ff';
            case 'legendary': return '#ffbf52';
            case 'mythic': return '#ff7fd1';
            case 'divine': return '#93f7ff';
            case 'supreme': return '#ff9a5f';
            case 'common':
            default:
                return '#f4f4f4';
        }
    }
}
