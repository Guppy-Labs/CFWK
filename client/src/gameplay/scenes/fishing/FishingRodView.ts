import Phaser from 'phaser';
import { buildRodSideTexture } from '../../rendering/rodSideTexture';

export class FishingRodView {
    private rodSideTextureKey?: string;
    private rodSideWidth = 0;
    private rodSideHeight = 0;
    private rodSprite?: Phaser.GameObjects.Image;

    private readonly rodMarginX = 40;
    private readonly rodOffsetXRatio = 0.25;
    private readonly rodBottomOverlap = 18;
    private readonly rodTargetWidthRatio = 0.015;
    private readonly rodBreathCycleSeconds = 2.8;
    private readonly rodBreathRangePx = 16;

    private rodBaseX = 0;
    private rodBaseY = 0;
    private rodBaseScaleX = 1;
    private rodBaseScaleY = 1;
    constructor(private readonly scene: Phaser.Scene, private readonly rodItemId?: string) {}

    create() {
        if (!this.rodItemId) return;
        const rodImageKey = `item-${this.rodItemId}`;
        if (!this.scene.textures.exists(rodImageKey)) return;

        this.rodSideTextureKey = `__fishing_rod_side_${this.rodItemId}`;
        const rodSide = buildRodSideTexture(this.scene.textures, rodImageKey, this.rodSideTextureKey);
        if (!rodSide || !this.rodSideTextureKey || !this.scene.textures.exists(this.rodSideTextureKey)) return;
        this.rodSideWidth = rodSide.width;
        this.rodSideHeight = rodSide.height;

        this.rodSprite = this.scene.add.image(0, 0, this.rodSideTextureKey).setOrigin(1, 1);
        this.rodSprite.setDepth(5);
    }

    layout() {
        if (!this.rodSprite || !this.rodSideWidth || !this.rodSideHeight) return;

        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const targetWidth = width * this.rodTargetWidthRatio;
        const maxHeight = height * 0.9;

        let displayWidth = targetWidth;
        let displayHeight = (this.rodSideHeight / this.rodSideWidth) * displayWidth;
        if (displayHeight > maxHeight) {
            displayHeight = maxHeight;
            displayWidth = (this.rodSideWidth / this.rodSideHeight) * displayHeight;
        }

        const scaleX = displayWidth / this.rodSideWidth;
        const scaleY = displayHeight / this.rodSideHeight;
        this.rodBaseScaleX = scaleX;
        this.rodBaseScaleY = scaleY;
        this.rodSprite.setScale(scaleX, scaleY);
        this.rodBaseX = width * (1 - this.rodOffsetXRatio) - this.rodMarginX;
        this.rodBaseY = height + this.rodBottomOverlap;
        this.rodSprite.setPosition(this.rodBaseX, this.rodBaseY);
    }

    update(breathTime: number, throwPull: number) {
        if (!this.rodSprite) return;
        const bob = Math.sin(breathTime * (Math.PI * 2) / this.rodBreathCycleSeconds) * this.rodBreathRangePx;
        const pull = Phaser.Math.Clamp(throwPull, 0, 1);
        const pullRotation = Phaser.Math.Linear(0, 0.7, pull);
        const pullScaleX = 1 + pull * 0.22;
        const pullScaleY = 1 + pull * 0.48;
        const pullOffsetX = pull * 24;
        const pullOffsetY = pull * 16;
        this.rodSprite.setScale(this.rodBaseScaleX * pullScaleX, this.rodBaseScaleY * pullScaleY);
        this.rodSprite.setRotation(pullRotation);
        this.rodSprite.setPosition(this.rodBaseX + pullOffsetX, this.rodBaseY + bob + pullOffsetY);
    }

    getRodTipPosition() {
        if (this.rodSprite) {
            const tip = this.rodSprite.getTopRight();
            return new Phaser.Math.Vector2(tip.x, tip.y + 12);
        }
        return new Phaser.Math.Vector2(this.scene.scale.width * 0.7, this.scene.scale.height * 0.5);
    }

    getSprite() {
        return this.rodSprite;
    }

    destroy() {
        this.rodSprite?.destroy();
        this.rodSprite = undefined;
        if (this.rodSideTextureKey && this.scene.textures.exists(this.rodSideTextureKey)) {
            this.scene.textures.remove(this.rodSideTextureKey);
        }
        this.rodSideTextureKey = undefined;
    }
}
