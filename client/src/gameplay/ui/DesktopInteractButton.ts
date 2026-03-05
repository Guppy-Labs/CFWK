/**
 * Desktop Interact Button - Always-visible interaction indicator for desktop
 * 
 * Shows an X when no interaction is available, or the interaction icon when one is.
 * Displays the F key binding in the corner. Non-interactive (keyboard only).
 */

import { AvailableInteraction } from '../interaction/InteractionManager';
import { MobileControls } from './MobileControls';
import { getInteractionPromptStyle, DesktopInteractionIconKey } from './InteractionPromptStyle';

// SVG icons
const ICONS: Record<DesktopInteractionIconKey, string> = {
    // X icon for no interaction
    none: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x">
            <path d="M18 6 6 18"/>
            <path d="m6 6 12 12"/>
        </svg>
    `,
    // Hand icon for shove interaction
    shove: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hand">
            <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/>
            <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/>
            <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/>
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
        </svg>
    `,
    talk: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle">
            <path d="M21 11.5a8.38 8.38 0 0 1-1.9 5.4a8.5 8.5 0 0 1-6.6 3.1a8.38 8.38 0 0 1-5.4-1.9L3 21l1.9-4.1a8.38 8.38 0 0 1-1.9-5.4a8.5 8.5 0 0 1 3.1-6.6a8.38 8.38 0 0 1 5.4-1.9h.5a8.48 8.48 0 0 1 8 8z"/>
        </svg>
    `,
    harvest: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="13" r="3.2" />
            <circle cx="15" cy="12" r="3.2" />
            <path d="M11.5 8.2c1.1-2.1 3.2-3.2 5.8-3.2" />
            <path d="M11 8.4c-1.4-1.2-3-1.7-5-1.7" />
        </svg>
    `
};

export class DesktopInteractButton {
    private container: HTMLElement;
    private iconContainer: HTMLElement;
    private keyBadge: HTMLElement;
    private currentInteraction: AvailableInteraction | null = null;
    private isVisible = false;
    private guiCurrentlyOpen = false;
    private guiOpenListener?: (event: Event) => void;
    private readonly cornerMargin = 24;
    private readonly inventorySize = 24 * 3.2;
    private readonly inventoryGap = 14;

    constructor() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'desktop-interact-button';
        
        // Create icon container
        this.iconContainer = document.createElement('div');
        this.iconContainer.className = 'action-icon';
        this.iconContainer.innerHTML = ICONS.none;
        
        // Create key badge
        this.keyBadge = document.createElement('div');
        this.keyBadge.className = 'key-badge';
        this.keyBadge.textContent = 'F';
        
        this.container.appendChild(this.iconContainer);
        this.container.appendChild(this.keyBadge);
        
        // Add styles
        this.injectStyles();
        
        // Setup GUI open listener
        this.setupGuiOpenListener();
    }

    private injectStyles() {
        const styleId = 'desktop-interact-button-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #desktop-interact-button {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 56px;
                height: 56px;
                background: rgba(0, 0, 0, 0.55);
                border-radius: 8px;
                border: 2px solid rgba(255, 255, 255, 0.25);
                box-shadow:
                    inset 0 0 12px rgba(0, 0, 0, 0.35),
                    0 0 8px rgba(0, 0, 0, 0.25);
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
                transition: opacity 0.15s, border-color 0.15s;
                opacity: 0.6;
                z-index: 1000;
            }
            
            #desktop-interact-button.has-interaction {
                opacity: 0.9;
                border-color: rgba(255, 255, 255, 0.4);
            }
            
            #desktop-interact-button .action-icon {
                width: 26px;
                height: 26px;
                color: rgba(255, 255, 255, 0.6);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: color 0.15s;
            }
            
            #desktop-interact-button.has-interaction .action-icon {
                color: rgba(255, 255, 255, 0.9);
            }
            
            #desktop-interact-button .action-icon svg {
                width: 100%;
                height: 100%;
            }
            
            #desktop-interact-button .key-badge {
                position: absolute;
                bottom: 2px;
                right: 4px;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 14px;
                font-weight: 700;
                color: rgba(255, 255, 255, 0.85);
                text-transform: uppercase;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
                display: none;
            }
            
            #desktop-interact-button.has-interaction .key-badge {
                display: block;
            }
        `;
        document.head.appendChild(style);
    }

    private setupGuiOpenListener() {
        this.guiOpenListener = (event: Event) => {
            const customEvent = event as CustomEvent<{ isOpen: boolean; source: string }>;
            this.guiCurrentlyOpen = customEvent.detail.isOpen;
            this.updateVisibility();
        };
        window.addEventListener('gui-open-changed', this.guiOpenListener);
    }

    /**
     * Update available interaction
     */
    setAvailableInteraction(interaction: AvailableInteraction | null) {
        this.currentInteraction = interaction;
        this.updateIcon();
        this.updateVisibility();
    }

    private updateIcon() {
        if (this.currentInteraction) {
            const style = getInteractionPromptStyle(this.currentInteraction);
            this.iconContainer.innerHTML = ICONS[style.desktopIcon] ?? ICONS.none;
            this.container.classList.add('has-interaction');
        } else {
            this.iconContainer.innerHTML = ICONS.none;
            this.container.classList.remove('has-interaction');
        }
    }

    private updateVisibility() {
        // Only show on desktop (non-mobile) when not in GUI
        const isMobile = MobileControls.isMobileDevice();
        const shouldShow = this.isVisible && !isMobile && !this.guiCurrentlyOpen && !!this.currentInteraction;
        this.container.style.display = shouldShow ? 'flex' : 'none';
        if (shouldShow) {
            this.updatePosition();
        }
    }

    private updatePosition() {
        const bottom = this.cornerMargin + this.inventorySize + this.inventoryGap;
        this.container.style.right = `${this.cornerMargin}px`;
        this.container.style.bottom = `${Math.round(bottom)}px`;
    }

    /**
     * Show the button
     */
    show() {
        // Append to #app so it works in fullscreen mode
        const gameContainer = document.getElementById('app') || document.body;
        if (!gameContainer.contains(this.container)) {
            gameContainer.appendChild(this.container);
        }
        this.isVisible = true;
        this.updateVisibility();
    }

    /**
     * Hide the button
     */
    hide() {
        this.isVisible = false;
        this.container.style.display = 'none';
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this.guiOpenListener) {
            window.removeEventListener('gui-open-changed', this.guiOpenListener);
        }
        this.container.remove();
    }
}
