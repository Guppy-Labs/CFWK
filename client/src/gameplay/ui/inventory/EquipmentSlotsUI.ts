import Phaser from 'phaser';
import { InventoryDisplayItem } from './InventorySlotsUI';
import { MobileControls } from '../MobileControls';

export type EquipmentSlotType = 'rod';

export type EquippedItem = {
    slotType: EquipmentSlotType;
    item: InventoryDisplayItem;
};

export type EquipmentSlotsConfig = {
    slotSize?: number;
    offsetX?: number;
    offsetY?: number;
    labelOffsetY?: number;
};

export class EquipmentSlotsUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private rodSlot: Phaser.GameObjects.Image;
    private rodIcon?: Phaser.GameObjects.Image;
    private rodLabel: Phaser.GameObjects.Image;
    private equippedRod: InventoryDisplayItem | null = null;
    private lastLayout?: { rightPageLeftEdgeX: number; rightPageTopEdgeY: number; pageHeight: number; scale: number };
    
    private hoverIndicator?: Phaser.GameObjects.Image;
    private selectedIndicator?: Phaser.GameObjects.Sprite;
    private isRodSlotHovered = false;
    private isRodSlotSelected = false;
    private hoverTween?: Phaser.Tweens.Tween;
    private disableHoverIndicator = false;
    private dragGhost?: Phaser.GameObjects.Image;
    private dragSourceIcon?: Phaser.GameObjects.Image;
    private dragStartX?: number;
    private dragStartY?: number;
    
    private onRodSlotClick?: (currentRod: InventoryDisplayItem | null) => void;
    private onRodEquipped?: (rod: InventoryDisplayItem) => void;
    private onRodUnequipped?: (rod: InventoryDisplayItem) => void;
    private onRodSlotDragComplete?: (pointer: Phaser.Input.Pointer) => boolean;

    private slotBounds?: Phaser.Geom.Rectangle;
    private pointerMoveHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerDownHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerUpHandler?: (pointer: Phaser.Input.Pointer) => void;
    private dragPointerId?: number;

    private readonly fontCharSize = 8;
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
    private labelTextureKey?: string;

    private config: Required<EquipmentSlotsConfig>;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config: EquipmentSlotsConfig = {}) {
        this.scene = scene;
        this.config = {
            slotSize: config.slotSize ?? 24,
            offsetX: config.offsetX ?? 62,
            offsetY: config.offsetY ?? 40,
            labelOffsetY: config.labelOffsetY ?? 10
        };

        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        // Create the rod slot (empty by default)
        this.rodSlot = this.scene.add.image(0, 0, 'ui-slot-empty').setOrigin(0.5, 0.5);
        this.container.add(this.rodSlot);

        // Create the label texture
        this.labelTextureKey = this.createLabelTexture('Rod');
        this.rodLabel = this.scene.add.image(0, 0, this.labelTextureKey).setOrigin(0.5, 0);
        this.container.add(this.rodLabel);

        // Create selection indicators
        this.createSelectionIndicators();
        this.disableHoverIndicator = MobileControls.isMobileDevice();

        // Register pointer handlers
        this.registerPointerHandlers();

        this.container.setVisible(false);
    }

    private createSelectionIndicators() {
        if (!this.scene.textures.exists('ui-slot-select-1')) return;

        this.hoverIndicator = this.scene.add.image(0, 0, 'ui-slot-select-3').setOrigin(0.5, 0.5);
        this.hoverIndicator.setAlpha(0.6);
        this.hoverIndicator.setVisible(false);
        this.hoverIndicator.setData('ignoreCursor', true);
        this.container.add(this.hoverIndicator);

        this.selectedIndicator = this.scene.add.sprite(0, 0, 'ui-slot-select-1').setOrigin(0.5, 0.5);
        this.selectedIndicator.setAlpha(1);
        this.selectedIndicator.setVisible(false);
        this.selectedIndicator.setData('ignoreCursor', true);
        this.container.add(this.selectedIndicator);
    }

    private registerPointerHandlers() {
        this.pointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
            if (!this.container.visible) return;
            this.updateDragGhostPosition(pointer);
            if (this.disableHoverIndicator) {
                this.setHovered(false);
                return;
            }
            if (!this.slotBounds) return;

            const isInBounds = this.slotBounds.contains(pointer.x, pointer.y);
            this.setHovered(isInBounds);
        };

        this.pointerDownHandler = (pointer: Phaser.Input.Pointer) => {
            if (!this.container.visible) return;
            if (!this.slotBounds) return;
            if (!this.slotBounds.contains(pointer.x, pointer.y)) return;

            this.dragPointerId = pointer.id;
            this.dragStartX = pointer.x;
            this.dragStartY = pointer.y;
        };

        this.pointerUpHandler = (pointer: Phaser.Input.Pointer) => {
            if (!this.container.visible) return;
            if (this.dragPointerId === undefined || pointer.id !== this.dragPointerId) return;
            this.dragPointerId = undefined;
            this.dragStartX = undefined;
            this.dragStartY = undefined;

            const isInBounds = this.slotBounds?.contains(pointer.x, pointer.y);
            if (this.dragGhost) {
                if (isInBounds) {
                    this.endDragVisual(true);
                    return;
                }

                const handled = this.onRodSlotDragComplete?.(pointer) ?? false;
                this.endDragVisual(!handled);
                return;
            }

            if (!isInBounds) return;
            const nextSelected = !this.isRodSlotSelected;
            this.setSelected(nextSelected);
            this.onRodSlotClick?.(this.equippedRod);
        };

        this.scene.input.on('pointermove', this.pointerMoveHandler);
        this.scene.input.on('pointerdown', this.pointerDownHandler);
        this.scene.input.on('pointerup', this.pointerUpHandler);
    }

    private setHovered(hovered: boolean) {
        if (!this.hoverIndicator) return;
        
        if (hovered === this.isRodSlotHovered) return;
        this.isRodSlotHovered = hovered;

        if (!hovered) {
            this.hoverIndicator.setVisible(false);
            return;
        }

        // Don't show hover if already selected
        if (this.isRodSlotSelected) {
            this.hoverIndicator.setVisible(false);
            return;
        }

        if (!this.lastLayout) return;
        const pos = this.getSlotScreenPosition();
        if (!pos) return;

        this.hoverIndicator.setVisible(true);
        if (this.hoverTween) {
            this.hoverTween.stop();
            this.hoverTween = undefined;
        }

        // Position relative to container
        const localX = 0;
        const localY = 0;

        if (this.hoverIndicator.x === 0 && this.hoverIndicator.y === 0) {
            this.hoverIndicator.setPosition(localX, localY);
        } else {
            this.hoverTween = this.scene.tweens.add({
                targets: this.hoverIndicator,
                x: localX,
                y: localY,
                duration: 100,
                ease: 'Sine.out'
            });
        }
    }

    private startDragVisual(pointer: Phaser.Input.Pointer) {
        if (!this.rodIcon || !this.equippedRod) return;
        if (this.dragGhost) return;

        const scale = this.container.scaleX || 1;
        this.dragSourceIcon = this.rodIcon;
        this.rodIcon.setVisible(false);

        this.dragGhost = this.scene.add.image(pointer.x, pointer.y, this.equippedRod.iconKey).setOrigin(0.5, 0.5);
        this.dragGhost.setScale(this.rodIcon.scaleX * scale, this.rodIcon.scaleY * scale);
        this.dragGhost.setAlpha(0.85);
        this.dragGhost.setScrollFactor(0);
        this.dragGhost.setDepth(13000);
    }

    private updateDragGhostPosition(pointer: Phaser.Input.Pointer) {
        if (!this.dragGhost && this.dragPointerId === pointer.id && this.dragStartX !== undefined && this.dragStartY !== undefined) {
            const distance = Math.hypot(pointer.x - this.dragStartX, pointer.y - this.dragStartY);
            if (distance >= 6) {
                this.startDragVisual(pointer);
            }
        }
        if (!this.dragGhost) return;
        this.dragGhost.setPosition(pointer.x, pointer.y);
    }

    private endDragVisual(restoreSource: boolean) {
        if (this.dragGhost) {
            this.dragGhost.destroy();
            this.dragGhost = undefined;
        }
        if (restoreSource && this.dragSourceIcon && this.dragSourceIcon.active) {
            this.dragSourceIcon.setVisible(true);
        }
        this.dragSourceIcon = undefined;
    }

    setSelected(selected: boolean) {
        if (!this.selectedIndicator) return;
        this.isRodSlotSelected = selected;

        if (!selected) {
            this.dragPointerId = undefined;
            this.dragStartX = undefined;
            this.dragStartY = undefined;
            this.endDragVisual(true);
            this.selectedIndicator.setVisible(false);
            this.selectedIndicator.stop();
            return;
        }

        // Position at slot center (0, 0 in local coords)
        this.selectedIndicator.setPosition(0, 0);
        this.selectedIndicator.setVisible(true);
        this.selectedIndicator.play('ui-slot-select', true);
        
        // Hide hover when selected
        if (this.hoverIndicator) {
            this.hoverIndicator.setVisible(false);
        }
    }

    clearSelection() {
        this.setSelected(false);
    }

    isSelected(): boolean {
        return this.isRodSlotSelected;
    }

    private getSlotScreenPosition(): { x: number; y: number } | undefined {
        if (!this.lastLayout) return undefined;
        const { rightPageLeftEdgeX, rightPageTopEdgeY, scale } = this.lastLayout;
        const x = rightPageLeftEdgeX + this.config.offsetX * scale;
        const y = rightPageTopEdgeY + this.config.offsetY * scale;
        return { x, y };
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
        if (!visible) {
            this.clearSelection();
        }
    }

    layout(rightPageLeftEdgeX: number, rightPageTopEdgeY: number, pageHeight: number, scale: number) {
        this.lastLayout = { rightPageLeftEdgeX, rightPageTopEdgeY, pageHeight, scale };

        const x = rightPageLeftEdgeX + this.config.offsetX * scale;
        const y = rightPageTopEdgeY + this.config.offsetY * scale;

        this.container.setPosition(x, y);
        this.container.setScale(scale);

        // Update slot bounds for click detection
        const slotSize = this.config.slotSize * scale;
        this.slotBounds = new Phaser.Geom.Rectangle(
            x - slotSize / 2,
            y - slotSize / 2,
            slotSize,
            slotSize
        );

        // Position label below slot
        this.rodLabel.setPosition(0, this.config.slotSize / 2 + this.config.labelOffsetY);
    }

    /**
     * Equip a rod to the slot with smooth animation
     */
    equipRod(rod: InventoryDisplayItem, fromPosition?: { x: number; y: number }): void {
        // Remove existing rod icon if any
        if (this.rodIcon) {
            this.rodIcon.destroy();
            this.rodIcon = undefined;
        }

        this.equippedRod = rod;

        // Update slot texture to filled
        this.rodSlot.setTexture('ui-slot-filled');

        // Create the rod icon
        this.rodIcon = this.scene.add.image(0, 0, rod.iconKey).setOrigin(0.5, 0.5);
        this.container.add(this.rodIcon);

        // Ensure icon is behind indicators
        if (this.hoverIndicator) this.container.bringToTop(this.hoverIndicator);
        if (this.selectedIndicator) this.container.bringToTop(this.selectedIndicator);

        // Animate from source position if provided
        if (fromPosition && this.lastLayout) {
            const { scale } = this.lastLayout;
            const containerPos = this.getSlotScreenPosition();
            if (containerPos) {
                // Calculate local position from world position
                const localStartX = (fromPosition.x - containerPos.x) / scale;
                const localStartY = (fromPosition.y - containerPos.y) / scale;
                
                this.rodIcon.setPosition(localStartX, localStartY);
                this.rodIcon.setAlpha(0.8);

                this.scene.tweens.add({
                    targets: this.rodIcon,
                    x: 0,
                    y: 0,
                    alpha: 1,
                    duration: 200,
                    ease: 'Back.out'
                });
            }
        }

        this.onRodEquipped?.(rod);
    }

    /**
     * Unequip the rod from the slot, optionally animating to a target position
     */
    unequipRod(toPosition?: { x: number; y: number }): InventoryDisplayItem | null {
        const rod = this.equippedRod;
        if (!rod) return null;

        this.equippedRod = null;

        // Update slot texture to empty
        this.rodSlot.setTexture('ui-slot-empty');

        // Animate icon to target position and remove
        if (this.rodIcon) {
            if (toPosition && this.lastLayout) {
                const { scale } = this.lastLayout;
                const containerPos = this.getSlotScreenPosition();
                if (containerPos) {
                    const localEndX = (toPosition.x - containerPos.x) / scale;
                    const localEndY = (toPosition.y - containerPos.y) / scale;

                    this.scene.tweens.add({
                        targets: this.rodIcon,
                        x: localEndX,
                        y: localEndY,
                        alpha: 0,
                        duration: 200,
                        ease: 'Back.in',
                        onComplete: () => {
                            this.rodIcon?.destroy();
                            this.rodIcon = undefined;
                        }
                    });
                } else {
                    this.rodIcon.destroy();
                    this.rodIcon = undefined;
                }
            } else {
                this.rodIcon.destroy();
                this.rodIcon = undefined;
            }
        }

        if (rod) {
            this.onRodUnequipped?.(rod);
        }

        return rod;
    }

    getEquippedRod(): InventoryDisplayItem | null {
        return this.equippedRod;
    }

    hasRodEquipped(): boolean {
        return this.equippedRod !== null;
    }

    setOnRodSlotClick(callback?: (currentRod: InventoryDisplayItem | null) => void) {
        this.onRodSlotClick = callback;
    }

    setOnRodEquipped(callback?: (rod: InventoryDisplayItem) => void) {
        this.onRodEquipped = callback;
    }

    setOnRodUnequipped(callback?: (rod: InventoryDisplayItem) => void) {
        this.onRodUnequipped = callback;
    }

    setOnRodSlotDragComplete(callback?: (pointer: Phaser.Input.Pointer) => boolean) {
        this.onRodSlotDragComplete = callback;
    }

    isPointerOverSlot(pointer: Phaser.Input.Pointer): boolean {
        return !!this.slotBounds && this.slotBounds.contains(pointer.x, pointer.y);
    }

    private createLabelTexture(text: string): string {
        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;
        
        const width = this.measureBitmapTextWidth(text);
        const height = this.fontCharSize;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        // Draw text
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

        // Tint text color (brownish to match UI)
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = '#4b3435';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__equip_label_${Date.now()}`;
        this.scene.textures.addCanvas(key, canvas);
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

    destroy() {
        this.endDragVisual(false);
        if (this.pointerMoveHandler) {
            this.scene.input.off('pointermove', this.pointerMoveHandler);
        }
        if (this.pointerDownHandler) {
            this.scene.input.off('pointerdown', this.pointerDownHandler);
        }
        if (this.pointerUpHandler) {
            this.scene.input.off('pointerup', this.pointerUpHandler);
        }
        if (this.labelTextureKey && this.scene.textures.exists(this.labelTextureKey)) {
            this.scene.textures.remove(this.labelTextureKey);
        }
        this.container.destroy();
    }
}
