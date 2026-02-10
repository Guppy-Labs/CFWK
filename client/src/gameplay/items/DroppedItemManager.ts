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
    createdAt: number;
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
    private readonly fadeStartMs = 4 * 60 * 1000;
    private readonly fadeEndMs = 5 * 60 * 1000;
    private readonly fadeEndAlpha = 0.4;

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

    update() {
        this.items.forEach((entity) => {
            this.applyItemAlpha(entity);
        });
    }

    destroy() {
        this.items.forEach((entity) => entity.sprite.destroy());
        this.items.clear();
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
        const depth = getOcclusionAdjustedDepth(
            this.config.occlusionManager,
            item.x,
            item.y,
            this.config.baseDepth,
            true
        );
        item.sprite.setDepth(depth);
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
}
