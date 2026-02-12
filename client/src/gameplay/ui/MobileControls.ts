/**
 * Mobile Controls - Minecraft Bedrock Style
 * Virtual joystick for 8-direction movement with sprint threshold
 * 
 * Design notes:
 * - Left side: Virtual joystick (movement)
 * - Right side: Action buttons (inventory/interact)
 * - Auto-hides on desktop, shows on touch devices
 */

import Phaser from 'phaser';
import { InteractionType, AvailableInteraction } from '../interaction/InteractionManager';

export interface MobileInputState {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    sprint: boolean;
}

export type JoystickDebugInfo = {
    isMobileDevice: boolean;
    keyboardUsed: boolean;
    guiOpen: boolean;
    showTouchControls: boolean;
    containerVisible: boolean;
    joystickVisible: boolean;
    hasBaseTexture: boolean;
    hasHandleTexture: boolean;
    spritesReady: boolean;
    renderScene: string;
    baseAlpha: number;
    handleAlpha: number;
    baseDepth: number;
    handleDepth: number;
    baseX: number;
    baseY: number;
    handleX: number;
    handleY: number;
    radius: number;
    viewWidth: number;
    viewHeight: number;
    zoom: number;
};

export class MobileControls {
    private scene: Phaser.Scene;
    private joystickScene?: Phaser.Scene;
    private inputScene?: Phaser.Scene;
    private container: HTMLElement;
    private joystickBase?: Phaser.GameObjects.Image;
    private joystickHandle?: Phaser.GameObjects.Image;
    private inventoryButton?: Phaser.GameObjects.Image;
    private interactButton?: Phaser.GameObjects.Image;
    private inventoryKeyIcon?: Phaser.GameObjects.Image;
    private interactKeyIcon?: Phaser.GameObjects.Image;
    private fullscreenButton?: Phaser.GameObjects.Image;
    private menuButton?: Phaser.GameObjects.Image;
    private fullscreenChangeListener?: () => void;
    private guiOpenListener?: (event: Event) => void;
    
    private inputState: MobileInputState = {
        up: false,
        down: false,
        left: false,
        right: false,
        sprint: false
    };
    
    // Joystick state
    private joystickActive = false;
    private joystickPointerId: number | null = null;
    private joystickCenter = { x: 0, y: 0 };
    private readonly joystickBaseSize = 45;
    private readonly joystickHandleWidth = 16;
    private readonly joystickHandleHeight = 17;
    private readonly joystickBorder = 4;
    private readonly joystickBaseScale = 3.2;
    private readonly joystickHandleScale = 3.2;
    private readonly joystickMarginX = 24;
    private readonly joystickMarginY = 24;
    private readonly joystickDeadzone = 0.18;
    private readonly joystickSprintThreshold = 0.9;
    private readonly joystickHandleOvershoot = 15;
    private readonly inventoryInteractGap = 14;
    private readonly controlOpacity = 0.5;
    private readonly keyIconScale = 2;
    private readonly keyIconOffset = 4;
    private readonly actionButtonSize = 24;
    private readonly topButtonSize = 16;
    private readonly topButtonMargin = 16;
    private readonly topButtonGap = 14;
    private readonly pressedTint = 0xb3b3b3;
    private joystickLoadHooked = false;
    private lastShowTouchControls = false;
    private lastJoystickTarget = { x: 0, y: 0, radius: 0 };
    
    // UI styling
    private readonly borderRadius = '16px';
    
    // Visibility
    private isVisible = false;
    private keyboardUsed = false; // Once keyboard is used, hide controls permanently
    private keyboardListener?: (e: KeyboardEvent) => void;
    private resizeListener?: () => void;
    private scaleResizeListener?: (gameSize: Phaser.Structs.Size) => void;
    private inputBlocked = false;
    
    // Interact button state
    private currentInteraction: AvailableInteraction | null = null;
    private guiCurrentlyOpen = false;
    private guiOpenSource: 'inventory' | 'menu' | null = null;
    
    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.container = this.createContainer();
        this.ensureJoystickSprites();
        this.createInventorySprite();
        this.createInteractSprite();
        
        this.setupEventListeners();
        this.setupKeyboardDetection();
        this.setupGuiOpenListener();
        this.setupResizeListener();
        
        // Don't auto-show - GameScene will show controls when the game is ready
    }
    
    /**
     * Detect if device is actually a mobile device (not just touch-capable)
     * Desktop touch screens and tablets with keyboards should not show controls
     */
    static isMobileDevice(): boolean {
        // Check user agent for mobile indicators
        const userAgent = navigator.userAgent.toLowerCase();
        const mobileKeywords = [
            'android', 'webos', 'iphone', 'ipad', 'ipod', 'blackberry',
            'windows phone', 'opera mini', 'mobile', 'tablet'
        ];
        const isMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));
        
        // Also check screen size as a secondary indicator
        const isSmallScreen = window.innerWidth <= 1024 && window.innerHeight <= 1366;
        const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
        
        // Must have touch AND be identified as mobile by UA or have small screen
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        
        return hasTouch && (isMobileUA || isSmallScreen || isCoarsePointer);
    }
    
    /**
     * @deprecated Use isMobileDevice() instead
     * Detect if device supports touch (kept for backwards compatibility)
     */
    static isTouchDevice(): boolean {
        return MobileControls.isMobileDevice();
    }
    
    /**
     * Check if any text input is currently focused (e.g., chat input)
     */
    private isTextInputFocused(): boolean {
        const active = document.activeElement;
        if (!active) return false;
        
        const tagName = active.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea') {
            return true;
        }
        
        // Check for contenteditable
        if (active.getAttribute('contenteditable') === 'true') {
            return true;
        }
        
        return false;
    }
    
    /**
     * Setup keyboard detection to hide controls when keyboard is used
     */
    private setupKeyboardDetection() {
        this.keyboardListener = (e: KeyboardEvent) => {
            // Ignore if a text input is focused (e.g., chat)
            if (this.isTextInputFocused()) return;
            
            // Ignore modifier keys alone
            if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
            
            // Movement or common game keys detected - user has a keyboard
            const gameKeys = ['w', 'a', 's', 'd', 'W', 'A', 'S', 'D',
                'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                ' ', 'Enter', 'Escape'];
            
            if (gameKeys.includes(e.key)) {
                this.keyboardUsed = true;
                this.updateDeviceVisibility();
                // Remove listener - decision is permanent until page reload
                if (this.keyboardListener) {
                    window.removeEventListener('keydown', this.keyboardListener);
                }
            }
        };
        
        window.addEventListener('keydown', this.keyboardListener);
    }

    private updateDeviceVisibility() {
        this.ensureJoystickSprites();
        this.ensureInventorySprite();
        this.ensureInteractSprite();
        this.ensureKeyIcons();
        this.ensureTopButtons();
        if (this.inputBlocked) {
            this.setJoystickVisible(false);
            this.setInventoryVisible(false);
            this.setInteractVisible(false);
            this.setTopButtonVisible(this.fullscreenButton, false);
            this.setTopButtonVisible(this.menuButton, false);
            this.resetInput();
            return;
        }
        const isMobile = MobileControls.isMobileDevice();
        const showTouchControls = isMobile && !this.keyboardUsed && !this.guiCurrentlyOpen;
        this.lastShowTouchControls = showTouchControls;

        this.setJoystickVisible(showTouchControls);
        if (!showTouchControls) {
            this.resetInput();
        }
        const showInventory = !this.guiCurrentlyOpen || this.guiOpenSource === 'inventory';
        this.setInventoryVisible(showInventory);
        this.setInventoryPressed(this.guiCurrentlyOpen && this.guiOpenSource === 'inventory');
        this.updateInteractButtonVisibility();

        const showMenu = !this.guiCurrentlyOpen || this.guiOpenSource === 'menu';
        const showFullscreen = !this.guiCurrentlyOpen;
        this.setTopButtonVisible(this.fullscreenButton, showFullscreen);
        this.setTopButtonVisible(this.menuButton, showMenu);
    }
    
    /**
     * Get current input state
     */
    getInputState(): MobileInputState {
        return { ...this.inputState };
    }
    
    /**
     * Check if controls are currently visible
     */
    getIsVisible(): boolean {
        return this.isVisible;
    }
    
    /**
     * Show controls (top-right buttons on all devices; touch controls on mobile)
     */
    show() {
        // Append to #app so controls work in fullscreen mode
        const gameContainer = document.getElementById('app') || document.body;
        if (!gameContainer.contains(this.container)) {
            gameContainer.appendChild(this.container);
        }
        this.container.style.display = 'block';
        this.isVisible = true;
        this.updateDeviceVisibility();
        this.updateTopButtonPositions();
        this.updateInventoryPosition();
    }
    
    /**
     * Hide controls
     */
    hide() {
        this.container.style.display = 'none';
        this.isVisible = false;
        this.resetInput();
        this.setInventoryVisible(false);
        this.setInteractVisible(false);
        this.setTopButtonVisible(this.fullscreenButton, false);
        this.setTopButtonVisible(this.menuButton, false);
    }
    
    /**
     * Destroy controls
     */
    destroy() {
        if (this.keyboardListener) {
            window.removeEventListener('keydown', this.keyboardListener);
        }
        if (this.guiOpenListener) {
            window.removeEventListener('gui-open-changed', this.guiOpenListener as EventListener);
        }
        if (this.resizeListener) {
            window.removeEventListener('resize', this.resizeListener);
        }
        if (this.scaleResizeListener) {
            this.scene.scale.off('resize', this.scaleResizeListener);
        }
        if (this.fullscreenChangeListener) {
            document.removeEventListener('fullscreenchange', this.fullscreenChangeListener);
            document.removeEventListener('webkitfullscreenchange', this.fullscreenChangeListener);
            document.removeEventListener('mozfullscreenchange', this.fullscreenChangeListener);
            document.removeEventListener('MSFullscreenChange', this.fullscreenChangeListener);
        }
        this.unbindInputScene();
        this.joystickBase?.destroy();
        this.joystickHandle?.destroy();
        this.inventoryButton?.destroy();
        this.inventoryKeyIcon?.destroy();
        this.interactButton?.destroy();
        this.interactKeyIcon?.destroy();
        this.fullscreenButton?.destroy();
        this.menuButton?.destroy();
        this.container.remove();
        this.isVisible = false;
    }
    
    private resetInput() {
        this.inputState = {
            up: false,
            down: false,
            left: false,
            right: false,
            sprint: false
        };
        this.joystickActive = false;
        this.joystickPointerId = null;

        this.resetJoystickVisual();
    }

    private setupGuiOpenListener() {
        this.guiOpenListener = (event: Event) => {
            const customEvent = event as CustomEvent<{ isOpen: boolean; source?: 'inventory' | 'menu' }>;
            this.setGuiOpen(customEvent.detail?.isOpen === true, customEvent.detail?.source ?? null);
        };
        window.addEventListener('gui-open-changed', this.guiOpenListener as EventListener);
    }

    private setGuiOpen(isOpen: boolean, source: 'inventory' | 'menu' | null) {
        this.guiCurrentlyOpen = isOpen;
        this.guiOpenSource = isOpen ? source : null;
        this.updateDeviceVisibility();

        if (isOpen) {
            this.setSpritePressed(this.fullscreenButton, false);
            this.setSpritePressed(this.menuButton, false);
        }
    }

    /**
     * Update available interaction - called by InteractionManager
     */
    setAvailableInteraction(interaction: AvailableInteraction | null) {
        this.currentInteraction = interaction;
        if (!this.inputBlocked) {
            this.updateInteractButtonVisibility();
            this.updateInteractButtonIcon();
        }
    }

    setInputBlocked(blocked: boolean) {
        if (this.inputBlocked === blocked) return;
        this.inputBlocked = blocked;
        this.updateDeviceVisibility();
    }

    /**
     * Update interact button visibility based on interaction availability and GUI state
     */
    private updateInteractButtonVisibility() {
        // Only show if: not in GUI AND there's an available interaction
        const shouldShow = !this.guiCurrentlyOpen
            && this.currentInteraction !== null;
        this.setInteractVisible(shouldShow);
    }

    /**
     * Update interact button icon based on interaction type
     */
    private updateInteractButtonIcon() {
        if (!this.currentInteraction || !this.interactButton) return;

        const texture = this.currentInteraction.type === InteractionType.Talk
            ? 'ui-interact-chat'
            : 'ui-interact-blank';
        if (this.interactButton.texture.key !== texture) {
            this.interactButton.setTexture(texture);
        }
    }

    private setTopButtonVisible(button: Phaser.GameObjects.Image | undefined, visible: boolean) {
        if (!button) return;
        button.setVisible(visible);
        if (visible) {
            this.updateTopButtonPositions();
        }
    }

    private setupResizeListener() {
        this.resizeListener = () => {
            if (this.isVisible) {
                this.updateTopButtonPositions();
            }
        };
        window.addEventListener('resize', this.resizeListener);

        this.scaleResizeListener = () => {
            if (!this.isVisible) return;
            this.updateTopButtonPositions();
            this.updateInventoryPosition();
            this.positionJoystick();
        };
        this.scene.scale.on('resize', this.scaleResizeListener);
    }

    private getNavbarHeight(): number {
        const navbar = document.querySelector('.game-navbar, .navbar, nav, header') as HTMLElement | null;
        if (navbar) {
            const rect = navbar.getBoundingClientRect();
            // Only count navbar if it's visible
            const isVisible = rect.height > 0 && rect.width > 0;
            if (isVisible) {
                return rect.height;
            }
        }
        return 0;
    }

    private updateTopButtonPositions() {
        const topOffset = this.topButtonMargin;
        const camera = (this.joystickScene ?? this.scene).cameras.main;
        const viewWidth = camera.width;
        const size = this.topButtonSize * this.joystickBaseScale;
        const halfSize = size / 2;
        const y = topOffset + halfSize;
        const menuX = viewWidth - this.topButtonMargin - halfSize;
        const fullscreenX = menuX - size - this.topButtonGap;
        if (this.menuButton) {
            this.menuButton.setPosition(menuX, y);
        }
        if (this.fullscreenButton) {
            this.fullscreenButton.setPosition(fullscreenX, y);
        }
        if (this.isJoystickVisible()) {
            this.positionJoystick();
        }
        this.updateInventoryPosition();
    }

    private positionJoystick() {
        if (!this.joystickBase || !this.joystickHandle) return;
        const camera = (this.joystickScene ?? this.scene).cameras.main;
        const viewWidth = camera.width;
        const viewHeight = camera.height;
        const x = this.joystickMarginX + (this.joystickBase.displayWidth * 0.5);
        const y = viewHeight - this.joystickMarginY - (this.joystickBase.displayHeight * 0.5);
        this.joystickBase.setPosition(x, y);
        this.joystickHandle.setPosition(x, y);
        this.joystickCenter = { x, y };
        this.lastJoystickTarget = { x, y, radius: this.joystickBase.displayWidth * 0.5 };
    }

    private setJoystickVisible(visible: boolean) {
        if (this.joystickBase) {
            this.joystickBase.setVisible(visible);
        }
        if (this.joystickHandle) {
            this.joystickHandle.setVisible(visible);
        }
        if (visible) {
            this.positionJoystick();
        }
    }

    private resetJoystickVisual() {
        if (!this.joystickHandle || !this.joystickBase) return;
        this.joystickHandle.setPosition(this.joystickBase.x, this.joystickBase.y);
    }

    private getJoystickMaxDistance(): number {
        const innerRadius = (this.joystickBaseSize - this.joystickBorder * 2) * 0.5 * this.joystickBaseScale;
        const handleRadius = Math.max(this.joystickHandleWidth, this.joystickHandleHeight) * 0.5 * this.joystickHandleScale;
        return Math.max(6, innerRadius - handleRadius + this.joystickHandleOvershoot);
    }

    private isJoystickVisible(): boolean {
        return Boolean(this.joystickBase?.visible && this.joystickHandle?.visible);
    }

    getJoystickDebugInfo(): JoystickDebugInfo {
        const camera = (this.joystickScene ?? this.scene).cameras.main;
        const zoom = camera.zoom || 1;
        const viewWidth = camera.width;
        const viewHeight = camera.height;
        const baseX = this.joystickBase?.x ?? this.lastJoystickTarget.x;
        const baseY = this.joystickBase?.y ?? this.lastJoystickTarget.y;
        const handleX = this.joystickHandle?.x ?? baseX;
        const handleY = this.joystickHandle?.y ?? baseY;
        const radius = this.joystickBase?.displayWidth
            ? this.joystickBase.displayWidth * 0.5
            : this.lastJoystickTarget.radius;

        return {
            isMobileDevice: MobileControls.isMobileDevice(),
            keyboardUsed: this.keyboardUsed,
            guiOpen: this.guiCurrentlyOpen,
            showTouchControls: this.lastShowTouchControls,
            containerVisible: this.isVisible,
            joystickVisible: this.isJoystickVisible(),
            hasBaseTexture: this.scene.textures.exists('ui-joystick-base'),
            hasHandleTexture: this.scene.textures.exists('ui-joystick-handle'),
            spritesReady: Boolean(this.joystickBase && this.joystickHandle),
            renderScene: this.joystickScene?.scene.key ?? 'none',
            baseAlpha: this.joystickBase?.alpha ?? 0,
            handleAlpha: this.joystickHandle?.alpha ?? 0,
            baseDepth: this.joystickBase?.depth ?? 0,
            handleDepth: this.joystickHandle?.depth ?? 0,
            baseX,
            baseY,
            handleX,
            handleY,
            radius,
            viewWidth,
            viewHeight,
            zoom
        };
    }
    
    // ==================== UI Creation ====================
    
    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.id = 'mobile-controls';
        container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1000;
            display: none;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
        `;
        return container;
    }
    
    private createJoystickSprites() {
        if (this.joystickBase || this.joystickHandle) return;
        const targetScene = this.getJoystickScene();
        if (!targetScene) return;

        this.joystickScene = targetScene;
        this.joystickBase = targetScene.add.image(0, 0, 'ui-joystick-base');
        this.joystickHandle = targetScene.add.image(0, 0, 'ui-joystick-handle');
        this.joystickBase.setOrigin(0.5, 0.5);
        this.joystickHandle.setOrigin(0.5, 0.5);
        this.joystickBase.setDepth(9999);
        this.joystickHandle.setDepth(10000);
        this.joystickBase.setScrollFactor(0);
        this.joystickHandle.setScrollFactor(0);
        this.joystickBase.setScale(this.joystickBaseScale);
        this.joystickHandle.setScale(this.joystickHandleScale);
        this.joystickBase.setAlpha(this.controlOpacity);
        this.joystickHandle.setAlpha(this.controlOpacity);
        this.positionJoystick();
        this.setJoystickVisible(false);
    }

    private ensureJoystickSprites() {
        if (this.joystickBase && this.joystickHandle) return;

        const targetScene = this.getJoystickScene();
        if (!targetScene) return;

        this.bindInputScene(targetScene);

        const hasBase = this.scene.textures.exists('ui-joystick-base');
        const hasHandle = this.scene.textures.exists('ui-joystick-handle');

        if (!hasBase || !hasHandle) {
            if (!this.joystickLoadHooked) {
                this.joystickLoadHooked = true;
                this.scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
                    this.joystickLoadHooked = false;
                    this.ensureJoystickSprites();
                    this.updateDeviceVisibility();
                });
            }
            return;
        }

        this.createJoystickSprites();
    }

    private createInventorySprite() {
        if (this.inventoryButton) return;
        const targetScene = this.getJoystickScene();
        if (!targetScene) return;

        this.inventoryButton = targetScene.add.image(0, 0, 'ui-backpack');
        this.inventoryButton.setOrigin(0.5, 0.5);
        this.inventoryButton.setDepth(10001);
        this.inventoryButton.setScrollFactor(0);
        this.inventoryButton.setScale(this.joystickBaseScale);
        this.inventoryButton.setAlpha(this.controlOpacity);
        this.inventoryButton.setVisible(false);
        this.inventoryButton.setInteractive({ useHandCursor: true });
        this.inventoryButton.on('pointerdown', () => {
            if (this.inputBlocked) return;
            this.setInventoryPressed(true);
        });
        this.inventoryButton.on('pointerup', () => {
            if (this.inputBlocked) return;
            this.setInventoryPressed(false);
            window.dispatchEvent(new CustomEvent('mobile:inventory'));
        });
        this.inventoryButton.on('pointerupoutside', () => this.setInventoryPressed(false));
        this.inventoryButton.on('pointerout', () => this.setInventoryPressed(false));

        this.updateInventoryPosition();
    }

    private createInteractSprite() {
        if (this.interactButton) return;
        const targetScene = this.getJoystickScene();
        if (!targetScene) return;

        this.interactButton = targetScene.add.image(0, 0, 'ui-interact-blank');
        this.interactButton.setOrigin(0.5, 0.5);
        this.interactButton.setDepth(10002);
        this.interactButton.setScrollFactor(0);
        this.interactButton.setScale(this.joystickBaseScale);
        this.interactButton.setAlpha(this.controlOpacity);
        this.interactButton.setVisible(false);
        this.interactButton.setInteractive({ useHandCursor: true });
        this.interactButton.on('pointerdown', () => {
            if (this.inputBlocked) return;
            this.setInteractPressed(true);
            window.dispatchEvent(new CustomEvent('mobile:interact'));
        });
        this.interactButton.on('pointerup', () => this.setInteractPressed(false));
        this.interactButton.on('pointerupoutside', () => this.setInteractPressed(false));
        this.interactButton.on('pointerout', () => this.setInteractPressed(false));

        this.updateInteractPosition();
    }

    private ensureInteractSprite() {
        if (this.interactButton) return;
        const targetScene = this.getJoystickScene();
        if (!targetScene) return;
        if (!this.scene.textures.exists('ui-interact-blank') || !this.scene.textures.exists('ui-interact-chat')) return;
        this.createInteractSprite();
    }

    private ensureKeyIcons() {
        this.ensureInventoryKeyIcon();
        this.ensureInteractKeyIcon();
    }

    private ensureTopButtons() {
        this.ensureFullscreenButton();
        this.ensureMenuButton();
    }

    private ensureInventoryKeyIcon() {
        if (this.inventoryKeyIcon) return;
        const targetScene = this.getJoystickScene();
        if (!targetScene) return;
        if (!this.scene.textures.exists('ui-hud-key-e')) return;

        this.inventoryKeyIcon = targetScene.add.image(0, 0, 'ui-hud-key-e');
        this.inventoryKeyIcon.setOrigin(0, 0);
        this.inventoryKeyIcon.setDepth(10003);
        this.inventoryKeyIcon.setScrollFactor(0);
        this.inventoryKeyIcon.setScale(this.keyIconScale);
        this.inventoryKeyIcon.setVisible(false);
    }

    private ensureInteractKeyIcon() {
        if (this.interactKeyIcon) return;
        const targetScene = this.getJoystickScene();
        if (!targetScene) return;
        if (!this.scene.textures.exists('ui-hud-key-f')) return;

        this.interactKeyIcon = targetScene.add.image(0, 0, 'ui-hud-key-f');
        this.interactKeyIcon.setOrigin(0, 0);
        this.interactKeyIcon.setDepth(10004);
        this.interactKeyIcon.setScrollFactor(0);
        this.interactKeyIcon.setScale(this.keyIconScale);
        this.interactKeyIcon.setVisible(false);
    }

    private ensureFullscreenButton() {
        if (this.fullscreenButton) return;
        const targetScene = this.getJoystickScene();
        if (!targetScene) return;
        if (!this.scene.textures.exists('ui-fullscreen') || !this.scene.textures.exists('ui-exit-fullscreen')) return;

        this.fullscreenButton = targetScene.add.image(0, 0, 'ui-fullscreen');
        this.fullscreenButton.setOrigin(0.5, 0.5);
        this.fullscreenButton.setDepth(10005);
        this.fullscreenButton.setScrollFactor(0);
        this.fullscreenButton.setScale(this.joystickBaseScale);
        this.fullscreenButton.setAlpha(this.controlOpacity);
        this.fullscreenButton.setVisible(false);
        this.fullscreenButton.setInteractive({ useHandCursor: true });
        this.fullscreenButton.on('pointerdown', () => {
            if (this.inputBlocked) return;
            this.setSpritePressed(this.fullscreenButton, true);
        });
        this.fullscreenButton.on('pointerup', () => {
            if (this.inputBlocked) return;
            this.setSpritePressed(this.fullscreenButton, false);
            this.toggleFullscreen();
        });
        this.fullscreenButton.on('pointerupoutside', () => this.setSpritePressed(this.fullscreenButton, false));
        this.fullscreenButton.on('pointerout', () => this.setSpritePressed(this.fullscreenButton, false));

        this.bindFullscreenChangeListener();
        this.updateFullscreenIcon();
        this.updateTopButtonPositions();
    }

    private ensureMenuButton() {
        if (this.menuButton) return;
        const targetScene = this.getJoystickScene();
        if (!targetScene) return;
        if (!this.scene.textures.exists('ui-menu')) return;

        this.menuButton = targetScene.add.image(0, 0, 'ui-menu');
        this.menuButton.setOrigin(0.5, 0.5);
        this.menuButton.setDepth(10006);
        this.menuButton.setScrollFactor(0);
        this.menuButton.setScale(this.joystickBaseScale);
        this.menuButton.setAlpha(this.controlOpacity);
        this.menuButton.setVisible(false);
        this.menuButton.setInteractive({ useHandCursor: true });
        this.menuButton.on('pointerdown', () => {
            if (this.inputBlocked) return;
            this.setSpritePressed(this.menuButton, true);
        });
        this.menuButton.on('pointerup', () => {
            if (this.inputBlocked) return;
            this.setSpritePressed(this.menuButton, false);
            window.dispatchEvent(new CustomEvent('mobile:menu'));
        });
        this.menuButton.on('pointerupoutside', () => this.setSpritePressed(this.menuButton, false));
        this.menuButton.on('pointerout', () => this.setSpritePressed(this.menuButton, false));

        this.updateTopButtonPositions();
    }

    private ensureInventorySprite() {
        if (this.inventoryButton) return;
        const targetScene = this.getJoystickScene();
        if (!targetScene) return;
        if (!this.scene.textures.exists('ui-backpack')) return;
        this.createInventorySprite();
    }

    private updateInventoryPosition() {
        if (!this.inventoryButton) return;
        const camera = (this.joystickScene ?? this.scene).cameras.main;
        const viewWidth = camera.width;
        const viewHeight = camera.height;
        const size = this.actionButtonSize * this.joystickBaseScale;
        const halfSize = size / 2;
        const x = viewWidth - this.joystickMarginX - halfSize;
        const y = viewHeight - this.joystickMarginY - halfSize;
        this.inventoryButton.setPosition(x, y);
        if (this.inventoryKeyIcon) {
            this.inventoryKeyIcon.setPosition(x - halfSize - this.keyIconOffset, y - halfSize - this.keyIconOffset);
        }
        this.updateInteractPosition();
    }

    private updateInteractPosition() {
        if (!this.interactButton) return;
        const camera = (this.joystickScene ?? this.scene).cameras.main;
        const viewWidth = camera.width;
        const viewHeight = camera.height;
        const size = this.actionButtonSize * this.joystickBaseScale;
        const halfSize = size / 2;
        const x = viewWidth - this.joystickMarginX - halfSize;
        const y = viewHeight - this.joystickMarginY - size - this.inventoryInteractGap - halfSize;
        this.interactButton.setPosition(x, y);
        if (this.interactKeyIcon) {
            this.interactKeyIcon.setPosition(x - halfSize - this.keyIconOffset, y - halfSize - this.keyIconOffset);
        }
    }

    private setInteractVisible(visible: boolean) {
        if (!this.interactButton) return;
        this.interactButton.setVisible(visible);
        this.setInteractKeyVisible(visible);
        if (visible) {
            this.updateInteractPosition();
        }
    }

    private setInventoryVisible(visible: boolean) {
        if (!this.inventoryButton) return;
        this.inventoryButton.setVisible(visible);
        this.setInventoryKeyVisible(visible);
    }

    private setInventoryKeyVisible(buttonVisible: boolean) {
        if (!this.inventoryKeyIcon) return;
        const isDesktopLike = !MobileControls.isMobileDevice() || this.keyboardUsed;
        this.inventoryKeyIcon.setVisible(buttonVisible && isDesktopLike);
    }

    private setInteractKeyVisible(buttonVisible: boolean) {
        if (!this.interactKeyIcon) return;
        const isDesktopLike = !MobileControls.isMobileDevice() || this.keyboardUsed;
        const shouldShow = buttonVisible && isDesktopLike && this.currentInteraction !== null;
        this.interactKeyIcon.setVisible(shouldShow);
    }

    private setInventoryPressed(pressed: boolean) {
        this.setSpritePressed(this.inventoryButton, pressed);
    }

    private setInteractPressed(pressed: boolean) {
        this.setSpritePressed(this.interactButton, pressed);
    }

    private setSpritePressed(button: Phaser.GameObjects.Image | undefined, pressed: boolean) {
        if (!button) return;
        if (pressed) {
            button.setTint(this.pressedTint);
        } else {
            button.clearTint();
        }
    }

    private bindInputScene(scene: Phaser.Scene) {
        if (this.inputScene === scene) return;
        this.unbindInputScene();

        this.inputScene = scene;
        scene.input.on('pointerdown', this.onJoystickPointerDown, this);
        scene.input.on('pointermove', this.onJoystickPointerMove, this);
        scene.input.on('pointerup', this.onJoystickPointerUp, this);
        scene.input.on('pointerupoutside', this.onJoystickPointerUp, this);
    }

    private unbindInputScene() {
        if (!this.inputScene) return;
        this.inputScene.input.off('pointerdown', this.onJoystickPointerDown, this);
        this.inputScene.input.off('pointermove', this.onJoystickPointerMove, this);
        this.inputScene.input.off('pointerup', this.onJoystickPointerUp, this);
        this.inputScene.input.off('pointerupoutside', this.onJoystickPointerUp, this);
        this.inputScene = undefined;
    }

    private getJoystickScene(): Phaser.Scene | null {
        const uiScene = this.scene.scene.get('UIScene');
        if (uiScene && uiScene.sys.isActive()) return uiScene;
        return null;
    }

    private isIOS(): boolean {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }
    
    private canUseNativeFullscreen(): boolean {
        const el = document.documentElement as any;
        return !!(el.requestFullscreen || el.webkitRequestFullscreen || 
            el.mozRequestFullScreen || el.msRequestFullscreen) && !this.isIOS();
    }
    
    private isPseudoFullscreen(): boolean {
        return document.body.classList.contains('pseudo-fullscreen');
    }
    
    private isAnyFullscreen(): boolean {
        const doc = document as any;
        return !!(doc.fullscreenElement || doc.webkitFullscreenElement || 
            doc.mozFullScreenElement || doc.msFullscreenElement) || this.isPseudoFullscreen();
    }
    
    private toggleFullscreen() {
        const doc = document as any;
        const gameEl = document.getElementById('app') as any;
        
        // Check pseudo-fullscreen first
        if (this.isPseudoFullscreen()) {
            document.body.classList.remove('pseudo-fullscreen');
            window.dispatchEvent(new Event('resize'));
            return;
        }
        
        const isNativeFullscreen = doc.fullscreenElement 
            || doc.webkitFullscreenElement 
            || doc.mozFullScreenElement 
            || doc.msFullscreenElement;
        
        if (isNativeFullscreen) {
            // Exit native fullscreen
            if (doc.exitFullscreen) doc.exitFullscreen();
            else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
            else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
            else if (doc.msExitFullscreen) doc.msExitFullscreen();
        } else if (gameEl) {
            if (this.canUseNativeFullscreen()) {
                // Try native fullscreen
                const enterFs = (el: any): Promise<void> => {
                    if (el.requestFullscreen) return el.requestFullscreen();
                    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
                    if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
                    if (el.msRequestFullscreen) return el.msRequestFullscreen();
                    return Promise.reject('Not supported');
                };
                
                enterFs(gameEl).catch(() => {
                    // Fallback to pseudo-fullscreen
                    document.body.classList.add('pseudo-fullscreen');
                    window.dispatchEvent(new Event('resize'));
                });
            } else {
                // iOS Safari - use pseudo-fullscreen
                document.body.classList.add('pseudo-fullscreen');
                window.dispatchEvent(new Event('resize'));
            }
        }
    }
    
    private updateFullscreenIcon() {
        if (!this.fullscreenButton || !this.fullscreenButton.active) return;
        if (!this.fullscreenButton.visible || !this.isVisible) return;
        const isFullscreen = this.isAnyFullscreen();
        const texture = isFullscreen ? 'ui-exit-fullscreen' : 'ui-fullscreen';
        if (!this.scene.textures.exists(texture)) return;
        if (this.fullscreenButton.texture.key !== texture) {
            this.fullscreenButton.setTexture(texture);
        }
    }

    private bindFullscreenChangeListener() {
        if (this.fullscreenChangeListener) return;
        this.fullscreenChangeListener = () => this.updateFullscreenIcon();
        document.addEventListener('fullscreenchange', this.fullscreenChangeListener);
        document.addEventListener('webkitfullscreenchange', this.fullscreenChangeListener);
        document.addEventListener('mozfullscreenchange', this.fullscreenChangeListener);
        document.addEventListener('MSFullscreenChange', this.fullscreenChangeListener);
    }
    
    // ==================== Event Handling ====================
    
    private setupEventListeners() {
        this.bindInputScene(this.scene);

        // Prevent context menu on long press
        this.container.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    private onJoystickPointerDown(pointer: Phaser.Input.Pointer) {
        if (!this.isJoystickVisible()) return;
        if (!this.joystickBase || !this.joystickHandle) return;
        if (this.joystickPointerId !== null) return;

        const dx = pointer.x - this.joystickBase.x;
        const dy = pointer.y - this.joystickBase.y;
        const radius = this.joystickBase.displayWidth * 0.5;
        if (Math.hypot(dx, dy) > radius) return;

        this.joystickActive = true;
        this.joystickPointerId = pointer.id;
        this.joystickCenter = { x: this.joystickBase.x, y: this.joystickBase.y };
        this.updateJoystickPosition(pointer.x, pointer.y);
    }

    private onJoystickPointerMove(pointer: Phaser.Input.Pointer) {
        if (!this.joystickActive) return;
        if (this.joystickPointerId !== pointer.id) return;
        this.updateJoystickPosition(pointer.x, pointer.y);
    }

    private onJoystickPointerUp(pointer: Phaser.Input.Pointer) {
        if (!this.joystickActive) return;
        if (this.joystickPointerId !== pointer.id) return;

        this.joystickActive = false;
        this.joystickPointerId = null;
        this.inputState.up = false;
        this.inputState.down = false;
        this.inputState.left = false;
        this.inputState.right = false;
        this.inputState.sprint = false;
        this.resetJoystickVisual();
    }

    private updateJoystickPosition(pointerX: number, pointerY: number) {
        if (!this.joystickBase || !this.joystickHandle) return;

        const dx = pointerX - this.joystickCenter.x;
        const dy = pointerY - this.joystickCenter.y;
        const distance = Math.hypot(dx, dy);
        const maxDist = this.getJoystickMaxDistance();

        let clampedX = dx;
        let clampedY = dy;
        if (distance > maxDist) {
            const ratio = maxDist / Math.max(1, distance);
            clampedX = dx * ratio;
            clampedY = dy * ratio;
        }

        this.joystickHandle.setPosition(this.joystickCenter.x + clampedX, this.joystickCenter.y + clampedY);

        const normalizedDist = Math.min(distance / maxDist, 1);
        if (normalizedDist < this.joystickDeadzone) {
            this.inputState.up = false;
            this.inputState.down = false;
            this.inputState.left = false;
            this.inputState.right = false;
            this.inputState.sprint = false;
            return;
        }

        const fullyExtended = distance >= maxDist;
        this.inputState.sprint = fullyExtended;

        const angle = Math.atan2(dy, dx);
        const angleDeg = ((angle * 180) / Math.PI + 360) % 360;
        this.inputState.right = angleDeg < 67.5 || angleDeg >= 292.5;
        this.inputState.down = angleDeg >= 22.5 && angleDeg < 157.5;
        this.inputState.left = angleDeg >= 112.5 && angleDeg < 247.5;
        this.inputState.up = angleDeg >= 202.5 && angleDeg < 337.5;
    }
}
