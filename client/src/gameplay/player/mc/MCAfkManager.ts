import Phaser from 'phaser';
import type { PlayerShadow } from '../PlayerShadow';
import type { NetworkManager } from '../../network/NetworkManager';

type PlayerProvider = () => Phaser.Physics.Matter.Sprite | undefined;

type ShadowProvider = () => PlayerShadow | undefined;

type AfkConfig = {
    afkThreshold: number;
    afkKickThreshold: number;
    isPremium: boolean;
};

export class MCAfkManager {
    private lastActivityTime = 0;
    private isAfk = false;
    private afkAlpha = 1;
    private afkKicked = false;

    private afkKickThreshold: number;

    private afkOverlayContainer?: Phaser.GameObjects.Container;
    private afkOverlayBackdrop?: Phaser.GameObjects.Rectangle;
    private afkOverlayShadow?: Phaser.GameObjects.Image;
    private afkOverlayBg?: Phaser.GameObjects.Image;
    private afkOverlayIcon?: Phaser.GameObjects.Text;
    private afkOverlayTitle?: Phaser.GameObjects.Text;
    private afkOverlayInfo?: Phaser.GameObjects.Text;
    private afkOverlayCountdown?: Phaser.GameObjects.Text;
    private afkOverlayProgressBg?: Phaser.GameObjects.Rectangle;
    private afkOverlayProgressFill?: Phaser.GameObjects.Rectangle;
    private afkOverlayDivider?: Phaser.GameObjects.Rectangle;
    private afkOverlayNote?: Phaser.GameObjects.Text;
    private afkOverlayTextureKey?: string;
    private afkOverlayTextureCounter = 0;
    private afkOverlayAppearTween?: Phaser.Tweens.Tween;
    private afkOverlayPulseTween?: Phaser.Tweens.Tween;
    private afkOverlayPulseActive = false;

    private afkActivityHandler?: (parent: Phaser.Data.DataManager, value: number) => void;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly networkManager: NetworkManager,
        private readonly getPlayer: PlayerProvider,
        private readonly getShadow: ShadowProvider,
        private readonly config: AfkConfig
    ) {
        this.afkKickThreshold = config.isPremium ? 1200000 : config.afkKickThreshold;
        this.lastActivityTime = Date.now();
        const storedActivity = this.scene.registry.get('afkActivity');
        if (typeof storedActivity === 'number') {
            this.lastActivityTime = Math.max(this.lastActivityTime, storedActivity);
        }
        this.afkActivityHandler = (_parent: Phaser.Data.DataManager, value: number) => {
            if (typeof value !== 'number') return;
            this.registerAfkActivity(value);
        };
        this.scene.registry.events.on('changedata-afkActivity', this.afkActivityHandler);
    }

    registerAfkActivity(activityTime: number) {
        if (!Number.isFinite(activityTime)) return;
        this.lastActivityTime = Math.max(this.lastActivityTime, activityTime);
        if (this.isAfk) {
            this.exitAfkState();
        }
    }

    update(_delta: number) {
        const timeSinceActivity = Date.now() - this.lastActivityTime;

        if (!this.isAfk && timeSinceActivity > this.config.afkThreshold) {
            this.enterAfkState();
        }

        if (this.isAfk && !this.afkKicked && timeSinceActivity > this.afkKickThreshold) {
            this.handleAfkKick();
        }

        const player = this.getPlayer();
        if (this.isAfk && player) {
            const targetAlpha = 0.3;
            this.afkAlpha = Phaser.Math.Linear(this.afkAlpha, targetAlpha, 0.05);
            player.setAlpha(this.afkAlpha);
            this.getShadow()?.setAlpha(this.afkAlpha);

            const remainingMs = Math.max(0, this.afkKickThreshold - timeSinceActivity);
            this.showAfkOverlay(remainingMs);
        } else {
            this.hideAfkOverlay();
        }
    }

    isAfkGhosted(): boolean {
        return this.isAfk;
    }

    destroy() {
        if (this.afkActivityHandler) {
            this.scene.registry.events.off('changedata-afkActivity', this.afkActivityHandler);
        }
        this.afkOverlayAppearTween?.stop();
        this.afkOverlayPulseTween?.stop();
        this.afkOverlayBackdrop?.destroy();
        this.afkOverlayContainer?.destroy(true);
        if (this.afkOverlayTextureKey && this.scene.textures.exists(this.afkOverlayTextureKey)) {
            this.scene.textures.remove(this.afkOverlayTextureKey);
        }
    }

    private enterAfkState() {
        this.isAfk = true;
        this.networkManager.sendAfk(true);
    }

    private exitAfkState() {
        this.isAfk = false;
        this.afkAlpha = 1;
        this.getPlayer()?.setAlpha(1);
        this.getShadow()?.setAlpha(1);
        this.networkManager.sendAfk(false);
        this.hideAfkOverlay();
    }

    private handleAfkKick() {
        this.afkKicked = true;
    }

    private showAfkOverlay(remainingMs: number) {
        const uiScene = this.scene.scene.get('UIScene') as Phaser.Scene | undefined;
        if (!uiScene) return;

        const frameWidth = 360;
        const frameHeight = 200;
        const border = 4;
        const padding = 18;
        const progressBarWidth = frameWidth - padding * 2;
        const progressBarHeight = 6;

        if (!this.afkOverlayContainer) {
            const cam = uiScene.cameras.main;

            this.afkOverlayBackdrop = uiScene.add.rectangle(
                cam.centerX,
                cam.centerY,
                cam.width,
                cam.height,
                0x05070b,
                0.55
            ).setOrigin(0.5, 0.5);
            this.afkOverlayBackdrop.setScrollFactor(0);
            this.afkOverlayBackdrop.setDepth(9997);

            const textureKey = this.createNineSliceTexture(uiScene, 'ui-afk-frame', frameWidth, frameHeight, border, 3);
            this.afkOverlayTextureKey = textureKey;

            this.afkOverlayShadow = uiScene.add.image(0, 0, textureKey).setOrigin(0.5, 0.5);
            this.afkOverlayShadow.setTint(0x000000);
            this.afkOverlayShadow.setAlpha(0.55);
            this.afkOverlayShadow.setPosition(4, 6);

            this.afkOverlayBg = uiScene.add.image(0, 0, textureKey).setOrigin(0.5, 0.5);
            this.afkOverlayBg.setTint(0x5a3a24);

            this.afkOverlayIcon = uiScene.add.text(0, 0, '!', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '24px',
                color: '#ffd27a',
                stroke: '#3a1f0c',
                strokeThickness: 4
            }).setOrigin(0.5, 0.5);

            this.afkOverlayTitle = uiScene.add.text(0, 0, 'AFK WARNING', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '20px',
                color: '#ffd27a',
                stroke: '#3a1f0c',
                strokeThickness: 4
            }).setOrigin(0.5, 0.5);

            this.afkOverlayInfo = uiScene.add.text(0, 0, 'Move or press any key to stay in-game.', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '12px',
                color: '#f2e6cf',
                stroke: '#2a1a10',
                strokeThickness: 2,
                align: 'center'
            }).setOrigin(0.5, 0.5);

            this.afkOverlayProgressBg = uiScene.add.rectangle(
                0,
                0,
                progressBarWidth,
                progressBarHeight,
                0x1a110a,
                0.9
            ).setOrigin(0.5, 0.5);
            this.afkOverlayProgressBg.setStrokeStyle(1, 0x6b4a2a, 1);

            this.afkOverlayProgressFill = uiScene.add.rectangle(
                0,
                0,
                progressBarWidth - 2,
                progressBarHeight - 2,
                0xffb060,
                1
            ).setOrigin(0, 0.5);

            this.afkOverlayCountdown = uiScene.add.text(0, 0, 'Disconnect in 0:00', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '18px',
                color: '#ff8b8b',
                stroke: '#3a0e0e',
                strokeThickness: 4
            }).setOrigin(0.5, 0.5);

            this.afkOverlayDivider = uiScene.add.rectangle(
                0,
                0,
                frameWidth - padding * 2,
                1,
                0x6b4a2a,
                0.7
            ).setOrigin(0.5, 0.5);

            this.afkOverlayNote = uiScene.add.text(0, 0, 'Tip: Shark rank extends AFK time to 20 min.', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '11px',
                color: '#bfa98a',
                align: 'center'
            }).setOrigin(0.5, 0.5);

            this.afkOverlayContainer = uiScene.add.container(0, 0, [
                this.afkOverlayShadow,
                this.afkOverlayBg,
                this.afkOverlayIcon,
                this.afkOverlayTitle,
                this.afkOverlayInfo,
                this.afkOverlayProgressBg,
                this.afkOverlayProgressFill,
                this.afkOverlayCountdown,
                this.afkOverlayDivider,
                this.afkOverlayNote
            ]);
            this.afkOverlayContainer.setDepth(9998);
            this.afkOverlayContainer.setScrollFactor(0);

            this.afkOverlayContainer.setAlpha(0);
            this.afkOverlayContainer.setScale(0.9);
            this.afkOverlayBackdrop.setAlpha(0);
            this.afkOverlayAppearTween?.stop();
            this.afkOverlayAppearTween = uiScene.tweens.add({
                targets: [this.afkOverlayContainer],
                alpha: 1,
                scale: 1,
                duration: 220,
                ease: 'Back.easeOut'
            });
            uiScene.tweens.add({
                targets: [this.afkOverlayBackdrop],
                alpha: 0.55,
                duration: 220,
                ease: 'Sine.easeOut'
            });
        }

        const totalSeconds = Math.ceil(remainingMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        this.afkOverlayCountdown?.setText(`Disconnect in ${minutes}:${seconds.toString().padStart(2, '0')}`);

        const urgent = remainingMs <= 30000;
        if (this.afkOverlayCountdown) {
            this.afkOverlayCountdown.setColor(urgent ? '#ff6060' : '#ff9a8a');
        }
        if (urgent && !this.afkOverlayPulseActive && this.afkOverlayCountdown) {
            this.afkOverlayPulseActive = true;
            this.afkOverlayPulseTween?.stop();
            this.afkOverlayPulseTween = uiScene.tweens.add({
                targets: this.afkOverlayCountdown,
                scale: { from: 1, to: 1.08 },
                duration: 500,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        } else if (!urgent && this.afkOverlayPulseActive) {
            this.afkOverlayPulseActive = false;
            this.afkOverlayPulseTween?.stop();
            this.afkOverlayCountdown?.setScale(1);
        }

        if (
            this.afkOverlayContainer &&
            this.afkOverlayBg &&
            this.afkOverlayIcon &&
            this.afkOverlayTitle &&
            this.afkOverlayInfo &&
            this.afkOverlayCountdown &&
            this.afkOverlayNote &&
            this.afkOverlayProgressBg &&
            this.afkOverlayProgressFill &&
            this.afkOverlayDivider
        ) {
            const cam = uiScene.cameras.main;
            const centerX = cam.centerX;
            const centerY = cam.centerY - 20;
            this.afkOverlayContainer.setPosition(centerX, centerY);
            this.afkOverlayContainer.setVisible(true);

            if (this.afkOverlayBackdrop) {
                this.afkOverlayBackdrop.setPosition(cam.centerX, cam.centerY);
                this.afkOverlayBackdrop.setSize(cam.width, cam.height);
                this.afkOverlayBackdrop.setVisible(true);
            }

            const top = -frameHeight / 2 + padding;
            const titleY = top + 10;
            const titleWidth = this.afkOverlayTitle.width;
            this.afkOverlayTitle.setPosition(0, titleY);
            this.afkOverlayIcon.setPosition(-titleWidth / 2 - 16, titleY);

            this.afkOverlayInfo.setPosition(0, titleY + 26);

            const progressY = titleY + 52;
            this.afkOverlayProgressBg.setPosition(0, progressY);
            this.afkOverlayProgressFill.setPosition(-progressBarWidth / 2 + 1, progressY);

            const ratio = Phaser.Math.Clamp(remainingMs / this.afkKickThreshold, 0, 1);
            const fillWidth = Math.max(0, (progressBarWidth - 2) * ratio);
            this.afkOverlayProgressFill.width = fillWidth;
            this.afkOverlayProgressFill.setFillStyle(urgent ? 0xff5a4a : 0xffb060, 1);

            this.afkOverlayCountdown.setPosition(0, progressY + 24);

            const dividerY = -frameHeight / 2 + frameHeight - padding - 28;
            this.afkOverlayDivider.setPosition(0, dividerY);
            this.afkOverlayNote.setPosition(0, dividerY + 14);
        }
    }

    private hideAfkOverlay() {
        if (this.afkOverlayPulseActive) {
            this.afkOverlayPulseActive = false;
            this.afkOverlayPulseTween?.stop();
            this.afkOverlayCountdown?.setScale(1);
        }
        if (this.afkOverlayContainer) {
            this.afkOverlayContainer.setVisible(false);
        }
        if (this.afkOverlayBackdrop) {
            this.afkOverlayBackdrop.setVisible(false);
        }
    }

    private createNineSliceTexture(scene: Phaser.Scene, key: string, width: number, height: number, border: number, scale: number = 1) {
        const srcTexture = scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = Math.floor(srcImage.width * scale);
        const srcH = Math.floor(srcImage.height * scale);
        const scaledBorder = Math.floor(border * scale);
        const outBorder = scaledBorder;

        const centerSrcW = srcW - scaledBorder * 2;
        const centerSrcH = srcH - scaledBorder * 2;
        const centerW = Math.max(1, width - outBorder * 2);
        const centerH = Math.max(1, height - outBorder * 2);

        const rtKey = `__afk_nineslice_${this.afkOverlayTextureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = srcW;
        srcCanvas.height = srcH;
        const srcCtx = srcCanvas.getContext('2d')!;
        srcCtx.imageSmoothingEnabled = false;
        srcCtx.drawImage(srcImage, 0, 0, srcW, srcH);

        ctx.drawImage(srcCanvas, 0, 0, scaledBorder, scaledBorder, 0, 0, outBorder, outBorder);
        ctx.drawImage(srcCanvas, scaledBorder, 0, centerSrcW, scaledBorder, outBorder, 0, centerW, outBorder);
        ctx.drawImage(srcCanvas, srcW - scaledBorder, 0, scaledBorder, scaledBorder, outBorder + centerW, 0, outBorder, outBorder);

        ctx.drawImage(srcCanvas, 0, scaledBorder, scaledBorder, centerSrcH, 0, outBorder, outBorder, centerH);
        ctx.drawImage(srcCanvas, scaledBorder, scaledBorder, centerSrcW, centerSrcH, outBorder, outBorder, centerW, centerH);
        ctx.drawImage(srcCanvas, srcW - scaledBorder, scaledBorder, scaledBorder, centerSrcH, outBorder + centerW, outBorder, outBorder, centerH);

        ctx.drawImage(srcCanvas, 0, srcH - scaledBorder, scaledBorder, scaledBorder, 0, outBorder + centerH, outBorder, outBorder);
        ctx.drawImage(srcCanvas, scaledBorder, srcH - scaledBorder, centerSrcW, scaledBorder, outBorder, outBorder + centerH, centerW, outBorder);
        ctx.drawImage(srcCanvas, srcW - scaledBorder, srcH - scaledBorder, scaledBorder, scaledBorder, outBorder + centerW, outBorder + centerH, outBorder, outBorder);

        scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }
}
