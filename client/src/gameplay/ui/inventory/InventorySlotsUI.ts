import Phaser from 'phaser';
import { MobileControls } from '../MobileControls';

export type InventorySlotsConfig = {
    columns?: number;
    rows?: number;
    baseRows?: number;
    unlockedSlots?: number;
    slotSize?: number;
    slotSpacing?: number;
    gridOffsetX?: number;
    gridOffsetY?: number;
    gridBottomPadding?: number;
    bottomReservedHeight?: number;
    scrollbarOffsetX?: number;
    scrollbarThumbOffsetX?: number;
    scrollbarThumbOffsetY?: number;
    itemScale?: number;
    countOffsetX?: number;
    countOffsetY?: number;
    countColor?: number;
};

export type InventoryDisplayItem = {
    id: string;
    name: string;
    description: string;
    count: number;
    stackSize: number;
    iconKey: string;
    category: string;
};

export type InventorySlotDisplay = {
    index: number;
    item: InventoryDisplayItem | null;
    count: number;
};

export class InventorySlotsUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private slotsContainer: Phaser.GameObjects.Container;
    private slotsContent: Phaser.GameObjects.Container;
    private itemsContent: Phaser.GameObjects.Container;
    private indicatorsContent: Phaser.GameObjects.Container;
    private indicatorsBaseX = 0;
    private indicatorsBaseY = 0;
    private maskGraphics: Phaser.GameObjects.Graphics;
    private mask?: Phaser.Display.Masks.GeometryMask;
    private indicatorMaskGraphics: Phaser.GameObjects.Graphics;
    private indicatorMask?: Phaser.Display.Masks.GeometryMask;
    private scrollbarContainer: Phaser.GameObjects.Container;
    private scrollbarTrack: Phaser.GameObjects.Image;
    private scrollbarThumb: Phaser.GameObjects.Image;
    private scrollOffset = 0;
    private maxScroll = 0;
    private trackHeight = 0;
    private currentRows = 0;
    private filterCategory: string | null = null;
    private slots: InventorySlotDisplay[] = [];
    private onItemSelect?: (item: InventoryDisplayItem | null, slotIndex: number, stackCount?: number) => void;
    private lastLayout?: { leftPageLeftEdgeX: number; leftPageTopEdgeY: number; pageHeight: number; scale: number };
    private lastViewportHeight?: number;
    private slotsBounds?: Phaser.Geom.Rectangle;
    private wheelHandler?: (pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => void;
    private pointerMoveHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerDownHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerUpHandler?: (pointer: Phaser.Input.Pointer) => void;

    private hoverIndicator?: Phaser.GameObjects.Image;
    private selectedIndicator?: Phaser.GameObjects.Sprite;
    private hoverSlotIndex?: number;
    private selectedSlotIndex?: number;
    private hoverTween?: Phaser.Tweens.Tween;
    private currentSlotCount = 0;
    private slotIndexToItem = new Map<number, InventoryDisplayItem>();
    private slotIndexToStackCount = new Map<number, number>();
    private slotIndexToIcon = new Map<number, Phaser.GameObjects.Image>();
    private slotIndexToCountImage = new Map<number, Phaser.GameObjects.Image>();
    private lastSelectionPointerId?: number;
    private lastSelectionPointerDownTime?: number;
    private disableHoverIndicator = false;
    private dragStartIndex?: number;
    private dragPointerId?: number;
    private dragStartX?: number;
    private dragStartY?: number;
    private dragGhost?: Phaser.GameObjects.Image;
    private dragCountGhost?: Phaser.GameObjects.Image;
    private dragSourceIcon?: Phaser.GameObjects.Image;
    private dragSourceCountImage?: Phaser.GameObjects.Image;
    private onSlotDragComplete?: (fromIndex: number, toIndex: number | undefined, pointer: Phaser.Input.Pointer) => boolean;

    private countTextureCounter = 0;
    private countTextureCache = new Map<string, string>();
    private readonly fontCharSize = 8;
    private readonly indicatorOverflowTop = 12;
    private readonly indicatorOverflowX = 12;
    private readonly fontCharGap = 1;
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

    private trackTextureCounter = 0;
    private currentTrackTextureKey?: string;
    private readonly trackSourceWidth = 44;
    private readonly trackSourceHeight = 5;
    private readonly trackBorder = 2;
    private readonly trackThickness = 5;

    private config: Required<InventorySlotsConfig>;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config: InventorySlotsConfig = {}) {
        this.scene = scene;
        this.config = {
            columns: config.columns ?? 5,
            rows: config.rows ?? 20,
            baseRows: config.baseRows ?? 3,
            unlockedSlots: config.unlockedSlots ?? 15,
            slotSize: config.slotSize ?? 24,
            slotSpacing: config.slotSpacing ?? 1,
            gridOffsetX: config.gridOffsetX ?? 9,
            gridOffsetY: config.gridOffsetY ?? 37,
            gridBottomPadding: config.gridBottomPadding ?? 14,
            bottomReservedHeight: config.bottomReservedHeight ?? 0,
            scrollbarOffsetX: config.scrollbarOffsetX ?? 5,
            scrollbarThumbOffsetX: config.scrollbarThumbOffsetX ?? -2,
            scrollbarThumbOffsetY: config.scrollbarThumbOffsetY ?? 0,
            itemScale: config.itemScale ?? 1,
            countOffsetX: config.countOffsetX ?? 2,
            countOffsetY: config.countOffsetY ?? 2,
            countColor: config.countColor ?? 0xffffff
        };

        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.slotsContainer = this.scene.add.container(0, 0);
        this.slotsContent = this.scene.add.container(0, 0);
        this.itemsContent = this.scene.add.container(0, 0);
        this.indicatorsContent = this.scene.add.container(0, 0);
        this.slotsContainer.add([this.slotsContent, this.itemsContent]);

        this.maskGraphics = this.scene.add.graphics();
        this.maskGraphics.setVisible(false);

        this.indicatorMaskGraphics = this.scene.add.graphics();
        this.indicatorMaskGraphics.setVisible(false);

        this.scrollbarContainer = this.scene.add.container(0, 0);
        this.scrollbarTrack = this.scene.add.image(0, 0, 'ui-scrollbar-track').setOrigin(0, 0);
        this.scrollbarThumb = this.scene.add.image(0, 0, 'ui-scrollbar-thumb').setOrigin(0, 0);
        this.scrollbarThumb.setInteractive({ useHandCursor: true, draggable: true });
        this.scene.input.setDraggable(this.scrollbarThumb);

        this.scrollbarContainer.add([this.scrollbarTrack, this.scrollbarThumb]);
        this.container.add([this.slotsContainer, this.indicatorsContent, this.scrollbarContainer]);

        this.container.setVisible(false);

        this.currentRows = this.config.rows;
        this.buildSlots(this.currentRows, this.config.unlockedSlots);
        this.createSelectionIndicators();
        this.disableHoverIndicator = MobileControls.isMobileDevice();
        this.registerPointerHandlers();
        this.registerDragHandlers();
        this.registerWheelHandlers();
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    setSlots(slots: InventorySlotDisplay[], filterCategory: string | null) {
        this.slots = slots;
        this.filterCategory = filterCategory;
        this.clearSelection();
        this.refreshSlotsAndItems();
    }

    setBottomReservedHeight(height: number) {
        if (this.config.bottomReservedHeight === height) return;
        this.config.bottomReservedHeight = height;
        if (this.lastLayout) {
            this.layout(
                this.lastLayout.leftPageLeftEdgeX,
                this.lastLayout.leftPageTopEdgeY,
                this.lastLayout.pageHeight,
                this.lastLayout.scale
            );
        }
    }

    setOnItemSelect(callback?: (item: InventoryDisplayItem | null, slotIndex: number, stackCount?: number) => void) {
        this.onItemSelect = callback;
    }

    setOnSlotDragComplete(callback?: (fromIndex: number, toIndex: number | undefined, pointer: Phaser.Input.Pointer) => boolean) {
        this.onSlotDragComplete = callback;
    }

    clearSelection() {
        this.onItemSelect?.(null, -1);
        if (this.selectedIndicator) {
            this.selectedIndicator.setVisible(false);
            this.selectedIndicator.stop();
        }
        this.selectedSlotIndex = undefined;
        this.dragStartIndex = undefined;
        this.dragPointerId = undefined;
        this.dragStartX = undefined;
        this.dragStartY = undefined;
        this.endDragVisual(true);
    }

    /**
     * Get the currently selected item, if any
     */
    getSelectedItem(): InventoryDisplayItem | null {
        if (this.selectedSlotIndex === undefined) return null;
        return this.slotIndexToItem.get(this.selectedSlotIndex) ?? null;
    }

    /**
     * Get the screen position of the currently selected slot
     */
    getSelectedSlotScreenPosition(): { x: number; y: number } | null {
        if (this.selectedSlotIndex === undefined || !this.lastLayout || !this.slotsBounds) return null;
        
        const localPos = this.getSlotCenterPosition(this.selectedSlotIndex);
        if (!localPos) return null;

        const scale = this.lastLayout.scale;
        return {
            x: this.slotsBounds.x + localPos.x * scale,
            y: this.slotsBounds.y + (localPos.y - this.scrollOffset) * scale
        };
    }

    getSlotIndexAtPointer(pointer: Phaser.Input.Pointer): number | undefined {
        return this.getNearestSlotIndex(pointer);
    }

    /**
     * Check if a slot at index is empty (for receiving items)
     */
    isSlotEmpty(index: number): boolean {
        return !this.slotIndexToItem.has(index);
    }

    /**
     * Get the screen position of a slot by index
     */
    getSlotScreenPosition(index: number): { x: number; y: number } | null {
        if (!this.lastLayout || !this.slotsBounds) return null;
        
        const localPos = this.getSlotCenterPosition(index);
        if (!localPos) return null;

        const scale = this.lastLayout.scale;
        return {
            x: this.slotsBounds.x + localPos.x * scale,
            y: this.slotsBounds.y + (localPos.y - this.scrollOffset) * scale
        };
    }

    /**
     * Check if an item is a fishing rod (Tools category with rod in name)
     */
    isSelectedItemRod(): boolean {
        const item = this.getSelectedItem();
        if (!item) return false;
        return item.category === 'Tools' && item.id.includes('rod');
    }

    layout(leftPageLeftEdgeX: number, leftPageTopEdgeY: number, pageHeight: number, scale: number) {
        this.lastLayout = { leftPageLeftEdgeX, leftPageTopEdgeY, pageHeight, scale };
        const gridWidth = this.getGridWidth();
        const gridHeight = this.getViewportHeight(pageHeight);
        this.lastViewportHeight = gridHeight;

        const startX = leftPageLeftEdgeX + this.config.gridOffsetX * scale;
        const startY = leftPageTopEdgeY + this.config.gridOffsetY * scale;

        this.slotsBounds = new Phaser.Geom.Rectangle(startX, startY, gridWidth * scale, gridHeight * scale);

        this.slotsContainer.setPosition(startX, startY);
        this.slotsContainer.setScale(scale);

        this.indicatorsBaseX = startX;
        this.indicatorsBaseY = startY;
        this.indicatorsContent.setPosition(startX, startY);
        this.indicatorsContent.setScale(scale);

        this.scrollbarContainer.setPosition(startX + (gridWidth + this.config.scrollbarOffsetX) * scale, startY);
        this.scrollbarContainer.setScale(scale);

        this.updateMask(startX, startY, gridWidth * scale, gridHeight * scale);
        this.updateScrollBounds(gridHeight);
        this.updateScrollbar(gridHeight);
        this.applyScroll();
    }

    private buildSlots(rows: number, unlockedSlots: number, _itemCount?: number) {
        const { columns, slotSize, slotSpacing } = this.config;
        this.slotsContent.removeAll(true);
        this.itemsContent.removeAll(true);

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < columns; col++) {
                const index = row * columns + col;
                const isUnlocked = index < unlockedSlots;
                const textureKey = isUnlocked ? 'ui-slot-base' : 'ui-slot-extended';
                const slot = this.scene.add.image(0, 0, textureKey).setOrigin(0, 0);
                const x = col * (slotSize + slotSpacing);
                const y = row * (slotSize + slotSpacing);
                slot.setPosition(x, y);
                this.slotsContent.add(slot);
            }
        }
    }

    private registerDragHandlers() {
        this.scrollbarThumb.on('drag', (_pointer: Phaser.Input.Pointer, _dragX: number, dragY: number) => {
            const gridHeight = this.trackHeight;
            const thumbHeight = this.scrollbarThumb.displayHeight;
            const minY = 0;
            const maxY = Math.max(0, gridHeight - thumbHeight);
            const clampedY = Phaser.Math.Clamp(dragY, minY, maxY);
            this.scrollbarThumb.y = clampedY + this.config.scrollbarThumbOffsetY;

            const scrollFraction = maxY > 0 ? clampedY / maxY : 0;
            this.scrollOffset = scrollFraction * this.maxScroll;
            this.applyScroll();
        });
    }

    private registerWheelHandlers() {
        this.wheelHandler = (pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => {
            if (!this.container.visible || this.maxScroll <= 0) return;
            if (!this.slotsBounds || !this.lastViewportHeight) return;
            if (!this.slotsBounds.contains(pointer.x, pointer.y)) return;

            const rowStep = this.config.slotSize + this.config.slotSpacing;
            const direction = deltaY > 0 ? 1 : -1;
            const scrollStep = rowStep * direction;
            this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset + scrollStep, 0, this.maxScroll);
            this.applyScroll();
            this.updateScrollbar(this.lastViewportHeight);
        };

        this.scene.input.on('wheel', this.wheelHandler);
    }

    private applyScroll() {
        this.slotsContent.y = -this.scrollOffset;
        this.itemsContent.y = -this.scrollOffset;
        const scale = this.lastLayout?.scale ?? 1;
        this.indicatorsContent.y = this.indicatorsBaseY - this.scrollOffset * scale;
        this.indicatorsContent.x = this.indicatorsBaseX;
    }

    private updateMask(x: number, y: number, width: number, height: number) {
        this.maskGraphics.clear();
        this.maskGraphics.fillStyle(0xffffff, 1);
        this.maskGraphics.fillRect(x, y, width, height);

        this.mask?.destroy();
        this.mask = this.maskGraphics.createGeometryMask();
        this.slotsContainer.setMask(this.mask);

        const indicatorLeft = x - this.indicatorOverflowX;
        const indicatorTop = y - this.indicatorOverflowTop;
        const indicatorWidth = width + this.indicatorOverflowX * 2;
        const indicatorHeight = height + this.indicatorOverflowTop;
        this.indicatorMaskGraphics.clear();
        this.indicatorMaskGraphics.fillStyle(0xffffff, 1);
        this.indicatorMaskGraphics.fillRect(indicatorLeft, indicatorTop, indicatorWidth, indicatorHeight);

        this.indicatorMask?.destroy();
        this.indicatorMask = this.indicatorMaskGraphics.createGeometryMask();
        this.indicatorsContent.setMask(this.indicatorMask);
    }

    private updateScrollBounds(viewportHeight: number) {
        const contentHeight = this.getContentHeight();
        this.maxScroll = Math.max(0, contentHeight - viewportHeight);
        this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset, 0, this.maxScroll);
    }

    private updateScrollbar(viewportHeight: number) {
        const contentHeight = this.getContentHeight();
        const trackHeight = viewportHeight;
        this.trackHeight = trackHeight;

        const trackTextureKey = this.createTrackTexture(trackHeight);
        this.scrollbarTrack.setTexture(trackTextureKey);
        this.scrollbarTrack.setOrigin(0, 0);
        this.scrollbarTrack.setRotation(Math.PI / 2);
        this.scrollbarTrack.setPosition(this.trackThickness, 0);

        if (this.currentTrackTextureKey && this.currentTrackTextureKey !== trackTextureKey) {
            if (this.scene.textures.exists(this.currentTrackTextureKey)) {
                this.scene.textures.remove(this.currentTrackTextureKey);
            }
        }
        this.currentTrackTextureKey = trackTextureKey;

        if (contentHeight <= viewportHeight) {
            this.scrollbarThumb.setVisible(false);
            return;
        }

        this.scrollbarThumb.setVisible(true);
        const thumbHeight = this.scrollbarThumb.displayHeight;

        const maxY = Math.max(0, trackHeight - thumbHeight);
        const scrollFraction = this.maxScroll > 0 ? this.scrollOffset / this.maxScroll : 0;
        this.scrollbarThumb.setPosition(this.config.scrollbarThumbOffsetX, this.config.scrollbarThumbOffsetY + maxY * scrollFraction);
    }

    private getGridWidth() {
        const { columns, slotSize, slotSpacing } = this.config;
        return columns * slotSize + (columns - 1) * slotSpacing;
    }

    private getViewportHeight(pageHeight: number) {
        return Math.max(
            1,
            pageHeight - this.config.gridOffsetY - this.config.gridBottomPadding - this.config.bottomReservedHeight
        );
    }

    private getContentHeight() {
        const { slotSize, slotSpacing } = this.config;
        return this.currentRows * slotSize + (this.currentRows - 1) * slotSpacing;
    }

    private refreshSlotsAndItems() {
        const availableSlots = this.config.unlockedSlots;
        const cappedSlots = this.slots.slice(0, availableSlots);

        this.currentSlotCount = availableSlots;
        this.currentRows = this.config.rows;
        this.buildSlots(this.currentRows, availableSlots, cappedSlots.length);

        this.renderSlots(cappedSlots);

        if (this.lastLayout) {
            this.layout(
                this.lastLayout.leftPageLeftEdgeX,
                this.lastLayout.leftPageTopEdgeY,
                this.lastLayout.pageHeight,
                this.lastLayout.scale
            );
        }
    }

    private renderSlots(slots: InventorySlotDisplay[]) {
        const { columns, slotSize, slotSpacing, itemScale, countOffsetX, countOffsetY } = this.config;
        this.itemsContent.removeAll(true);
        this.slotIndexToItem.clear();
        this.slotIndexToStackCount.clear();
        this.slotIndexToIcon.clear();
        this.slotIndexToCountImage.clear();

        slots.forEach((slot) => {
            const index = slot.index;
            const row = Math.floor(index / columns);
            const col = index % columns;
            const x = col * (slotSize + slotSpacing);
            const y = row * (slotSize + slotSpacing);

            const item = slot.item;
            if (!item) return;

            this.slotIndexToItem.set(index, item);
            this.slotIndexToStackCount.set(index, slot.count);

            if (this.filterCategory && item.category !== this.filterCategory) {
                return;
            }

            const icon = this.scene.add.image(x + slotSize / 2, y + slotSize / 2, item.iconKey).setOrigin(0.5, 0.5);
            icon.setScale(itemScale);
            icon.setInteractive();
            icon.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                this.handleSlotPointerDown(index, pointer);
            });
            this.itemsContent.add(icon);
            this.slotIndexToIcon.set(index, icon);

            const countText = String(slot.count);
            const countTextureKey = this.getCountTexture(countText);
            const countImage = this.scene.add.image(0, 0, countTextureKey).setOrigin(0, 0);
            const countWidth = (this.scene.textures.get(countTextureKey).getSourceImage() as HTMLImageElement).width;
            const countX = x + slotSize - countWidth - countOffsetX;
            const countY = y + slotSize - this.fontCharSize - countOffsetY;
            countImage.setPosition(Math.round(countX), Math.round(countY));
            this.itemsContent.add(countImage);
            this.slotIndexToCountImage.set(index, countImage);
        });
    }

    private createSelectionIndicators() {
        if (!this.scene.textures.exists('ui-slot-select-1')) return;

        if (!this.scene.anims.exists('ui-slot-select')) {
            this.scene.anims.create({
                key: 'ui-slot-select',
                frames: [
                    { key: 'ui-slot-select-3' },
                    { key: 'ui-slot-select-4' },
                    { key: 'ui-slot-select-1' },
                    { key: 'ui-slot-select-2' }
                ],
                frameRate: 8,
                repeat: -1
            });
        }

        this.hoverIndicator = this.scene.add.image(0, 0, 'ui-slot-select-3').setOrigin(0.5, 0.5);
        this.hoverIndicator.setAlpha(0.6);
        this.hoverIndicator.setVisible(false);
        this.hoverIndicator.setData('ignoreCursor', true);

        this.selectedIndicator = this.scene.add.sprite(0, 0, 'ui-slot-select-1').setOrigin(0.5, 0.5);
        this.selectedIndicator.setAlpha(1);
        this.selectedIndicator.setVisible(false);
        this.selectedIndicator.setData('ignoreCursor', true);

        this.indicatorsContent.add([this.hoverIndicator, this.selectedIndicator]);
    }

    private registerPointerHandlers() {
        this.pointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
            if (!this.container.visible) return;
            this.updateDragGhostPosition(pointer);
            if (this.disableHoverIndicator) {
                this.setHoverSlotIndex(undefined);
                return;
            }
            if (!this.slotsBounds || !this.lastLayout) return;

            if (!this.slotsBounds.contains(pointer.x, pointer.y)) {
                this.setHoverSlotIndex(undefined);
                return;
            }

            const slotIndex = this.getNearestSlotIndex(pointer);
            this.setHoverSlotIndex(slotIndex);
        };

        this.pointerDownHandler = (pointer: Phaser.Input.Pointer) => {
            if (!this.container.visible) return;
            if (!this.slotsBounds || !this.lastLayout) return;
            if (!this.slotsBounds.contains(pointer.x, pointer.y)) return;

            const slotIndex = this.getNearestSlotIndex(pointer);
            if (slotIndex === undefined) return;

            this.handleSlotPointerDown(slotIndex, pointer);
        };

        this.pointerUpHandler = (pointer: Phaser.Input.Pointer) => {
            if (!this.container.visible) return;
            this.handleSlotPointerUp(pointer);
        };

        this.scene.input.on('pointermove', this.pointerMoveHandler);
        this.scene.input.on('pointerdown', this.pointerDownHandler);
        this.scene.input.on('pointerup', this.pointerUpHandler);
    }

    private getNearestSlotIndex(pointer: Phaser.Input.Pointer): number | undefined {
        if (!this.slotsBounds) return undefined;
        const scale = this.slotsContainer.scaleX || 1;
        const localX = (pointer.x - this.slotsBounds.x) / scale;
        const localY = (pointer.y - this.slotsBounds.y) / scale + this.scrollOffset;

        const { slotSize, slotSpacing, columns } = this.config;
        const step = slotSize + slotSpacing;
        const col = Math.round((localX - slotSize / 2) / step);
        const row = Math.round((localY - slotSize / 2) / step);

        if (col < 0 || row < 0) return undefined;
        if (col >= columns) return undefined;
        const index = row * columns + col;
        if (index < 0 || index >= this.currentSlotCount) return undefined;

        const centerX = col * step + slotSize / 2;
        const centerY = row * step + slotSize / 2;
        const dx = localX - centerX;
        const dy = localY - centerY;
        const distance = Math.hypot(dx, dy);
        if (distance > step * 0.7) return undefined;

        return index;
    }

    private setHoverSlotIndex(index?: number) {
        if (!this.hoverIndicator) return;
        if (index === undefined) {
            this.hoverSlotIndex = undefined;
            this.hoverIndicator.setVisible(false);
            return;
        }

        if (this.selectedIndicator?.visible && this.selectedSlotIndex === index) {
            this.hoverSlotIndex = index;
            this.hoverIndicator.setVisible(false);
            return;
        }

        if (this.hoverSlotIndex === index && this.hoverIndicator.visible) return;
        this.hoverSlotIndex = index;

        const pos = this.getSlotCenterPosition(index);
        if (!pos) return;

        this.hoverIndicator.setVisible(true);
        if (this.hoverTween) {
            this.hoverTween.stop();
            this.hoverTween = undefined;
        }

        if (this.hoverIndicator.x === 0 && this.hoverIndicator.y === 0) {
            this.hoverIndicator.setPosition(pos.x, pos.y);
        } else {
            this.hoverTween = this.scene.tweens.add({
                targets: this.hoverIndicator,
                x: pos.x,
                y: pos.y,
                duration: 100,
                ease: 'Sine.out'
            });
        }
    }

    private setSelectedSlotIndex(index: number) {
        if (!this.selectedIndicator) return;
        this.selectedSlotIndex = index;
        const pos = this.getSlotCenterPosition(index);
        if (!pos) return;
        this.selectedIndicator.setPosition(pos.x, pos.y);
        this.selectedIndicator.setVisible(true);
        this.selectedIndicator.play('ui-slot-select', true);
    }

    private handleSlotPointerDown(slotIndex: number, pointer: Phaser.Input.Pointer) {
        if (this.isDuplicatePointerDown(pointer)) return;

        this.dragStartIndex = slotIndex;
        this.dragPointerId = pointer.id;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
    }

    private handleSlotPointerUp(pointer: Phaser.Input.Pointer) {
        if (this.dragStartIndex === undefined) return;
        if (this.dragPointerId !== undefined && pointer.id !== this.dragPointerId) return;

        const fromIndex = this.dragStartIndex;
        this.dragStartIndex = undefined;
        this.dragPointerId = undefined;
        this.dragStartX = undefined;
        this.dragStartY = undefined;

        const dropIndex = this.getNearestSlotIndex(pointer);
        if (this.dragGhost) {
            if (dropIndex !== undefined && dropIndex !== fromIndex) {
                const handled = this.onSlotDragComplete?.(fromIndex, dropIndex, pointer) ?? false;
                this.endDragVisual(!handled);
                return;
            }

            if (dropIndex === fromIndex) {
                this.endDragVisual(true);
                return;
            }

            const handled = this.onSlotDragComplete?.(fromIndex, undefined, pointer) ?? false;
            this.endDragVisual(!handled);
            return;
        }

        if (dropIndex === undefined) return;
        this.applyTapSelection(dropIndex);
    }

    private applyTapSelection(slotIndex: number) {
        if (this.selectedSlotIndex === slotIndex) {
            this.clearSelection();
            return;
        }

        this.setSelectedSlotIndex(slotIndex);
        const item = this.slotIndexToItem.get(slotIndex);
        if (item) {
            const stackCount = this.slotIndexToStackCount.get(slotIndex);
            this.onItemSelect?.(item, slotIndex, stackCount);
        } else {
            this.onItemSelect?.(null, slotIndex);
        }
    }

    private startDragVisual(slotIndex: number, pointer: Phaser.Input.Pointer) {
        const item = this.slotIndexToItem.get(slotIndex);
        const icon = this.slotIndexToIcon.get(slotIndex);
        const count = this.slotIndexToStackCount.get(slotIndex) ?? 0;
        const countImage = this.slotIndexToCountImage.get(slotIndex);
        if (!item || !icon) return;
        if (this.dragGhost) return;

        const scale = this.slotsContainer.scaleX || 1;
        this.dragSourceIcon = icon;
        icon.setVisible(false);
        this.dragSourceCountImage = countImage;
        if (countImage) {
            countImage.setVisible(false);
        }

        this.dragGhost = this.scene.add.image(pointer.x, pointer.y, item.iconKey).setOrigin(0.5, 0.5);
        this.dragGhost.setScale(icon.scaleX * scale, icon.scaleY * scale);
        this.dragGhost.setAlpha(0.85);
        this.dragGhost.setScrollFactor(0);
        this.dragGhost.setDepth(13000);

        if (count > 1) {
            const countTextureKey = this.getCountTexture(String(count));
            this.dragCountGhost = this.scene.add.image(pointer.x, pointer.y, countTextureKey).setOrigin(0, 0);
            this.dragCountGhost.setScale(scale, scale);
            this.dragCountGhost.setAlpha(0.9);
            this.dragCountGhost.setScrollFactor(0);
            this.dragCountGhost.setDepth(13001);
        }
    }

    private updateDragGhostPosition(pointer: Phaser.Input.Pointer) {
        if (!this.dragGhost && this.dragStartIndex !== undefined && this.dragPointerId === pointer.id) {
            const startX = this.dragStartX ?? pointer.x;
            const startY = this.dragStartY ?? pointer.y;
            const distance = Math.hypot(pointer.x - startX, pointer.y - startY);
            if (distance >= 6) {
                this.startDragVisual(this.dragStartIndex, pointer);
            }
        }
        if (!this.dragGhost) return;
        this.dragGhost.setPosition(pointer.x, pointer.y);
        if (this.dragCountGhost) {
            const { slotSize, countOffsetX, countOffsetY } = this.config;
            const x = pointer.x + slotSize / 2 - countOffsetX;
            const y = pointer.y + slotSize / 2 - this.fontCharSize - countOffsetY;
            this.dragCountGhost.setPosition(Math.round(x), Math.round(y));
        }
    }

    private endDragVisual(restoreSource: boolean) {
        if (this.dragGhost) {
            this.dragGhost.destroy();
            this.dragGhost = undefined;
        }
        if (this.dragCountGhost) {
            this.dragCountGhost.destroy();
            this.dragCountGhost = undefined;
        }
        if (restoreSource && this.dragSourceIcon && this.dragSourceIcon.active) {
            this.dragSourceIcon.setVisible(true);
        }
        if (restoreSource && this.dragSourceCountImage && this.dragSourceCountImage.active) {
            this.dragSourceCountImage.setVisible(true);
        }
        this.dragSourceIcon = undefined;
        this.dragSourceCountImage = undefined;
    }

    private isDuplicatePointerDown(pointer?: Phaser.Input.Pointer): boolean {
        if (!pointer) return false;
        const pointerId = pointer.id;
        const downTime = pointer.downTime;
        if (this.lastSelectionPointerId === pointerId && this.lastSelectionPointerDownTime === downTime) {
            return true;
        }
        this.lastSelectionPointerId = pointerId;
        this.lastSelectionPointerDownTime = downTime;
        return false;
    }

    private getSlotCenterPosition(index: number): { x: number; y: number } | undefined {
        const { slotSize, slotSpacing, columns } = this.config;
        const step = slotSize + slotSpacing;
        const row = Math.floor(index / columns);
        const col = index % columns;
        const x = col * step + slotSize / 2;
        const y = row * step + slotSize / 2;
        return { x, y };
    }

    private getCountTexture(text: string) {
        if (this.countTextureCache.has(text)) {
            return this.countTextureCache.get(text)!;
        }

        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;
        const width = this.measureBitmapTextWidth(text);
        const height = this.fontCharSize;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        let cursorX = 0;
        for (const ch of text) {
            const pos = this.findGlyph(ch);
            if (pos) {
                const sx = pos.col * this.fontCharSize;
                const sy = pos.row * this.fontCharSize;
                ctx.drawImage(fontImage, sx, sy, this.fontCharSize, this.fontCharSize, cursorX, 0, this.fontCharSize, this.fontCharSize);

                const glyphWidth = this.getGlyphWidth(fontImage, ch);
                cursorX += glyphWidth + this.fontCharGap;
            } else {
                cursorX += this.fontCharSize + this.fontCharGap;
            }
        }

        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = `#${this.config.countColor.toString(16).padStart(6, '0')}`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__inv_count_${this.countTextureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        this.countTextureCache.set(text, key);
        return key;
    }

    private findGlyph(ch: string) {
        for (let row = 0; row < this.fontMap.length; row++) {
            const col = this.fontMap[row].indexOf(ch);
            if (col !== -1) return { row, col };
        }
        return null;
    }

    private measureBitmapTextWidth(text: string): number {
        if (!text.length) return 0;

        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;

        let width = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const glyphWidth = this.getGlyphWidth(fontImage, ch);
            width += glyphWidth;
            if (i < text.length - 1) width += this.fontCharGap;
        }
        return width;
    }

    private getGlyphWidth(fontImage: HTMLImageElement, ch: string): number {
        if (this.fontGlyphWidths.has(ch)) {
            return this.fontGlyphWidths.get(ch)!;
        }

        const pos = this.findGlyph(ch);
        if (!pos) {
            this.fontGlyphWidths.set(ch, this.fontCharSize);
            return this.fontCharSize;
        }

        const canvas = document.createElement('canvas');
        canvas.width = this.fontCharSize;
        canvas.height = this.fontCharSize;
        const ctx = canvas.getContext('2d')!;

        const sx = pos.col * this.fontCharSize;
        const sy = pos.row * this.fontCharSize;
        ctx.drawImage(fontImage, sx, sy, this.fontCharSize, this.fontCharSize, 0, 0, this.fontCharSize, this.fontCharSize);

        const data = ctx.getImageData(0, 0, this.fontCharSize, this.fontCharSize).data;
        let rightmost = -1;
        for (let x = this.fontCharSize - 1; x >= 0; x--) {
            let hasPixel = false;
            for (let y = 0; y < this.fontCharSize; y++) {
                const idx = (y * this.fontCharSize + x) * 4 + 3;
                if (data[idx] > 0) {
                    hasPixel = true;
                    break;
                }
            }
            if (hasPixel) {
                rightmost = x;
                break;
            }
        }

        const width = Math.max(1, rightmost + 1);
        this.fontGlyphWidths.set(ch, width);
        return width;
    }

    private createTrackTexture(trackHeight: number) {
        const targetWidth = Math.max(1, Math.round(trackHeight));
        const targetHeight = this.trackSourceHeight;

        const rtKey = `__inv_scroll_track_${this.trackTextureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d')!;

        const srcTexture = this.scene.textures.get('ui-scrollbar-track');
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;

        const border = this.trackBorder;
        const srcW = this.trackSourceWidth;
        const srcH = this.trackSourceHeight;
        const centerSrcW = srcW - border * 2;
        const centerSrcH = srcH - border * 2;

        const centerW = Math.max(1, targetWidth - border * 2);
        const centerH = Math.max(1, targetHeight - border * 2);

        // Top row
        ctx.drawImage(srcImage, 0, 0, border, border, 0, 0, border, border);
        ctx.drawImage(srcImage, border, 0, centerSrcW, border, border, 0, centerW, border);
        ctx.drawImage(srcImage, srcW - border, 0, border, border, border + centerW, 0, border, border);

        // Middle row
        ctx.drawImage(srcImage, 0, border, border, centerSrcH, 0, border, border, centerH);
        ctx.drawImage(srcImage, border, border, centerSrcW, centerSrcH, border, border, centerW, centerH);
        ctx.drawImage(srcImage, srcW - border, border, border, centerSrcH, border + centerW, border, border, centerH);

        // Bottom row
        ctx.drawImage(srcImage, 0, srcH - border, border, border, 0, border + centerH, border, border);
        ctx.drawImage(srcImage, border, srcH - border, centerSrcW, border, border, border + centerH, centerW, border);
        ctx.drawImage(srcImage, srcW - border, srcH - border, border, border, border + centerW, border + centerH, border, border);

        this.scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }
}
