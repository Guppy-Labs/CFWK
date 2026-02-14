import Phaser from 'phaser';
import { MobileControls } from '../../ui/MobileControls';
import type { InteractionManager } from '../../interaction/InteractionManager';
import { KeybindManager } from '../../input/KeybindManager';

type MovementInput = {
    moveUp: boolean;
    moveDown: boolean;
    moveLeft: boolean;
    moveRight: boolean;
    wantSprint: boolean;
};

type ActionPresses = {
    interactPressed: boolean;
    fishingPressed: boolean;
};

type MCInputCallbacks = {
    onInteract: () => void;
};

export class MCInputManager {
    private mobileControls?: MobileControls;
    private mobileInteractListener?: () => void;
    private windowBlurHandler?: () => void;
    private visibilityChangeHandler?: () => void;
    private keybindManager = KeybindManager.getInstance();

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly interactionManager: InteractionManager,
        private readonly callbacks: MCInputCallbacks
    ) {
        this.setupInput();
    }

    getMovementInput(inputBlocked: boolean): MovementInput {
        if (inputBlocked) {
            return { moveUp: false, moveDown: false, moveLeft: false, moveRight: false, wantSprint: false };
        }

        const mobileInput = this.mobileControls?.getInputState();
        return {
            moveUp: this.keybindManager.isActionDown('moveUp') || mobileInput?.up || false,
            moveDown: this.keybindManager.isActionDown('moveDown') || mobileInput?.down || false,
            moveLeft: this.keybindManager.isActionDown('moveLeft') || mobileInput?.left || false,
            moveRight: this.keybindManager.isActionDown('moveRight') || mobileInput?.right || false,
            wantSprint: this.keybindManager.isActionDown('sprint') || mobileInput?.sprint || false
        };
    }

    getActionPresses(): ActionPresses {
        return {
            interactPressed: this.keybindManager.consumeActionPress('interact'),
            fishingPressed: this.keybindManager.consumeActionPress('fish')
        };
    }

    getMobileControls(): MobileControls | undefined {
        return this.mobileControls;
    }

    destroy() {
        if (this.mobileInteractListener) {
            window.removeEventListener('mobile:interact', this.mobileInteractListener);
        }
        if (this.windowBlurHandler) {
            window.removeEventListener('blur', this.windowBlurHandler);
        }
        if (this.visibilityChangeHandler) {
            document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
        }
        this.mobileControls?.destroy();
    }

    private setupInput() {
        this.mobileControls = new MobileControls(this.scene);

        this.interactionManager.onInteractionChange((interaction) => {
            this.mobileControls?.setAvailableInteraction(interaction);
        });

        this.mobileInteractListener = () => {
            this.callbacks.onInteract();
        };
        window.addEventListener('mobile:interact', this.mobileInteractListener);

        this.windowBlurHandler = () => this.resetInputState();
        window.addEventListener('blur', this.windowBlurHandler);

        this.visibilityChangeHandler = () => {
            if (document.hidden) {
                this.resetInputState();
            }
        };
        document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }

    private resetInputState() {
        const keyboard = this.scene.input.keyboard as any;
        keyboard?.resetKeys?.();

        this.mobileControls?.setInputBlocked(false);
    }
}
