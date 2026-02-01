/**
 * AfkModal - Shows when the player is sent to limbo for AFK
 * Guppy Labs 2026
 */

export class AfkModal {
    private static modal: HTMLElement | null = null;
    private static isShowing = false;

    static show(onClose: () => void, onRejoin: () => void): void {
        if (this.isShowing) return;
        this.isShowing = true;

        this.modal = document.createElement('div');
        this.modal.className = 'disconnect-modal-overlay';
        this.modal.innerHTML = `
            <div class="disconnect-modal">
                <div class="disconnect-modal-icon">🕒</div>
                <div class="disconnect-modal-title">AFK Detected</div>
                <div class="disconnect-modal-message">
                    You were moved to limbo for being idle.<br>
                    You can rejoin the lobby at any time.
                </div>
                <div class="afk-modal-actions">
                    <button class="disconnect-modal-btn afk-modal-btn-secondary" id="afk-close-btn">
                        Close
                    </button>
                    <button class="disconnect-modal-btn" id="afk-rejoin-btn">
                        Rejoin Lobby
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(this.modal);

        const closeBtn = this.modal.querySelector('#afk-close-btn');
        const rejoinBtn = this.modal.querySelector('#afk-rejoin-btn');

        closeBtn?.addEventListener('click', () => {
            this.hide();
            onClose();
        });

        rejoinBtn?.addEventListener('click', () => {
            this.hide();
            onRejoin();
        });
    }

    static hide(): void {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        this.isShowing = false;
    }
}
