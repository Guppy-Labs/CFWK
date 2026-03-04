import Phaser from 'phaser';
import type { ControlActionKey } from '@cfwk/shared';
import { KeybindManager } from '../../input/KeybindManager';

export type GuideInputGateConfig = {
    allowedActions: ControlActionKey[];
    allowedPointerRect: Phaser.Geom.Rectangle | null;
};

export class GuideInputGate {
    private enabled = false;
    private allowedActions = new Set<ControlActionKey>();
    private allowedPointerRect: Phaser.Geom.Rectangle | null = null;

    private keyHandler?: (event: KeyboardEvent) => void;
    private pointerHandler?: (event: MouseEvent | PointerEvent | TouchEvent) => void;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly keybindManager: KeybindManager
    ) {}

    install() {
        if (this.keyHandler || this.pointerHandler) return;

        this.keyHandler = (event: KeyboardEvent) => {
            if (!this.enabled) return;
            if (this.isAllowedAction(event)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
        };

        this.pointerHandler = (event: MouseEvent | PointerEvent | TouchEvent) => {
            if (!this.enabled) return;
            if (this.allowedPointerRect && this.isPointerInsideRect(event, this.allowedPointerRect)) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
        };

        window.addEventListener('keydown', this.keyHandler, { capture: true });
        window.addEventListener('keyup', this.keyHandler, { capture: true });
        window.addEventListener('pointerdown', this.pointerHandler as EventListener, { capture: true });
        window.addEventListener('mousedown', this.pointerHandler as EventListener, { capture: true });
        window.addEventListener('touchstart', this.pointerHandler as EventListener, { capture: true });
    }

    uninstall() {
        if (this.keyHandler) {
            window.removeEventListener('keydown', this.keyHandler, { capture: true } as any);
            window.removeEventListener('keyup', this.keyHandler, { capture: true } as any);
            this.keyHandler = undefined;
        }
        if (this.pointerHandler) {
            window.removeEventListener('pointerdown', this.pointerHandler as EventListener, { capture: true } as any);
            window.removeEventListener('mousedown', this.pointerHandler as EventListener, { capture: true } as any);
            window.removeEventListener('touchstart', this.pointerHandler as EventListener, { capture: true } as any);
            this.pointerHandler = undefined;
        }
        this.enabled = false;
        this.allowedActions.clear();
        this.allowedPointerRect = null;
    }

    apply(config: GuideInputGateConfig) {
        this.enabled = true;
        this.allowedActions = new Set(config.allowedActions);
        this.allowedPointerRect = config.allowedPointerRect;

        this.scene.registry.set('guideBlockAll', true);
        this.scene.registry.set('guideAllowedActions', [...this.allowedActions]);
    }

    clear() {
        this.enabled = false;
        this.allowedActions.clear();
        this.allowedPointerRect = null;

        this.scene.registry.set('guideBlockAll', false);
        this.scene.registry.set('guideAllowedActions', []);
    }

    private isAllowedAction(event: KeyboardEvent): boolean {
        if (this.allowedActions.size === 0) return false;
        for (const action of this.allowedActions) {
            if (this.keybindManager.matchesActionEvent(action, event)) return true;
        }
        return false;
    }

    private isPointerInsideRect(event: MouseEvent | PointerEvent | TouchEvent, rect: Phaser.Geom.Rectangle): boolean {
        const canvas = this.scene.game.canvas;
        if (!canvas) return false;

        const bounds = canvas.getBoundingClientRect();

        let clientX: number | null = null;
        let clientY: number | null = null;

        if ('touches' in event && event.touches.length > 0) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else if ('clientX' in event && typeof event.clientX === 'number') {
            clientX = event.clientX;
            clientY = event.clientY;
        }

        if (clientX === null || clientY === null) return false;

        const gameX = ((clientX - bounds.left) / Math.max(1, bounds.width)) * this.scene.scale.width;
        const gameY = ((clientY - bounds.top) / Math.max(1, bounds.height)) * this.scene.scale.height;
        return rect.contains(gameX, gameY);
    }
}
