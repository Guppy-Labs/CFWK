import Phaser from 'phaser';
import { LocaleManager } from '../../i18n/LocaleManager';
import { BitmapFontRenderer } from '../BitmapFontRenderer';

export type GroupKey = 'All' | 'Gear' | 'Tools' | 'Fishing' | 'Food';

type GroupCard = {
    key: GroupKey;
    label: string;
    container: Phaser.GameObjects.Container;
    button: Phaser.GameObjects.Image;
    icon: Phaser.GameObjects.Image;
};

export class InventoryGroupsUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private cards: GroupCard[] = [];
    private activeGroup: GroupKey = 'All';
    private onGroupChange?: (group: GroupKey) => void;
    private lastLayout?: { leftPageLeftEdgeX: number; leftPageTopEdgeY: number; scale: number };
    private localeManager = LocaleManager.getInstance();
    private localeChangedHandler?: (event: Event) => void;

    // Layout controls (tweak these for micro-adjustments)
    private groupOffsetX = 9;
    private groupOffsetY = 4;
    private groupSpacingX = 1;
    private iconOffsetY = -1;
    private selectedLabelOffsetY = 4;

    private readonly fontCharSize = 8;
    private readonly fontCharGap = 1;
    private readonly fontRenderer: BitmapFontRenderer;
    private labelTextureCounter = 0;
    private selectedLabel?: Phaser.GameObjects.Image;
    private selectedLabelKey?: string;

    private readonly buttonWidth = 26;
    private readonly buttonHeight = 18;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
        this.scene = scene;
        this.fontRenderer = new BitmapFontRenderer(scene, this.fontCharSize);
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.localeChangedHandler = () => this.refreshLabels();
        window.addEventListener('locale:changed', this.localeChangedHandler as EventListener);

        this.createCards();
        this.setActiveGroup(this.activeGroup);
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    setOnGroupChange(callback?: (group: GroupKey) => void) {
        this.onGroupChange = callback;
    }

    getActiveGroup(): GroupKey {
        return this.activeGroup;
    }

    layout(leftPageLeftEdgeX: number, leftPageTopEdgeY: number, scale: number) {
        this.lastLayout = { leftPageLeftEdgeX, leftPageTopEdgeY, scale };
        const startX = leftPageLeftEdgeX + this.groupOffsetX * scale;
        const startY = leftPageTopEdgeY + this.groupOffsetY * scale;
        const buttonW = this.buttonWidth;
        const buttonH = this.buttonHeight;

        this.cards.forEach((card, index) => {
            card.container.setScale(scale);
            const x = Math.floor(startX + index * (buttonW + this.groupSpacingX) * scale);
            const y = Math.floor(startY);
            card.container.setPosition(x, y);

            card.button.setPosition(0, 0);

            const iconSize = this.getIconSize(card.icon.texture.key);
            const iconX = Math.floor((buttonW - iconSize.width) / 2);
            const iconY = Math.floor((buttonH - iconSize.height) / 2) + this.iconOffsetY;
            card.icon.setPosition(iconX, iconY);

            card.button.setDisplaySize(buttonW, buttonH);
        });

        if (this.selectedLabel) {
            const totalWidth = this.cards.length * buttonW + (this.cards.length - 1) * this.groupSpacingX;
            const labelWidth = this.getLabelWidth(this.selectedLabel.texture.key);
            const labelX = Math.floor(startX + (totalWidth - labelWidth) * scale);
            const labelY = Math.floor(startY + (buttonH + this.selectedLabelOffsetY) * scale);
            this.selectedLabel.setPosition(labelX, labelY);
            this.selectedLabel.setScale(scale);
        }
    }

    private createCards() {
        const defs: Array<{ key: GroupKey; labelKey: string; fallbackLabel: string }> = [
            { key: 'All', labelKey: 'inventory.groups.All', fallbackLabel: 'All' },
            { key: 'Gear', labelKey: 'inventory.groups.Gear', fallbackLabel: 'Gear' },
            { key: 'Tools', labelKey: 'inventory.groups.Tools', fallbackLabel: 'Tools' },
            { key: 'Fishing', labelKey: 'inventory.groups.Fishing', fallbackLabel: 'Fishing' },
            { key: 'Food', labelKey: 'inventory.groups.Food', fallbackLabel: 'Food' }
        ];

        defs.forEach((def) => {
            const button = this.scene.add.image(0, 0, this.getButtonTexture(false)).setOrigin(0, 0);
            const icon = this.scene.add.image(0, 0, this.getIconTexture(def.key, false)).setOrigin(0, 0);

            button.setInteractive({ useHandCursor: true });
            button.on('pointerdown', () => this.setActiveGroup(def.key));
            icon.setInteractive({ useHandCursor: true });
            icon.on('pointerdown', () => this.setActiveGroup(def.key));

            const container = this.scene.add.container(0, 0, [button, icon]);
            this.container.add(container);

            this.cards.push({
                key: def.key,
                label: this.localeManager.t(def.labelKey, undefined, def.fallbackLabel),
                container,
                button,
                icon
            });
        });

        const activeLabel = this.localeManager.t(`inventory.groups.${this.activeGroup}`, undefined, this.activeGroup);
        const labelTexture = this.createLabelTexture(activeLabel, false);
        this.selectedLabelKey = labelTexture;
        this.selectedLabel = this.scene.add.image(0, 0, labelTexture).setOrigin(0, 0);
        this.container.add(this.selectedLabel);
    }

    setActiveGroup(key: GroupKey, force = false) {
        if (!force && this.activeGroup === key) return;
        this.activeGroup = key;
        this.cards.forEach((card) => {
            const isActive = card.key === key;
            card.button.setTexture(this.getButtonTexture(isActive));
            card.icon.setTexture(this.getIconTexture(card.key, isActive));
        });

        if (this.selectedLabel) {
            const activeLabel = this.localeManager.t(`inventory.groups.${this.activeGroup}`, undefined, this.activeGroup);
            const newLabelTexture = this.createLabelTexture(activeLabel, false);
            const oldKey = this.selectedLabelKey;
            this.selectedLabelKey = newLabelTexture;
            this.selectedLabel.setTexture(newLabelTexture);
            if (oldKey && this.scene.textures.exists(oldKey)) {
                this.scene.textures.remove(oldKey);
            }
        }

        if (this.lastLayout) {
            this.layout(this.lastLayout.leftPageLeftEdgeX, this.lastLayout.leftPageTopEdgeY, this.lastLayout.scale);
        }

        this.onGroupChange?.(key);
    }

    refreshLabels() {
        this.cards.forEach((card) => {
            card.label = this.localeManager.t(`inventory.groups.${card.key}`, undefined, card.key);
        });

        if (this.selectedLabel) {
            const newLabelTexture = this.createLabelTexture(this.localeManager.t(`inventory.groups.${this.activeGroup}`, undefined, this.activeGroup), false);
            const oldKey = this.selectedLabelKey;
            this.selectedLabelKey = newLabelTexture;
            this.selectedLabel.setTexture(newLabelTexture);
            if (oldKey && this.scene.textures.exists(oldKey)) {
                this.scene.textures.remove(oldKey);
            }
        }

        if (this.lastLayout) {
            this.layout(this.lastLayout.leftPageLeftEdgeX, this.lastLayout.leftPageTopEdgeY, this.lastLayout.scale);
        }
    }

    destroy() {
        if (this.localeChangedHandler) {
            window.removeEventListener('locale:changed', this.localeChangedHandler as EventListener);
            this.localeChangedHandler = undefined;
        }
        this.container.destroy();
    }

    private getIconTexture(key: GroupKey, active: boolean): string {
        const suffix = active ? '-sel' : '';
        return `ui-section-icon-${key.toLowerCase()}${suffix}`;
    }

    private getButtonTexture(active: boolean): string {
        return active ? 'ui-group-button-selected' : 'ui-group-button-unselected';
    }

    private getIconSize(textureKey: string) {
        const texture = this.scene.textures.get(textureKey);
        const image = texture.getSourceImage() as HTMLImageElement;
        return { width: image.width, height: image.height };
    }

    private getLabelWidth(textureKey: string) {
        const texture = this.scene.textures.get(textureKey);
        const image = texture.getSourceImage() as HTMLImageElement;
        return image.width;
    }

    private createLabelTexture(text: string, active: boolean) {
        const width = this.measureBitmapTextWidth(text);
        const height = this.fontCharSize;
        const color = active ? '#cfd8e5' : '#4b3435';

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        this.fontRenderer.drawText(ctx, text, 0, 0, { charGap: this.fontCharGap });

        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__inv_group_label_${this.labelTextureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    private measureBitmapTextWidth(text: string): number {
        return this.fontRenderer.measureTextWidth(text, { charGap: this.fontCharGap });
    }
}
