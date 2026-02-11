import Phaser from 'phaser';

type BarVisual = {
    bg: Phaser.GameObjects.Image;
    fill: Phaser.GameObjects.TileSprite;
    maskGraphics: Phaser.GameObjects.Graphics;
    mask: Phaser.Display.Masks.GeometryMask;
    textureKey?: string;
    width: number;
    height: number;
    innerW: number;
    innerH: number;
    x: number;
    y: number;
    value: number;
};

export type FishingUiCallbacks = {
    onStop: () => void;
    onCastPress: () => void;
    onCastRelease: () => void;
};

export class FishingUi {
    private stopButton?: Phaser.GameObjects.Container;
    private stopButtonBg?: Phaser.GameObjects.Image;
    private stopButtonLabel?: Phaser.GameObjects.Text;
    private buttonTextureKey?: string;
    private buttonTextureCounter = 0;
    private currentButtonWidth = 0;
    private currentButtonHeight = 0;
    private castButton?: Phaser.GameObjects.Container;
    private castButtonBg?: Phaser.GameObjects.Image;
    private castButtonLabel?: Phaser.GameObjects.Text;
    private castButtonTextureKey?: string;
    private castButtonTextureCounter = 0;
    private castButtonWidth = 0;
    private castButtonHeight = 0;
    private castBar?: BarVisual;
    private biteTimeBar?: BarVisual;
    private biteClickBar?: BarVisual;
    private biteText?: Phaser.GameObjects.Text;
    private biteHint?: Phaser.GameObjects.Text;
    private castButtonFadeTween?: Phaser.Tweens.Tween;

    private readonly frameMargin = 14;
    private readonly frameTopOffset = 70;
    private readonly castButtonBottomMargin = 20;
    private readonly castBarSpacing = 10;
    private readonly biteTextTopRatio = 0.25;
    private readonly biteBarSpacing = 8;
    private readonly biteTextSize = 36;
    private readonly biteHintSize = 18;
    private readonly biteTextPadding = 24;

    constructor(private readonly scene: Phaser.Scene, private readonly callbacks: FishingUiCallbacks) {}

    static preload(scene: Phaser.Scene) {
        if (!scene.textures.exists('ui-group-button-selected')) {
            scene.load.image('ui-group-button-selected', '/ui/Button08a.png');
        }
        if (!scene.textures.exists('ui-hud-stamina-bg')) {
            scene.load.image('ui-hud-stamina-bg', '/ui/Bar04a.png');
        }
        if (!scene.textures.exists('ui-hud-stamina-fill')) {
            scene.load.image('ui-hud-stamina-fill', '/ui/Fill02a.png');
        }
    }

    create() {
        this.stopButtonLabel = this.scene.add.text(0, 0, 'Stop Fishing', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '12px',
            color: '#f2e9dd'
        }).setOrigin(0.5);

        this.stopButtonBg = this.scene.add.image(0, 0, 'ui-group-button-selected').setOrigin(0.5);
        this.stopButton = this.scene.add.container(0, 0, [this.stopButtonBg, this.stopButtonLabel]);
        this.stopButton.setDepth(10);

        this.stopButtonBg.setInteractive({ useHandCursor: false });
        this.stopButtonBg.on('pointerdown', () => this.callbacks.onStop());

        this.castButtonLabel = this.scene.add.text(0, 0, 'Cast', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '18px',
            color: '#f2e9dd'
        }).setOrigin(0.5);
        this.castButtonBg = this.scene.add.image(0, 0, 'ui-group-button-selected').setOrigin(0.5);
        this.castButton = this.scene.add.container(0, 0, [this.castButtonBg, this.castButtonLabel]);
        this.castButton.setDepth(10);

        this.castButtonBg.setInteractive({ useHandCursor: false });
        this.castButtonBg.on('pointerdown', () => this.callbacks.onCastPress());
        this.castButtonBg.on('pointerup', () => this.callbacks.onCastRelease());
        this.castButtonBg.on('pointerout', () => this.callbacks.onCastRelease());
        this.castButtonBg.on('pointerupoutside', () => this.callbacks.onCastRelease());

        this.castBar = this.createBar(10);
        this.castBar.bg.setVisible(false);
        this.castBar.fill.setVisible(false);
        this.castBar.maskGraphics.setVisible(false);

        this.biteText = this.scene.add.text(0, 0, '', {
            fontFamily: 'Minecraft, monospace',
            fontSize: `${this.biteTextSize}px`,
            color: '#f2e9dd'
        }).setOrigin(0.5, 0);
        this.biteText.setDepth(12);
        this.biteText.setVisible(false);

        this.biteHint = this.scene.add.text(0, 0, '', {
            fontFamily: 'Minecraft, monospace',
            fontSize: `${this.biteHintSize}px`,
            color: '#f2e9dd'
        }).setOrigin(0.5, 0);
        this.biteHint.setDepth(12);
        this.biteHint.setVisible(false);

        this.biteTimeBar = this.createBar(11);
        this.biteClickBar = this.createBar(11);
        this.setBarVisible(this.biteTimeBar, false);
        this.setBarVisible(this.biteClickBar, false);
    }

    layout() {
        if (!this.stopButton || !this.stopButtonBg || !this.stopButtonLabel) return;

        const width = this.scene.scale.width;
        const frameX = width - this.frameMargin;
        const frameY = this.frameTopOffset;
        const targetButtonWidth = Math.round(Math.max(140, this.stopButtonLabel.width + 30));
        const targetButtonHeight = Math.max(18, Math.ceil(this.stopButtonLabel.height + 10));
        this.updateButtonTexture(targetButtonWidth, targetButtonHeight);

        this.stopButtonBg.setDisplaySize(targetButtonWidth, targetButtonHeight);
        this.stopButtonLabel.setPosition(0, 0);

        const buttonX = frameX - targetButtonWidth / 2;
        const buttonY = frameY + targetButtonHeight / 2;
        this.stopButton.setPosition(buttonX, buttonY);

        if (!this.castButton || !this.castButtonBg || !this.castButtonLabel) return;

        const castButtonTargetWidth = Math.round(Math.min(320, Math.max(200, width * 0.35)));
        const castButtonTargetHeight = Math.max(26, Math.ceil(this.castButtonLabel.height + 16));
        this.updateCastButtonTexture(castButtonTargetWidth, castButtonTargetHeight);

        this.castButtonBg.setDisplaySize(castButtonTargetWidth, castButtonTargetHeight);
        this.castButtonLabel.setPosition(0, 0);

        const castButtonX = width / 2;
        const castButtonY = this.scene.scale.height - this.castButtonBottomMargin - castButtonTargetHeight / 2;
        this.castButton.setPosition(castButtonX, castButtonY);

        if (this.castBar) {
            const castBarWidth = Math.round(castButtonTargetWidth * 0.9);
            const castBarHeight = Math.max(10, Math.round(castButtonTargetHeight * 0.35));
            const castBarY = castButtonY - castButtonTargetHeight / 2 - this.castBarSpacing - castBarHeight / 2;
            this.layoutBar(this.castBar, castButtonX, castBarY, castBarWidth, castBarHeight);
        }

        const biteTextX = width / 2;
        const biteTextY = Math.round(this.scene.scale.height * this.biteTextTopRatio);
        this.biteText?.setPosition(biteTextX, biteTextY);

        if (this.biteTimeBar && this.biteClickBar) {
            const biteBarWidth = Math.round(Math.min(320, Math.max(220, width * 0.32)));
            const biteBarHeight = 10;
            const biteTimeY = biteTextY + this.biteTextSize + this.biteTextPadding;
            const biteClickY = biteTimeY + biteBarHeight + this.biteBarSpacing;
            const biteHintY = biteClickY + biteBarHeight + this.biteBarSpacing;
            this.layoutBar(this.biteTimeBar, biteTextX, biteTimeY, biteBarWidth, biteBarHeight);
            this.layoutBar(this.biteClickBar, biteTextX, biteClickY, biteBarWidth, biteBarHeight);
            this.biteHint?.setPosition(biteTextX, biteHintY);
        }
    }

    setCastButtonLabel(text: string) {
        this.castButtonLabel?.setText(text);
    }

    setCastBarVisible(visible: boolean) {
        if (this.castBar) {
            this.setBarVisible(this.castBar, visible);
        }
    }

    setCastBarValue(value: number) {
        if (this.castBar) {
            this.setBarValue(this.castBar, value);
        }
    }

    setBiteBarsVisible(visible: boolean) {
        if (this.biteTimeBar) {
            this.setBarVisible(this.biteTimeBar, visible);
        }
        if (this.biteClickBar) {
            this.setBarVisible(this.biteClickBar, visible);
        }
    }

    setBiteTimeRatio(value: number) {
        if (this.biteTimeBar) {
            this.setBarValue(this.biteTimeBar, value);
        }
    }

    setBiteClickRatio(value: number) {
        if (this.biteClickBar) {
            this.setBarValue(this.biteClickBar, value);
        }
    }

    setBiteText(text: string, visible: boolean) {
        if (!this.biteText) return;
        this.biteText.setText(text);
        this.biteText.setVisible(visible);
    }

    setBiteHint(text: string, visible: boolean) {
        if (!this.biteHint) return;
        this.biteHint.setText(text);
        this.biteHint.setVisible(visible);
    }

    setBiteTextColor(color: string) {
        this.biteText?.setColor(color);
        this.biteHint?.setColor(color);
    }

    setFishingUiVisible(visible: boolean, isHoldingCast: boolean) {
        this.stopButton?.setVisible(visible);
        this.castButton?.setVisible(visible);
        if (this.castBar) {
            this.setBarVisible(this.castBar, visible && isHoldingCast);
        }
    }

    fadeCastButtonToIdle() {
        if (!this.castButton) return;
        this.castButtonFadeTween?.stop();
        this.castButton.setAlpha(1);
        this.castButtonFadeTween = this.scene.tweens.add({
            targets: this.castButton,
            alpha: 0,
            duration: 500,
            ease: 'Sine.out',
            onComplete: () => {
                this.setCastButtonLabel('Cast');
                this.castButtonFadeTween = this.scene.tweens.add({
                    targets: this.castButton,
                    alpha: 1,
                    duration: 500,
                    ease: 'Sine.out'
                });
            }
        });
    }

    destroy() {
        this.stopButton?.destroy();
        this.castButton?.destroy();
        this.castBar?.bg.destroy();
        this.castBar?.fill.destroy();
        this.castBar?.maskGraphics.destroy();
        this.biteTimeBar?.bg.destroy();
        this.biteTimeBar?.fill.destroy();
        this.biteTimeBar?.maskGraphics.destroy();
        this.biteClickBar?.bg.destroy();
        this.biteClickBar?.fill.destroy();
        this.biteClickBar?.maskGraphics.destroy();
        this.biteText?.destroy();
        this.biteHint?.destroy();
        if (this.buttonTextureKey && this.scene.textures.exists(this.buttonTextureKey)) {
            this.scene.textures.remove(this.buttonTextureKey);
        }
        if (this.castButtonTextureKey && this.scene.textures.exists(this.castButtonTextureKey)) {
            this.scene.textures.remove(this.castButtonTextureKey);
        }
        this.buttonTextureKey = undefined;
        this.castButtonTextureKey = undefined;
        this.currentButtonWidth = 0;
        this.currentButtonHeight = 0;
        this.castButtonWidth = 0;
        this.castButtonHeight = 0;
        [this.castBar, this.biteTimeBar, this.biteClickBar].forEach((bar) => {
            if (bar?.textureKey && this.scene.textures.exists(bar.textureKey)) {
                this.scene.textures.remove(bar.textureKey);
            }
        });
    }

    private updateButtonTexture(width: number, height: number) {
        if (
            width === this.currentButtonWidth
            && height === this.currentButtonHeight
            && this.buttonTextureKey
            && this.scene.textures.exists(this.buttonTextureKey)
        ) {
            return;
        }
        this.currentButtonWidth = width;
        this.currentButtonHeight = height;

        const newKey = this.createNineSliceTexture('ui-group-button-selected', width, height, 6, 6);
        const oldKey = this.buttonTextureKey;
        this.buttonTextureKey = newKey;
        this.stopButtonBg?.setTexture(newKey);

        if (oldKey && oldKey !== newKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private updateCastButtonTexture(width: number, height: number) {
        if (
            width === this.castButtonWidth
            && height === this.castButtonHeight
            && this.castButtonTextureKey
            && this.scene.textures.exists(this.castButtonTextureKey)
        ) {
            return;
        }
        this.castButtonWidth = width;
        this.castButtonHeight = height;

        const newKey = this.createNineSliceTexture('ui-group-button-selected', width, height, 6, 6, `__fish_cast_btn_${this.castButtonTextureCounter++}`);
        const oldKey = this.castButtonTextureKey;
        this.castButtonTextureKey = newKey;
        this.castButtonBg?.setTexture(newKey);

        if (oldKey && oldKey !== newKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private createNineSliceTexture(key: string, width: number, height: number, borderX: number, borderY: number, overrideKey?: string) {
        const srcTexture = this.scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = srcImage.width;
        const srcH = srcImage.height;

        const centerSrcW = srcW - borderX * 2;
        const centerSrcH = srcH - borderY * 2;
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const rtKey = overrideKey ?? `__fish_btn_${this.buttonTextureCounter++}`;
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

    private createBar(depth: number): BarVisual {
        const textureKey = this.createNineSliceTexture('ui-hud-stamina-bg', 100, 10, 4, 2, `__fish_bar_${this.buttonTextureCounter++}`);
        const bg = this.scene.add.image(0, 0, textureKey).setOrigin(0.5, 0.5);
        const fill = this.scene.add.tileSprite(0, 0, 1, 1, 'ui-hud-stamina-fill').setOrigin(0, 0.5);
        const maskGraphics = this.scene.add.graphics();
        maskGraphics.setVisible(false);
        const mask = maskGraphics.createGeometryMask();
        fill.setMask(mask);
        bg.setDepth(depth);
        fill.setDepth(depth);
        maskGraphics.setDepth(depth);
        return {
            bg,
            fill,
            maskGraphics,
            mask,
            textureKey,
            width: 100,
            height: 10,
            innerW: 1,
            innerH: 1,
            x: 0,
            y: 0,
            value: 0
        };
    }

    private layoutBar(bar: BarVisual, x: number, y: number, width: number, height: number) {
        if (bar.width !== width || bar.height !== height) {
            const newKey = this.createNineSliceTexture('ui-hud-stamina-bg', width, height, 4, 2, `__fish_bar_${this.buttonTextureCounter++}`);
            const oldKey = bar.textureKey;
            bar.textureKey = newKey;
            bar.bg.setTexture(newKey);
            if (oldKey && oldKey !== newKey && this.scene.textures.exists(oldKey)) {
                this.scene.textures.remove(oldKey);
            }
            bar.width = width;
            bar.height = height;
        }

        bar.x = x;
        bar.y = y;
        bar.bg.setPosition(x, y);

        bar.innerW = Math.max(1, width - 8);
        bar.innerH = Math.max(1, height - 4);
        const fillX = x - width / 2 + 4 - 1;
        bar.fill.setPosition(fillX, y);

        const fillTexture = this.scene.textures.get('ui-hud-stamina-fill');
        const source = fillTexture.getSourceImage() as HTMLImageElement | undefined;
        if (source && source.height > 0) {
            const scaleY = bar.innerH / source.height;
            bar.fill.setTileScale(1, scaleY);
        }

        this.setBarValue(bar, bar.value);
    }

    private setBarValue(bar: BarVisual, value: number) {
        bar.value = Phaser.Math.Clamp(value, 0, 1);
        const fillWidth = Math.max(1, Math.round(bar.innerW * bar.value));
        const fillX = bar.x - bar.width / 2 + 4 - 1;
        if (bar.value <= 0) {
            bar.fill.setVisible(false);
            bar.maskGraphics.clear();
            return;
        }

        bar.fill.setVisible(true);
        bar.fill.setSize(bar.innerW, bar.innerH);
        bar.fill.setDisplaySize(bar.innerW, bar.innerH);
        bar.maskGraphics.clear();
        bar.maskGraphics.fillStyle(0xffffff, 1);
        bar.maskGraphics.fillRect(fillX, bar.y - bar.innerH / 2, fillWidth, bar.innerH);
    }

    private setBarVisible(bar: BarVisual, visible: boolean) {
        bar.bg.setVisible(visible);
        bar.fill.setVisible(visible);
        bar.maskGraphics.setVisible(false);
    }
}
