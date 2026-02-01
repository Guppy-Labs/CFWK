/**
 * LimboModal - Shows when player is sent to limbo for disconnect/ban
 * Guppy Labs 2026
 */

export class LimboModal {
    private static modal: HTMLElement | null = null;
    private static isShowing = false;

    static show(
        title: string,
        message: string,
        options: { showRejoin: boolean; onClose: () => void; onRejoin?: () => void }
    ): void {
        if (this.isShowing) return;
        this.isShowing = true;

        this.modal = document.createElement('div');
        this.modal.className = 'disconnect-modal-overlay';
        this.modal.innerHTML = `
            <div class="disconnect-modal">
                <div class="disconnect-modal-icon">⚠️</div>
                <div class="disconnect-modal-title">${title}</div>
                <div class="disconnect-modal-message">
                    ${message}
                </div>
                <div class="afk-modal-actions">
                    <button class="disconnect-modal-btn afk-modal-btn-secondary" id="limbo-close-btn">
                        Close
                    </button>
                    ${options.showRejoin ? `<button class="disconnect-modal-btn" id="limbo-rejoin-btn">Rejoin Lobby</button>` : ''}
                </div>
            </div>
        `;

        document.body.appendChild(this.modal);

        const closeBtn = this.modal.querySelector('#limbo-close-btn');
        const rejoinBtn = this.modal.querySelector('#limbo-rejoin-btn');

        closeBtn?.addEventListener('click', () => {
            this.hide();
            options.onClose();
        });

        rejoinBtn?.addEventListener('click', () => {
            this.hide();
            options.onRejoin?.();
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
