import Phaser from 'phaser';

export type SettingsToggleConfig = {
    value: boolean;
    onChange?: (value: boolean) => void;
};

export class SettingsToggle {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private toggle: Phaser.GameObjects.Image;
    private value: boolean;
    private onChange?: (value: boolean) => void;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config: SettingsToggleConfig) {
        this.scene = scene;
        this.value = config.value;
        this.onChange = config.onChange;

        this.toggle = this.scene.add.image(0, 0, this.value ? 'ui-toggle-on' : 'ui-toggle-off').setOrigin(0, 0.5);
        this.container = this.scene.add.container(0, 0, [this.toggle]);
        parent.add(this.container);

        this.toggle.setInteractive({ useHandCursor: true });
        this.toggle.on('pointerdown', () => this.setValue(!this.value, true));
    }

    setPosition(x: number, y: number) {
        this.container.setPosition(x, y);
    }

    setScale(scale: number) {
        this.container.setScale(scale);
    }

    setValue(value: boolean, emit = false) {
        if (this.value === value) return;
        this.value = value;
        this.toggle.setTexture(this.value ? 'ui-toggle-on' : 'ui-toggle-off');
        if (emit) {
            this.onChange?.(this.value);
        }
    }

    getValue(): boolean {
        return this.value;
    }

    getWidth(): number {
        return this.toggle.width;
    }
}
