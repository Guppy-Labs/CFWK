import { AiControllerContext, AiNpcRuntimeState } from '../types';

export interface AIController {
    readonly id: string;
    update(entity: AiNpcRuntimeState, context: AiControllerContext): void;
}
