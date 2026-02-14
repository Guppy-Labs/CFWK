import Phaser from 'phaser';
import { IAudioSettings } from '@cfwk/shared';
import { SettingsFont } from './SettingsFont';
import { SettingsSlider } from './SettingsSlider';
import { SettingsToggle } from './SettingsToggle';

export type SettingsSoundPanelConfig = {
    onAudioChange?: (key: keyof IAudioSettings, value: number) => void;
    onToggleChange?: (key: keyof IAudioSettings, value: boolean) => void;
    resolveLabel?: (key: string, fallback: string) => string;
};

type SliderRow = {
    key: keyof IAudioSettings;
    labelKey: string;
    fallbackLabel: string;
    label: Phaser.GameObjects.Image;
    slider: SettingsSlider;
};

type ToggleRow = {
    key: keyof IAudioSettings;
    labelKey: string;
    fallbackLabel: string;
    label: Phaser.GameObjects.Image;
    toggle: SettingsToggle;
};

export class SettingsSoundPanel {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private font: SettingsFont;
    private sliderRows: SliderRow[] = [];
    private toggleRows: ToggleRow[] = [];
    private onAudioChange?: (key: keyof IAudioSettings, value: number) => void;
    private onToggleChange?: (key: keyof IAudioSettings, value: boolean) => void;
    private resolveLabel?: (key: string, fallback: string) => string;

    private readonly offsetX = 8;
    private readonly offsetY = 10;
    private readonly rowGap = 18;
    private readonly toggleGap = 22;
    private readonly sliderGap = 2;
    private readonly labelColor = '#4b3435';
    private readonly sliderWidth = 64;
    private readonly sliderHeight = 8;
    private readonly pageWidth = 147;
    private readonly rightControlInset = 12;
    private readonly labelRightPadding = 2;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config?: SettingsSoundPanelConfig) {
        this.scene = scene;
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.font = new SettingsFont(scene);
        this.onAudioChange = config?.onAudioChange;
        this.onToggleChange = config?.onToggleChange;
        this.resolveLabel = config?.resolveLabel;

        this.createSliders();
        this.createToggles();
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    layout(rightPageLeftEdgeX: number, rightPageTopEdgeY: number, scale: number) {
        const startX = Math.floor(rightPageLeftEdgeX + this.offsetX * scale);
        let cursorY = Math.floor(rightPageTopEdgeY + this.offsetY * scale);
        const controlRightX = this.getControlRightX();
        const sliderLeftX = controlRightX - this.sliderWidth;

        this.container.setPosition(startX, cursorY);
        this.container.setScale(scale);

        let localY = 0;

        this.sliderRows.forEach((row) => {
            row.label.setPosition(0, localY - 1);
            row.slider.setPosition(sliderLeftX, localY + this.sliderHeight / 2 - 1);
            localY += this.rowGap;
        });

        localY += 10;

        this.toggleRows.forEach((row) => {
            row.label.setPosition(0, localY - 1);
            row.toggle.setPosition(controlRightX - row.toggle.getWidth(), localY + 4);
            localY += this.toggleGap;
        });
    }

    setValues(settings: IAudioSettings) {
        this.sliderRows.forEach((row) => {
            const value = typeof settings[row.key] === 'number' ? (settings[row.key] as number) : 1;
            row.slider.setValue(value, false);
        });

        this.toggleRows.forEach((row) => {
            const value = Boolean(settings[row.key]);
            row.toggle.setValue(value, false);
        });
    }

    getContentHeight(): number {
        return this.offsetY
            + this.sliderRows.length * this.rowGap
            + 10
            + this.toggleRows.length * this.toggleGap
            + 12;
    }

    refreshLabels() {
        const sliderLabelMaxWidth = this.getSliderLabelMaxWidth();

        this.sliderRows.forEach((row) => {
            const label = this.resolveText(row.labelKey, row.fallbackLabel);
            const clipped = this.clipLabel(label, sliderLabelMaxWidth);
            row.label.setTexture(this.font.createTextTexture(clipped, this.labelColor));
        });

        this.toggleRows.forEach((row) => {
            const label = this.resolveText(row.labelKey, row.fallbackLabel);
            const toggleLabelMaxWidth = this.getToggleLabelMaxWidth(row.toggle.getWidth());
            const clipped = this.clipLabel(label, toggleLabelMaxWidth);
            row.label.setTexture(this.font.createTextTexture(clipped, this.labelColor));
        });
    }

    destroy() {
        this.sliderRows.forEach((row) => row.slider.destroy());
        this.container.destroy();
    }

    private createSliders() {
        const rows: Array<{ key: keyof IAudioSettings; labelKey: string; fallbackLabel: string }> = [
            { key: 'master', labelKey: 'settings.sounds.master', fallbackLabel: 'Master' },
            { key: 'music', labelKey: 'settings.sounds.music', fallbackLabel: 'Music' },
            { key: 'ambient', labelKey: 'settings.sounds.ambient', fallbackLabel: 'Ambient' },
            { key: 'players', labelKey: 'settings.sounds.players', fallbackLabel: 'Players' },
            { key: 'overlays', labelKey: 'settings.sounds.overlays', fallbackLabel: 'Overlays' }
        ];

        rows.forEach((row) => {
            const labelText = this.resolveText(row.labelKey, row.fallbackLabel);
            const clippedLabel = this.clipLabel(labelText, this.getSliderLabelMaxWidth());
            const labelKey = this.font.createTextTexture(clippedLabel, this.labelColor);
            const label = this.scene.add.image(0, 0, labelKey).setOrigin(0, 0);
            const slider = new SettingsSlider(this.scene, this.container, {
                width: this.sliderWidth,
                height: this.sliderHeight,
                value: 1,
                onChange: (value) => this.onAudioChange?.(row.key, value)
            });

            this.container.add(label);
            this.sliderRows.push({ key: row.key, labelKey: row.labelKey, fallbackLabel: row.fallbackLabel, label, slider });
        });
    }

    private createToggles() {
        const rows: Array<{ key: keyof IAudioSettings; labelKey: string; fallbackLabel: string }> = [
            { key: 'subtitlesEnabled', labelKey: 'settings.sounds.subtitlesEnabled', fallbackLabel: 'Subtitles' },
            { key: 'stereoEnabled', labelKey: 'settings.sounds.stereoEnabled', fallbackLabel: 'Stereo' }
        ];

        rows.forEach((row) => {
            const toggle = new SettingsToggle(this.scene, this.container, {
                value: false,
                onChange: (value) => this.onToggleChange?.(row.key, value)
            });

            const labelText = this.resolveText(row.labelKey, row.fallbackLabel);
            const clippedLabel = this.clipLabel(labelText, this.getToggleLabelMaxWidth(toggle.getWidth()));
            const labelKey = this.font.createTextTexture(clippedLabel, this.labelColor);
            const label = this.scene.add.image(0, 0, labelKey).setOrigin(0, 0);

            this.container.add(label);
            this.toggleRows.push({ key: row.key, labelKey: row.labelKey, fallbackLabel: row.fallbackLabel, label, toggle });
        });
    }

    private getControlRightX() {
        return this.pageWidth - this.offsetX - this.rightControlInset;
    }

    private getSliderLabelMaxWidth() {
        return Math.max(0, this.getControlRightX() - this.sliderWidth - this.sliderGap - this.labelRightPadding);
    }

    private getToggleLabelMaxWidth(toggleWidth: number) {
        return Math.max(0, this.getControlRightX() - toggleWidth - this.sliderGap - this.labelRightPadding);
    }

    private clipLabel(text: string, maxWidth: number) {
        if (maxWidth <= 0) return '';
        if (this.font.measureBitmapTextWidth(text) <= maxWidth) return text;

        let clipped = text;
        while (clipped.length > 0 && this.font.measureBitmapTextWidth(clipped) > maxWidth) {
            clipped = clipped.slice(0, -1);
        }

        return clipped;
    }

    private resolveText(key: string, fallback: string) {
        return this.resolveLabel ? this.resolveLabel(key, fallback) : fallback;
    }
}
