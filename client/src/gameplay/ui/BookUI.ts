import Phaser from 'phaser';
import { InventoryGroupsUI, GroupKey } from './inventory/InventoryGroupsUI';
import { InventorySlotsUI, InventoryDisplayItem } from './inventory/InventorySlotsUI';
import { InventoryItemDetailsUI, DEFAULT_ITEM_DETAILS_CONFIG } from './inventory/InventoryItemDetailsUI';
import { EquipmentSlotsUI } from './inventory/EquipmentSlotsUI';
import { CoinBarUI } from './inventory/CoinBarUI';
import { SettingsTabUI } from './settings/SettingsTabUI';
import { FinbookTabUI } from './finbook/FinbookTabUI';
import { GlimmerbowlTabUI } from './glimmerbowl/GlimmerbowlTabUI';
import { FishViewCardUI } from './glimmerbowl/FishViewCardUI';
import { NetworkManager } from '../network/NetworkManager';
import { LocaleManager } from '../i18n/LocaleManager';
import { getLocalizedItemDescription, getLocalizedItemName } from '../i18n/itemLocale';
import { DEFAULT_USABLE_EQUIP_SLOTS, GlimmerbowlEntry, InventorySlot, IPlayerMoneyState, getItemDefinition, ItemDefinition, ItemCategory, isEquippableUsableItem, isRodItem } from '@cfwk/shared';
import { BitmapFontRenderer } from './BitmapFontRenderer';

type TabItem = {
    key: 'Inventory' | 'Finbook' | 'Glimmerbowl' | 'Settings';
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
    private coinBar: CoinBarUI;
    private settingsTab: SettingsTabUI;
    private finbookTab: FinbookTabUI;
    private glimmerbowlTab: GlimmerbowlTabUI;
    private fishViewCard: FishViewCardUI;
    private activeTabLabel: 'Inventory' | 'Finbook' | 'Glimmerbowl' | 'Settings' = 'Inventory';
    private glimmerbowlUnlocked = false;
    private inventorySlotsData: InventorySlot[] = [];
    private inventoryItems: Array<{ slot: InventorySlot; def: ItemDefinition; display: InventoryDisplayItem }> = [];
    private networkManager = NetworkManager.getInstance();
    private localeManager = LocaleManager.getInstance();
    private inventoryUpdateHandler?: (event: Event) => void;
    private moneyUpdateHandler?: (event: Event) => void;
    private glimmerbowlUpdateHandler?: (event: Event) => void;
    private localeChangedHandler?: (event: Event) => void;
    private bookHiddenForFishView = false;
    
    // Track if we're in "rod equip" mode (selected a rod from inventory)
    private pendingRodEquip: InventoryDisplayItem | null = null;
    private pendingRodSlotIndex: number | null = null;
    private pendingUsableEquip: InventoryDisplayItem | null = null;
    private pendingUsableSlotIndex: number | null = null;
    private selectedUsableEquipSlotIndex: number | null = null;
    private suppressInventorySelection = false;
    private equippedRodId: string | null = null;
    private equippedUsableIds: Array<string | null> = Array.from({ length: DEFAULT_USABLE_EQUIP_SLOTS }, () => null);

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
    private readonly fontRenderer: BitmapFontRenderer;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.fontRenderer = new BitmapFontRenderer(scene, this.fontCharSize);

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
            const customEvent = event as CustomEvent<{ slots: InventorySlot[]; totalSlots: number; equippedRodId?: string | null; equippedUsableIds?: Array<string | null> }>;
            const slots = customEvent.detail?.slots || [];
            const equippedRodId = customEvent.detail?.equippedRodId ?? null;
            const equippedUsableIds = customEvent.detail?.equippedUsableIds;
            this.applyInventoryUpdate(slots, equippedRodId, equippedUsableIds);
        };
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
        this.moneyUpdateHandler = (event: Event) => {
            const customEvent = event as CustomEvent<IPlayerMoneyState>;
            this.applyMoneyUpdate(customEvent.detail?.money ?? 0);
        };
        window.addEventListener('money:update', this.moneyUpdateHandler as EventListener);
        this.glimmerbowlUpdateHandler = (event: Event) => {
            const customEvent = event as CustomEvent<{ entries: GlimmerbowlEntry[]; unlocked: boolean; hasOwnedScar?: boolean }>;
            const entries = customEvent.detail?.entries || [];
            const unlocked = Boolean(customEvent.detail?.unlocked);
            const hasOwnedScar = Boolean(customEvent.detail?.hasOwnedScar);
            this.applyGlimmerbowlUpdate(entries, unlocked, hasOwnedScar);
        };
        window.addEventListener('glimmerbowl:update', this.glimmerbowlUpdateHandler as EventListener);
        this.localeChangedHandler = () => {
            this.refreshTabLabels();
        };
        window.addEventListener('locale:changed', this.localeChangedHandler as EventListener);

        this.inventoryGroups = new InventoryGroupsUI(this.scene, this.container);
        this.inventoryDetails = new InventoryItemDetailsUI(this.scene, this.container, {
            width: DEFAULT_ITEM_DETAILS_CONFIG.width,
            height: DEFAULT_ITEM_DETAILS_CONFIG.height,
            offsetX: DEFAULT_ITEM_DETAILS_CONFIG.offsetX,
            offsetY: DEFAULT_ITEM_DETAILS_CONFIG.offsetY,
            frameTextureKey: DEFAULT_ITEM_DETAILS_CONFIG.frameTextureKey,
            dividerTextureKey: DEFAULT_ITEM_DETAILS_CONFIG.dividerTextureKey
        });
        this.inventoryDetails.setOnDrop((itemId, amount, _slotIndex) => {
            this.networkManager.sendDropItem(itemId, amount);
            this.inventoryDetails.setItem(null);
            this.inventorySlots.setBottomReservedHeight(0);
            this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
            this.pendingRodEquip = null;
            this.pendingRodSlotIndex = null;
        });
        this.inventorySlots = new InventorySlotsUI(this.scene, this.container, {
            bottomReservedHeight: 0
        });
        this.coinBar = new CoinBarUI(this.scene, this.container);
        this.equipmentSlots = new EquipmentSlotsUI(this.scene, this.container);
        this.settingsTab = new SettingsTabUI(this.scene, this.container);
        this.finbookTab = new FinbookTabUI(this.scene, this.container);
        this.glimmerbowlTab = new GlimmerbowlTabUI(this.scene, this.container);
        this.fishViewCard = new FishViewCardUI(this.scene);
        this.glimmerbowlTab.setOnDrop((itemId, amount) => {
            this.networkManager.sendDropItem(itemId, amount);
        });
        this.glimmerbowlTab.setOnView((entry) => {
            this.openFishView(entry);
        });
        this.glimmerbowlTab.setOnAwakenRequest((fishEntryId, scarItemId) => {
            this.networkManager.sendGlimmerbowlAwaken(fishEntryId, scarItemId);
        });
        
        this.inventoryGroups.setOnGroupChange((group) => {
            if (this.activeTabLabel !== 'Inventory') return;
            this.applyInventoryFilter(group);
            this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
            this.equipmentSlots.clearSelection();
            this.pendingRodEquip = null;
            this.pendingUsableEquip = null;
            this.pendingUsableSlotIndex = null;
            this.selectedUsableEquipSlotIndex = null;
            this.inventorySlots.setBottomReservedHeight(0);
        });
        this.inventorySlots.setOnItemSelect((item, slotIndex, stackCount) => {
            if (this.suppressInventorySelection) return;
            if (slotIndex < 0) {
                this.inventoryDetails.setItem(null);
                this.inventorySlots.setBottomReservedHeight(0);
                this.pendingRodEquip = null;
                this.pendingRodSlotIndex = null;
                this.pendingUsableEquip = null;
                this.pendingUsableSlotIndex = null;
                this.selectedUsableEquipSlotIndex = null;
                return;
            }
            // Check if we're unequipping a rod from the equipment slot
            if (this.equipmentSlots.isSelected() && this.equipmentSlots.hasRodEquipped()) {
                if (this.isFishingActive()) {
                    this.equipmentSlots.clearSelection();
                    this.pendingRodEquip = null;
                    this.pendingRodSlotIndex = null;
                    return;
                }
                const targetPos = this.inventorySlots.getSlotScreenPosition(slotIndex);
                
                // Only unequip when clicking an empty inventory slot
                if (!item) {
                    const currentRod = this.equipmentSlots.getEquippedRod();
                    if (currentRod && this.placeItemInSlot(slotIndex, currentRod.id, 1)) {
                        this.equipmentSlots.unequipRod(targetPos ?? undefined);
                        this.equipmentSlots.clearSelection();
                        this.equippedRodId = null;
                        this.sendEquipmentState();
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

            if (this.selectedUsableEquipSlotIndex !== null) {
                if (this.isFishingActive()) {
                    this.selectedUsableEquipSlotIndex = null;
                    return;
                }
                const selectedUsable = this.equipmentSlots.getEquippedUsable(this.selectedUsableEquipSlotIndex);
                if (!item && selectedUsable) {
                    const targetPos = this.inventorySlots.getSlotScreenPosition(slotIndex);
                    if (this.placeItemInSlot(slotIndex, selectedUsable.id, 1)) {
                        this.equipmentSlots.unequipUsable(this.selectedUsableEquipSlotIndex, targetPos ?? undefined);
                        this.equippedUsableIds[this.selectedUsableEquipSlotIndex] = null;
                        this.sendEquipmentState();
                        this.updateInventoryDisplay();
                        this.inventoryDetails.setItem(null);
                        this.inventorySlots.setBottomReservedHeight(0);
                        this.pendingUsableEquip = null;
                        this.pendingUsableSlotIndex = null;
                        this.selectedUsableEquipSlotIndex = null;
                    }
                    return;
                }

                this.selectedUsableEquipSlotIndex = null;
            }
            
            // Normal inventory selection
            this.equipmentSlots.clearSelection();
            
            if (!item) {
                this.inventoryDetails.setItem(null);
                this.inventorySlots.setBottomReservedHeight(0);
                this.pendingRodEquip = null;
                this.pendingRodSlotIndex = null;
                this.pendingUsableEquip = null;
                this.pendingUsableSlotIndex = null;
                return;
            }
            
            // Check if this is a fishing rod
            if (this.getRodDefinition(item.id)) {
                this.pendingRodEquip = item;
                this.pendingRodSlotIndex = slotIndex;
                this.pendingUsableEquip = null;
                this.pendingUsableSlotIndex = null;
                window.dispatchEvent(new CustomEvent('guide:book:rod-selected', {
                    detail: {
                        itemId: item.id,
                        slotIndex
                    }
                }));
            } else if (this.getUsableDefinition(item.id)) {
                this.pendingUsableEquip = item;
                this.pendingUsableSlotIndex = slotIndex;
                this.pendingRodEquip = null;
                this.pendingRodSlotIndex = null;
                window.dispatchEvent(new CustomEvent('guide:book:food-selected', {
                    detail: {
                        itemId: item.id,
                        slotIndex
                    }
                }));
            } else {
                this.pendingRodEquip = null;
                this.pendingRodSlotIndex = null;
                this.pendingUsableEquip = null;
                this.pendingUsableSlotIndex = null;
            }
            
            this.inventorySlots.setBottomReservedHeight(this.inventoryDetails.getReservedHeight());
            const selectedDef = getItemDefinition(item.id);
            this.inventoryDetails.setItem({
                name: item.name,
                description: item.description,
                itemId: item.id,
                slotIndex,
                amount: stackCount ?? item.count,
                stackSize: item.stackSize,
                scoreText: (selectedDef?.foodScore ?? 0) > 0 ? `+${selectedDef?.foodScore ?? 0}` : undefined,
                rarity: selectedDef?.rarity
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

            const equipmentTarget = this.equipmentSlots.getSlotUnderPointer(pointer);
            if (equipmentTarget?.type === 'rod') {
                if (this.handleInventoryDragToRodSlot(fromIndex)) {
                    this.clearSelectionAfterDrag();
                    return true;
                }
                return false;
            }

            if (equipmentTarget?.type === 'usable' && equipmentTarget.usableIndex !== undefined) {
                if (this.handleInventoryDragToUsableSlot(fromIndex, equipmentTarget.usableIndex)) {
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
            if (this.isFishingActive()) {
                this.equipmentSlots.clearSelection();
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
                this.sendEquipmentState();
                window.dispatchEvent(new CustomEvent('guide:book:rod-equipped', {
                    detail: {
                        itemId: this.pendingRodEquip.id
                    }
                }));

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
                const selectedDef = getItemDefinition(currentRod.id);
                this.inventoryDetails.setItem({
                    name: currentRod.name,
                    description: currentRod.description,
                    itemId: currentRod.id,
                    slotIndex: -1,
                    amount: 1,
                    stackSize: currentRod.stackSize,
                    scoreText: undefined,
                    rarity: selectedDef?.rarity
                });
                this.inventorySlots.setBottomReservedHeight(this.inventoryDetails.getReservedHeight());
            }
        });

        this.equipmentSlots.setOnUsableSlotClick((slotIndex, currentItem) => {
            this.equipmentSlots.clearSelection();

            if (this.pendingUsableEquip && this.pendingUsableSlotIndex !== null) {
                const sourceIndex = this.pendingUsableSlotIndex;
                const sourcePos = this.inventorySlots.getSlotScreenPosition(sourceIndex);

                if (!this.removeItemFromSlot(sourceIndex, 1)) {
                    return;
                }

                if (currentItem) {
                    const restored = this.placeItemInSlot(sourceIndex, currentItem.id, 1) || this.placeItemInFirstEmptySlot(currentItem.id, 1);
                    if (!restored) {
                        this.placeItemInSlot(sourceIndex, this.pendingUsableEquip.id, 1);
                        return;
                    }
                }

                this.equipmentSlots.equipUsable(slotIndex, this.pendingUsableEquip, sourcePos ?? undefined);
                this.equippedUsableIds[slotIndex] = this.pendingUsableEquip.id;
                this.sendEquipmentState();
                window.dispatchEvent(new CustomEvent('guide:book:food-equipped', {
                    detail: {
                        itemId: this.pendingUsableEquip.id,
                        slotIndex
                    }
                }));

                this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
                this.inventoryDetails.setItem(null);
                this.inventorySlots.setBottomReservedHeight(0);
                this.pendingUsableEquip = null;
                this.pendingUsableSlotIndex = null;
                this.selectedUsableEquipSlotIndex = null;
                this.updateInventoryDisplay();
                return;
            }

            this.selectedUsableEquipSlotIndex = currentItem ? slotIndex : null;
            this.pendingRodEquip = null;
            this.pendingRodSlotIndex = null;
            this.pendingUsableEquip = null;
            this.pendingUsableSlotIndex = null;

            if (!currentItem) {
                this.inventoryDetails.setItem(null);
                this.inventorySlots.setBottomReservedHeight(0);
                return;
            }

            const selectedDef = getItemDefinition(currentItem.id);
            this.inventoryDetails.setItem({
                name: currentItem.name,
                description: currentItem.description,
                itemId: currentItem.id,
                slotIndex: -1,
                amount: 1,
                stackSize: currentItem.stackSize,
                scoreText: (selectedDef?.foodScore ?? 0) > 0 ? `+${selectedDef?.foodScore ?? 0}` : undefined,
                rarity: selectedDef?.rarity
            });
            this.inventorySlots.setBottomReservedHeight(this.inventoryDetails.getReservedHeight());
        });

        this.equipmentSlots.setOnRodSlotDragComplete((pointer) => {
            if (this.handleEquipmentDragToInventory(pointer)) {
                this.clearSelectionAfterDrag();
                return true;
            }
            return false;
        });

        this.equipmentSlots.setOnUsableSlotDragComplete((slotIndex, pointer) => {
            if (this.handleUsableDragToInventory(slotIndex, pointer)) {
                this.clearSelectionAfterDrag();
                return true;
            }
            return false;
        });

        this.createTabs();
        this.layout();
        this.setGuiInputEnabled(false);
        void this.refreshGlimmerbowl();
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
        this.coinBar.layout(rightPageLeftEdgeX, rightPageTopEdgeY, scale);
        this.equipmentSlots.layout(rightPageLeftEdgeX, rightPageTopEdgeY, this.pageHeight, scale);
        this.settingsTab.layout(leftPageLeftEdgeX, leftPageTopEdgeY, rightPageLeftEdgeX, rightPageTopEdgeY, this.pageHeight, scale);
        this.finbookTab.layout(leftPageLeftEdgeX, leftPageTopEdgeY, rightPageLeftEdgeX, rightPageTopEdgeY, this.pageHeight, scale);
        this.glimmerbowlTab.layout(leftPageLeftEdgeX, leftPageTopEdgeY, rightPageLeftEdgeX, rightPageTopEdgeY, this.pageHeight, scale);
        this.fishViewCard.layout();
    }

    private createTabs() {
        const tabKeys = this.getTabKeys();
        tabKeys.forEach((tabKey, index) => {
            const label = this.getTabLabel(tabKey);
            const active = index === 0;
            const tab = this.buildTab(tabKey, label, active);
            this.tabsContainer.add(tab.container);
            this.tabs.push(tab);
        });
    }

    private getTabKeys(): Array<'Inventory' | 'Finbook' | 'Glimmerbowl' | 'Settings'> {
        return this.glimmerbowlUnlocked
            ? ['Inventory', 'Finbook', 'Glimmerbowl', 'Settings']
            : ['Inventory', 'Finbook', 'Settings'];
    }

    private rebuildTabs() {
        this.tabs.forEach((tab) => {
            tab.img.removeAllListeners();
            if (this.scene.textures.exists(tab.textureKey)) {
                this.scene.textures.remove(tab.textureKey);
            }
            tab.container.destroy();
        });
        this.tabs = [];

        if (!this.glimmerbowlUnlocked && this.activeTabLabel === 'Glimmerbowl') {
            this.activeTabLabel = 'Inventory';
        }

        this.createTabs();
        this.layout();
        this.setActiveTab(this.activeTabLabel);
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

    private buildTab(key: 'Inventory' | 'Finbook' | 'Glimmerbowl' | 'Settings', label: string, active: boolean): TabItem {
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
        img.on('pointerdown', () => this.setActiveTab(key));

        return {
            key,
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
            this.drawBitmapText(ctx, label, textX, textY, textColor);
        }

        // Add the composited canvas as a texture
        if (this.scene.textures.exists(rtKey)) {
            this.scene.textures.remove(rtKey);
        }
        this.scene.textures.addCanvas(rtKey, canvas);

        return rtKey;
    }

    private setActiveTab(label: 'Inventory' | 'Finbook' | 'Glimmerbowl' | 'Settings') {
        if (label === 'Glimmerbowl' && !this.glimmerbowlUnlocked) {
            label = 'Inventory';
        }
        this.activeTabLabel = label;
        this.tabs.forEach((tab) => {
            const shouldBeActive = tab.key === label;
            if (tab.active === shouldBeActive) return;
            tab.active = shouldBeActive;
            this.updateTabTexture(tab);
        });
        const isInventory = label === 'Inventory';
        const isSettings = label === 'Settings';
        const isFinbook = label === 'Finbook';
        const isGlimmerbowl = label === 'Glimmerbowl';
        this.inventoryGroups.setVisible(isInventory);
        this.coinBar.setVisible(isInventory);
        this.equipmentSlots.setVisible(isInventory);
        this.settingsTab.setVisible(isSettings);
        this.finbookTab.setVisible(isFinbook);
        this.glimmerbowlTab.setVisible(isGlimmerbowl);
        if (isInventory) {
            this.inventoryGroups.setActiveGroup('All', true);
            this.refreshInventory();
            this.refreshMoney();
            this.inventorySlots.setBottomReservedHeight(0);
            this.pendingRodEquip = null;
        } else if (isGlimmerbowl) {
            this.refreshGlimmerbowl();
            this.inventorySlots.setVisible(false);
            this.inventoryDetails.setVisible(false);
            this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
            this.equipmentSlots.clearSelection();
            this.inventorySlots.setBottomReservedHeight(0);
            this.pendingRodEquip = null;
        } else {
            this.inventorySlots.setVisible(false);
            this.inventoryDetails.setVisible(false);
            this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
            this.equipmentSlots.clearSelection();
            this.inventorySlots.setBottomReservedHeight(0);
            this.pendingRodEquip = null;
            this.pendingUsableEquip = null;
            this.pendingUsableSlotIndex = null;
            this.selectedUsableEquipSlotIndex = null;
        }
    }

    private refreshTabLabels() {
        this.tabs.forEach((tab) => {
            tab.label = this.getTabLabel(tab.key);
            const textWidth = this.measureBitmapTextWidth(tab.label);
            tab.width = Math.max(this.tabMinWidth, textWidth + this.tabPaddingLeft + this.tabPaddingRight);
            this.updateTabTexture(tab);
        });

        this.layout();
    }

    private getTabLabel(tabKey: 'Inventory' | 'Finbook' | 'Glimmerbowl' | 'Settings') {
        if (tabKey === 'Inventory') return this.localeManager.t('settings.tab.inventory', undefined, 'Inventory');
        if (tabKey === 'Finbook') return this.localeManager.t('settings.tab.finbook', undefined, 'Finbook');
        if (tabKey === 'Glimmerbowl') return this.localeManager.t('settings.tab.glimmerbowl', undefined, 'Glimmerbowl');
        return this.localeManager.t('settings.tab.settings', undefined, 'Settings');
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

        this.applyInventoryUpdate(response.slots || [], response.equippedRodId ?? null, response.equippedUsableIds ?? []);
    }

    private async refreshGlimmerbowl() {
        const response = await this.networkManager.getGlimmerbowl();
        if (!response) return;
        this.applyGlimmerbowlUpdate(response.entries || [], Boolean(response.unlocked), Boolean(response.hasOwnedScar));
    }

    private async refreshMoney() {
        const response = await this.networkManager.getMoney();
        if (!response) return;
        this.applyMoneyUpdate(response.money);
    }

    private applyInventoryUpdate(slots: InventorySlot[], equippedRodId: string | null, equippedUsableIds?: Array<string | null>) {
        this.inventorySlotsData = slots;
        this.equippedRodId = equippedRodId;
        if (Array.isArray(equippedUsableIds)) {
            this.equippedUsableIds = Array.from({ length: DEFAULT_USABLE_EQUIP_SLOTS }, (_unused, index) => equippedUsableIds[index] ?? null);
        }
        this.glimmerbowlTab.setOwnedScars(this.getOwnedScars());
        this.updateInventoryDisplay();
        this.updateEquippedRodFromServer();
        this.updateEquippedUsablesFromServer();
    }

    private applyGlimmerbowlUpdate(entries: GlimmerbowlEntry[], unlocked: boolean, hasOwnedScar?: boolean) {
        const wasUnlocked = this.glimmerbowlUnlocked;
        this.glimmerbowlUnlocked = unlocked;
        if (wasUnlocked !== this.glimmerbowlUnlocked) {
            this.rebuildTabs();
        }
        this.glimmerbowlTab.setHasOwnedScar(Boolean(hasOwnedScar));
        this.glimmerbowlTab.setEntries(entries);
    }

    private applyMoneyUpdate(money: number) {
        this.coinBar.setMoney(money);
    }

    private openFishView(entry: GlimmerbowlEntry) {
        const fishDef = getItemDefinition(entry.itemId);
        if (!fishDef || fishDef.category !== 'Fish') return;
        const scarDef = entry.awakenedByScarId ? getItemDefinition(entry.awakenedByScarId) : null;
        this.hideBookForFishView();
        window.dispatchEvent(new CustomEvent('book:fish-view-changed', { detail: { isOpen: true } }));
        this.fishViewCard.open({
            entry,
            fishDef,
            fishName: getLocalizedItemName(fishDef.id, fishDef.name),
            fishDescription: getLocalizedItemDescription(fishDef.id, fishDef.description),
            scarDef,
            scarName: scarDef ? getLocalizedItemName(scarDef.id, scarDef.name) : undefined
        }, () => {
            window.dispatchEvent(new CustomEvent('book:fish-view-changed', { detail: { isOpen: false } }));
            if (!this.openState) return;
            this.showBookAfterFishView();
        });
    }

    private hideBookForFishView() {
        if (this.bookHiddenForFishView) return;
        this.bookHiddenForFishView = true;
        this.container.setVisible(false);
        this.setGuiInputEnabled(false);
    }

    private showBookAfterFishView() {
        this.bookHiddenForFishView = false;
        this.container.setVisible(true);
        this.setGuiInputEnabled(true);
        this.setActiveTab(this.activeTabLabel);
        this.layout();
    }

    private updateInventoryDisplay() {
        this.inventoryItems = this.inventorySlotsData
            .filter((slot) => Boolean(slot.itemId) && slot.count > 0)
            .map((slot) => {
                const def = slot.itemId ? getItemDefinition(slot.itemId) : null;
                if (!def) return null;
                const display: InventoryDisplayItem = {
                    id: def.id,
                    name: getLocalizedItemName(def.id, def.name),
                    description: getLocalizedItemDescription(def.id, def.description),
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
        const categories = this.getGroupCategories(group);

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
        this.inventorySlots.setSlots(slotsDisplay, showAll ? null : categories);
        const allowDetails = showAll
            || categories?.includes('Food')
            || categories?.includes('Tools');
        if (!allowDetails) {
            this.inventoryDetails.setItem(null);
            this.inventorySlots.setBottomReservedHeight(0);
        }
    }

    private getGroupCategories(group: GroupKey): ItemCategory[] | null {
        switch (group) {
            case 'Tools':
                return ['Tools'];
            case 'Food':
                return ['Food'];
            case 'Gear':
                return ['Treasure', 'Loot'];
            case 'Fishing':
                return ['Fish', 'Junk'];
            case 'All':
            default:
                return null;
        }
    }

    private getOwnedScars(): Array<{ itemId: string; count: number; name: string }> {
        const scarCounts = new Map<string, number>();
        this.inventorySlotsData.forEach((slot) => {
            if (!slot.itemId || slot.count <= 0) return;
            const def = getItemDefinition(slot.itemId);
            if (!def?.scar) return;
            scarCounts.set(def.id, (scarCounts.get(def.id) ?? 0) + slot.count);
        });
        return [...scarCounts.entries()].map(([itemId, count]) => {
            const def = getItemDefinition(itemId)!;
            return {
                itemId,
                count,
                name: getLocalizedItemName(itemId, def.name)
            };
        });
    }

    private getSlotByIndex(index: number): InventorySlot | undefined {
        return this.inventorySlotsData.find((slot) => slot.index === index);
    }

    private getRodDefinition(itemId: string): ItemDefinition | null {
        const def = getItemDefinition(itemId);
        if (!def) return null;
        if (!isRodItem(def)) return null;
        return def;
    }

    private getUsableDefinition(itemId: string): ItemDefinition | null {
        const def = getItemDefinition(itemId);
        if (!def) return null;
        if (!isEquippableUsableItem(def)) return null;
        return def;
    }

    private createDisplayItem(def: ItemDefinition, count: number): InventoryDisplayItem {
        return {
            id: def.id,
            name: getLocalizedItemName(def.id, def.name),
            description: getLocalizedItemDescription(def.id, def.description),
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
        if (this.isFishingActive()) return false;
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
        this.sendEquipmentState();
        this.updateInventoryDisplay();
        return true;
    }

    private handleInventoryDragToUsableSlot(sourceIndex: number, targetUsableSlotIndex: number): boolean {
        if (this.isFishingActive()) return false;
        const sourceSlot = this.getSlotByIndex(sourceIndex);
        if (!sourceSlot || !sourceSlot.itemId || sourceSlot.count <= 0) return false;

        const usableDef = this.getUsableDefinition(sourceSlot.itemId);
        if (!usableDef) return false;

        const currentUsable = this.equipmentSlots.getEquippedUsable(targetUsableSlotIndex);
        if (currentUsable) {
            sourceSlot.itemId = currentUsable.id;
            sourceSlot.count = 1;
        } else {
            sourceSlot.itemId = null;
            sourceSlot.count = 0;
        }

        this.persistInventorySlots();
        const display = this.createDisplayItem(usableDef, 1);
        this.equipmentSlots.equipUsable(targetUsableSlotIndex, display);
        this.equippedUsableIds[targetUsableSlotIndex] = display.id;
        this.sendEquipmentState();
        this.updateInventoryDisplay();
        return true;
    }

    private handleEquipmentDragToInventory(pointer: Phaser.Input.Pointer): boolean {
        if (this.isFishingActive()) return false;
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
            this.sendEquipmentState();
        } else {
            destSlot.itemId = currentRod.id;
            destSlot.count = 1;

            this.persistInventorySlots();
            this.equipmentSlots.unequipRod();
            this.equippedRodId = null;
            this.sendEquipmentState();
        }

        this.updateInventoryDisplay();
        return true;
    }

    private handleUsableDragToInventory(sourceUsableSlotIndex: number, pointer: Phaser.Input.Pointer): boolean {
        if (this.isFishingActive()) return false;
        const destIndex = this.inventorySlots.getSlotIndexAtPointer(pointer);
        if (destIndex === undefined) return false;

        const currentUsable = this.equipmentSlots.getEquippedUsable(sourceUsableSlotIndex);
        if (!currentUsable) return false;

        const destSlot = this.getSlotByIndex(destIndex);
        if (!destSlot) return false;

        if (destSlot.itemId) {
            const destUsableDef = this.getUsableDefinition(destSlot.itemId);
            if (!destUsableDef) return false;

            destSlot.itemId = currentUsable.id;
            destSlot.count = 1;

            this.persistInventorySlots();
            const display = this.createDisplayItem(destUsableDef, 1);
            this.equipmentSlots.equipUsable(sourceUsableSlotIndex, display);
            this.equippedUsableIds[sourceUsableSlotIndex] = display.id;
            this.sendEquipmentState();
        } else {
            destSlot.itemId = currentUsable.id;
            destSlot.count = 1;

            this.persistInventorySlots();
            this.equipmentSlots.unequipUsable(sourceUsableSlotIndex);
            this.equippedUsableIds[sourceUsableSlotIndex] = null;
            this.sendEquipmentState();
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
        this.pendingUsableEquip = null;
        this.pendingUsableSlotIndex = null;
        this.selectedUsableEquipSlotIndex = null;
    }

    private sendEquipmentState() {
        this.networkManager.sendEquippedRod(this.equippedRodId, this.equippedUsableIds);
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
            name: getLocalizedItemName(def.id, def.name),
            description: getLocalizedItemDescription(def.id, def.description),
            count: 1,
            stackSize: def.stackSize,
            iconKey: `item-${def.id}-18`,
            category: def.category
        };

        this.equipmentSlots.equipRod(display);
        this.equipmentSlots.clearSelection();
    }

    private updateEquippedUsablesFromServer() {
        this.equippedUsableIds.forEach((usableId, index) => {
            const currentUsable = this.equipmentSlots.getEquippedUsable(index);
            if (!usableId) {
                if (currentUsable) {
                    this.equipmentSlots.unequipUsable(index);
                }
                return;
            }

            if (currentUsable && currentUsable.id === usableId) {
                return;
            }

            const def = getItemDefinition(usableId);
            if (!def || !isEquippableUsableItem(def)) {
                return;
            }

            const display: InventoryDisplayItem = {
                id: def.id,
                name: getLocalizedItemName(def.id, def.name),
                description: getLocalizedItemDescription(def.id, def.description),
                count: 1,
                stackSize: def.stackSize,
                iconKey: `item-${def.id}-18`,
                category: def.category
            };

            this.equipmentSlots.equipUsable(index, display);
        });
    }

    private isFishingActive(): boolean {
        return this.scene.scene.isActive('FishingScene');
    }

    private drawBitmapText(
        ctx: CanvasRenderingContext2D,
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

        this.fontRenderer.drawText(tempCtx, text, 0, 0, { charGap: this.fontCharGap });

        tempCtx.globalCompositeOperation = 'source-in';
        tempCtx.fillStyle = color;
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        ctx.drawImage(tempCanvas, x, y);
    }

    private measureBitmapTextWidth(text: string): number {
        return this.fontRenderer.measureTextWidth(text, { charGap: this.fontCharGap });
    }

    open() {
        this.openState = true;
        this.container.setVisible(true);
        this.setGuiInputEnabled(true);
        // Refresh layout and tab state to ensure everything is positioned and visible
        this.layout();
        this.setActiveTab(this.activeTabLabel);
    }

    openToTab(tabLabel: 'Inventory' | 'Finbook' | 'Glimmerbowl' | 'Settings') {
        this.openState = true;
        this.container.setVisible(true);
        this.setGuiInputEnabled(true);
        this.layout();
        this.setActiveTab(tabLabel);
    }

    close() {
        this.openState = false;
        if (this.fishViewCard.isOpen()) {
            this.fishViewCard.close();
            window.dispatchEvent(new CustomEvent('book:fish-view-changed', { detail: { isOpen: false } }));
        }
        this.bookHiddenForFishView = false;
        this.container.setVisible(false);
        this.inventoryGroups.setVisible(false);
        this.inventorySlots.setVisible(false);
        this.inventoryDetails.setVisible(false);
        this.coinBar.setVisible(false);
        this.equipmentSlots.setVisible(false);
        this.settingsTab.setVisible(false);
        this.finbookTab.setVisible(false);
        this.glimmerbowlTab.setVisible(false);
        this.withSuppressedInventorySelection(() => this.inventorySlots.clearSelection());
        this.equipmentSlots.clearSelection();
        this.inventorySlots.setBottomReservedHeight(0);
        this.pendingRodEquip = null;
        this.pendingRodSlotIndex = null;
        this.pendingUsableEquip = null;
        this.pendingUsableSlotIndex = null;
        this.selectedUsableEquipSlotIndex = null;
        this.setGuiInputEnabled(false);
    }

    private setGuiInputEnabled(enabled: boolean) {
        this.setContainerInputEnabled(this.container, enabled);
    }

    private setContainerInputEnabled(container: Phaser.GameObjects.Container, enabled: boolean) {
        const children = container.list as Phaser.GameObjects.GameObject[];
        for (const child of children) {
            const inputHost = child as any;
            if (inputHost.input) {
                inputHost.input.enabled = enabled;
            }
            if (child instanceof Phaser.GameObjects.Container) {
                this.setContainerInputEnabled(child, enabled);
            }
        }
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

    getGuideRodInventoryRect(): Phaser.Geom.Rectangle | null {
        const rodSlot = this.inventorySlotsData.find((slot) => {
            if (!slot.itemId || slot.count <= 0) return false;
            const def = getItemDefinition(slot.itemId);
            if (!def) return false;
            return def.category === 'Tools' && def.id.includes('rod');
        });
        if (!rodSlot) return null;
        return this.inventorySlots.getSlotScreenRect(rodSlot.index);
    }

    getGuideEquippedRodRect(): Phaser.Geom.Rectangle | null {
        return this.equipmentSlots.getRodSlotScreenRect();
    }

    getGuideFoodInventoryRect(itemId: string): Phaser.Geom.Rectangle | null {
        if (!itemId) return null;
        const slot = this.inventorySlotsData.find((entry) => entry.itemId === itemId && entry.count > 0);
        if (!slot) return null;
        return this.inventorySlots.getSlotScreenRect(slot.index);
    }

    getGuideFoodScoreRect(): Phaser.Geom.Rectangle | null {
        return this.inventoryDetails.getScoreScreenRect();
    }

    getGuideUsableEquipRect(slotIndex: number): Phaser.Geom.Rectangle | null {
        return this.equipmentSlots.getUsableSlotScreenRect(slotIndex);
    }

    destroy() {
        if (this.fishViewCard?.isOpen()) {
            window.dispatchEvent(new CustomEvent('book:fish-view-changed', { detail: { isOpen: false } }));
        }
        if (this.inventoryUpdateHandler) {
            window.removeEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
            this.inventoryUpdateHandler = undefined;
        }
        if (this.moneyUpdateHandler) {
            window.removeEventListener('money:update', this.moneyUpdateHandler as EventListener);
            this.moneyUpdateHandler = undefined;
        }
        if (this.glimmerbowlUpdateHandler) {
            window.removeEventListener('glimmerbowl:update', this.glimmerbowlUpdateHandler as EventListener);
            this.glimmerbowlUpdateHandler = undefined;
        }
        if (this.localeChangedHandler) {
            window.removeEventListener('locale:changed', this.localeChangedHandler as EventListener);
            this.localeChangedHandler = undefined;
        }
        this.inventoryGroups?.destroy();
        this.inventorySlots?.destroy();
        this.coinBar?.destroy();
        this.equipmentSlots?.destroy();
        this.inventoryDetails?.destroy();
        this.settingsTab?.destroy();
        this.finbookTab?.destroy();
        this.glimmerbowlTab?.destroy();
        this.fishViewCard?.destroy();
        this.tabs.forEach((tab) => {
            if (this.scene.textures.exists(tab.textureKey)) {
                this.scene.textures.remove(tab.textureKey);
            }
        });
        this.container.destroy();
    }
}
