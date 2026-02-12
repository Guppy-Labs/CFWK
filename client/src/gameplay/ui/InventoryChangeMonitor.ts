import Phaser from 'phaser';
import { IInventoryResponse, InventorySlot, getItemDefinition } from '@cfwk/shared';
import { AudioManager } from '../audio/AudioManager';

type IndicatorType = 'entry' | 'exit' | 'skip';

type InventoryIndicator = {
    type: IndicatorType;
    itemId: string;
    quantity: number;
    container: Phaser.GameObjects.Container;
    background: Phaser.GameObjects.Graphics;
    text: Phaser.GameObjects.Text;
    timer?: Phaser.Time.TimerEvent;
};

type InventorySkipPayload = {
    itemId: string;
    quantity?: number;
};

export class InventoryChangeMonitor {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private indicators: InventoryIndicator[] = [];
    private previousCounts?: Map<string, number>;
    private inventoryUpdateHandler?: (event: Event) => void;
    private inventorySkipHandler?: (event: Event) => void;
    private debugGraphics?: Phaser.GameObjects.Graphics;
    private debugVisible = false;
    private pendingExits = new Map<string, { quantity: number; timer: Phaser.Time.TimerEvent }>();

    private readonly maxVisible = 5;
    private readonly indicatorWidth = 240;
    private readonly indicatorHeight = 22;
    private readonly indicatorGap = 6;
    private readonly paddingX = 10;
    private readonly rightMargin = 0;
    private readonly topOffset = 220;
    private readonly slideOffset = 26;
    private readonly visibleDurationMs = 5000;
    private readonly depth = 9500;
    private readonly exitDebounceMs = 250;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.container = this.scene.add.container(0, 0);
        this.container.setDepth(this.depth);
        this.container.setScrollFactor(0);

        this.inventoryUpdateHandler = (event: Event) => {
            const customEvent = event as CustomEvent<IInventoryResponse>;
            this.handleInventoryUpdate(customEvent.detail);
        };
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);

        this.inventorySkipHandler = (event: Event) => {
            const customEvent = event as CustomEvent<InventorySkipPayload>;
            const itemId = customEvent.detail?.itemId;
            if (!itemId) return;
            const quantity = Math.max(1, Math.floor(customEvent.detail?.quantity ?? 1));
            this.addOrUpdateIndicator('skip', itemId, quantity);
        };
        window.addEventListener('inventory:skip', this.inventorySkipHandler as EventListener);
    }

    layout() {
        this.layoutIndicators(false);
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    update() {
        this.updateDebugOutline();
    }

    destroy() {
        if (this.inventoryUpdateHandler) {
            window.removeEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
        }
        if (this.inventorySkipHandler) {
            window.removeEventListener('inventory:skip', this.inventorySkipHandler as EventListener);
        }
        this.indicators.forEach((indicator) => {
            indicator.timer?.remove(false);
            indicator.container.destroy();
        });
        this.indicators = [];
        this.pendingExits.forEach((pending) => pending.timer.remove(false));
        this.pendingExits.clear();
        this.debugGraphics?.destroy();
        this.container.destroy();
    }

    private handleInventoryUpdate(data?: IInventoryResponse) {
        if (!data?.slots) return;
        const nextCounts = this.buildCounts(data.slots, data.equippedRodId ?? null);
        if (!this.previousCounts) {
            this.previousCounts = nextCounts;
            return;
        }

        const itemIds = new Set<string>([...this.previousCounts.keys(), ...nextCounts.keys()]);
        itemIds.forEach((itemId) => {
            const prev = this.previousCounts?.get(itemId) ?? 0;
            const next = nextCounts.get(itemId) ?? 0;
            const delta = next - prev;
            if (delta > 0) {
                const pending = this.pendingExits.get(itemId);
                if (pending) {
                    pending.timer.remove(false);
                    this.pendingExits.delete(itemId);
                    const remaining = delta - pending.quantity;
                    if (remaining > 0) {
                        this.addOrUpdateIndicator('entry', itemId, remaining);
                    }
                } else {
                    this.addOrUpdateIndicator('entry', itemId, delta);
                }
            } else if (delta < 0) {
                this.queueExitIndicator(itemId, Math.abs(delta));
            }
        });

        this.previousCounts = nextCounts;
    }

    private queueExitIndicator(itemId: string, quantity: number) {
        const existing = this.pendingExits.get(itemId);
        if (existing) {
            existing.timer.remove(false);
            existing.quantity += quantity;
        }

        const timer = this.scene.time.delayedCall(this.exitDebounceMs, () => {
            const pending = this.pendingExits.get(itemId);
            if (!pending) return;
            this.pendingExits.delete(itemId);
            this.addOrUpdateIndicator('exit', itemId, pending.quantity);
        });

        this.pendingExits.set(itemId, {
            quantity: existing ? existing.quantity : quantity,
            timer
        });
    }

    private buildCounts(slots: InventorySlot[], equippedRodId: string | null): Map<string, number> {
        const counts = new Map<string, number>();
        slots.forEach((slot) => {
            if (!slot.itemId || slot.count <= 0) return;
            counts.set(slot.itemId, (counts.get(slot.itemId) ?? 0) + slot.count);
        });
        if (equippedRodId && !counts.has(equippedRodId)) {
            counts.set(equippedRodId, 1);
        }
        return counts;
    }

    private addOrUpdateIndicator(type: IndicatorType, itemId: string, quantity: number) {
        this.playIndicatorSound(type);
        const existingIndex = this.indicators.findIndex((indicator) => indicator.type === type && indicator.itemId === itemId);
        if (existingIndex !== -1) {
            const indicator = this.indicators[existingIndex];
            indicator.quantity += quantity;
            this.updateIndicatorText(indicator);
            indicator.timer?.remove(false);
            indicator.timer = this.scene.time.delayedCall(this.visibleDurationMs, () => {
                this.expireIndicator(indicator);
            });

            if (existingIndex > 0) {
                this.indicators.splice(existingIndex, 1);
                this.indicators.unshift(indicator);
            }
            this.layoutIndicators(true);
            return;
        }

        const indicator = this.createIndicator(type, itemId, quantity);
        this.indicators.unshift(indicator);

        if (this.indicators.length > this.maxVisible) {
            const oldest = this.indicators.pop();
            if (oldest) {
                this.removeIndicator(oldest, true);
            }
        }

        indicator.timer = this.scene.time.delayedCall(this.visibleDurationMs, () => {
            this.expireIndicator(indicator);
        });
        this.layoutIndicators(true);
    }

    private createIndicator(type: IndicatorType, itemId: string, quantity: number): InventoryIndicator {
        const background = this.scene.add.graphics();
        const text = this.scene.add.text(0, 0, '', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '12px',
            color: '#f2e9dd'
        });
        text.setOrigin(0, 0.5);
        text.setFixedSize(this.indicatorWidth - this.paddingX * 2, this.indicatorHeight);

        const container = this.scene.add.container(0, 0, [background, text]);
        container.setDepth(this.depth);
        container.setScrollFactor(0);

        const indicator: InventoryIndicator = {
            type,
            itemId,
            quantity,
            container,
            background,
            text
        };

        this.updateIndicatorText(indicator);
        this.drawIndicatorBackground(indicator);
        this.container.add(container);
        return indicator;
    }

    private updateIndicatorText(indicator: InventoryIndicator) {
        const itemName = getItemDefinition(indicator.itemId)?.name ?? indicator.itemId;
        const symbol = indicator.type === 'entry' ? '+' : indicator.type === 'exit' ? '-' : '!';
        indicator.text.setText(`${symbol} ${itemName} x${indicator.quantity}`);
        indicator.text.setPosition(this.paddingX, this.indicatorHeight / 2);
    }

    private drawIndicatorBackground(indicator: InventoryIndicator) {
        const { color, alpha } = this.getIndicatorStyle(indicator.type);
        indicator.background.clear();
        indicator.background.fillStyle(color, alpha);
        indicator.background.fillRoundedRect(0, 0, this.indicatorWidth, this.indicatorHeight, 4);
    }

    private getIndicatorStyle(type: IndicatorType) {
        switch (type) {
            case 'entry':
                return { color: 0x1f8f3a, alpha: 0.45 };
            case 'exit':
                return { color: 0xb33b3b, alpha: 0.45 };
            case 'skip':
                return { color: 0xd11f1f, alpha: 0.85 };
            default:
                return { color: 0x111111, alpha: 0.4 };
        }
    }

    private expireIndicator(indicator: InventoryIndicator) {
        const index = this.indicators.indexOf(indicator);
        if (index === -1) return;
        this.indicators.splice(index, 1);
        this.removeIndicator(indicator, true);
        this.layoutIndicators(true);
    }

    private removeIndicator(indicator: InventoryIndicator, animate: boolean) {
        indicator.timer?.remove(false);
        const targetX = this.getTargetX();

        if (!animate) {
            indicator.container.destroy();
            return;
        }

        this.scene.tweens.add({
            targets: indicator.container,
            x: targetX + this.slideOffset,
            alpha: 0,
            duration: 200,
            ease: 'Sine.out',
            onComplete: () => {
                indicator.container.destroy();
            }
        });
    }

    private layoutIndicators(animate: boolean) {
        const targetX = this.getTargetX();
        const targetY = this.getTargetY();

        this.indicators.forEach((indicator, index) => {
            const y = targetY + index * (this.indicatorHeight + this.indicatorGap);
            if (!animate) {
                indicator.container.setPosition(targetX, y);
                indicator.container.setAlpha(1);
                return;
            }

            const isNew = indicator.container.alpha === 0 || indicator.container.x === 0;
            if (isNew) {
                indicator.container.setPosition(targetX + this.slideOffset, y);
                indicator.container.setAlpha(0);
                this.scene.tweens.add({
                    targets: indicator.container,
                    x: targetX,
                    y,
                    alpha: 1,
                    duration: 220,
                    ease: 'Sine.out'
                });
            } else {
                this.scene.tweens.add({
                    targets: indicator.container,
                    x: targetX,
                    y,
                    duration: 180,
                    ease: 'Sine.out'
                });
            }
        });

        this.updateDebugOutline();
    }

    private getTargetX(): number {
        return Math.round(this.scene.scale.width - this.rightMargin - this.indicatorWidth);
    }

    private getTargetY(): number {
        return Math.round(this.topOffset);
    }

    private updateDebugOutline() {
        const isEnabled = this.isDebugEnabled();
        if (!isEnabled) {
            if (this.debugGraphics && this.debugVisible) {
                this.debugGraphics.setVisible(false);
                this.debugVisible = false;
            }
            return;
        }

        if (!this.debugGraphics) {
            this.debugGraphics = this.scene.add.graphics();
            this.debugGraphics.setDepth(this.depth + 1);
            this.debugGraphics.setScrollFactor(0);
        }

        const targetX = this.getTargetX();
        const targetY = this.getTargetY();
        const totalHeight = this.maxVisible * this.indicatorHeight + (this.maxVisible - 1) * this.indicatorGap;

        this.debugGraphics.clear();
        this.debugGraphics.lineStyle(2, 0x00ff88, 0.6);
        this.debugGraphics.strokeRect(targetX, targetY, this.indicatorWidth, totalHeight);
        this.debugGraphics.setVisible(true);
        this.debugVisible = true;
    }

    private isDebugEnabled(): boolean {
        const gameScene = this.scene.scene.get('GameScene') as any;
        return Boolean(gameScene?.debugOverlay?.isEnabled?.());
    }

    private getAudioManager(): AudioManager | undefined {
        const gameScene = this.scene.scene.get('GameScene') as { getAudioManager?: () => AudioManager | undefined };
        return gameScene?.getAudioManager?.();
    }

    private playIndicatorSound(type: IndicatorType) {
        const audio = this.getAudioManager();
        if (!audio) return;
        if (type === 'entry') {
            audio.playItemCollected();
        } else if (type === 'exit') {
            audio.playItemDrop();
        } else if (type === 'skip') {
            audio.playItemSkip();
        }
    }
}
