import Phaser from 'phaser';
import { createChatBubble, createIconBubble } from '../PlayerVisualUtils';

type BubbleAnchor = {
    x: number;
    nameplateTop: number;
};

type BubbleAnchorProvider = () => BubbleAnchor | null;

type BubbleConfig = {
    gap: number;
};

export class MCBubbleManager {
    private chatBubble?: Phaser.GameObjects.Container;
    private chatTimer?: Phaser.Time.TimerEvent;
    private fishingBubble?: Phaser.GameObjects.Container;
    private fishingTimer?: Phaser.Time.TimerEvent;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly anchorProvider: BubbleAnchorProvider,
        private readonly config: BubbleConfig
    ) {}

    showChat(message: string) {
        const anchor = this.anchorProvider();
        if (!anchor) return;

        this.chatBubble?.destroy();
        this.chatBubble = undefined;
        this.chatTimer?.remove(false);
        this.chatTimer = undefined;

        const bubble = createChatBubble({
            scene: this.scene,
            message,
            depth: 99999
        });

        this.chatBubble = bubble.container;
        this.positionChatBubble(anchor);

        this.chatTimer = this.scene.time.delayedCall(4000, () => {
            if (this.chatBubble) {
                this.scene.tweens.add({
                    targets: this.chatBubble,
                    alpha: 0,
                    duration: 300,
                    onComplete: () => {
                        this.chatBubble?.destroy();
                        this.chatBubble = undefined;
                    }
                });
            }
        });
    }

    showFishingBubble(rodItemId: string) {
        const anchor = this.anchorProvider();
        if (!anchor) return;

        const textureKey = `item-${rodItemId}-18`;
        if (!this.scene.textures.exists(textureKey)) return;

        this.fishingBubble?.destroy();
        this.fishingBubble = undefined;
        this.fishingTimer?.remove(false);
        this.fishingTimer = undefined;

        const bubble = createIconBubble({
            scene: this.scene,
            textureKey,
            depth: 99999
        });

        this.fishingBubble = bubble.container;
        this.positionFishingBubble(anchor, true);

        this.fishingTimer = this.scene.time.delayedCall(2000, () => {
            if (this.fishingBubble) {
                this.scene.tweens.add({
                    targets: this.fishingBubble,
                    alpha: 0,
                    duration: 250,
                    onComplete: () => {
                        this.fishingBubble?.destroy();
                        this.fishingBubble = undefined;
                    }
                });
            }
        });
    }

    update() {
        const anchor = this.anchorProvider();
        if (!anchor) return;
        if (this.chatBubble) {
            this.positionChatBubble(anchor);
        }
        if (this.fishingBubble) {
            this.positionFishingBubble(anchor, false);
        }
    }

    destroy() {
        this.chatBubble?.destroy();
        this.chatTimer?.remove(false);
        this.fishingBubble?.destroy();
        this.fishingTimer?.remove(false);
    }

    private positionChatBubble(anchor: BubbleAnchor) {
        if (!this.chatBubble) return;
        const bubbleHeight = this.chatBubble.getBounds().height;
        const bubbleY = anchor.nameplateTop - this.config.gap - bubbleHeight / 2;
        this.chatBubble.setPosition(anchor.x, bubbleY);
    }

    private positionFishingBubble(anchor: BubbleAnchor, isInitial: boolean) {
        if (!this.fishingBubble) return;
        const bubbleHeight = this.fishingBubble.getBounds().height;
        const bubbleY = anchor.nameplateTop - this.config.gap - bubbleHeight / 2;
        if (isInitial) {
            this.fishingBubble.setPosition(anchor.x, bubbleY + 6);
            this.fishingBubble.setAlpha(0);
            this.scene.tweens.add({
                targets: this.fishingBubble,
                y: bubbleY,
                alpha: 1,
                duration: 250,
                ease: 'Sine.out'
            });
        } else {
            this.fishingBubble.setPosition(anchor.x, bubbleY);
        }
    }
}
