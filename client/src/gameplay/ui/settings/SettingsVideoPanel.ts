import Phaser from 'phaser';
import { IVideoSettings, VideoQualityPreset } from '@cfwk/shared';
import { SettingsFont } from './SettingsFont';
import { SettingsToggle } from './SettingsToggle';
import { FullscreenManager } from '../FullscreenManager';

export type SettingsVideoPanelConfig = {
    onVideoToggleChange?: (key: keyof IVideoSettings, value: boolean) => void;
    onQualityPresetChange?: (preset: VideoQualityPreset) => void;
    resolveLabel?: (key: string, fallback: string) => string;
};

type ToggleRow = {
    key: keyof IVideoSettings;
    labelKey: string;
    fallbackLabel: string;
    label: Phaser.GameObjects.Image;
    toggle: SettingsToggle;
};

type QualityRow = {
    preset: VideoQualityPreset;
    labelKey: string;
    fallbackLabel: string;
    label: Phaser.GameObjects.Image;
    toggle: SettingsToggle;
};

export class SettingsVideoPanel {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private font: SettingsFont;
    private qualityTitleImage: Phaser.GameObjects.Image;
    private toggleRows: ToggleRow[] = [];
    private qualityRows: QualityRow[] = [];
    private onVideoToggleChange?: (key: keyof IVideoSettings, value: boolean) => void;
    private onQualityPresetChange?: (preset: VideoQualityPreset) => void;
    private resolveLabel?: (key: string, fallback: string) => string;
    private fullscreenUnsubscribe?: () => void;

    private readonly offsetX = 8;
    private readonly offsetY = 10;
    private readonly rowGap = 18;
    private readonly sectionGap = 8;
    private readonly labelColor = '#4b3435';
    private readonly sliderGap = 2;
    private readonly pageWidth = 147;
    private readonly rightControlInset = 12;
    private readonly labelRightPadding = 2;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config?: SettingsVideoPanelConfig) {
        this.scene = scene;
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.font = new SettingsFont(scene);
        this.onVideoToggleChange = config?.onVideoToggleChange;
        this.onQualityPresetChange = config?.onQualityPresetChange;
        this.resolveLabel = config?.resolveLabel;

        const qualityTitle = this.resolveText('settings.video.qualityPreset', 'Quality Preset');
        this.qualityTitleImage = this.scene.add.image(0, 0, this.font.createTextTexture(qualityTitle, this.labelColor)).setOrigin(0, 0);
        this.container.add(this.qualityTitleImage);

        this.createQualityRows();
        this.createToggleRows();

        this.fullscreenUnsubscribe = FullscreenManager.onChange(() => {
            const enabled = FullscreenManager.isEnabled();
            const fullscreenRow = this.toggleRows.find((row) => row.key === 'fullscreen');
            if (!fullscreenRow) return;
            fullscreenRow.toggle.setValue(enabled, false);
            this.onVideoToggleChange?.('fullscreen', enabled);
        });
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    layout(rightPageLeftEdgeX: number, rightPageTopEdgeY: number, scale: number) {
        const startX = Math.floor(rightPageLeftEdgeX + this.offsetX * scale);
        const startY = Math.floor(rightPageTopEdgeY + this.offsetY * scale);
        const controlRightX = this.getControlRightX();

        this.container.setPosition(startX, startY);
        this.container.setScale(scale);

        let localY = 0;

        this.qualityTitleImage.setPosition(0, localY);
        localY += this.rowGap;

        this.qualityRows.forEach((row) => {
            row.label.setPosition(0, localY - 1);
            row.toggle.setPosition(controlRightX - row.toggle.getWidth(), localY + 4);
            localY += this.rowGap;
        });

        localY += this.sectionGap;

        this.toggleRows.forEach((row) => {
            row.label.setPosition(0, localY - 1);
            row.toggle.setPosition(controlRightX - row.toggle.getWidth(), localY + 4);
            localY += this.rowGap;
        });
    }

    setValues(settings: IVideoSettings) {
        this.qualityRows.forEach((row) => {
            row.toggle.setValue(row.preset === settings.qualityPreset, false);
        });

        this.toggleRows.forEach((row) => {
            const value = row.key === 'fullscreen'
                ? FullscreenManager.isEnabled()
                : Boolean(settings[row.key]);
            row.toggle.setValue(value, false);
        });
    }

    getContentHeight(): number {
        return this.offsetY
            + this.rowGap
            + this.qualityRows.length * this.rowGap
            + this.sectionGap
            + this.toggleRows.length * this.rowGap
            + 12;
    }

    refreshLabels() {
        const qualityTitle = this.resolveText('settings.video.qualityPreset', 'Quality Preset');
        this.qualityTitleImage.setTexture(this.font.createTextTexture(qualityTitle, this.labelColor));

        this.qualityRows.forEach((row) => {
            const label = this.resolveText(row.labelKey, row.fallbackLabel);
            const clipped = this.clipLabel(label, this.getToggleLabelMaxWidth(row.toggle.getWidth()));
            row.label.setTexture(this.font.createTextTexture(clipped, this.labelColor));
        });

        this.toggleRows.forEach((row) => {
            const label = this.resolveText(row.labelKey, row.fallbackLabel);
            const clipped = this.clipLabel(label, this.getToggleLabelMaxWidth(row.toggle.getWidth()));
            row.label.setTexture(this.font.createTextTexture(clipped, this.labelColor));
        });
    }

    destroy() {
        this.fullscreenUnsubscribe?.();
        this.fullscreenUnsubscribe = undefined;
        this.container.destroy();
    }

    private createQualityRows() {
        const rows: Array<{ preset: VideoQualityPreset; labelKey: string; fallbackLabel: string }> = [
            { preset: 'low', labelKey: 'settings.video.qualityLow', fallbackLabel: 'Low' },
            { preset: 'medium', labelKey: 'settings.video.qualityMedium', fallbackLabel: 'Medium' },
            { preset: 'high', labelKey: 'settings.video.qualityHigh', fallbackLabel: 'High' },
            { preset: 'custom', labelKey: 'settings.video.qualityCustom', fallbackLabel: 'Custom' }
        ];

        rows.forEach((row) => {
            const labelText = this.resolveText(row.labelKey, row.fallbackLabel);

            const toggle = new SettingsToggle(this.scene, this.container, {
                value: false,
                onChange: (value) => {
                    if (!value) return;

                    this.qualityRows.forEach((other) => {
                        if (other.preset !== row.preset) {
                            other.toggle.setValue(false, false);
                        }
                    });

                    this.onQualityPresetChange?.(row.preset);
                }
            });

            const clippedLabel = this.clipLabel(labelText, this.getToggleLabelMaxWidth(toggle.getWidth()));
            const label = this.scene.add.image(0, 0, this.font.createTextTexture(clippedLabel, this.labelColor)).setOrigin(0, 0);

            this.container.add(label);
            this.qualityRows.push({
                preset: row.preset,
                labelKey: row.labelKey,
                fallbackLabel: row.fallbackLabel,
                label,
                toggle
            });
        });
    }

    private createToggleRows() {
        const rows: Array<{ key: keyof IVideoSettings; labelKey: string; fallbackLabel: string }> = [
            { key: 'fullscreen', labelKey: 'settings.video.fullscreen', fallbackLabel: 'Fullscreen' },
            { key: 'visualEffectsEnabled', labelKey: 'settings.video.visualEffectsEnabled', fallbackLabel: 'Visual Effects' },
            { key: 'seasonalEffectsEnabled', labelKey: 'settings.video.seasonalEffectsEnabled', fallbackLabel: 'Seasonal' },
            { key: 'bloomEnabled', labelKey: 'settings.video.bloomEnabled', fallbackLabel: 'Bloom' },
            { key: 'vignetteEnabled', labelKey: 'settings.video.vignetteEnabled', fallbackLabel: 'Vignette' },
            { key: 'tiltShiftEnabled', labelKey: 'settings.video.tiltShiftEnabled', fallbackLabel: 'Tilt Shift' },
            { key: 'dustParticlesEnabled', labelKey: 'settings.video.dustParticlesEnabled', fallbackLabel: 'Dust Particles' }
        ];

        rows.forEach((row) => {
            const labelText = this.resolveText(row.labelKey, row.fallbackLabel);

            const toggle = new SettingsToggle(this.scene, this.container, {
                value: false,
                onChange: (value) => this.onVideoToggleChange?.(row.key, value)
            });

            const clippedLabel = this.clipLabel(labelText, this.getToggleLabelMaxWidth(toggle.getWidth()));
            const label = this.scene.add.image(0, 0, this.font.createTextTexture(clippedLabel, this.labelColor)).setOrigin(0, 0);

            this.container.add(label);
            this.toggleRows.push({ key: row.key, labelKey: row.labelKey, fallbackLabel: row.fallbackLabel, label, toggle });
        });
    }

    private getControlRightX() {
        return this.pageWidth - this.offsetX - this.rightControlInset;
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
