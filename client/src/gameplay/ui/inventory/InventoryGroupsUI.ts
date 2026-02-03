import Phaser from 'phaser';

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

    // Layout controls (tweak these for micro-adjustments)
    private groupOffsetX = 9;
    private groupOffsetY = 4;
    private groupSpacingX = 1;
    private iconOffsetY = -1;
    private selectedLabelOffsetY = 4;

    private readonly fontCharSize = 8;
    private readonly fontCharGap = 1;
    private readonly fontMap = [
        '                ',
        '                ',
        ' !"#$%&\'()*+,-./',
        '0123456789:;<=>?',
        '@ABCDEFGHIJKLMNO',
        'PQRSTUVWXYZ[\\]^_',
        '`abcdefghijklmno',
        'pqrstuvwxyz{|}~ '
    ];
    private fontGlyphWidths = new Map<string, number>();
    private labelTextureCounter = 0;
    private selectedLabel?: Phaser.GameObjects.Image;
    private selectedLabelKey?: string;

    private readonly buttonWidth = 26;
    private readonly buttonHeight = 18;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
        this.scene = scene;
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

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
        const defs: Array<{ key: GroupKey; label: string }> = [
            { key: 'All', label: 'All' },
            { key: 'Gear', label: 'Gear' },
            { key: 'Tools', label: 'Tools' },
            { key: 'Fishing', label: 'Fishing' },
            { key: 'Food', label: 'Food' }
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
                label: def.label,
                container,
                button,
                icon
            });
        });

        const labelTexture = this.createLabelTexture(this.activeGroup, false);
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
            const newLabelTexture = this.createLabelTexture(this.activeGroup, false);
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
        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;

        const width = this.measureBitmapTextWidth(text);
        const height = this.fontCharSize;
        const color = active ? '#cfd8e5' : '#4b3435';

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        let cursorX = 0;
        for (const ch of text) {
            const pos = this.findGlyph(ch);
            if (pos) {
                const sx = pos.col * this.fontCharSize;
                const sy = pos.row * this.fontCharSize;
                ctx.drawImage(fontImage, sx, sy, this.fontCharSize, this.fontCharSize, cursorX, 0, this.fontCharSize, this.fontCharSize);

                const glyphWidth = this.getGlyphWidth(fontImage, ch);
                cursorX += glyphWidth + this.fontCharGap;
            } else {
                cursorX += this.fontCharSize + this.fontCharGap;
            }
        }

        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const key = `__inv_group_label_${this.labelTextureCounter++}`;
        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    private findGlyph(ch: string) {
        for (let row = 0; row < this.fontMap.length; row++) {
            const col = this.fontMap[row].indexOf(ch);
            if (col !== -1) return { row, col };
        }
        return null;
    }

    private measureBitmapTextWidth(text: string): number {
        if (!text.length) return 0;

        const fontTexture = this.scene.textures.get('ui-font');
        const fontImage = fontTexture.getSourceImage() as HTMLImageElement;

        let width = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const glyphWidth = this.getGlyphWidth(fontImage, ch);
            width += glyphWidth;
            if (i < text.length - 1) width += this.fontCharGap;
        }
        return width;
    }

    private getGlyphWidth(fontImage: HTMLImageElement, ch: string): number {
        if (this.fontGlyphWidths.has(ch)) {
            return this.fontGlyphWidths.get(ch)!;
        }

        const pos = this.findGlyph(ch);
        if (!pos) {
            this.fontGlyphWidths.set(ch, this.fontCharSize);
            return this.fontCharSize;
        }

        const canvas = document.createElement('canvas');
        canvas.width = this.fontCharSize;
        canvas.height = this.fontCharSize;
        const ctx = canvas.getContext('2d')!;

        const sx = pos.col * this.fontCharSize;
        const sy = pos.row * this.fontCharSize;
        ctx.drawImage(fontImage, sx, sy, this.fontCharSize, this.fontCharSize, 0, 0, this.fontCharSize, this.fontCharSize);

        const data = ctx.getImageData(0, 0, this.fontCharSize, this.fontCharSize).data;
        let rightmost = -1;
        for (let x = this.fontCharSize - 1; x >= 0; x--) {
            let hasPixel = false;
            for (let y = 0; y < this.fontCharSize; y++) {
                const idx = (y * this.fontCharSize + x) * 4 + 3;
                if (data[idx] > 0) {
                    hasPixel = true;
                    break;
                }
            }
            if (hasPixel) {
                rightmost = x;
                break;
            }
        }

        const width = Math.max(1, rightmost + 1);
        this.fontGlyphWidths.set(ch, width);
        return width;
    }
}
