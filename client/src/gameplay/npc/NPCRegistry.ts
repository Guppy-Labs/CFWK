import { TEST_NPC_DEFINITION } from './defs/TestNpc';

export type NPCDefinition = {
    id: string;
    name: string;
    idleTexturePath: string;
    frameWidth: number;
    frameHeight: number;
    frameCount: number;
    frameRate: number;
    interactionRangeTiles: number;
    depthOffset?: number;
};

const NPC_DEFINITIONS: Record<string, NPCDefinition> = {
    [TEST_NPC_DEFINITION.id]: TEST_NPC_DEFINITION
};

export function getNpcDefinition(id: string): NPCDefinition | undefined {
    return NPC_DEFINITIONS[id];
}
