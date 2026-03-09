import Phaser from 'phaser';
import { PlayerHud } from '../ui/PlayerHud';
import { TabListEntry } from '../ui/HeadbarTabList';
import { Chat, ChatMessage } from '../ui/Chat';
import { BookUI } from '../ui/BookUI';
import { HeadbarUI } from '../ui/HeadbarUI';
import { NetworkManager } from '../network/NetworkManager';
import { InventoryChangeMonitor } from '../ui/InventoryChangeMonitor';
import { SubtitleStack } from '../ui/SubtitleStack';
import { ControlActionKey, DEFAULT_GUIDE_TUTORIAL_STATE, IAdvancementAlertMessage, ITEM_DEFINITIONS, getItemImagePath } from '@cfwk/shared';
import { DialogueUI } from '../ui/DialogueUI';
import type { DialogueRenderLine } from '../dialogue/DialogueTypes';
import { KeybindManager } from '../input/KeybindManager';
import { GuideOverlay, GuideOverlayState } from '../ui/guide/GuideOverlay';
import { GuideCoordinator } from '../ui/guide/GuideCoordinator';
import { GuideInputGate } from '../ui/guide/GuideInputGate';

export class UIScene extends Phaser.Scene {
    private playerHud?: PlayerHud;
    private chat?: Chat;
    private bookUI?: BookUI;
    private headbarUI?: HeadbarUI;
    private inventoryChangeMonitor?: InventoryChangeMonitor;
    private subtitleStack?: SubtitleStack;
    private dialogueUI?: DialogueUI;
    private dialogueActive = false;
    private pendingDialogueAdvanceHandler?: () => void;
    private pendingDialogueOptionHandler?: (optionId: string) => void;
    private tabKeyDownHandler?: (event: KeyboardEvent) => void;
    private tabKeyUpHandler?: (event: KeyboardEvent) => void;
    private chatKeyHandler?: (event: KeyboardEvent) => void;
    private bookKeyHandler?: (event: KeyboardEvent) => void;
    private usableHotkeyHandler?: (event: KeyboardEvent) => void;
    private mobileInventoryHandler?: () => void;
    private mobileMenuHandler?: () => void;
    private inventoryUpdateHandler?: (event: Event) => void;
    private nearWaterHandler?: (parent: any, value: boolean) => void;
    private subtitleEventHandler?: (event: Event) => void;
    private subtitlesEnabledChangedHandler?: (event: Event) => void;
    private finbookQuestTargetedHandler?: (event: Event) => void;
    private inventoryConsumedHandler?: (event: Event) => void;
    private uiClickPointerHandler?: (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => void;
    private isPlayerListKeyHeld = false;
    private networkManager = NetworkManager.getInstance();
    private keybindManager = KeybindManager.getInstance();
    private cursorDefaultUrl?: string;
    private cursorHoverUrl?: string;
    private hoverCount = 0;
    private guideOverlay?: GuideOverlay;
    private guideCoordinator?: GuideCoordinator;
    private guideInputGate?: GuideInputGate;
    private damageBorderGlow?: Phaser.GameObjects.Graphics;
    private damageBorderTween?: Phaser.Tweens.Tween;
    private lastKnownHearts = 9;
    private hasReceivedHeartsSnapshot = false;
    private dangerCountdownText?: Phaser.GameObjects.Text;
    private dangerCountdownRegistryHandler?: (_parent: any, value: string | null) => void;

    constructor() {
        super({ key: 'UIScene' });
    }

    preload() {
        this.load.pack('ui-core-pack', '/packs/ui-core.pack.json');

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
        this.registry.set('dialogueActive', false);
        this.playerHud = new PlayerHud(this);
        this.chat = new Chat(this);
        this.bookUI = new BookUI(this);
        this.headbarUI = new HeadbarUI(this);
        this.headbarUI.setOnAdvancementAlertDisplayed((type) => {
            const audio = this.getAudioManager();
            if (!audio) return;
            if (type === 'quest-started') {
                audio.playQuestStarted?.();
            } else if (type === 'quest-objective') {
                audio.playQuestObjective?.();
            } else if (type === 'quest-completed') {
                audio.playQuestCompleted?.();
            } else if (type === 'achievement-unlocked') {
                audio.playAchievementUnlocked?.();
            } else if (type === 'area-discovered') {
                audio.playLocationDiscovered?.();
            }
        });
        this.dangerCountdownText = this.add.text(Math.floor(this.scale.width / 2), 112, '', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '28px',
            color: '#f2e9dd',
            stroke: '#2a1f12',
            strokeThickness: 4
        })
            .setOrigin(0.5, 0.5)
            .setScrollFactor(0)
            .setDepth(1005)
            .setVisible(false);
        this.inventoryChangeMonitor = new InventoryChangeMonitor(this);
        this.subtitleStack = new SubtitleStack(this);
        this.dialogueUI = new DialogueUI(this);
        this.guideOverlay = new GuideOverlay(this);
        this.guideInputGate = new GuideInputGate(this, this.keybindManager);
        this.guideInputGate.install();
        this.damageBorderGlow = this.add.graphics();
        this.damageBorderGlow.setDepth(12000);
        this.damageBorderGlow.setVisible(false);
        this.damageBorderGlow.setAlpha(0);
        this.redrawDamageBorderGlow();
        const cachedAdvancements = this.networkManager.getCachedAdvancementsState();
        this.guideCoordinator = new GuideCoordinator(this, cachedAdvancements?.tutorial ?? { ...DEFAULT_GUIDE_TUTORIAL_STATE });
        this.networkManager.getSettings().then((settings) => {
            if (!settings) return;
            const gameScene = this.scene.get('GameScene') as { getAudioManager?: () => { applyUserAudioSettings?: (audio: any) => void } | undefined };
            const audioManager = gameScene?.getAudioManager?.();
            audioManager?.applyUserAudioSettings?.(settings.audio);
            this.subtitleStack?.setEnabled(Boolean(settings.audio.subtitlesEnabled));
        });
        this.subtitleEventHandler = (event: Event) => {
            const customEvent = event as CustomEvent<{ soundKey?: string; label?: string }>;
            const soundKey = customEvent.detail?.soundKey;
            const label = customEvent.detail?.label;
            if (!soundKey || !label) return;
            this.subtitleStack?.post(soundKey, label);
        };
        window.addEventListener('audio:subtitle', this.subtitleEventHandler as EventListener);

        this.subtitlesEnabledChangedHandler = (event: Event) => {
            const customEvent = event as CustomEvent<{ enabled?: boolean }>;
            this.subtitleStack?.setEnabled(Boolean(customEvent.detail?.enabled));
        };
        window.addEventListener('audio:subtitles-enabled-changed', this.subtitlesEnabledChangedHandler as EventListener);

        this.finbookQuestTargetedHandler = (_event: Event) => {
            this.getAudioManager()?.playQuestTrack?.();
        };
        window.addEventListener('finbook:quest-targeted', this.finbookQuestTargetedHandler as EventListener);

        this.inventoryConsumedHandler = (event: Event) => {
            const customEvent = event as CustomEvent<{ itemId?: string; quantity?: number }>;
            const itemId = customEvent.detail?.itemId;
            if (!itemId) return;
            this.getAudioManager()?.playConsumableEat?.(itemId);
        };
        window.addEventListener('inventory:consumed', this.inventoryConsumedHandler as EventListener);

        this.uiClickPointerHandler = (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
            if ((gameObject as any)?.getData?.('suppressUiClickSound') === true) {
                return;
            }
            this.getAudioManager()?.playUiClick?.();
        };
        this.input.on(Phaser.Input.Events.GAMEOBJECT_DOWN, this.uiClickPointerHandler);
        if (this.pendingDialogueAdvanceHandler) {
            this.dialogueUI.setOnAdvance(this.pendingDialogueAdvanceHandler);
            this.pendingDialogueAdvanceHandler = undefined;
        }
        if (this.pendingDialogueOptionHandler) {
            this.dialogueUI.setOnOptionSelect(this.pendingDialogueOptionHandler);
            this.pendingDialogueOptionHandler = undefined;
        }
        this.playerHud.setOnRodUse(() => {
            window.dispatchEvent(new CustomEvent('hud:rod-use'));
        });
        this.playerHud.setOnUsableSlotUse((slotIndex) => this.tryUseHudUsableSlot(slotIndex));

        this.inventoryUpdateHandler = (event: Event) => {
            const customEvent = event as CustomEvent<{ equippedRodId?: string | null; equippedUsableIds?: Array<string | null> }>;
            const equippedRodId = customEvent.detail?.equippedRodId ?? null;
            this.playerHud?.setEquippedRod(equippedRodId);
            if (customEvent.detail?.equippedUsableIds) {
                this.playerHud?.setEquippedUsables(customEvent.detail.equippedUsableIds);
            }
        };
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);

        this.networkManager.getInventory().then((data) => {
            if (data?.equippedRodId !== undefined) {
                this.playerHud?.setEquippedRod(data.equippedRodId ?? null);
            }
            if (data?.equippedUsableIds) {
                this.playerHud?.setEquippedUsables(data.equippedUsableIds);
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
            this.keybindManager.clearPressedActions();
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

        const currentHearts = this.registry.get('playerHeartsCurrent');
        const maxHearts = this.registry.get('playerHeartsMax');
        if (typeof currentHearts === 'number' && typeof maxHearts === 'number') {
            this.playerHud.setHearts(currentHearts, maxHearts);
            this.lastKnownHearts = Math.max(0, Math.floor(currentHearts));
            this.hasReceivedHeartsSnapshot = true;
        } else {
            this.playerHud.setHearts(9, 9);
            this.lastKnownHearts = 9;
            this.hasReceivedHeartsSnapshot = false;
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

        this.dangerCountdownRegistryHandler = (_parent: any, value: string | null) => {
            if (!this.dangerCountdownText) return;
            const text = typeof value === 'string' ? value.trim() : '';
            if (!text) {
                this.dangerCountdownText.setVisible(false);
                return;
            }
            this.dangerCountdownText.setText(text);
            this.dangerCountdownText.setVisible(true);
        };
        this.registry.events.on('changedata-dangerZoneCountdown', this.dangerCountdownRegistryHandler);

        const initialDangerCountdown = this.registry.get('dangerZoneCountdown') as string | null | undefined;
        this.dangerCountdownRegistryHandler(null as any, initialDangerCountdown ?? null);

        // Intercept Tab at the window level to prevent default focus behavior
        this.tabKeyDownHandler = (event: KeyboardEvent) => {
            if (!this.keybindManager.matchesActionEvent('playerList', event)) return;
            this.isPlayerListKeyHeld = true;
            if (event.repeat) {
                event.preventDefault();
                return;
            }
            // Don't show tablist while chat is focused
            if (this.chat?.isChatFocused()) return;
            if (this.registry.get('guiOpen') === true) return;
            event.preventDefault();
            this.headbarUI?.showTabList();
        };
        this.tabKeyUpHandler = (event: KeyboardEvent) => {
            if (!this.keybindManager.matchesActionEvent('playerList', event)) return;
            this.isPlayerListKeyHeld = false;
            event.preventDefault();
            this.headbarUI?.hideTabList();
        };
        window.addEventListener('keydown', this.tabKeyDownHandler, { capture: true });
        window.addEventListener('keyup', this.tabKeyUpHandler, { capture: true });

        // Intercept chat keys at window level
        this.chatKeyHandler = (event: KeyboardEvent) => {
            if (this.registry.get('inputBlocked') === true) return;
            if (this.registry.get('guiOpen') === true) return;
            if (this.chat?.isChatFocused()) {
                this.keybindManager.clearPressedActions();
            }
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
            if (!this.keybindManager.matchesActionEvent('inventory', event)) return;
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

        this.usableHotkeyHandler = (event: KeyboardEvent) => {
            if (event.repeat) return;

            let slotIndex = -1;
            if (event.code === 'Digit1' || event.code === 'Numpad1') slotIndex = 0;
            if (event.code === 'Digit2' || event.code === 'Numpad2') slotIndex = 1;
            if (event.code === 'Digit3' || event.code === 'Numpad3') slotIndex = 2;
            if (event.code === 'Digit4' || event.code === 'Numpad4') slotIndex = 3;
            if (slotIndex < 0) return;

            if (this.tryUseHudUsableSlot(slotIndex)) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        window.addEventListener('keydown', this.usableHotkeyHandler, { capture: true });

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
            if (this.usableHotkeyHandler) {
                window.removeEventListener('keydown', this.usableHotkeyHandler, { capture: true } as any);
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
            if (this.dangerCountdownRegistryHandler) {
                this.registry.events.off('changedata-dangerZoneCountdown', this.dangerCountdownRegistryHandler);
                this.dangerCountdownRegistryHandler = undefined;
            }
            if (this.subtitleEventHandler) {
                window.removeEventListener('audio:subtitle', this.subtitleEventHandler as EventListener);
            }
            if (this.subtitlesEnabledChangedHandler) {
                window.removeEventListener('audio:subtitles-enabled-changed', this.subtitlesEnabledChangedHandler as EventListener);
            }
            if (this.finbookQuestTargetedHandler) {
                window.removeEventListener('finbook:quest-targeted', this.finbookQuestTargetedHandler as EventListener);
            }
            if (this.inventoryConsumedHandler) {
                window.removeEventListener('inventory:consumed', this.inventoryConsumedHandler as EventListener);
            }
            if (this.uiClickPointerHandler) {
                this.input.off(Phaser.Input.Events.GAMEOBJECT_DOWN, this.uiClickPointerHandler);
            }
            window.removeEventListener('pointerdown', markActivity, { capture: true } as any);
            window.removeEventListener('mousedown', markActivity, { capture: true } as any);
            window.removeEventListener('touchstart', markActivity, { capture: true } as any);
            this.scale.off('resize', this.onResize, this);
            this.guideCoordinator?.destroy();
            this.guideInputGate?.uninstall();
            this.guideOverlay?.destroy();
            this.damageBorderTween?.stop();
            this.damageBorderGlow?.destroy();
            this.dangerCountdownText?.destroy();
            this.dangerCountdownText = undefined;
            this.chat?.destroy();
            this.bookUI?.destroy();
            this.headbarUI?.destroy();
            this.playerHud?.destroy();
            this.inventoryChangeMonitor?.destroy();
            this.subtitleStack?.destroy();
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

    setDialogueOptionHandler(handler: (optionId: string) => void) {
        if (this.dialogueUI) {
            this.dialogueUI.setOnOptionSelect(handler);
        } else {
            this.pendingDialogueOptionHandler = handler;
        }
    }

    showDialogueLine(line: DialogueRenderLine) {
        this.dialogueUI?.showLine(line);
    }

    setDialogueActive(active: boolean) {
        if (this.dialogueActive === active) return;
        this.dialogueActive = active;
        this.registry.set('dialogueActive', active);

        if (active) {
            this.headbarUI?.hideTabList();
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

    showGuideOverlay(state: GuideOverlayState) {
        this.guideOverlay?.setState(state);
    }

    clearGuideOverlay() {
        this.guideOverlay?.hide();
    }

    applyGuideInputGate(config: {
        allowedActions: ControlActionKey[];
        allowedPointerRect: Phaser.Geom.Rectangle | null;
        allowedUsableSlotIndex?: number | null;
    }) {
        if (this.chat?.isChatFocused()) {
            this.chat.blur();
        }
        this.guideInputGate?.apply(config);
    }

    clearGuideInputGate() {
        this.guideInputGate?.clear();
    }

    getGuideRodInventoryRect(): Phaser.Geom.Rectangle | null {
        return this.bookUI?.getGuideRodInventoryRect() ?? null;
    }

    getGuideEquipmentRodRect(): Phaser.Geom.Rectangle | null {
        return this.bookUI?.getGuideEquippedRodRect() ?? null;
    }

    getGuideHudRodRect(): Phaser.Geom.Rectangle | null {
        return this.playerHud?.getRodSlotScreenRect() ?? null;
    }

    getGuideHudQuickSlotRect(slotIndex: number): Phaser.Geom.Rectangle | null {
        return this.playerHud?.getUsableSlotScreenRect(slotIndex) ?? null;
    }

    getGuideBerryInventoryRect(): Phaser.Geom.Rectangle | null {
        return this.bookUI?.getGuideFoodInventoryRect('yekberries') ?? null;
    }

    getGuideFoodScoreRect(): Phaser.Geom.Rectangle | null {
        return this.bookUI?.getGuideFoodScoreRect() ?? null;
    }

    getGuideUsableEquipRect(slotIndex: number): Phaser.Geom.Rectangle | null {
        return this.bookUI?.getGuideUsableEquipRect(slotIndex) ?? null;
    }

    simulateGuideHeartLoss(amount = 1): boolean {
        const maxHeartsRaw = this.registry.get('playerHeartsMax');
        const currentHeartsRaw = this.registry.get('playerHeartsCurrent');
        const maxHearts = typeof maxHeartsRaw === 'number' ? Math.max(1, Math.floor(maxHeartsRaw)) : 9;
        const currentHearts = typeof currentHeartsRaw === 'number' ? Math.max(0, Math.min(maxHearts, Math.floor(currentHeartsRaw))) : maxHearts;
        if (currentHearts <= 0) return false;
        const next = Math.max(0, currentHearts - Math.max(1, Math.floor(amount)));
        this.registry.set('playerHeartsCurrent', next);
        this.registry.set('playerHeartsMax', maxHearts);
        this.playerHud?.setHearts(next, maxHearts);
        this.lastKnownHearts = next;
        this.triggerDamageFeedback();
        return next < currentHearts;
    }

    triggerDamageFeedback(durationMs = 350) {
        const gameScene = this.scene.isActive('GameScene') ? this.scene.get('GameScene') as Phaser.Scene : null;
        gameScene?.cameras?.main?.shake(durationMs, 0.0035, true);

        if (!this.damageBorderGlow) return;
        this.redrawDamageBorderGlow();
        this.damageBorderTween?.stop();
        this.damageBorderGlow.setVisible(true);
        this.damageBorderGlow.setAlpha(0.95);
        this.damageBorderTween = this.tweens.add({
            targets: this.damageBorderGlow,
            alpha: { from: 0.95, to: 0 },
            duration: durationMs,
            ease: 'Sine.out',
            onComplete: () => {
                this.damageBorderGlow?.setVisible(false);
            }
        });
    }

    getGuideInventoryTriggerRect(): Phaser.Geom.Rectangle | null {
        const gameScene = this.scene.get('GameScene') as any;
        return gameScene?.getGuideInventoryButtonRect?.() ?? null;
    }

    getGuideInteractTriggerRect(): Phaser.Geom.Rectangle | null {
        const gameScene = this.scene.get('GameScene') as any;
        return gameScene?.getGuideInteractButtonRect?.() ?? null;
    }

    getGuideFishingCastRect(): Phaser.Geom.Rectangle | null {
        const fishingScene = this.scene.isActive('FishingScene') ? this.scene.get('FishingScene') as any : null;
        return fishingScene?.getGuideCastButtonRect?.() ?? null;
    }

    getGuideFishingStopRect(): Phaser.Geom.Rectangle | null {
        const fishingScene = this.scene.isActive('FishingScene') ? this.scene.get('FishingScene') as any : null;
        return fishingScene?.getGuideStopButtonRect?.() ?? null;
    }

    getGuideFishingBiteHintRect(): Phaser.Geom.Rectangle | null {
        const fishingScene = this.scene.isActive('FishingScene') ? this.scene.get('FishingScene') as any : null;
        return fishingScene?.getGuideBiteHintRect?.() ?? null;
    }

    getGuideFishingBiteInfoRect(): Phaser.Geom.Rectangle | null {
        const fishingScene = this.scene.isActive('FishingScene') ? this.scene.get('FishingScene') as any : null;
        return fishingScene?.getGuideBiteInfoRect?.() ?? fishingScene?.getGuideBiteHintRect?.() ?? null;
    }

    isFishingSceneOpen(): boolean {
        return this.scene.isActive('FishingScene');
    }

    setGuideFishingTimerFreeze(freeze: boolean) {
        const fishingScene = this.scene.isActive('FishingScene') ? this.scene.get('FishingScene') as any : null;
        fishingScene?.setGuideFreezeBiteTimer?.(freeze);
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
        this.dangerCountdownText?.setPosition(Math.floor(this.scale.width / 2), 112);
        this.playerHud?.layout();
        this.inventoryChangeMonitor?.layout();
        this.subtitleStack?.layout();
        this.dialogueUI?.layout();
        this.guideOverlay?.resize();
        this.redrawDamageBorderGlow();
    }

    private redrawDamageBorderGlow() {
        if (!this.damageBorderGlow) return;
        const width = this.scale.width;
        const height = this.scale.height;
        this.damageBorderGlow.clear();
        this.damageBorderGlow.lineStyle(10, 0xff3b3b, 1);
        this.damageBorderGlow.strokeRect(5, 5, Math.max(0, width - 10), Math.max(0, height - 10));
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

        room.onMessage('advancement:alert', (data: IAdvancementAlertMessage) => {
            if (!this.headbarUI) return;
            this.headbarUI.enqueueAdvancementAlert(data);
            this.networkManager.requestAdvancementsState();
        });

        room.onMessage('player:hearts', (data: { currentHearts?: number; maxHearts?: number }) => {
            const currentHearts = typeof data?.currentHearts === 'number' ? data.currentHearts : 9;
            const maxHearts = typeof data?.maxHearts === 'number' ? data.maxHearts : 9;
            if (this.hasReceivedHeartsSnapshot && currentHearts < this.lastKnownHearts) {
                this.triggerDamageFeedback();
            }
            this.hasReceivedHeartsSnapshot = true;
            this.lastKnownHearts = Math.max(0, Math.floor(currentHearts));
            this.registry.set('playerHeartsCurrent', currentHearts);
            this.registry.set('playerHeartsMax', maxHearts);
            this.playerHud?.setHearts(currentHearts, maxHearts);
        });

        room.send('player:hearts:request', {});
    }

    update(_time: number, delta: number) {
        if (this.scene.isActive('FishingScene')) {
            this.scene.bringToTop('UIScene');
        }

        if (!this.isPlayerListKeyHeld && this.registry.get('guiOpen') !== true) {
            this.headbarUI?.hideTabList();
        }

        this.guideCoordinator?.update();

        this.playerHud?.update(delta);
        this.inventoryChangeMonitor?.update();
        this.subtitleStack?.update();

        if (this.headbarUI) {
            this.headbarUI.update();
        }

        if (this.dangerCountdownText?.visible) {
            this.dangerCountdownText.setPosition(Math.floor(this.scale.width / 2), 112);
        }
    }

    private tryUseHudUsableSlot(slotIndex: number): boolean {
        if (slotIndex < 0 || slotIndex > 3) return false;
        if (this.registry.get('inputBlocked') === true) return false;
        if (this.registry.get('guiOpen') === true) return false;
        if (this.chat?.isChatFocused()) return false;
        if (this.registry.get('guideBlockAll') === true) {
            const allowedSlot = this.registry.get('guideAllowedUsableSlot');
            if (typeof allowedSlot !== 'number' || Math.floor(allowedSlot) !== slotIndex) {
                return false;
            }
        }

        this.networkManager.sendUseEquippedItem(slotIndex);
        window.dispatchEvent(new CustomEvent('hud:usable-use', { detail: { slotIndex } }));
        return true;
    }

    private getAudioManager() {
        const gameScene = this.scene.get('GameScene') as { getAudioManager?: () => any };
        return gameScene?.getAudioManager?.();
    }
}
