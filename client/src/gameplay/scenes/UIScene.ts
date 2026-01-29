import Phaser from 'phaser';
import { StaminaBar } from '../ui/StaminaBar';

export class UIScene extends Phaser.Scene {
    private staminaBar?: StaminaBar;

    constructor() {
        super({ key: 'UIScene' });
    }

    create() {
        this.staminaBar = new StaminaBar(this);

        // Listen for stamina changes from the registry
        this.registry.events.on('changedata-stamina', (parent: any, value: number) => {
            if (this.staminaBar) {
                this.staminaBar.setStamina(value);
            }
        });

        // Initialize with current value if exists
        const currentStamina = this.registry.get('stamina');
        if (typeof currentStamina === 'number') {
            this.staminaBar.setStamina(currentStamina);
        }
    }

    update(time: number, delta: number) {
        if (this.staminaBar) {
            this.staminaBar.update(delta);
        }
    }
}
