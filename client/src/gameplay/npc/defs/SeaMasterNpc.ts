import type { NPCDefinition } from '../NPCRegistry';

export const SEA_MASTER_NAME = 'Sea Master';
export const SEA_MASTER_SCALE = 1.2;

export const SEA_MASTER_NPC_DEFINITION: NPCDefinition = {
    id: 'seamaster',
    name: SEA_MASTER_NAME,
    nameKey: 'npc.seamaster.name',
    singleTexturePath: '/assets/npc/seamaster/single.png',
    scale: SEA_MASTER_SCALE,
    frameWidth: 22,
    frameHeight: 30,
    frameCount: 2,
    frameRate: 1.2,
    interactionRangeTiles: 1
};
