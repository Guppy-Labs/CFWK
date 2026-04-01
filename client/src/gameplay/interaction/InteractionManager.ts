/**
 * InteractionManager - Handles detection and execution of player interactions
 */

import { RemotePlayerManager } from '../player/RemotePlayerManager';
import { NetworkManager } from '../network/NetworkManager';
import type { NPCManager, NPCInteractable } from '../npc/NPCManager';

export enum InteractionType {
    None = 'none',
    Shove = 'shove',
    Talk = 'talk',
    Harvest = 'harvest',
    Chest = 'chest'
}

export type StaticInteractiveTarget = {
    objectId: number;
    componentId: string;
    x: number;
    y: number;
    rangePx: number;
};

export interface AvailableInteraction {
    type: InteractionType;
    targetSessionId?: string;
    targetUsername?: string;
    npcId?: string;
    npcName?: string;
    objectId?: number;
    componentId?: string;
    distance: number;
    canExecute: boolean;
    priority: number;
}

interface InteractionConfig {
    shoveShowDistance: number;
    shoveExecuteDistance: number;
    showAngleTolerance: number;
    executeAngleTolerance: number;
    harvestDistance: number;
}

const DEFAULT_CONFIG: InteractionConfig = {
    shoveShowDistance: 55,
    shoveExecuteDistance: 38,
    showAngleTolerance: Math.PI / 2,
    executeAngleTolerance: Math.PI / 2,
    harvestDistance: 96
};

const INTERACTION_PRIORITY = {
    [InteractionType.Chest]: 90,
    [InteractionType.Talk]: 75,
    [InteractionType.Harvest]: 70,
    [InteractionType.Shove]: 50
};

export type InteractionChangeCallback = (interaction: AvailableInteraction | null) => void;

export class InteractionManager {
    private config: InteractionConfig;
    private remotePlayerManager?: RemotePlayerManager;
    private networkManager = NetworkManager.getInstance();
    private npcManager?: NPCManager;
    private staticInteractives: StaticInteractiveTarget[] = [];
    private interactiveCooldownByObjectId = new Map<number, number>();

    private currentInteraction: AvailableInteraction | null = null;
    private localX = 0;
    private localY = 0;
    private localFacingAngle = Math.PI / 2;
    private changeListeners: InteractionChangeCallback[] = [];
    private shoveCooldownEnd = 0;
    private readonly shoveCooldownMs = 500;

    constructor(config: Partial<InteractionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    setRemotePlayerManager(manager: RemotePlayerManager) {
        this.remotePlayerManager = manager;
    }

    setNpcManager(manager: NPCManager) {
        this.npcManager = manager;
    }

    setStaticInteractives(targets: StaticInteractiveTarget[]) {
        this.staticInteractives = Array.isArray(targets) ? [...targets] : [];
    }

    setInteractiveCooldown(objectId: number, readyAt: number) {
        if (!Number.isFinite(objectId)) return;
        this.interactiveCooldownByObjectId.set(Math.floor(objectId), Math.max(0, Math.floor(readyAt || 0)));
    }

    updateLocalPlayer(x: number, y: number, facingAngle: number) {
        this.localX = x;
        this.localY = y;
        this.localFacingAngle = facingAngle;
    }

    update(): void {
        if (!this.remotePlayerManager && !this.npcManager && this.staticInteractives.length === 0) {
            this.setInteraction(null);
            return;
        }

        let bestInteraction: AvailableInteraction | null = null;
        let bestDistance = Infinity;
        let bestPriority = -Infinity;

        if (this.remotePlayerManager) {
            const remotePlayers = this.remotePlayerManager.getPlayers();
            remotePlayers.forEach((remote, sessionId) => {
                if (remote.isAfkGhosted()) return;
                const sprite = remote.getSprite();
                if (!sprite) return;

                const dx = sprite.x - this.localX;
                const dy = sprite.y - this.localY;
                const distance = Math.hypot(dx, dy);
                if (distance > this.config.shoveShowDistance) return;

                const angleToTarget = Math.atan2(dy, dx);
                const angleDiff = this.normalizeAngle(angleToTarget - this.localFacingAngle);
                if (Math.abs(angleDiff) > this.config.showAngleTolerance) return;

                const canExecute = distance <= this.config.shoveExecuteDistance
                    && Math.abs(angleDiff) <= this.config.executeAngleTolerance
                    && Date.now() >= this.shoveCooldownEnd;

                const priority = INTERACTION_PRIORITY[InteractionType.Shove];
                if (priority > bestPriority || (priority === bestPriority && distance < bestDistance)) {
                    bestPriority = priority;
                    bestDistance = distance;
                    bestInteraction = {
                        type: InteractionType.Shove,
                        targetSessionId: sessionId,
                        targetUsername: remote.getUsername(),
                        distance,
                        canExecute,
                        priority
                    };
                }
            });
        }

        if (this.npcManager) {
            const npcs = this.npcManager.getInteractables();
            npcs.forEach((npc: NPCInteractable) => {
                const dx = npc.x - this.localX;
                const dy = npc.y - this.localY;
                const distance = Math.hypot(dx, dy);
                if (distance > npc.range) return;

                const priority = INTERACTION_PRIORITY[InteractionType.Talk];
                if (priority > bestPriority || (priority === bestPriority && distance < bestDistance)) {
                    bestPriority = priority;
                    bestDistance = distance;
                    bestInteraction = {
                        type: InteractionType.Talk,
                        npcId: npc.id,
                        npcName: npc.name,
                        distance,
                        canExecute: true,
                        priority
                    };
                }
            });
        }

        const now = Date.now();
        this.staticInteractives.forEach((target) => {
            const dx = target.x - this.localX;
            const dy = target.y - this.localY;
            const distance = Math.hypot(dx, dy);
            const showDistance = Math.max(0, target.rangePx || this.config.harvestDistance);
            if (distance > showDistance) return;

            const readyAt = this.interactiveCooldownByObjectId.get(target.objectId) ?? 0;
            const interactionType = target.componentId === 'glimmeringchest'
                ? InteractionType.Chest
                : InteractionType.Harvest;
            const canExecute = interactionType === InteractionType.Chest
                ? true
                : readyAt <= now;
            const priority = INTERACTION_PRIORITY[interactionType];
            if (priority > bestPriority || (priority === bestPriority && distance < bestDistance)) {
                bestPriority = priority;
                bestDistance = distance;
                bestInteraction = {
                    type: interactionType,
                    objectId: target.objectId,
                    componentId: target.componentId,
                    distance,
                    canExecute,
                    priority
                };
            }
        });

        this.setInteraction(bestInteraction);
    }

    getCurrentInteraction(): AvailableInteraction | null {
        return this.currentInteraction;
    }

    executeInteraction(): boolean {
        if (!this.currentInteraction) return false;
        if (!this.currentInteraction.canExecute) return false;

        if (this.currentInteraction.type === InteractionType.Shove) {
            if (!this.currentInteraction.targetSessionId) return false;
            return this.executeShove(this.currentInteraction.targetSessionId);
        }

        if (this.currentInteraction.type === InteractionType.Talk) {
            if (!this.currentInteraction.npcId) return false;
            return this.executeNpcTalk(this.currentInteraction.npcId);
        }

        if (this.currentInteraction.type === InteractionType.Harvest) {
            if (!this.currentInteraction.objectId || !this.currentInteraction.componentId) return false;
            return this.executeHarvest(this.currentInteraction.objectId, this.currentInteraction.componentId);
        }

        if (this.currentInteraction.type === InteractionType.Chest) {
            if (!this.currentInteraction.objectId || !this.currentInteraction.componentId) return false;
            return this.executeChest(this.currentInteraction.objectId, this.currentInteraction.componentId);
        }

        return false;
    }

    private executeShove(targetSessionId: string): boolean {
        this.shoveCooldownEnd = Date.now() + this.shoveCooldownMs;
        this.networkManager.sendShove(targetSessionId);
        return true;
    }

    private executeNpcTalk(npcId: string): boolean {
        if (npcId.trim().toLowerCase() === 'debug') {
            window.dispatchEvent(new CustomEvent('debug:npc:open'));
            return true;
        }
        window.dispatchEvent(new CustomEvent('npc:interact', {
            detail: { npcId, npcName: this.currentInteraction?.npcName }
        }));
        return true;
    }

    private executeHarvest(objectId: number, componentId: string): boolean {
        this.networkManager.sendHarvestInteractive(objectId, componentId);
        return true;
    }

    private executeChest(objectId: number, componentId: string): boolean {
        this.networkManager.sendChestInteract(objectId, componentId);
        return true;
    }

    onInteractionChange(callback: InteractionChangeCallback): () => void {
        this.changeListeners.push(callback);
        callback(this.currentInteraction);
        return () => {
            const index = this.changeListeners.indexOf(callback);
            if (index !== -1) {
                this.changeListeners.splice(index, 1);
            }
        };
    }

    private setInteraction(interaction: AvailableInteraction | null) {
        const changed = !this.interactionsEqual(this.currentInteraction, interaction);
        this.currentInteraction = interaction;
        if (changed) {
            this.changeListeners.forEach((cb) => cb(interaction));
        }
    }

    private interactionsEqual(a: AvailableInteraction | null, b: AvailableInteraction | null): boolean {
        if (a === null && b === null) return true;
        if (a === null || b === null) return false;
        return a.type === b.type
            && a.targetSessionId === b.targetSessionId
            && a.npcId === b.npcId
            && a.objectId === b.objectId
            && a.canExecute === b.canExecute
            && a.priority === b.priority;
    }

    private normalizeAngle(angle: number): number {
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        return angle;
    }

    destroy() {
        this.changeListeners = [];
        this.currentInteraction = null;
    }
}
