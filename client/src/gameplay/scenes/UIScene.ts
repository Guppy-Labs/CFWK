import Phaser from 'phaser';
import { StaminaBar } from '../ui/StaminaBar';
import { TabList, TabListEntry } from '../ui/TabList';
import { Chat, ChatMessage } from '../ui/Chat';
import { NetworkManager } from '../network/NetworkManager';

export class UIScene extends Phaser.Scene {
    private staminaBar?: StaminaBar;
    private tabList?: TabList;
    private chat?: Chat;
    private tabKeyDownHandler?: (event: KeyboardEvent) => void;
    private tabKeyUpHandler?: (event: KeyboardEvent) => void;
    private chatKeyHandler?: (event: KeyboardEvent) => void;
    private networkManager = NetworkManager.getInstance();
    private nextTabListSync = 0;

    constructor() {
        super({ key: 'UIScene' });
    }

    create() {
        this.staminaBar = new StaminaBar(this);
        this.tabList = new TabList(this);
        this.chat = new Chat(this);

        // Setup chat callbacks
        this.chat.setOnSendMessage((message) => {
            this.networkManager.sendChatMessage(message);
        });

        this.chat.setOnFocusChange((focused) => {
            // Notify GameScene that chat is focused/unfocused
            this.registry.set('chatFocused', focused);
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
                event.preventDefault();
                this.tabList?.show();
            });
            tabKey.on('up', (event: KeyboardEvent) => {
                event.preventDefault();
                this.tabList?.hide();
            });
        }

        // Intercept Tab at the window level to prevent default focus behavior
        this.tabKeyDownHandler = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            // Don't show tablist while chat is focused
            if (this.chat?.isChatFocused()) return;
            event.preventDefault();
            this.tabList?.show();
        };
        this.tabKeyUpHandler = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            event.preventDefault();
            this.tabList?.hide();
        };
        window.addEventListener('keydown', this.tabKeyDownHandler, { capture: true });
        window.addEventListener('keyup', this.tabKeyUpHandler, { capture: true });

        // Intercept chat keys at window level
        this.chatKeyHandler = (event: KeyboardEvent) => {
            // Let the chat handle all keys when focused, or open keys when not
            if (this.chat?.handleKeyDown(event)) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        window.addEventListener('keydown', this.chatKeyHandler, { capture: true });

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
            this.chat?.destroy();
        });
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
