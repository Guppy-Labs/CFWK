import { TEST_NPC_DEFINITION } from './defs/TestNpc';
import { SEA_MASTER_NPC_DEFINITION } from './defs/SeaMasterNpc';
import { GUARD_NPC_DEFINITION } from './defs/GuardNpc';
import { FISHERMAN_NPC_DEFINITION } from './defs/FishermanNpc';
import { MERCHANT_NPC_DEFINITION } from './defs/MerchantNpc';
import { TRAVELLER_NPC_DEFINITION } from './defs/TravellerNpc';
import { WISEMAN_NPC_DEFINITION } from './defs/WisemanNpc';
import { DEBUG_NPC_DEFINITION } from './defs/DebugNpc';
import { DAD_NPC_DEFINITION } from './defs/DadNpc';
import { WIZARD_NPC_DEFINITION } from './defs/WizardNpc';

export type NPCDefinition = {
    id: string;
    name: string;
    nameKey?: string;
    idleTexturePath?: string;
    singleTexturePath?: string;
    scale: number;
    frameWidth: number;
    frameHeight: number;
    frameCount: number;
    frameRate: number;
    bobCutRowFromBottom?: number;
    interactionRangeTiles: number;
    depthOffset?: number;
};

const NPC_DEFINITIONS: Record<string, NPCDefinition> = {
    [TEST_NPC_DEFINITION.id]: TEST_NPC_DEFINITION,
    [SEA_MASTER_NPC_DEFINITION.id]: SEA_MASTER_NPC_DEFINITION,
    [GUARD_NPC_DEFINITION.id]: GUARD_NPC_DEFINITION,
    [FISHERMAN_NPC_DEFINITION.id]: FISHERMAN_NPC_DEFINITION,
    [MERCHANT_NPC_DEFINITION.id]: MERCHANT_NPC_DEFINITION,
    [TRAVELLER_NPC_DEFINITION.id]: TRAVELLER_NPC_DEFINITION,
    [WISEMAN_NPC_DEFINITION.id]: WISEMAN_NPC_DEFINITION,
    [DEBUG_NPC_DEFINITION.id]: DEBUG_NPC_DEFINITION,
    [DAD_NPC_DEFINITION.id]: DAD_NPC_DEFINITION,
    [WIZARD_NPC_DEFINITION.id]: WIZARD_NPC_DEFINITION
};

export function getNpcDefinition(id: string): NPCDefinition | undefined {
    return NPC_DEFINITIONS[id];
}
