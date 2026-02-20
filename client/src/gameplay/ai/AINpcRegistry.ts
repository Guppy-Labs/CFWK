import { AINpcKind } from '@cfwk/shared';

export type AINpcVisualDefinition = {
    kind: AINpcKind;
    name: string;
    idleTexturePath: string;
    walkTexturePath: string;
    frameWidth: number;
    frameHeight: number;
    frameCount: number;
    idleFrameRate: number;
    walkFrameRate: number;
    walkAnimSpeedMin: number;
    walkAnimSpeedMax: number;
    walkAnimSpeedMaxVelocity: number;
};

const AI_NPC_VISUALS: Record<AINpcKind, AINpcVisualDefinition> = {
    evil_tim: {
        kind: 'evil_tim',
        name: 'Evil Tim',
        idleTexturePath: '/assets/npc/evil_tim/idle.png',
        walkTexturePath: '/assets/npc/evil_tim/walk.png',
        frameWidth: 16,
        frameHeight: 32,
        frameCount: 4,
        idleFrameRate: 6,
        walkFrameRate: 10,
        walkAnimSpeedMin: 2,
        walkAnimSpeedMax: 9,
        walkAnimSpeedMaxVelocity: 96
    }
};

export function getAiNpcVisualDefinition(kind: AINpcKind): AINpcVisualDefinition | undefined {
    return AI_NPC_VISUALS[kind];
}
