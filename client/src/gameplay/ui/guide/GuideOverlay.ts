import Phaser from 'phaser';

export type GuideOverlayState = {
    message: string;
    targetRect?: Phaser.Geom.Rectangle | null;
    secondaryVisibleRect?: Phaser.Geom.Rectangle | null;
    dimBackground?: boolean;
};

export class GuideOverlay {
    private readonly scene: Phaser.Scene;
    private readonly maskGraphics: Phaser.GameObjects.Graphics;
    private readonly pulse: Phaser.GameObjects.Rectangle;
    private readonly card: Phaser.GameObjects.Container;
    private readonly cardBg: Phaser.GameObjects.Rectangle;
    private readonly cardText: Phaser.GameObjects.Text;
    private pulseTween?: Phaser.Tweens.Tween;
    private visible = false;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.maskGraphics = scene.add.graphics();
        this.maskGraphics.setDepth(19800);
        this.maskGraphics.setAlpha(0);

        this.pulse = scene.add.rectangle(0, 0, 10, 10);
        this.pulse.setDepth(19810);
        this.pulse.setStrokeStyle(2, 0xffd57a, 1);
        this.pulse.setFillStyle(0x000000, 0);
        this.pulse.setAlpha(0);
        this.pulse.setVisible(false);

        this.cardBg = scene.add.rectangle(0, 0, 620, 92, 0x0a0a0a, 0.92);
        this.cardBg.setStrokeStyle(2, 0xf3d59a, 0.9);
        this.cardText = scene.add.text(0, 0, '', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '18px',
            color: '#f8f2e8',
            align: 'left',
            wordWrap: { width: 560, useAdvancedWrap: true }
        }).setOrigin(0.5, 0.5);

        this.card = scene.add.container(0, 0, [this.cardBg, this.cardText]);
        this.card.setDepth(19820);
        this.card.setAlpha(0);
        this.card.setVisible(false);
    }

    setState(state: GuideOverlayState | null) {
        if (!state) {
            this.hide();
            return;
        }

        this.cardText.setText(state.message);
        this.layoutCard();
        this.drawMask(state.targetRect ?? null, state.secondaryVisibleRect ?? null, state.dimBackground !== false);
        this.layoutPulse(state.targetRect ?? null);

        if (!this.visible) {
            this.visible = true;
            this.card.setVisible(true);
            this.scene.tweens.add({ targets: [this.maskGraphics, this.card], alpha: 1, duration: 250, ease: 'Sine.out' });
        }
    }

    hide() {
        if (!this.visible) return;
        this.visible = false;
        this.pulseTween?.stop();
        this.pulseTween = undefined;
        this.scene.tweens.add({
            targets: [this.maskGraphics, this.card, this.pulse],
            alpha: 0,
            duration: 250,
            ease: 'Sine.out',
            onComplete: () => {
                this.maskGraphics.clear();
                this.card.setVisible(false);
                this.pulse.setVisible(false);
            }
        });
    }

    resize() {
        if (!this.visible) return;
        this.layoutCard();
    }

    destroy() {
        this.pulseTween?.stop();
        this.maskGraphics.destroy();
        this.pulse.destroy();
        this.card.destroy();
    }

    private layoutCard() {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const mobileLike = width <= 900 || height <= 700;
        const shortSide = Math.min(width, height);
        const fontSize = mobileLike
            ? Phaser.Math.Clamp(Math.round(shortSide * 0.03), 12, 16)
            : Phaser.Math.Clamp(Math.round(shortSide * 0.024), 16, 18);
        const cardWidth = mobileLike
            ? Math.min(620, Math.max(300, width * 0.9))
            : Math.min(620, Math.max(420, width * 0.75));
        const wrapPadding = mobileLike ? 34 : 60;
        const wrapWidth = Math.max(220, cardWidth - wrapPadding);

        this.cardText.setFontSize(fontSize);
        this.cardText.setWordWrapWidth(wrapWidth, true);

        const textHeight = Math.ceil(this.cardText.getBounds().height);
        const verticalPadding = mobileLike ? 24 : 30;
        const cardHeight = Math.max(mobileLike ? 76 : 92, textHeight + verticalPadding);

        this.cardBg.setSize(cardWidth, cardHeight);

        const bottomOffset = mobileLike
            ? Math.max(86, Math.round(height * 0.15))
            : Math.max(120, Math.round(height * 0.18));
        this.card.setPosition(width / 2, height - bottomOffset);
    }

    private drawMask(primary: Phaser.Geom.Rectangle | null, secondary: Phaser.Geom.Rectangle | null, dimBackground: boolean) {
        this.maskGraphics.clear();
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;

        if (!dimBackground) {
            return;
        }

        const cutouts = [primary, secondary]
            .filter((rect): rect is Phaser.Geom.Rectangle => Boolean(rect))
            .map((rect) => this.clampRectToViewport(rect, width, height))
            .filter((rect): rect is Phaser.Geom.Rectangle => Boolean(rect));

        this.maskGraphics.fillStyle(0x000000, 0.7);

        if (cutouts.length === 0) {
            this.maskGraphics.fillRect(0, 0, width, height);
            return;
        }

        const yBreaks = new Set<number>([0, height]);
        for (const rect of cutouts) {
            yBreaks.add(rect.top);
            yBreaks.add(rect.bottom);
        }

        const sortedYBreaks = Array.from(yBreaks).sort((a, b) => a - b);
        for (let index = 0; index < sortedYBreaks.length - 1; index++) {
            const yStart = sortedYBreaks[index];
            const yEnd = sortedYBreaks[index + 1];
            const bandHeight = yEnd - yStart;
            if (bandHeight <= 0) continue;

            const activeIntervals = cutouts
                .filter((rect) => rect.top < yEnd && rect.bottom > yStart)
                .map((rect) => ({ x1: rect.left, x2: rect.right }))
                .sort((a, b) => a.x1 - b.x1);

            if (activeIntervals.length === 0) {
                this.maskGraphics.fillRect(0, yStart, width, bandHeight);
                continue;
            }

            let cursorX = 0;
            for (const interval of activeIntervals) {
                if (interval.x1 > cursorX) {
                    this.maskGraphics.fillRect(cursorX, yStart, interval.x1 - cursorX, bandHeight);
                }
                cursorX = Math.max(cursorX, interval.x2);
            }

            if (cursorX < width) {
                this.maskGraphics.fillRect(cursorX, yStart, width - cursorX, bandHeight);
            }
        }
    }

    private clampRectToViewport(rect: Phaser.Geom.Rectangle, width: number, height: number): Phaser.Geom.Rectangle | null {
        const x1 = Phaser.Math.Clamp(rect.left, 0, width);
        const y1 = Phaser.Math.Clamp(rect.top, 0, height);
        const x2 = Phaser.Math.Clamp(rect.right, 0, width);
        const y2 = Phaser.Math.Clamp(rect.bottom, 0, height);
        const clampedWidth = x2 - x1;
        const clampedHeight = y2 - y1;
        if (clampedWidth <= 1 || clampedHeight <= 1) return null;
        return new Phaser.Geom.Rectangle(x1, y1, clampedWidth, clampedHeight);
    }

    private layoutPulse(target: Phaser.Geom.Rectangle | null) {
        if (!target) {
            this.pulseTween?.stop();
            this.pulseTween = undefined;
            this.pulse.setVisible(false);
            return;
        }

        this.pulse.setVisible(true);
        this.pulse.setPosition(target.centerX, target.centerY);
        this.pulse.setSize(target.width + 12, target.height + 12);
        this.pulse.setScale(1);
        this.pulse.setAlpha(0.8);

        this.pulseTween?.stop();
        this.pulseTween = this.scene.tweens.add({
            targets: this.pulse,
            alpha: { from: 0.35, to: 0.9 },
            scaleX: { from: 0.98, to: 1.04 },
            scaleY: { from: 0.98, to: 1.04 },
            yoyo: true,
            repeat: -1,
            duration: 700,
            ease: 'Sine.inOut'
        });
    }
}
