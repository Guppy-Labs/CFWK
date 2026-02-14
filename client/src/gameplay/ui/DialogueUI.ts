import Phaser from 'phaser';
import { MobileControls } from './MobileControls';
import type { DialogueRenderLine } from '../dialogue/DialogueTypes';
import { LocaleManager } from '../i18n/LocaleManager';
import { BitmapFontRenderer } from './BitmapFontRenderer';
import { KeybindManager } from '../input/KeybindManager';

export class DialogueUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private hitArea: Phaser.GameObjects.Rectangle;
    private contentImage: Phaser.GameObjects.Image;
    private nameImage: Phaser.GameObjects.Image;
    private nameTextImage: Phaser.GameObjects.Image;
    private textImage: Phaser.GameObjects.Image;
    private indicatorImage: Phaser.GameObjects.Image;
    private portraitImage: Phaser.GameObjects.Image;

    private currentLine?: DialogueRenderLine;
    private onAdvance?: () => void;
    private typeTimer?: Phaser.Time.TimerEvent;
    private isTyping = false;
    private fullText = '';
    private visibleText = '';
    private textMaxWidth = 0;
    private textPosX = 0;
    private textPosY = 0;
    private indicatorTextureKey?: string;
    private advanceKeyDownHandler?: (event: KeyboardEvent) => void;
    private typedLetterCount = 0;
    private localeManager = LocaleManager.getInstance();
    private keybindManager = KeybindManager.getInstance();

    private contentTextureKey?: string;
    private nameTextureKey?: string;
    private nameTextTextureKey?: string;
    private textTextureKey?: string;
    private textureCounter = 0;

    private readonly fontRenderer: BitmapFontRenderer;

    private readonly fontCharSize = 8;
    private readonly fontCharGap = 1;
    private readonly lineGap = 2;

    private readonly depth = 15000;
    private readonly uiScale = 4;
    private readonly textScale = 2;
    private readonly marginX = 22;
    private readonly marginBottom = 18;
    private readonly textPaddingX = 14;
    private readonly textPaddingY = 10;
    private readonly contentBorder = 6;
    private readonly nameBorder = 2;
    private readonly namePeek = 8;
    private readonly namePaddingX = 6;
    private readonly nameInset = 8;
    private readonly nameTextOffsetY = 3;
    private readonly portraitBottomInset = 6;
    private readonly portraitSideInset = 42;
    private readonly minContentHeight = 30;
    private readonly typeIntervalMs = 28;
    private readonly indicatorPadding = 7;
    private readonly indicatorNudge = 1;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.fontRenderer = new BitmapFontRenderer(scene, this.fontCharSize);
        this.container = this.scene.add.container(0, 0);
        this.container.setDepth(this.depth);
        this.container.setScrollFactor(0);

        this.hitArea = this.scene.add.rectangle(0, 0, 1, 1, 0x000000, 0);
        this.hitArea.setOrigin(0, 0);
        this.hitArea.setScrollFactor(0);
        this.hitArea.setDepth(this.depth - 1);
        this.hitArea.setInteractive({ useHandCursor: true });
        this.hitArea.on('pointerdown', () => this.handleAdvanceClick());

        this.contentImage = this.scene.add.image(0, 0, 'ui-dialogue-content');
        this.contentImage.setOrigin(0, 0);
        this.contentImage.setScrollFactor(0);

        this.nameImage = this.scene.add.image(0, 0, 'ui-dialogue-name');
        this.nameImage.setOrigin(0, 0);
        this.nameImage.setScrollFactor(0);

        this.nameTextImage = this.scene.add.image(0, 0, 'ui-dialogue-name');
        this.nameTextImage.setOrigin(0, 0);
        this.nameTextImage.setScrollFactor(0);

        this.textImage = this.scene.add.image(0, 0, 'ui-dialogue-content');
        this.textImage.setOrigin(0, 0);
        this.textImage.setScrollFactor(0);

        this.indicatorImage = this.scene.add.image(0, 0, 'ui-dialogue-content');
        this.indicatorImage.setOrigin(1, 1);
        this.indicatorImage.setScrollFactor(0);

        this.portraitImage = this.scene.add.image(0, 0, 'ui-dialogue-content');
        this.portraitImage.setOrigin(0.5, 1);
        this.portraitImage.setScrollFactor(0);

        this.container.add([
            this.portraitImage,
            this.nameImage,
            this.contentImage,
            this.textImage,
            this.indicatorImage,
            this.nameTextImage
        ]);

        this.advanceKeyDownHandler = (event: KeyboardEvent) => {
            if (!this.container.visible) return;
            if (!this.keybindManager.matchesActionEvent('dialogueAdvance', event)) return;
            event.preventDefault();
            event.stopPropagation();
            this.handleAdvanceClick();
        };
        window.addEventListener('keydown', this.advanceKeyDownHandler, { capture: true });

        this.setVisible(false);
    }

    setOnAdvance(handler?: () => void) {
        this.onAdvance = handler;
    }

    showLine(line: DialogueRenderLine) {
        this.currentLine = line;
        this.setVisible(true);
        this.startTyping(line.text);
        this.layout();
        this.updateIndicatorText();
    }

    hide() {
        this.stopTyping();
        this.setVisible(false);
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
        this.hitArea.setVisible(visible);
        this.indicatorImage.setVisible(visible);
        if (visible) {
            this.hitArea.setInteractive({ useHandCursor: true });
        } else {
            this.hitArea.disableInteractive();
        }
    }

    layout() {
        if (!this.currentLine) return;

        const viewWidth = this.scene.scale.width;
        const viewHeight = this.scene.scale.height;
        const contentWidth = Math.max(1, viewWidth - this.marginX * 2);
        const scaledPaddingX = this.textPaddingX * this.uiScale;
        const scaledPaddingY = this.textPaddingY * this.uiScale;
        const scaledMinContentHeight = this.minContentHeight * this.uiScale;

        const textMaxWidth = Math.max(1, contentWidth - scaledPaddingX * 2);
        this.textMaxWidth = textMaxWidth;
        const fullLines = this.wrapText(this.fullText || this.currentLine.text, textMaxWidth);
        const textHeight = this.getScaledLineHeight(fullLines.length);
        const contentHeight = Math.max(scaledMinContentHeight, textHeight + scaledPaddingY * 2);

        const contentX = Math.round(this.marginX);
        const contentY = Math.round(viewHeight - this.marginBottom - contentHeight);

        this.setContentTexture(contentWidth, contentHeight);
        this.contentImage.setPosition(contentX, contentY);

        this.textPosX = contentX + scaledPaddingX;
        this.textPosY = contentY + scaledPaddingY;
        this.setVisibleText(this.visibleText);

        const nameText = this.currentLine.name;
        const scaledNamePaddingX = this.namePaddingX * this.uiScale;
        const nameWidth = Math.max(29 * this.uiScale, this.measureBitmapTextWidth(nameText) + scaledNamePaddingX * 2);
        const nameHeight = 12 * this.uiScale;
        this.setNameTexture(nameWidth, nameHeight);

        const nameInset = this.nameInset * this.uiScale;
        const rawNameX = this.currentLine.speaker === 'player'
            ? contentX + nameInset
            : contentX + contentWidth - nameWidth - nameInset;
        const nameX = Phaser.Math.Clamp(rawNameX, contentX + nameInset, contentX + contentWidth - nameWidth - nameInset);
        const nameY = contentY - this.namePeek * this.uiScale;
        this.nameImage.setPosition(nameX, nameY);

        const nameTextKey = this.createTextTexture([nameText], nameWidth - scaledNamePaddingX * 2, '#000000');
        this.setNameTextTexture(nameTextKey);
        this.nameTextImage.setPosition(nameX + scaledNamePaddingX, nameY + this.nameTextOffsetY * this.uiScale);

        const portraitKey = this.getPortraitTextureKey(this.currentLine);
        this.portraitImage.setVisible(Boolean(portraitKey && this.scene.textures.exists(portraitKey)));
        if (portraitKey && this.scene.textures.exists(portraitKey)) {
            this.portraitImage.setTexture(portraitKey);
            const source = this.scene.textures.get(portraitKey).getSourceImage() as HTMLImageElement;
            const targetHeight = Math.min(220, viewHeight * 0.45);
            const scale = targetHeight / Math.max(1, source.height);
            this.portraitImage.setScale(scale);
            const portraitInset = this.portraitSideInset * this.uiScale;
            const portraitX = this.currentLine.speaker === 'player'
                ? contentX + contentWidth - portraitInset
                : contentX + portraitInset;
            const portraitY = contentY + this.portraitBottomInset * this.uiScale;
            this.portraitImage.setPosition(portraitX, portraitY);
        }

        this.updateIndicator(contentX, contentY, contentWidth, contentHeight);

        this.hitArea.setSize(viewWidth, viewHeight);
    }

    destroy() {
        this.stopTyping();
        this.clearGeneratedTextures();
        if (this.advanceKeyDownHandler) {
            window.removeEventListener('keydown', this.advanceKeyDownHandler, { capture: true } as AddEventListenerOptions);
            this.advanceKeyDownHandler = undefined;
        }
        this.container.destroy();
        this.hitArea.destroy();
    }

    private handleAdvanceClick() {
        if (!this.container.visible || !this.currentLine) return;
        if (this.isTyping) {
            this.finishTyping();
            return;
        }
        this.onAdvance?.();
    }

    private startTyping(text: string) {
        this.stopTyping();
        this.fullText = text;
        this.visibleText = '';
        this.isTyping = true;
        this.typedLetterCount = 0;
        this.updateIndicatorText();

        this.typeTimer = this.scene.time.addEvent({
            delay: this.typeIntervalMs,
            loop: true,
            callback: () => {
                if (!this.isTyping) return;
                const nextLength = Math.min(this.fullText.length, this.visibleText.length + 1);
                this.visibleText = this.fullText.slice(0, nextLength);
                this.setVisibleText(this.visibleText);
                const nextChar = this.fullText.charAt(Math.max(0, nextLength - 1));
                if (nextChar === ' ') {
                    this.typedLetterCount = 0;
                } else {
                    this.typedLetterCount += 1;
                    if (this.typedLetterCount % 2 === 0) {
                        this.playDialogueClick();
                    }
                }
                if (nextLength >= this.fullText.length) {
                    this.isTyping = false;
                    this.typeTimer?.remove(false);
                    this.typeTimer = undefined;
                    this.updateIndicatorText();
                }
            }
        });
    }

    private stopTyping() {
        this.isTyping = false;
        this.typeTimer?.remove(false);
        this.typeTimer = undefined;
    }

    private finishTyping() {
        if (!this.isTyping) return;
        this.isTyping = false;
        this.visibleText = this.fullText;
        this.typeTimer?.remove(false);
        this.typeTimer = undefined;
        this.setVisibleText(this.visibleText);
        this.updateIndicatorText();
    }

    private setVisibleText(text: string) {
        const lines = this.wrapText(text, this.textMaxWidth);
        const textKey = this.createTextTexture(lines, this.textMaxWidth, '#000000');
        this.setTextTexture(textKey);
        this.textImage.setPosition(this.textPosX, this.textPosY);
    }

    private updateIndicatorText() {
        if (!this.currentLine) return;
        const actionText = this.isTyping
            ? this.localeManager.t('dialogue.action.skip', undefined, 'skip')
            : this.localeManager.t('dialogue.action.continue', undefined, 'continue');
        const isMobile = MobileControls.isMobileDevice();
        if (isMobile) {
            const text = this.localeManager.t('dialogue.prompt.tapToAction', { action: actionText }, `Tap to ${actionText}`);
            const key = this.createIndicatorTexture(text);
            this.setIndicatorTexture(key);
        } else {
            const trailingText = this.localeManager.t('dialogue.prompt.keyToAction', { action: actionText }, ` to ${actionText}`);
            const keyLabel = this.keybindManager.getDisplayLabel('dialogueAdvance');
            const text = `${keyLabel}${trailingText}`;
            const key = this.createIndicatorTexture(text);
            this.setIndicatorTexture(key);
        }
    }

    private updateIndicator(contentX: number, contentY: number, contentWidth: number, contentHeight: number) {
        const padding = this.indicatorPadding * this.uiScale;
        const nudge = this.indicatorNudge * this.uiScale;
        const x = contentX + contentWidth - padding - nudge;
        const y = contentY + contentHeight - padding - nudge;
        this.indicatorImage.setPosition(x, y);
    }

    private playDialogueClick() {
        const audioManager = this.getAudioManager();
        audioManager?.playDialogueClick?.();
    }

    private getAudioManager() {
        const gameScene = this.scene.scene.get('GameScene') as { getAudioManager?: () => unknown };
        return gameScene?.getAudioManager?.() as { playDialogueClick?: () => void } | undefined;
    }

    private setIndicatorTexture(key: string) {
        if (this.indicatorTextureKey) {
            this.scene.textures.remove(this.indicatorTextureKey);
        }
        this.indicatorTextureKey = key;
        this.indicatorImage.setTexture(key);
    }

    private createIndicatorTexture(text: string) {
        const textColor = '#000000';
        const textCanvas = this.renderTextCanvas(text, textColor);
        const segments: Array<{ type: 'text'; width: number; height: number; canvas: HTMLCanvasElement }> = [
            { type: 'text', width: textCanvas.width, height: textCanvas.height, canvas: textCanvas }
        ];

        const totalWidth = segments.reduce((sum, seg) => sum + seg.width, 0);
        const totalHeight = Math.max(...segments.map((seg) => seg.height));

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, totalWidth);
        canvas.height = Math.max(1, totalHeight);
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        let cursorX = 0;
        segments.forEach((seg) => {
            const y = Math.round((totalHeight - seg.height) / 2);
            ctx.drawImage(seg.canvas, cursorX, y);
            cursorX += seg.width;
        });

        const key = `__dialogue_indicator_${this.textureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    private renderTextCanvas(text: string, color: string) {
        const scaledCharSize = this.fontCharSize * this.textScale;
        const width = Math.max(1, this.measureBitmapTextWidth(text));
        const height = scaledCharSize;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        this.fontRenderer.drawText(ctx, text, 0, 0, {
            scale: this.textScale,
            charGap: this.fontCharGap * this.textScale
        });

        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        return canvas;
    }

    private setContentTexture(width: number, height: number) {
        const scaledBorder = this.contentBorder * this.uiScale;
        const key = this.createNineSliceTexture('ui-dialogue-content', width, height, scaledBorder, scaledBorder);
        if (this.contentTextureKey) {
            this.scene.textures.remove(this.contentTextureKey);
        }
        this.contentTextureKey = key;
        this.contentImage.setTexture(key);
    }

    private setNameTexture(width: number, height: number) {
        const scaledBorder = this.nameBorder * this.uiScale;
        const key = this.createNineSliceTexture('ui-dialogue-name', width, height, scaledBorder, scaledBorder);
        if (this.nameTextureKey) {
            this.scene.textures.remove(this.nameTextureKey);
        }
        this.nameTextureKey = key;
        this.nameImage.setTexture(key);
    }

    private setNameTextTexture(key: string) {
        if (this.nameTextTextureKey) {
            this.scene.textures.remove(this.nameTextTextureKey);
        }
        this.nameTextTextureKey = key;
        this.nameTextImage.setTexture(key);
    }

    private setTextTexture(key: string) {
        if (this.textTextureKey) {
            this.scene.textures.remove(this.textTextureKey);
        }
        this.textTextureKey = key;
        this.textImage.setTexture(key);
    }

    private createNineSliceTexture(key: string, width: number, height: number, borderX: number, borderY: number) {
        const scaledKey = this.getScaledSourceKey(key, this.uiScale);
        const srcTexture = this.scene.textures.get(scaledKey);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = srcImage.width;
        const srcH = srcImage.height;
        const centerSrcW = srcW - borderX * 2;
        const centerSrcH = srcH - borderY * 2;

        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const rtKey = `__dialogue_slice_${this.textureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        ctx.drawImage(srcImage, 0, 0, borderX, borderY, 0, 0, borderX, borderY);
        ctx.drawImage(srcImage, borderX, 0, centerSrcW, borderY, borderX, 0, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, 0, borderX, borderY, borderX + centerW, 0, borderX, borderY);

        ctx.drawImage(srcImage, 0, borderY, borderX, centerSrcH, 0, borderY, borderX, centerH);
        ctx.drawImage(srcImage, borderX, borderY, centerSrcW, centerSrcH, borderX, borderY, centerW, centerH);
        ctx.drawImage(srcImage, srcW - borderX, borderY, borderX, centerSrcH, borderX + centerW, borderY, borderX, centerH);

        ctx.drawImage(srcImage, 0, srcH - borderY, borderX, borderY, 0, borderY + centerH, borderX, borderY);
        ctx.drawImage(srcImage, borderX, srcH - borderY, centerSrcW, borderY, borderX, borderY + centerH, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, srcH - borderY, borderX, borderY, borderX + centerW, borderY + centerH, borderX, borderY);

        this.scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private createTextTexture(lines: string[], maxWidth: number, color: string) {
        const height = this.getScaledLineHeight(lines.length);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, maxWidth);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        const scaledCharSize = this.fontCharSize * this.textScale;
        const scaledLineGap = this.lineGap * this.textScale;

        let y = 0;
        lines.forEach((line) => {
            this.fontRenderer.drawText(ctx, line, 0, y, {
                scale: this.textScale,
                charGap: this.fontCharGap * this.textScale
            });
            y += scaledCharSize + scaledLineGap;
        });

        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__dialogue_text_${this.textureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    private wrapText(text: string, maxWidth: number) {
        if (!text) return [''];
        const words = text.split(' ');
        const lines: string[] = [];
        let current = '';

        words.forEach((word) => {
            const test = current ? `${current} ${word}` : word;
            if (this.measureBitmapTextWidth(test) <= maxWidth) {
                current = test;
            } else {
                if (current) lines.push(current);
                current = word;
            }
        });

        if (current) lines.push(current);
        return lines;
    }

    private measureBitmapTextWidth(text: string): number {
        return this.fontRenderer.measureTextWidth(text, {
            scale: this.textScale,
            charGap: this.fontCharGap * this.textScale
        });
    }

    private getScaledLineHeight(lineCount: number) {
        const scaledCharSize = this.fontCharSize * this.textScale;
        const scaledLineGap = this.lineGap * this.textScale;
        return lineCount * scaledCharSize + Math.max(0, lineCount - 1) * scaledLineGap;
    }

    private getScaledSourceKey(key: string, scale: number) {
        const scaledKey = `__dialogue_src_${key}_${scale}`;
        if (this.scene.textures.exists(scaledKey)) {
            return scaledKey;
        }

        const srcTexture = this.scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const canvas = document.createElement('canvas');
        canvas.width = srcImage.width * scale;
        canvas.height = srcImage.height * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(srcImage, 0, 0, canvas.width, canvas.height);

        this.scene.textures.addCanvas(scaledKey, canvas);
        return scaledKey;
    }

    private getPortraitTextureKey(line: DialogueRenderLine): string | null {
        if (line.speaker === 'player') {
            return `dialogue-char-mc-${line.emotion}`;
        }

        if (!line.npcId) return null;
        return `dialogue-char-${line.npcId}-${line.emotion}`;
    }

    private clearGeneratedTextures() {
        const keys = [
            this.contentTextureKey,
            this.nameTextureKey,
            this.nameTextTextureKey,
            this.textTextureKey,
            this.indicatorTextureKey
        ];
        keys.forEach((key) => {
            if (key && this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        });
        this.contentTextureKey = undefined;
        this.nameTextureKey = undefined;
        this.nameTextTextureKey = undefined;
        this.textTextureKey = undefined;
    }
}
