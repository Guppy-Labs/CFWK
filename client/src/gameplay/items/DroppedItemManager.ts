import Phaser from 'phaser';
import { getItemDefinition } from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';
import { getLocalizedItemName } from '../i18n/itemLocale';
import type { OcclusionManager } from '../map/OcclusionManager';
import { DepthManager, DROPPED_ITEM_BASE, ENTITY_BASE, NAMEPLATE_OFFSET } from '../rendering/DepthManager';

export type DroppedItemData = {
    id: string;
    itemId: string;
    amount: number;
    x: number;
    y: number;
    createdAt: number;
};

export type DroppedItemEntity = DroppedItemData & {
    sprite: Phaser.GameObjects.Sprite;
};

type DropClusterRow = {
    itemId: string;
    amount: number;
    droppedItemIds: string[];
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

    constructor(scene: Phaser.Scene, config: DroppedItemManagerConfig) {
        this.scene = scene;
        this.config = config;
    }

    initialize() {
        const room = this.networkManager.getRoom();
        if (!room || !room.state?.droppedItems) return;

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
            this.clearDropCards();
            return;
        }

        const nearbyClusters = this.buildNearbyClusters(localX, localY);
        this.syncDropCards(nearbyClusters);
    }

    destroy() {
        this.items.forEach((entity) => entity.sprite.destroy());
        this.items.clear();
        this.clearDropCards();
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
            existing.sprite.setPosition(item.x, item.y);
            if (itemIdChanged) {
                const textureKey = `item-${item.itemId}`;
                const resolvedKey = this.scene.textures.exists(textureKey) ? textureKey : 'ui-slot-base';
                existing.sprite.setTexture(resolvedKey, 0);
                this.applyItemScale(existing.sprite, resolvedKey);
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

        // Isometric "flat" look
        this.applyItemScale(sprite, resolvedKey);
        sprite.setOrigin(0.5, 0.75);

        this.updateDepth({
            id: item.id ?? '',
            itemId: item.itemId,
            amount: item.amount,
            x: item.x,
            y: item.y,
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
                        droppedItemIds: [member.id]
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
            const itemName = getLocalizedItemName(row.itemId, getItemDefinition(row.itemId)?.name ?? row.itemId);
            const amountSuffix = row.amount > 1 ? ` x${row.amount}` : '';
            const content = `${itemName}${amountSuffix}`;
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

        const uniqueIds = Array.from(new Set(row.droppedItemIds));
        uniqueIds.forEach((droppedItemId) => {
            if (this.items.has(droppedItemId)) {
                this.networkManager.sendPickupItem(droppedItemId);
            }
        });
    }

    private clearDropCards() {
        this.dropCards.forEach((card) => card.container.destroy());
        this.dropCards.clear();
    }

    private getClusterSignature(cluster: DropCluster): string {
        return cluster.rows
            .map((row) => `${row.itemId}:${row.amount}:${row.droppedItemIds.slice().sort((a, b) => a.localeCompare(b)).join(',')}`)
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
            case 'ultimate': return '#8fd7ff';
            case 'common':
            default:
                return '#ffffff';
        }
    }
}
