/**
 * InteractionManager - Handles detection and execution of player interactions
 * 
 * Manages proximity-based interactions like shoving other players.
 * Provides available interactions to UI components (MobileControls, keyboard).
 */

import { RemotePlayerManager } from '../player/RemotePlayerManager';
import { NetworkManager } from '../network/NetworkManager';
import { DroppedItemManager } from '../items/DroppedItemManager';
import type { NPCManager, NPCInteractable } from '../npc/NPCManager';

/**
 * Interaction types available in the game
 */
export enum InteractionType {
    None = 'none',
    Shove = 'shove',
    Pickup = 'pickup',
    Talk = 'talk'
}

/**
 * An available interaction with a target
 */
export interface AvailableInteraction {
    type: InteractionType;
    targetSessionId?: string;
    targetUsername?: string;
    droppedItemId?: string;
    itemId?: string;
    amount?: number;
    npcId?: string;
    npcName?: string;
    /** Distance to target in pixels */
    distance: number;
    /** Whether the interaction can be executed (strict check passed) */
    canExecute: boolean;
    /** Priority (higher means preferred) */
    priority: number;
}

/**
 * Configuration for proximity detection
 */
interface InteractionConfig {
    /** Distance to show interaction button (loose proximity check) */
    shoveShowDistance: number;
    /** Distance to actually execute shove (strict proximity check) */
    shoveExecuteDistance: number;
    /** Distance to show pickup interaction */
    pickupShowDistance: number;
    /** Distance to actually execute pickup */
    pickupExecuteDistance: number;
    /** Angle tolerance for facing check (radians) - how close player must be to facing target */
    showAngleTolerance: number;
    /** Strict angle tolerance for execution */
    executeAngleTolerance: number;
}

const DEFAULT_CONFIG: InteractionConfig = {
    shoveShowDistance: 55,      // Show button when within 55px
    shoveExecuteDistance: 38,   // Execute only when within 38px (stricter)
    pickupShowDistance: 24,
    pickupExecuteDistance: 16,
    showAngleTolerance: Math.PI / 2,      // 90 degrees - roughly facing
    executeAngleTolerance: Math.PI / 2,   // 90 degrees - more lenient angle for execution
};

const INTERACTION_PRIORITY = {
    [InteractionType.Pickup]: 100,
    [InteractionType.Talk]: 75,
    [InteractionType.Shove]: 50
};

/**
 * Callback type for interaction availability changes
 */
export type InteractionChangeCallback = (interaction: AvailableInteraction | null) => void;

export class InteractionManager {
    private config: InteractionConfig;
    private remotePlayerManager?: RemotePlayerManager;
    private droppedItemManager?: DroppedItemManager;
    private networkManager = NetworkManager.getInstance();
    private npcManager?: NPCManager;
    
    /** Current available interaction (or null if none) */
    private currentInteraction: AvailableInteraction | null = null;
    
    /** Local player position and facing - updated each frame */
    private localX: number = 0;
    private localY: number = 0;
    private localFacingAngle: number = Math.PI / 2; // Default facing down
    
    /** Listeners for interaction changes */
    private changeListeners: InteractionChangeCallback[] = [];
    
    /** Cooldown to prevent rapid-fire shoving */
    private shoveCooldownEnd: number = 0;
    private readonly shoveCooldownMs: number = 500;

    constructor(config: Partial<InteractionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Set the remote player manager reference
     */
    setRemotePlayerManager(manager: RemotePlayerManager) {
        this.remotePlayerManager = manager;
    }

    /**
     * Set the dropped item manager reference
     */
    setDroppedItemManager(manager: DroppedItemManager) {
        this.droppedItemManager = manager;
    }

    /**
     * Set the NPC manager reference
     */
    setNpcManager(manager: NPCManager) {
        this.npcManager = manager;
    }

    /**
     * Update local player position and facing angle
     * Called each frame from PlayerController
     */
    updateLocalPlayer(x: number, y: number, facingAngle: number) {
        this.localX = x;
        this.localY = y;
        this.localFacingAngle = facingAngle;
    }

    /**
     * Check for available interactions based on proximity
     * Should be called each frame
     */
    update(): void {
        if (!this.remotePlayerManager && !this.droppedItemManager && !this.npcManager) {
            this.setInteraction(null);
            return;
        }

        let bestInteraction: AvailableInteraction | null = null;
        let bestDistance = Infinity;
        let bestPriority = -Infinity;

        if (this.droppedItemManager) {
            this.droppedItemManager.getItems().forEach((item, itemId) => {
                const dx = item.x - this.localX;
                const dy = item.y - this.localY;
                const distance = Math.hypot(dx, dy);

                if (distance > this.config.pickupShowDistance) return;

                const canExecute = distance <= this.config.pickupExecuteDistance;
                const priority = INTERACTION_PRIORITY[InteractionType.Pickup];

                if (priority > bestPriority || (priority === bestPriority && distance < bestDistance)) {
                    bestPriority = priority;
                    bestDistance = distance;
                    bestInteraction = {
                        type: InteractionType.Pickup,
                        droppedItemId: itemId,
                        itemId: item.itemId,
                        amount: item.amount,
                        distance,
                        canExecute,
                        priority
                    };
                }
            });
        }

        if (this.remotePlayerManager) {
            const remotePlayers = this.remotePlayerManager.getPlayers();

            remotePlayers.forEach((remote, sessionId) => {
                if (remote.isAfkGhosted()) return;
                const sprite = remote.getSprite();
                if (!sprite) return;

                const targetX = sprite.x;
                const targetY = sprite.y;
                
                // Calculate distance
                const dx = targetX - this.localX;
                const dy = targetY - this.localY;
                const distance = Math.hypot(dx, dy);

                // Check if within show distance
                if (distance > this.config.shoveShowDistance) return;

                // Calculate angle to target
                const angleToTarget = Math.atan2(dy, dx);
                
                // Check if roughly facing the target (loose check for showing button)
                const angleDiff = this.normalizeAngle(angleToTarget - this.localFacingAngle);
                if (Math.abs(angleDiff) > this.config.showAngleTolerance) return;

                const canExecute = 
                    distance <= this.config.shoveExecuteDistance &&
                    Math.abs(angleDiff) <= this.config.executeAngleTolerance &&
                    Date.now() >= this.shoveCooldownEnd;

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

                const canExecute = distance <= npc.range;
                const priority = INTERACTION_PRIORITY[InteractionType.Talk];

                if (priority > bestPriority || (priority === bestPriority && distance < bestDistance)) {
                    bestPriority = priority;
                    bestDistance = distance;
                    bestInteraction = {
                        type: InteractionType.Talk,
                        npcId: npc.id,
                        npcName: npc.name,
                        distance,
                        canExecute,
                        priority
                    };
                }
            });
        }

        this.setInteraction(bestInteraction);
    }

    /**
     * Get the current available interaction
     */
    getCurrentInteraction(): AvailableInteraction | null {
        return this.currentInteraction;
    }

    /**
     * Execute the current interaction
     * Returns true if executed successfully
     */
    executeInteraction(): boolean {
        if (!this.currentInteraction) return false;
        
        // Re-check execution conditions (they may have changed since last frame)
        if (!this.currentInteraction.canExecute) {
            console.log('[InteractionManager] Cannot execute: conditions not met');
            return false;
        }

        if (this.currentInteraction.type === InteractionType.Shove) {
            if (!this.currentInteraction.targetSessionId) return false;
            return this.executeShove(this.currentInteraction.targetSessionId);
        }

        if (this.currentInteraction.type === InteractionType.Pickup) {
            return this.executePickup(this.currentInteraction.droppedItemId);
        }

        if (this.currentInteraction.type === InteractionType.Talk) {
            if (!this.currentInteraction.npcId) return false;
            return this.executeNpcTalk(this.currentInteraction.npcId);
        }

        return false;
    }

    /**
     * Execute a shove on the target player
     */
    private executeShove(targetSessionId: string): boolean {
        // Set cooldown
        this.shoveCooldownEnd = Date.now() + this.shoveCooldownMs;

        // Send shove to server
        this.networkManager.sendShove(targetSessionId);
        
        console.log(`[InteractionManager] Shoved player: ${targetSessionId}`);
        return true;
    }

    /**
     * Execute a pickup for a dropped item
     */
    private executePickup(droppedItemId?: string): boolean {
        if (!droppedItemId) return false;
        this.networkManager.sendPickupItem(droppedItemId);
        console.log(`[InteractionManager] Picked up item: ${droppedItemId}`);
        return true;
    }

    private executeNpcTalk(npcId: string): boolean {
        console.log(`[InteractionManager] NPC interaction triggered: ${npcId}`);
        window.dispatchEvent(new CustomEvent('npc:interact', {
            detail: { npcId, npcName: this.currentInteraction?.npcName }
        }));
        return true;
    }

    /**
     * Listen for interaction availability changes
     */
    onInteractionChange(callback: InteractionChangeCallback): () => void {
        this.changeListeners.push(callback);
        
        // Immediately call with current state
        callback(this.currentInteraction);
        
        // Return unsubscribe function
        return () => {
            const index = this.changeListeners.indexOf(callback);
            if (index !== -1) {
                this.changeListeners.splice(index, 1);
            }
        };
    }

    /**
     * Set the current interaction and notify listeners if changed
     */
    private setInteraction(interaction: AvailableInteraction | null) {
        // Check if meaningfully changed
        const changed = !this.interactionsEqual(this.currentInteraction, interaction);
        
        this.currentInteraction = interaction;
        
        if (changed) {
            this.changeListeners.forEach(cb => cb(interaction));
        }
    }

    /**
     * Compare two interactions for equality
     */
    private interactionsEqual(a: AvailableInteraction | null, b: AvailableInteraction | null): boolean {
        if (a === null && b === null) return true;
        if (a === null || b === null) return false;
        
        return a.type === b.type &&
            a.targetSessionId === b.targetSessionId &&
            a.droppedItemId === b.droppedItemId &&
            a.npcId === b.npcId &&
            a.canExecute === b.canExecute &&
            a.priority === b.priority;
    }

    /**
     * Normalize an angle to the range [-PI, PI]
     */
    private normalizeAngle(angle: number): number {
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        return angle;
    }

    /**
     * Clean up
     */
    destroy() {
        this.changeListeners = [];
        this.currentInteraction = null;
    }
}
