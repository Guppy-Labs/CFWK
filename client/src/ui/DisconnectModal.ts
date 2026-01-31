/**
 * DisconnectModal - Shows when the server connection is lost
 * Guppy Labs 2026
 */

export class DisconnectModal {
    private static modal: HTMLElement | null = null;
    private static isShowing = false;

    /**
     * Show the disconnect modal after a delay
     * @param delayMs - Time in ms to wait before showing (default: 5000)
     * @param message - Custom message to show (optional)
     * @param title - Custom title (optional)
     */
    static show(delayMs: number = 5000, message?: string, title?: string): void {
        if (this.isShowing) return;
        this.isShowing = true;

        // Store flag so reload goes to limbo
        localStorage.setItem('cfwk_disconnected', 'true');

        setTimeout(() => {
            this.createModal(message, title);
        }, delayMs);
    }

    /**
     * Hide and remove the modal
     */
    static hide(): void {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        this.isShowing = false;
    }

    private static createModal(message?: string, title?: string): void {
        // Remove existing modal if any
        this.hide();
        this.isShowing = true;

        const displayTitle = title || 'Server Offline';
        const displayMessage = message || 'The connection to the game server was lost.<br>Please try again later.';
        
        // Pick icon based on title - both "BANNED" and "ACCOUNT BANNED" use the banned icon
        const isBanned = displayTitle.toUpperCase().includes('BANNED');
        const icon = isBanned ? this.getBannedIcon() : this.getDisconnectIcon();

        this.modal = document.createElement('div');
        this.modal.className = 'disconnect-modal-overlay';
        this.modal.innerHTML = `
            <div class="disconnect-modal">
                <div class="disconnect-modal-icon">${icon}</div>
                <div class="disconnect-modal-title">${displayTitle}</div>
                <div class="disconnect-modal-message">
                    ${displayMessage}
                </div>
                <button class="disconnect-modal-btn" id="disconnect-reload-btn">
                    Reload Game
                </button>
            </div>
        `;

        document.body.appendChild(this.modal);

        // Add click handler for reload button
        const reloadBtn = this.modal.querySelector('#disconnect-reload-btn');
        reloadBtn?.addEventListener('click', () => {
            window.location.reload();
        });
    }

    /**
     * Check if user was previously disconnected (for boot scene)
     */
    static wasDisconnected(): boolean {
        return localStorage.getItem('cfwk_disconnected') === 'true';
    }

    /**
     * Clear the disconnected flag
     */
    static clearDisconnectedFlag(): void {
        localStorage.removeItem('cfwk_disconnected');
    }

    /**
     * Pixelated disconnect icon (unplugged cable)
     */
    private static getDisconnectIcon(): string {
        return `<svg width="48" height="48" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated;">
            <!-- Plug left side -->
            <rect x="1" y="6" width="2" height="1" fill="#888"/>
            <rect x="1" y="9" width="2" height="1" fill="#888"/>
            <rect x="3" y="5" width="3" height="6" fill="#666"/>
            <rect x="4" y="6" width="1" height="4" fill="#555"/>
            <!-- Plug right side -->
            <rect x="13" y="6" width="2" height="1" fill="#888"/>
            <rect x="13" y="9" width="2" height="1" fill="#888"/>
            <rect x="10" y="5" width="3" height="6" fill="#666"/>
            <rect x="11" y="6" width="1" height="4" fill="#555"/>
            <!-- Spark/gap in middle -->
            <rect x="7" y="7" width="2" height="2" fill="#ff66aa"/>
            <rect x="8" y="6" width="1" height="1" fill="#ff99cc"/>
            <rect x="7" y="9" width="1" height="1" fill="#ff99cc"/>
        </svg>`;
    }

    /**
     * Pixelated ban icon (fish with X)
     */
    private static getBannedIcon(): string {
        return `<svg width="48" height="48" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated;">
            <!-- Simple fish body -->
            <rect x="4" y="6" width="6" height="4" fill="#ff66aa"/>
            <rect x="3" y="7" width="1" height="2" fill="#ff66aa"/>
            <rect x="10" y="7" width="1" height="2" fill="#ff66aa"/>
            <!-- Tail -->
            <rect x="1" y="6" width="2" height="1" fill="#ff66aa"/>
            <rect x="1" y="9" width="2" height="1" fill="#ff66aa"/>
            <rect x="2" y="7" width="1" height="2" fill="#ff66aa"/>
            <!-- Eye -->
            <rect x="9" y="7" width="1" height="1" fill="#1e1e1e"/>
            <!-- X overlay -->
            <rect x="3" y="3" width="2" height="2" fill="#ff4444"/>
            <rect x="5" y="5" width="2" height="2" fill="#ff4444"/>
            <rect x="7" y="7" width="2" height="2" fill="#ff4444"/>
            <rect x="9" y="9" width="2" height="2" fill="#ff4444"/>
            <rect x="11" y="11" width="2" height="2" fill="#ff4444"/>
            <rect x="11" y="3" width="2" height="2" fill="#ff4444"/>
            <rect x="9" y="5" width="2" height="2" fill="#ff4444"/>
            <rect x="5" y="9" width="2" height="2" fill="#ff4444"/>
            <rect x="3" y="11" width="2" height="2" fill="#ff4444"/>
        </svg>`;
    }
}
