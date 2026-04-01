import type { NPCDefinition } from '../NPCRegistry';

export const DEBUG_NPC_NAME = 'Debug';
export const DEBUG_NPC_SCALE = 1;

export const DEBUG_NPC_DEFINITION: NPCDefinition = {
    id: 'debug',
    name: DEBUG_NPC_NAME,
    nameKey: 'npc.debug.name',
    // Reuse test NPC visuals/animation for now.
    idleTexturePath: '/assets/npc/test/idle.png',
    scale: DEBUG_NPC_SCALE,
    frameWidth: 16,
    frameHeight: 25,
    frameCount: 4,
    frameRate: 6,
    interactionRangeTiles: 1
};
