import Phaser from 'phaser';

export type SettingsSliderConfig = {
    width: number;
    height: number;
    value: number;
    onChange?: (value: number) => void;
};

export class SettingsSlider {
    private static instanceCounter = 0;
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private track: Phaser.GameObjects.Image;
    private fill: Phaser.GameObjects.Image;
    private handle: Phaser.GameObjects.Image;
    private hitArea: Phaser.GameObjects.Rectangle;
    private dragging = false;
    private value = 0;
    private width: number;
    private height: number;
    private fillRenderHeight: number;
    private readonly fillInsetLeft = 3;
    private readonly fillInsetRight = 3;
    private fillRangeWidth: number;
    private fillTextureWidth: number;
    private fillTextureHeight: number;
    private trackTextureKey: string;
    private fillTextureKey: string;
    private readonly instanceId: number;
    private onChange?: (value: number) => void;
    private pointerMoveHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerUpHandler?: (pointer: Phaser.Input.Pointer) => void;
    private localPointer = new Phaser.Math.Vector2();

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config: SettingsSliderConfig) {
        this.scene = scene;
        this.width = config.width;
        this.height = config.height;
        this.fillRenderHeight = Math.max(4, this.height - 4);
        this.fillRangeWidth = Math.max(1, this.width - this.fillInsetLeft - this.fillInsetRight);
        this.value = Phaser.Math.Clamp(config.value, 0, 1);
        this.onChange = config.onChange;
        this.instanceId = SettingsSlider.instanceCounter++;

        this.trackTextureKey = this.createTrackTexture(this.width, this.height);
        this.fillTextureKey = this.createFillTexture(this.fillRangeWidth, this.fillRenderHeight);

        this.track = this.scene.add.image(0, 0, this.trackTextureKey).setOrigin(0, 0.5);
        this.fill = this.scene.add.image(0, 0, this.fillTextureKey).setOrigin(0, 0.5);
        this.fill.setPosition(this.fillInsetLeft, 0);
        this.handle = this.scene.add.image(0, 0, 'ui-slider-handle').setOrigin(0.5, 0.5);
        this.hitArea = this.scene.add.rectangle(0, 0, this.width, Math.max(this.height, 12), 0x000000, 0);
        this.hitArea.setOrigin(0, 0.5);

        const fillTexture = this.scene.textures.get(this.fillTextureKey);
        const fillImage = fillTexture.getSourceImage() as HTMLImageElement;
        this.fillTextureWidth = fillImage.width;
        this.fillTextureHeight = fillImage.height;

        this.container = this.scene.add.container(0, 0, [this.track, this.fill, this.handle, this.hitArea]);
        parent.add(this.container);

        this.hitArea.setInteractive({ useHandCursor: true });
        this.handle.setInteractive({ useHandCursor: true });

        this.hitArea.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            this.beginDrag(pointer);
        });
        this.handle.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            this.beginDrag(pointer);
        });

        this.pointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
            if (!this.dragging) return;
            this.updateValueFromPointer(pointer);
        };
        this.pointerUpHandler = () => {
            if (!this.dragging) return;
            this.dragging = false;
        };
        this.scene.input.on('pointermove', this.pointerMoveHandler);
        this.scene.input.on('pointerup', this.pointerUpHandler);

        this.updateVisuals();
    }

    setPosition(x: number, y: number) {
        this.container.setPosition(x, y);
    }

    setScale(scale: number) {
        this.container.setScale(scale);
    }

    setValue(value: number, emit = false) {
        this.value = Phaser.Math.Clamp(value, 0, 1);
        this.updateVisuals();
        if (emit) {
            this.onChange?.(this.value);
        }
    }

    getValue(): number {
        return this.value;
    }

    destroy() {
        if (this.pointerMoveHandler) {
            this.scene.input.off('pointermove', this.pointerMoveHandler);
        }
        if (this.pointerUpHandler) {
            this.scene.input.off('pointerup', this.pointerUpHandler);
        }
        this.container.destroy();
        if (this.scene.textures.exists(this.trackTextureKey)) {
            this.scene.textures.remove(this.trackTextureKey);
        }
        if (this.scene.textures.exists(this.fillTextureKey)) {
            this.scene.textures.remove(this.fillTextureKey);
        }
    }

    private beginDrag(pointer: Phaser.Input.Pointer) {
        this.dragging = true;
        this.updateValueFromPointer(pointer);
    }

    private updateValueFromPointer(pointer: Phaser.Input.Pointer) {
        const world = this.track.getWorldTransformMatrix();
        world.applyInverse(pointer.x, pointer.y, this.localPointer);

        const ratio = Phaser.Math.Clamp(
            (this.localPointer.x - this.fillInsetLeft) / Math.max(1, this.fillRangeWidth),
            0,
            1
        );
        if (ratio === this.value) return;
        this.value = ratio;
        this.updateVisuals();
        this.onChange?.(this.value);
    }

    private updateVisuals() {
        const handleX = this.fillInsetLeft + this.fillRangeWidth * this.value;
        this.handle.setPosition(handleX, 0);
        const cropWidth = Math.round(this.fillTextureWidth * this.value);
        if (cropWidth <= 0) {
            this.fill.setVisible(false);
            this.fill.setCrop(0, 0, 1, this.fillTextureHeight);
            return;
        }

        this.fill.setVisible(true);
        this.fill.setCrop(0, 0, cropWidth, this.fillTextureHeight);
    }

    private createTrackTexture(width: number, height: number): string {
        const srcTexture = this.scene.textures.get('ui-slider-track');
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const key = `__settings_slider_track_${this.instanceId}`;

        const borderX = 4;
        const borderY = 3;
        const srcCenterW = Math.max(1, srcImage.width - borderX * 2);
        const srcCenterH = Math.max(1, srcImage.height - borderY * 2);
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(srcImage, 0, 0, borderX, borderY, 0, 0, borderX, borderY);
        ctx.drawImage(srcImage, borderX, 0, srcCenterW, borderY, borderX, 0, centerW, borderY);
        ctx.drawImage(srcImage, srcImage.width - borderX, 0, borderX, borderY, borderX + centerW, 0, borderX, borderY);

        ctx.drawImage(srcImage, 0, borderY, borderX, srcCenterH, 0, borderY, borderX, centerH);
        ctx.drawImage(srcImage, borderX, borderY, srcCenterW, srcCenterH, borderX, borderY, centerW, centerH);
        ctx.drawImage(srcImage, srcImage.width - borderX, borderY, borderX, srcCenterH, borderX + centerW, borderY, borderX, centerH);

        ctx.drawImage(srcImage, 0, srcImage.height - borderY, borderX, borderY, 0, borderY + centerH, borderX, borderY);
        ctx.drawImage(srcImage, borderX, srcImage.height - borderY, srcCenterW, borderY, borderX, borderY + centerH, centerW, borderY);
        ctx.drawImage(srcImage, srcImage.width - borderX, srcImage.height - borderY, borderX, borderY, borderX + centerW, borderY + centerH, borderX, borderY);

        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    private createFillTexture(width: number, height: number): string {
        const srcTexture = this.scene.textures.get('ui-slider-fill');
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const key = `__settings_slider_fill_${this.instanceId}`;

        const borderSrcWidth = 1;
        const centerSrcWidth = Math.max(1, srcImage.width - borderSrcWidth * 2);
        const capSrcHeight = 2;
        const centerSrcHeight = srcImage.height;
        const centerDestWidth = Math.max(1, width - borderSrcWidth * 2);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        const capDestHeight = Math.max(1, Math.floor(height * 0.5));
        const capDestY = Math.floor((height - capDestHeight) / 2);

        ctx.drawImage(srcImage, 0, 1, borderSrcWidth, capSrcHeight, 0, capDestY, borderSrcWidth, capDestHeight);
        ctx.drawImage(srcImage, borderSrcWidth, 0, centerSrcWidth, centerSrcHeight, borderSrcWidth, 0, centerDestWidth, height);
        ctx.drawImage(srcImage, srcImage.width - borderSrcWidth, 1, borderSrcWidth, capSrcHeight, borderSrcWidth + centerDestWidth, capDestY, borderSrcWidth, capDestHeight);

        this.scene.textures.addCanvas(key, canvas);
        return key;
    }
}
