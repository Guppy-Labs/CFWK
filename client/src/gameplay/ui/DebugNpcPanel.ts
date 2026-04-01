type DebugNpcPanelOptions = {
    onResetMyGame: () => void;
    onGetScar: () => void;
    onGetDevRod: () => void;
    onClose: () => void;
};

export class DebugNpcPanel {
    private static root: HTMLElement | null = null;
    private static isOpen = false;

    static show(options: DebugNpcPanelOptions): void {
        if (this.isOpen) return;
        this.hide();
        this.isOpen = true;

        const root = document.createElement('div');
        root.className = 'debug-npc-panel-overlay';
        root.innerHTML = `
            <div class="debug-npc-panel">
                <div class="debug-npc-panel-title">Debug</div>
                <div class="debug-npc-panel-actions">
                    <button class="debug-npc-panel-btn" data-action="reset">Reset my game</button>
                    <button class="debug-npc-panel-btn" data-action="scar">Get a scar</button>
                    <button class="debug-npc-panel-btn" data-action="rod">Get a dev rod</button>
                </div>
                <button class="debug-npc-panel-close-btn" data-action="close">Close</button>
            </div>
        `;

        const resetBtn = root.querySelector('[data-action="reset"]');
        const scarBtn = root.querySelector('[data-action="scar"]');
        const rodBtn = root.querySelector('[data-action="rod"]');
        const closeBtn = root.querySelector('[data-action="close"]');

        resetBtn?.addEventListener('click', () => options.onResetMyGame());
        scarBtn?.addEventListener('click', () => options.onGetScar());
        rodBtn?.addEventListener('click', () => options.onGetDevRod());
        closeBtn?.addEventListener('click', () => {
            this.hide();
            options.onClose();
        });

        document.body.appendChild(root);
        this.root = root;
    }

    static hide(): void {
        if (this.root) {
            this.root.remove();
            this.root = null;
        }
        this.isOpen = false;
    }

    static getIsOpen(): boolean {
        return this.isOpen;
    }
}
