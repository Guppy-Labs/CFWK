import Phaser from 'phaser';
import { BitmapFontRenderer } from '../BitmapFontRenderer';
import { NetworkManager } from '../../network/NetworkManager';
import { LocaleManager } from '../../i18n/LocaleManager';
import { ItemTextureLoader } from '../../assets/ItemTextureLoader';
import {
    getItemDefinition,
    getShopDefinition,
    getShopItemPrice,
    isLimitedSupply,
    IShopStatePayload,
    IShopItemEntry,
    ItemDefinition,
    IPlayerMoneyState
} from '@cfwk/shared';

type ShopItemRow = {
    itemId: string;
    def: ItemDefinition;
    entry: IShopItemEntry;
    available: number;
    nextReplenishAt: number | null;
};

export class ShopUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private cover: Phaser.GameObjects.Image;
    private leftPage: Phaser.GameObjects.Image;
    private rightPage: Phaser.GameObjects.Image;
    private leftContainer: Phaser.GameObjects.Container;
    private rightContainer: Phaser.GameObjects.Container;
    private openState = false;
    private shopId = '';
    private currentMoney = 0;
    private selectedItemId = '';
    private shopItems: ShopItemRow[] = [];

    private networkManager = NetworkManager.getInstance();
    private localeManager = LocaleManager.getInstance();
    private readonly fontCharSize = 8;
    private readonly fontCharGap = 1;
    private readonly fontRenderer: BitmapFontRenderer;

    private readonly coverWidth = 320;
    private readonly coverHeight = 219;
    private readonly pageWidth = 147;
    private readonly pageHeight = 193;
    private readonly outerPagePadX = 12;
    private readonly innerPagePadX = 5;
    private readonly contentPadY = 8;
    private readonly scaleFactor = 0.82;

    private static instanceCounter = 0;
    private readonly instanceId: number;
    private nineSliceCounter = 0;
    private textureCounter = 0;
    private generatedTextureKeys = new Set<string>();
    private renderTextureKeys = new Set<string>();

    private coverTextureKey = '';

    private shopStateHandler?: (event: Event) => void;
    private moneyUpdateHandler?: (event: Event) => void;
    private restockTimerEvent?: Phaser.Time.TimerEvent;

    private scrollOffset = 0;
    private maxScroll = 0;
    private listMaskGraphics?: Phaser.GameObjects.Graphics;
    private listMask?: Phaser.Display.Masks.GeometryMask;
    private listContent?: Phaser.GameObjects.Container;
    private scrollbarTrack?: Phaser.GameObjects.Image;
    private scrollbarThumb?: Phaser.GameObjects.Image;
    private currentTrackTextureKey?: string;
    private trackTextureCounter = 0;
    private listBoundsCache = { x: 0, y: 0, w: 0, h: 0 };

    private pageLeftX = 0;
    private pageTopY = 0;
    private pageRightX = 0;
    private currentScale = 1;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.instanceId = ShopUI.instanceCounter++;
        this.fontRenderer = new BitmapFontRenderer(scene, this.fontCharSize);

        this.coverTextureKey = this.createGreenCoverTexture();
        this.cover = this.scene.add.image(0, 0, this.coverTextureKey);
        this.leftPage = this.scene.add.image(0, 0, 'ui-book-page-left');
        this.rightPage = this.scene.add.image(0, 0, 'ui-book-page-right');

        this.leftContainer = this.scene.add.container(0, 0);
        this.rightContainer = this.scene.add.container(0, 0);

        this.container = this.scene.add.container(0, 0, [
            this.cover, this.leftPage, this.rightPage,
            this.leftContainer, this.rightContainer
        ]);
        this.container.setDepth(12500);
        this.container.setVisible(false);
        this.setGuiInputEnabled(false);

        this.shopStateHandler = (event: Event) => {
            const detail = (event as CustomEvent<IShopStatePayload>).detail;
            if (!detail || detail.shopId !== this.shopId) return;
            this.applyShopState(detail);
        };
        window.addEventListener('shop:state', this.shopStateHandler as EventListener);

        this.moneyUpdateHandler = (event: Event) => {
            const detail = (event as CustomEvent<IPlayerMoneyState>).detail;
            if (detail && typeof detail.money === 'number') {
                this.currentMoney = detail.money;
                if (this.openState) this.renderAll();
            }
        };
        window.addEventListener('money:update', this.moneyUpdateHandler as EventListener);

        this.scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gx: unknown[], _gy: unknown[], _gz: unknown[], deltaY: number) => {
            if (!this.openState) return;
            const pointer = this.scene.input.activePointer;
            const b = this.listBoundsCache;
            if (pointer.x >= b.x && pointer.x <= b.x + b.w && pointer.y >= b.y && pointer.y <= b.y + b.h) {
                this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset + deltaY * 0.5, 0, this.maxScroll);
                this.applyScroll();
            }
        });
    }

    open(shopId: string) {
        if (this.openState) return;
        const def = getShopDefinition(shopId);
        if (!def) return;

        this.shopId = shopId;
        this.openState = true;
        this.selectedItemId = '';
        this.scrollOffset = 0;
        this.maxScroll = 0;

        this.shopItems = def.items.map((entry) => {
            const itemDef = getItemDefinition(entry.itemId);
            return {
                itemId: entry.itemId,
                def: itemDef!,
                entry,
                available: entry.maxWares,
                nextReplenishAt: null
            };
        }).filter((row) => row.def);

        if (this.shopItems.length > 0) {
            this.selectedItemId = this.shopItems[0].itemId;
        }

        this.container.setVisible(true);
        this.setGuiInputEnabled(true);
        this.layout();

        const textureLoader = ItemTextureLoader.getInstance();
        const texturePromises = this.shopItems.map((item) =>
            textureLoader.ensureItemTexture(this.scene, item.itemId)
        );
        Promise.all(texturePromises).then(() => {
            if (this.openState) this.renderAll();
        });

        this.renderAll();
        this.networkManager.sendShopGet(shopId);

        const moneyData = this.networkManager.getCachedMoney();
        if (moneyData && typeof moneyData.money === 'number') {
            this.currentMoney = moneyData.money;
        }

        this.restockTimerEvent = this.scene.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                if (!this.openState) return;
                const hasRestock = this.shopItems.some((item) => item.nextReplenishAt !== null && item.available < item.entry.maxWares);
                if (hasRestock) this.renderAll();
            }
        });

        this.scene.registry.set('guiOpen', true);
        window.dispatchEvent(new CustomEvent('gui-open-changed', { detail: { isOpen: true, source: 'shop' } }));
        this.networkManager.sendGuiOpen(true);
    }

    close() {
        if (!this.openState) return;
        this.openState = false;
        this.container.setVisible(false);
        this.setGuiInputEnabled(false);

        if (this.listMask) {
            this.listMask.destroy();
            this.listMask = undefined;
        }
        if (this.listMaskGraphics) {
            this.listMaskGraphics.destroy();
            this.listMaskGraphics = undefined;
        }

        if (this.restockTimerEvent) {
            this.restockTimerEvent.destroy();
            this.restockTimerEvent = undefined;
        }

        this.scene.registry.set('guiOpen', false);
        window.dispatchEvent(new CustomEvent('gui-open-changed', { detail: { isOpen: false, source: 'shop' } }));
        this.networkManager.sendGuiOpen(false);
    }

    isOpen(): boolean {
        return this.openState;
    }

    layout() {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const scale = this.getScale();
        this.currentScale = scale;
        const cy = height / 2;
        const bookCenterX = width / 2;

        this.cover.setScale(scale);
        this.leftPage.setScale(scale);
        this.rightPage.setScale(scale);

        const pageW = this.pageWidth * scale;

        this.cover.setPosition(bookCenterX, cy);
        this.leftPage.setPosition(bookCenterX - pageW / 2, cy);
        this.rightPage.setPosition(bookCenterX + pageW / 2, cy);

        const pageH = this.pageHeight * scale;
        this.pageLeftX = bookCenterX - pageW / 2 - (this.pageWidth / 2) * scale;
        this.pageTopY = cy - pageH / 2;
        this.pageRightX = bookCenterX + pageW / 2 - (this.pageWidth / 2) * scale;

        if (this.openState) this.renderAll();
    }

    destroy() {
        if (this.shopStateHandler) {
            window.removeEventListener('shop:state', this.shopStateHandler as EventListener);
            this.shopStateHandler = undefined;
        }
        if (this.moneyUpdateHandler) {
            window.removeEventListener('money:update', this.moneyUpdateHandler as EventListener);
            this.moneyUpdateHandler = undefined;
        }
        if (this.restockTimerEvent) {
            this.restockTimerEvent.destroy();
            this.restockTimerEvent = undefined;
        }
        this.cleanupRenderTextures();
        this.generatedTextureKeys.forEach((key) => {
            if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
        });
        this.container.destroy();
    }

    private getScale(): number {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const maxWidth = width * 0.9;
        const maxHeight = height * 0.9;
        return Math.min(maxWidth / this.coverWidth, maxHeight / this.coverHeight) * this.scaleFactor;
    }

    private applyShopState(payload: IShopStatePayload) {
        for (const serverItem of payload.items) {
            const row = this.shopItems.find((r) => r.itemId === serverItem.itemId);
            if (row) {
                row.available = serverItem.available;
                row.nextReplenishAt = serverItem.nextReplenishAt;
            }
        }
        if (this.openState) this.renderAll();
    }

    private renderAll() {
        this.cleanupRenderTextures();
        this.leftContainer.removeAll(true);
        this.rightContainer.removeAll(true);
        this.listContent = undefined;
        this.listMask?.destroy();
        this.listMask = undefined;
        this.listMaskGraphics?.destroy();
        this.listMaskGraphics = undefined;
        this.scrollbarTrack = undefined;
        this.scrollbarThumb = undefined;

        this.renderLeftPage();
        this.renderRightPage();
    }

    private renderLeftPage() {
        const scale = this.currentScale;
        const { x: leftX, width: contentWidth } = this.getLeftPageContentBounds();
        const topY = Math.floor(this.pageTopY + this.contentPadY * scale);

        this.renderCoinBar(leftX, topY, contentWidth, scale);

        const coinBarHeight = Math.floor(18 * scale);
        const dividerY = topY + coinBarHeight;
        this.addDivider(this.leftContainer, leftX, dividerY, contentWidth);

        const listY = dividerY + Math.floor(4 * scale);
        const listHeight = Math.floor(this.pageHeight * scale - (listY - this.pageTopY) - this.contentPadY * scale);
        this.renderItemList(leftX, listY, contentWidth, listHeight, scale);
    }

    private renderCoinBar(x: number, y: number, width: number, scale: number) {
        const barHeight = Math.floor(16 * scale);
        const barBg = this.addNineSliceImage(this.leftContainer, x, y, 'ui-slider-track', width, barHeight, 4, 2);
        barBg.setAlpha(0.8);

        const iconKeys = ['ui-money-platinum', 'ui-money-gold', 'ui-money-silver', 'ui-money-bronze'];
        const money = Math.max(0, Math.floor(this.currentMoney));
        const bronze = money % 100;
        const silver = Math.floor(money / 100) % 100;
        const gold = Math.floor(money / 10000) % 100;
        const platinum = Math.floor(money / 1000000);
        const amounts = [platinum, gold, silver, bronze];

        const segmentWidth = (width - 8 * scale) / 4;
        const centerY = y + barHeight / 2;
        const iconSize = Math.floor(10 * scale);

        for (let i = 0; i < 4; i++) {
            const segX = x + 4 * scale + segmentWidth * (i + 0.5);
            const icon = this.scene.add.image(segX - segmentWidth * 0.15, centerY, iconKeys[i])
                .setOrigin(0.5, 0.5)
                .setDisplaySize(iconSize, iconSize);
            this.leftContainer.add(icon);

            const textImg = this.makeTextImage(String(amounts[i]), '#e6e6e6');
            textImg.setOrigin(0, 0.5).setPosition(segX + iconSize * 0.2, centerY).setScale(scale);
            this.leftContainer.add(textImg);
        }
    }

    private renderItemList(x: number, y: number, width: number, height: number, scale: number) {
        const frameBg = this.addNineSliceImage(this.leftContainer, x, y, 'ui-item-info-frame', width, height);

        this.listContent = this.scene.add.container(0, 0);
        this.leftContainer.add(this.listContent);

        this.listMaskGraphics = this.scene.add.graphics();
        this.listMaskGraphics.fillStyle(0xffffff, 1);
        const maskPad = Math.floor(3 * scale);
        this.listMaskGraphics.fillRect(x + maskPad, y + maskPad, width - maskPad * 2, height - maskPad * 2);
        this.listMask = this.listMaskGraphics.createGeometryMask();
        this.listContent.setMask(this.listMask);

        const scrollbarGutter = Math.floor(7 * scale);
        const rowWidth = width - maskPad * 2 - scrollbarGutter;
        const rowHeight = Math.floor(22 * scale);
        const rowGap = Math.floor(2 * scale);
        const rowX = x + maskPad;
        const startY = y + maskPad;

        this.listBoundsCache = { x: x + maskPad, y: y + maskPad, w: width - maskPad * 2, h: height - maskPad * 2 };

        this.shopItems.forEach((item, index) => {
            const rowY = startY + index * (rowHeight + rowGap);
            const isSelected = item.itemId === this.selectedItemId;

            const rowBgKey = isSelected ? 'ui-group-button-selected' : 'ui-group-button-unselected';
            const rowBg = this.addNineSliceImage(this.listContent!, rowX, rowY, rowBgKey, rowWidth, rowHeight);
            rowBg.setInteractive({ useHandCursor: true });
            rowBg.on('pointerdown', () => {
                this.selectedItemId = item.itemId;
                this.renderAll();
            });

            const iconSize = Math.floor(16 * scale);
            const iconX = rowX + Math.floor(3 * scale);
            const iconY = rowY + Math.floor((rowHeight - iconSize) / 2);
            const itemTextureLoader = ItemTextureLoader.getInstance();
            const iconTextureKey = itemTextureLoader.getBestTextureKey(this.scene, item.itemId);
            if (iconTextureKey !== '__MISSING') {
                const icon = this.scene.add.image(iconX + iconSize / 2, iconY + iconSize / 2, iconTextureKey)
                    .setOrigin(0.5, 0.5)
                    .setDisplaySize(iconSize, iconSize);
                this.listContent!.add(icon);
            } else {
                void itemTextureLoader.ensureItemTexture(this.scene, item.itemId).then(() => {
                    if (this.openState && this.selectedItemId) this.renderAll();
                });
            }

            const nameColor = isSelected ? '#f2e9dd' : '#BABEC7';
            const nameImg = this.makeTextImage(item.def.name, nameColor);
            nameImg.setOrigin(0, 0.5).setPosition(iconX + iconSize + Math.floor(3 * scale), rowY + rowHeight / 2).setScale(scale * 0.9);
            this.listContent!.add(nameImg);

            const price = getShopItemPrice(item.entry.baseCost, item.available, item.entry.maxWares);
            if (item.available <= 0) {
                const soldImg = this.makeTextImage('Sold', '#d45b5b');
                soldImg.setOrigin(1, 0.5).setPosition(rowX + rowWidth - Math.floor(3 * scale), rowY + rowHeight / 2).setScale(scale * 0.8);
                this.listContent!.add(soldImg);
            } else {
                this.renderCoinAmount(
                    this.listContent!, price,
                    rowX + rowWidth - Math.floor(3 * scale), rowY + rowHeight / 2,
                    scale * 0.8, { x: 1, y: 0.5 }
                );
            }
        });

        const totalContentHeight = this.shopItems.length * (rowHeight + rowGap) - rowGap;
        const viewportHeight = height - maskPad * 2;
        this.maxScroll = Math.max(0, totalContentHeight - viewportHeight);
        this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset, 0, this.maxScroll);

        this.createScrollbar(x + width - scrollbarGutter, y + maskPad, scrollbarGutter - Math.floor(2 * scale), viewportHeight, scale);
        this.applyScroll();
    }

    private createScrollbar(x: number, y: number, width: number, height: number, scale: number) {
        const trackW = Math.max(2, width);
        const track = this.scene.add.rectangle(x, y, trackW, height, 0x1f2330, 0.32).setOrigin(0, 0);
        this.leftContainer.add(track);

        if (this.maxScroll <= 0) return;

        const thumbTexture = 'ui-scrollbar-thumb';
        this.scrollbarThumb = this.scene.add.image(x + trackW / 2, y, thumbTexture).setOrigin(0.5, 0);
        this.scrollbarThumb.setDisplaySize(trackW + Math.floor(2 * scale), Math.max(Math.floor(12 * scale), Math.floor(height * 0.2)));
        this.scrollbarThumb.setInteractive({ useHandCursor: true, draggable: true });
        this.scene.input.setDraggable(this.scrollbarThumb);

        const thumbHeight = this.scrollbarThumb.displayHeight;
        const maxThumbY = height - thumbHeight;

        this.scrollbarThumb.on('drag', (_pointer: Phaser.Input.Pointer, _dragX: number, dragY: number) => {
            const clampedY = Phaser.Math.Clamp(dragY - y, 0, maxThumbY);
            const fraction = maxThumbY > 0 ? clampedY / maxThumbY : 0;
            this.scrollOffset = fraction * this.maxScroll;
            this.applyScroll();
        });

        this.leftContainer.add(this.scrollbarThumb);
        this.updateThumbPosition(y, maxThumbY);
    }

    private updateThumbPosition(trackY: number, maxThumbY: number) {
        if (!this.scrollbarThumb || this.maxScroll <= 0) return;
        const fraction = this.scrollOffset / this.maxScroll;
        this.scrollbarThumb.y = trackY + fraction * maxThumbY;
    }

    private applyScroll() {
        if (!this.listContent) return;
        this.listContent.y = -this.scrollOffset;

        if (this.scrollbarThumb && this.maxScroll > 0) {
            const b = this.listBoundsCache;
            const thumbHeight = this.scrollbarThumb.displayHeight;
            const maxThumbY = b.h - thumbHeight;
            this.updateThumbPosition(b.y, maxThumbY);
        }
    }

    private renderRightPage() {
        const scale = this.currentScale;
        const { x: rightX, width: rightWidth } = this.getRightPageContentBounds();
        const topY = Math.floor(this.pageTopY + this.contentPadY * scale);
        const panelHeight = Math.floor(this.pageHeight * scale - (topY - this.pageTopY) - this.contentPadY * scale);

        const selected = this.shopItems.find((item) => item.itemId === this.selectedItemId);
        if (!selected) {
            const emptyFrame = this.addNineSliceImage(this.rightContainer, rightX, topY, 'ui-item-info-frame', rightWidth, panelHeight);
            const emptyText = this.makeTextImage(this.localeManager.t('shop.selectItem', undefined, 'Select an item'), '#9A9EA7');
            emptyText.setOrigin(0.5, 0.5).setPosition(rightX + rightWidth / 2, topY + panelHeight / 2).setScale(scale);
            this.rightContainer.add(emptyText);
            return;
        }

        this.addNineSliceImage(this.rightContainer, rightX, topY, 'ui-item-info-frame', rightWidth, panelHeight);

        let cursorY = topY + Math.floor(6 * scale);
        const padX = Math.floor(6 * scale);

        const iconSize = Math.floor(32 * scale);
        const iconCenterX = rightX + rightWidth / 2;
        const itemTextureLoader = ItemTextureLoader.getInstance();
        const detailIconKey = itemTextureLoader.getBestTextureKey(this.scene, selected.itemId);
        if (detailIconKey !== '__MISSING') {
            const icon = this.scene.add.image(iconCenterX, cursorY + iconSize / 2, detailIconKey)
                .setOrigin(0.5, 0.5)
                .setDisplaySize(iconSize, iconSize);
            this.rightContainer.add(icon);
        }
        cursorY += iconSize + Math.floor(4 * scale);

        const nameImg = this.makeTextImage(selected.def.name, '#f2e9dd');
        nameImg.setOrigin(0.5, 0).setPosition(iconCenterX, cursorY).setScale(scale);
        this.rightContainer.add(nameImg);
        cursorY += Math.floor(this.fontCharSize * scale + 3 * scale);

        const categoryText = selected.def.category;
        const categoryImg = this.makeTextImage(categoryText, '#9A9EA7');
        categoryImg.setOrigin(0.5, 0).setPosition(iconCenterX, cursorY).setScale(scale * 0.8);
        this.rightContainer.add(categoryImg);

        if (selected.def.rarity) {
            const rarityKey = `ui-rarity-${selected.def.rarity}`;
            if (this.scene.textures.exists(rarityKey)) {
                const rarityIcon = this.scene.add.image(
                    rightX + rightWidth - padX - Math.floor(2 * scale),
                    topY + padX + Math.floor(2 * scale),
                    rarityKey
                ).setOrigin(1, 0).setScale(scale * 0.3);
                this.rightContainer.add(rarityIcon);
            }
        }
        cursorY += Math.floor(this.fontCharSize * scale * 0.8 + 3 * scale);

        this.addDivider(this.rightContainer, rightX + padX, cursorY, rightWidth - padX * 2);
        cursorY += Math.floor(5 * scale);

        const descMaxWidth = rightWidth - padX * 2;
        const descLines = this.wrapText(selected.def.description, descMaxWidth, scale);
        for (const line of descLines) {
            const lineImg = this.makeTextImage(line, '#9A9EA7');
            lineImg.setOrigin(0, 0).setPosition(rightX + padX, cursorY).setScale(scale * 0.85);
            this.rightContainer.add(lineImg);
            cursorY += Math.floor(this.fontCharSize * scale * 0.85 + 1 * scale);
        }
        cursorY += Math.floor(3 * scale);

        this.addDivider(this.rightContainer, rightX + padX, cursorY, rightWidth - padX * 2);
        cursorY += Math.floor(5 * scale);

        if (selected.available > 0) {
            const availText = this.localeManager.t('shop.available', { count: String(selected.available) }, `${selected.available} available`);
            const availImg = this.makeTextImage(availText, '#BABEC7');
            availImg.setOrigin(0, 0).setPosition(rightX + padX, cursorY).setScale(scale * 0.85);
            this.rightContainer.add(availImg);
        } else {
            const restockText = this.getRestockTimeText(selected.nextReplenishAt);
            const restockImg = this.makeTextImage(restockText, '#d45b5b');
            restockImg.setOrigin(0, 0).setPosition(rightX + padX, cursorY).setScale(scale * 0.85);
            this.rightContainer.add(restockImg);
        }
        cursorY += Math.floor(this.fontCharSize * scale * 0.85 + 3 * scale);

        const price = getShopItemPrice(selected.entry.baseCost, selected.available, selected.entry.maxWares);
        const costLabel = this.makeTextImage('Cost:', '#BABEC7');
        costLabel.setOrigin(0, 0).setPosition(rightX + padX, cursorY).setScale(scale * 0.85);
        this.rightContainer.add(costLabel);
        const costLabelW = this.fontRenderer.measureTextWidth('Cost:', { charGap: this.fontCharGap }) * scale * 0.85;
        this.renderCoinAmount(
            this.rightContainer, price,
            rightX + padX + costLabelW + Math.floor(3 * scale),
            cursorY + this.fontCharSize * scale * 0.85 / 2,
            scale, { x: 0, y: 0.5 }
        );
        cursorY += Math.floor(this.fontCharSize * scale * 0.85 + 3 * scale);

        const buttonAreaY = topY + panelHeight - Math.floor(26 * scale);

        const limited = isLimitedSupply(selected.available, selected.entry.maxWares);
        if (limited && selected.available > 0) {
            const surchargeText = this.localeManager.t('shop.limitedSupply', undefined, 'Limited Supply Charge');
            const surchargeImg = this.makeTextImage(surchargeText, '#d45b5b');
            surchargeImg.setOrigin(0.5, 1).setPosition(rightX + rightWidth / 2, buttonAreaY - Math.floor(2 * scale)).setScale(scale * 0.7);
            this.rightContainer.add(surchargeImg);
        }

        const btnHeight = Math.floor(18 * scale);
        const btnGap = Math.floor(3 * scale);
        const totalBtnWidth = rightWidth - padX * 2;
        const buy1Width = Math.floor(totalBtnWidth * 0.73);
        const buy10Width = totalBtnWidth - buy1Width - btnGap;

        const canBuy1 = selected.available >= 1 && this.currentMoney >= price;
        const canBuy10 = selected.available >= 10 && this.currentMoney >= this.calculateBulkPrice(selected, 10);

        this.createBuyButton(
            rightX + padX, buttonAreaY, buy1Width, btnHeight,
            this.localeManager.t('shop.buy1x', undefined, 'Buy 1x'),
            canBuy1,
            () => {
                this.networkManager.sendShopBuy(this.shopId, selected.itemId, 1);
                window.dispatchEvent(new CustomEvent('shop:buy-highlight', { detail: { itemId: selected.itemId } }));
            }
        );

        this.createBuyButton(
            rightX + padX + buy1Width + btnGap, buttonAreaY, buy10Width, btnHeight,
            this.localeManager.t('shop.buy10x', undefined, '10x'),
            canBuy10,
            () => {
                this.networkManager.sendShopBuy(this.shopId, selected.itemId, 10);
                window.dispatchEvent(new CustomEvent('shop:buy-highlight', { detail: { itemId: selected.itemId } }));
            }
        );
    }

    private calculateBulkPrice(item: ShopItemRow, quantity: number): number {
        let total = 0;
        let tempAvailable = item.available;
        for (let i = 0; i < quantity; i++) {
            total += getShopItemPrice(item.entry.baseCost, tempAvailable, item.entry.maxWares);
            tempAvailable--;
        }
        return total;
    }

    private createBuyButton(x: number, y: number, width: number, height: number, label: string, enabled: boolean, onClick: () => void) {
        const bgKey = enabled ? 'ui-group-button-selected' : 'ui-group-button-unselected';
        const bg = this.addNineSliceImage(this.rightContainer, x, y, bgKey, width, height);

        if (!enabled) {
            bg.setAlpha(0.5);
            bg.setTint(0x888888);
        }

        const textColor = enabled ? '#f2e9dd' : '#6a6a6a';
        const textImg = this.makeTextImage(label, textColor);
        textImg.setOrigin(0.5, 0.5).setPosition(x + width / 2, y + height / 2).setScale(this.currentScale * 0.9);
        this.rightContainer.add(textImg);

        if (enabled) {
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerdown', onClick);
        }
    }

    private getRestockTimeText(nextReplenishAt: number | null): string {
        if (nextReplenishAt === null) {
            return this.localeManager.t('shop.outOfStock', undefined, 'Out of Stock');
        }
        const remaining = Math.max(0, nextReplenishAt - Date.now());
        if (remaining <= 0) return this.localeManager.t('shop.restockingSoon', undefined, 'Restocking soon...');
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;
        return this.localeManager.t('shop.restocksIn', { time: timeStr }, `Restocks in ${timeStr}`);
    }

    private wrapText(text: string, maxWidth: number, scale: number): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine.length > 0 ? `${currentLine} ${word}` : word;
            const testWidth = this.fontRenderer.measureTextWidth(testLine, { charGap: this.fontCharGap }) * scale * 0.85;
            if (testWidth > maxWidth && currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine.length > 0) lines.push(currentLine);
        return lines;
    }

    private getLeftPageContentBounds() {
        const x = Math.floor(this.pageLeftX + this.outerPagePadX * this.currentScale);
        const width = Math.floor(this.pageWidth * this.currentScale - (this.outerPagePadX + this.innerPagePadX) * this.currentScale);
        return { x, width };
    }

    private getRightPageContentBounds() {
        const x = Math.floor(this.pageRightX + this.innerPagePadX * this.currentScale);
        const width = Math.floor(this.pageWidth * this.currentScale - (this.outerPagePadX + this.innerPagePadX) * this.currentScale);
        return { x, width };
    }

    private createGreenCoverTexture(): string {
        const srcTexture = this.scene.textures.get('ui-book-cover');
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const canvas = document.createElement('canvas');
        canvas.width = srcImage.width;
        canvas.height = srcImage.height;
        const ctx = canvas.getContext('2d')!;

        ctx.drawImage(srcImage, 0, 0);

        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = '#70c080';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(srcImage, 0, 0);

        const key = `__shop_cover_${this.instanceId}`;
        this.scene.textures.addCanvas(key, canvas);
        this.generatedTextureKeys.add(key);
        return key;
    }

    private addNineSliceImage(
        parent: Phaser.GameObjects.Container,
        x: number, y: number,
        baseTextureKey: string,
        width: number, height: number,
        borderXOverride?: number, borderYOverride?: number
    ): Phaser.GameObjects.Image {
        const key = this.createNineSliceTexture(baseTextureKey, Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)), borderXOverride, borderYOverride);
        const img = this.scene.add.image(x, y, key).setOrigin(0, 0);
        parent.add(img);
        return img;
    }

    private createNineSliceTexture(
        baseTextureKey: string,
        width: number, height: number,
        borderXOverride?: number, borderYOverride?: number
    ): string {
        const sourceTexture = this.scene.textures.get(baseTextureKey);
        const sourceImage = sourceTexture.getSourceImage() as HTMLImageElement;
        const srcW = sourceImage.width;
        const srcH = sourceImage.height;

        const borderX = borderXOverride ?? Math.floor((srcW - 1) / 2);
        const borderY = borderYOverride ?? Math.floor((srcH - 1) / 2);
        const centerSrcW = Math.max(1, srcW - borderX * 2);
        const centerSrcH = Math.max(1, srcH - borderY * 2);
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(sourceImage, 0, 0, borderX, borderY, 0, 0, borderX, borderY);
        ctx.drawImage(sourceImage, borderX, 0, centerSrcW, borderY, borderX, 0, centerW, borderY);
        ctx.drawImage(sourceImage, srcW - borderX, 0, borderX, borderY, borderX + centerW, 0, borderX, borderY);

        ctx.drawImage(sourceImage, 0, borderY, borderX, centerSrcH, 0, borderY, borderX, centerH);
        ctx.drawImage(sourceImage, borderX, borderY, centerSrcW, centerSrcH, borderX, borderY, centerW, centerH);
        ctx.drawImage(sourceImage, srcW - borderX, borderY, borderX, centerSrcH, borderX + centerW, borderY, borderX, centerH);

        ctx.drawImage(sourceImage, 0, srcH - borderY, borderX, borderY, 0, borderY + centerH, borderX, borderY);
        ctx.drawImage(sourceImage, borderX, srcH - borderY, centerSrcW, borderY, borderX, borderY + centerH, centerW, borderY);
        ctx.drawImage(sourceImage, srcW - borderX, srcH - borderY, borderX, borderY, borderX + centerW, borderY + centerH, borderX, borderY);

        const key = `__shop_ns_${this.instanceId}_${this.nineSliceCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        this.renderTextureKeys.add(key);
        return key;
    }

    private renderCoinAmount(
        parent: Phaser.GameObjects.Container,
        amount: number,
        x: number, y: number,
        scale: number,
        origin: { x: number; y: number } = { x: 0, y: 0.5 }
    ): number {
        const money = Math.max(0, Math.floor(amount));
        const bronze = money % 100;
        const silver = Math.floor(money / 100) % 100;
        const gold = Math.floor(money / 10000) % 100;
        const platinum = Math.floor(money / 1000000);

        const parts: Array<{ value: number; iconKey: string }> = [];
        if (platinum > 0) parts.push({ value: platinum, iconKey: 'ui-money-platinum' });
        if (gold > 0) parts.push({ value: gold, iconKey: 'ui-money-gold' });
        if (silver > 0) parts.push({ value: silver, iconKey: 'ui-money-silver' });
        if (bronze > 0 || parts.length === 0) parts.push({ value: bronze, iconKey: 'ui-money-bronze' });

        const iconSize = Math.floor(8 * scale);
        const gap = Math.floor(1 * scale);
        const partGap = Math.floor(3 * scale);

        let totalWidth = 0;
        for (let i = 0; i < parts.length; i++) {
            const textW = this.fontRenderer.measureTextWidth(String(parts[i].value), { charGap: this.fontCharGap }) * scale * 0.85;
            totalWidth += textW + gap + iconSize;
            if (i < parts.length - 1) totalWidth += partGap;
        }

        let cursorX = origin.x === 1 ? x - totalWidth : origin.x === 0.5 ? x - totalWidth / 2 : x;
        const centerY = y;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const valImg = this.makeTextImage(String(part.value), '#c8b07a');
            valImg.setOrigin(0, 0.5).setPosition(cursorX, centerY).setScale(scale * 0.85);
            parent.add(valImg);
            const textW = this.fontRenderer.measureTextWidth(String(part.value), { charGap: this.fontCharGap }) * scale * 0.85;
            cursorX += textW + gap;

            const icon = this.scene.add.image(cursorX + iconSize / 2, centerY, part.iconKey)
                .setOrigin(0.5, 0.5)
                .setDisplaySize(iconSize, iconSize);
            parent.add(icon);
            cursorX += iconSize;
            if (i < parts.length - 1) cursorX += partGap;
        }

        return totalWidth;
    }

    private addDivider(parent: Phaser.GameObjects.Container, x: number, y: number, width: number) {
        const divider = this.addNineSliceImage(parent, x, y, 'ui-item-info-divider', width, Math.max(1, Math.floor(2 * this.currentScale)));
        return divider;
    }

    private makeTextImage(text: string, color: string): Phaser.GameObjects.Image {
        const width = Math.max(1, this.fontRenderer.measureTextWidth(text, { charGap: this.fontCharGap }));
        const height = this.fontCharSize;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        this.fontRenderer.drawText(ctx, text, 0, 0, { charGap: this.fontCharGap });
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__shop_text_${this.instanceId}_${this.textureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        this.renderTextureKeys.add(key);
        return this.scene.add.image(0, 0, key);
    }

    private cleanupRenderTextures() {
        this.renderTextureKeys.forEach((key) => {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        });
        this.renderTextureKeys.clear();
        if (this.currentTrackTextureKey && this.scene.textures.exists(this.currentTrackTextureKey)) {
            this.scene.textures.remove(this.currentTrackTextureKey);
            this.currentTrackTextureKey = undefined;
        }
    }

    private setGuiInputEnabled(enabled: boolean) {
        this.container.list.forEach((child) => {
            if (child instanceof Phaser.GameObjects.Image || child instanceof Phaser.GameObjects.Container) {
                if ('input' in child && child.input) {
                    child.input.enabled = enabled;
                }
            }
        });
    }
}
