import Phaser from 'phaser';
import { IAudioSettings } from '@cfwk/shared';
import { SettingsFont } from './SettingsFont';
import { SettingsSlider } from './SettingsSlider';
import { SettingsToggle } from './SettingsToggle';

export type SettingsSoundPanelConfig = {
    onAudioChange?: (key: keyof IAudioSettings, value: number) => void;
    onToggleChange?: (key: keyof IAudioSettings, value: boolean) => void;
};

type SliderRow = {
    key: keyof IAudioSettings;
    label: Phaser.GameObjects.Image;
    slider: SettingsSlider;
};

type ToggleRow = {
    key: keyof IAudioSettings;
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

    private readonly offsetX = 8;
    private readonly offsetY = 10;
    private readonly rowGap = 18;
    private readonly toggleGap = 22;
    private readonly sliderGap = 2;
    private readonly labelColor = '#4b3435';
    private readonly sliderWidth = 64;
    private readonly sliderHeight = 8;
    private labelColumnWidth = 0;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config?: SettingsSoundPanelConfig) {
        this.scene = scene;
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.font = new SettingsFont(scene);
        this.onAudioChange = config?.onAudioChange;
        this.onToggleChange = config?.onToggleChange;

        this.createSliders();
        this.createToggles();
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    layout(rightPageLeftEdgeX: number, rightPageTopEdgeY: number, scale: number) {
        const startX = Math.floor(rightPageLeftEdgeX + this.offsetX * scale);
        let cursorY = Math.floor(rightPageTopEdgeY + this.offsetY * scale);

        this.container.setPosition(startX, cursorY);
        this.container.setScale(scale);

        let localY = 0;

        this.sliderRows.forEach((row) => {
            row.label.setPosition(0, localY - 1);
            row.slider.setPosition(this.labelColumnWidth + this.sliderGap, localY + this.sliderHeight / 2 - 1);
            localY += this.rowGap;
        });

        localY += 10;

        this.toggleRows.forEach((row) => {
            row.label.setPosition(0, localY - 1);
            row.toggle.setPosition(this.labelColumnWidth + this.sliderGap, localY + 4);
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

    destroy() {
        this.sliderRows.forEach((row) => row.slider.destroy());
        this.container.destroy();
    }

    private createSliders() {
        const rows: Array<{ key: keyof IAudioSettings; label: string }> = [
            { key: 'master', label: 'Master' },
            { key: 'music', label: 'Music' },
            { key: 'ambient', label: 'Ambient' },
            { key: 'players', label: 'Players' },
            { key: 'overlays', label: 'Overlays' }
        ];

        rows.forEach((row) => {
            const labelKey = this.font.createTextTexture(row.label, this.labelColor);
            const label = this.scene.add.image(0, 0, labelKey).setOrigin(0, 0);
            this.labelColumnWidth = Math.max(this.labelColumnWidth, this.font.measureBitmapTextWidth(row.label) + 2);
            const slider = new SettingsSlider(this.scene, this.container, {
                width: this.sliderWidth,
                height: this.sliderHeight,
                value: 1,
                onChange: (value) => this.onAudioChange?.(row.key, value)
            });

            this.container.add(label);
            this.sliderRows.push({ key: row.key, label, slider });
        });
    }

    private createToggles() {
        const rows: Array<{ key: keyof IAudioSettings; label: string }> = [
            { key: 'subtitlesEnabled', label: 'Subtitles' },
            { key: 'stereoEnabled', label: 'Stereo' }
        ];

        rows.forEach((row) => {
            const labelKey = this.font.createTextTexture(row.label, this.labelColor);
            const label = this.scene.add.image(0, 0, labelKey).setOrigin(0, 0);
            this.labelColumnWidth = Math.max(this.labelColumnWidth, this.font.measureBitmapTextWidth(row.label) + 2);
            const toggle = new SettingsToggle(this.scene, this.container, {
                value: false,
                onChange: (value) => this.onToggleChange?.(row.key, value)
            });

            this.container.add(label);
            this.toggleRows.push({ key: row.key, label, toggle });
        });
    }
}
