import Phaser from 'phaser';
import { StaminaBar } from '../ui/StaminaBar';
import { TabList, TabListEntry } from '../ui/TabList';
import { Chat, ChatMessage } from '../ui/Chat';
import { BookUI } from '../ui/BookUI';
import { NetworkManager } from '../network/NetworkManager';

export class UIScene extends Phaser.Scene {
    private staminaBar?: StaminaBar;
    private tabList?: TabList;
    private chat?: Chat;
    private bookUI?: BookUI;
    private tabKeyDownHandler?: (event: KeyboardEvent) => void;
    private tabKeyUpHandler?: (event: KeyboardEvent) => void;
    private chatKeyHandler?: (event: KeyboardEvent) => void;
    private bookKeyHandler?: (event: KeyboardEvent) => void;
    private mobileInventoryHandler?: () => void;
    private mobileMenuHandler?: () => void;
    private networkManager = NetworkManager.getInstance();
    private nextTabListSync = 0;

    constructor() {
        super({ key: 'UIScene' });
    }

    preload() {
        this.load.image('ui-book-cover', '/ui/BookCover01a.png');
        this.load.image('ui-book-page-left', '/ui/BookPageL01a.png');
        this.load.image('ui-book-page-right', '/ui/BookPageR01a.png');
        this.load.image('ui-tab-active', '/ui/Marker01a.png');
        this.load.image('ui-tab-inactive', '/ui/Marker01b.png');
        this.load.image('ui-font', '/assets/font/game-font.png');
    }

    create() {
        this.staminaBar = new StaminaBar(this);
        this.tabList = new TabList(this);
        this.chat = new Chat(this);
        this.bookUI = new BookUI(this);

        this.registry.set('guiOpen', false);

        const markActivity = () => this.registry.set('afkActivity', Date.now());

        // Setup chat callbacks
        this.chat.setOnSendMessage((message) => {
            markActivity();
            this.networkManager.sendChatMessage(message);
        });

        this.chat.setOnFocusChange((focused) => {
            if (focused) markActivity();
            // Notify GameScene that chat is focused/unfocused
            this.registry.set('chatFocused', focused);
            this.networkManager.sendChatFocus(focused);
        });

        // Setup chat message listener
        this.setupChatListener();

        // Listen for stamina changes from the registry
        this.registry.events.on('changedata-stamina', (parent: any, value: number) => {
            if (this.staminaBar) {
                this.staminaBar.setStamina(value);
            }
        });

        // Initialize with current value if exists
        const currentStamina = this.registry.get('stamina');
        if (typeof currentStamina === 'number') {
            this.staminaBar.setStamina(currentStamina);
        }

        const currentPlayers = this.registry.get('tablistPlayers') as TabListEntry[] | undefined;
        if (this.tabList && Array.isArray(currentPlayers)) {
            this.tabList.setPlayers(currentPlayers);
        }

        this.registry.events.on('changedata-tablistPlayers', (_parent: any, value: TabListEntry[]) => {
            if (this.tabList && Array.isArray(value)) {
                this.tabList.setPlayers(value);
            }
        });

        const tabKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
        if (tabKey) {
            tabKey.on('down', (event: KeyboardEvent) => {
                // Don't show tablist while chat is focused
                if (this.chat?.isChatFocused()) return;
                if (this.registry.get('guiOpen') === true) return;
                event.preventDefault();
                this.tabList?.show();
            });
            tabKey.on('up', (event: KeyboardEvent) => {
                if (this.registry.get('guiOpen') === true) return;
                event.preventDefault();
                this.tabList?.hide();
            });
        }

        // Intercept Tab at the window level to prevent default focus behavior
        this.tabKeyDownHandler = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            // Don't show tablist while chat is focused
            if (this.chat?.isChatFocused()) return;
            if (this.registry.get('guiOpen') === true) return;
            event.preventDefault();
            this.tabList?.show();
        };
        this.tabKeyUpHandler = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            if (this.registry.get('guiOpen') === true) return;
            event.preventDefault();
            this.tabList?.hide();
        };
        window.addEventListener('keydown', this.tabKeyDownHandler, { capture: true });
        window.addEventListener('keyup', this.tabKeyUpHandler, { capture: true });

        // Intercept chat keys at window level
        this.chatKeyHandler = (event: KeyboardEvent) => {
            if (this.registry.get('guiOpen') === true) return;
            // Let the chat handle all keys when focused, or open keys when not
            if (this.chat?.handleKeyDown(event)) {
                markActivity();
                event.preventDefault();
                event.stopPropagation();
            }
        };
        window.addEventListener('keydown', this.chatKeyHandler, { capture: true });

        // Toggle book UI with E
        this.bookKeyHandler = (event: KeyboardEvent) => {
            if (event.repeat) return;
            if (event.key.toLowerCase() !== 'e') return;
            if (this.chat?.isChatFocused()) return;
            event.preventDefault();
            event.stopPropagation();
            this.bookUI?.toggle();
            const isOpen = this.bookUI?.isOpen() === true;
            this.registry.set('guiOpen', isOpen);
            this.chat?.setMobileHintSuppressed(isOpen);
            window.dispatchEvent(new CustomEvent('gui-open-changed', { detail: { isOpen } }));
            if (isOpen && this.chat?.isChatFocused()) {
                this.chat.blur();
            }
            this.networkManager.sendGuiOpen(isOpen);
            markActivity();
        };
        window.addEventListener('keydown', this.bookKeyHandler, { capture: true });

        this.mobileInventoryHandler = () => {
            if (this.chat?.isChatFocused()) return;
            // If already open, just close it
            if (this.bookUI?.isOpen()) {
                this.bookUI.close();
            } else {
                this.bookUI?.openToTab('Inventory');
            }
            const isOpen = this.bookUI?.isOpen() === true;
            this.registry.set('guiOpen', isOpen);
            this.chat?.setMobileHintSuppressed(isOpen);
            window.dispatchEvent(new CustomEvent('gui-open-changed', { detail: { isOpen } }));
            if (isOpen && this.chat?.isChatFocused()) {
                this.chat.blur();
            }
            this.networkManager.sendGuiOpen(isOpen);
            markActivity();
        };
        window.addEventListener('mobile:inventory', this.mobileInventoryHandler as EventListener);

        this.mobileMenuHandler = () => {
            if (this.chat?.isChatFocused()) return;
            // If already open, just close it
            if (this.bookUI?.isOpen()) {
                this.bookUI.close();
            } else {
                this.bookUI?.openToTab('Settings');
            }
            const isOpen = this.bookUI?.isOpen() === true;
            this.registry.set('guiOpen', isOpen);
            this.chat?.setMobileHintSuppressed(isOpen);
            window.dispatchEvent(new CustomEvent('gui-open-changed', { detail: { isOpen } }));
            if (isOpen && this.chat?.isChatFocused()) {
                this.chat.blur();
            }
            this.networkManager.sendGuiOpen(isOpen);
            markActivity();
        };
        window.addEventListener('mobile:menu', this.mobileMenuHandler as EventListener);

        window.addEventListener('mousedown', markActivity, { capture: true });
        window.addEventListener('touchstart', markActivity, { capture: true });

        this.scale.on('resize', this.onResize, this);

        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            if (this.tabKeyDownHandler) {
                window.removeEventListener('keydown', this.tabKeyDownHandler, { capture: true } as any);
            }
            if (this.tabKeyUpHandler) {
                window.removeEventListener('keyup', this.tabKeyUpHandler, { capture: true } as any);
            }
            if (this.chatKeyHandler) {
                window.removeEventListener('keydown', this.chatKeyHandler, { capture: true } as any);
            }
            if (this.bookKeyHandler) {
                window.removeEventListener('keydown', this.bookKeyHandler, { capture: true } as any);
            }
            if (this.mobileInventoryHandler) {
                window.removeEventListener('mobile:inventory', this.mobileInventoryHandler as EventListener);
            }
            if (this.mobileMenuHandler) {
                window.removeEventListener('mobile:menu', this.mobileMenuHandler as EventListener);
            }
            window.removeEventListener('mousedown', markActivity, { capture: true } as any);
            window.removeEventListener('touchstart', markActivity, { capture: true } as any);
            this.scale.off('resize', this.onResize, this);
            this.chat?.destroy();
            this.bookUI?.destroy();
        });
    }

    private onResize() {
        this.bookUI?.layout();
        this.chat?.refreshLayout();
    }

    private setupChatListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.onMessage('chat', (data: { sessionId: string; username: string; odcid: string; message: string; timestamp: number }) => {
            const msg: ChatMessage = {
                username: data.username,
                odcid: data.odcid,
                message: data.message,
                timestamp: data.timestamp
            };
            this.chat?.addMessage(msg);

            // Emit to game for bubbles
            this.game.events.emit('chat-message', data);
        });
    }

    update(time: number, delta: number) {
        if (this.staminaBar) {
            this.staminaBar.update(delta);
        }

        // Failsafe: Sync tablist if it appears empty but we have data
        // This handles cases where the initial registry sync was missed
        if (time > this.nextTabListSync) {
            this.nextTabListSync = time + 1000;
            if (this.tabList && this.tabList.getPlayerCount() === 0) {
                const current = this.registry.get('tablistPlayers') as TabListEntry[] | undefined;
                if (Array.isArray(current) && current.length > 0) {
                    this.tabList.setPlayers(current);
                }
            }
        }
    }
}
