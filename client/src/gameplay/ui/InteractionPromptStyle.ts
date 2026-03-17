import Phaser from 'phaser';
import type { AvailableInteraction } from '../interaction/InteractionManager';
import { InteractionType } from '../interaction/InteractionManager';

export type DesktopInteractionIconKey = 'none' | 'shove' | 'talk' | 'harvest' | 'chest';

export type InteractionPromptStyle = {
    mobileButtonTexture: string;
    mobileOverlayTexture: string | null;
    desktopIcon: DesktopInteractionIconKey;
};

const DEFAULT_STYLE: InteractionPromptStyle = {
    mobileButtonTexture: 'ui-interact-blank',
    mobileOverlayTexture: null,
    desktopIcon: 'none'
};

export function getInteractionPromptStyle(
    interaction: AvailableInteraction | null,
    textures?: Phaser.Textures.TextureManager
): InteractionPromptStyle {
    if (!interaction) {
        return DEFAULT_STYLE;
    }

    if (interaction.type === InteractionType.Talk) {
        return {
            mobileButtonTexture: 'ui-interact-chat',
            mobileOverlayTexture: null,
            desktopIcon: 'talk'
        };
    }

    if (interaction.type === InteractionType.Shove) {
        return {
            mobileButtonTexture: 'ui-interact-blank',
            mobileOverlayTexture: null,
            desktopIcon: 'shove'
        };
    }

    if (interaction.type === InteractionType.Harvest) {
        const berryTexture = 'item-yekberries-18';
        const hasBerryTexture = textures ? textures.exists(berryTexture) : true;
        return {
            mobileButtonTexture: 'ui-interact-blank',
            mobileOverlayTexture: hasBerryTexture ? berryTexture : null,
            desktopIcon: 'harvest'
        };
    }

    if (interaction.type === InteractionType.Chest) {
        const keyTexture = 'item-glimmeringkey-18';
        const hasKeyTexture = textures ? textures.exists(keyTexture) : true;
        return {
            mobileButtonTexture: 'ui-interact-blank',
            mobileOverlayTexture: hasKeyTexture ? keyTexture : null,
            desktopIcon: 'chest'
        };
    }

    return DEFAULT_STYLE;
}
