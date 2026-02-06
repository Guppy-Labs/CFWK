import Phaser from 'phaser';

export class FishingScene extends Phaser.Scene {
    private stopButton?: Phaser.GameObjects.Container;
    private previewFrame?: Phaser.GameObjects.Image;
    private stopButtonBg?: Phaser.GameObjects.Image;
    private stopButtonLabel?: Phaser.GameObjects.Text;
    private buttonTextureKey?: string;
    private buttonTextureCounter = 0;
    private currentButtonWidth = 0;
    private currentButtonHeight = 0;
    private readonly frameMargin = 14;
    private readonly frameTopOffset = 70;
    private readonly buttonSpacing = 12;

    constructor() {
        super({ key: 'FishingScene' });
    }

    preload() {
        if (!this.textures.exists('ui-item-info-frame')) {
            this.load.image('ui-item-info-frame', '/ui/Frame07a.png');
        }
        if (!this.textures.exists('ui-group-button-selected')) {
            this.load.image('ui-group-button-selected', '/ui/Button08a.png');
        }
        if (!this.textures.exists('ui-group-button-unselected')) {
            this.load.image('ui-group-button-unselected', '/ui/Button08b.png');
        }
    }

    create() {
        this.cameras.main.setBackgroundColor('#000000');
        this.cameras.main.fadeIn(500, 0, 0, 0);

        const frameScale = 2;
        this.previewFrame = this.add.image(0, 0, 'ui-item-info-frame').setOrigin(1, 0);
        this.previewFrame.setScale(frameScale);

        this.stopButtonLabel = this.add.text(0, 0, 'Stop Fishing', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '12px',
            color: '#f2e9dd'
        }).setOrigin(0.5);

        this.stopButtonBg = this.add.image(0, 0, 'ui-group-button-selected').setOrigin(0.5);
        this.stopButton = this.add.container(0, 0, [this.stopButtonBg, this.stopButtonLabel]);

        this.stopButtonBg.setInteractive({ useHandCursor: true });
        this.stopButtonBg.on('pointerdown', () => this.stopFishing());

        this.layoutUI();

        this.scale.on('resize', this.onResize, this);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    }

    private onResize() {
        this.layoutUI();
    }

    private stopFishing() {
        const gameScene = this.scene.get('GameScene');
        gameScene?.events.emit('fishing:stop');
        this.scene.stop();
        this.scene.resume('GameScene');
    }

    private layoutUI() {
        if (!this.previewFrame || !this.stopButton || !this.stopButtonBg || !this.stopButtonLabel) return;

        const width = this.scale.width;
        const frameX = width - this.frameMargin;
        const frameY = this.frameTopOffset;
        this.previewFrame.setPosition(frameX, frameY);

        const targetButtonWidth = Math.round(this.previewFrame.displayWidth);
        const targetButtonHeight = Math.max(18, Math.ceil(this.stopButtonLabel.height + 10));
        this.updateButtonTexture(targetButtonWidth, targetButtonHeight);

        this.stopButtonBg.setDisplaySize(targetButtonWidth, targetButtonHeight);
        this.stopButtonLabel.setPosition(0, 0);

        const buttonX = frameX - this.previewFrame.displayWidth / 2;
        const buttonY = frameY + this.previewFrame.displayHeight + this.buttonSpacing + targetButtonHeight / 2;
        this.stopButton.setPosition(buttonX, buttonY);
    }

    private updateButtonTexture(width: number, height: number) {
        if (width === this.currentButtonWidth && height === this.currentButtonHeight && this.buttonTextureKey) {
            return;
        }
        this.currentButtonWidth = width;
        this.currentButtonHeight = height;

        const newKey = this.createNineSliceTexture('ui-group-button-selected', width, height, 6, 6);
        const oldKey = this.buttonTextureKey;
        this.buttonTextureKey = newKey;
        this.stopButtonBg?.setTexture(newKey);

        if (oldKey && oldKey !== newKey && this.textures.exists(oldKey)) {
            this.textures.remove(oldKey);
        }
    }

    private createNineSliceTexture(key: string, width: number, height: number, borderX: number, borderY: number) {
        const srcTexture = this.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = srcImage.width;
        const srcH = srcImage.height;

        const centerSrcW = srcW - borderX * 2;
        const centerSrcH = srcH - borderY * 2;
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const rtKey = `__fish_btn_${this.buttonTextureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        // Top row
        ctx.drawImage(srcImage, 0, 0, borderX, borderY, 0, 0, borderX, borderY);
        ctx.drawImage(srcImage, borderX, 0, centerSrcW, borderY, borderX, 0, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, 0, borderX, borderY, borderX + centerW, 0, borderX, borderY);

        // Middle row
        ctx.drawImage(srcImage, 0, borderY, borderX, centerSrcH, 0, borderY, borderX, centerH);
        ctx.drawImage(srcImage, borderX, borderY, centerSrcW, centerSrcH, borderX, borderY, centerW, centerH);
        ctx.drawImage(srcImage, srcW - borderX, borderY, borderX, centerSrcH, borderX + centerW, borderY, borderX, centerH);

        // Bottom row
        ctx.drawImage(srcImage, 0, srcH - borderY, borderX, borderY, 0, borderY + centerH, borderX, borderY);
        ctx.drawImage(srcImage, borderX, srcH - borderY, centerSrcW, borderY, borderX, borderY + centerH, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, srcH - borderY, borderX, borderY, borderX + centerW, borderY + centerH, borderX, borderY);

        this.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    shutdown() {
        this.scale.off('resize', this.onResize, this);
        this.stopButton?.destroy();
        this.previewFrame?.destroy();
        if (this.buttonTextureKey && this.textures.exists(this.buttonTextureKey)) {
            this.textures.remove(this.buttonTextureKey);
        }
    }
}
