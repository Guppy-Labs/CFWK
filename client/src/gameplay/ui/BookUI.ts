import Phaser from 'phaser';
import { InventoryGroupsUI, GroupKey } from './inventory/InventoryGroupsUI';
import { InventorySlotsUI, InventoryDisplayItem } from './inventory/InventorySlotsUI';
import { InventoryItemDetailsUI, DEFAULT_ITEM_DETAILS_CONFIG } from './inventory/InventoryItemDetailsUI';
import { EquipmentSlotsUI } from './inventory/EquipmentSlotsUI';
import { NetworkManager } from '../network/NetworkManager';
import { InventorySlot, getItemDefinition, ItemDefinition, ItemCategory } from '@cfwk/shared';

type TabItem = {
    label: string;
    active: boolean;
    width: number;
    container: Phaser.GameObjects.Container;
    img: Phaser.GameObjects.Image;
    textureKey: string;
};

export class BookUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private cover: Phaser.GameObjects.Image;
    private leftPage: Phaser.GameObjects.Image;
    private rightPage: Phaser.GameObjects.Image;
    private tabsContainer: Phaser.GameObjects.Container;
    private tabs: TabItem[] = [];
    private openState = false;
    private inventoryGroups: InventoryGroupsUI;
    private inventorySlots: InventorySlotsUI;
    private inventoryDetails: InventoryItemDetailsUI;
    private equipmentSlots: EquipmentSlotsUI;
    private activeTabLabel = 'Inventory';
    private inventorySlotsData: InventorySlot[] = [];
    private inventoryItems: Array<{ slot: InventorySlot; def: ItemDefinition; display: InventoryDisplayItem }> = [];
    private networkManager = NetworkManager.getInstance();
    private inventoryUpdateHandler?: (event: Event) => void;
    
    // Track if we're in "rod equip" mode (selected a rod from inventory)
    private pendingRodEquip: InventoryDisplayItem | null = null;
    private pendingRodSlotIndex: number | null = null;
    private suppressInventorySelection = false;
    private equippedRodId: string | null = null;

    private readonly coverWidth = 320;
    private readonly coverHeight = 219;
    private readonly pageWidth = 147;
    private readonly pageHeight = 193;
    private readonly tabHeight = 12;
    private readonly tabBorder = 3;
    private readonly tabMinWidth = 41;
    private readonly tabPaddingLeft = 8;
    private readonly tabPaddingRight = 6;
    private readonly tabBaseOffsetY = 16;
    private readonly tabGap = 2;
    private readonly tabOffsetX = 5;
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

    constructor(scene: Phaser.Scene) {
        this.scene = scene;

        this.cover = this.scene.add.image(0, 0, 'ui-book-cover');
        this.leftPage = this.scene.add.image(0, 0, 'ui-book-page-left');
        this.rightPage = this.scene.add.image(0, 0, 'ui-book-page-right');

        this.cover.setOrigin(0.5, 0.5);
        this.leftPage.setOrigin(0.5, 0.5);
        this.rightPage.setOrigin(0.5, 0.5);

        this.cover.setScrollFactor(0);
        this.leftPage.setScrollFactor(0);
        this.rightPage.setScrollFactor(0);

        this.tabsContainer = this.scene.add.container(0, 0);

        this.container = this.scene.add.container(0, 0, [this.cover, this.leftPage, this.rightPage, this.tabsContainer]);
        this.container.setDepth(12000);
        this.container.setVisible(false);

        this.inventoryUpdateHandler = (event: Event) => {
            const customEvent = event as CustomEvent<{ slots: InventorySlot[]; totalSlots: number; equippedRodId?: string | null }>;
            const slots = customEvent.detail?.slots || [];
            const equippedRodId = customEvent.detail?.equippedRodId ?? null;
            this.applyInventoryUpdate(slots, equippedRodId);
        };
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);

        this.inventoryGroups = new InventoryGroupsUI(this.scene, this.container);
        this.inventoryDetails = new InventoryItemDetailsUI(this.scene, this.container, {
            width: DEFAULT_ITEM_DETAILS_CONFIG.width,
            height: DEFAULT_ITEM_DETAILS_CONFIG.height,
            offsetX: DEFAULT_ITEM_DETAILS_CONFIG.offsetX,
            offsetY: DEFAULT_ITEM_DETAILS_CONFIG.offsetY,
            frameTextureKey: DEFAULT_ITEM_DETAILS_CONFIG.frameTextureKey,
            dividerTextureKey: DEFAULT_ITEM_DETAILS_CONFIG.dividerTextureKey
        });
        this.inventorySlots = new InventorySlotsUI(this.scene, this.container, {
            bottomReservedHeight: 0
        });
        this.equipmentSlots = new EquipmentSlotsUI(this.scene, this.container);
        
        this.inventoryGroups.setOnGroupChange((group) => {
            if (this.activeTabLabel !== 'Inventory') return;
            this.applyInventoryFilter(group);
            this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
            this.equipmentSlots.clearSelection();
            this.pendingRodEquip = null;
            this.inventorySlots.setBottomReservedHeight(0);
        });
        this.inventorySlots.setOnItemSelect((item, slotIndex, stackCount) => {
            if (this.suppressInventorySelection) return;
            if (slotIndex < 0) {
                this.inventoryDetails.setItem(null);
                this.inventorySlots.setBottomReservedHeight(0);
                this.pendingRodEquip = null;
                this.pendingRodSlotIndex = null;
                return;
            }
            // Check if we're unequipping a rod from the equipment slot
            if (this.equipmentSlots.isSelected() && this.equipmentSlots.hasRodEquipped()) {
                const targetPos = this.inventorySlots.getSlotScreenPosition(slotIndex);
                
                // Only unequip when clicking an empty inventory slot
                if (!item) {
                    const currentRod = this.equipmentSlots.getEquippedRod();
                    if (currentRod && this.placeItemInSlot(slotIndex, currentRod.id, 1)) {
                        this.equipmentSlots.unequipRod(targetPos ?? undefined);
                        this.equipmentSlots.clearSelection();
                        this.equippedRodId = null;
                        this.networkManager.sendEquippedRod(null);
                        this.updateInventoryDisplay();
                        this.inventoryDetails.setItem(null);
                        this.inventorySlots.setBottomReservedHeight(0);
                        this.pendingRodEquip = null;
                        this.pendingRodSlotIndex = null;
                    }
                    return;
                }

                // Clicking a filled slot just switches selection to that item
                this.equipmentSlots.clearSelection();
            }
            
            // Normal inventory selection
            this.equipmentSlots.clearSelection();
            
            if (!item) {
                this.inventoryDetails.setItem(null);
                this.inventorySlots.setBottomReservedHeight(0);
                this.pendingRodEquip = null;
                this.pendingRodSlotIndex = null;
                return;
            }
            
            // Check if this is a fishing rod
            if (item.category === 'Tools' && item.id.includes('rod')) {
                this.pendingRodEquip = item;
                this.pendingRodSlotIndex = slotIndex;
            } else {
                this.pendingRodEquip = null;
                this.pendingRodSlotIndex = null;
            }
            
            this.inventorySlots.setBottomReservedHeight(this.inventoryDetails.getReservedHeight());
            this.inventoryDetails.setItem({
                name: item.name,
                description: item.description,
                amount: stackCount ?? item.count,
                stackSize: item.stackSize
            });
        });

        this.inventorySlots.setOnSlotDragComplete((fromIndex, toIndex, pointer) => {
            if (this.suppressInventorySelection) return false;
            if (toIndex !== undefined) {
                if (this.swapInventorySlots(fromIndex, toIndex)) {
                    this.clearSelectionAfterDrag();
                    return true;
                }
                return false;
            }

            if (this.equipmentSlots.isPointerOverSlot(pointer)) {
                if (this.handleInventoryDragToRodSlot(fromIndex)) {
                    this.clearSelectionAfterDrag();
                    return true;
                }
                return false;
            }

            return false;
        });
        
        // Handle rod slot clicks
        this.equipmentSlots.setOnRodSlotClick((currentRod) => {
            if (!this.equipmentSlots.isSelected()) {
                this.inventoryDetails.setItem(null);
                this.inventorySlots.setBottomReservedHeight(0);
                this.pendingRodEquip = null;
                this.pendingRodSlotIndex = null;
                return;
            }
            // If we have a rod selected in inventory, equip it
            if (this.pendingRodEquip && this.pendingRodSlotIndex !== null) {
                const sourceIndex = this.pendingRodSlotIndex;
                const sourcePos = this.inventorySlots.getSlotScreenPosition(sourceIndex);

                // Remove one from source slot first
                if (!this.removeItemFromSlot(sourceIndex, 1)) {
                    return;
                }

                // If there's already a rod equipped, place it back into inventory
                if (currentRod) {
                    const placed = this.placeItemInSlot(sourceIndex, currentRod.id, 1) || this.placeItemInFirstEmptySlot(currentRod.id, 1);
                    if (!placed) {
                        // Rollback removal if no space
                        this.placeItemInSlot(sourceIndex, this.pendingRodEquip.id, 1);
                        return;
                    }
                }

                // Equip the new rod
                this.equipmentSlots.equipRod(this.pendingRodEquip, sourcePos ?? undefined);
                this.equippedRodId = this.pendingRodEquip.id;
                this.networkManager.sendEquippedRod(this.pendingRodEquip.id);

                // Clear selection states
                this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
                this.equipmentSlots.clearSelection();
                this.inventoryDetails.setItem(null);
                this.inventorySlots.setBottomReservedHeight(0);
                this.pendingRodEquip = null;
                this.pendingRodSlotIndex = null;
                this.updateInventoryDisplay();

            } else if (currentRod) {
                // No rod selected in inventory, but rod slot has a rod - select it and show details
                this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
                this.equipmentSlots.setSelected(true);
                this.inventoryDetails.setItem({
                    name: currentRod.name,
                    description: currentRod.description,
                    amount: 1,
                    stackSize: currentRod.stackSize
                });
                this.inventorySlots.setBottomReservedHeight(this.inventoryDetails.getReservedHeight());
            }
        });

        this.equipmentSlots.setOnRodSlotDragComplete((pointer) => {
            if (this.handleEquipmentDragToInventory(pointer)) {
                this.clearSelectionAfterDrag();
                return true;
            }
            return false;
        });

        this.createTabs();
        this.layout();
    }

    private getScale(): number {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const maxWidth = width * 0.9;
        const maxHeight = height * 0.9;
        return Math.min(maxWidth / this.coverWidth, maxHeight / this.coverHeight) * 0.84;
    }

    layout() {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const scale = this.getScale();
        const cy = height / 2;

        this.cover.setScale(scale);
        this.leftPage.setScale(scale);
        this.rightPage.setScale(scale);

        const pageW = this.pageWidth * scale;
        const coverW = this.coverWidth * scale;

        // Find the longest tab to calculate total unit width
        const longestTabWidth = Math.max(...this.tabs.map(t => t.width)) * scale;
        const tabOffsetX = this.tabOffsetX * scale;

        const bookCenterX = width / 2 + (pageW - tabOffsetX + longestTabWidth - coverW / 2) / 2;

        this.cover.setPosition(bookCenterX, cy);
        this.leftPage.setPosition(bookCenterX - pageW / 2, cy);
        this.rightPage.setPosition(bookCenterX + pageW / 2, cy);

        this.layoutTabs(scale, bookCenterX, cy, pageW);

        const pageH = this.pageHeight * scale;
        const leftPageLeftEdgeX = bookCenterX - pageW / 2 - (this.pageWidth / 2) * scale;
        const leftPageTopEdgeY = cy - pageH / 2;
        const rightPageLeftEdgeX = bookCenterX + pageW / 2 - (this.pageWidth / 2) * scale;
        const rightPageTopEdgeY = cy - pageH / 2;
        
        this.inventoryGroups.layout(leftPageLeftEdgeX, leftPageTopEdgeY, scale);
        this.inventoryDetails.layout(leftPageLeftEdgeX, leftPageTopEdgeY, this.pageHeight, scale);
        this.inventorySlots.layout(leftPageLeftEdgeX, leftPageTopEdgeY, this.pageHeight, scale);
        this.equipmentSlots.layout(rightPageLeftEdgeX, rightPageTopEdgeY, this.pageHeight, scale);
    }

    private createTabs() {
        const labels = ['Inventory', 'Finbook', 'Settings'];
        labels.forEach((label, index) => {
            const active = index === 0;
            const tab = this.buildTab(label, active);
            this.tabsContainer.add(tab.container);
            this.tabs.push(tab);
        });
    }

    private layoutTabs(scale: number, bookCenterX: number, cy: number, pageW: number) {
        const pageH = this.pageHeight * scale;
        const leftPageLeftEdgeX = bookCenterX - pageW / 2 - (this.pageWidth / 2) * scale;

        const baseOffsetY = this.tabBaseOffsetY;
        const tabGap = this.tabGap;
        const tabOffsetX = this.tabOffsetX;

        this.tabs.forEach((tab, index) => {
            const tabWidth = tab.width;
            const tabHeight = this.tabHeight;

            tab.container.setScale(scale);

            // Right edge of tab aligns with left edge of left page
            const x = Math.round(leftPageLeftEdgeX - tabWidth * scale + tabOffsetX * scale);
            const y = Math.round(cy - pageH / 2 + (baseOffsetY + index * (tabHeight + tabGap)) * scale);

            tab.container.setPosition(x, y);
        });
    }

    private buildTab(label: string, active: boolean): TabItem {
        const textWidth = this.measureBitmapTextWidth(label);
        const width = Math.max(this.tabMinWidth, textWidth + this.tabPaddingLeft + this.tabPaddingRight);

        const textureKey = this.createNineSliceTexture(
            active ? 'ui-tab-active' : 'ui-tab-inactive',
            width,
            this.tabHeight,
            this.tabBorder,
            label,
            active
        );

        const img = this.scene.add.image(0, 0, textureKey).setOrigin(0, 0);
        const container = this.scene.add.container(0, 0, [img]);

        img.setInteractive({ useHandCursor: true });
        img.on('pointerdown', () => this.setActiveTab(label));

        return {
            label,
            active,
            width,
            container,
            img,
            textureKey
        };
    }

    private nineSliceCounter = 0;

    private createNineSliceTexture(key: string, width: number, height: number, border: number, label?: string, active?: boolean) {
        const srcW = 41;
        const srcH = 12;
        const centerSrcW = srcW - border * 2;
        const centerSrcH = srcH - border * 2;

        const centerW = Math.max(1, width - border * 2);
        const centerH = Math.max(1, height - border * 2);

        // Generate unique texture key for this nine-slice
        const rtKey = `__nineslice_${this.nineSliceCounter++}`;

        // Create a canvas to composite the nine-slice at 1:1 pixel ratio
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        // Get source image from Phaser's texture manager
        const srcTexture = this.scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;

        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;

        // Draw the 9 parts at 1:1 pixel ratio
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

        if (label) {
            const textWidth = this.measureBitmapTextWidth(label);
            const textX = Math.max(this.tabPaddingLeft, width - this.tabPaddingRight - textWidth);
            const textY = Math.floor((height - this.fontCharSize) / 2);
            const textColor = active ? '#a17f74' : '#4b3435';
            this.drawBitmapText(ctx, fontImage, label, textX, textY, textColor);
        }

        // Add the composited canvas as a texture
        this.scene.textures.addCanvas(rtKey, canvas);

        return rtKey;
    }

    private setActiveTab(label: string) {
        this.activeTabLabel = label;
        this.tabs.forEach((tab) => {
            const shouldBeActive = tab.label === label;
            if (tab.active === shouldBeActive) return;
            tab.active = shouldBeActive;
            this.updateTabTexture(tab);
        });
        const isInventory = label === 'Inventory';
        this.inventoryGroups.setVisible(isInventory);
        this.equipmentSlots.setVisible(isInventory);
        if (isInventory) {
            this.inventoryGroups.setActiveGroup('All', true);
            this.refreshInventory();
            this.inventorySlots.setBottomReservedHeight(0);
            this.pendingRodEquip = null;
        } else {
            this.inventorySlots.setVisible(false);
            this.inventoryDetails.setVisible(false);
            this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
            this.equipmentSlots.clearSelection();
            this.inventorySlots.setBottomReservedHeight(0);
            this.pendingRodEquip = null;
        }
    }

    private updateTabTexture(tab: TabItem) {
        const key = tab.active ? 'ui-tab-active' : 'ui-tab-inactive';
        const textureKey = this.createNineSliceTexture(
            key,
            tab.width,
            this.tabHeight,
            this.tabBorder,
            tab.label,
            tab.active
        );

        const oldKey = tab.textureKey;
        tab.textureKey = textureKey;
        tab.img.setTexture(textureKey);

        if (this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private async refreshInventory() {
        const response = await this.networkManager.getInventory();
        if (!response) return;

        this.applyInventoryUpdate(response.slots || [], response.equippedRodId ?? null);
    }

    private applyInventoryUpdate(slots: InventorySlot[], equippedRodId: string | null) {
        this.inventorySlotsData = slots;
        this.equippedRodId = equippedRodId;
        this.updateInventoryDisplay();
        this.updateEquippedRodFromServer();
    }

    private updateInventoryDisplay() {
        this.inventoryItems = this.inventorySlotsData
            .filter((slot) => Boolean(slot.itemId) && slot.count > 0)
            .map((slot) => {
                const def = slot.itemId ? getItemDefinition(slot.itemId) : null;
                if (!def) return null;
                const display: InventoryDisplayItem = {
                    id: def.id,
                    name: def.name,
                    description: def.description,
                    count: slot.count,
                    stackSize: def.stackSize,
                    iconKey: `item-${def.id}-18`,
                    category: def.category
                };
                return { slot, def, display };
            })
            .filter((value): value is { slot: InventorySlot; def: ItemDefinition; display: InventoryDisplayItem } => Boolean(value));

        this.withSuppressedInventorySelection(() => {
            this.applyInventoryFilter(this.inventoryGroups.getActiveGroup());
        });
    }

    private persistInventorySlots() {
        this.networkManager.sendInventorySlots(this.inventorySlotsData);
    }

    private applyInventoryFilter(group: GroupKey) {
        const isInventory = this.activeTabLabel === 'Inventory';
        if (!isInventory) {
            this.inventorySlots.setVisible(false);
            this.inventoryDetails.setVisible(false);
            this.inventorySlots.clearSelection();
            this.inventorySlots.setBottomReservedHeight(0);
            return;
        }

        const showAll = group === 'All';
        const category = this.getGroupCategory(group);

        const itemBySlot = new Map<number, InventoryDisplayItem>();
        this.inventoryItems.forEach((entry) => {
            itemBySlot.set(entry.slot.index, entry.display);
        });

        const slotsDisplay = this.inventorySlotsData.map((slot) => ({
            index: slot.index,
            item: itemBySlot.get(slot.index) ?? null,
            count: slot.count
        }));

        // Always show slots for inventory views
        this.inventorySlots.setVisible(isInventory);
        this.inventorySlots.setSlots(slotsDisplay, showAll ? null : category);
        if (!showAll && category !== 'Food' && category !== 'Tools') {
            this.inventoryDetails.setItem(null);
            this.inventorySlots.setBottomReservedHeight(0);
        }
    }

    private getGroupCategory(group: GroupKey): ItemCategory | null {
        switch (group) {
            case 'Tools':
                return 'Tools';
            case 'Food':
                return 'Food';
            case 'Gear':
            case 'Fishing':
                return null;
            case 'All':
            default:
                return null;
        }
    }

    private getSlotByIndex(index: number): InventorySlot | undefined {
        return this.inventorySlotsData.find((slot) => slot.index === index);
    }

    private getRodDefinition(itemId: string): ItemDefinition | null {
        const def = getItemDefinition(itemId);
        if (!def) return null;
        if (def.category !== 'Tools' || !def.id.includes('rod')) return null;
        return def;
    }

    private createDisplayItem(def: ItemDefinition, count: number): InventoryDisplayItem {
        return {
            id: def.id,
            name: def.name,
            description: def.description,
            count,
            stackSize: def.stackSize,
            iconKey: `item-${def.id}-18`,
            category: def.category
        };
    }

    private getStackSize(itemId: string): number {
        const def = getItemDefinition(itemId);
        return def?.stackSize ?? 99;
    }

    private removeItemFromSlot(index: number, amount: number): boolean {
        const slot = this.getSlotByIndex(index);
        if (!slot || !slot.itemId || slot.count < amount) return false;

        slot.count -= amount;
        if (slot.count <= 0) {
            slot.itemId = null;
            slot.count = 0;
        }
        this.persistInventorySlots();
        return true;
    }

    private placeItemInSlot(index: number, itemId: string, amount: number): boolean {
        const slot = this.getSlotByIndex(index);
        if (!slot) return false;

        const stackSize = this.getStackSize(itemId);
        if (!slot.itemId) {
            if (amount > stackSize) return false;
            slot.itemId = itemId;
            slot.count = amount;
            this.persistInventorySlots();
            return true;
        }

        if (slot.itemId !== itemId) return false;
        if (slot.count + amount > stackSize) return false;

        slot.count += amount;
        this.persistInventorySlots();
        return true;
    }

    private placeItemInFirstEmptySlot(itemId: string, amount: number): boolean {
        for (const slot of this.inventorySlotsData) {
            if (!slot.itemId || slot.count === 0) {
                return this.placeItemInSlot(slot.index, itemId, amount);
            }
        }
        return false;
    }

    private swapInventorySlots(fromIndex: number, toIndex: number): boolean {
        if (fromIndex === toIndex) return false;
        const fromSlot = this.getSlotByIndex(fromIndex);
        const toSlot = this.getSlotByIndex(toIndex);
        if (!fromSlot || !toSlot) return false;
        if (!fromSlot.itemId || fromSlot.count <= 0) return false;

        const tempItemId = fromSlot.itemId;
        const tempCount = fromSlot.count;
        fromSlot.itemId = toSlot.itemId;
        fromSlot.count = toSlot.count;
        toSlot.itemId = tempItemId;
        toSlot.count = tempCount;

        this.persistInventorySlots();
        this.updateInventoryDisplay();
        return true;
    }

    private handleInventoryDragToRodSlot(sourceIndex: number): boolean {
        const sourceSlot = this.getSlotByIndex(sourceIndex);
        if (!sourceSlot || !sourceSlot.itemId || sourceSlot.count <= 0) return false;

        const rodDef = this.getRodDefinition(sourceSlot.itemId);
        if (!rodDef) return false;

        const currentRod = this.equipmentSlots.getEquippedRod();
        if (currentRod) {
            sourceSlot.itemId = currentRod.id;
            sourceSlot.count = 1;
        } else {
            sourceSlot.itemId = null;
            sourceSlot.count = 0;
        }

        this.persistInventorySlots();
        const display = this.createDisplayItem(rodDef, 1);
        this.equipmentSlots.equipRod(display);
        this.equippedRodId = display.id;
        this.networkManager.sendEquippedRod(display.id);
        this.updateInventoryDisplay();
        return true;
    }

    private handleEquipmentDragToInventory(pointer: Phaser.Input.Pointer): boolean {
        const destIndex = this.inventorySlots.getSlotIndexAtPointer(pointer);
        if (destIndex === undefined) return false;

        const currentRod = this.equipmentSlots.getEquippedRod();
        if (!currentRod) return false;

        const destSlot = this.getSlotByIndex(destIndex);
        if (!destSlot) return false;

        if (destSlot.itemId) {
            const destRodDef = this.getRodDefinition(destSlot.itemId);
            if (!destRodDef) return false;

            destSlot.itemId = currentRod.id;
            destSlot.count = 1;

            this.persistInventorySlots();
            const display = this.createDisplayItem(destRodDef, 1);
            this.equipmentSlots.equipRod(display);
            this.equippedRodId = display.id;
            this.networkManager.sendEquippedRod(display.id);
        } else {
            destSlot.itemId = currentRod.id;
            destSlot.count = 1;

            this.persistInventorySlots();
            this.equipmentSlots.unequipRod();
            this.equippedRodId = null;
            this.networkManager.sendEquippedRod(null);
        }

        this.updateInventoryDisplay();
        return true;
    }

    private clearSelectionAfterDrag() {
        this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
        this.equipmentSlots.clearSelection();
        this.inventoryDetails.setItem(null);
        this.inventorySlots.setBottomReservedHeight(0);
        this.pendingRodEquip = null;
        this.pendingRodSlotIndex = null;
    }

    private updateEquippedRodFromServer() {
        const serverRodId = this.equippedRodId;
        const currentRod = this.equipmentSlots.getEquippedRod();

        if (!serverRodId) {
            if (currentRod) {
                this.equipmentSlots.unequipRod();
            }
            return;
        }

        if (currentRod && currentRod.id === serverRodId) return;

        const def = getItemDefinition(serverRodId);
        if (!def) return;

        const display: InventoryDisplayItem = {
            id: def.id,
            name: def.name,
            description: def.description,
            count: 1,
            stackSize: def.stackSize,
            iconKey: `item-${def.id}-18`,
            category: def.category
        };

        this.equipmentSlots.equipRod(display);
        this.equipmentSlots.clearSelection();
    }

    private drawBitmapText(
        ctx: CanvasRenderingContext2D,
        fontImage: HTMLImageElement,
        text: string,
        x: number,
        y: number,
        color: string
    ) {
        const charSize = this.fontCharSize;
        const textWidth = this.measureBitmapTextWidth(text);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = Math.max(1, textWidth);
        tempCanvas.height = charSize;
        const tempCtx = tempCanvas.getContext('2d')!;

        let cursorX = 0;
        for (const ch of text) {
            const pos = this.findGlyph(ch);
            if (pos) {
                const sx = pos.col * charSize;
                const sy = pos.row * charSize;
                tempCtx.drawImage(fontImage, sx, sy, charSize, charSize, cursorX, 0, charSize, charSize);

                const glyphWidth = this.getGlyphWidth(fontImage, ch);
                cursorX += glyphWidth + this.fontCharGap;
            } else {
                cursorX += charSize + this.fontCharGap;
            }
        }

        tempCtx.globalCompositeOperation = 'source-in';
        tempCtx.fillStyle = color;
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        ctx.drawImage(tempCanvas, x, y);
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

        const charSize = this.fontCharSize;
        const canvas = document.createElement('canvas');
        canvas.width = charSize;
        canvas.height = charSize;
        const ctx = canvas.getContext('2d')!;

        const sx = pos.col * charSize;
        const sy = pos.row * charSize;
        ctx.drawImage(fontImage, sx, sy, charSize, charSize, 0, 0, charSize, charSize);

        const data = ctx.getImageData(0, 0, charSize, charSize).data;
        let rightmost = -1;
        for (let x = charSize - 1; x >= 0; x--) {
            let hasPixel = false;
            for (let y = 0; y < charSize; y++) {
                const idx = (y * charSize + x) * 4 + 3;
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

    open() {
        this.openState = true;
        this.container.setVisible(true);
        // Refresh layout and tab state to ensure everything is positioned and visible
        this.layout();
        this.setActiveTab(this.activeTabLabel);
    }

    openToTab(tabLabel: string) {
        this.openState = true;
        this.container.setVisible(true);
        this.layout();
        this.setActiveTab(tabLabel);
    }

    close() {
        this.openState = false;
        this.container.setVisible(false);
        this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
        this.equipmentSlots.clearSelection();
        this.inventoryDetails.setVisible(false);
        this.inventorySlots.setBottomReservedHeight(0);
        this.pendingRodEquip = null;
    }

    private withSuppressedInventorySelection(action: () => void) {
        this.suppressInventorySelection = true;
        try {
            action();
        } finally {
            this.suppressInventorySelection = false;
        }
    }

    toggle() {
        if (this.openState) {
            this.close();
        } else {
            this.open();
        }
    }

    isOpen(): boolean {
        return this.openState;
    }

    destroy() {
        if (this.inventoryUpdateHandler) {
            window.removeEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
            this.inventoryUpdateHandler = undefined;
        }
        this.container.destroy();
    }
}
