import Phaser from 'phaser';
import type { ControlActionKey, IAdvancementsState, IGuideTutorialState } from '@cfwk/shared';
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
    private foodScoreAdvanceHandle?: number;
    private foodDamageIntroHandle?: number;
    private inventorySnapshot: IInventoryResponse | null = null;
    private advancementsSnapshot: IAdvancementsState | null = null;
    private startupReconciled = false;
    private simulatedFoodDamage = false;
    private foodDamageIntroDone = false;
    private fishingGuideEligibleAt = 0;
    private readonly fishingGuideStartDelayMs = 1000;
    private readonly fishingScenePromptDelayMs = 900;
    private readonly fishingReelPromptDelayMs = 900;
    private readonly fishingStopPromptDelayMs = 1500;
    private suppressFishingOverlayUntil = 0;
    private fishingTransitionLockActive = false;
    private hideHoldCastPromptWhileHolding = false;
    private finbookClickAdvanceReadyAt = 0;
    private readonly finbookGuideQuestDelayMs = 5000;
    private readonly finbookAdvanceDebounceMs = 180;

    private readonly rodGrantedHandler: (event: Event) => void;
    private readonly guiChangedHandler: (event: Event) => void;
    private readonly bookTabChangedHandler: (event: Event) => void;
    private readonly finbookPointerDownHandler: (event: Event) => void;
    private readonly rodSelectedHandler: (event: Event) => void;
    private readonly rodEquippedHandler: () => void;
    private readonly fishingEnteredHandler: () => void;
    private readonly fishingCastedHandler: () => void;
    private readonly fishingBiteHandler: () => void;
    private readonly fishingCaughtHandler: () => void;
    private readonly fishingStoppedHandler: () => void;
    private readonly fishingCastHoldStartedHandler: () => void;
    private readonly fishingCastHoldCancelledHandler: () => void;
    private readonly advancementsUpdatedHandler: (event: Event) => void;
    private readonly inventoryUpdateHandler: (event: Event) => void;
    private readonly inventoryConsumedHandler: (event: Event) => void;
    private readonly foodSelectedHandler: (event: Event) => void;
    private readonly foodEquippedHandler: (event: Event) => void;
    private readonly fishermanInRangeHandler: () => void;
    private readonly npcInteractHandler: (event: Event) => void;

    constructor(private readonly uiScene: UIScene, initial: IGuideTutorialState) {
        this.tutorial = { ...initial };
        this.uiScene.registry.set('guideFishingTransitionLock', false);

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
            if (this.tutorial.foodStep === 'open_inventory' && isOpen) {
                this.setFoodStep('select_berry');
            }
            if (this.tutorial.foodStep === 'close_inventory' && !isOpen) {
                this.setFoodStep('consume_quickslot_1');
            }
            if (this.tutorial.finbookStep === 'open_inventory' && isOpen) {
                this.setFinbookStep('open_finbook_tab');
            }
            if (this.tutorial.finbookStep === 'close_inventory' && !isOpen) {
                this.completeFinbookGuide();
            }
        };
        this.bookTabChangedHandler = (event: Event) => {
            if (this.tutorial.finbookStep !== 'open_finbook_tab') return;
            const detail = (event as CustomEvent<{ tab?: string }>).detail;
            if (detail?.tab !== 'Finbook') return;
            this.setFinbookStep('show_completed_quest');
        };
        this.finbookPointerDownHandler = (_event: Event) => {
            if (!this.isFinbookClickAdvanceStep(this.tutorial.finbookStep)) return;
            if (Date.now() < this.finbookClickAdvanceReadyAt) return;
            this.advanceFinbookClickStep(this.tutorial.finbookStep);
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
            this.hideHoldCastPromptWhileHolding = false;
            this.beginFishingTransition(this.fishingScenePromptDelayMs);
            this.fishingTransitionDelayHandle = window.setTimeout(() => {
                if (this.tutorial.fishingStep !== 'use_rod') return;
                this.setFishingStep('hold_cast', { forceSalmonCatch: true });
            }, this.fishingScenePromptDelayMs);
        };
        this.fishingCastedHandler = () => {
            if (this.tutorial.fishingStep !== 'hold_cast') return;
            this.hideHoldCastPromptWhileHolding = false;
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
            this.hideHoldCastPromptWhileHolding = false;
            if (this.tutorial.fishingStep !== 'stop_fishing') return;
            this.completeFishingGuide();
        };
        this.fishingCastHoldStartedHandler = () => {
            if (this.tutorial.fishingStep !== 'hold_cast') return;
            this.hideHoldCastPromptWhileHolding = true;
            this.uiScene.clearGuideOverlay();
            this.uiScene.clearGuideInputGate();
        };
        this.fishingCastHoldCancelledHandler = () => {
            if (this.tutorial.fishingStep !== 'hold_cast') return;
            this.hideHoldCastPromptWhileHolding = false;
        };
        this.advancementsUpdatedHandler = (event: Event) => {
            const detail = (event as CustomEvent<IAdvancementsState>).detail;
            if (!detail) return;
            this.advancementsSnapshot = detail;
            if (detail.tutorial) {
                this.tutorial = { ...detail.tutorial };
            }
        };
        this.inventoryUpdateHandler = (event: Event) => {
            const detail = (event as CustomEvent<IInventoryResponse>).detail;
            if (!detail) return;
            this.inventorySnapshot = detail;
        };
        this.inventoryConsumedHandler = (event: Event) => {
            const detail = (event as CustomEvent<{ itemId?: string; slotIndex?: number }>).detail;
            if (!detail) return;
            if (this.tutorial.foodStep !== 'consume_quickslot_1') return;
            if (detail.itemId !== 'yekberries') return;
            if (detail.slotIndex !== 0) return;
            this.completeFoodGuide();
        };
        this.foodSelectedHandler = (event: Event) => {
            if (this.tutorial.foodStep !== 'select_berry') return;
            const detail = (event as CustomEvent<{ itemId?: string }>).detail;
            if (detail?.itemId !== 'yekberries') return;
            this.setFoodStep('explain_food_score');
        };
        this.foodEquippedHandler = (event: Event) => {
            if (this.tutorial.foodStep !== 'equip_quickslot_1') return;
            const detail = (event as CustomEvent<{ itemId?: string; slotIndex?: number }>).detail;
            if (detail?.itemId !== 'yekberries') return;
            if (detail?.slotIndex !== 0) return;
            this.setFoodStep('close_inventory');
        };
        this.fishermanInRangeHandler = () => {
            if (this.tutorial.interactionCompleted) return;
            if (this.tutorial.interactionStep === 'idle') {
                this.setInteractionStep('press_interact');
            }
        };
        this.npcInteractHandler = (event: Event) => {
            if (this.tutorial.interactionCompleted || this.tutorial.interactionStep !== 'press_interact') return;
            const detail = (event as CustomEvent<{ npcId?: string }>).detail;
            if (detail?.npcId !== 'fisherman') return;
            this.completeInteractionGuide();
        };

        window.addEventListener('guide:rod-granted-dialogue-complete', this.rodGrantedHandler as EventListener);
        window.addEventListener('gui-open-changed', this.guiChangedHandler as EventListener);
        window.addEventListener('guide:book:tab-changed', this.bookTabChangedHandler as EventListener);
        window.addEventListener('pointerdown', this.finbookPointerDownHandler as EventListener);
        window.addEventListener('guide:book:rod-selected', this.rodSelectedHandler as EventListener);
        window.addEventListener('guide:book:rod-equipped', this.rodEquippedHandler as EventListener);
        window.addEventListener('guide:fishing:entered', this.fishingEnteredHandler as EventListener);
        window.addEventListener('guide:fishing:casted', this.fishingCastedHandler as EventListener);
        window.addEventListener('guide:fishing:bite-started', this.fishingBiteHandler as EventListener);
        window.addEventListener('guide:fishing:caught', this.fishingCaughtHandler as EventListener);
        window.addEventListener('guide:fishing:stopped', this.fishingStoppedHandler as EventListener);
        window.addEventListener('guide:fishing:cast-hold-started', this.fishingCastHoldStartedHandler as EventListener);
        window.addEventListener('guide:fishing:cast-hold-cancelled', this.fishingCastHoldCancelledHandler as EventListener);
        window.addEventListener('advancements:update', this.advancementsUpdatedHandler as EventListener);
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
        window.addEventListener('inventory:consumed', this.inventoryConsumedHandler as EventListener);
        window.addEventListener('guide:book:food-selected', this.foodSelectedHandler as EventListener);
        window.addEventListener('guide:book:food-equipped', this.foodEquippedHandler as EventListener);
        window.addEventListener('guide:interaction:fisherman-in-range', this.fishermanInRangeHandler as EventListener);
        window.addEventListener('npc:interact', this.npcInteractHandler as EventListener);

        void this.networkManager.getInventory().then((inventory) => {
            if (!inventory) return;
            this.inventorySnapshot = inventory;
        });
        this.advancementsSnapshot = this.networkManager.getCachedAdvancementsState();
    }

    update() {
        this.tryReconcileGuideProgressAfterReload();
        this.syncFishingTransitionLock();

        if (!this.tutorial.interactionCompleted && this.tutorial.interactionStep === 'idle') {
            const fishermanInRange = this.uiScene.registry.get('guideFishermanInRange') === true;
            if (fishermanInRange) {
                this.setInteractionStep('press_interact');
            }
        }

        if (!this.tutorial.interactionCompleted && this.tutorial.interactionStep !== 'idle') {
            this.active = true;
            this.renderInteractionStep();
            return;
        }

        if (!this.tutorial.rodCompleted && this.tutorial.rodStep === 'idle' && this.shouldStartRodGuideFromCriteria()) {
            this.setRodStep('open_inventory');
        }

        if (!this.tutorial.rodCompleted && this.tutorial.rodStep !== 'idle') {
            this.active = true;
            this.renderRodStep();
            return;
        }

        if (!this.tutorial.foodCompleted && this.tutorial.foodStep === 'idle' && this.shouldStartFoodGuideFromCriteria()) {
            this.setFoodStep('open_inventory');
        }

        if (!this.tutorial.foodCompleted && this.tutorial.foodStep !== 'idle') {
            this.active = true;
            this.renderFoodStep();
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

        if (!this.tutorial.finbookCompleted) {
            this.tryStartFinbookGuide();
        }

        if (!this.tutorial.finbookCompleted && this.tutorial.finbookStep !== 'idle') {
            this.active = true;
            this.renderFinbookStep();
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
        if (this.foodScoreAdvanceHandle) {
            window.clearTimeout(this.foodScoreAdvanceHandle);
            this.foodScoreAdvanceHandle = undefined;
        }
        if (this.foodDamageIntroHandle) {
            window.clearTimeout(this.foodDamageIntroHandle);
            this.foodDamageIntroHandle = undefined;
        }
        window.removeEventListener('guide:rod-granted-dialogue-complete', this.rodGrantedHandler as EventListener);
        window.removeEventListener('gui-open-changed', this.guiChangedHandler as EventListener);
        window.removeEventListener('guide:book:tab-changed', this.bookTabChangedHandler as EventListener);
        window.removeEventListener('pointerdown', this.finbookPointerDownHandler as EventListener);
        window.removeEventListener('guide:book:rod-selected', this.rodSelectedHandler as EventListener);
        window.removeEventListener('guide:book:rod-equipped', this.rodEquippedHandler as EventListener);
        window.removeEventListener('guide:fishing:entered', this.fishingEnteredHandler as EventListener);
        window.removeEventListener('guide:fishing:casted', this.fishingCastedHandler as EventListener);
        window.removeEventListener('guide:fishing:bite-started', this.fishingBiteHandler as EventListener);
        window.removeEventListener('guide:fishing:caught', this.fishingCaughtHandler as EventListener);
        window.removeEventListener('guide:fishing:stopped', this.fishingStoppedHandler as EventListener);
        window.removeEventListener('guide:fishing:cast-hold-started', this.fishingCastHoldStartedHandler as EventListener);
        window.removeEventListener('guide:fishing:cast-hold-cancelled', this.fishingCastHoldCancelledHandler as EventListener);
        window.removeEventListener('advancements:update', this.advancementsUpdatedHandler as EventListener);
        window.removeEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
        window.removeEventListener('inventory:consumed', this.inventoryConsumedHandler as EventListener);
        window.removeEventListener('guide:book:food-selected', this.foodSelectedHandler as EventListener);
        window.removeEventListener('guide:book:food-equipped', this.foodEquippedHandler as EventListener);
        window.removeEventListener('guide:interaction:fisherman-in-range', this.fishermanInRangeHandler as EventListener);
        window.removeEventListener('npc:interact', this.npcInteractHandler as EventListener);
        this.setFishingTransitionLock(false);
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

    private tryStartFinbookGuide() {
        if (this.tutorial.finbookStep !== 'idle') return;
        if (!this.isAnchorHollowMap()) return;

        if (this.tutorial.finbookAnchorEnteredAt === null) {
            const enteredAt = Date.now();
            this.tutorial.finbookAnchorEnteredAt = enteredAt;
            this.tutorial.updatedAt = enteredAt;
            this.networkManager.sendGuideTutorialUpdate({ finbookAnchorEnteredAt: enteredAt });
        }

        if (!this.tutorial.fishingCompleted) return;

        const fishingQuestCompletedAt = this.getFishingQuestCompletedAt();
        if (fishingQuestCompletedAt === null) return;

        const eligibleAt = Math.max(
            this.tutorial.finbookAnchorEnteredAt ?? 0,
            fishingQuestCompletedAt + this.finbookGuideQuestDelayMs
        );
        if (Date.now() < eligibleAt) return;

        this.setFinbookStep('open_inventory');
    }

    private renderFinbookStep() {
        const inventoryKey = this.keybindManager.getDisplayLabel('inventory');
        const inventoryTriggerRect = this.uiScene.getGuideInventoryTriggerRect();
        const isBookOpen = this.uiScene.isGuideBookOpen();
        const isFinbookTabActive = this.uiScene.isGuideFinbookTabActive();

        if (!isBookOpen && this.tutorial.finbookStep !== 'open_inventory') {
            this.setFinbookStep('open_inventory');
            return;
        }

        if (!isFinbookTabActive && this.tutorial.finbookStep !== 'open_inventory' && this.tutorial.finbookStep !== 'open_finbook_tab' && this.tutorial.finbookStep !== 'close_inventory') {
            this.setFinbookStep('open_finbook_tab');
            return;
        }

        if (this.tutorial.finbookStep === 'open_inventory') {
            if (isBookOpen) {
                this.setFinbookStep('open_finbook_tab');
                return;
            }
            this.showStep(
                inventoryTriggerRect
                    ? this.localeManager.t('guide.finbook.openInventoryMobile', undefined, 'The Finbook is your place to find quests, achievements, and more. Click the inventory button or press "E" to get started.')
                    : this.localeManager.t('guide.finbook.openInventory', { key: inventoryKey }, `The Finbook is your place to find quests, achievements, and more. Open your inventory (press ${inventoryKey}) to get started.`),
                inventoryTriggerRect,
                ['inventory']
            );
            return;
        }

        if (this.tutorial.finbookStep === 'open_finbook_tab') {
            if (isFinbookTabActive) {
                this.setFinbookStep('show_completed_quest');
                return;
            }
            this.showStep(
                this.localeManager.t('guide.finbook.openTab', undefined, 'Click the "Finbook" tab'),
                this.uiScene.getGuideFinbookTabRect(),
                []
            );
            return;
        }

        if (this.tutorial.finbookStep === 'show_completed_quest') {
            this.showStep(
                this.localeManager.t('guide.finbook.completedQuest', undefined, 'Grayed out quests are ones you\'ve already finished. (Click anywhere to continue)'),
                this.uiScene.getGuideFinbookCompletedQuestRect(),
                [],
                null,
                true,
                true
            );
            return;
        }

        if (this.tutorial.finbookStep === 'show_main_quest') {
            this.showStep(
                this.localeManager.t('guide.finbook.mainQuest', undefined, 'Quests with a star are main quests. You must complete them to progress. (Click anywhere to continue)'),
                this.uiScene.getGuideFinbookTopMainQuestRect(),
                [],
                null,
                true,
                true
            );
            return;
        }

        if (this.tutorial.finbookStep === 'show_title') {
            this.showStep(
                this.localeManager.t('guide.finbook.title', undefined, 'This is the quest title. (Click anywhere to continue)'),
                this.uiScene.getGuideFinbookQuestTitleRect(),
                [],
                null,
                true,
                true
            );
            return;
        }

        if (this.tutorial.finbookStep === 'show_status') {
            this.showStep(
                this.localeManager.t('guide.finbook.status', undefined, 'This tells you whether you\'ve already made progress on this quest or not. (Click anywhere to continue)'),
                this.uiScene.getGuideFinbookQuestStatusRect(),
                [],
                null,
                true,
                true
            );
            return;
        }

        if (this.tutorial.finbookStep === 'show_objective') {
            this.showStep(
                this.localeManager.t('guide.finbook.objective', undefined, 'This tells you what you need to do next. (Click anywhere to continue)'),
                this.uiScene.getGuideFinbookObjectiveLabelRect(),
                [],
                this.uiScene.getGuideFinbookObjectiveCardRect(),
                true,
                true
            );
            return;
        }

        if (this.tutorial.finbookStep === 'show_track_button') {
            this.showStep(
                this.localeManager.t('guide.finbook.trackButton', undefined, 'You can track a quest at any time to get help finding the next objective. (Click anywhere to continue)'),
                this.uiScene.getGuideFinbookTrackButtonRect(),
                [],
                null,
                true,
                true
            );
            return;
        }

        if (this.tutorial.finbookStep === 'close_inventory') {
            this.showStep(
                inventoryTriggerRect
                    ? this.localeManager.t('guide.finbook.closeInventoryMobile', undefined, 'Once again, click the inventory button or press E to exit')
                    : this.localeManager.t('guide.finbook.closeInventory', { key: inventoryKey }, `Click the inventory button or press ${inventoryKey} to exit`),
                inventoryTriggerRect,
                ['inventory']
            );
        }
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
            if (this.hideHoldCastPromptWhileHolding) {
                this.uiScene.clearGuideOverlay();
                this.uiScene.clearGuideInputGate();
                return;
            }
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

    private renderFoodStep() {
        const inventoryKey = this.keybindManager.getDisplayLabel('inventory');
        const inventoryTriggerRect = this.uiScene.getGuideInventoryTriggerRect();

        if (this.tutorial.foodStep === 'open_inventory') {
            this.showStep(
                inventoryTriggerRect
                    ? this.localeManager.t('guide.food.openInventoryMobile', undefined, 'Open your inventory to get your berry ready.')
                    : this.localeManager.t('guide.food.openInventory', { key: inventoryKey }, `Open your inventory (press ${inventoryKey} on desktop).`),
                inventoryTriggerRect,
                ['inventory']
            );
            return;
        }

        if (this.tutorial.foodStep === 'select_berry') {
            this.showStep(
                this.localeManager.t('guide.food.selectBerry', undefined, 'Click the yekberries in your inventory.'),
                this.uiScene.getGuideBerryInventoryRect(),
                []
            );
            return;
        }

        if (this.tutorial.foodStep === 'explain_food_score') {
            this.showStep(
                this.localeManager.t('guide.food.explainScore', undefined, 'That red +20 is the food score. In this basic form, yekberries only heal about 1 out of 5 uses.'),
                this.uiScene.getGuideFoodScoreRect() ?? this.uiScene.getGuideBerryInventoryRect(),
                []
            );
            if (!this.foodScoreAdvanceHandle) {
                this.foodScoreAdvanceHandle = window.setTimeout(() => {
                    this.foodScoreAdvanceHandle = undefined;
                    if (this.tutorial.foodStep !== 'explain_food_score') return;
                    this.setFoodStep('equip_quickslot_1');
                }, 5000);
            }
            return;
        }

        if (this.tutorial.foodStep === 'equip_quickslot_1') {
            this.showStep(
                this.localeManager.t('guide.food.equipQuickslot1', undefined, 'Move the yekberries into quick slot 1 on the right.'),
                this.uiScene.getGuideUsableEquipRect(0),
                []
            );
            return;
        }

        if (this.tutorial.foodStep === 'close_inventory') {
            this.showStep(
                inventoryTriggerRect
                    ? this.localeManager.t('guide.food.closeInventoryMobile', undefined, 'Close your inventory to try the quick slot.')
                    : this.localeManager.t('guide.food.closeInventory', { key: inventoryKey }, `Close your inventory (press ${inventoryKey} on desktop).`),
                inventoryTriggerRect,
                ['inventory']
            );
            return;
        }

        if (this.tutorial.foodStep === 'consume_quickslot_1') {
            if (!this.simulatedFoodDamage) {
                this.simulatedFoodDamage = true;
                this.networkManager.sendGuideTutorialStab();
            }
            if (!this.foodDamageIntroDone) {
                if (!this.foodDamageIntroHandle) {
                    this.foodDamageIntroHandle = window.setTimeout(() => {
                        this.foodDamageIntroHandle = undefined;
                        this.foodDamageIntroDone = true;
                    }, 4000);
                }
                this.showStep(
                    this.localeManager.t('guide.food.stabHeartLoss', undefined, "STAB! You just lost a heart! Now we'll use the berry to heal up."),
                    null,
                    [],
                    this.uiScene.getGuideHeartsRect(),
                    true,
                    false,
                    null,
                    'center'
                );
                return;
            }
            if (!this.tutorial.forceFoodGuideHeal) {
                this.tutorial.forceFoodGuideHeal = true;
                this.networkManager.sendGuideTutorialUpdate({ forceFoodGuideHeal: true });
            }

            this.showStep(
                this.localeManager.t('guide.food.consumeQuickslot1', undefined, 'Now click quick slot 1 to eat. This tutorial forces a heal so you can see it, but +20 food score normally means about a 1/5 chance.'),
                this.uiScene.getGuideHudQuickSlotRect(0),
                [],
                null,
                true,
                false,
                0
            );
        }
    }

    private renderInteractionStep() {
        if (this.tutorial.interactionStep !== 'press_interact') return;
        const fishermanInRange = this.uiScene.registry.get('guideFishermanInRange') === true;
        if (!fishermanInRange) {
            this.uiScene.clearGuideOverlay();
            this.uiScene.clearGuideInputGate();
            return;
        }

        const interactRect = this.uiScene.getGuideInteractTriggerRect();
        if (!interactRect) {
            // Keep movement available if the interact button is not currently visible.
            this.uiScene.clearGuideOverlay();
            this.uiScene.clearGuideInputGate();
            return;
        }

        this.showStep(
            this.localeManager.t(
                'guide.interaction.useInteract',
                undefined,
                'Use this interact button for most world and character interactions.'
            ),
            interactRect,
            ['interact']
        );
    }

    private showStep(
        message: string,
        targetRect: Phaser.Geom.Rectangle | null,
        allowedActions: ControlActionKey[],
        secondaryVisibleRect: Phaser.Geom.Rectangle | null = null,
        dimBackground = true,
        allowAllInput = false,
        allowedUsableSlotIndex: number | null = null,
        cardPlacement: 'bottom' | 'center' = 'bottom'
    ) {
        this.uiScene.showGuideOverlay({
            message,
            targetRect,
            secondaryVisibleRect,
            dimBackground,
            cardPlacement
        });
        if (allowAllInput) {
            this.uiScene.clearGuideInputGate();
            return;
        }
        this.uiScene.applyGuideInputGate({
            allowedActions,
            allowedPointerRect: targetRect ?? secondaryVisibleRect,
            allowedUsableSlotIndex
        });
    }

    private completeRodGuide() {
        this.tutorial.rodCompleted = true;
        this.tutorial.rodStep = 'completed';
        this.tutorial.updatedAt = Date.now();
        this.waitingForFishingGuide = false;
        this.fishingGuideEligibleAt = Date.now() + this.fishingGuideStartDelayMs;
        this.syncFishingTransitionLock();
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
        this.setFishingTransitionLock(false);
        this.tutorial.updatedAt = Date.now();
        this.networkManager.sendGuideTutorialUpdate({
            fishingCompleted: true,
            fishingStep: 'completed',
            forceSalmonCatch: false
        });
        this.uiScene.clearGuideOverlay();
        this.uiScene.clearGuideInputGate();
    }

    private completeFoodGuide() {
        this.tutorial.foodCompleted = true;
        this.tutorial.foodStep = 'completed';
        this.tutorial.forceFoodGuideHeal = false;
        this.tutorial.updatedAt = Date.now();
        this.simulatedFoodDamage = false;
        this.foodDamageIntroDone = false;
        if (this.foodDamageIntroHandle) {
            window.clearTimeout(this.foodDamageIntroHandle);
            this.foodDamageIntroHandle = undefined;
        }
        if (this.foodScoreAdvanceHandle) {
            window.clearTimeout(this.foodScoreAdvanceHandle);
            this.foodScoreAdvanceHandle = undefined;
        }
        this.networkManager.sendGuideTutorialUpdate({
            foodCompleted: true,
            foodStep: 'completed',
            forceFoodGuideHeal: false
        });
        this.uiScene.clearGuideOverlay();
        this.uiScene.clearGuideInputGate();
    }

    private completeInteractionGuide() {
        this.tutorial.interactionCompleted = true;
        this.tutorial.interactionStep = 'completed';
        this.tutorial.updatedAt = Date.now();
        this.networkManager.sendGuideTutorialUpdate({
            interactionCompleted: true,
            interactionStep: 'completed'
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
        this.syncFishingTransitionLock();
        this.tutorial.updatedAt = Date.now();
        if (extra?.forceSalmonCatch !== undefined) {
            this.tutorial.forceSalmonCatch = extra.forceSalmonCatch;
        }
        this.networkManager.sendGuideTutorialUpdate({
            fishingStep: step,
            ...(extra ?? {})
        });
    }

    private setFoodStep(step: IGuideTutorialState['foodStep']) {
        if (this.foodScoreAdvanceHandle) {
            window.clearTimeout(this.foodScoreAdvanceHandle);
            this.foodScoreAdvanceHandle = undefined;
        }
        if (step !== 'consume_quickslot_1') {
            this.foodDamageIntroDone = false;
            if (this.foodDamageIntroHandle) {
                window.clearTimeout(this.foodDamageIntroHandle);
                this.foodDamageIntroHandle = undefined;
            }
        }
        this.tutorial.foodStep = step;
        this.tutorial.updatedAt = Date.now();
        this.networkManager.sendGuideTutorialUpdate({ foodStep: step });
    }

    private setInteractionStep(step: IGuideTutorialState['interactionStep']) {
        this.tutorial.interactionStep = step;
        this.tutorial.updatedAt = Date.now();
        this.networkManager.sendGuideTutorialUpdate({ interactionStep: step });
    }

    private setFinbookStep(step: IGuideTutorialState['finbookStep']) {
        this.tutorial.finbookStep = step;
        this.tutorial.updatedAt = Date.now();
        this.finbookClickAdvanceReadyAt = Date.now() + this.finbookAdvanceDebounceMs;
        this.networkManager.sendGuideTutorialUpdate({ finbookStep: step });
    }

    private completeFinbookGuide() {
        this.tutorial.finbookCompleted = true;
        this.tutorial.finbookStep = 'completed';
        this.tutorial.updatedAt = Date.now();
        this.networkManager.sendGuideTutorialUpdate({
            finbookCompleted: true,
            finbookStep: 'completed'
        });
        this.uiScene.clearGuideOverlay();
        this.uiScene.clearGuideInputGate();
    }

    private isFinbookClickAdvanceStep(step: IGuideTutorialState['finbookStep']) {
        return step === 'show_completed_quest'
            || step === 'show_main_quest'
            || step === 'show_title'
            || step === 'show_status'
            || step === 'show_objective'
            || step === 'show_track_button';
    }

    private advanceFinbookClickStep(step: IGuideTutorialState['finbookStep']) {
        if (step === 'show_completed_quest') {
            this.setFinbookStep('show_main_quest');
            return;
        }
        if (step === 'show_main_quest') {
            this.setFinbookStep('show_title');
            return;
        }
        if (step === 'show_title') {
            this.setFinbookStep('show_status');
            return;
        }
        if (step === 'show_status') {
            this.setFinbookStep('show_objective');
            return;
        }
        if (step === 'show_objective') {
            this.setFinbookStep('show_track_button');
            return;
        }
        if (step === 'show_track_button') {
            this.setFinbookStep('close_inventory');
        }
    }

    private isAnchorHollowMap() {
        return this.uiScene.getGuideCurrentMapFile().startsWith('anchor-hollow');
    }

    private getFishingQuestCompletedAt(): number | null {
        const completedAt = this.advancementsSnapshot?.questProgress?.first_catch?.completedAt;
        if (typeof completedAt === 'number' && Number.isFinite(completedAt) && completedAt > 0) {
            return completedAt;
        }
        return null;
    }

    private tryReconcileGuideProgressAfterReload() {
        if (this.startupReconciled) return;
        const inventory = this.inventorySnapshot;
        const advancements = this.advancementsSnapshot;
        if (!inventory) return;

        const guiOpen = this.uiScene.registry.get('guiOpen') === true;
        const antiDeathQuest = advancements?.questProgress?.anti_death_measures;
        const antiDeathCompleted = typeof antiDeathQuest?.completedAt === 'number' && antiDeathQuest.completedAt > 0;
        const hasGuideRod = inventory.slots?.some((slot) => slot.itemId === 'rickety_rod' && slot.count > 0) ?? false;
        const rodEquipped = Boolean(inventory.equippedRodId);
        const hasBerryInSlots = inventory.slots?.some((slot) => slot.itemId === 'yekberries' && slot.count > 0) ?? false;
        const hasBerryEquippedAny = Array.isArray(inventory.equippedUsableIds)
            && inventory.equippedUsableIds.some((itemId) => itemId === 'yekberries');
        const hasBerryInQuickSlot1 = (inventory.equippedUsableIds?.[0] ?? null) === 'yekberries';

        const update: Partial<IGuideTutorialState> = {};
        let changed = false;

        if (!this.tutorial.interactionCompleted) {
            if (this.tutorial.interactionStep === 'completed') {
                this.tutorial.interactionCompleted = true;
                update.interactionCompleted = true;
                changed = true;
            } else if (this.tutorial.interactionStep !== 'idle') {
                this.tutorial.interactionStep = 'idle';
                update.interactionStep = 'idle';
                changed = true;
            }
        }
        if (this.tutorial.interactionCompleted && this.tutorial.interactionStep !== 'completed') {
            this.tutorial.interactionStep = 'completed';
            update.interactionStep = 'completed';
            changed = true;
        }

        if (!this.tutorial.rodCompleted) {
            let rodStepTarget: IGuideTutorialState['rodStep'] = 'idle';
            let rodCompletedTarget = false;
            if (rodEquipped) {
                if (guiOpen) {
                    rodStepTarget = 'close_inventory';
                } else {
                    rodStepTarget = 'completed';
                    rodCompletedTarget = true;
                }
            } else if (hasGuideRod) {
                rodStepTarget = guiOpen ? 'select_rod' : 'open_inventory';
            }

            if (rodCompletedTarget) {
                this.tutorial.rodCompleted = true;
                update.rodCompleted = true;
                this.waitingForFishingGuide = false;
                this.fishingGuideEligibleAt = Date.now() + this.fishingGuideStartDelayMs;
                changed = true;
            }
            if (this.tutorial.rodStep !== rodStepTarget) {
                this.tutorial.rodStep = rodStepTarget;
                update.rodStep = rodStepTarget;
                changed = true;
            }
        }
        if (this.tutorial.rodCompleted && this.tutorial.rodStep !== 'completed') {
            this.tutorial.rodStep = 'completed';
            update.rodStep = 'completed';
            changed = true;
        }

        if (!this.tutorial.foodCompleted) {
            let foodStepTarget: IGuideTutorialState['foodStep'] = 'idle';
            if (antiDeathCompleted && (hasBerryInSlots || hasBerryEquippedAny)) {
                if (hasBerryInQuickSlot1) {
                    foodStepTarget = guiOpen ? 'close_inventory' : 'consume_quickslot_1';
                } else if (hasBerryEquippedAny) {
                    foodStepTarget = guiOpen ? 'equip_quickslot_1' : 'open_inventory';
                } else {
                    foodStepTarget = guiOpen ? 'select_berry' : 'open_inventory';
                }
            }

            if (this.tutorial.foodStep === 'completed') {
                this.tutorial.foodCompleted = true;
                update.foodCompleted = true;
                foodStepTarget = 'completed';
                changed = true;
            }

            if (this.tutorial.foodStep !== foodStepTarget) {
                this.tutorial.foodStep = foodStepTarget;
                update.foodStep = foodStepTarget;
                changed = true;
            }
        }
        if (this.tutorial.foodCompleted && this.tutorial.foodStep !== 'completed') {
            this.tutorial.foodStep = 'completed';
            update.foodStep = 'completed';
            changed = true;
        }

        if (!this.tutorial.fishingCompleted) {
            if (this.tutorial.fishingStep === 'completed') {
                this.tutorial.fishingCompleted = true;
                update.fishingCompleted = true;
                changed = true;
            } else if (this.tutorial.fishingStep !== 'idle') {
                this.tutorial.fishingStep = 'idle';
                update.fishingStep = 'idle';
                changed = true;
            }
        }
        if (this.tutorial.fishingCompleted && this.tutorial.fishingStep !== 'completed') {
            this.tutorial.fishingStep = 'completed';
            update.fishingStep = 'completed';
            changed = true;
        }

        if (!this.tutorial.finbookCompleted) {
            if (this.tutorial.finbookStep === 'completed') {
                this.tutorial.finbookCompleted = true;
                update.finbookCompleted = true;
                changed = true;
            } else if (this.tutorial.finbookStep !== 'idle') {
                this.tutorial.finbookStep = 'idle';
                update.finbookStep = 'idle';
                changed = true;
            }
        }
        if (this.tutorial.finbookCompleted && this.tutorial.finbookStep !== 'completed') {
            this.tutorial.finbookStep = 'completed';
            update.finbookStep = 'completed';
            changed = true;
        }

        if (this.tutorial.forceSalmonCatch) {
            this.tutorial.forceSalmonCatch = false;
            update.forceSalmonCatch = false;
            changed = true;
        }

        if (this.tutorial.forceFoodGuideHeal) {
            this.tutorial.forceFoodGuideHeal = false;
            update.forceFoodGuideHeal = false;
            changed = true;
        }

        this.startupReconciled = true;
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

    private shouldStartFoodGuideFromCriteria() {
        if (this.tutorial.foodCompleted) return false;
        const advancements = this.advancementsSnapshot;
        const quest = advancements?.questProgress?.anti_death_measures;
        const antiDeathCompleted = typeof quest?.completedAt === 'number' && quest.completedAt > 0;
        if (!antiDeathCompleted) return false;

        const inventory = this.inventorySnapshot;
        if (!inventory) return false;

        const hasBerryInSlots = inventory.slots?.some((slot) => slot.itemId === 'yekberries' && slot.count > 0) ?? false;
        const hasBerryEquipped = Array.isArray(inventory.equippedUsableIds)
            && inventory.equippedUsableIds.some((itemId) => itemId === 'yekberries');
        return hasBerryInSlots || hasBerryEquipped;
    }

    private beginFishingTransition(durationMs: number) {
        this.suppressFishingOverlayUntil = Date.now() + durationMs;
        this.uiScene.clearGuideOverlay();
        this.uiScene.clearGuideInputGate();
    }

    private syncFishingTransitionLock() {
        const shouldLock = this.tutorial.rodCompleted
            && !this.tutorial.fishingCompleted
            && this.tutorial.fishingStep === 'idle';
        this.setFishingTransitionLock(shouldLock);
    }

    private setFishingTransitionLock(locked: boolean) {
        if (this.fishingTransitionLockActive === locked) return;
        this.fishingTransitionLockActive = locked;
        this.uiScene.registry.set('guideFishingTransitionLock', locked);
    }
}
