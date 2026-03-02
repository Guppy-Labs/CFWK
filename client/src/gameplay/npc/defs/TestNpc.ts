import type { NPCDefinition } from '../NPCRegistry';

export const TIM_NAME = 'Tim';
export const TEST_NPC_SCALE = 1;

export const TEST_NPC_DEFINITION: NPCDefinition = {
    id: 'test',
    name: TIM_NAME,
    nameKey: 'npc.test.name',
    idleTexturePath: '/assets/npc/test/idle.png',
    scale: TEST_NPC_SCALE,
    frameWidth: 16,
    frameHeight: 25,
    frameCount: 4,
    frameRate: 6,
    interactionRangeTiles: 1
};
