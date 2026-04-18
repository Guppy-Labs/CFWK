import type {
    DialogueData,
    DialogueRenderLine,
    DialogueEmotion,
    DialogueAction,
    DialogueCheck,
    DialogueFork,
    DialogueLine,
    DialogueOption,
    DialogueOptionBranch
} from './DialogueTypes';
import { DialogueRepository } from './DialogueRepository';
import type { UIScene } from '../scenes/UIScene';
import type { GameScene } from '../scenes/GameScene';
import { NetworkManager } from '../network/NetworkManager';
import type { IAdvancementsState, IInventoryResponse } from '@cfwk/shared';
import { LocaleManager } from '../i18n/LocaleManager';

type NpcInteractionDetail = {
    npcId: string;
    npcName?: string;
};

type ForcedDialogueDetail = {
    npcId?: string;
    npcName?: string;
    lines?: DialogueLine[];
};

export class DialogueManager {
    private repository = new DialogueRepository();
    private networkManager = NetworkManager.getInstance();
    private localeManager = LocaleManager.getInstance();
    private currentDialogue?: DialogueData;
    private currentIndex = 0;
    private active = false;
    private npcId?: string;
    private npcName?: string;
    private pendingActions: DialogueAction[] = [];
    private inventorySnapshot?: IInventoryResponse | null;
    private hasShownLine = false;
    private grantedRodDuringDialogue = false;

    private npcInteractHandler?: (event: Event) => void;
    private inventoryUpdateHandler?: (event: Event) => void;
    private forcedDialogueHandler?: (event: Event) => void;
    private suppressNpcInteractSend = false;

    constructor(private readonly gameScene: GameScene, private readonly uiScene: UIScene) {
        this.npcInteractHandler = (event: Event) => {
            const detail = (event as CustomEvent<NpcInteractionDetail>).detail;
            if (!detail?.npcId) return;
            void this.startDialogue(detail.npcId, detail.npcName);
        };
        window.addEventListener('npc:interact', this.npcInteractHandler as EventListener);

        this.forcedDialogueHandler = (event: Event) => {
            const detail = (event as CustomEvent<ForcedDialogueDetail>).detail;
            if (!detail || !Array.isArray(detail.lines) || detail.lines.length === 0) return;
            void this.startForcedDialogue(detail);
        };
        window.addEventListener('dialogue:forced', this.forcedDialogueHandler as EventListener);

        this.inventoryUpdateHandler = (event: Event) => {
            const customEvent = event as CustomEvent<IInventoryResponse>;
            this.inventorySnapshot = customEvent.detail;
        };
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);

        this.uiScene.setDialogueAdvanceHandler(() => {
            void this.advance();
        });
        this.uiScene.setDialogueOptionHandler((optionId: string) => {
            void this.selectOption(optionId);
        });
    }

    destroy() {
        if (this.npcInteractHandler) {
            window.removeEventListener('npc:interact', this.npcInteractHandler as EventListener);
            this.npcInteractHandler = undefined;
        }
        if (this.forcedDialogueHandler) {
            window.removeEventListener('dialogue:forced', this.forcedDialogueHandler as EventListener);
            this.forcedDialogueHandler = undefined;
        }
        if (this.inventoryUpdateHandler) {
            window.removeEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
            this.inventoryUpdateHandler = undefined;
        }
    }

    private async startDialogue(npcId: string, npcName?: string) {
        if (this.active) return;

        const dialogue = await this.repository.getDialogue(npcId);
        if (!dialogue) return;

        const resolved = await this.resolveDialogue(dialogue);
        if (!resolved.lines.length) return;

        this.currentDialogue = { ...dialogue, lines: this.cloneLines(resolved.lines) };
        this.pendingActions = this.cloneActions(resolved.actions);
        this.currentIndex = 0;
        this.active = true;
        this.npcId = npcId;
        this.npcName = npcName;
        this.hasShownLine = false;
        this.grantedRodDuringDialogue = false;
        this.suppressNpcInteractSend = false;

        this.enterDialogueMode();
        this.renderCurrentLine();
    }

    private async startForcedDialogue(detail: ForcedDialogueDetail) {
        if (this.active) return;

        const npcId = typeof detail.npcId === 'string' && detail.npcId.trim().length > 0 ? detail.npcId : 'guard';
        const lines = this.cloneLines(detail.lines ?? []);
        if (lines.length === 0) return;

        this.currentDialogue = { id: `forced:${npcId}`, lines };
        this.pendingActions = [];
        this.currentIndex = 0;
        this.active = true;
        this.npcId = npcId;
        this.npcName = detail.npcName;
        this.hasShownLine = false;
        this.grantedRodDuringDialogue = false;
        this.suppressNpcInteractSend = true;

        this.enterDialogueMode();
        this.renderCurrentLine();
    }

    private enterDialogueMode() {
        const focusPoint = this.getFocusPoint();
        this.gameScene.setDialogueActive(true, focusPoint ?? undefined);
        this.uiScene.setDialogueActive(true);
    }

    private exitDialogueMode() {
        const completedNpcId = this.npcId;

        this.gameScene.setDialogueActive(false);
        this.gameScene.setInteractionCooldown(250);
        this.uiScene.setDialogueActive(false);
        this.currentDialogue = undefined;
        this.currentIndex = 0;
        this.active = false;
        this.npcId = undefined;
        this.npcName = undefined;
        this.pendingActions = [];
        this.hasShownLine = false;
        const shouldSendNpcInteract = !this.suppressNpcInteractSend;
        this.suppressNpcInteractSend = false;

        if (completedNpcId && this.grantedRodDuringDialogue) {
            window.dispatchEvent(new CustomEvent('guide:rod-granted-dialogue-complete', {
                detail: {
                    npcId: completedNpcId,
                    itemId: 'rickety_rod'
                }
            }));
        }
        this.grantedRodDuringDialogue = false;

        if (completedNpcId && shouldSendNpcInteract) {
            this.networkManager.sendNpcInteract(completedNpcId);
        }
    }

    private getFocusPoint() {
        const player = this.gameScene.getPlayerPosition();
        const npc = this.npcId ? this.gameScene.getNpcPosition(this.npcId) : null;
        if (player && npc) {
            return {
                x: Math.round((player.x + npc.x) / 2),
                y: Math.round((player.y + npc.y) / 2)
            };
        }
        return npc ?? player ?? null;
    }

    private renderCurrentLine() {
        if (!this.currentDialogue) return;
        const lines = this.currentDialogue.lines ?? [];
        const line = lines[this.currentIndex];
        if (!line) return;

        const speaker = line.speaker;
        const npcInfo = this.npcId ? this.gameScene.getNpcPosition(this.npcId) : null;
        const npcNameFallback = this.npcName ?? npcInfo?.name ?? this.localeManager.t('dialogue.unknownSpeaker', undefined, '???');
        const defaultSpeakerName = speaker === 'npc'
            ? (this.npcId ? this.localeManager.t(`npc.${this.npcId}.name`, undefined, npcNameFallback) : npcNameFallback)
            : this.localeManager.t('dialogue.playerName', undefined, 'You');
        const rawName = line.nameKey
            ? this.localeManager.t(line.nameKey, undefined, line.name ?? defaultSpeakerName)
            : (line.name ?? defaultSpeakerName);
        const localizedText = line.textKey
            ? this.localeManager.t(line.textKey, undefined, line.text)
            : line.text;
        const emotion = (line.emotion ?? (speaker === 'npc' ? 'happy' : 'happy')) as DialogueEmotion;
        const options = line.options?.map((option) => ({
            id: option.id,
            text: option.textKey
                ? this.localeManager.t(option.textKey, undefined, option.text)
                : option.text
        }));

        const renderLine: DialogueRenderLine = {
            speaker,
            name: rawName,
            text: localizedText,
            emotion,
            npcId: speaker === 'npc' ? this.npcId : undefined,
            options,
            hideSpeakerVisuals: line.hideSpeakerVisuals ?? Boolean(line.options && line.options.length > 0)
        };

        if (line.shake === 'mild') {
            this.gameScene.cameras.main.shake(180, 0.0025);
        }

        if (this.hasShownLine) {
            this.playDialogueNext();
        }
        this.hasShownLine = true;
        this.uiScene.showDialogueLine(renderLine);
    }

    private async resolveDialogue(dialogue: DialogueData): Promise<{ lines: DialogueLine[]; actions: DialogueAction[] }> {
        if (dialogue.forks && dialogue.forks.length > 0) {
            for (const fork of dialogue.forks) {
                const passed = await this.checkFork(fork);
                if (passed) {
                    let lines = fork.lines ?? [];
                    if (fork.randomLines && fork.randomLines.length > 0) {
                        const pick = fork.randomLines[Math.floor(Math.random() * fork.randomLines.length)];
                        lines = pick ?? lines;
                    }
                    return {
                        lines,
                        actions: fork.actions ?? dialogue.actions ?? []
                    };
                }
            }
        }

        return {
            lines: dialogue.lines ?? [],
            actions: dialogue.actions ?? []
        };
    }

    private async checkFork(fork: DialogueFork): Promise<boolean> {
        if (!fork.checks || fork.checks.length === 0) return true;
        for (const check of fork.checks) {
            const passed = await this.evaluateCheck(check);
            if (!passed) return false;
        }
        return true;
    }

    private async evaluateCheck(check: DialogueCheck): Promise<boolean> {
        if (check.type === 'hasItem') {
            const hasItem = await this.hasInventoryItem(check.itemId);
            return check.negate ? !hasItem : hasItem;
        }

        if (check.type === 'questObjective') {
            const matches = await this.matchesQuestObjectiveCheck(check);
            return check.negate ? !matches : matches;
        }

        return false;
    }

    private async matchesQuestObjectiveCheck(check: Extract<DialogueCheck, { type: 'questObjective' }>): Promise<boolean> {
        const advancements = await this.getAdvancementsSnapshot();
        if (!advancements) return false;

        const progress = advancements.questProgress[check.questId];
        if (!progress) return false;

        if (check.status && progress.status !== check.status) {
            return false;
        }

        if (typeof check.objectiveIndex === 'number') {
            const objectiveIndex = typeof progress.objectiveIndex === 'number'
                ? Math.max(0, Math.floor(progress.objectiveIndex))
                : 0;
            if (objectiveIndex !== Math.max(0, Math.floor(check.objectiveIndex))) {
                return false;
            }
        }

        return true;
    }

    private async getAdvancementsSnapshot(): Promise<IAdvancementsState | null> {
        // Force a fresh state pull so dialogue forks reflect very recent quest transitions
        // (e.g. talk to Wise Man, then immediately talk to Sea Master).
        return this.networkManager.awaitAdvancementsState(1200, true);
    }

    private async checkOptionBranch(branch: DialogueOptionBranch): Promise<boolean> {
        if (!branch.checks || branch.checks.length === 0) return true;
        for (const check of branch.checks) {
            const passed = await this.evaluateCheck(check);
            if (!passed) return false;
        }
        return true;
    }

    private async resolveOption(option: DialogueOption): Promise<{ lines: DialogueLine[]; actions: DialogueAction[] }> {
        if (option.branches && option.branches.length > 0) {
            for (const branch of option.branches) {
                const passed = await this.checkOptionBranch(branch);
                if (passed) {
                    return {
                        lines: branch.lines ?? option.lines ?? [],
                        actions: branch.actions ?? option.actions ?? []
                    };
                }
            }
        }

        return {
            lines: option.lines ?? [],
            actions: option.actions ?? []
        };
    }

    private cloneLines(lines: DialogueLine[]): DialogueLine[] {
        return lines.map((line) => ({
            ...line,
            options: line.options?.map((option) => ({
                ...option,
                lines: option.lines ? this.cloneLines(option.lines) : undefined,
                actions: option.actions ? this.cloneActions(option.actions) : undefined,
                branches: option.branches?.map((branch) => ({
                    ...branch,
                    checks: branch.checks ? branch.checks.map((check) => ({ ...check })) : undefined,
                    lines: branch.lines ? this.cloneLines(branch.lines) : undefined,
                    actions: branch.actions ? this.cloneActions(branch.actions) : undefined
                }))
            }))
        }));
    }

    private cloneActions(actions: DialogueAction[]): DialogueAction[] {
        return actions.map((action) => ({ ...action }));
    }

    private async selectOption(optionId: string) {
        if (!this.active || !this.currentDialogue) return;
        const lines = this.currentDialogue.lines ?? [];
        const line = lines[this.currentIndex];
        if (!line?.options || line.options.length === 0) return;

        const selected = line.options.find((option) => option.id === optionId);
        if (!selected) return;

        const selectedText = selected.textKey
            ? this.localeManager.t(selected.textKey, undefined, selected.text)
            : selected.text;

        lines[this.currentIndex] = {
            ...line,
            text: selectedText,
            textKey: undefined,
            options: undefined,
            hideSpeakerVisuals: false
        };

        const resolved = await this.resolveOption(selected);
        if (resolved.lines.length > 0) {
            lines.splice(this.currentIndex + 1, 0, ...resolved.lines);
        }
        if (resolved.actions.length > 0) {
            this.pendingActions.push(...resolved.actions);
        }

        this.renderCurrentLine();
    }

    private async hasInventoryItem(itemId: string): Promise<boolean> {
        const inventory = await this.getInventorySnapshot();
        if (!inventory?.slots) return false;
        if (this.hasEquippedItem(inventory, itemId)) return true;
        return inventory.slots.some((slot) => slot.itemId === itemId && slot.count > 0);
    }

    private hasEquippedItem(inventory: IInventoryResponse, itemId: string): boolean {
        return Object.entries(inventory).some(([key, value]) => {
            if (!key.toLowerCase().includes('equipped')) return false;
            return typeof value === 'string' && value === itemId;
        });
    }

    private async getInventorySnapshot(): Promise<IInventoryResponse | null> {
        if (this.inventorySnapshot) return this.inventorySnapshot;
        this.inventorySnapshot = await this.networkManager.getInventory();
        return this.inventorySnapshot ?? null;
    }

    private async executeActions(): Promise<DialogueAction[]> {
        const deferred: DialogueAction[] = [];
        if (this.pendingActions.length === 0) return deferred;
        for (const action of this.pendingActions) {
            if (action.type === 'giveItem') {
                await this.giveItem(action);
            } else if (action.type === 'openShop') {
                deferred.push(action);
            }
        }
        return deferred;
    }

    private openShop(shopId: string) {
        window.dispatchEvent(new CustomEvent('shop:open', { detail: { shopId } }));
    }

    private async giveItem(action: DialogueAction) {
        if (action.type !== 'giveItem') return;
        if (!this.npcId) return;
        this.networkManager.sendDialogueGiveItem({
            npcId: this.npcId,
            itemId: action.itemId,
            amount: Math.max(1, Math.floor(action.amount ?? 1)),
            ifMissing: action.ifMissing !== false
        });

        if (action.itemId === 'rickety_rod' && this.npcId === 'fisherman') {
            this.grantedRodDuringDialogue = true;
        }
    }

    async advance() {
        if (!this.active || !this.currentDialogue) return;
        const lines = this.currentDialogue.lines ?? [];
        if (lines.length === 0) {
            this.exitDialogueMode();
            return;
        }

        if (this.currentIndex < lines.length - 1) {
            this.currentIndex += 1;
            this.renderCurrentLine();
            return;
        }

        this.playDialogueEndBurst();
        const deferredActions = await this.executeActions();
        this.exitDialogueMode();
        for (const action of deferredActions) {
            if (action.type === 'openShop') {
                this.openShop(action.shopId);
            }
        }
    }

    private playDialogueNext() {
        const audioManager = this.gameScene.getAudioManager();
        audioManager?.playDialogueNext?.();
    }

    private playDialogueEndBurst() {
        const audioManager = this.gameScene.getAudioManager();
        audioManager?.playDialogueEndBurst?.();
    }
}
