import Phaser from 'phaser';
import type { ControlActionKey, IGuideTutorialState } from '@cfwk/shared';
import { NetworkManager } from '../../network/NetworkManager';
import { KeybindManager } from '../../input/KeybindManager';
import { LocaleManager } from '../../i18n/LocaleManager';
import type { UIScene } from '../../scenes/UIScene';
import type { IInventoryResponse } from '@cfwk/shared';

export class GuideCoordinator {
    private readonly networkManager = NetworkManager.getInstance();
    private readonly keybindManager = KeybindManager.getInstance();
    private readonly localeManager = LocaleManager.getInstance();

    private tutorial: IGuideTutorialState;
    private active = false;
    private waitingForFishingGuide = false;
    private delayedFreezeHandle?: number;
    private fishingGuideDelayHandle?: number;
    private fishingTransitionDelayHandle?: number;
    private fishingStopPromptDelayHandle?: number;
    private inventorySnapshot: IInventoryResponse | null = null;
    private startupNormalized = false;
    private fishingGuideEligibleAt = 0;
    private readonly fishingGuideStartDelayMs = 2000;
    private readonly fishingScenePromptDelayMs = 900;
    private readonly fishingReelPromptDelayMs = 900;
    private readonly fishingStopPromptDelayMs = 1500;
    private suppressFishingOverlayUntil = 0;

    private readonly rodGrantedHandler: (event: Event) => void;
    private readonly guiChangedHandler: (event: Event) => void;
    private readonly rodSelectedHandler: (event: Event) => void;
    private readonly rodEquippedHandler: () => void;
    private readonly fishingEnteredHandler: () => void;
    private readonly fishingCastedHandler: () => void;
    private readonly fishingBiteHandler: () => void;
    private readonly fishingCaughtHandler: () => void;
    private readonly fishingStoppedHandler: () => void;
    private readonly advancementsUpdatedHandler: (event: Event) => void;
    private readonly inventoryUpdateHandler: (event: Event) => void;

    constructor(private readonly uiScene: UIScene, initial: IGuideTutorialState) {
        this.tutorial = { ...initial };

        this.rodGrantedHandler = () => {
            if (this.tutorial.rodCompleted) return;
            window.setTimeout(() => {
                if (!this.shouldStartRodGuideFromCriteria()) return;
                this.setRodStep('open_inventory');
            }, 1500);
        };
        this.guiChangedHandler = (event: Event) => {
            const detail = (event as CustomEvent<{ isOpen?: boolean }>).detail;
            const isOpen = detail?.isOpen === true;
            if (this.tutorial.rodStep === 'open_inventory' && isOpen) {
                this.setRodStep('select_rod');
            }
            if (this.tutorial.rodStep === 'close_inventory' && !isOpen) {
                this.completeRodGuide();
            }
        };
        this.rodSelectedHandler = () => {
            if (this.tutorial.rodStep === 'select_rod') {
                this.setRodStep('equip_rod');
            }
        };
        this.rodEquippedHandler = () => {
            if (this.tutorial.rodStep === 'equip_rod') {
                this.setRodStep('close_inventory');
            }
        };
        this.fishingEnteredHandler = () => {
            if (this.tutorial.fishingStep !== 'use_rod') return;
            this.beginFishingTransition(this.fishingScenePromptDelayMs);
            this.fishingTransitionDelayHandle = window.setTimeout(() => {
                if (this.tutorial.fishingStep !== 'use_rod') return;
                this.setFishingStep('hold_cast', { forceSalmonCatch: true });
            }, this.fishingScenePromptDelayMs);
        };
        this.fishingCastedHandler = () => {
            if (this.tutorial.fishingStep !== 'hold_cast') return;
            this.uiScene.setGuideFishingTimerFreeze(false);
            this.setFishingStep('wait_bite', { forceSalmonCatch: true });
        };
        this.fishingBiteHandler = () => {
            if (this.tutorial.fishingStep !== 'wait_bite') return;
            if (this.delayedFreezeHandle) {
                window.clearTimeout(this.delayedFreezeHandle);
            }
            this.beginFishingTransition(this.fishingReelPromptDelayMs);
            this.delayedFreezeHandle = window.setTimeout(() => {
                if (this.tutorial.fishingStep !== 'wait_bite') return;
                this.uiScene.setGuideFishingTimerFreeze(true);
                this.setFishingStep('reel');
            }, this.fishingReelPromptDelayMs);
        };
        this.fishingCaughtHandler = () => {
            if (this.tutorial.fishingStep !== 'reel') return;
            this.uiScene.setGuideFishingTimerFreeze(false);
            this.beginFishingTransition(this.fishingStopPromptDelayMs);
            if (this.fishingStopPromptDelayHandle) {
                window.clearTimeout(this.fishingStopPromptDelayHandle);
            }
            this.fishingStopPromptDelayHandle = window.setTimeout(() => {
                if (this.tutorial.fishingStep !== 'reel') return;
                this.setFishingStep('stop_fishing');
            }, this.fishingStopPromptDelayMs);
        };
        this.fishingStoppedHandler = () => {
            if (this.tutorial.fishingStep !== 'stop_fishing') return;
            this.completeFishingGuide();
        };
        this.advancementsUpdatedHandler = (event: Event) => {
            const detail = (event as CustomEvent<{ tutorial?: IGuideTutorialState }>).detail;
            if (!detail?.tutorial) return;
            this.tutorial = { ...detail.tutorial };
        };
        this.inventoryUpdateHandler = (event: Event) => {
            const detail = (event as CustomEvent<IInventoryResponse>).detail;
            if (!detail) return;
            this.inventorySnapshot = detail;
        };

        window.addEventListener('guide:rod-granted-dialogue-complete', this.rodGrantedHandler as EventListener);
        window.addEventListener('gui-open-changed', this.guiChangedHandler as EventListener);
        window.addEventListener('guide:book:rod-selected', this.rodSelectedHandler as EventListener);
        window.addEventListener('guide:book:rod-equipped', this.rodEquippedHandler as EventListener);
        window.addEventListener('guide:fishing:entered', this.fishingEnteredHandler as EventListener);
        window.addEventListener('guide:fishing:casted', this.fishingCastedHandler as EventListener);
        window.addEventListener('guide:fishing:bite-started', this.fishingBiteHandler as EventListener);
        window.addEventListener('guide:fishing:caught', this.fishingCaughtHandler as EventListener);
        window.addEventListener('guide:fishing:stopped', this.fishingStoppedHandler as EventListener);
        window.addEventListener('advancements:update', this.advancementsUpdatedHandler as EventListener);
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);

        void this.networkManager.getInventory().then((inventory) => {
            if (!inventory) return;
            this.inventorySnapshot = inventory;
        });
    }

    update() {
        this.normalizeInProgressStepsAfterReload();

        if (!this.tutorial.rodCompleted && this.tutorial.rodStep === 'idle' && this.shouldStartRodGuideFromCriteria()) {
            this.setRodStep('open_inventory');
        }

        if (!this.tutorial.rodCompleted && this.tutorial.rodStep !== 'idle') {
            this.active = true;
            this.renderRodStep();
            return;
        }

        if (!this.tutorial.rodCompleted && this.tutorial.rodStep === 'idle') {
            this.active = false;
            this.uiScene.clearGuideOverlay();
            this.uiScene.clearGuideInputGate();
            return;
        }

        if (!this.tutorial.fishingCompleted) {
            this.tryStartFishingGuide();
        }

        if (!this.tutorial.fishingCompleted && this.tutorial.fishingStep !== 'idle') {
            this.active = true;
            this.renderFishingStep();
            return;
        }

        this.active = false;
        this.uiScene.clearGuideOverlay();
        this.uiScene.clearGuideInputGate();
    }

    isActive() {
        return this.active;
    }

    destroy() {
        if (this.delayedFreezeHandle) {
            window.clearTimeout(this.delayedFreezeHandle);
            this.delayedFreezeHandle = undefined;
        }
        if (this.fishingGuideDelayHandle) {
            window.clearTimeout(this.fishingGuideDelayHandle);
            this.fishingGuideDelayHandle = undefined;
        }
        if (this.fishingTransitionDelayHandle) {
            window.clearTimeout(this.fishingTransitionDelayHandle);
            this.fishingTransitionDelayHandle = undefined;
        }
        if (this.fishingStopPromptDelayHandle) {
            window.clearTimeout(this.fishingStopPromptDelayHandle);
            this.fishingStopPromptDelayHandle = undefined;
        }
        window.removeEventListener('guide:rod-granted-dialogue-complete', this.rodGrantedHandler as EventListener);
        window.removeEventListener('gui-open-changed', this.guiChangedHandler as EventListener);
        window.removeEventListener('guide:book:rod-selected', this.rodSelectedHandler as EventListener);
        window.removeEventListener('guide:book:rod-equipped', this.rodEquippedHandler as EventListener);
        window.removeEventListener('guide:fishing:entered', this.fishingEnteredHandler as EventListener);
        window.removeEventListener('guide:fishing:casted', this.fishingCastedHandler as EventListener);
        window.removeEventListener('guide:fishing:bite-started', this.fishingBiteHandler as EventListener);
        window.removeEventListener('guide:fishing:caught', this.fishingCaughtHandler as EventListener);
        window.removeEventListener('guide:fishing:stopped', this.fishingStoppedHandler as EventListener);
        window.removeEventListener('advancements:update', this.advancementsUpdatedHandler as EventListener);
        window.removeEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
    }

    private tryStartFishingGuide() {
        if (this.tutorial.fishingStep !== 'idle' || this.waitingForFishingGuide) return;
        if (!this.tutorial.rodCompleted) return;

        const nearWater = this.uiScene.registry.get('nearWater') === true;
        const guiOpen = this.uiScene.registry.get('guiOpen') === true;
        const fishingOpen = this.uiScene.isFishingSceneOpen();
        if (!nearWater || guiOpen || fishingOpen) return;
        if (Date.now() < this.fishingGuideEligibleAt) return;

        this.waitingForFishingGuide = true;
        this.fishingGuideDelayHandle = window.setTimeout(() => {
            this.waitingForFishingGuide = false;
            if (this.tutorial.fishingStep !== 'idle' || this.tutorial.fishingCompleted) return;
            const nearWaterNow = this.uiScene.registry.get('nearWater') === true;
            const guiOpenNow = this.uiScene.registry.get('guiOpen') === true;
            const fishingOpenNow = this.uiScene.isFishingSceneOpen();
            if (!nearWaterNow || guiOpenNow || fishingOpenNow) return;
            this.setFishingStep('use_rod', { forceSalmonCatch: true });
        }, this.fishingGuideStartDelayMs);
    }

    private renderRodStep() {
        const inventoryKey = this.keybindManager.getDisplayLabel('inventory');
        const inventoryTriggerRect = this.uiScene.getGuideInventoryTriggerRect();

        if (this.tutorial.rodStep === 'open_inventory') {
            this.showStep(
                inventoryTriggerRect
                    ? this.localeManager.t('guide.rod.openInventoryMobile', undefined, 'To equip your new rod, tap the inventory button.')
                    : this.localeManager.t('guide.rod.openInventory', { key: inventoryKey }, `To equip your new rod, open your inventory (press ${inventoryKey} on desktop).`),
                inventoryTriggerRect,
                ['inventory']
            );
            return;
        }

        if (this.tutorial.rodStep === 'select_rod') {
            this.showStep(
                this.localeManager.t('guide.rod.selectRod', undefined, 'Click your rod in the inventory to select it.'),
                this.uiScene.getGuideRodInventoryRect(),
                []
            );
            return;
        }

        if (this.tutorial.rodStep === 'equip_rod') {
            this.showStep(
                this.localeManager.t('guide.rod.equipRod', undefined, 'Click the rod equipment slot on the right to equip it.'),
                this.uiScene.getGuideEquipmentRodRect(),
                []
            );
            return;
        }

        if (this.tutorial.rodStep === 'close_inventory') {
            this.showStep(
                inventoryTriggerRect
                    ? this.localeManager.t('guide.rod.closeInventoryMobile', undefined, 'Tap the inventory button again to close your inventory.')
                    : this.localeManager.t('guide.rod.closeInventory', { key: inventoryKey }, `Close your inventory (press ${inventoryKey} on desktop).`),
                inventoryTriggerRect,
                ['inventory']
            );
        }
    }

    private renderFishingStep() {
        if (Date.now() < this.suppressFishingOverlayUntil) {
            this.uiScene.clearGuideOverlay();
            this.uiScene.clearGuideInputGate();
            return;
        }

        const fishKey = this.keybindManager.getDisplayLabel('fish');

        if (this.tutorial.fishingStep === 'use_rod') {
            this.showStep(
                this.localeManager.t('guide.fishing.useRod', { key: fishKey }, `You're near water. Press ${fishKey} (desktop) or click the rod button to start fishing.`),
                this.uiScene.getGuideHudRodRect(),
                ['fish']
            );
            return;
        }

        if (this.tutorial.fishingStep === 'hold_cast') {
            this.showStep(
                this.localeManager.t('guide.fishing.holdCast', undefined, 'Hold the cast button for a few seconds, then release.'),
                this.uiScene.getGuideFishingCastRect(),
                []
            );
            return;
        }

        if (this.tutorial.fishingStep === 'wait_bite') {
            this.showStep(
                this.localeManager.t('guide.fishing.waitBite', undefined, 'Great. Wait for a bite...'),
                null,
                [],
                null,
                false,
                true
            );
            return;
        }

        if (this.tutorial.fishingStep === 'reel') {
            this.showStep(
                this.localeManager.t('guide.fishing.reel', undefined, 'Click the reel button repeatedly until you catch the fish.'),
                this.uiScene.getGuideFishingCastRect(),
                [],
                this.uiScene.getGuideFishingBiteInfoRect()
            );
            return;
        }

        if (this.tutorial.fishingStep === 'stop_fishing') {
            this.showStep(
                this.localeManager.t('guide.fishing.stop', undefined, 'Great catch! Click Stop Fishing, then talk to the Fisherman.'),
                this.uiScene.getGuideFishingStopRect(),
                []
            );
        }
    }

    private showStep(
        message: string,
        targetRect: Phaser.Geom.Rectangle | null,
        allowedActions: ControlActionKey[],
        secondaryVisibleRect: Phaser.Geom.Rectangle | null = null,
        dimBackground = true,
        allowAllInput = false
    ) {
        this.uiScene.showGuideOverlay({
            message,
            targetRect,
            secondaryVisibleRect,
            dimBackground
        });
        if (allowAllInput) {
            this.uiScene.clearGuideInputGate();
            return;
        }
        this.uiScene.applyGuideInputGate({
            allowedActions,
            allowedPointerRect: targetRect ?? secondaryVisibleRect
        });
    }

    private completeRodGuide() {
        this.tutorial.rodCompleted = true;
        this.tutorial.rodStep = 'completed';
        this.tutorial.updatedAt = Date.now();
        this.waitingForFishingGuide = false;
        this.fishingGuideEligibleAt = Date.now() + this.fishingGuideStartDelayMs;
        this.networkManager.sendGuideTutorialUpdate({
            rodCompleted: true,
            rodStep: 'completed'
        });
        this.uiScene.clearGuideOverlay();
        this.uiScene.clearGuideInputGate();
    }

    private completeFishingGuide() {
        this.tutorial.fishingCompleted = true;
        this.tutorial.fishingStep = 'completed';
        this.tutorial.forceSalmonCatch = false;
        this.tutorial.updatedAt = Date.now();
        this.networkManager.sendGuideTutorialUpdate({
            fishingCompleted: true,
            fishingStep: 'completed',
            forceSalmonCatch: false
        });
        this.uiScene.clearGuideOverlay();
        this.uiScene.clearGuideInputGate();
    }

    private setRodStep(step: IGuideTutorialState['rodStep']) {
        this.tutorial.rodStep = step;
        this.tutorial.updatedAt = Date.now();
        this.networkManager.sendGuideTutorialUpdate({ rodStep: step });
    }

    private setFishingStep(step: IGuideTutorialState['fishingStep'], extra?: Partial<IGuideTutorialState>) {
        this.tutorial.fishingStep = step;
        this.tutorial.updatedAt = Date.now();
        if (extra?.forceSalmonCatch !== undefined) {
            this.tutorial.forceSalmonCatch = extra.forceSalmonCatch;
        }
        this.networkManager.sendGuideTutorialUpdate({
            fishingStep: step,
            ...(extra ?? {})
        });
    }

    private normalizeInProgressStepsAfterReload() {
        if (this.startupNormalized) return;
        this.startupNormalized = true;

        const update: Partial<IGuideTutorialState> = {};
        let changed = false;

        if (!this.tutorial.rodCompleted && this.tutorial.rodStep !== 'idle' && this.tutorial.rodStep !== 'completed') {
            this.tutorial.rodStep = 'idle';
            update.rodStep = 'idle';
            changed = true;
        }

        if (!this.tutorial.fishingCompleted && this.tutorial.fishingStep !== 'idle' && this.tutorial.fishingStep !== 'completed') {
            this.tutorial.fishingStep = 'idle';
            this.tutorial.forceSalmonCatch = false;
            update.fishingStep = 'idle';
            update.forceSalmonCatch = false;
            changed = true;
        }

        if (!changed) return;
        this.tutorial.updatedAt = Date.now();
        this.networkManager.sendGuideTutorialUpdate(update);
    }

    private shouldStartRodGuideFromCriteria() {
        if (this.tutorial.rodCompleted) return false;
        const inventory = this.inventorySnapshot;
        if (!inventory) return false;
        const hasGuideRod = inventory.slots.some((slot) => slot.itemId === 'rickety_rod');
        const rodEquipped = Boolean(inventory.equippedRodId);
        return hasGuideRod && !rodEquipped;
    }

    private beginFishingTransition(durationMs: number) {
        this.suppressFishingOverlayUntil = Date.now() + durationMs;
        this.uiScene.clearGuideOverlay();
        this.uiScene.clearGuideInputGate();
    }
}
