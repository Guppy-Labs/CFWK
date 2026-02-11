import Phaser from 'phaser';
import type { CommandSpec, SuggestionContext, SuggestionResult } from './types';

type ChatInputElements = {
    inputText: Phaser.GameObjects.Text;
    ghostText: Phaser.GameObjects.Text;
    inputCursor: Phaser.GameObjects.Rectangle;
};

type ChatInputCallbacks = {
    onSendMessage: (message: string) => void;
    onRequestBlur: () => void;
    onSyncMobileValue: (value: string) => void;
    getMessageAreaHeight: () => number;
    updateInputLayout: (messageAreaHeight: number, inputTextHeight: number) => void;
    getOnlinePlayerNames: () => string[];
    getItemIds: () => string[];
};

type ChatInputConfig = {
    maxInputLength: number;
    commandSpecs: CommandSpec[];
};

export class ChatInput {
    private isFocused = false;
    private currentInput = '';
    private cursorVisible = true;
    private cursorTimer?: Phaser.Time.TimerEvent;
    private selectionAll = false;
    private history: string[] = [];
    private historyIndex = -1;
    private historyDraft = '';
    private lastCursorX = 0;
    private lastCursorY = 0;
    private currentSuggestion: string | null = null;
    private suggestionRemainder = '';
    private suggestionContext?: SuggestionContext;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly elements: ChatInputElements,
        private readonly config: ChatInputConfig,
        private readonly callbacks: ChatInputCallbacks
    ) {
        this.cursorTimer = this.scene.time.addEvent({
            delay: 530,
            callback: () => {
                if (this.isFocused) {
                    this.cursorVisible = !this.cursorVisible;
                    this.elements.inputCursor.setVisible(this.cursorVisible);
                }
            },
            loop: true
        });
    }

    destroy() {
        this.cursorTimer?.destroy();
    }

    onFocus() {
        this.isFocused = true;
        this.selectionAll = false;
        this.historyIndex = -1;
        this.elements.inputText.setText(this.currentInput);
        this.updateCursorPosition();
        this.updateSuggestions();
    }

    onBlur() {
        this.isFocused = false;
    }

    setCurrentInput(value: string, syncMobile: boolean) {
        this.applyInputText(value, syncMobile);
    }

    getCurrentInput() {
        return this.currentInput;
    }

    handleKeyDown(event: KeyboardEvent, options: { isMobile: boolean; hasNativeInput: boolean }): boolean {
        if (!this.isFocused) return false;

        if (options.isMobile && options.hasNativeInput) {
            if (event.key === 'Enter') {
                this.send();
                return true;
            }
            return false;
        }

        event.preventDefault();
        event.stopPropagation();

        if (this.handleControlShortcut(event)) {
            return true;
        }

        if (event.key === 'Tab') {
            this.applyTabCompletion();
            return true;
        }

        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            this.handleHistoryNavigation(event.key === 'ArrowUp' ? -1 : 1);
            return true;
        }

        if (event.key === 'Enter') {
            this.send();
            return true;
        }

        if (event.key === 'Escape') {
            this.callbacks.onRequestBlur();
            return true;
        }

        if (event.key === 'Backspace') {
            if (this.selectionAll) {
                this.applyInputText('', true);
            } else {
                this.applyInputText(this.currentInput.slice(0, -1), true);
            }
            return true;
        }

        if (event.key.length > 1) return true;

        if (this.selectionAll) {
            this.applyInputText(event.key, true);
            return true;
        }

        if (this.currentInput.length < this.config.maxInputLength) {
            this.applyInputText(this.currentInput + event.key, true);
        }

        return true;
    }

    send() {
        const message = this.currentInput.trim();
        if (message.length > 0) {
            this.callbacks.onSendMessage(message);
            this.history.push(message);
            this.applyInputText('', false);
        }
        this.callbacks.onRequestBlur();
    }

    applyInputText(value: string, syncMobile: boolean) {
        const trimmed = value.substring(0, this.config.maxInputLength);
        this.currentInput = trimmed;
        this.elements.inputText.setText(this.currentInput);
        this.selectionAll = false;
        if (syncMobile) {
            this.callbacks.onSyncMobileValue(this.currentInput);
        }
        this.updateCursorPosition();
        this.updateSuggestions();
    }

    updateCursorPosition() {
        const lines = this.elements.inputText.getWrappedText(this.currentInput);
        const lineCount = lines.length;

        if (lineCount <= 1) {
            this.elements.inputCursor.setPosition(this.elements.inputText.x + this.elements.inputText.width + 1, this.elements.inputText.y);
            this.lastCursorX = this.elements.inputText.x + this.elements.inputText.width + 1;
            this.lastCursorY = this.elements.inputText.y;
        } else {
            const lastLine = lines[lineCount - 1];
            const tempText = this.scene.add.text(0, 0, lastLine, {
                fontFamily: 'Minecraft, monospace',
                fontSize: '14px'
            });
            const lastLineWidth = tempText.width;
            tempText.destroy();

            const lineHeight = this.elements.inputText.height / lineCount;
            const lastLineY = this.elements.inputText.y + (lineCount - 1) * lineHeight;

            this.elements.inputCursor.setPosition(this.elements.inputText.x + lastLineWidth + 1, lastLineY);
            this.lastCursorX = this.elements.inputText.x + lastLineWidth + 1;
            this.lastCursorY = lastLineY;
        }

        this.updateGhostPosition();

        if (this.isFocused) {
            this.callbacks.updateInputLayout(this.callbacks.getMessageAreaHeight(), this.elements.inputText.height);
        }
    }

    updateSuggestions() {
        if (!this.isFocused || !this.currentInput.startsWith('/')) {
            this.clearSuggestion();
            return;
        }

        const result = this.getSuggestionResult();
        if (!result) {
            this.clearSuggestion();
            return;
        }

        this.currentSuggestion = result.suggestion;
        this.suggestionRemainder = result.remainder;
        this.suggestionContext = result.context;
        this.elements.ghostText.setText(this.suggestionRemainder);
        this.elements.ghostText.setVisible(this.suggestionRemainder.length > 0 && this.isFocused);
        this.updateGhostPosition();
    }

    private clearSuggestion() {
        this.currentSuggestion = null;
        this.suggestionRemainder = '';
        this.suggestionContext = undefined;
        this.elements.ghostText.setText('');
        this.elements.ghostText.setVisible(false);
    }

    private updateGhostPosition() {
        this.elements.ghostText.setPosition(this.lastCursorX, this.lastCursorY);
    }

    private getSuggestionResult(): SuggestionResult | null {
        const raw = this.currentInput;
        if (!raw.startsWith('/')) return null;

        const afterSlash = raw.slice(1);
        const endsWithSpace = /\s$/.test(afterSlash);
        const trimmed = afterSlash.trim();
        const tokens = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
        if (endsWithSpace) {
            tokens.push('');
        }

        if (tokens.length === 0) return null;

        const tokenIndex = Math.max(0, tokens.length - 1);
        const fragment = tokens[tokenIndex] ?? '';

        if (tokenIndex === 0) {
            if (!fragment) return null;
            const command = this.pickSuggestion(fragment, this.config.commandSpecs.map((spec) => spec.name));
            if (!command) return null;
            const commandSpec = this.config.commandSpecs.find((spec) => spec.name === command);
            const remainder = command.slice(fragment.length);
            if (!remainder) return null;
            return {
                suggestion: command,
                remainder,
                context: { tokens, tokenIndex, commandSpec }
            };
        }

        const commandName = tokens[0]?.toLowerCase() ?? '';
        const commandSpec = this.config.commandSpecs.find((spec) => spec.name === commandName);
        if (!commandSpec) return null;

        const argIndex = tokenIndex - 1;
        if (argIndex < 0 || argIndex >= commandSpec.args.length) return null;

        const argType = commandSpec.args[argIndex];
        if (argType === 'player') {
            if (!fragment) return null;
            const playerNames = this.callbacks.getOnlinePlayerNames();
            const player = this.pickSuggestion(fragment, playerNames);
            if (!player) return null;
            const remainder = player.slice(fragment.length);
            if (!remainder) return null;
            return {
                suggestion: player,
                remainder,
                context: { tokens, tokenIndex, commandSpec, argIndex }
            };
        }

        if (argType === 'item') {
            if (!fragment) return null;
            const itemIds = this.callbacks.getItemIds();
            const itemId = this.pickSuggestion(fragment, itemIds);
            if (!itemId) return null;
            const remainder = itemId.slice(fragment.length);
            if (!remainder) return null;
            return {
                suggestion: itemId,
                remainder,
                context: { tokens, tokenIndex, commandSpec, argIndex }
            };
        }

        return null;
    }

    private pickSuggestion(fragment: string, options: string[]): string | null {
        const normalized = fragment.toLowerCase();
        const matches = options
            .filter((option) => option.toLowerCase().startsWith(normalized))
            .sort((a, b) => a.localeCompare(b));
        if (matches.length === 0) return null;
        return matches[0];
    }

    private applyTabCompletion(): boolean {
        if (!this.currentSuggestion || !this.suggestionContext) return false;

        const { tokens, tokenIndex, commandSpec, argIndex } = this.suggestionContext;
        const updated = [...tokens];
        updated[tokenIndex] = this.currentSuggestion;

        let next = updated.join(' ');
        const shouldAppendSpace = this.shouldAppendSpaceAfterCompletion(commandSpec, tokenIndex, argIndex);
        if (shouldAppendSpace) {
            next += ' ';
        }

        this.applyInputText(`/${next}`, true);
        return true;
    }

    private shouldAppendSpaceAfterCompletion(commandSpec: CommandSpec | undefined, tokenIndex: number, argIndex?: number) {
        if (tokenIndex === 0) {
            if (!commandSpec) return false;
            return commandSpec.args.length > 0;
        }

        if (!commandSpec || argIndex === undefined) return false;
        return argIndex < commandSpec.args.length - 1;
    }

    private handleHistoryNavigation(step: number) {
        if (this.history.length === 0) return;

        if (this.historyIndex === -1) {
            if (step > 0) return;
            this.historyDraft = this.currentInput;
            this.historyIndex = this.history.length - 1;
            this.applyInputText(this.history[this.historyIndex], true);
            return;
        }

        const nextIndex = this.historyIndex + step;
        if (nextIndex < 0) {
            this.historyIndex = 0;
            this.applyInputText(this.history[this.historyIndex], true);
            return;
        }

        if (nextIndex >= this.history.length) {
            this.historyIndex = -1;
            this.applyInputText(this.historyDraft, true);
            return;
        }

        this.historyIndex = nextIndex;
        this.applyInputText(this.history[this.historyIndex], true);
    }

    private handleControlShortcut(event: KeyboardEvent): boolean {
        if (!event.ctrlKey && !event.metaKey) return false;

        const key = event.key.toLowerCase();
        if (key === 'a') {
            this.selectionAll = true;
            this.updateCursorPosition();
            return true;
        }

        if (key === 'c') {
            this.copyToClipboard(this.currentInput);
            return true;
        }

        if (key === 'x') {
            this.copyToClipboard(this.currentInput);
            this.applyInputText('', true);
            return true;
        }

        if (key === 'v') {
            this.pasteFromClipboard();
            return true;
        }

        return false;
    }

    private async copyToClipboard(text: string) {
        if (!text) return;
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch (_err) {
                // Ignore and fall through.
            }
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
        } finally {
            document.body.removeChild(textarea);
        }
    }

    private async pasteFromClipboard() {
        if (!navigator.clipboard?.readText) return;
        try {
            const text = await navigator.clipboard.readText();
            if (!text) return;
            this.applyInputText(this.currentInput + text, true);
        } catch (_err) {
            // Ignore clipboard failures.
        }
    }
}
