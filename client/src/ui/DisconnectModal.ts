/**
 * DisconnectModal - Shows when the server connection is lost or a user is removed
 * Guppy Labs 2026
 */

type DisconnectModalOptions = {
    title: string;
    message: string;
    showReconnect?: boolean;
    showLeave?: boolean;
    reconnectLabel?: string;
    leaveLabel?: string;
    icon?: 'disconnect' | 'ban' | 'afk' | 'warning';
    onReconnect?: () => void;
    onLeave?: () => void;
};

export class DisconnectModal {
    private static modal: HTMLElement | null = null;
    private static isShowing = false;

    static show(options: DisconnectModalOptions): void {
        if (this.isShowing) return;
        this.isShowing = true;

        this.createModal(options);
    }

    static hide(): void {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        this.isShowing = false;
    }

    private static createModal(options: DisconnectModalOptions): void {
        this.hide();
        this.isShowing = true;

        const showReconnect = options.showReconnect !== false;
        const showLeave = options.showLeave !== false;
        const reconnectLabel = options.reconnectLabel || 'Reconnect';
        const leaveLabel = options.leaveLabel || 'Leave Game';

        const icon = this.getIcon(options.icon, options.title);

        this.modal = document.createElement('div');
        this.modal.className = 'disconnect-modal-overlay';
        this.modal.innerHTML = `
            <div class="disconnect-modal">
                <div class="disconnect-modal-icon">${icon}</div>
                <div class="disconnect-modal-title">${options.title}</div>
                <div class="disconnect-modal-message">
                    ${options.message}
                </div>
                <div class="afk-modal-actions">
                    ${showLeave ? `<button class="disconnect-modal-btn afk-modal-btn-secondary" id="disconnect-leave-btn">${leaveLabel}</button>` : ''}
                    ${showReconnect ? `<button class="disconnect-modal-btn" id="disconnect-reconnect-btn">${reconnectLabel}</button>` : ''}
                </div>
            </div>
        `;

        document.body.appendChild(this.modal);

        const reconnectBtn = this.modal.querySelector('#disconnect-reconnect-btn');
        const leaveBtn = this.modal.querySelector('#disconnect-leave-btn');

        reconnectBtn?.addEventListener('click', () => {
            this.hide();
            if (options.onReconnect) {
                options.onReconnect();
            } else {
                window.location.reload();
            }
        });

        leaveBtn?.addEventListener('click', () => {
            this.hide();
            if (options.onLeave) {
                options.onLeave();
            } else {
                window.location.href = '/account';
            }
        });
    }

    private static getIcon(icon: DisconnectModalOptions['icon'], title: string): string {
        if (icon === 'ban') return this.getBannedIcon();
        if (icon === 'afk') return this.getAfkIcon();
        if (icon === 'warning') return this.getWarningIcon();

        const isBanned = title.toUpperCase().includes('BANNED');
        return isBanned ? this.getBannedIcon() : this.getDisconnectIcon();
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

    private static getAfkIcon(): string {
        return `<svg width="48" height="48" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated;">
            <rect x="2" y="2" width="12" height="12" fill="#2f2f2f"/>
            <rect x="3" y="3" width="10" height="10" fill="#3f3f3f"/>
            <rect x="7" y="4" width="2" height="5" fill="#ffcc66"/>
            <rect x="8" y="8" width="3" height="2" fill="#ffcc66"/>
            <rect x="7" y="10" width="2" height="2" fill="#ffcc66"/>
        </svg>`;
    }

    private static getWarningIcon(): string {
        return `<svg width="48" height="48" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated;">
            <rect x="7" y="2" width="2" height="8" fill="#ffcc66"/>
            <rect x="7" y="11" width="2" height="2" fill="#ffcc66"/>
            <rect x="6" y="10" width="4" height="1" fill="#ffcc66"/>
            <rect x="5" y="11" width="6" height="1" fill="#ffcc66"/>
            <rect x="4" y="12" width="8" height="1" fill="#ffcc66"/>
        </svg>`;
    }
}
