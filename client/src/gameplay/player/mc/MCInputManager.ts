import Phaser from 'phaser';
import { MobileControls } from '../../ui/MobileControls';
import { DesktopInteractButton } from '../../ui/DesktopInteractButton';
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
    private desktopInteractButton?: DesktopInteractButton;
    private mobileInteractListener?: () => void;

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

    getDesktopInteractButton(): DesktopInteractButton | undefined {
        return this.desktopInteractButton;
    }

    destroy() {
        if (this.mobileInteractListener) {
            window.removeEventListener('mobile:interact', this.mobileInteractListener);
        }
        this.mobileControls?.destroy();
        this.desktopInteractButton?.destroy();
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
        this.desktopInteractButton = new DesktopInteractButton();

        this.interactionManager.onInteractionChange((interaction) => {
            this.mobileControls?.setAvailableInteraction(interaction);
            this.desktopInteractButton?.setAvailableInteraction(interaction);
        });

        this.mobileInteractListener = () => {
            this.callbacks.onInteract();
        };
        window.addEventListener('mobile:interact', this.mobileInteractListener);
    }
}
