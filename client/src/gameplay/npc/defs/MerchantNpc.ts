import type { NPCDefinition } from '../NPCRegistry';

export const MERCHANT_NAME = 'Merchant';
export const MERCHANT_NPC_SCALE = 1.5;

export const MERCHANT_NPC_DEFINITION: NPCDefinition = {
    id: 'merchant',
    name: MERCHANT_NAME,
    nameKey: 'npc.merchant.name',
    singleTexturePath: '/assets/npc/merchant/single.png',
    scale: MERCHANT_NPC_SCALE,
    frameWidth: 18,
    frameHeight: 30,
    frameCount: 2,
    frameRate: 1.2,
    interactionRangeTiles: 1
};
