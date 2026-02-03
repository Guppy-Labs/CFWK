/**
 * Mobile Controls - Minecraft Bedrock Style
 * Virtual joystick for 8-direction movement + sprint button
 * 
 * Design notes:
 * - Left side: Virtual joystick (movement)
 * - Right side: Sprint button
 * - Auto-hides on desktop, shows on touch devices
 */

import { InteractionType, AvailableInteraction } from '../interaction/InteractionManager';

export interface MobileInputState {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    sprint: boolean;
}

export class MobileControls {
    private container: HTMLElement;
    private joystickZone: HTMLElement;
    private joystickBase: HTMLElement;
    private joystickKnob: HTMLElement;
    private sprintButton: HTMLElement;
    private inventoryButton: HTMLElement;
    private interactButton: HTMLElement;
    private fullscreenButton: HTMLElement;
    private menuButton: HTMLElement;
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
    private joystickTouchId: number | null = null;
    private joystickCenter = { x: 0, y: 0 };
    private readonly joystickRadius = 50;
    private readonly deadzone = 0.2;
    
    // UI styling
    private readonly borderRadius = '16px';
    
    // Sprint button state
    private sprintTouchId: number | null = null;
    
    // Visibility
    private isVisible = false;
    private keyboardUsed = false; // Once keyboard is used, hide controls permanently
    private keyboardListener?: (e: KeyboardEvent) => void;
    private resizeListener?: () => void;
    
    // Interact button state
    private currentInteraction: AvailableInteraction | null = null;
    private guiCurrentlyOpen = false;
    private guiOpenSource: 'inventory' | 'menu' | null = null;
    
    constructor() {
        this.container = this.createContainer();
        this.joystickZone = this.createJoystickZone();
        this.joystickBase = this.createJoystickBase();
        this.joystickKnob = this.createJoystickKnob();
        this.sprintButton = this.createSprintButton();
        this.inventoryButton = this.createInventoryButton();
        this.interactButton = this.createInteractButton();
        this.fullscreenButton = this.createFullscreenButton();
        this.menuButton = this.createMenuButton();
        
        this.joystickBase.appendChild(this.joystickKnob);
        this.joystickZone.appendChild(this.joystickBase);
        this.container.appendChild(this.joystickZone);
        this.container.appendChild(this.sprintButton);
        this.container.appendChild(this.inventoryButton);
        this.container.appendChild(this.interactButton);
        this.container.appendChild(this.fullscreenButton);
        this.container.appendChild(this.menuButton);
        
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
        
        // Must have touch AND be identified as mobile by UA or have small screen
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        
        return hasTouch && (isMobileUA || isSmallScreen);
    }
    
    /**
     * @deprecated Use isMobileDevice() instead
     * Detect if device supports touch (kept for backwards compatibility)
     */
    static isTouchDevice(): boolean {
        return MobileControls.isMobileDevice();
    }
    
    private isTouchDevice(): boolean {
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
        const isMobile = MobileControls.isMobileDevice();
        const showTouchControls = isMobile && !this.keyboardUsed && !this.guiCurrentlyOpen;

        this.joystickZone.style.display = showTouchControls ? 'block' : 'none';
        this.setButtonVisible(this.sprintButton, showTouchControls);
        const showInventory = showTouchControls
            || (isMobile && !this.keyboardUsed && this.guiCurrentlyOpen && this.guiOpenSource === 'inventory');
        this.setButtonVisible(this.inventoryButton, showInventory);
        this.updateInteractButtonVisibility();

        const showMenu = !this.guiCurrentlyOpen || this.guiOpenSource === 'menu';
        const showFullscreen = !this.guiCurrentlyOpen;
        this.setButtonVisible(this.fullscreenButton, showFullscreen);
        this.setButtonVisible(this.menuButton, showMenu);
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
    }
    
    /**
     * Hide controls
     */
    hide() {
        this.container.style.display = 'none';
        this.isVisible = false;
        this.resetInput();
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
        this.joystickTouchId = null;
        this.sprintTouchId = null;
        
        // Reset joystick visual
        this.joystickKnob.style.transform = 'translate(-50%, -50%)';
        this.joystickBase.classList.remove('active');
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
            this.sprintButton.classList.remove('active');
            this.interactButton.classList.remove('active');
            this.fullscreenButton.classList.remove('active');
        }
    }

    /**
     * Update available interaction - called by InteractionManager
     */
    setAvailableInteraction(interaction: AvailableInteraction | null) {
        this.currentInteraction = interaction;
        this.updateInteractButtonVisibility();
        this.updateInteractButtonIcon();
    }

    /**
     * Update interact button visibility based on interaction availability and GUI state
     */
    private updateInteractButtonVisibility() {
        // Only show if: not in GUI AND there's an available interaction
        const isMobile = MobileControls.isMobileDevice();
        const shouldShow = !this.guiCurrentlyOpen && this.currentInteraction !== null && isMobile && !this.keyboardUsed;
        this.setButtonVisible(this.interactButton, shouldShow);
    }

    /**
     * Update interact button icon based on interaction type
     */
    private updateInteractButtonIcon() {
        if (!this.currentInteraction) return;

        const iconContainer = this.interactButton.querySelector('.action-icon');
        if (!iconContainer) return;

        switch (this.currentInteraction.type) {
            case InteractionType.Shove:
                // Lucide "hand" icon for shoving
                iconContainer.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hand">
                        <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/>
                        <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/>
                        <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/>
                        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
                    </svg>
                `;
                break;
            default:
                // Default pointer icon
                iconContainer.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pointer-icon lucide-pointer">
                        <path d="M22 14a8 8 0 0 1-8 8"/>
                        <path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/>
                        <path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1"/>
                        <path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10"/>
                        <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
                    </svg>
                `;
        }
    }

    private setButtonVisible(button: HTMLElement, visible: boolean) {
        button.style.display = visible ? 'flex' : 'none';
    }

    private setupResizeListener() {
        this.resizeListener = () => {
            if (this.isVisible) {
                this.updateTopButtonPositions();
            }
        };
        window.addEventListener('resize', this.resizeListener);
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
        const navbarHeight = this.getNavbarHeight();
        const topOffset = navbarHeight + 16;
        this.fullscreenButton.style.top = `${topOffset}px`;
        this.menuButton.style.top = `${topOffset}px`;
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
    
    private createJoystickZone(): HTMLElement {
        const zone = document.createElement('div');
        zone.id = 'joystick-zone';
        zone.style.cssText = `
            position: absolute;
            left: 0;
            bottom: 0;
            width: 45%;
            height: 50%;
            pointer-events: auto;
            touch-action: none;
        `;
        return zone;
    }
    
    private createJoystickBase(): HTMLElement {
        const base = document.createElement('div');
        base.id = 'joystick-base';
        base.style.cssText = `
            position: absolute;
            left: 50px;
            bottom: 50px;
            width: 120px;
            height: 120px;
            border-radius: ${this.borderRadius};
            background: rgba(40, 40, 40, 0.7);
            border: 3px solid rgba(255, 255, 255, 0.3);
            box-shadow: 
                inset 0 0 20px rgba(0, 0, 0, 0.5),
                0 0 10px rgba(0, 0, 0, 0.3);
            transition: opacity 0.2s, transform 0.1s;
            opacity: 0.8;
        `;
        
        // Add direction indicators (Minecraft Bedrock style)
        const indicators = this.createDirectionIndicators();
        base.appendChild(indicators);
        
        return base;
    }
    
    private createDirectionIndicators(): HTMLElement {
        const container = document.createElement('div');
        container.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 100%;
            height: 100%;
            pointer-events: none;
        `;
        
        // Create 8 direction indicators
        const directions = [
            { angle: -90, symbol: '▲' },   // Up
            { angle: 90, symbol: '▼' },    // Down
            { angle: 180, symbol: '◀' },   // Left
            { angle: 0, symbol: '▶' },     // Right
        ];
        
        directions.forEach(({ angle, symbol }) => {
            const indicator = document.createElement('div');
            const rad = (angle * Math.PI) / 180;
            const dist = 42;
            const x = Math.cos(rad) * dist;
            const y = Math.sin(rad) * dist;
            
            indicator.textContent = symbol;
            indicator.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(calc(-50% + ${x}px), calc(-50% + ${y}px));
                color: rgba(255, 255, 255, 0.25);
                font-size: 14px;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
                pointer-events: none;
            `;
            container.appendChild(indicator);
        });
        
        return container;
    }
    
    private createJoystickKnob(): HTMLElement {
        const knob = document.createElement('div');
        knob.id = 'joystick-knob';
        knob.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 50px;
            height: 50px;
            border-radius: ${this.borderRadius};
            background: linear-gradient(145deg, #555555, #3a3a3a);
            border: 2px solid rgba(255, 255, 255, 0.4);
            box-shadow: 
                0 4px 8px rgba(0, 0, 0, 0.4),
                inset 0 2px 4px rgba(255, 255, 255, 0.1);
            transition: transform 0.05s ease-out;
        `;
        return knob;
    }
    
    private createSprintButton(): HTMLElement {
        const button = document.createElement('div');
        button.id = 'sprint-button';
        // Using Lucide's "chrevrons-up" icon
        button.innerHTML = `
            <div class="sprint-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevrons-up-icon lucide-chevrons-up"><path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/></svg>
            </div>
        `;
        button.style.cssText = `
            position: absolute;
            right: 50px;
            bottom: 50px;
            width: 80px;
            height: 80px;
            border-radius: ${this.borderRadius};
            background: rgba(40, 40, 40, 0.7);
            border: 3px solid rgba(255, 255, 255, 0.3);
            box-shadow: 
                inset 0 0 15px rgba(0, 0, 0, 0.4),
                0 0 10px rgba(0, 0, 0, 0.3);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            touch-action: none;
            transition: background 0.15s, transform 0.1s, border-color 0.15s;
            opacity: 0.8;
        `;
        
        // Style the inner elements
        const style = document.createElement('style');
        style.textContent = `
            #sprint-button .sprint-icon {
                width: 28px;
                height: 28px;
                color: rgba(255, 255, 255, 0.7);
                margin-bottom: 2px;
            }
            #sprint-button.active {
                background: rgba(255, 102, 170, 0.5) !important;
                border-color: rgba(255, 102, 170, 0.8) !important;
                transform: scale(0.95);
            }
            #sprint-button.active .sprint-icon {
                color: #fff;
            }
            #inventory-button, #interact-button {
                position: absolute;
                right: 50px;
                width: 64px;
                height: 64px;
                border-radius: 16px;
                background: rgba(40, 40, 40, 0.7);
                border: 2px solid rgba(255, 255, 255, 0.25);
                box-shadow:
                    inset 0 0 12px rgba(0, 0, 0, 0.35),
                    0 0 8px rgba(0, 0, 0, 0.25);
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: auto;
                touch-action: none;
                transition: background 0.15s, transform 0.1s, border-color 0.15s;
                opacity: 0.8;
            }
            #inventory-button { bottom: 150px; }
            #interact-button { bottom: 230px; }
            #inventory-button .action-icon,
            #interact-button .action-icon {
                width: 26px;
                height: 26px;
                color: rgba(255, 255, 255, 0.75);
            }
            #inventory-button.active,
            #interact-button.active {
                background: rgba(255, 102, 170, 0.45) !important;
                border-color: rgba(255, 102, 170, 0.8) !important;
                transform: scale(0.95);
            }
            #inventory-button.active .action-icon,
            #interact-button.active .action-icon {
                color: #fff;
            }
            #joystick-base.active {
                opacity: 1;
                transform: scale(1.02);
            }
            #fullscreen-button {
                opacity: 0.6;
            }
            #fullscreen-button.active {
                opacity: 1;
                background: rgba(255, 102, 170, 0.45) !important;
                border-color: rgba(255, 102, 170, 0.8) !important;
                transform: scale(0.95);
                box-shadow:
                    inset 0 0 10px rgba(0, 0, 0, 0.3),
                    0 0 8px rgba(255, 102, 170, 0.35);
            }
            #fullscreen-button .fs-icon {
                width: 20px;
                height: 20px;
                color: rgba(255, 255, 255, 0.8);
            }
        `;
        document.head.appendChild(style);
        
        return button;
    }
    
    private createFullscreenButton(): HTMLElement {
        const button = document.createElement('div');
        button.id = 'fullscreen-button';
        // Using Lucide's "maximize" icon (will be updated dynamically)
        button.innerHTML = `
            <div class="fs-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
                    <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                    <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
                    <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                </svg>
            </div>
        `;
        button.style.cssText = `
            position: absolute;
            right: 66px;
            top: 16px;
            width: 36px;
            height: 36px;
            border-radius: ${parseFloat(this.borderRadius) * 0.5}px;
            background: rgba(40, 40, 40, 0.7);
            border: 2px solid rgba(255, 255, 255, 0.25);
            box-shadow: 
                inset 0 0 10px rgba(0, 0, 0, 0.3),
                0 0 8px rgba(0, 0, 0, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            touch-action: none;
            transition: opacity 0.15s, transform 0.1s, background 0.15s, border-color 0.15s, box-shadow 0.15s;
        `;
        
        // Handle fullscreen toggle (trigger on release)
        button.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            button.classList.add('active');
        });
        button.addEventListener('pointerup', (e) => {
            e.preventDefault();
            button.classList.remove('active');
            this.toggleFullscreen();
        });
        button.addEventListener('pointerleave', () => button.classList.remove('active'));
        button.addEventListener('pointercancel', () => button.classList.remove('active'));
        
        // Update icon when fullscreen changes
        document.addEventListener('fullscreenchange', () => this.updateFullscreenIcon(button));
        document.addEventListener('webkitfullscreenchange', () => this.updateFullscreenIcon(button));
        document.addEventListener('mozfullscreenchange', () => this.updateFullscreenIcon(button));
        document.addEventListener('MSFullscreenChange', () => this.updateFullscreenIcon(button));
        
        return button;
    }

    private createMenuButton(): HTMLElement {
        const button = document.createElement('div');
        button.id = 'menu-button';
        // Using Lucide's "menu" icon (hamburger)
        button.innerHTML = `
            <div class="menu-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="4" x2="20" y1="12" y2="12"/>
                    <line x1="4" x2="20" y1="6" y2="6"/>
                    <line x1="4" x2="20" y1="18" y2="18"/>
                </svg>
            </div>
        `;
        button.style.cssText = `
            position: absolute;
            right: 16px;
            top: 16px;
            width: 36px;
            height: 36px;
            border-radius: ${parseFloat(this.borderRadius) * 0.5}px;
            background: rgba(40, 40, 40, 0.7);
            border: 2px solid rgba(255, 255, 255, 0.25);
            box-shadow: 
                inset 0 0 10px rgba(0, 0, 0, 0.3),
                0 0 8px rgba(0, 0, 0, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            touch-action: none;
            transition: opacity 0.15s, transform 0.1s, background 0.15s, border-color 0.15s, box-shadow 0.15s;
        `;

        // Style the icon
        const style = document.createElement('style');
        style.textContent = `
            #menu-button {
                opacity: 0.6;
            }
            #menu-button .menu-icon {
                width: 16px;
                height: 16px;
                color: rgba(255, 255, 255, 0.8);
            }
            #menu-button.active {
                opacity: 1;
                background: rgba(255, 102, 170, 0.45) !important;
                border-color: rgba(255, 102, 170, 0.8) !important;
                transform: scale(0.95);
                box-shadow:
                    inset 0 0 10px rgba(0, 0, 0, 0.3),
                    0 0 8px rgba(255, 102, 170, 0.35);
            }
        `;
        document.head.appendChild(style);

        // Handle menu toggle (trigger on release)
        button.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            button.classList.add('active');
        });
        button.addEventListener('pointerup', (e) => {
            e.preventDefault();
            button.classList.remove('active');
            window.dispatchEvent(new CustomEvent('mobile:menu'));
        });
        button.addEventListener('pointerleave', () => button.classList.remove('active'));
        button.addEventListener('pointercancel', () => button.classList.remove('active'));

        return button;
    }

    private createInventoryButton(): HTMLElement {
        const button = document.createElement('div');
        button.id = 'inventory-button';
        // Using Lucide's "backpack" icon
        button.innerHTML = `
            <div class="action-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-backpack-icon lucide-backpack"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 10h8"/><path d="M8 18h8"/><path d="M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
            </div>
        `;

        const fire = () => window.dispatchEvent(new CustomEvent('mobile:inventory'));
        button.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            button.classList.add('active');
        });
        button.addEventListener('pointerup', (e) => {
            e.preventDefault();
            button.classList.remove('active');
            fire();
        });
        button.addEventListener('pointerleave', () => button.classList.remove('active'));
        button.addEventListener('pointercancel', () => button.classList.remove('active'));

        return button;
    }

    private createInteractButton(): HTMLElement {
        const button = document.createElement('div');
        button.id = 'interact-button';
        // Using Lucide's "pointer" icon (hand with pointing finger) - default icon
        button.innerHTML = `
            <div class="action-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pointer-icon lucide-pointer"><path d="M22 14a8 8 0 0 1-8 8"/><path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1"/><path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>
            </div>
        `;

        // Start hidden - will be shown when interaction is available
        button.style.display = 'none';

        // Interact fires on press (not release) for faster response
        const fire = () => window.dispatchEvent(new CustomEvent('mobile:interact'));
        button.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            button.classList.add('active');
            fire(); // Fire immediately on press
        });
        button.addEventListener('pointerup', (e) => {
            e.preventDefault();
            button.classList.remove('active');
        });
        button.addEventListener('pointerleave', () => button.classList.remove('active'));
        button.addEventListener('pointercancel', () => button.classList.remove('active'));

        return button;
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
    
    private updateFullscreenIcon(button: HTMLElement) {
        const isFullscreen = this.isAnyFullscreen();
        
        if (isFullscreen) {
            // Show exit fullscreen icon (Lucide "minimize")
            button.innerHTML = `
                <div class="fs-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 3v3a2 2 0 0 1-2 2H3"/>
                        <path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
                        <path d="M3 16h3a2 2 0 0 1 2 2v3"/>
                        <path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
                    </svg>
                </div>
            `;
        } else {
            // Show enter fullscreen icon (Lucide "maximize")
            button.innerHTML = `
                <div class="fs-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
                        <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                        <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
                        <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                    </svg>
                </div>
            `;
        }
    }
    
    // ==================== Event Handling ====================
    
    private setupEventListeners() {
        // Joystick touch events
        this.joystickZone.addEventListener('touchstart', this.onJoystickTouchStart.bind(this), { passive: false });
        this.joystickZone.addEventListener('touchmove', this.onJoystickTouchMove.bind(this), { passive: false });
        this.joystickZone.addEventListener('touchend', this.onJoystickTouchEnd.bind(this), { passive: false });
        this.joystickZone.addEventListener('touchcancel', this.onJoystickTouchEnd.bind(this), { passive: false });
        
        // Sprint button touch events
        this.sprintButton.addEventListener('touchstart', this.onSprintTouchStart.bind(this), { passive: false });
        this.sprintButton.addEventListener('touchend', this.onSprintTouchEnd.bind(this), { passive: false });
        this.sprintButton.addEventListener('touchcancel', this.onSprintTouchEnd.bind(this), { passive: false });
        
        // Prevent context menu on long press
        this.container.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    
    private onJoystickTouchStart(e: TouchEvent) {
        e.preventDefault();
        
        if (this.joystickTouchId !== null) return;
        
        const touch = e.changedTouches[0];
        this.joystickTouchId = touch.identifier;
        this.joystickActive = true;
        
        // Set center at touch position (dynamic joystick)
        const baseRect = this.joystickBase.getBoundingClientRect();
        this.joystickCenter = {
            x: baseRect.left + baseRect.width / 2,
            y: baseRect.top + baseRect.height / 2
        };
        
        this.joystickBase.classList.add('active');
        this.updateJoystickPosition(touch.clientX, touch.clientY);
    }
    
    private onJoystickTouchMove(e: TouchEvent) {
        e.preventDefault();
        
        if (!this.joystickActive || this.joystickTouchId === null) return;
        
        // Find our touch
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.identifier === this.joystickTouchId) {
                this.updateJoystickPosition(touch.clientX, touch.clientY);
                break;
            }
        }
    }
    
    private onJoystickTouchEnd(e: TouchEvent) {
        // Check if our touch ended
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.identifier === this.joystickTouchId) {
                this.joystickActive = false;
                this.joystickTouchId = null;
                
                // Reset visual
                this.joystickKnob.style.transform = 'translate(-50%, -50%)';
                this.joystickBase.classList.remove('active');
                
                // Reset directional input
                this.inputState.up = false;
                this.inputState.down = false;
                this.inputState.left = false;
                this.inputState.right = false;
                break;
            }
        }
    }
    
    private updateJoystickPosition(touchX: number, touchY: number) {
        const dx = touchX - this.joystickCenter.x;
        const dy = touchY - this.joystickCenter.y;
        const distance = Math.hypot(dx, dy);
        const maxDist = this.joystickRadius;
        
        // Calculate clamped position
        let clampedX = dx;
        let clampedY = dy;
        
        if (distance > maxDist) {
            const ratio = maxDist / distance;
            clampedX = dx * ratio;
            clampedY = dy * ratio;
        }
        
        // Update knob visual position
        this.joystickKnob.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;
        
        // Calculate normalized direction
        const normalizedDist = Math.min(distance / maxDist, 1);
        
        // Apply deadzone
        if (normalizedDist < this.deadzone) {
            this.inputState.up = false;
            this.inputState.down = false;
            this.inputState.left = false;
            this.inputState.right = false;
            return;
        }
        
        // Convert to 8-direction input
        const angle = Math.atan2(dy, dx);
        const angleDeg = ((angle * 180) / Math.PI + 360) % 360;
        
        // Determine which of 8 directions based on angle
        // Each direction covers 45 degrees
        this.inputState.right = angleDeg < 67.5 || angleDeg >= 292.5;
        this.inputState.down = angleDeg >= 22.5 && angleDeg < 157.5;
        this.inputState.left = angleDeg >= 112.5 && angleDeg < 247.5;
        this.inputState.up = angleDeg >= 202.5 && angleDeg < 337.5;
    }
    
    private onSprintTouchStart(e: TouchEvent) {
        e.preventDefault();
        
        if (this.sprintTouchId !== null) return;
        
        const touch = e.changedTouches[0];
        this.sprintTouchId = touch.identifier;
        this.inputState.sprint = true;
        this.sprintButton.classList.add('active');
    }
    
    private onSprintTouchEnd(e: TouchEvent) {
        // Check if our touch ended
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.identifier === this.sprintTouchId) {
                this.sprintTouchId = null;
                this.inputState.sprint = false;
                this.sprintButton.classList.remove('active');
                break;
            }
        }
    }
}
