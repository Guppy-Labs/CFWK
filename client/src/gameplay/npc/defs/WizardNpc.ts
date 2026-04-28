import type { NPCDefinition } from '../NPCRegistry';

export const WIZARD_NPC_DEFINITION: NPCDefinition = {
    id: 'wizard',
    name: 'Wizard',
    nameKey: 'npc.wizard.name',
    singleTexturePath: '/assets/npc/wizard/single.png',
    scale: 1.3,
    frameWidth: 25,
    frameHeight: 28,
    frameCount: 2,
    frameRate: 1.2,
    bobCutRowFromBottom: 12,
    interactionRangeTiles: 1
};
