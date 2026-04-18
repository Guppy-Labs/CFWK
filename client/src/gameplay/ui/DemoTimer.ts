import Phaser from 'phaser';

const TOP_BUTTON_SIZE = 16;
const TOP_BUTTON_MARGIN = 16;
const TOP_BUTTON_GAP = 14;
const BUTTON_SCALE = 3.2;
const TIMER_TOP_GAP = 6;
const TIMER_DEPTH = 10007;
const BAR_HEIGHT = 20;
const BAR_PADDING_X = 8;
const LABEL_TIMER_GAP = 8;
const NINE_SLICE_TEXTURE = 'ui-hud-stamina-bg';
const NINE_SLICE_BORDER_X = 4;
const NINE_SLICE_BORDER_Y = 2;

export class DemoTimer {
    private renderScene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private bg: Phaser.GameObjects.Image;
    private labelText: Phaser.GameObjects.Text;
    private timerText: Phaser.GameObjects.Text;
    private expiresAt: number;
    private timerEvent?: Phaser.Time.TimerEvent;
    private currentBgTextureKey?: string;
    private currentBgWidth = 0;
    private currentBgHeight = 0;
    private textureCounter = 0;

    constructor(scene: Phaser.Scene, durationMs: number, expiresAt?: number) {
        this.renderScene = this.resolveRenderScene(scene);
        this.expiresAt = Number.isFinite(expiresAt) ? Number(expiresAt) : (Date.now() + durationMs);

        const fontFamily = 'Minecraft, monospace';

        this.labelText = this.renderScene.add.text(0, 0, 'DEMO', {
            fontSize: '9px',
            fontFamily,
            color: '#d0d0d0',
            resolution: 2
        }).setOrigin(0, 0.5);

        this.timerText = this.renderScene.add.text(0, 0, '15:00', {
            fontSize: '9px',
            fontFamily,
            color: '#ff88be',
            resolution: 2
        }).setOrigin(1, 0.5);

        this.bg = this.renderScene.add.image(0, 0, NINE_SLICE_TEXTURE).setOrigin(0, 0);
        this.container = this.renderScene.add.container(0, 0, [this.bg, this.labelText, this.timerText]);
        this.container.setDepth(TIMER_DEPTH);
        this.container.setScrollFactor(0);

        this.updatePosition();
        this.tick();
        console.log('[DemoTimer] UI created', {
            durationMs,
            expiresAt: this.expiresAt,
            renderScene: this.renderScene.scene.key
        });

        this.timerEvent = this.renderScene.time.addEvent({
            delay: 1000,
            callback: () => this.tick(),
            loop: true
        });

        this.renderScene.events.on(Phaser.Scenes.Events.UPDATE, this.updatePosition, this);
        this.renderScene.scale.on('resize', this.updatePosition, this);
    }

    private updatePosition() {
        const camera = this.renderScene.cameras.main;
        const viewWidth = camera.width;
        const size = TOP_BUTTON_SIZE * BUTTON_SCALE;
        const halfSize = size / 2;
        const menuX = viewWidth - TOP_BUTTON_MARGIN - halfSize;
        const fullscreenX = menuX - size - TOP_BUTTON_GAP;

        const barLeft = fullscreenX - halfSize;
        const barRight = menuX + halfSize;
        const barWidth = Math.max(1, Math.round(barRight - barLeft));
        const defaultBarY = TOP_BUTTON_MARGIN + size + TIMER_TOP_GAP;
        const fishingStopRect = this.getFishingStopButtonRect();
        const fishingBarY = fishingStopRect
            ? Math.round(fishingStopRect.bottom + TIMER_TOP_GAP)
            : defaultBarY;
        const barY = Math.max(defaultBarY, fishingBarY);
        const barHeight = BAR_HEIGHT;
        this.updateBackgroundTexture(barWidth, barHeight);

        this.bg.setPosition(barLeft, barY);
        this.fitTextForBarWidth(barWidth);

        const midY = barY + barHeight / 2 - 1;
        this.labelText.setPosition(barLeft + BAR_PADDING_X, midY);
        this.timerText.setPosition(barRight - BAR_PADDING_X, midY);
    }

    private tick() {
        this.updatePosition();
        const remaining = Math.max(0, this.expiresAt - Date.now());
        const totalSec = Math.ceil(remaining / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        this.timerText.setText(
            `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
        );

        if (totalSec <= 60) {
            this.timerText.setColor('#ff4444');
        }
    }

    destroy() {
        this.renderScene.events.off(Phaser.Scenes.Events.UPDATE, this.updatePosition, this);
        this.renderScene.scale.off('resize', this.updatePosition, this);
        this.timerEvent?.destroy();
        this.removeBackgroundTexture();
        this.container.destroy();
    }

    private resolveRenderScene(scene: Phaser.Scene): Phaser.Scene {
        const uiScene = scene.scene.get('UIScene');
        if (uiScene && uiScene.sys.isActive()) {
            return uiScene;
        }
        console.warn('[DemoTimer] UIScene not active; rendering timer in host scene.');
        return scene;
    }

    private updateBackgroundTexture(width: number, height: number) {
        if (
            this.currentBgTextureKey
            && this.currentBgWidth === width
            && this.currentBgHeight === height
        ) {
            this.bg.setDisplaySize(width, height);
            this.bg.setAlpha(0.9);
            return;
        }

        if (!this.renderScene.textures.exists(NINE_SLICE_TEXTURE)) {
            return;
        }

        const textureKey = this.createNineSliceTexture(
            NINE_SLICE_TEXTURE,
            width,
            height,
            NINE_SLICE_BORDER_X,
            NINE_SLICE_BORDER_Y
        );
        this.bg.setTexture(textureKey);
        this.bg.setDisplaySize(width, height);
        this.bg.setAlpha(0.9);

        if (this.currentBgTextureKey && this.currentBgTextureKey !== textureKey && this.renderScene.textures.exists(this.currentBgTextureKey)) {
            this.renderScene.textures.remove(this.currentBgTextureKey);
        }
        this.currentBgTextureKey = textureKey;
        this.currentBgWidth = width;
        this.currentBgHeight = height;
    }

    private fitTextForBarWidth(barWidth: number) {
        const available = Math.max(1, barWidth - BAR_PADDING_X * 2 - LABEL_TIMER_GAP);
        let fontSize = 9;
        while (fontSize > 6) {
            this.labelText.setFontSize(fontSize);
            this.timerText.setFontSize(fontSize);
            const totalWidth = this.labelText.width + this.timerText.width;
            if (totalWidth <= available) {
                return;
            }
            fontSize -= 1;
        }
    }

    private createNineSliceTexture(
        key: string,
        width: number,
        height: number,
        borderX: number,
        borderY: number
    ): string {
        const srcTexture = this.renderScene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = srcImage.width;
        const srcH = srcImage.height;
        const centerSrcW = srcW - borderX * 2;
        const centerSrcH = srcH - borderY * 2;
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const rtKey = `__demo_timer_slice_${this.textureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(srcImage, 0, 0, borderX, borderY, 0, 0, borderX, borderY);
        ctx.drawImage(srcImage, borderX, 0, centerSrcW, borderY, borderX, 0, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, 0, borderX, borderY, borderX + centerW, 0, borderX, borderY);

        ctx.drawImage(srcImage, 0, borderY, borderX, centerSrcH, 0, borderY, borderX, centerH);
        ctx.drawImage(srcImage, borderX, borderY, centerSrcW, centerSrcH, borderX, borderY, centerW, centerH);
        ctx.drawImage(srcImage, srcW - borderX, borderY, borderX, centerSrcH, borderX + centerW, borderY, borderX, centerH);

        ctx.drawImage(srcImage, 0, srcH - borderY, borderX, borderY, 0, borderY + centerH, borderX, borderY);
        ctx.drawImage(srcImage, borderX, srcH - borderY, centerSrcW, borderY, borderX, borderY + centerH, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, srcH - borderY, borderX, borderY, borderX + centerW, borderY + centerH, borderX, borderY);

        this.renderScene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private removeBackgroundTexture() {
        if (!this.currentBgTextureKey) return;
        if (this.renderScene.textures.exists(this.currentBgTextureKey)) {
            this.renderScene.textures.remove(this.currentBgTextureKey);
        }
        this.currentBgTextureKey = undefined;
        this.currentBgWidth = 0;
        this.currentBgHeight = 0;
    }

    private getFishingStopButtonRect(): Phaser.Geom.Rectangle | null {
        if (!this.renderScene.scene.isActive('FishingScene')) return null;
        const fishingScene = this.renderScene.scene.get('FishingScene') as {
            getGuideStopButtonRect?: () => Phaser.Geom.Rectangle | null;
        } | null;
        return fishingScene?.getGuideStopButtonRect?.() ?? null;
    }
}
