import { AINpcKind, DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG, IGeneralEnemyControllerConfig } from '@cfwk/shared';
import { GeneralEnemyController } from './controllers/GeneralEnemyController';
import { AIController } from './controllers/AIController';
import fs from 'fs';
import path from 'path';

export const AI_METERS_TO_PIXELS = 16;

export type AiNpcDefinition = {
    kind: AINpcKind;
    name: string;
    controllerId: 'general-enemy';
    tint: number;
    maxHealth: number;
    hitbox: {
        width: number;
        height: number;
        collidableHeight: number;
    };
    controllerConfig: IGeneralEnemyControllerConfig;
};

export const AI_NPC_DEFINITIONS: Record<AINpcKind, AiNpcDefinition> = {
    evil_tim: {
        kind: 'evil_tim',
        name: 'Evil Tim',
        controllerId: 'general-enemy',
        tint: 0xff4a4a,
        maxHealth: 5,
        hitbox: {
            width: 16,
            height: 25,
            collidableHeight: 6
        },
        controllerConfig: {
            ...DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG,
            meleeDamageHearts: 0
        }
    },
    gremlin: {
        kind: 'gremlin',
        name: 'Gremlin',
        controllerId: 'general-enemy',
        tint: 0xffffff,
        maxHealth: 5,
        hitbox: {
            width: 55,
            height: 72,
            collidableHeight: 18
        },
        controllerConfig: {
            ...DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG,
            speedPxPerSecond: 30,
            attackCooldownMs: 6000,
            meleeRangePx: 16,
            meleeDamageHearts: 1
        }
    }
};

type GremlinTrimMeta = {
    animations?: {
        idle?: {
            frameWidth?: number;
            frameHeight?: number;
        };
    };
};

const GREMLIN_RENDER_SCALE = 1;
const GREMLIN_HITBOX_WIDTH_TO_RENDERED_RATIO = 55 / (154 * GREMLIN_RENDER_SCALE);
const GREMLIN_COLLIDABLE_TO_RENDERED_HEIGHT_RATIO = 18 / (88 * GREMLIN_RENDER_SCALE);

function resolveGremlinTrimMetaPath(): string | null {
    const candidates = [
        path.resolve(process.cwd(), 'client/public/assets/npc/gremlin/variant1/trim.meta.json'),
        path.resolve(process.cwd(), '../client/public/assets/npc/gremlin/variant1/trim.meta.json'),
        path.resolve(__dirname, '../../../client/public/assets/npc/gremlin/variant1/trim.meta.json'),
        path.resolve(__dirname, '../../../../client/public/assets/npc/gremlin/variant1/trim.meta.json')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

export function refreshGremlinHitboxFromTrimMeta(): void {
    const metaPath = resolveGremlinTrimMetaPath();
    if (!metaPath) return;

    try {
        const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as GremlinTrimMeta;
        const frameWidth = Number(parsed.animations?.idle?.frameWidth);
        const frameHeight = Number(parsed.animations?.idle?.frameHeight);
        if (!Number.isFinite(frameWidth) || frameWidth <= 0 || !Number.isFinite(frameHeight) || frameHeight <= 0) {
            return;
        }

        const renderedWidth = frameWidth * GREMLIN_RENDER_SCALE;
        const renderedHeight = frameHeight * GREMLIN_RENDER_SCALE;
        AI_NPC_DEFINITIONS.gremlin.hitbox.width = Math.max(14, Math.round(renderedWidth * GREMLIN_HITBOX_WIDTH_TO_RENDERED_RATIO));
        AI_NPC_DEFINITIONS.gremlin.hitbox.height = Math.max(16, Math.round(renderedHeight));
        AI_NPC_DEFINITIONS.gremlin.hitbox.collidableHeight = Math.max(8, Math.round(renderedHeight * GREMLIN_COLLIDABLE_TO_RENDERED_HEIGHT_RATIO));
    } catch (error) {
        console.warn('[GremlinTrim] Failed to apply trim meta to gremlin hitbox:', error);
    }
}

const generalEnemyController = new GeneralEnemyController();

const AI_CONTROLLERS: Record<string, AIController> = {
    [generalEnemyController.id]: generalEnemyController
};

export function getAiControllerById(controllerId: string): AIController | undefined {
    return AI_CONTROLLERS[controllerId];
}
