import Phaser from 'phaser';
import { IPlayerStatsResponse, PLAYER_STAT_KEYS, PlayerStatKey } from '@cfwk/shared';
import { SettingsFont } from './SettingsFont';

type StatsRowConfig = {
    key: PlayerStatKey;
    labelKey: string;
    fallbackLabel: string;
};

type StatsRowUi = {
    key: PlayerStatKey;
    labelImage: Phaser.GameObjects.Image;
    valueImage?: Phaser.GameObjects.Image;
    rankImage?: Phaser.GameObjects.Image;
};

type SettingsStatisticsPanelConfig = {
    resolveLabel?: (key: string, fallback: string, params?: Record<string, string | number>) => string;
};

export class SettingsStatisticsPanel {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private font: SettingsFont;
    private resolveLabel?: (key: string, fallback: string, params?: Record<string, string | number>) => string;
    private rows: StatsRowUi[] = [];

    private readonly rowGap = 14;
    private readonly labelOffsetX = 10;
    private readonly pageWidth = 147;
    private readonly rightInset = 10;
    private readonly valueRankGap = 6;
    private readonly valueOffsetY = 1;
    private readonly defaultTextColor = '#4b3435';
    private readonly rankGreenColor = '#59b86e';
    private readonly rankBlueColor = '#4f79d9';
    private readonly rankPurpleColor = '#7a59c9';
    private readonly rankBronzeColor = '#cd7f32';
    private readonly rankSilverColor = '#c0c0c0';
    private readonly rankGoldColor = '#ffd700';

    private readonly rowsConfig: StatsRowConfig[] = [
        { key: 'distanceWalked', labelKey: 'settings.stats.distanceWalked', fallbackLabel: 'Walked' },
        { key: 'distanceRan', labelKey: 'settings.stats.distanceRan', fallbackLabel: 'Ran' },
        { key: 'timeOnlineMs', labelKey: 'settings.stats.timeOnlineMs', fallbackLabel: 'Online' },
        { key: 'catches', labelKey: 'settings.stats.catches', fallbackLabel: 'Catches' },
        { key: 'npcInteractions', labelKey: 'settings.stats.npcInteractions', fallbackLabel: 'Interactions' }
    ];

    private lastLayout?: {
        rightPageLeftEdgeX: number;
        rightPageTopEdgeY: number;
        contentOffsetY: number;
        scale: number;
    };

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, config?: SettingsStatisticsPanelConfig) {
        this.scene = scene;
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.font = new SettingsFont(scene);
        this.resolveLabel = config?.resolveLabel;

        this.createRows();
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    layout(rightPageLeftEdgeX: number, rightPageTopEdgeY: number, contentOffsetY: number, scale: number) {
        this.lastLayout = { rightPageLeftEdgeX, rightPageTopEdgeY, contentOffsetY, scale };

        const baseX = Math.floor(rightPageLeftEdgeX + this.labelOffsetX * scale);
        const baseY = Math.floor(rightPageTopEdgeY + contentOffsetY * scale);
        const rightAnchorX = Math.floor(rightPageLeftEdgeX + (this.pageWidth - this.rightInset) * scale);

        this.rows.forEach((row, index) => {
            const rowY = baseY + Math.round(index * this.rowGap * scale);
            row.labelImage.setPosition(baseX, rowY);
            row.labelImage.setScale(scale);

            const valueY = rowY + Math.floor(this.valueOffsetY * scale);
            const valueWidth = row.valueImage ? row.valueImage.width * scale : 0;
            const rankWidth = row.rankImage ? row.rankImage.width * scale : 0;
            const gapWidth = row.rankImage ? this.valueRankGap * scale : 0;
            const blockWidth = valueWidth + gapWidth + rankWidth;
            const valueX = Math.floor(rightAnchorX - blockWidth);

            if (row.valueImage) {
                row.valueImage.setPosition(valueX, valueY);
                row.valueImage.setScale(scale);
            }

            if (row.rankImage) {
                row.rankImage.setPosition(Math.floor(valueX + valueWidth + gapWidth), valueY);
                row.rankImage.setScale(scale);
            }
        });
    }

    refreshLabels() {
        this.rows.forEach((row) => {
            const config = this.rowsConfig.find((entry) => entry.key === row.key);
            if (!config) return;
            const label = this.t(config.labelKey, config.fallbackLabel);
            row.labelImage.setTexture(this.font.createTextTexture(label, this.defaultTextColor));
        });
    }

    getContentHeight(): number {
        return this.rows.length * this.rowGap + 8;
    }

    render(data: IPlayerStatsResponse) {
        this.rows.forEach((row) => {
            if (row.valueImage) {
                row.valueImage.destroy();
                row.valueImage = undefined;
            }
            if (row.rankImage) {
                row.rankImage.destroy();
                row.rankImage = undefined;
            }

            const valueText = this.formatStatValue(row.key, data.stats[row.key]);
            const valueTexture = this.font.createTextTexture(valueText, this.defaultTextColor);
            row.valueImage = this.scene.add.image(0, 0, valueTexture).setOrigin(0, 0);
            this.container.add(row.valueImage);

            const rank = data.ranks[row.key];
            if (typeof rank === 'number' && rank >= 1 && rank <= 999) {
                const rankTexture = this.font.createTextTexture(`(#${rank})`, this.getRankColor(rank));
                row.rankImage = this.scene.add.image(0, 0, rankTexture).setOrigin(0, 0);
                this.container.add(row.rankImage);
            }
        });

        if (this.lastLayout) {
            this.layout(
                this.lastLayout.rightPageLeftEdgeX,
                this.lastLayout.rightPageTopEdgeY,
                this.lastLayout.contentOffsetY,
                this.lastLayout.scale
            );
        }
    }

    destroy() {
        this.container.destroy();
    }

    private createRows() {
        this.rows = PLAYER_STAT_KEYS.map((key) => {
            const config = this.rowsConfig.find((entry) => entry.key === key);
            const labelText = this.t(config?.labelKey ?? key, config?.fallbackLabel ?? key);
            const labelTexture = this.font.createTextTexture(labelText, this.defaultTextColor);
            const labelImage = this.scene.add.image(0, 0, labelTexture).setOrigin(0, 0);
            this.container.add(labelImage);

            return {
                key,
                labelImage
            };
        });
    }

    private formatStatValue(key: PlayerStatKey, value: number): string {
        if (key === 'timeOnlineMs') {
            return this.formatDuration(value);
        }

        if (key === 'distanceWalked' || key === 'distanceRan') {
            return this.t('settings.stats.meters', '{value} m', { value: Math.round(value / 10) });
        }

        const normalized = Math.max(0, Math.floor(value));
        return normalized.toLocaleString();
    }

    private formatDuration(ms: number): string {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
        }

        if (minutes > 0) {
            return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
        }

        return `${seconds}s`;
    }

    private getRankColor(rank: number): string {
        if (rank === 1) return this.rankGoldColor;
        if (rank === 2) return this.rankSilverColor;
        if (rank === 3) return this.rankBronzeColor;

        if (rank >= 4 && rank <= 100) {
            const t = (100 - rank) / (100 - 4);
            return this.interpolateHexColor(this.rankBlueColor, this.rankPurpleColor, t);
        }

        if (rank >= 101 && rank <= 999) {
            const t = (999 - rank) / (999 - 101);
            return this.interpolateHexColor(this.defaultTextColor, this.rankGreenColor, t);
        }

        return this.defaultTextColor;
    }

    private interpolateHexColor(fromHex: string, toHex: string, t: number): string {
        const clamped = Math.max(0, Math.min(1, t));
        const from = this.hexToRgb(fromHex);
        const to = this.hexToRgb(toHex);

        const r = Math.round(from.r + (to.r - from.r) * clamped);
        const g = Math.round(from.g + (to.g - from.g) * clamped);
        const b = Math.round(from.b + (to.b - from.b) * clamped);

        return `#${this.toHex(r)}${this.toHex(g)}${this.toHex(b)}`;
    }

    private hexToRgb(hex: string): { r: number; g: number; b: number } {
        const normalized = hex.replace('#', '');
        const value = Number.parseInt(normalized, 16);
        return {
            r: (value >> 16) & 255,
            g: (value >> 8) & 255,
            b: value & 255
        };
    }

    private toHex(value: number): string {
        return value.toString(16).padStart(2, '0');
    }

    private t(key: string, fallback: string, params?: Record<string, string | number>) {
        return this.resolveLabel ? this.resolveLabel(key, fallback, params) : fallback;
    }
}
