import Phaser from 'phaser';
import { ITEM_DEFINITIONS } from '@cfwk/shared';
import { ChatLayout } from './chat/ChatLayout';
import { ChatMessages } from './chat/ChatMessages';
import { ChatInput } from './chat/ChatInput';
import { ChatMobileInput } from './chat/ChatMobileInput';
import type { ChatMessage, CommandSpec } from './chat/types';

export type { ChatMessage } from './chat/types';

export class Chat {
    private layout: ChatLayout;
    private messages: ChatMessages;
    private input: ChatInput;
    private mobileInput: ChatMobileInput | null = null;

    private isFocused = false;
    private mobileHintSuppressed = false;

    private onSendMessage?: (message: string) => void;
    private onFocusChange?: (focused: boolean) => void;

    private readonly padding = 10;
    private readonly width = 320;
    private readonly messageHeight = 18;
    private readonly inputHeight = 28;
    private readonly maxVisibleMessages = 8;
    private readonly unfocusedMessageDuration = 10000;
    private readonly maxMessages = 50;
    private readonly mobileLandscapeReservedBottom = 140;
    private readonly maxInputLength = 50;
    private readonly commandSpecs: CommandSpec[] = [
        { name: 'ban', args: ['player'] },
        { name: 'broadcast', args: ['text'] },
        { name: 'drop', args: ['player', 'item', 'count'] },
        { name: 'give', args: ['player', 'item', 'count'] },
        { name: 'limbo', args: ['player'] },
        { name: 'mute', args: ['player'] },
        { name: 'reboot', args: [] },
        { name: 'tempban', args: ['player', 'duration'] },
        { name: 'tempmute', args: ['player', 'duration'] },
        { name: 'unban', args: ['player'] },
        { name: 'unmute', args: ['player'] }
    ];

    private readonly isMobile: boolean;
    private readonly itemIds: string[];

    constructor(private readonly scene: Phaser.Scene) {
        this.isMobile = this.detectMobile();
        this.itemIds = ITEM_DEFINITIONS.map((item) => item.id);

        this.layout = new ChatLayout(this.scene, {
            padding: this.padding,
            width: this.width,
            messageHeight: this.messageHeight,
            inputHeight: this.inputHeight,
            maxVisibleMessages: this.maxVisibleMessages,
            mobileLandscapeReservedBottom: this.mobileLandscapeReservedBottom,
            isMobile: this.isMobile
        });

        this.messages = new ChatMessages(this.scene, this.layout.getMessageContainer(), {
            width: this.width,
            padding: this.padding,
            messageHeight: this.messageHeight,
            maxVisibleMessages: this.maxVisibleMessages,
            unfocusedMessageDuration: this.unfocusedMessageDuration,
            maxMessages: this.maxMessages
        });

        this.input = new ChatInput(
            this.scene,
            {
                inputText: this.layout.getInputText(),
                ghostText: this.layout.getGhostText(),
                inputCursor: this.layout.getInputCursor()
            },
            {
                maxInputLength: this.maxInputLength,
                commandSpecs: this.commandSpecs
            },
            {
                onSendMessage: (message) => this.onSendMessage?.(message),
                onRequestBlur: () => this.blur(),
                onSyncMobileValue: (value) => this.mobileInput?.setValue(value),
                getMessageAreaHeight: () => this.messages.getLastRenderHeight(),
                updateInputLayout: (messageAreaHeight, inputTextHeight) => {
                    this.layout.updateInputLayout(messageAreaHeight, inputTextHeight);
                },
                getOnlinePlayerNames: () => this.getOnlinePlayerNames(),
                getItemIds: () => this.itemIds
            }
        );

        this.layout.getMobileHint().setInteractive({ useHandCursor: true });
        this.layout.getMobileHint().on('pointerdown', () => this.focus());

        if (this.isMobile) {
            this.layout.getInputBackground().setInteractive({ useHandCursor: true });
            this.layout.getInputBackground().on('pointerdown', () => {
                if (!this.isFocused) {
                    this.focus();
                }
            });
        }

        this.scene.time.addEvent({
            delay: 1000,
            callback: () => this.cleanupOldMessages(),
            loop: true
        });

        if (this.isMobile) {
            this.layout.applyMobileLayout();
        }
    }

    setOnSendMessage(callback: (message: string) => void) {
        this.onSendMessage = callback;
    }

    setOnFocusChange(callback: (focused: boolean) => void) {
        this.onFocusChange = callback;
    }

    setMobileHintSuppressed(suppressed: boolean) {
        this.mobileHintSuppressed = suppressed;
        this.layout.setMobileHintSuppressed(suppressed, this.isFocused);
    }

    isChatFocused(): boolean {
        return this.isFocused;
    }

    refreshLayout() {
        if (this.isMobile) {
            this.layout.applyMobileLayout();
        }
        const height = this.messages.renderMessages(this.isFocused, this.layout.getMaxMessageAreaHeight());
        if (this.isFocused) {
            this.layout.updateInputLayout(height, this.layout.getInputText().height);
            this.input.updateCursorPosition();
        }
    }

    focus() {
        if (this.isFocused) return;
        this.isFocused = true;

        this.input.onFocus();
        window.addEventListener('paste', this.handlePaste);

        this.layout.setFocusedVisible(true, this.mobileHintSuppressed);

        const height = this.messages.renderMessages(true, this.layout.getMaxMessageAreaHeight());
        this.layout.updateInputLayout(height, this.layout.getInputText().height);
        this.input.updateCursorPosition();

        this.onFocusChange?.(true);

        if (this.isMobile) {
            if (!this.mobileInput) {
                this.mobileInput = new ChatMobileInput(this.maxInputLength);
            }
            this.mobileInput.show(this.input.getCurrentInput(), {
                onInput: (value) => this.input.applyInputText(value, false),
                onSubmit: () => this.input.send(),
                onBlur: () => this.blur()
            });
        }
    }

    blur() {
        if (!this.isFocused) return;
        this.isFocused = false;

        this.mobileInput?.remove();
        window.removeEventListener('paste', this.handlePaste);
        this.input.onBlur();

        this.layout.setFocusedVisible(false, this.mobileHintSuppressed);

        this.messages.renderMessages(false, this.layout.getMaxMessageAreaHeight());
        this.onFocusChange?.(false);
    }

    handleKeyDown(event: KeyboardEvent): boolean {
        if (!this.isFocused) {
            if (event.key === 't' || event.key === 'T' || event.key === '/') {
                event.preventDefault();
                if (event.key === '/') {
                    this.input.setCurrentInput('/', false);
                }
                this.focus();
                return true;
            }
            return false;
        }

        return this.input.handleKeyDown(event, {
            isMobile: this.isMobile,
            hasNativeInput: this.mobileInput?.isActive() ?? false
        });
    }

    addMessage(msg: ChatMessage) {
        this.messages.addMessage(msg);
        this.messages.renderMessages(this.isFocused, this.layout.getMaxMessageAreaHeight());
        if (this.isFocused) {
            this.layout.updateInputLayout(this.messages.getLastRenderHeight(), this.layout.getInputText().height);
            this.input.updateCursorPosition();
        }
    }

    destroy() {
        this.mobileInput?.remove();
        this.input.destroy();
        this.layout.destroy();
    }

    private cleanupOldMessages() {
        this.messages.cleanupOldMessages(this.isFocused, this.layout.getMaxMessageAreaHeight());
    }

    private handlePaste = (e: ClipboardEvent) => {
        if (!this.isFocused) return;
        e.preventDefault();

        const pastedText = e.clipboardData?.getData('text');
        if (pastedText) {
            this.input.applyInputText(this.input.getCurrentInput() + pastedText, true);
        }
    };

    private detectMobile(): boolean {
        const ua = navigator.userAgent.toLowerCase();
        const mobileKeywords = ['android', 'webos', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone', 'mobile', 'tablet'];
        const isMobileUA = mobileKeywords.some((keyword) => ua.includes(keyword));
        const isSmallScreen = window.innerWidth <= 1024 && window.innerHeight <= 1366;
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        return hasTouch && (isMobileUA || isSmallScreen);
    }

    private getOnlinePlayerNames(): string[] {
        const players = this.scene.registry.get('tablistPlayers') as Array<{ username?: string }> | undefined;
        if (!Array.isArray(players)) return [];
        return players
            .map((player) => player.username)
            .filter((name): name is string => Boolean(name));
    }
}
