import Phaser from 'phaser';
import { LocaleInfo, LocaleManager } from '../../i18n/LocaleManager';
import { SettingsFont } from './SettingsFont';
import { BitmapFontRenderer } from '../BitmapFontRenderer';

type SettingsLanguagePanelConfig = {
    onLanguageSelect?: (locale: string) => void;
};

type LocaleRow = {
    code: string;
    button: Phaser.GameObjects.Image;
    textureKey: string;
    width: number;
};

export class SettingsLanguagePanel {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private font: SettingsFont;
    private bitmapFont: BitmapFontRenderer;
    private localeManager = LocaleManager.getInstance();
    private rows: LocaleRow[] = [];
    private onLanguageSelect?: (locale: string) => void;
    private debugMenuChangedHandler?: (_parent: unknown, value: boolean) => void;
    private textureCounter = 0;
    private lastLayout?: {
        rightPageLeftEdgeX: number;
        rightPageTopEdgeY: number;
        scale: number;
    };

    private readonly offsetX = 8;
    private readonly offsetY = 10;
    private readonly rowGap = 15;
    private readonly buttonHeight = 12;
    private readonly buttonMinWidth = 110;
    private readonly buttonBorder = 3;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config?: SettingsLanguagePanelConfig) {
        this.scene = scene;
        this.font = new SettingsFont(scene);
        this.bitmapFont = new BitmapFontRenderer(scene, 8);
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);
        this.onLanguageSelect = config?.onLanguageSelect;
        this.debugMenuChangedHandler = (_parent: unknown, _value: boolean) => this.rebuild();
        this.scene.registry.events.on('changedata-debugMenuActive', this.debugMenuChangedHandler);

        this.rebuild();
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    layout(rightPageLeftEdgeX: number, rightPageTopEdgeY: number, scale: number) {
        this.lastLayout = { rightPageLeftEdgeX, rightPageTopEdgeY, scale };
        const x = Math.floor(rightPageLeftEdgeX + this.offsetX * scale);
        const y = Math.floor(rightPageTopEdgeY + this.offsetY * scale);

        this.container.setPosition(x, y);
        this.container.setScale(scale);

        let localY = 0;

        this.rows.forEach((row) => {
            row.button.setPosition(0, localY);
            localY += this.rowGap;
        });
    }

    refresh() {
        this.rebuild();
    }

    getContentHeight(): number {
        return this.offsetY + this.rows.length * this.rowGap + 12;
    }

    destroy() {
        if (this.debugMenuChangedHandler) {
            this.scene.registry.events.off('changedata-debugMenuActive', this.debugMenuChangedHandler);
            this.debugMenuChangedHandler = undefined;
        }
        this.container.destroy();
    }

    private rebuild() {
        this.container.removeAll(true);
        this.rows = [];

        const locales = this.localeManager
            .getAvailableLocales()
            .filter((locale) => locale.code !== 'te_ST' || this.isDebugMenuActive());
        locales.forEach((locale) => this.createLocaleRow(locale));

        if (this.lastLayout) {
            this.layout(this.lastLayout.rightPageLeftEdgeX, this.lastLayout.rightPageTopEdgeY, this.lastLayout.scale);
        }
    }

    private createLocaleRow(locale: LocaleInfo) {
        const active = locale.code === this.localeManager.getCurrentLocale();
        const width = Math.max(this.buttonMinWidth, this.font.measureBitmapTextWidth(locale.displayName) + 14);
        const textureKey = this.createButtonTexture(locale.displayName, width, active);
        const button = this.scene.add.image(0, 0, textureKey).setOrigin(0, 0);
        button.setInteractive({ useHandCursor: true });
        button.on('pointerdown', () => this.onLanguageSelect?.(locale.code));
        this.container.add(button);

        this.rows.push({
            code: locale.code,
            button,
            textureKey,
            width
        });
    }

    private isDebugMenuActive(): boolean {
        return this.scene.registry.get('debugMenuActive') === true;
    }

    private createButtonTexture(label: string, width: number, active: boolean): string {
        const key = active ? 'ui-tab-active' : 'ui-tab-inactive';
        const border = this.buttonBorder;
        const srcW = 41;
        const srcH = 12;
        const centerSrcW = srcW - border * 2;
        const centerSrcH = srcH - border * 2;
        const centerW = Math.max(1, width - border * 2);
        const centerH = Math.max(1, this.buttonHeight - border * 2);

        const rtKey = `__settings_locale_${this.textureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = this.buttonHeight;
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

        const textColor = active ? '#a17f74' : '#4b3435';
        const textCanvas = this.renderTextCanvas(label, textColor);
        const textX = Math.max(8, width - 6 - textCanvas.width);
        const textY = Math.floor((this.buttonHeight - 8) / 2);
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
}
