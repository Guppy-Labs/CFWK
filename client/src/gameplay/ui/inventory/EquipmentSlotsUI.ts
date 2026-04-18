import Phaser from 'phaser';
import { InventoryDisplayItem } from './InventorySlotsUI';
import { MobileControls } from '../MobileControls';
import { LocaleManager } from '../../i18n/LocaleManager';
import { BitmapFontRenderer } from '../BitmapFontRenderer';

export type EquipmentSlotType = 'rod' | 'usable';

export type EquippedItem = {
    slotType: EquipmentSlotType;
    item: InventoryDisplayItem;
    slotIndex?: number;
};

export type EquipmentSlotsConfig = {
    slotSize?: number;
    offsetX?: number;
    offsetY?: number;
    labelOffsetY?: number;
    usableSlotStartOffsetY?: number;
    usableSlotGap?: number;
};

export class EquipmentSlotsUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private rodSlot: Phaser.GameObjects.Image;
    private rodIcon?: Phaser.GameObjects.Image;
    private rodLabel: Phaser.GameObjects.Image;
    private usableSlots: Phaser.GameObjects.Image[] = [];
    private usableIcons: Array<Phaser.GameObjects.Image | undefined> = [];
    private usableCountImages: Array<Phaser.GameObjects.Image | undefined> = [];
    private usableSlotPlaceholders: Phaser.GameObjects.Image[] = [];
    private equippedRod: InventoryDisplayItem | null = null;
    private equippedUsables: Array<InventoryDisplayItem | null> = [null, null, null, null];
    private lastLayout?: { rightPageLeftEdgeX: number; rightPageTopEdgeY: number; pageHeight: number; scale: number };
    
    private hoverIndicator?: Phaser.GameObjects.Image;
    private selectedIndicator?: Phaser.GameObjects.Sprite;
    private isRodSlotHovered = false;
    private isRodSlotSelected = false;
    private hoverTween?: Phaser.Tweens.Tween;
    private disableHoverIndicator = false;
    private dragGhost?: Phaser.GameObjects.Image;
    private dragSourceIcon?: Phaser.GameObjects.Image;
    private dragSourceType?: EquipmentSlotType;
    private dragSourceUsableIndex?: number;
    private dragStartX?: number;
    private dragStartY?: number;
    
    private onRodSlotClick?: (currentRod: InventoryDisplayItem | null) => void;
    private onUsableSlotClick?: (slotIndex: number, currentItem: InventoryDisplayItem | null) => void;
    private onRodEquipped?: (rod: InventoryDisplayItem) => void;
    private onRodUnequipped?: (rod: InventoryDisplayItem) => void;
    private onRodSlotDragComplete?: (pointer: Phaser.Input.Pointer) => boolean;
    private onUsableSlotDragComplete?: (slotIndex: number, pointer: Phaser.Input.Pointer) => boolean;

    private rodSlotBounds?: Phaser.Geom.Rectangle;
    private usableSlotBounds: Phaser.Geom.Rectangle[] = [];
    private pointerMoveHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerDownHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerUpHandler?: (pointer: Phaser.Input.Pointer) => void;
    private dragPointerId?: number;

    private readonly fontCharSize = 8;
    private readonly fontCharGap = 1;
    private readonly fontRenderer: BitmapFontRenderer;
    private countTextureCounter = 0;
    private countTextureCache = new Map<string, string>();
    private labelTextureKey?: string;
    private localeManager = LocaleManager.getInstance();
    private localeChangedHandler?: (event: Event) => void;
    private readonly usableSlotTextureKey = 'ui-slot-base';

    private config: Required<EquipmentSlotsConfig>;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config: EquipmentSlotsConfig = {}) {
        this.scene = scene;
        this.config = {
            slotSize: config.slotSize ?? 24,
            offsetX: config.offsetX ?? 62,
            offsetY: config.offsetY ?? 40,
            labelOffsetY: config.labelOffsetY ?? 10,
            usableSlotStartOffsetY: config.usableSlotStartOffsetY ?? 34,
            usableSlotGap: config.usableSlotGap ?? 6
        };
        this.fontRenderer = new BitmapFontRenderer(this.scene, this.fontCharSize);

        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        // Create the rod slot (empty by default)
        this.rodSlot = this.scene.add.image(0, 0, 'ui-slot-empty').setOrigin(0.5, 0.5);
        this.container.add(this.rodSlot);

        for (let index = 0; index < 4; index++) {
            const usableSlot = this.scene.add.image(0, 0, this.usableSlotTextureKey).setOrigin(0.5, 0.5);
            this.usableSlots.push(usableSlot);
            this.container.add(usableSlot);
            this.usableCountImages.push(undefined);

            const placeholderKey = this.createLabelTexture(String(index + 1), '#7f7f7f');
            const placeholder = this.scene.add.image(0, 0, placeholderKey).setOrigin(0.5, 0.5);
            placeholder.setAlpha(0.95);
            this.usableSlotPlaceholders.push(placeholder);
            this.container.add(placeholder);
        }

        // Create the label texture
        this.labelTextureKey = this.createLabelTexture(this.localeManager.t('inventory.equipment.rod', undefined, 'Rod'));
        this.rodLabel = this.scene.add.image(0, 0, this.labelTextureKey).setOrigin(0.5, 0);
        this.rodLabel.setVisible(false);
        this.container.add(this.rodLabel);

        this.localeChangedHandler = () => this.refreshLabel();
        window.addEventListener('locale:changed', this.localeChangedHandler as EventListener);

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
            const hit = this.getSlotHit(pointer);
            const isInBounds = hit?.type === 'rod';
            this.setHovered(isInBounds);
        };

        this.pointerDownHandler = (pointer: Phaser.Input.Pointer) => {
            if (!this.container.visible) return;
            const hit = this.getSlotHit(pointer);
            if (!hit) return;

            this.dragPointerId = pointer.id;
            this.dragStartX = pointer.x;
            this.dragStartY = pointer.y;
            this.dragSourceType = hit.type;
            this.dragSourceUsableIndex = hit.usableIndex;
        };

        this.pointerUpHandler = (pointer: Phaser.Input.Pointer) => {
            if (!this.container.visible) return;
            if (this.dragPointerId === undefined || pointer.id !== this.dragPointerId) return;
            this.dragPointerId = undefined;
            this.dragStartX = undefined;
            this.dragStartY = undefined;

            const hit = this.getSlotHit(pointer);
            const isInBounds = Boolean(hit);
            if (this.dragGhost) {
                const isDropOnSource =
                    (this.dragSourceType === 'rod' && hit?.type === 'rod')
                    || (this.dragSourceType === 'usable' && hit?.type === 'usable' && hit.usableIndex === this.dragSourceUsableIndex);
                if (isDropOnSource) {
                    this.endDragVisual(true);
                    return;
                }

                let handled = false;
                if (this.dragSourceType === 'rod') {
                    handled = this.onRodSlotDragComplete?.(pointer) ?? false;
                } else if (this.dragSourceType === 'usable' && this.dragSourceUsableIndex !== undefined) {
                    handled = this.onUsableSlotDragComplete?.(this.dragSourceUsableIndex, pointer) ?? false;
                }
                this.endDragVisual(!handled);
                return;
            }

            if (!isInBounds || !hit) return;
            if (hit.type === 'rod') {
                const nextSelected = !this.isRodSlotSelected;
                this.setSelected(nextSelected);
                this.onRodSlotClick?.(this.equippedRod);
                return;
            }

            if (hit.usableIndex === undefined) return;
            this.setSelected(false);
            this.onUsableSlotClick?.(hit.usableIndex, this.equippedUsables[hit.usableIndex] ?? null);
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
        if (this.scene.registry.get('guideBlockAll') === true) return;
        if (this.dragGhost) return;

        if (this.dragSourceType === 'rod') {
            if (!this.rodIcon || !this.equippedRod) return;
            const scale = this.container.scaleX || 1;
            this.dragSourceIcon = this.rodIcon;
            this.rodIcon.setVisible(false);

            this.dragGhost = this.scene.add.image(pointer.x, pointer.y, this.equippedRod.iconKey).setOrigin(0.5, 0.5);
            this.dragGhost.setScale(this.rodIcon.scaleX * scale, this.rodIcon.scaleY * scale);
        } else if (this.dragSourceType === 'usable' && this.dragSourceUsableIndex !== undefined) {
            const sourceIndex = this.dragSourceUsableIndex;
            const sourceIcon = this.usableIcons[sourceIndex];
            const sourceItem = this.equippedUsables[sourceIndex];
            if (!sourceIcon || !sourceItem) return;

            const scale = this.container.scaleX || 1;
            this.dragSourceIcon = sourceIcon;
            sourceIcon.setVisible(false);

            this.dragGhost = this.scene.add.image(pointer.x, pointer.y, sourceItem.iconKey).setOrigin(0.5, 0.5);
            this.dragGhost.setScale(sourceIcon.scaleX * scale, sourceIcon.scaleY * scale);
        } else {
            return;
        }

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
            this.dragSourceType = undefined;
            this.dragSourceUsableIndex = undefined;
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

    private getUsableSlotLocalY(slotIndex: number): number {
        return this.config.usableSlotStartOffsetY + slotIndex * (this.config.slotSize + this.config.usableSlotGap);
    }

    private getUsableSlotScreenPosition(slotIndex: number): { x: number; y: number } | undefined {
        if (!this.lastLayout) return undefined;
        const { rightPageLeftEdgeX, rightPageTopEdgeY, scale } = this.lastLayout;
        const x = rightPageLeftEdgeX + this.config.offsetX * scale;
        const y = rightPageTopEdgeY + (this.config.offsetY + this.getUsableSlotLocalY(slotIndex)) * scale;
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
        this.rodSlotBounds = new Phaser.Geom.Rectangle(
            x - slotSize / 2,
            y - slotSize / 2,
            slotSize,
            slotSize
        );

        this.usableSlotBounds = this.usableSlots.map((_, index) => {
            const localY = this.getUsableSlotLocalY(index);
            const worldY = y + localY * scale;
            return new Phaser.Geom.Rectangle(
                x - slotSize / 2,
                worldY - slotSize / 2,
                slotSize,
                slotSize
            );
        });

        // Position label below slot
        this.rodLabel.setPosition(0, this.config.slotSize / 2 + this.config.labelOffsetY);

        this.usableSlots.forEach((slot, index) => {
            const localY = this.getUsableSlotLocalY(index);
            slot.setPosition(0, localY);
            slot.setTexture(this.usableSlotTextureKey);

            const placeholder = this.usableSlotPlaceholders[index];
            placeholder.setPosition(-this.config.slotSize / 2 + 2, localY - this.config.slotSize / 2 + 1);
            placeholder.setAlpha(0.95);
            placeholder.setVisible(true);

            const icon = this.usableIcons[index];
            if (icon) {
                icon.setPosition(0, localY);
            }

            const countImage = this.usableCountImages[index];
            if (countImage) {
                const source = this.scene.textures.get(countImage.texture.key).getSourceImage() as HTMLImageElement | undefined;
                const width = source?.width ?? countImage.width ?? 0;
                const height = source?.height ?? countImage.height ?? 0;
                countImage.setPosition(
                    Math.round(this.config.slotSize / 2 - width - 1),
                    Math.round(localY + this.config.slotSize / 2 - height - 1)
                );
            }
        });

        this.usableSlotPlaceholders.forEach((placeholder) => {
            this.container.bringToTop(placeholder);
        });
        this.usableCountImages.forEach((countImage) => {
            if (countImage) this.container.bringToTop(countImage);
        });
        if (this.hoverIndicator) this.container.bringToTop(this.hoverIndicator);
        if (this.selectedIndicator) this.container.bringToTop(this.selectedIndicator);
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

    equipUsable(slotIndex: number, item: InventoryDisplayItem, fromPosition?: { x: number; y: number }): void {
        if (slotIndex < 0 || slotIndex >= this.equippedUsables.length) return;

        const existingIcon = this.usableIcons[slotIndex];
        if (existingIcon) {
            existingIcon.destroy();
            this.usableIcons[slotIndex] = undefined;
        }
        const existingCountImage = this.usableCountImages[slotIndex];
        if (existingCountImage) {
            existingCountImage.destroy();
            this.usableCountImages[slotIndex] = undefined;
        }

        this.equippedUsables[slotIndex] = item;
        this.usableSlots[slotIndex].setTexture(this.usableSlotTextureKey);

        const icon = this.scene.add.image(0, 0, item.iconKey).setOrigin(0.5, 0.5);
        icon.setPosition(0, this.getUsableSlotLocalY(slotIndex));
        this.usableIcons[slotIndex] = icon;
        this.container.add(icon);
        this.updateUsableCountImage(slotIndex);

        if (this.hoverIndicator) this.container.bringToTop(this.hoverIndicator);
        if (this.selectedIndicator) this.container.bringToTop(this.selectedIndicator);
        this.usableSlotPlaceholders.forEach((placeholder) => this.container.bringToTop(placeholder));
        const countImage = this.usableCountImages[slotIndex];
        if (countImage) this.container.bringToTop(countImage);
        if (this.hoverIndicator) this.container.bringToTop(this.hoverIndicator);
        if (this.selectedIndicator) this.container.bringToTop(this.selectedIndicator);

        if (fromPosition && this.lastLayout) {
            const { scale } = this.lastLayout;
            const containerPos = this.getUsableSlotScreenPosition(slotIndex);
            if (containerPos) {
                const localStartX = (fromPosition.x - containerPos.x) / scale;
                const localStartY = (fromPosition.y - containerPos.y) / scale;
                icon.setPosition(localStartX, localStartY + this.getUsableSlotLocalY(slotIndex));
                icon.setAlpha(0.8);
                this.scene.tweens.add({
                    targets: icon,
                    x: 0,
                    y: this.getUsableSlotLocalY(slotIndex),
                    alpha: 1,
                    duration: 200,
                    ease: 'Back.out'
                });
            }
        }
    }

    unequipUsable(slotIndex: number, toPosition?: { x: number; y: number }): InventoryDisplayItem | null {
        if (slotIndex < 0 || slotIndex >= this.equippedUsables.length) return null;

        const item = this.equippedUsables[slotIndex];
        if (!item) return null;

        this.equippedUsables[slotIndex] = null;
        this.usableSlots[slotIndex].setTexture(this.usableSlotTextureKey);
        const countImage = this.usableCountImages[slotIndex];
        this.usableCountImages[slotIndex] = undefined;
        countImage?.destroy();

        const icon = this.usableIcons[slotIndex];
        this.usableIcons[slotIndex] = undefined;
        if (icon) {
            if (toPosition && this.lastLayout) {
                const { scale } = this.lastLayout;
                const containerPos = this.getUsableSlotScreenPosition(slotIndex);
                if (containerPos) {
                    const localEndX = (toPosition.x - containerPos.x) / scale;
                    const localEndY = (toPosition.y - containerPos.y) / scale + this.getUsableSlotLocalY(slotIndex);
                    this.scene.tweens.add({
                        targets: icon,
                        x: localEndX,
                        y: localEndY,
                        alpha: 0,
                        duration: 200,
                        ease: 'Back.in',
                        onComplete: () => icon.destroy()
                    });
                } else {
                    icon.destroy();
                }
            } else {
                icon.destroy();
            }
        }

        return item;
    }

    getEquippedUsable(slotIndex: number): InventoryDisplayItem | null {
        if (slotIndex < 0 || slotIndex >= this.equippedUsables.length) return null;
        return this.equippedUsables[slotIndex];
    }

    getEquippedUsables(): Array<InventoryDisplayItem | null> {
        return [...this.equippedUsables];
    }

    hasRodEquipped(): boolean {
        return this.equippedRod !== null;
    }

    hasUsableEquipped(slotIndex: number): boolean {
        if (slotIndex < 0 || slotIndex >= this.equippedUsables.length) return false;
        return this.equippedUsables[slotIndex] !== null;
    }

    setOnRodSlotClick(callback?: (currentRod: InventoryDisplayItem | null) => void) {
        this.onRodSlotClick = callback;
    }

    setOnUsableSlotClick(callback?: (slotIndex: number, currentItem: InventoryDisplayItem | null) => void) {
        this.onUsableSlotClick = callback;
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

    setOnUsableSlotDragComplete(callback?: (slotIndex: number, pointer: Phaser.Input.Pointer) => boolean) {
        this.onUsableSlotDragComplete = callback;
    }

    isPointerOverSlot(pointer: Phaser.Input.Pointer): boolean {
        return this.getSlotHit(pointer) !== null;
    }

    getSlotUnderPointer(pointer: Phaser.Input.Pointer): { type: EquipmentSlotType; usableIndex?: number } | null {
        return this.getSlotHit(pointer);
    }

    getRodSlotScreenRect(): Phaser.Geom.Rectangle | null {
        if (!this.rodSlotBounds) return null;
        return new Phaser.Geom.Rectangle(
            this.rodSlotBounds.x,
            this.rodSlotBounds.y,
            this.rodSlotBounds.width,
            this.rodSlotBounds.height
        );
    }

    getUsableSlotScreenRect(slotIndex: number): Phaser.Geom.Rectangle | null {
        if (slotIndex < 0 || slotIndex >= this.usableSlotBounds.length) return null;
        const bounds = this.usableSlotBounds[slotIndex];
        if (!bounds) return null;
        return new Phaser.Geom.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);
    }

    private getSlotHit(pointer: Phaser.Input.Pointer): { type: EquipmentSlotType; usableIndex?: number } | null {
        if (this.rodSlotBounds?.contains(pointer.x, pointer.y)) {
            return { type: 'rod' };
        }

        for (let index = 0; index < this.usableSlotBounds.length; index++) {
            if (this.usableSlotBounds[index]?.contains(pointer.x, pointer.y)) {
                return { type: 'usable', usableIndex: index };
            }
        }

        return null;
    }

    private createLabelTexture(text: string, color = '#4b3435'): string {
        const width = this.measureBitmapTextWidth(text);
        const height = this.fontCharSize;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        this.fontRenderer.drawText(ctx, text, 0, 0, { charGap: this.fontCharGap });

        // Tint text color (brownish to match UI)
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__equip_label_${Date.now()}`;
        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    private measureBitmapTextWidth(text: string): number {
        return this.fontRenderer.measureTextWidth(text, { charGap: this.fontCharGap });
    }

    private refreshLabel() {
        const nextText = this.localeManager.t('inventory.equipment.rod', undefined, 'Rod');
        const nextKey = this.createLabelTexture(nextText);
        const oldKey = this.labelTextureKey;
        this.labelTextureKey = nextKey;
        this.rodLabel.setTexture(nextKey);
        if (oldKey && oldKey !== nextKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private updateUsableCountImage(slotIndex: number) {
        const item = this.equippedUsables[slotIndex];
        const existingCountImage = this.usableCountImages[slotIndex];
        if (existingCountImage) {
            existingCountImage.destroy();
            this.usableCountImages[slotIndex] = undefined;
        }
        if (!item || item.count <= 1) return;

        const countText = String(Math.max(0, Math.floor(item.count)));
        const textureKey = this.getCountTexture(countText);
        const image = this.scene.add.image(0, 0, textureKey).setOrigin(0, 0);
        const localY = this.getUsableSlotLocalY(slotIndex);
        const source = this.scene.textures.get(textureKey).getSourceImage() as HTMLImageElement | undefined;
        const width = source?.width ?? image.width ?? 0;
        const height = source?.height ?? image.height ?? 0;
        image.setPosition(
            Math.round(this.config.slotSize / 2 - width - 1),
            Math.round(localY + this.config.slotSize / 2 - height - 1)
        );
        this.usableCountImages[slotIndex] = image;
        this.container.add(image);
    }

    private getCountTexture(text: string): string {
        const cached = this.countTextureCache.get(text);
        if (cached) return cached;

        const width = this.measureBitmapTextWidth(text);
        const height = this.fontCharSize;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        this.fontRenderer.drawText(ctx, text, 0, 0, { charGap: this.fontCharGap });
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__equip_count_${Date.now()}_${this.countTextureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        this.countTextureCache.set(text, key);
        return key;
    }

    destroy() {
        this.endDragVisual(false);
        if (this.localeChangedHandler) {
            window.removeEventListener('locale:changed', this.localeChangedHandler as EventListener);
            this.localeChangedHandler = undefined;
        }
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
        this.usableSlotPlaceholders.forEach((placeholder) => {
            const key = placeholder.texture.key;
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        });
        this.usableCountImages.forEach((countImage) => countImage?.destroy());
        this.countTextureCache.forEach((key) => {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        });
        this.countTextureCache.clear();
        this.container.destroy();
    }
}
