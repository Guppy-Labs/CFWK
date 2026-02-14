import Phaser from 'phaser';
import { ControlActionKey, IControlsSettings } from '@cfwk/shared';
import { KeybindManager } from '../../input/KeybindManager';
import { SettingsFont } from './SettingsFont';

type SettingsControlsPanelConfig = {
    onControlsChange?: (controls: IControlsSettings) => void;
    resolveLabel?: (key: string, fallback: string, params?: Record<string, string | number>) => string;
};

type ControlRowConfig = {
    action: ControlActionKey;
    labelKey: string;
    fallbackLabel: string;
};

type ControlRow = ControlRowConfig & {
    label: Phaser.GameObjects.Image;
    valueButton: Phaser.GameObjects.Image;
    valueText: Phaser.GameObjects.Image;
};

const CONTROL_ROWS: ControlRowConfig[] = [
    { action: 'moveUp', labelKey: 'settings.controls.action.moveUp', fallbackLabel: 'Walk Up' },
    { action: 'moveLeft', labelKey: 'settings.controls.action.moveLeft', fallbackLabel: 'Walk Left' },
    { action: 'moveDown', labelKey: 'settings.controls.action.moveDown', fallbackLabel: 'Walk Down' },
    { action: 'moveRight', labelKey: 'settings.controls.action.moveRight', fallbackLabel: 'Walk Right' },
    { action: 'sprint', labelKey: 'settings.controls.action.sprint', fallbackLabel: 'Sprint' },
    { action: 'interact', labelKey: 'settings.controls.action.interact', fallbackLabel: 'Interact' },
    { action: 'inventory', labelKey: 'settings.controls.action.inventory', fallbackLabel: 'Inventory' },
    { action: 'fish', labelKey: 'settings.controls.action.fish', fallbackLabel: 'Fish' },
    { action: 'playerList', labelKey: 'settings.controls.action.playerList', fallbackLabel: 'Player List' },
    { action: 'chat', labelKey: 'settings.controls.action.chat', fallbackLabel: 'Chat' },
    { action: 'dialogueAdvance', labelKey: 'settings.controls.action.dialogueAdvance', fallbackLabel: 'Dialogue Advance' }
];

export class SettingsControlsPanel {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private font: SettingsFont;
    private resolveLabel?: (key: string, fallback: string, params?: Record<string, string | number>) => string;
    private onControlsChange?: (controls: IControlsSettings) => void;
    private keybindManager = KeybindManager.getInstance();

    private rows: ControlRow[] = [];
    private hintImage: Phaser.GameObjects.Image;
    private errorImage: Phaser.GameObjects.Image;
    private resetButton!: Phaser.GameObjects.Image;
    private resetButtonText!: Phaser.GameObjects.Image;

    private waitingAction: ControlActionKey | null = null;
    private unsubscribeKeybinds?: () => void;

    private readonly offsetX = 8;
    private readonly offsetY = 10;
    private readonly rowGap = 16;
    private readonly rowStartY = 16;
    private readonly labelColor = '#4b3435';
    private readonly hintColor = '#6c5556';
    private readonly errorColor = '#9e3d3d';
    private readonly buttonWidth = 58;
    private readonly buttonHeight = 12;
    private readonly buttonBorder = 3;
    private readonly buttonTextColor = '#4b3435';
    private readonly pageWidth = 147;
    private readonly rightControlInset = 12;
    private readonly labelRightPadding = 2;

    private textureCounter = 0;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config?: SettingsControlsPanelConfig) {
        this.scene = scene;
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.font = new SettingsFont(scene);
        this.resolveLabel = config?.resolveLabel;
        this.onControlsChange = config?.onControlsChange;

        this.hintImage = this.scene.add.image(0, 0, this.font.createTextTexture('', this.hintColor)).setOrigin(0, 0);
        this.errorImage = this.scene.add.image(0, 0, this.font.createTextTexture('', this.errorColor)).setOrigin(0, 0);

        this.container.add([this.hintImage, this.errorImage]);

        this.createRows();
        this.createResetButton();
        this.refreshLabels();
        this.refreshBindingTexts();

        this.unsubscribeKeybinds = this.keybindManager.subscribe(() => {
            this.refreshBindingTexts();
            this.onControlsChange?.(this.keybindManager.getBindings());
        });
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
        if (!visible) {
            this.waitingAction = null;
            this.refreshHint();
        }
    }

    layout(rightPageLeftEdgeX: number, rightPageTopEdgeY: number, scale: number) {
        const startX = Math.floor(rightPageLeftEdgeX + this.offsetX * scale);
        const startY = Math.floor(rightPageTopEdgeY + this.offsetY * scale);
        const buttonLeftX = this.getButtonLeftX();

        this.container.setPosition(startX, startY);
        this.container.setScale(scale);

        this.hintImage.setPosition(0, 0);
        this.errorImage.setPosition(0, 8);

        let localY = this.rowStartY;
        for (const row of this.rows) {
            row.label.setPosition(0, localY - 1);
            row.valueButton.setPosition(buttonLeftX, localY - 2);
            row.valueText.setPosition(buttonLeftX + this.getButtonTextCenterX(), localY + 1);
            localY += this.rowGap;
        }

        this.resetButton.setPosition(buttonLeftX, localY + 2);
        this.resetButtonText.setPosition(buttonLeftX + this.getButtonTextCenterX(), localY + 5);
    }

    getContentHeight(): number {
        return this.rowStartY + this.rows.length * this.rowGap + 30;
    }

    refreshLabels() {
        const maxLabelWidth = this.getLabelMaxWidth();
        for (const row of this.rows) {
            const labelText = this.text(row.labelKey, row.fallbackLabel);
            row.label.setTexture(this.font.createTextTexture(this.clipLabel(labelText, maxLabelWidth), this.labelColor));
        }

        this.resetButtonText.setTexture(this.font.createTextTexture(this.text('settings.controls.resetAll', 'Reset All'), this.buttonTextColor));
        this.refreshHint();
        this.refreshBindingTexts();
    }

    destroy() {
        window.removeEventListener('keydown', this.handleCaptureKeyDown, { capture: true } as AddEventListenerOptions);
        this.unsubscribeKeybinds?.();
        this.unsubscribeKeybinds = undefined;
        this.container.destroy();
    }

    private createRows() {
        const maxLabelWidth = this.getLabelMaxWidth();
        for (const config of CONTROL_ROWS) {
            const clippedLabel = this.clipLabel(config.fallbackLabel, maxLabelWidth);
            const label = this.scene.add.image(0, 0, this.font.createTextTexture(clippedLabel, this.labelColor)).setOrigin(0, 0);
            const valueButton = this.scene.add.image(0, 0, this.createButtonTexture(this.buttonWidth, this.buttonHeight, false)).setOrigin(0, 0);
            const valueText = this.scene.add.image(0, 0, this.font.createTextTexture('---', this.buttonTextColor)).setOrigin(0.5, 0);

            valueButton.setInteractive({ useHandCursor: true });
            valueButton.on('pointerdown', () => this.beginCapture(config.action));

            this.container.add([label, valueButton, valueText]);
            this.rows.push({ ...config, label, valueButton, valueText });
        }
    }

    private createResetButton() {
        this.resetButton = this.scene.add.image(0, 0, this.createButtonTexture(this.buttonWidth, this.buttonHeight, true)).setOrigin(0, 0);
        this.resetButtonText = this.scene.add.image(0, 0, this.font.createTextTexture('Reset All', this.buttonTextColor)).setOrigin(0.5, 0);

        this.resetButton.setInteractive({ useHandCursor: true });
        this.resetButton.on('pointerdown', () => {
            this.keybindManager.resetAllToDefault();
            this.waitingAction = null;
            this.setError('');
            this.refreshHint();
        });

        this.container.add([this.resetButton, this.resetButtonText]);
    }

    private beginCapture(action: ControlActionKey) {
        this.waitingAction = action;
        this.setError('');
        this.refreshHint();

        window.removeEventListener('keydown', this.handleCaptureKeyDown, { capture: true } as AddEventListenerOptions);
        window.addEventListener('keydown', this.handleCaptureKeyDown, { capture: true });
    }

    private endCapture() {
        this.waitingAction = null;
        window.removeEventListener('keydown', this.handleCaptureKeyDown, { capture: true } as AddEventListenerOptions);
        this.refreshHint();
    }

    private refreshBindingTexts() {
        for (const row of this.rows) {
            const valueText = this.waitingAction === row.action
                ? this.text('settings.controls.listening', 'Press key...')
                : this.displayCode(this.keybindManager.getBinding(row.action));
            row.valueText.setTexture(this.font.createTextTexture(valueText, this.buttonTextColor));
        }
    }

    private refreshHint() {
        const hint = this.waitingAction
            ? this.text('settings.controls.captureHint', 'Press any key, Esc to cancel, Backspace to clear')
            : this.text('settings.controls.idleHint', 'Click a key slot to rebind');
        this.hintImage.setTexture(this.font.createTextTexture(hint, this.hintColor));
    }

    private setError(message: string) {
        this.errorImage.setTexture(this.font.createTextTexture(message, this.errorColor));
    }

    private displayCode(code: string | null): string {
        if (!code) {
            return this.text('settings.controls.unbound', 'Unbound');
        }
        return this.keybindManager.formatCode(code);
    }

    private text(key: string, fallback: string, params?: Record<string, string | number>) {
        return this.resolveLabel ? this.resolveLabel(key, fallback, params) : fallback;
    }

    private createButtonTexture(width: number, height: number, active: boolean): string {
        const key = active ? 'ui-tab-active' : 'ui-tab-inactive';
        const border = this.buttonBorder;
        const srcW = 41;
        const srcH = 12;
        const centerSrcW = srcW - border * 2;
        const centerSrcH = srcH - border * 2;
        const centerW = Math.max(1, width - border * 2);
        const centerH = Math.max(1, height - border * 2);

        const textureKey = `__settings_controls_button_${this.textureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        const srcTexture = this.scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;

        ctx.drawImage(srcImage, 0, 0, border, border, 0, 0, border, border);
        ctx.drawImage(srcImage, border, 0, centerSrcW, border, border, 0, centerW, border);
        ctx.drawImage(srcImage, srcW - border, 0, border, border, border + centerW, 0, border, border);

        ctx.drawImage(srcImage, 0, border, border, centerSrcH, 0, border, border, centerH);
        ctx.drawImage(srcImage, border, border, centerSrcW, centerSrcH, border, border, centerW, centerH);
        ctx.drawImage(srcImage, srcW - border, border, border, centerSrcH, border + centerW, border, border, centerH);

        ctx.drawImage(srcImage, 0, srcH - border, border, border, 0, border + centerH, border, border);
        ctx.drawImage(srcImage, border, srcH - border, centerSrcW, border, border, border + centerH, centerW, border);
        ctx.drawImage(srcImage, srcW - border, srcH - border, border, border, border + centerW, border + centerH, border, border);

        this.scene.textures.addCanvas(textureKey, canvas);
        return textureKey;
    }

    private getButtonTextCenterX() {
        return Math.floor(this.buttonWidth / 2);
    }

    private getButtonLeftX() {
        const controlRightX = this.pageWidth - this.offsetX - this.rightControlInset;
        return controlRightX - this.buttonWidth;
    }

    private getLabelMaxWidth() {
        return Math.max(0, this.getButtonLeftX() - this.labelRightPadding);
    }

    private clipLabel(text: string, maxWidth: number) {
        if (maxWidth <= 0) return '';
        if (this.font.measureBitmapTextWidth(text) <= maxWidth) return text;

        let clipped = text;
        while (clipped.length > 0 && this.font.measureBitmapTextWidth(clipped) > maxWidth) {
            clipped = clipped.slice(0, -1);
        }

        return clipped;
    }

    private handleCaptureKeyDown = (event: KeyboardEvent) => {
        if (!this.waitingAction) return;
        if (event.repeat) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.code === 'Escape') {
            this.endCapture();
            this.refreshBindingTexts();
            return;
        }

        const nextCode = event.code === 'Backspace' || event.code === 'Delete' ? null : event.code;
        const result = this.keybindManager.setBinding(this.waitingAction, nextCode);

        if (!result.ok) {
            const conflictLabel = this.text(
                `settings.controls.action.${result.conflictWith}`,
                result.conflictWith
            );
            this.setError(this.text('settings.controls.conflict', 'Already used by {action}', { action: conflictLabel }));
            this.refreshBindingTexts();
            return;
        }

        this.setError('');
        this.endCapture();
        this.refreshBindingTexts();
    };
}
