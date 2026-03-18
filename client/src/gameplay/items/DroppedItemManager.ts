import Phaser from 'phaser';
import { getItemDefinition } from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';
import { getLocalizedItemName } from '../i18n/itemLocale';
import { LocaleManager } from '../i18n/LocaleManager';
import type { IInventoryResponse } from '@cfwk/shared';
import type { OcclusionManager } from '../map/OcclusionManager';
import { DepthManager, ENTITY_BASE, NAMEPLATE_OFFSET } from '../rendering/DepthManager';
import { ItemTextureLoader } from '../assets/ItemTextureLoader';

export type DroppedItemData = {
    id: string;
    itemId: string;
    amount: number;
    x: number;
    y: number;
    createdAt: number;
    liquidContainerItemId?: string;
    liquidOutputItemId?: string;
    liquidConfirmText?: string;
};

export type DroppedItemEntity = DroppedItemData & {
    sprite: Phaser.GameObjects.Sprite;
};

type DropClusterRow = {
    itemId: string;
    amount: number;
    droppedItemIds: string[];
    liquidContainerItemId?: string;
    liquidOutputItemId?: string;
    liquidConfirmText?: string;
};

type DropCluster = {
    key: string;
    x: number;
    y: number;
    anchorX: number;
    anchorY: number;
    rows: DropClusterRow[];
    alpha: number;
};

type DropClusterCard = {
    container: Phaser.GameObjects.Container;
    signature: string;
};

export type DroppedItemManagerConfig = {
    occlusionManager?: OcclusionManager;
    depthManager?: DepthManager;
    baseDepth: number;
};

export class DroppedItemManager {
    private scene: Phaser.Scene;
    private config: DroppedItemManagerConfig;
    private networkManager = NetworkManager.getInstance();
    private localeManager = LocaleManager.getInstance();
    private itemTextureLoader = ItemTextureLoader.getInstance();
    private items: Map<string, DroppedItemEntity> = new Map();
    private readonly fadeStartMs = 4 * 60 * 1000;
    private readonly fadeEndMs = 5 * 60 * 1000;
    private readonly fadeEndAlpha = 0.4;
    private readonly pickupNearbyDistance = 42;
    private readonly clusterMergeDistance = 42;
    private readonly singleCardAnchorYOffset = -16;
    private readonly cardBgColor = 0x000000;
    private readonly cardBgAlpha = 0.18;
    private readonly cardBaseAlpha = 0.68;
    private readonly cardTextAlpha = 0.7;
    private readonly cardTextFontSize = '5px';
    private readonly cardTextFontFamily = 'Minecraft, monospace';
    private dropCards: Map<string, DropClusterCard> = new Map();
    private inventorySnapshot: IInventoryResponse | null = null;
    private inventoryUpdateHandler?: (event: Event) => void;
    private lastLocalPosition: { x: number; y: number } | null = null;
    private pendingLiquidConfirmRowKey: string | null = null;
    private pendingLiquidConfirmTimeoutHandle?: number;

    constructor(scene: Phaser.Scene, config: DroppedItemManagerConfig) {
        this.scene = scene;
        this.config = config;
    }

    initialize() {
        const room = this.networkManager.getRoom();
        if (!room || !room.state?.droppedItems) return;

        this.inventoryUpdateHandler = (event: Event) => {
            this.inventorySnapshot = (event as CustomEvent<IInventoryResponse>).detail ?? null;
            this.refreshNearbyCards();
        };
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);

        room.state.droppedItems.forEach((item: any, itemId: string) => {
            this.addItemFromState(item, itemId);
        });

        room.state.droppedItems.onAdd((item: any, itemId: string) => {
            this.addItemFromState(item, itemId);
        });

        room.state.droppedItems.onRemove((_item: any, itemId: string) => {
            const existing = this.items.get(itemId);
            if (existing) {
                existing.sprite.destroy();
                this.items.delete(itemId);
            }
        });
    }

    getItems(): Map<string, DroppedItemEntity> {
        return this.items;
    }

    update(localX?: number, localY?: number) {
        this.items.forEach((entity) => {
            this.applyItemAlpha(entity);
        });

        if (!Number.isFinite(localX) || !Number.isFinite(localY)) {
            this.lastLocalPosition = null;
            this.clearDropCards();
            return;
        }
        this.lastLocalPosition = { x: localX as number, y: localY as number };

        const nearbyClusters = this.buildNearbyClusters(localX as number, localY as number);
        this.syncDropCards(nearbyClusters);
    }

    destroy() {
        this.items.forEach((entity) => entity.sprite.destroy());
        this.items.clear();
        this.clearDropCards();
        if (this.inventoryUpdateHandler) {
            window.removeEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
            this.inventoryUpdateHandler = undefined;
        }
        if (this.pendingLiquidConfirmTimeoutHandle) {
            window.clearTimeout(this.pendingLiquidConfirmTimeoutHandle);
            this.pendingLiquidConfirmTimeoutHandle = undefined;
        }
        this.pendingLiquidConfirmRowKey = null;
    }

    private addItemFromState(item: any, itemId: string) {
        if (this.items.has(itemId)) return;
        const sprite = this.createItemSprite(item);
        const entity: DroppedItemEntity = {
            id: itemId,
            itemId: item.itemId,
            amount: item.amount,
            x: item.x,
            y: item.y,
            createdAt: item.createdAt ?? Date.now(),
            liquidContainerItemId: typeof item.liquidContainerItemId === 'string' ? item.liquidContainerItemId : undefined,
            liquidOutputItemId: typeof item.liquidOutputItemId === 'string' ? item.liquidOutputItemId : undefined,
            liquidConfirmText: typeof item.liquidConfirmText === 'string' ? item.liquidConfirmText : undefined,
            sprite
        };

        this.items.set(itemId, entity);

        item.onChange(() => {
            const existing = this.items.get(itemId);
            if (!existing) return;
            const itemIdChanged = existing.itemId !== item.itemId;
            existing.itemId = item.itemId;
            existing.amount = item.amount;
            existing.x = item.x;
            existing.y = item.y;
            existing.createdAt = item.createdAt ?? existing.createdAt;
            existing.liquidContainerItemId = typeof item.liquidContainerItemId === 'string' ? item.liquidContainerItemId : undefined;
            existing.liquidOutputItemId = typeof item.liquidOutputItemId === 'string' ? item.liquidOutputItemId : undefined;
            existing.liquidConfirmText = typeof item.liquidConfirmText === 'string' ? item.liquidConfirmText : undefined;
            existing.sprite.setPosition(item.x, item.y);
            if (itemIdChanged) {
                const textureKey = `item-${item.itemId}`;
                const resolvedKey = this.scene.textures.exists(textureKey) ? textureKey : 'ui-slot-base';
                existing.sprite.setTexture(resolvedKey, 0);
                this.applyItemScale(existing.sprite, resolvedKey);
                if (resolvedKey === 'ui-slot-base') {
                    void this.itemTextureLoader.ensureItemTexture(this.scene, item.itemId).then((loadedKey) => {
                        if (!loadedKey) return;
                        const latest = this.items.get(itemId);
                        if (!latest || latest.itemId !== item.itemId) return;
                        latest.sprite.setTexture(loadedKey, 0);
                        this.applyItemScale(latest.sprite, loadedKey);
                    });
                }
            }
            this.applyItemAlpha(existing);
            this.updateDepth(existing);
        });

        this.applyItemAlpha(entity);
    }

    private createItemSprite(item: any): Phaser.GameObjects.Sprite {
        const textureKey = `item-${item.itemId}`;
        const resolvedKey = this.scene.textures.exists(textureKey) ? textureKey : 'ui-slot-base';
        const sprite = this.scene.add.sprite(item.x, item.y, resolvedKey, 0);
        if (resolvedKey === 'ui-slot-base') {
            void this.itemTextureLoader.ensureItemTexture(this.scene, item.itemId).then((loadedKey) => {
                if (!loadedKey) return;
                if (!sprite.active) return;
                sprite.setTexture(loadedKey, 0);
                this.applyItemScale(sprite, loadedKey);
            });
        }

        // Isometric "flat" look
        this.applyItemScale(sprite, resolvedKey);
        sprite.setOrigin(0.5, 0.75);

        this.updateDepth({
            id: item.id ?? '',
            itemId: item.itemId,
            amount: item.amount,
            x: item.x,
            y: item.y,
            createdAt: item.createdAt ?? Date.now(),
            liquidContainerItemId: typeof item.liquidContainerItemId === 'string' ? item.liquidContainerItemId : undefined,
            liquidOutputItemId: typeof item.liquidOutputItemId === 'string' ? item.liquidOutputItemId : undefined,
            liquidConfirmText: typeof item.liquidConfirmText === 'string' ? item.liquidConfirmText : undefined,
            sprite
        });

        return sprite;
    }

    private applyItemScale(sprite: Phaser.GameObjects.Sprite, textureKey: string) {
        const texture = this.scene.textures.get(textureKey);
        const source = texture.getSourceImage() as HTMLImageElement | undefined;
        const width = source?.width ?? 32;
        const height = source?.height ?? 32;
        const baseScaleX = 0.25;
        const baseScaleY = 0.15;
        const scaleX = baseScaleX * (32 / Math.max(1, width));
        const scaleY = baseScaleY * (32 / Math.max(1, height));
        sprite.setScale(scaleX, scaleY);
    }

    private updateDepth(item: DroppedItemEntity) {
        if (this.config.depthManager) {
            item.sprite.setDepth(this.config.depthManager.entityDepth(item.x, item.y, { baseDepth: this.config.baseDepth }));
        } else {
            item.sprite.setDepth(this.config.baseDepth + item.y * 0.01);
        }
    }

    private applyItemAlpha(item: DroppedItemEntity) {
        const ageMs = Date.now() - item.createdAt;
        let alpha = 1;
        if (ageMs >= this.fadeStartMs) {
            const t = Phaser.Math.Clamp((ageMs - this.fadeStartMs) / (this.fadeEndMs - this.fadeStartMs), 0, 1);
            alpha = Phaser.Math.Linear(1, this.fadeEndAlpha, t);
        }
        item.sprite.setAlpha(alpha);
    }

    private buildNearbyClusters(localX: number, localY: number): DropCluster[] {
        const nearbyItems: DroppedItemEntity[] = [];
        this.items.forEach((item) => {
            const distance = Math.hypot(item.x - localX, item.y - localY);
            if (distance <= this.pickupNearbyDistance) {
                nearbyItems.push(item);
            }
        });

        if (nearbyItems.length === 0) return [];

        type WorkingCluster = {
            members: DroppedItemEntity[];
            centroidX: number;
            centroidY: number;
        };

        const clusters: WorkingCluster[] = [];
        nearbyItems.sort((a, b) => a.y - b.y || a.x - b.x);

        nearbyItems.forEach((item) => {
            let bestCluster: WorkingCluster | undefined;
            let bestDistance = Infinity;

            for (const cluster of clusters) {
                const d = Math.hypot(item.x - cluster.centroidX, item.y - cluster.centroidY);
                if (d <= this.clusterMergeDistance && d < bestDistance) {
                    bestCluster = cluster;
                    bestDistance = d;
                }
            }

            if (!bestCluster) {
                clusters.push({
                    members: [item],
                    centroidX: item.x,
                    centroidY: item.y
                });
                return;
            }

            bestCluster.members.push(item);
            const count = bestCluster.members.length;
            bestCluster.centroidX = ((bestCluster.centroidX * (count - 1)) + item.x) / count;
            bestCluster.centroidY = ((bestCluster.centroidY * (count - 1)) + item.y) / count;
        });

        return clusters.map((cluster) => {
            const byItemId = new Map<string, DropClusterRow>();
            let alpha = 1;

            cluster.members.forEach((member) => {
                const existing = byItemId.get(member.itemId);
                if (existing) {
                    existing.amount += member.amount;
                    existing.droppedItemIds.push(member.id);
                } else {
                    byItemId.set(member.itemId, {
                        itemId: member.itemId,
                        amount: member.amount,
                        droppedItemIds: [member.id],
                        liquidContainerItemId: member.liquidContainerItemId,
                        liquidOutputItemId: member.liquidOutputItemId,
                        liquidConfirmText: member.liquidConfirmText
                    });
                }
                alpha = Math.min(alpha, member.sprite.alpha);
            });

            const sortedMemberIds = cluster.members
                .map((member) => member.id)
                .sort((a, b) => a.localeCompare(b));

            const anchorCount = Math.max(1, cluster.members.length);
            const anchorX = cluster.members.reduce((sum, member) => sum + member.x, 0) / anchorCount;
            const anchorY = cluster.members.reduce((sum, member) => sum + member.y + this.singleCardAnchorYOffset, 0) / anchorCount;

            return {
                key: sortedMemberIds.join('|'),
                x: cluster.centroidX,
                y: cluster.centroidY,
                anchorX,
                anchorY,
                rows: Array.from(byItemId.values()),
                alpha
            };
        });
    }

    private syncDropCards(clusters: DropCluster[]) {
        const keepKeys = new Set<string>();

        clusters.forEach((cluster) => {
            keepKeys.add(cluster.key);
            const signature = this.getClusterSignature(cluster);
            const existing = this.dropCards.get(cluster.key);

            if (!existing || existing.signature !== signature) {
                existing?.container.destroy();
                const container = this.createDropCard(cluster);
                this.dropCards.set(cluster.key, { container, signature });
                return;
            }

            this.updateDropCard(existing.container, cluster);
        });

        this.dropCards.forEach((card, key) => {
            if (keepKeys.has(key)) return;
            card.container.destroy();
            this.dropCards.delete(key);
        });
    }

    private createDropCard(cluster: DropCluster): Phaser.GameObjects.Container {
        const container = this.scene.add.container(0, 0);

        const rowPaddingX = 1;
        const rowPaddingY = 0;
        const rowGap = 0;
        const rowTexts: Phaser.GameObjects.Text[] = [];
        const rowRows = cluster.rows.map((row) => {
            const content = this.getRowDisplayLabel(row);
            const text = this.scene.add.text(0, 0, content, {
                fontSize: this.cardTextFontSize,
                fontFamily: this.cardTextFontFamily,
                color: this.getRarityColorHex(row.itemId),
                resolution: 2
            }).setOrigin(0, 0.5);
            text.setAlpha(this.cardTextAlpha);
            rowTexts.push(text);
            return { row, text };
        });

        const maxTextWidth = rowTexts.reduce((max, text) => Math.max(max, text.width), 10);
        const rowHeight = Math.max(6, (rowTexts[0]?.height ?? 5) + (rowPaddingY * 2));
        const cardWidth = maxTextWidth + rowPaddingX * 2;
        const cardHeight = (rowRows.length * rowHeight) + (Math.max(0, rowRows.length - 1) * rowGap);

        const bg = this.scene.add.graphics();
        bg.fillStyle(this.cardBgColor, this.cardBgAlpha);
        bg.fillRect(0, 0, cardWidth, cardHeight);
        container.add(bg);

        let cursorY = 0;
        rowRows.forEach(({ row, text }) => {
            const hitZone = this.scene.add.rectangle(0, cursorY, cardWidth, rowHeight, 0x000000, 0.001)
                .setOrigin(0, 0)
                .setInteractive({ useHandCursor: true });

            hitZone.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
                event.stopPropagation();
                this.pickupDropRow(row);
            });

            text.setPosition(rowPaddingX, cursorY + Math.floor(rowHeight / 2));
            container.add(hitZone);
            container.add(text);

            cursorY += rowHeight + rowGap;
        });

        container.setSize(cardWidth, cardHeight);

        this.updateDropCard(container, cluster);
        return container;
    }

    private updateDropCard(container: Phaser.GameObjects.Container, cluster: DropCluster) {
        const cardWidth = container.width || 0;
        const cardHeight = container.height || 0;
        container.setPosition(
            cluster.anchorX - (cardWidth / 2),
            cluster.anchorY - (cardHeight / 2)
        );
        container.setAlpha(cluster.alpha * this.cardBaseAlpha);

        if (this.config.depthManager) {
            container.setDepth(this.config.depthManager.entityDepth(cluster.anchorX, cluster.anchorY, { baseDepth: ENTITY_BASE + NAMEPLATE_OFFSET - 10 }));
            return;
        }

        container.setDepth(ENTITY_BASE + NAMEPLATE_OFFSET - 10 + (cluster.anchorY * 0.01));
    }

    private pickupDropRow(row: DropClusterRow) {
        const chatFocused = this.scene.registry.get('chatFocused') === true;
        const guiOpen = this.scene.registry.get('guiOpen') === true;
        const transitionBlocked = this.scene.registry.get('inputBlocked') === true;
        if (chatFocused || guiOpen || transitionBlocked) return;

        const rowKey = this.getRowKey(row);
        const isLiquidRow = Boolean(row.liquidContainerItemId && row.liquidOutputItemId);
        if (isLiquidRow) {
            const requiredContainer = row.liquidContainerItemId as string;
            if (!this.hasInventoryItem(requiredContainer)) {
                this.resetPendingLiquidConfirmation();
                this.refreshNearbyCards();
                return;
            }

            if (this.pendingLiquidConfirmRowKey !== rowKey) {
                this.pendingLiquidConfirmRowKey = rowKey;
                if (this.pendingLiquidConfirmTimeoutHandle) {
                    window.clearTimeout(this.pendingLiquidConfirmTimeoutHandle);
                }
                this.pendingLiquidConfirmTimeoutHandle = window.setTimeout(() => {
                    this.pendingLiquidConfirmTimeoutHandle = undefined;
                    this.pendingLiquidConfirmRowKey = null;
                    this.refreshNearbyCards();
                }, 4000);
                this.refreshNearbyCards();
                return;
            }

            this.resetPendingLiquidConfirmation();
        }

        const uniqueIds = Array.from(new Set(row.droppedItemIds));
        uniqueIds.forEach((droppedItemId) => {
            if (this.items.has(droppedItemId)) {
                this.networkManager.sendPickupItem(droppedItemId);
            }
        });
    }

    private hasInventoryItem(itemId: string): boolean {
        const inventory = this.inventorySnapshot;
        if (!inventory?.slots || !itemId) return false;
        return inventory.slots.some((slot) => slot.itemId === itemId && slot.count > 0);
    }

    private getRowKey(row: DropClusterRow): string {
        return `${row.itemId}:${row.droppedItemIds.slice().sort((a, b) => a.localeCompare(b)).join(',')}`;
    }

    private getRowDisplayLabel(row: DropClusterRow): string {
        const itemName = getLocalizedItemName(row.itemId, getItemDefinition(row.itemId)?.name ?? row.itemId);
        const amountSuffix = row.amount > 1 ? ` x${row.amount}` : '';
        const isLiquidRow = Boolean(row.liquidContainerItemId && row.liquidOutputItemId);
        if (!isLiquidRow) {
            return `${itemName}${amountSuffix}`;
        }

        const requiredContainer = row.liquidContainerItemId as string;
        const rowKey = this.getRowKey(row);
        if (!this.hasInventoryItem(requiredContainer)) {
            const localizedContainer = getLocalizedItemName(requiredContainer, requiredContainer);
            return this.localeManager.t(
                'drops.needContainerToCollect',
                { container: localizedContainer },
                `Need ${localizedContainer} to collect`
            );
        }

        if (this.pendingLiquidConfirmRowKey === rowKey) {
            return row.liquidConfirmText?.trim()
                || this.localeManager.t('drops.confirmConsumeJar', undefined, 'Confirm Consuming 1 Jar');
        }

        return `${itemName}${amountSuffix}`;
    }

    private resetPendingLiquidConfirmation() {
        if (this.pendingLiquidConfirmTimeoutHandle) {
            window.clearTimeout(this.pendingLiquidConfirmTimeoutHandle);
            this.pendingLiquidConfirmTimeoutHandle = undefined;
        }
        this.pendingLiquidConfirmRowKey = null;
    }

    private refreshNearbyCards() {
        if (!this.lastLocalPosition) return;
        const clusters = this.buildNearbyClusters(this.lastLocalPosition.x, this.lastLocalPosition.y);
        this.syncDropCards(clusters);
    }

    private clearDropCards() {
        this.dropCards.forEach((card) => card.container.destroy());
        this.dropCards.clear();
    }

    private getClusterSignature(cluster: DropCluster): string {
        return cluster.rows
            .map((row) => {
                const rowIds = row.droppedItemIds.slice().sort((a, b) => a.localeCompare(b)).join(',');
                const container = row.liquidContainerItemId ?? '';
                const output = row.liquidOutputItemId ?? '';
                const label = this.getRowDisplayLabel(row);
                return `${row.itemId}:${row.amount}:${rowIds}:${container}:${output}:${label}`;
            })
            .sort((a, b) => a.localeCompare(b))
            .join('|');
    }

    private getRarityColorHex(itemId: string): string {
        const rarity = (getItemDefinition(itemId)?.rarity ?? 'common').toLowerCase();
        switch (rarity) {
            case 'uncommon': return '#b7ff63';
            case 'rare': return '#8fd7ff';
            case 'epic': return '#d2a3ff';
            case 'legendary': return '#ffbf52';
            case 'mythic': return '#ff7fd1';
            case 'divine': return '#8fd7ff';
            case 'supreme': return '#ff5f5f';
            case 'common':
            default:
                return '#ffffff';
        }
    }
}
