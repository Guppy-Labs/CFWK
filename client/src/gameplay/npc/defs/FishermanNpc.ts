import type { NPCDefinition } from '../NPCRegistry';

export const FISHERMAN_NAME = 'Fisherman';
export const FISHERMAN_NPC_SCALE = 1.4;

export const FISHERMAN_NPC_DEFINITION: NPCDefinition = {
    id: 'fisherman',
    name: FISHERMAN_NAME,
    nameKey: 'npc.fisherman.name',
    singleTexturePath: '/assets/npc/fisherman/single.png',
    scale: FISHERMAN_NPC_SCALE,
    frameWidth: 32,
    frameHeight: 25,
    frameCount: 2,
    frameRate: 1.2,
    interactionRangeTiles: 1
};
