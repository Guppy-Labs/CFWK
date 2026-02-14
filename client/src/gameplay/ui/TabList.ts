import Phaser from 'phaser';
import { LocaleManager } from '../i18n/LocaleManager';

export type TabListEntry = {
    name: string;
    isLocal: boolean;
};

export class TabList {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private background: Phaser.GameObjects.Rectangle;
    private titleText: Phaser.GameObjects.Text;
    private playerTexts: Phaser.GameObjects.Text[] = [];
    private players: TabListEntry[] = [];
    private localeManager = LocaleManager.getInstance();
    private localeChangedHandler?: (event: Event) => void;

    private readonly padding = 12;
    private readonly rowHeight = 20;
    private readonly headerHeight = 26;
    private readonly minWidth = 260;
    private readonly maxWidth = 380;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;

        this.background = this.scene.add.rectangle(0, 0, this.minWidth, 100, 0x000000, 0.6);
        this.background.setOrigin(0.5, 0.5);

        this.titleText = this.scene.add.text(0, 0, this.localeManager.t('headbar.playersOnline', undefined, 'Players Online'), {
            fontFamily: 'Minecraft, monospace',
            fontSize: '16px',
            color: '#ffffff'
        }).setOrigin(0.5, 0.5);

        this.container = this.scene.add.container(0, 0, [this.background, this.titleText]);
        this.container.setDepth(10000);
        this.container.setVisible(false);

        this.localeChangedHandler = () => {
            this.titleText.setText(this.localeManager.t('headbar.playersOnline', undefined, 'Players Online'));
            this.render();
        };
        window.addEventListener('locale:changed', this.localeChangedHandler as EventListener);

        // Initial render to set correct position and size
        this.render();
    }

    setPlayers(players: TabListEntry[]) {
        this.players = players.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        this.render();
    }

    getPlayerCount(): number {
        return this.players.length;
    }

    show() {
        // Update position in case window size changed
        const centerX = this.scene.scale.width / 2;
        const topY = this.padding + this.background.height / 2 + 8;
        this.container.setPosition(centerX, topY);
        
        this.container.setVisible(true);
    }

    hide() {
        this.container.setVisible(false);
    }

    destroy() {
        if (this.localeChangedHandler) {
            window.removeEventListener('locale:changed', this.localeChangedHandler as EventListener);
            this.localeChangedHandler = undefined;
        }

        this.clearPlayerTexts();
        this.titleText.destroy();
        this.background.destroy();
        this.container.destroy();
    }

    private clearPlayerTexts() {
        this.playerTexts.forEach((text) => text.destroy());
        this.playerTexts = [];
    }

    private render() {
        this.clearPlayerTexts();

        const width = this.computeWidth();
        const height = this.computeHeight();

        this.background.setSize(width, height);

        const centerX = this.scene.scale.width / 2;
        const topY = this.padding + height / 2 + 8;
        this.container.setPosition(centerX, topY);

        const headerY = -height / 2 + this.padding + this.headerHeight / 2;
        this.titleText.setPosition(0, headerY);

        const listStartY = -height / 2 + this.padding + this.headerHeight + 6;

        this.players.forEach((player, index) => {
            const color = player.isLocal ? '#ffd86b' : '#ffffff';
            const text = this.scene.add.text(
                -width / 2 + this.padding,
                listStartY + index * this.rowHeight,
                player.name,
                {
                    fontFamily: 'Minecraft, monospace',
                    fontSize: '14px',
                    color
                }
            );
            text.setOrigin(0, 0);
            this.container.add(text);
            this.playerTexts.push(text);
        });
    }

    private computeWidth(): number {
        let maxNameWidth = 0;
        this.players.forEach((player) => {
            const temp = this.scene.add.text(0, 0, player.name, {
                fontFamily: 'Minecraft, monospace',
                fontSize: '14px'
            }).setVisible(false);
            maxNameWidth = Math.max(maxNameWidth, temp.width);
            temp.destroy();
        });

        const totalWidth = Math.max(this.minWidth, maxNameWidth + this.padding * 2);
        return Math.min(this.maxWidth, totalWidth);
    }

    private computeHeight(): number {
        const rows = Math.max(1, this.players.length);
        return this.padding * 2 + this.headerHeight + 6 + rows * this.rowHeight;
    }
}
