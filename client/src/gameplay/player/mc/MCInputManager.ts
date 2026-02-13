import Phaser from 'phaser';
import { MobileControls } from '../../ui/MobileControls';
import type { InteractionManager } from '../../interaction/InteractionManager';

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
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    private wasd?: {
        up: Phaser.Input.Keyboard.Key;
        down: Phaser.Input.Keyboard.Key;
        left: Phaser.Input.Keyboard.Key;
        right: Phaser.Input.Keyboard.Key;
    };
    private shiftKey?: Phaser.Input.Keyboard.Key;
    private interactKey?: Phaser.Input.Keyboard.Key;
    private fishingKey?: Phaser.Input.Keyboard.Key;
    private mobileControls?: MobileControls;
    private mobileInteractListener?: () => void;
    private windowBlurHandler?: () => void;
    private visibilityChangeHandler?: () => void;

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
            moveUp: this.cursors?.up?.isDown || this.wasd?.up?.isDown || mobileInput?.up || false,
            moveDown: this.cursors?.down?.isDown || this.wasd?.down?.isDown || mobileInput?.down || false,
            moveLeft: this.cursors?.left?.isDown || this.wasd?.left?.isDown || mobileInput?.left || false,
            moveRight: this.cursors?.right?.isDown || this.wasd?.right?.isDown || mobileInput?.right || false,
            wantSprint: this.shiftKey?.isDown || mobileInput?.sprint || false
        };
    }

    getActionPresses(): ActionPresses {
        return {
            interactPressed: Boolean(this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)),
            fishingPressed: Boolean(this.fishingKey && Phaser.Input.Keyboard.JustDown(this.fishingKey))
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
        this.cursors = this.scene.input.keyboard?.createCursorKeys();
        this.wasd = this.scene.input.keyboard?.addKeys({
            up: 'W',
            down: 'S',
            left: 'A',
            right: 'D'
        }) as typeof this.wasd;
        this.shiftKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

        this.interactKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F);
        this.fishingKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.R);

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

        const keys = [
            this.cursors?.up,
            this.cursors?.down,
            this.cursors?.left,
            this.cursors?.right,
            this.wasd?.up,
            this.wasd?.down,
            this.wasd?.left,
            this.wasd?.right,
            this.shiftKey,
            this.interactKey,
            this.fishingKey
        ];

        for (const key of keys) {
            if (!key) continue;
            key.isDown = false;
            key.isUp = true;
            key.repeats = 0;
        }

        this.mobileControls?.setInputBlocked(false);
    }
}
