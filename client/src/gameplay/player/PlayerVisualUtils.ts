import Phaser from 'phaser';
import { EmojiMap } from '../ui/EmojiMap';
import { OcclusionManager } from '../map/OcclusionManager';

export type NameplateConfig = {
    scene: Phaser.Scene;
    text: string;
    isPremium?: boolean;
    fontSize: string;
    yOffset: number;
    depth: number;
    includeAfkTimer?: boolean;
};

export type NameplateResult = {
    container: Phaser.GameObjects.Container;
    nameText: Phaser.GameObjects.Text;
    afkTimerText?: Phaser.GameObjects.Text;
    destroy: () => void;
};

export function createNameplate(config: NameplateConfig): NameplateResult {
    const { scene, text, isPremium, fontSize, yOffset, depth, includeAfkTimer } = config;

    const padding = { x: 2, y: 1 };
    const nameText = scene.add.text(0, 0, text, {
        fontSize,
        fontFamily: 'Minecraft, monospace',
        color: '#ffffff',
        resolution: 2
    }).setOrigin(0, 0.5);

    let iconWidth = 0;
    let iconText: Phaser.GameObjects.Text | undefined;
    if (isPremium) {
        iconText = scene.add.text(0, 0, '🦈', {
            fontSize,
            fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
            color: '#ffffff',
            resolution: 2
        }).setOrigin(0, 0.5);
        iconText.setScale(0.75);
        iconWidth = iconText.displayWidth + 2;
    }

    const textWidth = nameText.width + iconWidth;
    const textHeight = nameText.height;
    const bgWidth = textWidth + padding.x * 2;
    const bgHeight = textHeight + padding.y * 2;

    const nameBg = scene.add.graphics();
    nameBg.fillStyle(0x000000, 0.6);
    nameBg.fillRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight);

    const afkTimerText = includeAfkTimer
        ? scene.add.text(0, -10, '', {
            fontSize: '6px',
            fontFamily: 'Minecraft, monospace',
            color: '#ffffff',
            resolution: 2
        }).setOrigin(0.5)
        : undefined;
    if (afkTimerText) afkTimerText.setVisible(false);

    const leftX = -textWidth / 2;
    if (iconText) {
        iconText.setPosition(leftX, 0);
        nameText.setPosition(leftX + iconWidth, 0);
    } else {
        nameText.setPosition(leftX, 0);
    }

    const items: Phaser.GameObjects.GameObject[] = [];
    if (afkTimerText) items.push(afkTimerText);
    items.push(nameBg);
    if (iconText) items.push(iconText);
    items.push(nameText);

    const container = scene.add.container(0, 0, items);
    container.setDepth(depth);
    container.setPosition(0, yOffset);

    return {
        container,
        nameText,
        afkTimerText,
        destroy: () => {
            container.destroy();
            nameBg.destroy();
            nameText.destroy();
            iconText?.destroy();
            afkTimerText?.destroy();
        }
    };
}

export type ChatBubbleConfig = {
    scene: Phaser.Scene;
    message: string;
    maxWidth?: number;
    padding?: number;
    arrowHeight?: number;
    bgAlpha?: number;
    depth?: number;
};

export type ChatBubbleResult = {
    container: Phaser.GameObjects.Container;
    height: number;
};

export function createChatBubble(config: ChatBubbleConfig): ChatBubbleResult {
    const { scene, message } = config;
    const padding = config.padding ?? 4;
    const arrowHeight = config.arrowHeight ?? 4;
    const maxWidth = config.maxWidth ?? 120;
    const bgAlpha = config.bgAlpha ?? 0.6;
    const depth = config.depth ?? 99999;

    const parsedMessage = EmojiMap.parse(message);

    const text = scene.add.text(0, 0, parsedMessage, {
        fontSize: '8px',
        fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
        color: '#f0f0f0',
        wordWrap: { width: maxWidth, useAdvancedWrap: true },
        align: 'center',
        resolution: 2
    }).setOrigin(0.5);

    const width = text.width + padding * 2;
    const height = text.height + padding * 2;

    const bg = scene.add.graphics();
    bg.fillStyle(0x000000, bgAlpha);
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, 4);
    bg.fillTriangle(-5, height / 2, 5, height / 2, 0, height / 2 + arrowHeight);

    const container = scene.add.container(0, 0, [bg, text]);
    container.setDepth(depth);

    return { container, height };
}

export function getOcclusionAdjustedDepth(
    occlusionManager: OcclusionManager | undefined,
    x: number,
    feetY: number,
    baseDepth: number,
    respectElevatedLayers: boolean = false
): number {
    let depth = baseDepth + feetY * 0.01;
    if (!occlusionManager) return depth;

    const occlusionTags = occlusionManager.getOcclusionTagsAt(x, feetY, 4);
    if (occlusionTags.size > 0) {
        const minBase = occlusionManager.getMinBaseDepthForTags(occlusionTags);
        depth = (minBase - 10) + (feetY * 0.01);
    } else if (respectElevatedLayers) {
        const maxElevatedDepth = occlusionManager.getMaxElevatedLayerDepth();
        if (maxElevatedDepth !== null) {
            const frontDepth = (maxElevatedDepth + 1) + (feetY * 0.01);
            if (frontDepth > depth) depth = frontDepth;
        }
    }
    return depth;
}
