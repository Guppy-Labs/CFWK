import Phaser from 'phaser';
import { EmojiMap } from './EmojiMap';

/**
 * Generates a consistent color from a string (user ID) - matching RemotePlayer
 */
function hashToColor(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    
    const hue = Math.abs(hash) % 360;
    const saturation = 60 + (Math.abs(hash >> 8) % 30);
    const lightness = 55 + (Math.abs(hash >> 16) % 20);
    
    return Phaser.Display.Color.HSLToColor(hue / 360, saturation / 100, lightness / 100).color;
}

function colorToHex(color: number): string {
    return '#' + color.toString(16).padStart(6, '0');
}

export interface ChatMessage {
    username: string;
    odcid: string;
    message: string;
    timestamp: number;
    isSystem?: boolean;
}

export class Chat {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private background: Phaser.GameObjects.Rectangle;
    private inputBackground: Phaser.GameObjects.Rectangle;
    private inputText: Phaser.GameObjects.Text;
    private inputCursor: Phaser.GameObjects.Rectangle;
    private mobileHint: Phaser.GameObjects.Text;
    private messageContainer: Phaser.GameObjects.Container;
    
    private messages: ChatMessage[] = [];
    private messageTexts: { container: Phaser.GameObjects.Container; timestamp: number }[] = [];
    
    private isFocused: boolean = false;
    private currentInput: string = '';
    private cursorVisible: boolean = true;
    private cursorTimer?: Phaser.Time.TimerEvent;
    
    private onSendMessage?: (message: string) => void;
    private onFocusChange?: (focused: boolean) => void;
    
    private readonly padding = 10;
    private readonly width = 320;
    private readonly messageHeight = 18;
    private readonly inputHeight = 28;
    private readonly maxVisibleMessages = 8;
    private readonly unfocusedMessageDuration = 10000; // 10 seconds
    private readonly maxMessages = 50;
    
    private isMobile: boolean = false;
    private mobileInput: HTMLInputElement | null = null;
    
    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.isMobile = this.detectMobile();
        
        // Main container
        this.container = this.scene.add.container(this.padding, this.padding);
        this.container.setDepth(9999);
        this.container.setScrollFactor(0);
        
        // Background (only visible when focused)
        const bgHeight = this.maxVisibleMessages * this.messageHeight + this.inputHeight + this.padding * 3;
        this.background = this.scene.add.rectangle(0, 0, this.width, bgHeight, 0x000000, 0.6);
        this.background.setOrigin(0, 0);
        this.background.setVisible(false);
        this.container.add(this.background);
        
        // Message container
        this.messageContainer = this.scene.add.container(this.padding, this.padding);
        this.container.add(this.messageContainer);
        
        // Input area background
        const inputY = this.maxVisibleMessages * this.messageHeight + this.padding * 2;
        this.inputBackground = this.scene.add.rectangle(0, inputY, this.width, this.inputHeight, 0x333333, 0.8);
        this.inputBackground.setOrigin(0, 0);
        this.inputBackground.setVisible(false);
        this.container.add(this.inputBackground);
        
        // Input text
        this.inputText = this.scene.add.text(this.padding, inputY + 6, '', {
            fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
            fontSize: '14px',
            color: '#ffffff',
            wordWrap: { width: this.width - this.padding * 2, useAdvancedWrap: true }
        });
        this.inputText.setVisible(false);
        this.container.add(this.inputText);
        
        // Cursor
        this.inputCursor = this.scene.add.rectangle(this.padding, inputY + 6, 2, 14, 0xffffff);
        this.inputCursor.setOrigin(0, 0);
        this.inputCursor.setVisible(false);
        this.container.add(this.inputCursor);
        
        // Mobile hint with larger touch area
        this.mobileHint = this.scene.add.text(this.padding, inputY + 6, 'Tap to chat', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '12px',
            color: '#888888',
            padding: { x: 10, y: 8 }
        });
        this.mobileHint.setVisible(this.isMobile);
        this.mobileHint.setInteractive({ useHandCursor: true });
        this.mobileHint.on('pointerdown', () => this.focus());
        this.container.add(this.mobileHint);
        
        // On mobile, also make the input background area clickable when not focused
        if (this.isMobile) {
            this.inputBackground.setInteractive({ useHandCursor: true });
            this.inputBackground.on('pointerdown', () => {
                if (!this.isFocused) {
                    this.focus();
                }
            });
        }
        
        // Start cursor blink timer
        this.cursorTimer = this.scene.time.addEvent({
            delay: 530,
            callback: () => {
                if (this.isFocused) {
                    this.cursorVisible = !this.cursorVisible;
                    this.inputCursor.setVisible(this.cursorVisible);
                }
            },
            loop: true
        });
        
        // Clean up old unfocused messages periodically
        this.scene.time.addEvent({
            delay: 1000,
            callback: () => this.cleanupOldMessages(),
            loop: true
        });
    }
    
    private detectMobile(): boolean {
        const ua = navigator.userAgent.toLowerCase();
        const mobileKeywords = ['android', 'webos', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone', 'mobile'];
        return mobileKeywords.some(keyword => ua.includes(keyword));
    }
    
    setOnSendMessage(callback: (message: string) => void) {
        this.onSendMessage = callback;
    }
    
    setOnFocusChange(callback: (focused: boolean) => void) {
        this.onFocusChange = callback;
    }
    
    isChatFocused(): boolean {
        return this.isFocused;
    }
    
    focus() {
        if (this.isFocused) return;
        
        this.isFocused = true;
        
        // Restore previous draft or empty string
        // this.currentInput is preserved until cleared by send()
        this.inputText.setText(this.currentInput);
        this.updateCursorPosition();
        
        window.addEventListener('paste', this.handlePaste);

        // Show UI
        this.background.setVisible(true);
        this.inputBackground.setVisible(true);
        this.inputText.setVisible(true);
        this.inputCursor.setVisible(true);
        this.mobileHint.setVisible(false);
        
        // Show all messages
        this.renderMessages();
        
        this.onFocusChange?.(true);
        
        // On mobile, prompt for keyboard
        if (this.isMobile) {
            this.promptMobileKeyboard();
        }
    }
    
    blur() {
        if (!this.isFocused) return;
        
        this.isFocused = false;
        
        // Clean up mobile input first
        this.removeMobileInput();
        
        window.removeEventListener('paste', this.handlePaste);

        // Hide focused UI
        this.background.setVisible(false);
        this.inputBackground.setVisible(false);
        this.inputText.setVisible(false);
        this.inputCursor.setVisible(false);
        this.mobileHint.setVisible(this.isMobile);
        
        // Re-render messages (unfocused mode)
        this.renderMessages();
        
        this.onFocusChange?.(false);
    }
    
    private handlePaste = (e: ClipboardEvent) => {
        if (!this.isFocused) return;
        e.preventDefault();
        
        const pastedText = e.clipboardData?.getData('text');
        if (pastedText) {
             // Only allow pasting up to limit
             const remaining = 50 - this.currentInput.length;
             if (remaining > 0) {
                 this.currentInput += pastedText.substring(0, remaining);
                 this.inputText.setText(this.currentInput);
                 this.updateCursorPosition();
             }
        }
    }

    private removeMobileInput() {
        if (this.mobileInput) {
            const input = this.mobileInput;
            const form = input.parentElement; // Get wrapper form
            
            this.mobileInput = null;
            
            // Force blur to dismiss keyboard
            try { 
                input.blur(); 
            } catch(e) {}
            
            // Remove from DOM
            if (form && form.parentNode) {
                form.parentNode.removeChild(form);
            } else if (input.parentNode) {
                // Fallback if not in form for some reason
                input.parentNode.removeChild(input);
            }
        }
    }
    
    handleKeyDown(event: KeyboardEvent): boolean {
        if (!this.isFocused) {
            // Check for chat open keys
            if (event.key === 't' || event.key === 'T' || event.key === '/') {
                event.preventDefault();
                this.focus();
                if (event.key === '/') {
                    this.currentInput = '/';
                    this.inputText.setText('/');
                    this.updateCursorPosition();
                }
                return true;
            }
            return false;
        }

        // On mobile with native input, let the browser handle typing events
        if (this.isMobile && this.mobileInput) {
            if (event.key === 'Enter') {
                this.send();
                return true;
            }
            // Allow other keys (letters, backspace) to propagate to the input
            return false;
        }
        
        // Chat is focused (Desktop) - prevent default to stop game controls/browser shortcuts
        event.preventDefault();
        event.stopPropagation();
        
        if (event.key === 'Enter') {
            this.send();
            return true;
        }
        
        if (event.key === 'Escape') {
            this.blur();
            return true;
        }
        
        if (event.key === 'Backspace') {
            this.currentInput = this.currentInput.slice(0, -1);
            this.inputText.setText(this.currentInput);
            this.updateCursorPosition();
            return true;
        }
        
        // Ignore control keys
        if (event.key.length > 1) return true;
        
        // Add character
        if (this.currentInput.length < 50) {
            this.currentInput += event.key;
            this.inputText.setText(this.currentInput);
            this.updateCursorPosition();
        }
        
        return true;
    }
    
    private send() {
        const message = this.currentInput.trim();
        
        if (message.length > 0) {
            this.onSendMessage?.(message);
            // Only clear input if message was sent
            this.currentInput = '';
            this.inputText.setText('');
        }
        
        this.blur();
    }
    
    private updateCursorPosition() {
        // Handle wrapped text cursor positioning
        // Get the wrapped lines from Phaser's internal text structure if possible, 
        // or rely on dimensions.
        // Since we write char-by-char, last char is at end.
        
        // Basic cursor calc for single line:
        // this.inputCursor.setPosition(this.padding + this.inputText.width + 1, this.inputText.y);
        
        // For multiline, we need position of the end of the text.
        // Phaser Text doesn't explicitly expose "last character position".
        // However, we can calculate it by checking the last line width.
        
        const lines = this.inputText.getWrappedText(this.currentInput);
        const lineCount = lines.length;
        
        if (lineCount <= 1) {
            this.inputCursor.setPosition(this.inputText.x + this.inputText.width + 1, this.inputText.y);
        } else {
            // Measure the last line's width
            const lastLine = lines[lineCount - 1];
            // We need a temporary text object to measure just this line segment with same style
            // Or we can assume specific font metrics. Let's create a temp text for accuracy.
            const tempText = this.scene.add.text(0, 0, lastLine, {
                fontFamily: 'Minecraft, monospace',
                fontSize: '14px',
            });
            const lastLineWidth = tempText.width;
            tempText.destroy();
            
            // Calculate Y offset based on line height (which Phaser handles internally)
            // Phaser default line spacing is 0, but line height is fontSize usually.
            // this.inputText.height should be total height.
            // If we have N lines, the last line is at Y + (N-1) * (lineHeight usually).
            // Actually, (this.inputText.height / lineCount) approximates line height.
            const lineHeight = this.inputText.height / lineCount;
            const lastLineY = this.inputText.y + (lineCount - 1) * lineHeight;
            
            this.inputCursor.setPosition(this.inputText.x + lastLineWidth + 1, lastLineY);
        }
        
        // Also ensure layout is updated if height changed
        if (this.isFocused) {
            // We need to trigger a layout update because input area might have grown
            // Re-render messages is overkill, just update input layout
            // But updateInputLayout takes messageAreaHeight which we need to recall or store.
            // Let's store the last used message height
            const currentMessageHeight = this.messageContainer.getAll().reduce((acc: number, child: any) => {
                 // The last child in messageContainer has the greatest Y + height
                 return Math.max(acc, child.y + Math.max(this.messageHeight, (child.list[1] as Phaser.GameObjects.Text).height) + 2);
            }, 0);
            
            this.updateInputLayout(currentMessageHeight);
        }
    }
    
    addMessage(msg: ChatMessage) {
        this.messages.push(msg);
        
        // Trim old messages
        if (this.messages.length > this.maxMessages) {
            this.messages.shift();
        }
        
        this.renderMessages();
    }
    
    private renderMessages() {
        // Clear existing
        this.messageContainer.removeAll(true);
        this.messageTexts = [];
        
        const now = Date.now();
        // Calculate max area for messages (based on total height - input area)
        // Default message area height roughly
        const maxMessageAreaHeight = this.maxVisibleMessages * this.messageHeight;
        
        // Filter messages first by time if needed
        const candidateMessages = this.isFocused 
            ? this.messages
            : this.messages.filter(m => now - m.timestamp < this.unfocusedMessageDuration);
            
        // Process messages from newest to oldest to fit them in the area
        const messagesToRender: { msg: ChatMessage, height: number, container: Phaser.GameObjects.Container }[] = [];
        let totalHeight = 0;
        
        // We only render as many as fit in the area
        // Iterate backwards from newest
        for (let i = candidateMessages.length - 1; i >= 0; i--) {
            const msg = candidateMessages[i];
            
            // Create temporary display to measure
            // Note: We don't know Y yet, so use 0. We'll set it later.
            const msgContainer = this.createMessageDisplay(msg, 0);
            const messageText = msgContainer.getAt(1) as Phaser.GameObjects.Text;
            const messageHeight = Math.max(this.messageHeight, messageText.height);
            const entryHeight = messageHeight + 2; // + padding
            
            if (totalHeight + entryHeight > maxMessageAreaHeight + 20) { // Slight buffer
               // Too tall, stop adding, and destroy this container since we won't use it
               msgContainer.destroy();
               break;
            }
            
            totalHeight += entryHeight;
            messagesToRender.unshift({ msg, height: entryHeight, container: msgContainer });
        }
        
        // Now position them top-down
        let currentY = 0;

        messagesToRender.forEach((item) => {
            const { msg, height, container } = item;
            
            // Set correct Y position
            container.y = currentY;
            
            this.messageContainer.add(container);
            this.messageTexts.push({ container: container, timestamp: msg.timestamp });
            
            currentY += height;
        });

        // Update layout if focused to accommodate variable message heights
        if (this.isFocused) {
            this.updateInputLayout(currentY);
            // Ensure cursor position is updated after layout change
            this.updateCursorPosition();
        }
    }

    private updateInputLayout(messageAreaHeight: number) {
        // Position input below messages, but ensure minimum height conforms to design
        // Default was around maxVisibleMessages * messageHeight
        const defaultHeight = this.maxVisibleMessages * this.messageHeight;
        const startY = Math.max(defaultHeight, messageAreaHeight) + this.padding * 2;
        
        // Move input elements
        this.inputBackground.y = startY;
        this.inputText.y = startY + 6;
        this.mobileHint.y = startY + 6;
        
        // Update background height based on INPUT TEXT height (which grows)
        // Ensure minimum input height
        const currentInputHeight = Math.max(this.inputHeight, this.inputText.height + 12); // +12 for padding top/bottom
        
        // Update input background height
        this.inputBackground.height = currentInputHeight;
        
        const totalHeight = startY + currentInputHeight + this.padding;
        this.background.height = totalHeight;
    }
    
    private createMessageDisplay(msg: ChatMessage, y: number): Phaser.GameObjects.Container {
        const container = this.scene.add.container(0, y);
        
        const nameColor = colorToHex(hashToColor(msg.odcid));
        
        const nameText = this.scene.add.text(0, 0, msg.username + ': ', {
            fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
            fontSize: '14px',
            color: msg.isSystem ? '#ff0000' : nameColor
        });
        container.add(nameText);
        
        const parsedMessage = EmojiMap.parse(msg.message);

        const messageText = this.scene.add.text(nameText.width, 0, parsedMessage, {
            fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
            fontSize: '14px',
            color: msg.isSystem ? '#ff0000' : '#ffffff',
            wordWrap: { width: this.width - this.padding * 2 - nameText.width, useAdvancedWrap: true }
        });
        container.add(messageText);
        
        return container;
    }
    
    private cleanupOldMessages() {
        if (this.isFocused) return;
        
        const now = Date.now();
        let needsRender = false;
        
        for (const mt of this.messageTexts) {
            if (now - mt.timestamp >= this.unfocusedMessageDuration) {
                needsRender = true;
                break;
            }
        }
        
        if (needsRender) {
            this.renderMessages();
        }
    }
    
    private promptMobileKeyboard() {
        // Clean up any existing input first
        this.removeMobileInput();

        // Find the game container (usually #app or canvas container) to handle fullscreen
        const gameContainer = document.getElementById('app') || document.body;
        
        // Create form wrapper - helps with iOS "Go" button handling
        const form = document.createElement('form');
        form.action = 'javascript:void(0);'; // Prevent actual submission
        form.style.cssText = `
            position: fixed;
            top: 0px;
            left: 0px;
            width: 1px;
            height: 1px;
            opacity: 0;
            z-index: -1;
            overflow: hidden;
        `;

        // Create input element
        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.currentInput; // Initialize with current draft
        input.autocomplete = 'off';
        input.autocapitalize = 'off';
        input.spellcheck = false;
        // Important: font-size >= 16px prevents iOS from zooming in
        input.style.cssText = `
            font-size: 16px;
            width: 100%;
            height: 100%;
            border: 0;
            outline: 0;
            margin: 0;
            padding: 0;
            pointer-events: auto;
        `;
        
        form.appendChild(input);
        gameContainer.appendChild(form);
        this.mobileInput = input;
        
        let isHandlingSubmit = false;
        
        const handleInput = () => {
            if (!this.isFocused || isHandlingSubmit) return;
            
            if (input.value.length > 50) {
                input.value = input.value.substring(0, 50);
            }
            
            this.currentInput = input.value;
            this.inputText.setText(this.currentInput);
            this.updateCursorPosition();
        };
        
        const handleSubmit = (e?: Event) => {
            e?.preventDefault();
            if (isHandlingSubmit) return;
            isHandlingSubmit = true;
            
            if (this.isFocused) {
                this.send();
            }
        };

        const handleKeydown = (e: KeyboardEvent) => {
            // Stop propagation so Phaser key captures (SPACE, WASD) don't intercept this event
            e.stopPropagation();
            
            // Allow Enter to work (it might trigger submit or our own handler)
            if (e.key === 'Enter') {
                // We handle Enter via the global handler mostly, but for the input itself,
                // we want it to submit the form if possible, or just let it bubble to our logic.
                // Actually, stopping propagation stops it from reaching window listeners!
                // So the UIScene listener won't fire for this specific event if we stop it here.
                
                // However, handleKeyDown in Chat.ts is called by UIScene's CAPTURE listener.
                // Capture happens BEFORE target bubble.
                // So UIScene sees it first.
                
                // But the browser default action for Space/Text happens during Target/Default phase.
                // Phaser listens on Window Bubble (usually).
                // So stopping propagation here prevents Phaser (Window Bubble) from seeing it.
                // It does NOT prevent UIScene (Window Capture) from having already seen it.
                
                // Does Phaser capture prevent default? Yes.
                // Does Phaser capture happen on Window? Yes.
                // If Phaser listens on Window Bubble, stopPropagation here works.
                // If Phaser listens on Window Keydown (without capture flag, so bubble), it works.
            }
        };

        const handleBlur = () => {
            // Small delay to allow submit to fire first if that was the cause of blur
            setTimeout(() => {
                if (isHandlingSubmit) return;
                
                // If keyboard was dismissed but we didn't send/close, we should probably close
                // to keep UI state consistent.
                if (this.isFocused) {
                    this.blur(); 
                }
            }, 50);
        };
        
        // Listeners on the input
        input.addEventListener('input', handleInput);
        input.addEventListener('blur', handleBlur);
        input.addEventListener('keydown', handleKeydown);
        
        // Listen for "Go" / "Enter" via form submit (more reliable on iOS)
        form.addEventListener('submit', handleSubmit);
        
        // Prevent form submission from reloading page (redundant with action, but safe)
        form.onsubmit = (e) => {
            e.preventDefault();
            handleSubmit(e);
            return false;
        };
        
        // Focus immediately - essential for iOS
        // If this method was called from a touch event, this should work synchronously
        try {
            input.focus();
            input.click(); // Sometimes helps wake up certain Android webviews
        } catch (e) {
            console.error('Failed to focus mobile input:', e);
        }
    }
    
    destroy() {
        this.removeMobileInput();
        this.cursorTimer?.destroy();
        this.container.destroy();
    }
}
