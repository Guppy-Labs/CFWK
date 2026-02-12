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
    private afkOverlayShadow?: Phaser.GameObjects.Image;
    private afkOverlayBg?: Phaser.GameObjects.Image;
    private afkOverlayTitle?: Phaser.GameObjects.Text;
    private afkOverlayInfo?: Phaser.GameObjects.Text;
    private afkOverlayCountdown?: Phaser.GameObjects.Text;
    private afkOverlayNote?: Phaser.GameObjects.Text;
    private afkOverlayTextureKey?: string;
    private afkOverlayTextureCounter = 0;

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

    destroy() {
        if (this.afkActivityHandler) {
            this.scene.registry.events.off('changedata-afkActivity', this.afkActivityHandler);
        }
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

        const frameWidth = 320;
        const frameHeight = 170;
        const border = 4;
        const padding = 14;

        if (!this.afkOverlayContainer) {
            const textureKey = this.createNineSliceTexture(uiScene, 'ui-afk-frame', frameWidth, frameHeight, border, 3);
            this.afkOverlayTextureKey = textureKey;

            this.afkOverlayShadow = uiScene.add.image(0, 0, textureKey).setOrigin(0.5, 0.5);
            this.afkOverlayShadow.setTint(0x000000);
            this.afkOverlayShadow.setAlpha(0.5);
            this.afkOverlayShadow.setPosition(3, 4);

            this.afkOverlayBg = uiScene.add.image(0, 0, textureKey).setOrigin(0.5, 0.5);
            this.afkOverlayTitle = uiScene.add.text(0, 0, 'AFK WARNING', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '18px',
                color: '#f2f2f2'
            }).setOrigin(0, 0);

            this.afkOverlayInfo = uiScene.add.text(0, 0, 'Move or press any key to stay in-game.', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '12px',
                color: '#d8d8d8'
            }).setOrigin(0, 0);

            this.afkOverlayCountdown = uiScene.add.text(0, 0, 'Disconnect in 0:00', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '16px',
                color: '#ff8b8b'
            }).setOrigin(0, 0);

            this.afkOverlayNote = uiScene.add.text(0, 0, 'Tip: Shark rank extends AFK time to 20 min.', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '11px',
                color: '#b9b9b9'
            }).setOrigin(0, 0);

            this.afkOverlayContainer = uiScene.add.container(0, 0, [
                this.afkOverlayShadow,
                this.afkOverlayBg,
                this.afkOverlayTitle,
                this.afkOverlayInfo,
                this.afkOverlayCountdown,
                this.afkOverlayNote
            ]);
            this.afkOverlayContainer.setDepth(9998);
            this.afkOverlayContainer.setScrollFactor(0);
        }

        const totalSeconds = Math.ceil(remainingMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        this.afkOverlayCountdown?.setText(`Disconnect in ${minutes}:${seconds.toString().padStart(2, '0')}`);

        if (this.afkOverlayContainer && this.afkOverlayBg && this.afkOverlayTitle && this.afkOverlayInfo && this.afkOverlayCountdown && this.afkOverlayNote) {
            const centerX = uiScene.cameras.main.centerX;
            const centerY = uiScene.cameras.main.centerY - 40;
            this.afkOverlayContainer.setPosition(centerX, centerY);
            this.afkOverlayContainer.setVisible(true);

            const left = -frameWidth / 2 + padding;
            const top = -frameHeight / 2 + padding;
            this.afkOverlayTitle.setPosition(left, top);
            this.afkOverlayInfo.setPosition(left, top + 28);
            this.afkOverlayCountdown.setPosition(left, top + 62);
            this.afkOverlayNote.setPosition(left, top + frameHeight - padding - 26);
        }
    }

    private hideAfkOverlay() {
        if (this.afkOverlayContainer) {
            this.afkOverlayContainer.setVisible(false);
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
