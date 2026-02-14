import Phaser from 'phaser';
import { CONTROL_ACTION_KEYS, DEFAULT_USER_SETTINGS, IAudioSettings, IPlayerStats, IPlayerStatsDelta, IPlayerStatsResponse, IVideoSettings, PLAYER_STAT_KEYS, IUserSettings, VideoQualityPreset } from '@cfwk/shared';
import { NetworkManager } from '../../network/NetworkManager';
import { LocaleManager } from '../../i18n/LocaleManager';
import { SettingsFont } from './SettingsFont';
import { SettingsSectionList, SettingsSectionKey } from './SettingsSectionList';
import { SettingsLanguagePanel } from './SettingsLanguagePanel';
import { SettingsSoundPanel } from './SettingsSoundPanel';
import { SettingsVideoPanel } from './SettingsVideoPanel';
import { SettingsStatisticsPanel } from './SettingsStatisticsPanel';
import { SettingsControlsPanel } from './SettingsControlsPanel';
import { FullscreenManager } from '../FullscreenManager';
import { KeybindManager } from '../../input/KeybindManager';

export class SettingsTabUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private contentContainer: Phaser.GameObjects.Container;
    private sectionList: SettingsSectionList;
    private soundPanel: SettingsSoundPanel;
    private languagePanel: SettingsLanguagePanel;
    private videoPanel: SettingsVideoPanel;
    private controlsPanel: SettingsControlsPanel;
    private statisticsPanel: SettingsStatisticsPanel;
    private placeholderImage?: Phaser.GameObjects.Image;
    private statsLoaded = false;
    private statsLoading = false;
    private currentStats?: IPlayerStatsResponse;
    private statsDeltaUnsubscribe?: () => void;
    private statsRefreshTimer?: Phaser.Time.TimerEvent;
    private titleImage?: Phaser.GameObjects.Image;
    private titleTextureKey?: string;
    private contentMaskGraphics: Phaser.GameObjects.Graphics;
    private contentMask?: Phaser.Display.Masks.GeometryMask;
    private wheelHandler?: (pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => void;
    private pointerDownHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerMoveHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerUpHandler?: (pointer: Phaser.Input.Pointer) => void;
    private contentViewportBounds?: Phaser.Geom.Rectangle;
    private scrollOffset = 0;
    private maxScrollOffset = 0;
    private touchScrollPointerId?: number;
    private touchScrollLastY = 0;
    private settings: IUserSettings = {
        ...DEFAULT_USER_SETTINGS,
        audio: { ...DEFAULT_USER_SETTINGS.audio },
        video: { ...DEFAULT_USER_SETTINGS.video },
        controls: { ...DEFAULT_USER_SETTINGS.controls }
    };
    private settingsLoaded = false;
    private saveTimer?: Phaser.Time.TimerEvent;
    private saveRequestId = 0;
    private settingsRevision = 0;
    private lastLayoutScale = 1;
    private sessionFullscreenEnabled = FullscreenManager.isEnabled();
    private networkManager = NetworkManager.getInstance();
    private keybindManager = KeybindManager.getInstance();
    private localeManager = LocaleManager.getInstance();
    private font: SettingsFont;
    private activeSection: SettingsSectionKey = 'Sounds';
    private readonly titleOffsetX = 10;
    private readonly titleOffsetY = 10;
    private readonly titleScale = 1.25;
    private readonly contentOffsetY = 26;
    private readonly pageWidth = 147;
    private readonly contentViewportPaddingX = 6;
    private readonly contentViewportPaddingBottom = 8;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
        this.scene = scene;
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);
        this.contentContainer = this.scene.add.container(0, 0);
        this.container.add(this.contentContainer);
        this.contentMaskGraphics = this.scene.add.graphics();
        this.contentMaskGraphics.setVisible(false);
        this.contentMask = this.contentMaskGraphics.createGeometryMask();
        this.contentContainer.setMask(this.contentMask);

        this.font = new SettingsFont(scene);

        this.sectionList = new SettingsSectionList(scene, this.container, {
            resolveLabel: (key, fallback) => this.t(key, fallback)
        });
        this.sectionList.setOnSectionChange((section) => this.setActiveSection(section));
        this.sectionList.setOnAction((action) => {
            console.log('[Settings] Action selected:', action);
        });

        this.soundPanel = new SettingsSoundPanel(scene, this.contentContainer, {
            onAudioChange: (key, value) => this.updateAudioSetting(key, value),
            onToggleChange: (key, value) => this.updateToggleSetting(key, value),
            resolveLabel: (key, fallback) => this.t(key, fallback)
        });

        this.videoPanel = new SettingsVideoPanel(scene, this.contentContainer, {
            onVideoToggleChange: (key, value) => this.updateVideoToggleSetting(key, value),
            onQualityPresetChange: (preset) => this.updateVideoQualityPreset(preset),
            resolveLabel: (key, fallback) => this.t(key, fallback)
        });
        this.videoPanel.setVisible(false);

        this.languagePanel = new SettingsLanguagePanel(scene, this.contentContainer, {
            onLanguageSelect: (locale) => this.selectLanguage(locale)
        });
        this.languagePanel.setVisible(false);

        this.controlsPanel = new SettingsControlsPanel(scene, this.contentContainer, {
            onControlsChange: (controls) => this.updateControlsSettings(controls),
            resolveLabel: (key, fallback, params) => this.t(key, fallback, params)
        });
        this.controlsPanel.setVisible(false);

        this.statsDeltaUnsubscribe = this.networkManager.onPlayerStatsDelta((delta) => {
            this.applyStatsDelta(delta);
        });

        this.statisticsPanel = new SettingsStatisticsPanel(scene, this.contentContainer, {
            resolveLabel: (key, fallback, params) => this.t(key, fallback, params)
        });
        this.statisticsPanel.setVisible(false);

        const cachedSettings = this.networkManager.getCachedSettings();
        if (cachedSettings) {
            this.settings = {
                ...cachedSettings,
                audio: { ...cachedSettings.audio },
                video: {
                    ...cachedSettings.video,
                    fullscreen: this.sessionFullscreenEnabled
                },
                controls: { ...(cachedSettings.controls ?? DEFAULT_USER_SETTINGS.controls) }
            };
            this.keybindManager.hydrateFromSettings(this.settings);
            this.settingsLoaded = true;
            this.soundPanel.setValues(this.settings.audio);
            this.videoPanel.setValues(this.settings.video);
            this.applyAudioSettings(this.settings.audio);
            this.applyVideoSettings(this.settings.video);
        }

        this.titleTextureKey = this.font.createTextTexture(this.getSectionLabel(this.activeSection), '#4b3435');
        this.titleImage = this.scene.add.image(0, 0, this.titleTextureKey).setOrigin(0, 0);
        this.container.add(this.titleImage);

        const placeholderKey = this.font.createTextTexture(this.t('settings.placeholder', 'Section coming soon'), '#4b3435');
        this.placeholderImage = this.scene.add.image(0, 0, placeholderKey).setOrigin(0, 0);
        this.contentContainer.add(this.placeholderImage);

        this.wheelHandler = (pointer, _gameObjects, _deltaX, deltaY) => {
            if (!this.container.visible) return;
            if (!this.contentViewportBounds?.contains(pointer.x, pointer.y)) return;
            if (this.maxScrollOffset <= 0) return;

            this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset + deltaY * 0.5, 0, this.maxScrollOffset);
            this.updateContentScrollPosition();
        };
        this.pointerDownHandler = (pointer) => {
            if (!this.container.visible) return;
            if (this.maxScrollOffset <= 0) return;
            if (!this.contentViewportBounds?.contains(pointer.x, pointer.y)) return;

            this.touchScrollPointerId = pointer.id;
            this.touchScrollLastY = pointer.y;
        };
        this.pointerMoveHandler = (pointer) => {
            if (this.touchScrollPointerId !== pointer.id) return;
            if (!pointer.isDown) return;

            const deltaY = this.touchScrollLastY - pointer.y;
            this.touchScrollLastY = pointer.y;

            if (Math.abs(deltaY) < 0.5) return;

            this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset + deltaY, 0, this.maxScrollOffset);
            this.updateContentScrollPosition();
        };
        this.pointerUpHandler = (pointer) => {
            if (this.touchScrollPointerId !== pointer.id) return;
            this.touchScrollPointerId = undefined;
        };
        this.scene.input.on('wheel', this.wheelHandler);
        this.scene.input.on('pointerdown', this.pointerDownHandler);
        this.scene.input.on('pointermove', this.pointerMoveHandler);
        this.scene.input.on('pointerup', this.pointerUpHandler);
        this.scene.input.on('pointerupoutside', this.pointerUpHandler);

        this.setActiveSection(this.activeSection, true);
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
        if (visible) {
            this.ensureLoaded();
            if (this.activeSection === 'Statistics') {
                this.ensureStatsLoaded();
                this.startStatsRefreshLoop();
            }
        } else {
            this.touchScrollPointerId = undefined;
            this.stopStatsRefreshLoop();
        }
    }

    layout(leftPageLeftEdgeX: number, leftPageTopEdgeY: number, rightPageLeftEdgeX: number, rightPageTopEdgeY: number, pageHeight: number, scale: number) {
        this.lastLayoutScale = scale;
        this.sectionList.layout(leftPageLeftEdgeX, leftPageTopEdgeY, scale);
        this.updateContentViewport(rightPageLeftEdgeX, rightPageTopEdgeY, pageHeight, scale);
        this.soundPanel.layout(rightPageLeftEdgeX, rightPageTopEdgeY + this.contentOffsetY * scale, scale);
        this.videoPanel.layout(rightPageLeftEdgeX, rightPageTopEdgeY + this.contentOffsetY * scale, scale);
        this.languagePanel.layout(rightPageLeftEdgeX, rightPageTopEdgeY + this.contentOffsetY * scale, scale);
        this.controlsPanel.layout(rightPageLeftEdgeX, rightPageTopEdgeY + this.contentOffsetY * scale, scale);
        this.statisticsPanel.layout(rightPageLeftEdgeX, rightPageTopEdgeY, this.contentOffsetY, scale);
        this.updateScrollBounds(scale);
        this.updateContentScrollPosition();

        if (this.titleImage) {
            const titleX = Math.floor(rightPageLeftEdgeX + this.titleOffsetX * scale);
            const titleY = Math.floor(rightPageTopEdgeY + this.titleOffsetY * scale);
            this.titleImage.setScale(this.titleScale * scale);
            this.titleImage.setPosition(titleX, titleY);
        }

        if (this.placeholderImage) {
            const x = Math.floor(rightPageLeftEdgeX + 10 * scale);
            const y = Math.floor(rightPageTopEdgeY + this.contentOffsetY * scale);
            this.placeholderImage.setScale(scale);
            this.placeholderImage.setPosition(x, y);
        }
    }

    private setActiveSection(section: SettingsSectionKey, force = false) {
        if (!force && this.activeSection === section) return;
        this.activeSection = section;
        this.sectionList.setActiveSection(section, true, false);
        this.updateTitle(section);
        this.scrollOffset = 0;
        const isSounds = section === 'Sounds';
        const isVideo = section === 'Video';
        const isLanguage = section === 'Language';
        const isControls = section === 'Controls';
        const isStatistics = section === 'Statistics';
        this.soundPanel.setVisible(isSounds);
        this.videoPanel.setVisible(isVideo);
        this.languagePanel.setVisible(isLanguage);
        this.controlsPanel.setVisible(isControls);
        this.statisticsPanel.setVisible(isStatistics);
        if (this.placeholderImage) {
            this.placeholderImage.setVisible(!isSounds && !isVideo && !isStatistics && !isLanguage && !isControls);
        }
        if (isStatistics) {
            this.ensureStatsLoaded();
            this.startStatsRefreshLoop();
        } else {
            this.stopStatsRefreshLoop();
        }
        this.updateScrollBounds(this.lastLayoutScale);
        this.updateContentScrollPosition();
    }

    private updateTitle(section: SettingsSectionKey) {
        if (!this.titleImage) return;
        const titleKey = this.font.createTextTexture(this.getSectionLabel(section), '#4b3435');
        this.titleTextureKey = titleKey;
        this.titleImage.setTexture(titleKey);
    }

    private ensureLoaded() {
        if (this.settingsLoaded) return;
        this.settingsLoaded = true;

        this.networkManager.getSettings().then((settings) => {
            if (settings) {
                this.settings = {
                    ...settings,
                    audio: { ...settings.audio },
                    video: {
                        ...settings.video,
                        fullscreen: this.sessionFullscreenEnabled
                    },
                    controls: { ...(settings.controls ?? DEFAULT_USER_SETTINGS.controls) }
                };
            }
            this.keybindManager.hydrateFromSettings(this.settings);
            this.localeManager.setLocale(this.settings.language || 'en_US');
            this.soundPanel.setValues(this.settings.audio);
            this.videoPanel.setValues(this.settings.video);
            this.applyAudioSettings(this.settings.audio);
            this.applyVideoSettings(this.settings.video);
            this.refreshLocalizedUi();
        });
    }

    private selectLanguage(locale: string) {
        if (!locale || this.settings.language === locale) return;
        this.settings.language = locale;
        this.settingsRevision += 1;
        this.localeManager.setLocale(locale);
        this.refreshLocalizedUi();
        this.scheduleSave();
    }

    private updateAudioSetting(key: keyof IAudioSettings, value: number) {
        if (typeof this.settings.audio[key] !== 'number') return;
        (this.settings.audio[key] as number) = value;
        this.settingsRevision += 1;
        this.applyAudioSettings(this.settings.audio);
        this.scheduleSave();
    }

    private updateToggleSetting(key: keyof IAudioSettings, value: boolean) {
        if (typeof this.settings.audio[key] !== 'boolean') return;
        (this.settings.audio[key] as boolean) = value;
        this.settingsRevision += 1;
        this.applyAudioSettings(this.settings.audio);
        this.scheduleSave();
    }

    private updateVideoToggleSetting(key: keyof IVideoSettings, value: boolean) {
        if (typeof this.settings.video[key] !== 'boolean') return;
        if (this.settings.video[key] === value) return;

        if (key === 'fullscreen') {
            this.sessionFullscreenEnabled = value;
            (this.settings.video.fullscreen as boolean) = value;
            this.applyVideoSettings(this.settings.video);
            return;
        }

        (this.settings.video[key] as boolean) = value;
        this.settings.video.qualityPreset = 'custom';
        this.settingsRevision += 1;

        this.videoPanel.setValues(this.settings.video);
        this.applyVideoSettings(this.settings.video);
        this.scheduleSave();
    }

    private updateVideoQualityPreset(preset: VideoQualityPreset) {
        this.settings.video.qualityPreset = preset;
        this.applyPresetToVideoSettings(preset);
        this.settingsRevision += 1;
        this.videoPanel.setValues(this.settings.video);
        this.applyVideoSettings(this.settings.video);
        this.scheduleSave();
    }

    private updateControlsSettings(controls: IUserSettings['controls']) {
        const unchanged = CONTROL_ACTION_KEYS.every((action) => this.settings.controls[action] === controls[action]);
        if (unchanged) return;

        this.settings.controls = { ...controls };
        this.settingsRevision += 1;
        this.scheduleSave();
    }

    private applyAudioSettings(audio: IAudioSettings) {
        const gameScene = this.scene.scene.get('GameScene') as { getAudioManager?: () => { applyUserAudioSettings?: (settings: IAudioSettings) => void } | undefined };
        const audioManager = gameScene?.getAudioManager?.();
        audioManager?.applyUserAudioSettings?.(audio);
    }

    private applyVideoSettings(video: IVideoSettings) {
        const gameScene = this.scene.scene.get('GameScene') as { applyUserVideoSettings?: (settings: IVideoSettings) => void };
        gameScene?.applyUserVideoSettings?.(video);
    }

    private applyPresetToVideoSettings(preset: VideoQualityPreset) {
        switch (preset) {
            case 'low':
                this.settings.video.visualEffectsEnabled = false;
                this.settings.video.seasonalEffectsEnabled = false;
                this.settings.video.bloomEnabled = false;
                this.settings.video.vignetteEnabled = false;
                this.settings.video.tiltShiftEnabled = false;
                this.settings.video.dustParticlesEnabled = false;
                break;
            case 'medium':
                this.settings.video.visualEffectsEnabled = true;
                this.settings.video.seasonalEffectsEnabled = true;
                this.settings.video.bloomEnabled = false;
                this.settings.video.vignetteEnabled = true;
                this.settings.video.tiltShiftEnabled = false;
                this.settings.video.dustParticlesEnabled = true;
                break;
            case 'high':
                this.settings.video.visualEffectsEnabled = true;
                this.settings.video.seasonalEffectsEnabled = true;
                this.settings.video.bloomEnabled = true;
                this.settings.video.vignetteEnabled = true;
                this.settings.video.tiltShiftEnabled = true;
                this.settings.video.dustParticlesEnabled = true;
                break;
            case 'custom':
                break;
        }
    }

    private scheduleSave() {
        this.saveTimer?.remove(false);
        this.saveTimer = this.scene.time.delayedCall(400, () => {
            const requestId = ++this.saveRequestId;
            const revisionAtSend = this.settingsRevision;
            const settingsToPersist: IUserSettings = {
                ...this.settings,
                audio: { ...this.settings.audio },
                video: {
                    ...this.settings.video,
                    fullscreen: DEFAULT_USER_SETTINGS.video.fullscreen
                },
                controls: { ...(this.settings.controls ?? DEFAULT_USER_SETTINGS.controls) }
            };

            this.networkManager.updateSettings(settingsToPersist).then((next) => {
                if (requestId !== this.saveRequestId) return;
                if (revisionAtSend !== this.settingsRevision) return;
                if (next) {
                    this.settings = {
                        ...next,
                        audio: { ...next.audio },
                        video: {
                            ...next.video,
                            fullscreen: this.sessionFullscreenEnabled
                        },
                        controls: { ...(next.controls ?? DEFAULT_USER_SETTINGS.controls) }
                    };
                    this.keybindManager.hydrateFromSettings(this.settings);
                    this.soundPanel.setValues(this.settings.audio);
                    this.videoPanel.setValues(this.settings.video);
                    this.applyAudioSettings(this.settings.audio);
                    this.applyVideoSettings(this.settings.video);
                }
            });
        });
    }

    private updateContentViewport(rightPageLeftEdgeX: number, rightPageTopEdgeY: number, pageHeight: number, scale: number) {
        const viewportX = Math.floor(rightPageLeftEdgeX + this.contentViewportPaddingX * scale);
        const viewportY = Math.floor(rightPageTopEdgeY + this.contentOffsetY * scale);
        const viewportWidth = Math.floor((this.pageWidth - this.contentViewportPaddingX * 2) * scale);
        const viewportHeight = Math.max(1, Math.floor(pageHeight * scale - this.contentOffsetY * scale - this.contentViewportPaddingBottom * scale));

        this.contentViewportBounds = new Phaser.Geom.Rectangle(viewportX, viewportY, viewportWidth, viewportHeight);

        this.contentMaskGraphics.clear();
        this.contentMaskGraphics.fillStyle(0xffffff, 1);
        this.contentMaskGraphics.fillRect(viewportX, viewportY, viewportWidth, viewportHeight);
    }

    private updateScrollBounds(scale = 1) {
        if (!this.contentViewportBounds) {
            this.maxScrollOffset = 0;
            this.scrollOffset = 0;
            return;
        }

        const viewportHeight = this.contentViewportBounds.height;
        const contentHeight = this.getActiveContentHeight() * scale;
        this.maxScrollOffset = Math.max(0, contentHeight - viewportHeight);
        this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset, 0, this.maxScrollOffset);
    }

    private getActiveContentHeight(): number {
        switch (this.activeSection) {
            case 'Sounds':
                return this.soundPanel.getContentHeight();
            case 'Video':
                return this.videoPanel.getContentHeight();
            case 'Language':
                return this.languagePanel.getContentHeight();
            case 'Controls':
                return this.controlsPanel.getContentHeight();
            case 'Statistics':
                return this.statisticsPanel.getContentHeight();
            default:
                return this.contentOffsetY + 16;
        }
    }

    private updateContentScrollPosition() {
        this.contentContainer.setY(-Math.round(this.scrollOffset));
    }

    private ensureStatsLoaded() {
        if (this.statsLoaded || this.statsLoading) return;
        this.statsLoading = true;

        this.networkManager.getPlayerStats().then((stats) => {
            if (!stats) return;
            this.statsLoaded = true;
            this.currentStats = {
                stats: { ...stats.stats },
                ranks: { ...stats.ranks }
            };
            this.statisticsPanel.render(stats);
            this.updateScrollBounds(this.lastLayoutScale);
            this.updateContentScrollPosition();
        }).finally(() => {
            this.statsLoading = false;
        });
    }

    private startStatsRefreshLoop() {
        if (this.statsRefreshTimer) return;
        this.statsRefreshTimer = this.scene.time.addEvent({
            delay: 5000,
            loop: true,
            callback: () => {
                if (!this.container.visible || this.activeSection !== 'Statistics') return;
                this.refreshStatsFromServer();
            }
        });
        this.refreshStatsFromServer();
    }

    private stopStatsRefreshLoop() {
        this.statsRefreshTimer?.remove(false);
        this.statsRefreshTimer = undefined;
    }

    private refreshStatsFromServer() {
        this.networkManager.getPlayerStats(true).then((stats) => {
            if (!stats) return;

            this.statsLoaded = true;
            this.currentStats = {
                stats: { ...stats.stats },
                ranks: { ...stats.ranks }
            };

            if (this.activeSection === 'Statistics') {
                this.statisticsPanel.render(this.currentStats);
                this.updateScrollBounds(this.lastLayoutScale);
                this.updateContentScrollPosition();
            }
        });
    }

    private applyStatsDelta(delta: IPlayerStatsDelta) {
        if (!this.currentStats) return;

        const nextStats: IPlayerStats = { ...this.currentStats.stats };
        let changed = false;

        PLAYER_STAT_KEYS.forEach((key) => {
            const amount = delta[key];
            if (!Number.isFinite(amount) || Number(amount) <= 0) return;
            nextStats[key] = Math.max(0, nextStats[key] + Number(amount));
            changed = true;
        });

        if (!changed) return;

        this.currentStats = {
            ...this.currentStats,
            stats: nextStats
        };

        if (this.activeSection === 'Statistics') {
            this.statisticsPanel.render(this.currentStats);
            this.updateScrollBounds(this.lastLayoutScale);
            this.updateContentScrollPosition();
        }
    }

    private refreshLocalizedUi() {
        this.sectionList.refreshLabels();
        this.soundPanel.refreshLabels();
        this.videoPanel.refreshLabels();
        this.languagePanel.refresh();
        this.controlsPanel.refreshLabels();
        this.statisticsPanel.refreshLabels();

        if (this.placeholderImage) {
            const textureKey = this.font.createTextTexture(this.t('settings.placeholder', 'Section coming soon'), '#4b3435');
            this.placeholderImage.setTexture(textureKey);
        }

        this.updateTitle(this.activeSection);

        if (this.currentStats) {
            this.statisticsPanel.render(this.currentStats);
        }
        this.updateScrollBounds(this.lastLayoutScale);
        this.updateContentScrollPosition();
    }

    private getSectionLabel(section: SettingsSectionKey) {
        return this.t(`settings.section.${section}`, section);
    }

    private t(key: string, fallback: string, params?: Record<string, string | number>) {
        return this.localeManager.t(key, params, fallback);
    }

    destroy() {
        this.saveTimer?.remove(false);
        this.stopStatsRefreshLoop();
        this.statsDeltaUnsubscribe?.();
        if (this.wheelHandler) {
            this.scene.input.off('wheel', this.wheelHandler);
            this.wheelHandler = undefined;
        }
        if (this.pointerDownHandler) {
            this.scene.input.off('pointerdown', this.pointerDownHandler);
            this.pointerDownHandler = undefined;
        }
        if (this.pointerMoveHandler) {
            this.scene.input.off('pointermove', this.pointerMoveHandler);
            this.pointerMoveHandler = undefined;
        }
        if (this.pointerUpHandler) {
            this.scene.input.off('pointerup', this.pointerUpHandler);
            this.scene.input.off('pointerupoutside', this.pointerUpHandler);
            this.pointerUpHandler = undefined;
        }
        this.soundPanel.destroy();
        this.videoPanel.destroy();
        this.languagePanel.destroy();
        this.controlsPanel.destroy();
        this.statisticsPanel.destroy();
        this.contentMaskGraphics.destroy();
        this.container.destroy();
    }
}
