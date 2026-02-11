import Phaser from 'phaser';
import { EmojiMap } from '../EmojiMap';
import type { ChatMessage } from './types';

type ChatMessagesConfig = {
    width: number;
    padding: number;
    messageHeight: number;
    maxVisibleMessages: number;
    unfocusedMessageDuration: number;
    maxMessages: number;
};

type MessageDisplay = {
    container: Phaser.GameObjects.Container;
    timestamp: number;
};

export class ChatMessages {
    private messages: ChatMessage[] = [];
    private messageTexts: MessageDisplay[] = [];
    private lastRenderHeight = 0;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly messageContainer: Phaser.GameObjects.Container,
        private readonly config: ChatMessagesConfig
    ) {}

    addMessage(msg: ChatMessage) {
        this.messages.push(msg);
        if (this.messages.length > this.config.maxMessages) {
            this.messages.shift();
        }
    }

    renderMessages(focused: boolean, maxMessageAreaHeight: number): number {
        this.messageContainer.removeAll(true);
        this.messageTexts = [];

        const now = Date.now();
        const candidateMessages = focused
            ? this.messages
            : this.messages.filter((m) => now - m.timestamp < this.config.unfocusedMessageDuration);

        const messagesToRender: { msg: ChatMessage; height: number; container: Phaser.GameObjects.Container }[] = [];
        let totalHeight = 0;

        for (let i = candidateMessages.length - 1; i >= 0; i--) {
            const msg = candidateMessages[i];
            const msgContainer = this.createMessageDisplay(msg, 0);
            const textItems = msgContainer.list.filter((child) => child instanceof Phaser.GameObjects.Text) as Phaser.GameObjects.Text[];
            const messageHeight = Math.max(
                this.config.messageHeight,
                ...textItems.map((text) => text.height)
            );
            const entryHeight = messageHeight + 2;

            if (totalHeight + entryHeight > maxMessageAreaHeight + 20) {
                msgContainer.destroy();
                break;
            }

            totalHeight += entryHeight;
            messagesToRender.unshift({ msg, height: entryHeight, container: msgContainer });
        }

        let currentY = 0;
        messagesToRender.forEach((item) => {
            const { msg, height, container } = item;
            container.y = currentY;
            this.messageContainer.add(container);
            this.messageTexts.push({ container, timestamp: msg.timestamp });
            currentY += height;
        });

        this.lastRenderHeight = currentY;
        return currentY;
    }

    cleanupOldMessages(focused: boolean, maxMessageAreaHeight: number): boolean {
        if (focused) return false;
        const now = Date.now();
        const needsRender = this.messageTexts.some((mt) => now - mt.timestamp >= this.config.unfocusedMessageDuration);
        if (needsRender) {
            this.renderMessages(false, maxMessageAreaHeight);
        }
        return needsRender;
    }

    getLastRenderHeight() {
        return this.lastRenderHeight;
    }

    private createMessageDisplay(msg: ChatMessage, y: number): Phaser.GameObjects.Container {
        const container = this.scene.add.container(0, y);

        const nameColor = msg.isSystem ? '#ff0000' : '#ffffff';

        const nameText = this.scene.add.text(0, 0, `${msg.username}: `, {
            fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
            fontSize: '14px',
            color: nameColor
        });
        container.add(nameText);

        let nameOffsetX = 0;
        let sharkWidth = 0;
        let sharkText: Phaser.GameObjects.Text | undefined;
        if (msg.isPremium && !msg.isSystem) {
            sharkText = this.scene.add.text(0, 0, '🦈', {
                fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
                fontSize: '12px',
                color: '#ffffff'
            });
            sharkText.setOrigin(0, 0.5);
            sharkText.setScale(0.9);
            sharkText.setPosition(0, Math.floor(nameText.height / 2));
            sharkWidth = sharkText.displayWidth;
            nameOffsetX = sharkWidth + 2;
            container.add(sharkText);
            nameText.setX(nameOffsetX);
        }

        const parsedMessage = EmojiMap.parse(msg.message);

        const nameWidth = nameText.width + sharkWidth + (sharkText ? 2 : 0);
        const messageText = this.scene.add.text(nameWidth, 0, parsedMessage, {
            fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
            fontSize: '14px',
            color: msg.isSystem ? '#ff0000' : '#ffffff',
            wordWrap: { width: this.config.width - this.config.padding * 2 - nameWidth, useAdvancedWrap: true }
        });
        container.add(messageText);

        if (msg.isSystem) {
            const bgPaddingX = 4;
            const bgPaddingY = 1;
            const messageBounds = messageText.getBounds();
            const bgWidth = nameWidth + messageBounds.width + bgPaddingX * 2;
            const bgHeight = Math.max(nameText.height, messageBounds.height) + bgPaddingY * 2;
            const bg = this.scene.add.rectangle(-bgPaddingX, -bgPaddingY, bgWidth, bgHeight, 0xff4444, 0.25);
            bg.setOrigin(0, 0);
            container.addAt(bg, 0);
        }

        return container;
    }
}
