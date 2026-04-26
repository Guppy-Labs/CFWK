import { AINpcKind } from '@cfwk/shared';

export type AINpcVisualDefinition = {
    kind: AINpcKind;
    name: string;
    renderScale?: number;
    trimMetadataPath?: string;
    idleTexturePath: string;
    walkTexturePath: string;
    attackTexturePath?: string;
    deathTexturePath?: string;
    frameWidth: number;
    frameHeight: number;
    frameWidthByState?: Partial<Record<'idle' | 'walk' | 'attack' | 'death', number>>;
    frameHeightByState?: Partial<Record<'idle' | 'walk' | 'attack' | 'death', number>>;
    idleFrameCount: number;
    walkFrameCount: number;
    attackFrameCount?: number;
    deathFrameCount?: number;
    idleFrameRate: number;
    walkFrameRate: number;
    attackFrameRate?: number;
    deathFrameRate?: number;
    walkAnimSpeedMin: number;
    walkAnimSpeedMax: number;
    walkAnimSpeedMaxVelocity: number;
    directionalMode?: 'octant-rows' | 'horizontal-only';
    centerOffsetXByState?: Partial<Record<'idle' | 'walk' | 'attack' | 'death', number>>;
    centerOffsetYByState?: Partial<Record<'idle' | 'walk' | 'attack' | 'death', number>>;
};

const AI_NPC_VISUALS: Record<AINpcKind, AINpcVisualDefinition> = {
    evil_tim: {
        kind: 'evil_tim',
        name: 'Evil Tim',
        idleTexturePath: '/assets/npc/evil_tim/idle.png',
        walkTexturePath: '/assets/npc/evil_tim/walk.png',
        frameWidth: 16,
        frameHeight: 32,
        idleFrameCount: 4,
        walkFrameCount: 4,
        idleFrameRate: 6,
        walkFrameRate: 10,
        walkAnimSpeedMin: 2,
        walkAnimSpeedMax: 9,
        walkAnimSpeedMaxVelocity: 96,
        directionalMode: 'octant-rows'
    },
    gremlin: {
        kind: 'gremlin',
        name: 'Gremlin',
        renderScale: 1,
        trimMetadataPath: '/assets/npc/gremlin/variant1/trim.meta.json',
        idleTexturePath: '/assets/npc/gremlin/variant1/idle.trim.png',
        walkTexturePath: '/assets/npc/gremlin/variant1/walk.trim.png',
        attackTexturePath: '/assets/npc/gremlin/variant1/attack.trim.png',
        deathTexturePath: '/assets/npc/gremlin/variant1/death.trim.png',
        frameWidth: 154,
        frameHeight: 88,
        idleFrameCount: 9,
        walkFrameCount: 8,
        attackFrameCount: 16,
        deathFrameCount: 12,
        idleFrameRate: 8,
        walkFrameRate: 12,
        attackFrameRate: 20,
        deathFrameRate: 12,
        walkAnimSpeedMin: 3,
        walkAnimSpeedMax: 12,
        walkAnimSpeedMaxVelocity: 120,
        directionalMode: 'horizontal-only',
        // Death frames include +18px on the right (fallen spear),
        // so the visual center is 9px left compared to other states.
        centerOffsetXByState: {
            attack: 34,
            walk: 7,
            death: -43
        },
        centerOffsetYByState: {
            attack: 7,
            walk: 12,
            death: -2
        }
    }
};

export function getAiNpcVisualDefinition(kind: AINpcKind): AINpcVisualDefinition | undefined {
    return AI_NPC_VISUALS[kind];
}
