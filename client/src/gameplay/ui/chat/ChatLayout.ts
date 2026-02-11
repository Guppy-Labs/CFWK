import Phaser from 'phaser';

type ChatLayoutConfig = {
    padding: number;
    width: number;
    messageHeight: number;
    inputHeight: number;
    maxVisibleMessages: number;
    mobileLandscapeReservedBottom: number;
    isMobile: boolean;
};

export class ChatLayout {
    private container: Phaser.GameObjects.Container;
    private background: Phaser.GameObjects.Rectangle;
    private inputBackground: Phaser.GameObjects.Rectangle;
    private inputText: Phaser.GameObjects.Text;
    private ghostText: Phaser.GameObjects.Text;
    private inputCursor: Phaser.GameObjects.Rectangle;
    private mobileHint: Phaser.GameObjects.Text;
    private messageContainer: Phaser.GameObjects.Container;

    constructor(private readonly scene: Phaser.Scene, private readonly config: ChatLayoutConfig) {
        const { padding } = config;
        this.container = this.scene.add.container(padding, padding);
        this.container.setDepth(9999);
        this.container.setScrollFactor(0);

        const bgHeight = config.maxVisibleMessages * config.messageHeight + config.inputHeight + padding * 3;
        this.background = this.scene.add.rectangle(0, 0, config.width, bgHeight, 0x000000, 0.6);
        this.background.setOrigin(0, 0);
        this.background.setVisible(false);
        this.container.add(this.background);

        this.messageContainer = this.scene.add.container(padding, padding);
        this.container.add(this.messageContainer);

        const inputY = config.maxVisibleMessages * config.messageHeight + padding * 2;
        this.inputBackground = this.scene.add.rectangle(0, inputY, config.width, config.inputHeight, 0x333333, 0.8);
        this.inputBackground.setOrigin(0, 0);
        this.inputBackground.setVisible(false);
        this.container.add(this.inputBackground);

        this.inputText = this.scene.add.text(padding, inputY + 6, '', {
            fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
            fontSize: '14px',
            color: '#ffffff',
            wordWrap: { width: config.width - padding * 2, useAdvancedWrap: true }
        });
        this.inputText.setVisible(false);
        this.container.add(this.inputText);

        this.ghostText = this.scene.add.text(padding, inputY + 6, '', {
            fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
            fontSize: '14px',
            color: '#8a8a8a',
            wordWrap: { width: config.width - padding * 2, useAdvancedWrap: true }
        });
        this.ghostText.setVisible(false);
        this.container.add(this.ghostText);

        this.inputCursor = this.scene.add.rectangle(padding, inputY + 6, 2, 14, 0xffffff);
        this.inputCursor.setOrigin(0, 0);
        this.inputCursor.setVisible(false);
        this.container.add(this.inputCursor);

        this.mobileHint = this.scene.add.text(padding, inputY + 6, 'Tap to chat', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '12px',
            color: '#888888',
            padding: { x: 10, y: 8 },
            shadow: {
                offsetX: 1,
                offsetY: 1,
                color: '#000000',
                blur: 2,
                fill: true
            }
        });
        this.mobileHint.setVisible(config.isMobile);
        this.container.add(this.mobileHint);
    }

    applyMobileLayout() {
        const maxMessageAreaHeight = this.getMaxMessageAreaHeight();
        const inputY = Math.min(
            this.config.maxVisibleMessages * this.config.messageHeight + this.config.padding * 2,
            maxMessageAreaHeight + this.config.padding * 2
        );
        this.inputBackground.y = inputY;
        this.inputText.y = inputY + 6;
        this.inputCursor.y = inputY + 6;
        this.mobileHint.y = inputY + 6;
        this.ghostText.y = inputY + 6;
    }

    getMaxChatHeight(): number {
        const screenHeight = this.scene.scale.height || window.innerHeight;
        if (!this.config.isMobile) return Math.max(120, screenHeight - this.config.padding * 2);

        const screenWidth = this.scene.scale.width || window.innerWidth;
        const isLandscape = screenWidth > screenHeight;
        const reservedBottom = isLandscape ? this.config.mobileLandscapeReservedBottom : 0;

        return Math.max(120, screenHeight - reservedBottom - this.config.padding * 2);
    }

    getMaxMessageAreaHeight(): number {
        const defaultMax = this.config.maxVisibleMessages * this.config.messageHeight;
        const maxChatHeight = this.getMaxChatHeight();
        const maxMessageArea = maxChatHeight - this.config.inputHeight - this.config.padding * 3;
        return Math.max(this.config.messageHeight * 2, Math.min(defaultMax, maxMessageArea));
    }

    updateInputLayout(messageAreaHeight: number, inputTextHeight: number) {
        const maxMessageAreaHeight = this.getMaxMessageAreaHeight();
        const clampedMessageAreaHeight = Math.min(messageAreaHeight, maxMessageAreaHeight);
        const defaultHeight = Math.min(this.config.maxVisibleMessages * this.config.messageHeight, maxMessageAreaHeight);
        const desiredStartY = Math.max(defaultHeight, clampedMessageAreaHeight) + this.config.padding * 2;

        const currentInputHeight = Math.max(this.config.inputHeight, inputTextHeight + 12);

        const maxChatHeight = this.getMaxChatHeight();
        const maxStartY = Math.max(this.config.padding, maxChatHeight - currentInputHeight - this.config.padding);
        const startY = Math.min(desiredStartY, maxStartY);

        this.inputBackground.y = startY;
        this.inputText.y = startY + 6;
        this.ghostText.y = startY + 6;
        this.inputCursor.y = startY + 6;
        this.mobileHint.y = startY + 6;

        this.inputBackground.height = currentInputHeight;

        const totalHeight = startY + currentInputHeight + this.config.padding;
        this.background.height = Math.min(totalHeight, maxChatHeight);
    }

    setFocusedVisible(focused: boolean, mobileHintSuppressed: boolean) {
        this.background.setVisible(focused);
        this.inputBackground.setVisible(focused);
        this.inputText.setVisible(focused);
        this.ghostText.setVisible(focused);
        this.inputCursor.setVisible(focused);
        this.mobileHint.setVisible(this.config.isMobile && !focused && !mobileHintSuppressed);
    }

    setMobileHintSuppressed(suppressed: boolean, focused: boolean) {
        this.mobileHint.setVisible(this.config.isMobile && !focused && !suppressed);
    }

    getContainer() {
        return this.container;
    }

    getMessageContainer() {
        return this.messageContainer;
    }

    getBackground() {
        return this.background;
    }

    getInputBackground() {
        return this.inputBackground;
    }

    getInputText() {
        return this.inputText;
    }

    getGhostText() {
        return this.ghostText;
    }

    getInputCursor() {
        return this.inputCursor;
    }

    getMobileHint() {
        return this.mobileHint;
    }

    destroy() {
        this.container.destroy();
    }
}
