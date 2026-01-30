/**
 * Mobile Controls - Minecraft Bedrock Style
 * Virtual joystick for 8-direction movement + sprint button
 * 
 * Design notes:
 * - Left side: Virtual joystick (movement)
 * - Right side: Sprint button
 * - Auto-hides on desktop, shows on touch devices
 */

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
    private fullscreenButton: HTMLElement;
    
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
    
    // Sprint button state
    private sprintTouchId: number | null = null;
    
    // Visibility
    private isVisible = false;
    private keyboardUsed = false; // Once keyboard is used, hide controls permanently
    private keyboardListener?: (e: KeyboardEvent) => void;
    
    constructor() {
        this.container = this.createContainer();
        this.joystickZone = this.createJoystickZone();
        this.joystickBase = this.createJoystickBase();
        this.joystickKnob = this.createJoystickKnob();
        this.sprintButton = this.createSprintButton();
        this.fullscreenButton = this.createFullscreenButton();
        
        this.joystickBase.appendChild(this.joystickKnob);
        this.joystickZone.appendChild(this.joystickBase);
        this.container.appendChild(this.joystickZone);
        this.container.appendChild(this.sprintButton);
        this.container.appendChild(this.fullscreenButton);
        
        this.setupEventListeners();
        this.setupKeyboardDetection();
        
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
                this.hide();
                // Remove listener - decision is permanent until page reload
                if (this.keyboardListener) {
                    window.removeEventListener('keydown', this.keyboardListener);
                }
            }
        };
        
        window.addEventListener('keydown', this.keyboardListener);
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
     * Show controls (only on mobile devices, and only if keyboard hasn't been used)
     */
    show() {
        // Don't show if keyboard was used or not a mobile device
        if (this.keyboardUsed || !MobileControls.isMobileDevice()) {
            return;
        }
        
        // Append to #app so controls work in fullscreen mode
        const gameContainer = document.getElementById('app') || document.body;
        if (!gameContainer.contains(this.container)) {
            gameContainer.appendChild(this.container);
        }
        this.container.style.display = 'block';
        this.isVisible = true;
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
            border-radius: 50%;
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
            border-radius: 50%;
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
        button.innerHTML = `
            <div class="sprint-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/>
                </svg>
            </div>
            <span class="sprint-label">SPRINT</span>
        `;
        button.style.cssText = `
            position: absolute;
            right: 50px;
            bottom: 50px;
            width: 80px;
            height: 80px;
            border-radius: 50%;
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
            #sprint-button .sprint-label {
                font-family: 'Minecraft', sans-serif;
                font-size: 9px;
                color: rgba(255, 255, 255, 0.6);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            #sprint-button.active {
                background: rgba(255, 102, 170, 0.5) !important;
                border-color: rgba(255, 102, 170, 0.8) !important;
                transform: scale(0.95);
            }
            #sprint-button.active .sprint-icon {
                color: #fff;
            }
            #sprint-button.active .sprint-label {
                color: #fff;
            }
            #joystick-base.active {
                opacity: 1;
                transform: scale(1.02);
            }
            #fullscreen-button {
                opacity: 0.6;
            }
            #fullscreen-button:active {
                opacity: 1;
                transform: scale(0.95);
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
        button.innerHTML = `
            <div class="fs-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                </svg>
            </div>
        `;
        button.style.cssText = `
            position: absolute;
            left: 50px;
            bottom: 180px;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: rgba(40, 40, 40, 0.7);
            border: 2px solid rgba(255, 255, 255, 0.2);
            box-shadow: 
                inset 0 0 10px rgba(0, 0, 0, 0.3),
                0 0 8px rgba(0, 0, 0, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            touch-action: none;
            transition: opacity 0.15s, transform 0.1s;
        `;
        
        // Handle fullscreen toggle
        button.addEventListener('click', () => this.toggleFullscreen());
        button.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.toggleFullscreen();
        });
        
        // Update icon when fullscreen changes
        document.addEventListener('fullscreenchange', () => this.updateFullscreenIcon(button));
        document.addEventListener('webkitfullscreenchange', () => this.updateFullscreenIcon(button));
        document.addEventListener('mozfullscreenchange', () => this.updateFullscreenIcon(button));
        document.addEventListener('MSFullscreenChange', () => this.updateFullscreenIcon(button));
        
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
            // Show exit fullscreen icon
            button.innerHTML = `
                <div class="fs-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
                    </svg>
                </div>
            `;
        } else {
            // Show enter fullscreen icon
            button.innerHTML = `
                <div class="fs-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
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
