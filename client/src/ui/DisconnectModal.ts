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

        this.modal = document.createElement('div');
        this.modal.className = 'disconnect-modal-overlay';
        this.modal.innerHTML = `
            <div class="disconnect-modal">
                <div class="disconnect-modal-icon">⚡</div>
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
}
