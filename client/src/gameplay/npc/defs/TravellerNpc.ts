import type { NPCDefinition } from '../NPCRegistry';

export const TRAVELLER_NAME = 'Traveller';
export const TRAVELLER_NPC_SCALE = 1.2;

export const TRAVELLER_NPC_DEFINITION: NPCDefinition = {
    id: 'traveller',
    name: TRAVELLER_NAME,
    nameKey: 'npc.traveller.name',
    singleTexturePath: '/assets/npc/traveller/single.png',
    scale: TRAVELLER_NPC_SCALE,
    frameWidth: 16,
    frameHeight: 29,
    frameCount: 2,
    frameRate: 1.2,
    interactionRangeTiles: 1
};
