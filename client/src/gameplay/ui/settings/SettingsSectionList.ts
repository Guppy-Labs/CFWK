import Phaser from 'phaser';
import { SettingsFont } from './SettingsFont';
import { BitmapFontRenderer } from '../BitmapFontRenderer';

export type SettingsSectionKey = 'Language' | 'Sounds' | 'Video' | 'Controls' | 'Online' | 'Accessibility' | 'Statistics';
export type SettingsActionKey = 'Invite to Server' | 'Report Bugs';

type SettingsButton = {
    label: string;
    container: Phaser.GameObjects.Container;
    image: Phaser.GameObjects.Image;
    textureKey: string;
    width: number;
    active: boolean;
    type: 'section' | 'action';
    key: SettingsSectionKey | SettingsActionKey;
};

type SettingsSectionListConfig = {
    resolveLabel?: (key: string, fallback: string) => string;
};

export class SettingsSectionList {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private font: SettingsFont;
    private sectionButtons: SettingsButton[] = [];
    private actionButtons: SettingsButton[] = [];
    private activeSection: SettingsSectionKey = 'Sounds';
    private onSectionChange?: (section: SettingsSectionKey) => void;
    private onAction?: (action: SettingsActionKey) => void;
    private headerImage?: Phaser.GameObjects.Image;
    private actionHeaderImage?: Phaser.GameObjects.Image;
    private resolveLabel?: (key: string, fallback: string) => string;
    private bitmapFont: BitmapFontRenderer;

    private readonly buttonHeight = 12;
    private readonly buttonBorder = 3;
    private readonly buttonPaddingLeft = 8;
    private readonly buttonPaddingRight = 6;
    private readonly buttonMinWidth = 78;
    private readonly buttonGap = 3;
    private readonly headerGap = 6;
    private readonly actionGap = 10;
    private readonly offsetX = 12;
    private readonly offsetY = 10;

    private textureCounter = 0;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config?: SettingsSectionListConfig) {
        this.scene = scene;
        this.font = new SettingsFont(scene);
        this.bitmapFont = new BitmapFontRenderer(scene, 8);
        this.resolveLabel = config?.resolveLabel;
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.createHeaders();
        this.createButtons();
        this.setActiveSection(this.activeSection, true);
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    setOnSectionChange(callback?: (section: SettingsSectionKey) => void) {
        this.onSectionChange = callback;
    }

    setOnAction(callback?: (action: SettingsActionKey) => void) {
        this.onAction = callback;
    }

    refreshLabels() {
        this.rebuildHeaders();
        this.sectionButtons.forEach((button) => this.refreshButton(button));
        this.actionButtons.forEach((button) => this.refreshButton(button));
    }

    setActiveSection(section: SettingsSectionKey, force = false, emit = true) {
        if (!force && this.activeSection === section) return;
        this.activeSection = section;
        this.sectionButtons.forEach((button) => {
            const isActive = button.key === section;
            if (button.active === isActive) return;
            button.active = isActive;
            this.updateButtonTexture(button);
        });
        if (emit) {
            this.onSectionChange?.(section);
        }
    }

    layout(leftPageLeftEdgeX: number, leftPageTopEdgeY: number, scale: number) {
        const startX = Math.floor(leftPageLeftEdgeX + this.offsetX * scale);
        let cursorY = Math.floor(leftPageTopEdgeY + this.offsetY * scale);

        if (this.headerImage) {
            this.headerImage.setScale(scale);
            this.headerImage.setPosition(startX, cursorY);
            cursorY += Math.round(this.getImageHeight(this.headerImage) * scale + this.headerGap * scale);
        }

        this.sectionButtons.forEach((button) => {
            button.container.setScale(scale);
            button.container.setPosition(startX, cursorY);
            cursorY += Math.round((this.buttonHeight + this.buttonGap) * scale);
        });

        cursorY += Math.round(this.actionGap * scale);

        if (this.actionHeaderImage) {
            this.actionHeaderImage.setScale(scale);
            this.actionHeaderImage.setPosition(startX, cursorY);
            cursorY += Math.round(this.getImageHeight(this.actionHeaderImage) * scale + this.headerGap * scale);
        }

        this.actionButtons.forEach((button) => {
            button.container.setScale(scale);
            button.container.setPosition(startX, cursorY);
            cursorY += Math.round((this.buttonHeight + this.buttonGap) * scale);
        });
    }

    private createHeaders() {
        const headerKey = this.font.createTextTexture(this.text('settings.header', 'Settings'), '#4b3435');
        this.headerImage = this.scene.add.image(0, 0, headerKey).setOrigin(0, 0);
        this.container.add(this.headerImage);

        const actionKey = this.font.createTextTexture(this.text('settings.actionsHeader', 'Actions'), '#4b3435');
        this.actionHeaderImage = this.scene.add.image(0, 0, actionKey).setOrigin(0, 0);
        this.container.add(this.actionHeaderImage);
    }

    private rebuildHeaders() {
        if (this.headerImage) {
            this.headerImage.setTexture(this.font.createTextTexture(this.text('settings.header', 'Settings'), '#4b3435'));
        }

        if (this.actionHeaderImage) {
            this.actionHeaderImage.setTexture(this.font.createTextTexture(this.text('settings.actionsHeader', 'Actions'), '#4b3435'));
        }
    }

    private createButtons() {
        const sections: SettingsSectionKey[] = ['Language', 'Sounds', 'Video', 'Controls', 'Online', 'Accessibility', 'Statistics'];
        const actions: SettingsActionKey[] = ['Invite to Server', 'Report Bugs'];

        sections.forEach((label) => {
            const button = this.buildButton(label, label === this.activeSection, 'section');
            this.sectionButtons.push(button);
        });

        actions.forEach((label) => {
            const button = this.buildButton(label, false, 'action');
            this.actionButtons.push(button);
        });
    }

    private buildButton(label: SettingsSectionKey | SettingsActionKey, active: boolean, type: 'section' | 'action'): SettingsButton {
        const displayLabel = this.getDisplayLabel(label, type);
        const textWidth = this.font.measureBitmapTextWidth(displayLabel);
        const width = Math.max(this.buttonMinWidth, textWidth + this.buttonPaddingLeft + this.buttonPaddingRight);

        const textureKey = this.createButtonTexture(displayLabel, active, width, this.buttonHeight, type);
        const image = this.scene.add.image(0, 0, textureKey).setOrigin(0, 0);
        const container = this.scene.add.container(0, 0, [image]);
        this.container.add(container);

        image.setInteractive({ useHandCursor: true });
        image.on('pointerdown', () => {
            if (type === 'section') {
                this.setActiveSection(label as SettingsSectionKey);
            } else {
                this.onAction?.(label as SettingsActionKey);
            }
        });

        return {
            label: displayLabel,
            container,
            image,
            textureKey,
            width,
            active,
            type,
            key: label
        };
    }

    private updateButtonTexture(button: SettingsButton) {
        button.label = this.getDisplayLabel(button.key, button.type);
        const textureKey = this.createButtonTexture(button.label, button.active, button.width, this.buttonHeight, button.type);
        button.textureKey = textureKey;
        button.image.setTexture(textureKey);
    }

    private refreshButton(button: SettingsButton) {
        button.label = this.getDisplayLabel(button.key, button.type);
        const textWidth = this.font.measureBitmapTextWidth(button.label);
        button.width = Math.max(this.buttonMinWidth, textWidth + this.buttonPaddingLeft + this.buttonPaddingRight);
        this.updateButtonTexture(button);
    }

    private getDisplayLabel(key: SettingsSectionKey | SettingsActionKey, type: 'section' | 'action'): string {
        if (type === 'section') {
            return this.text(`settings.section.${key}`, key);
        }

        return this.text(`settings.action.${key}`, key);
    }

    private text(key: string, fallback: string): string {
        return this.resolveLabel ? this.resolveLabel(key, fallback) : fallback;
    }

    private createButtonTexture(label: string, active: boolean, width: number, height: number, type: 'section' | 'action'): string {
        const key = type === 'action' ? 'ui-tab-active' : (active ? 'ui-tab-active' : 'ui-tab-inactive');
        const border = this.buttonBorder;
        const srcW = 41;
        const srcH = 12;
        const centerSrcW = srcW - border * 2;
        const centerSrcH = srcH - border * 2;
        const centerW = Math.max(1, width - border * 2);
        const centerH = Math.max(1, height - border * 2);

        const rtKey = `__settings_button_${this.textureCounter++}`;
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

        const textWidth = this.font.measureBitmapTextWidth(label);
        const textX = type === 'action'
            ? this.buttonPaddingLeft
            : Math.max(this.buttonPaddingLeft, width - this.buttonPaddingRight - textWidth);
        const textY = Math.floor((height - 8) / 2);
        const textColor = type === 'action' ? '#a17f74' : (active ? '#a17f74' : '#4b3435');
        const textCanvas = this.renderTextCanvas(label, textColor);
        ctx.drawImage(textCanvas, textX, textY);

        this.scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private renderTextCanvas(text: string, color: string) {
        const width = Math.max(1, this.font.measureBitmapTextWidth(text));
        const height = 8;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        this.bitmapFont.drawText(ctx, text, 0, 0, { charGap: 1 });

        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        return canvas;
    }

    private getImageHeight(image: Phaser.GameObjects.Image): number {
        const texture = this.scene.textures.get(image.texture.key);
        const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement | null;
        if (!source) return image.height || 0;
        return source.height || image.height || 0;
    }

}
