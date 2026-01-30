/**
 * ErrorModal - Shows when a client-side error occurs
 * Replaces the default Vite overlay or browser console for critical errors
 */

export class ErrorModal {
    private static modal: HTMLElement | null = null;
    private static isShowing = false;
    private static errorCount = 0;

    /**
     * Show the error modal
     * @param error - The error object or message
     * @param source - Source of the error (optional)
     */
    static show(error: any, source?: string): void {
        this.errorCount++;
        
        // If already showing, maybe append to it? For now, just ensuring it's visible.
        if (this.isShowing && this.modal) {
             // Optional: Update the message to show multiple errors?
             // For now, let's just keep the first one or replace it.
             // Replacing might be better to see the latest crash.
             this.updateMessage(error, source);
             return;
        }

        this.isShowing = true;
        this.createModal(error, source);
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
        this.errorCount = 0;
    }

    private static updateMessage(error: any, source?: string) {
        if (!this.modal) return;
        const msgEl = this.modal.querySelector('.error-modal-message');
        const detailsEl = this.modal.querySelector('.error-modal-details');
        
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';

        if (msgEl) msgEl.innerHTML = `An unexpected client error occurred.<br>Error count: ${this.errorCount}`;
        if (detailsEl) {
            detailsEl.textContent = `${source ? `Source: ${source}\n` : ''}${message}\n\n${stack}`;
        }
    }

    private static createModal(error: any, source?: string): void {
        // Remove existing modal if any
        if (this.modal) this.modal.remove();
        
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';

        this.modal = document.createElement('div');
        this.modal.className = 'error-modal-overlay';
        this.modal.innerHTML = `
            <div class="error-modal">
                <div class="error-modal-header">
                    <div class="error-modal-icon">⚠️</div>
                    <div class="error-modal-title">Client Error</div>
                </div>
                <div class="error-modal-body">
                    <div class="error-modal-message">An unexpected client error occurred.</div>
                    <div class="error-modal-details-container">
                        <pre class="error-modal-details">${source ? `Source: ${source}\n` : ''}${message}\n\n${stack}</pre>
                    </div>
                </div>
                <div class="error-modal-footer">
                    <button class="error-modal-btn reload">Reload Page</button>
                    <button class="error-modal-btn dismiss">Dismiss</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.modal);

        // Event listeners
        const reloadBtn = this.modal.querySelector('.reload');
        const dismissBtn = this.modal.querySelector('.dismiss');

        if (reloadBtn) {
            reloadBtn.addEventListener('click', () => {
                window.location.reload();
            });
        }

        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                this.hide();
            });
        }
    }
}
