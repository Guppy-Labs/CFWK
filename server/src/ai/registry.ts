import { DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG, IGeneralEnemyControllerConfig } from '@cfwk/shared';
import { GeneralEnemyController } from './controllers/GeneralEnemyController';
import { AIController } from './controllers/AIController';

export const AI_METERS_TO_PIXELS = 16;

export type AiNpcDefinition = {
    kind: 'evil_tim';
    name: string;
    controllerId: 'general-enemy';
    tint: number;
    hitbox: {
        width: number;
        height: number;
        collidableHeight: number;
    };
    controllerConfig: IGeneralEnemyControllerConfig;
};

export const AI_NPC_DEFINITIONS: Record<'evil_tim', AiNpcDefinition> = {
    evil_tim: {
        kind: 'evil_tim',
        name: 'Evil Tim',
        controllerId: 'general-enemy',
        tint: 0xff4a4a,
        hitbox: {
            width: 16,
            height: 25,
            collidableHeight: 6
        },
        controllerConfig: { ...DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG }
    }
};

const generalEnemyController = new GeneralEnemyController();

const AI_CONTROLLERS: Record<string, AIController> = {
    [generalEnemyController.id]: generalEnemyController
};

export function getAiControllerById(controllerId: string): AIController | undefined {
    return AI_CONTROLLERS[controllerId];
}
