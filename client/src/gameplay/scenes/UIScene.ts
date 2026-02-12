import Phaser from 'phaser';
import { PlayerHud } from '../ui/PlayerHud';
import { TabListEntry } from '../ui/HeadbarTabList';
import { Chat, ChatMessage } from '../ui/Chat';
import { BookUI } from '../ui/BookUI';
import { HeadbarUI } from '../ui/HeadbarUI';
import { NetworkManager } from '../network/NetworkManager';
import { InventoryChangeMonitor } from '../ui/InventoryChangeMonitor';
import { ITEM_DEFINITIONS, getItemImagePath } from '@cfwk/shared';
import { DialogueUI } from '../ui/DialogueUI';
import type { DialogueRenderLine } from '../dialogue/DialogueTypes';

export class UIScene extends Phaser.Scene {
    private playerHud?: PlayerHud;
    private chat?: Chat;
    private bookUI?: BookUI;
    private headbarUI?: HeadbarUI;
    private inventoryChangeMonitor?: InventoryChangeMonitor;
    private dialogueUI?: DialogueUI;
    private dialogueActive = false;
    private pendingDialogueAdvanceHandler?: () => void;
    private tabKeyDownHandler?: (event: KeyboardEvent) => void;
    private tabKeyUpHandler?: (event: KeyboardEvent) => void;
    private chatKeyHandler?: (event: KeyboardEvent) => void;
    private bookKeyHandler?: (event: KeyboardEvent) => void;
    private mobileInventoryHandler?: () => void;
    private mobileMenuHandler?: () => void;
    private inventoryUpdateHandler?: (event: Event) => void;
    private nearWaterHandler?: (parent: any, value: boolean) => void;
    private networkManager = NetworkManager.getInstance();
    private cursorDefaultUrl?: string;
    private cursorHoverUrl?: string;
    private hoverCount = 0;

    constructor() {
        super({ key: 'UIScene' });
    }

    preload() {
        this.load.image('ui-book-cover', '/ui/BookCover01a.png');
        this.load.image('ui-book-page-left', '/ui/BookPageL01a.png');
        this.load.image('ui-book-page-right', '/ui/BookPageR01a.png');
        this.load.image('ui-tab-active', '/ui/Marker01a.png');
        this.load.image('ui-tab-inactive', '/ui/Marker01b.png');
        this.load.image('ui-group-button-selected', '/ui/Button08a.png');
        this.load.image('ui-group-button-unselected', '/ui/Button08b.png');
        this.load.image('ui-section-icon-all', '/ui/sections/IconAll.png');
        this.load.image('ui-section-icon-all-sel', '/ui/sections/IconAllSel.png');
        this.load.image('ui-section-icon-gear', '/ui/sections/IconGear.png');
        this.load.image('ui-section-icon-gear-sel', '/ui/sections/IconGearSel.png');
        this.load.image('ui-section-icon-tools', '/ui/sections/IconTools.png');
        this.load.image('ui-section-icon-tools-sel', '/ui/sections/IconToolsSel.png');
        this.load.image('ui-section-icon-fishing', '/ui/sections/IconFishing.png');
        this.load.image('ui-section-icon-fishing-sel', '/ui/sections/IconFishingSel.png');
        this.load.image('ui-section-icon-food', '/ui/sections/IconFood.png');
        this.load.image('ui-section-icon-food-sel', '/ui/sections/IconFoodSel.png');
        this.load.image('ui-group-icon-loot-active', '/ui/IconLoot01b.png');
        this.load.image('ui-group-icon-loot-inactive', '/ui/IconLoot01a.png');
        this.load.image('ui-item-info-frame', '/ui/Frame07a.png');
        this.load.image('ui-afk-frame', '/ui/Frame09a.png');
        this.load.image('ui-item-info-divider', '/ui/Line03a.png');
        this.load.image('ui-slot-base', '/ui/Slot01a.png');
        this.load.image('ui-slot-extended', '/ui/Slot01e.png');
        this.load.image('ui-slot-empty', '/ui/Slot01g.png');
        this.load.image('ui-slot-filled', '/ui/Slot01b.png');
        this.load.image('ui-slot-select-1', '/ui/select/sel1.png');
        this.load.image('ui-slot-select-2', '/ui/select/sel2.png');
        this.load.image('ui-slot-select-3', '/ui/select/sel3.png');
        this.load.image('ui-slot-select-4', '/ui/select/sel4.png');
        this.load.image('ui-scrollbar-track', '/ui/Bar07a.png');
        this.load.image('ui-scrollbar-thumb', '/ui/IconHandle03a.png');
        this.load.image('ui-hud-slot', '/ui/Slot02e.png');
        this.load.image('ui-hud-slot-filled', '/ui/Slot02b.png');
        this.load.image('ui-hud-heart', '/ui/IconHealth01a.png');
        this.load.image('ui-hud-stamina-bg', '/ui/Bar04a.png');
        this.load.image('ui-hud-stamina-fill', '/ui/Fill02a.png');
        this.load.image('ui-hud-key-r', '/ui/keys/R.png');
        this.load.image('ui-hud-key-e', '/ui/keys/E.png');
        this.load.image('ui-hud-key-f', '/ui/keys/F.png');
        this.load.image('ui-backpack', '/ui/Backpack01a.png');
        this.load.image('ui-interact-chat', '/ui/InteractChat01a.png');
        this.load.image('ui-interact-blank', '/ui/InteractBlank01a.png');
        this.load.image('ui-menu', '/ui/Menu01a.png');
        this.load.image('ui-fullscreen', '/ui/Fullscreen01a.png');
        this.load.image('ui-exit-fullscreen', '/ui/ExitFullscreen01a.png');
        this.load.image('ui-font', '/assets/font/game-font.png');
        this.load.text('ui-font-map', '/assets/font/game-font.map.txt');
        this.load.image('ui-cursor-default', '/ui/Cursor03b.png');
        this.load.image('ui-cursor-hover', '/ui/Cursor03c.png');
        this.load.image('ui-dialogue-cursor', '/ui/Cursor03a.png');
        this.load.image('ui-dialogue-content', '/ui/dialogue/content.png');
        this.load.image('ui-dialogue-name', '/ui/dialogue/name.png');
        this.load.image('dialogue-char-test-angry', '/ui/dialogue/chars/test/angry.png');
        this.load.image('dialogue-char-test-disgust', '/ui/dialogue/chars/test/disgust.png');
        this.load.image('dialogue-char-test-fear', '/ui/dialogue/chars/test/fear.png');
        this.load.image('dialogue-char-test-happy', '/ui/dialogue/chars/test/happy.png');
        this.load.image('dialogue-char-test-sad', '/ui/dialogue/chars/test/sad.png');
        this.load.image('dialogue-char-test-surprise', '/ui/dialogue/chars/test/surprise.png');
        this.load.image('dialogue-char-mc-angry', '/ui/dialogue/chars/mc/angry.png');
        this.load.image('dialogue-char-mc-disgust', '/ui/dialogue/chars/mc/disgust.png');
        this.load.image('dialogue-char-mc-happy', '/ui/dialogue/chars/mc/happy.png');
        this.load.image('dialogue-char-mc-sad', '/ui/dialogue/chars/mc/sad.png');
        this.load.image('dialogue-char-mc-surprise', '/ui/dialogue/chars/mc/surprise.png');

        // Headbar textures
        this.load.image('ui-headbar-banner', '/ui/Banner01b.png');
        this.load.image('ui-season-winter', '/ui/seasons/winter.png');
        this.load.image('ui-season-spring', '/ui/seasons/spring.png');
        this.load.image('ui-season-summer', '/ui/seasons/summer.png');
        this.load.image('ui-season-autumn', '/ui/seasons/autumn.png');

        ITEM_DEFINITIONS.forEach((item) => {
            const imagePath = getItemImagePath(item.id);
            if (imagePath) {
                this.load.image(`item-${item.id}`, `/${imagePath}`);
            }
        });
    }

    create() {
        this.preloadItemIconTextures();
        this.setupCustomCursor();
        this.playerHud = new PlayerHud(this);
        this.chat = new Chat(this);
        this.bookUI = new BookUI(this);
        this.headbarUI = new HeadbarUI(this);
        this.inventoryChangeMonitor = new InventoryChangeMonitor(this);
        this.dialogueUI = new DialogueUI(this);
        if (this.pendingDialogueAdvanceHandler) {
            this.dialogueUI.setOnAdvance(this.pendingDialogueAdvanceHandler);
            this.pendingDialogueAdvanceHandler = undefined;
        }
        this.playerHud.setOnRodUse(() => {
            window.dispatchEvent(new CustomEvent('hud:rod-use'));
        });

        this.inventoryUpdateHandler = (event: Event) => {
            const customEvent = event as CustomEvent<{ equippedRodId?: string | null }>;
            const equippedRodId = customEvent.detail?.equippedRodId ?? null;
            this.playerHud?.setEquippedRod(equippedRodId);
        };
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);

        this.networkManager.getInventory().then((data) => {
            if (data?.equippedRodId !== undefined) {
                this.playerHud?.setEquippedRod(data.equippedRodId ?? null);
            }
        });

        this.nearWaterHandler = (_parent: any, value: boolean) => {
            this.playerHud?.setRodNearWater(Boolean(value));
        };
        this.registry.events.on('changedata-nearWater', this.nearWaterHandler);
        const currentNearWater = this.registry.get('nearWater');
        if (typeof currentNearWater === 'boolean') {
            this.playerHud?.setRodNearWater(currentNearWater);
        }

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
        this.registry.events.on('changedata-stamina', (_parent: any, value: number) => {
            if (this.playerHud) {
                this.playerHud.setStamina(value);
            }
        });

        // Initialize with current value if exists
        const currentStamina = this.registry.get('stamina');
        if (typeof currentStamina === 'number') {
            this.playerHud.setStamina(currentStamina);
        }

        const currentPlayers = this.registry.get('tablistPlayers') as TabListEntry[] | undefined;
        if (this.headbarUI && Array.isArray(currentPlayers)) {
            this.headbarUI.setPlayers(currentPlayers);
        }

        this.registry.events.on('changedata-tablistPlayers', (_parent: any, value: TabListEntry[]) => {
            if (this.headbarUI && Array.isArray(value)) {
                this.headbarUI.setPlayers(value);
            }
        });

        const tabKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
        if (tabKey) {
            tabKey.on('down', (event: KeyboardEvent) => {
                // Don't show tablist while chat is focused
                if (this.chat?.isChatFocused()) return;
                if (this.registry.get('guiOpen') === true) return;
                event.preventDefault();
                this.headbarUI?.showTabList();
            });
            tabKey.on('up', (event: KeyboardEvent) => {
                if (this.registry.get('guiOpen') === true) return;
                event.preventDefault();
                this.headbarUI?.hideTabList();
            });
        }

        // Intercept Tab at the window level to prevent default focus behavior
        this.tabKeyDownHandler = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            // Don't show tablist while chat is focused
            if (this.chat?.isChatFocused()) return;
            if (this.registry.get('guiOpen') === true) return;
            event.preventDefault();
            this.headbarUI?.showTabList();
        };
        this.tabKeyUpHandler = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            if (this.registry.get('guiOpen') === true) return;
            event.preventDefault();
            this.headbarUI?.hideTabList();
        };
        window.addEventListener('keydown', this.tabKeyDownHandler, { capture: true });
        window.addEventListener('keyup', this.tabKeyUpHandler, { capture: true });

        // Intercept chat keys at window level
        this.chatKeyHandler = (event: KeyboardEvent) => {
            if (this.registry.get('inputBlocked') === true) return;
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
            if (this.registry.get('inputBlocked') === true) return;
            if (this.chat?.isChatFocused()) return;
            event.preventDefault();
            event.stopPropagation();
            if (this.bookUI?.isOpen()) {
                this.bookUI.close();
            } else {
                this.bookUI?.openToTab('Inventory');
            }
            const isOpen = this.bookUI?.isOpen() === true;
            this.registry.set('guiOpen', isOpen);
            this.chat?.setMobileHintSuppressed(isOpen);
            window.dispatchEvent(new CustomEvent('gui-open-changed', { detail: { isOpen, source: 'inventory' } }));
            if (isOpen && this.chat?.isChatFocused()) {
                this.chat.blur();
            }
            this.networkManager.sendGuiOpen(isOpen);
            markActivity();
        };
        window.addEventListener('keydown', this.bookKeyHandler, { capture: true });

        this.mobileInventoryHandler = () => {
            if (this.registry.get('inputBlocked') === true) return;
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
            window.dispatchEvent(new CustomEvent('gui-open-changed', { detail: { isOpen, source: 'inventory' } }));
            if (isOpen && this.chat?.isChatFocused()) {
                this.chat.blur();
            }
            this.networkManager.sendGuiOpen(isOpen);
            markActivity();
        };
        window.addEventListener('mobile:inventory', this.mobileInventoryHandler as EventListener);

        this.mobileMenuHandler = () => {
            if (this.registry.get('inputBlocked') === true) return;
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
            window.dispatchEvent(new CustomEvent('gui-open-changed', { detail: { isOpen, source: 'menu' } }));
            if (isOpen && this.chat?.isChatFocused()) {
                this.chat.blur();
            }
            this.networkManager.sendGuiOpen(isOpen);
            markActivity();
        };
        window.addEventListener('mobile:menu', this.mobileMenuHandler as EventListener);

        window.addEventListener('pointerdown', markActivity, { capture: true });
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
            if (this.inventoryUpdateHandler) {
                window.removeEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
            }
            if (this.nearWaterHandler) {
                this.registry.events.off('changedata-nearWater', this.nearWaterHandler);
            }
            window.removeEventListener('pointerdown', markActivity, { capture: true } as any);
            window.removeEventListener('mousedown', markActivity, { capture: true } as any);
            window.removeEventListener('touchstart', markActivity, { capture: true } as any);
            this.scale.off('resize', this.onResize, this);
            this.chat?.destroy();
            this.bookUI?.destroy();
            this.headbarUI?.destroy();
            this.playerHud?.destroy();
            this.inventoryChangeMonitor?.destroy();
            this.dialogueUI?.destroy();
        });
    }

    setHudVisible(visible: boolean) {
        this.playerHud?.setVisible(visible);
    }

    setDialogueAdvanceHandler(handler: () => void) {
        if (this.dialogueUI) {
            this.dialogueUI.setOnAdvance(handler);
        } else {
            this.pendingDialogueAdvanceHandler = handler;
        }
    }

    showDialogueLine(line: DialogueRenderLine) {
        this.dialogueUI?.showLine(line);
    }

    setDialogueActive(active: boolean) {
        if (this.dialogueActive === active) return;
        this.dialogueActive = active;

        if (active) {
            if (this.chat?.isChatFocused()) {
                this.chat.blur();
            }
            if (this.bookUI?.isOpen()) {
                this.bookUI.close();
                this.registry.set('guiOpen', false);
                window.dispatchEvent(new CustomEvent('gui-open-changed', { detail: { isOpen: false, source: 'dialogue' } }));
            }
        } else {
            this.dialogueUI?.hide();
        }

        this.playerHud?.setVisible(!active);
        this.headbarUI?.setVisible(!active);
        this.chat?.setVisible(!active);
        this.inventoryChangeMonitor?.setVisible(!active);
    }

    private setupCustomCursor() {
        this.cursorDefaultUrl = this.createScaledCursorDataUrl('ui-cursor-default', 2);
        this.cursorHoverUrl = this.createScaledCursorDataUrl('ui-cursor-hover', 2);

        if (this.cursorDefaultUrl) {
            this.input.setDefaultCursor(`url(${this.cursorDefaultUrl}) 0 0, auto`);
        }

        this.input.on(Phaser.Input.Events.GAMEOBJECT_OVER, (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
            const ignoreCursor = (gameObject as any).getData?.('ignoreCursor') === true;
            if (ignoreCursor) return;
            this.hoverCount += 1;
            if (this.cursorHoverUrl) {
                this.input.setDefaultCursor(`url(${this.cursorHoverUrl}) 0 0, auto`);
            }
        });

        this.input.on(Phaser.Input.Events.GAMEOBJECT_OUT, (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
            const ignoreCursor = (gameObject as any).getData?.('ignoreCursor') === true;
            if (ignoreCursor) return;
            this.hoverCount = Math.max(0, this.hoverCount - 1);
            if (this.hoverCount === 0 && this.cursorDefaultUrl) {
                this.input.setDefaultCursor(`url(${this.cursorDefaultUrl}) 0 0, auto`);
            }
        });
    }

    private createScaledCursorDataUrl(textureKey: string, scale: number) {
        if (!this.textures.exists(textureKey)) return undefined;
        const texture = this.textures.get(textureKey);
        const source = texture.getSourceImage() as HTMLImageElement;
        if (!source) return undefined;

        const canvas = document.createElement('canvas');
        canvas.width = source.width * scale;
        canvas.height = source.height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

        return canvas.toDataURL('image/png');
    }

    private preloadItemIconTextures() {
        const targetSize = 18;
        ITEM_DEFINITIONS.forEach((item) => {
            const baseKey = `item-${item.id}`;
            const scaledKey = `${baseKey}-18`;

            if (this.textures.exists(scaledKey)) {
                return;
            }

            if (!this.textures.exists(baseKey)) {
                console.warn(`[UIScene] Missing base texture for item ${item.id}`);
                return;
            }

            const texture = this.textures.get(baseKey);
            const source = texture.getSourceImage() as HTMLImageElement;
            if (!source) return;

            const canvas = document.createElement('canvas');
            canvas.width = targetSize;
            canvas.height = targetSize;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(source, 0, 0, targetSize, targetSize);

            this.textures.addCanvas(scaledKey, canvas);
        });
    }

    private onResize() {
        this.bookUI?.layout();
        this.chat?.refreshLayout();
        this.headbarUI?.layout();
        this.playerHud?.layout();
        this.inventoryChangeMonitor?.layout();
        this.dialogueUI?.layout();
    }

    private setupChatListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.onMessage('chat', (data: { sessionId: string; username: string; odcid: string; message: string; timestamp: number; isSystem?: boolean; isPremium?: boolean }) => {
            const msg: ChatMessage = {
                username: data.username,
                odcid: data.odcid,
                message: data.message,
                timestamp: data.timestamp,
                isSystem: data.isSystem,
                isPremium: data.isPremium
            };
            this.chat?.addMessage(msg);

            // Emit to game for bubbles
            this.game.events.emit('chat-message', data);
        });
    }

    update(_time: number, delta: number) {
        this.playerHud?.update(delta);
        this.inventoryChangeMonitor?.update();

        if (this.headbarUI) {
            this.headbarUI.update();
        }
    }
}
