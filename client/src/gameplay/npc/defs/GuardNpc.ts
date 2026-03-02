import type { NPCDefinition } from '../NPCRegistry';

export const GUARD_NAME = 'Guard';
export const GUARD_NPC_SCALE = 1.3;

export const GUARD_NPC_DEFINITION: NPCDefinition = {
    id: 'guard',
    name: GUARD_NAME,
    nameKey: 'npc.guard.name',
    singleTexturePath: '/assets/npc/guard/single.png',
    scale: GUARD_NPC_SCALE,
    frameWidth: 20,
    frameHeight: 31,
    frameCount: 2,
    frameRate: 1.2,
    interactionRangeTiles: 1
};
