import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager';
import { OcclusionManager } from '../map/OcclusionManager';
import { getOcclusionAdjustedDepth } from '../player/PlayerVisualUtils';

export type DroppedItemData = {
    id: string;
    itemId: string;
    amount: number;
    x: number;
    y: number;
};

export type DroppedItemEntity = DroppedItemData & {
    sprite: Phaser.GameObjects.Sprite;
};

export type DroppedItemManagerConfig = {
    occlusionManager?: OcclusionManager;
    baseDepth: number;
};

export class DroppedItemManager {
    private scene: Phaser.Scene;
    private config: DroppedItemManagerConfig;
    private networkManager = NetworkManager.getInstance();
    private items: Map<string, DroppedItemEntity> = new Map();

    constructor(scene: Phaser.Scene, config: DroppedItemManagerConfig) {
        this.scene = scene;
        this.config = config;
    }

    initialize() {
        const room = this.networkManager.getRoom();
        if (!room || !room.state?.droppedItems) return;

        room.state.droppedItems.onAdd((item: any, itemId: string) => {
            const sprite = this.createItemSprite(item);
            const entity: DroppedItemEntity = {
                id: itemId,
                itemId: item.itemId,
                amount: item.amount,
                x: item.x,
                y: item.y,
                sprite
            };

            this.items.set(itemId, entity);

            item.onChange(() => {
                const existing = this.items.get(itemId);
                if (!existing) return;
                existing.itemId = item.itemId;
                existing.amount = item.amount;
                existing.x = item.x;
                existing.y = item.y;
                existing.sprite.setPosition(item.x, item.y);
                this.updateDepth(existing);
            });
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

    destroy() {
        this.items.forEach((entity) => entity.sprite.destroy());
        this.items.clear();
    }

    private createItemSprite(item: any): Phaser.GameObjects.Sprite {
        const textureKey = `item-${item.itemId}`;
        const resolvedKey = this.scene.textures.exists(textureKey) ? textureKey : 'ui-slot-base';
        const sprite = this.scene.add.sprite(item.x, item.y, resolvedKey, 0);

        // Isometric "flat" look
        sprite.setScale(0.25, 0.15);
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

    private updateDepth(item: DroppedItemEntity) {
        const depth = getOcclusionAdjustedDepth(
            this.config.occlusionManager,
            item.x,
            item.y,
            this.config.baseDepth,
            true
        );
        item.sprite.setDepth(depth);
    }
}
