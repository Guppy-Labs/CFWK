import type { NPCDefinition } from '../NPCRegistry';

export const WISEMAN_NAME = 'Wise Man';
export const WISEMAN_NPC_SCALE = 1.3;

export const WISEMAN_NPC_DEFINITION: NPCDefinition = {
    id: 'wiseman',
    name: WISEMAN_NAME,
    nameKey: 'npc.wiseman.name',
    singleTexturePath: '/assets/npc/wiseman/single.png',
    scale: WISEMAN_NPC_SCALE,
    frameWidth: 25,
    frameHeight: 28,
    frameCount: 2,
    frameRate: 1.2,
    bobCutRowFromBottom: 12,
    interactionRangeTiles: 1
};
