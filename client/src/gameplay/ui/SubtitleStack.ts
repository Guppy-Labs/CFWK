import Phaser from 'phaser';

type SubtitleEntry = {
    soundKey: string;
    label: string;
    container: Phaser.GameObjects.Container;
    background: Phaser.GameObjects.Graphics;
    text: Phaser.GameObjects.Text;
    fadeDelayTimer?: Phaser.Time.TimerEvent;
    fadeTween?: Phaser.Tweens.Tween;
};

export class SubtitleStack {
    private scene: Phaser.Scene;
    private root: Phaser.GameObjects.Container;
    private entries: SubtitleEntry[] = [];
    private lastPostedAtBySound = new Map<string, number>();
    private subtitlesEnabled = false;

    private readonly depth = 20000;
    private readonly leftMargin = 0;
    private readonly bottomMargin = 0;
    private readonly cardHeight = 20;
    private readonly gap = 0;
    private readonly paddingX = 10;
    private readonly maxVisible = 6;
    private readonly minWidth = 130;
    private readonly postThrottleMs = 1000;
    private readonly fadeStartDelayMs = 750;
    private readonly fadeDurationMs = 750;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.root = this.scene.add.container(0, 0);
        this.root.setDepth(this.depth);
        this.root.setScrollFactor(0);
        this.layout(false);
    }

    setEnabled(enabled: boolean) {
        this.subtitlesEnabled = enabled;
        if (!enabled) {
            this.clearEntries();
            this.root.setVisible(false);
            return;
        }
        this.root.setVisible(true);
    }

    setVisible(visible: boolean) {
        this.root.setVisible(visible);
    }

    post(soundKey: string, label: string) {
        if (!this.subtitlesEnabled) return;

        const now = Date.now();
        const previousPostTime = this.lastPostedAtBySound.get(soundKey) ?? 0;
        if (now - previousPostTime < this.postThrottleMs) {
            return;
        }
        this.lastPostedAtBySound.set(soundKey, now);

        const existing = this.entries.find((entry) => entry.soundKey === soundKey);
        if (existing) {
            existing.label = label;
            this.updateEntryVisual(existing);
            existing.container.setAlpha(1);
            this.scheduleEntryFade(existing);
            return;
        }

        const entry = this.createEntry(soundKey, label);
        this.entries.push(entry);
        this.scheduleEntryFade(entry);

        while (this.entries.length > this.maxVisible) {
            const removed = this.entries.shift();
            this.destroyEntry(removed);
        }

        this.layout(true);
    }

    layout(animate = false) {
        const x = this.getBaseX();
        const baseY = this.getBaseY();

        this.entries.forEach((entry, index) => {
            const y = baseY - (this.entries.length - 1 - index) * (this.cardHeight + this.gap);
            if (!animate) {
                entry.container.setPosition(x, y);
                return;
            }

            this.scene.tweens.add({
                targets: entry.container,
                x,
                y,
                duration: 140,
                ease: 'Sine.out'
            });
        });
    }

    update() {
    }

    destroy() {
        this.entries.forEach((entry) => this.destroyEntry(entry));
        this.entries = [];
        this.lastPostedAtBySound.clear();
        this.root.destroy();
    }

    private createEntry(soundKey: string, label: string): SubtitleEntry {
        const background = this.scene.add.graphics();
        const text = this.scene.add.text(0, 0, label, {
            fontFamily: 'Minecraft, monospace',
            fontSize: '12px',
            color: '#000000'
        });
        text.setOrigin(0, 0.5);

        const container = this.scene.add.container(this.getBaseX(), this.getBaseY(), [background, text]);
        container.setScrollFactor(0);
        container.setDepth(this.depth);

        const entry: SubtitleEntry = {
            soundKey,
            label,
            container,
            background,
            text
        };

        this.updateEntryVisual(entry);
        this.root.add(container);
        return entry;
    }

    private updateEntryVisual(entry: SubtitleEntry) {
        entry.text.setText(entry.label);

        const measuredWidth = Math.ceil(entry.text.width);
        const cardWidth = Math.max(this.minWidth, measuredWidth + this.paddingX * 2);
        entry.text.setPosition(this.paddingX, this.cardHeight / 2);
        entry.text.setFixedSize(cardWidth - this.paddingX * 2, this.cardHeight);

        entry.background.clear();
        entry.background.fillStyle(0xffffff, 0.62);
        entry.background.fillRect(0, 0, cardWidth, this.cardHeight);
    }

    private getBaseX() {
        return Math.round(this.leftMargin);
    }

    private getBaseY() {
        return Math.round(this.scene.scale.height - this.bottomMargin - this.cardHeight);
    }

    private clearEntries() {
        this.entries.forEach((entry) => this.destroyEntry(entry));
        this.entries = [];
    }

    private scheduleEntryFade(entry: SubtitleEntry) {
        entry.fadeDelayTimer?.remove(false);
        entry.fadeTween?.stop();
        entry.fadeTween = undefined;

        entry.fadeDelayTimer = this.scene.time.delayedCall(this.fadeStartDelayMs, () => {
            entry.fadeTween = this.scene.tweens.add({
                targets: entry.container,
                alpha: 0,
                duration: this.fadeDurationMs,
                ease: 'Sine.inOut',
                onComplete: () => {
                    this.removeEntry(entry);
                }
            });
        });
    }

    private removeEntry(entry: SubtitleEntry) {
        const index = this.entries.indexOf(entry);
        if (index === -1) return;
        this.entries.splice(index, 1);
        this.destroyEntry(entry);
        this.layout(true);
    }

    private destroyEntry(entry?: SubtitleEntry) {
        if (!entry) return;
        entry.fadeDelayTimer?.remove(false);
        entry.fadeTween?.stop();
        entry.container.destroy();
    }
}
