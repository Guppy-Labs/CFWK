import Phaser from 'phaser';
import { DEFAULT_USER_SETTINGS, IAudioSettings, IUserSettings } from '@cfwk/shared';
import { NetworkManager } from '../../network/NetworkManager';
import { SettingsFont } from './SettingsFont';
import { SettingsSectionList, SettingsSectionKey } from './SettingsSectionList';
import { SettingsSoundPanel } from './SettingsSoundPanel';

export class SettingsTabUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private sectionList: SettingsSectionList;
    private soundPanel: SettingsSoundPanel;
    private placeholderImage?: Phaser.GameObjects.Image;
    private titleImage?: Phaser.GameObjects.Image;
    private titleTextureKey?: string;
    private settings: IUserSettings = { ...DEFAULT_USER_SETTINGS, audio: { ...DEFAULT_USER_SETTINGS.audio } };
    private settingsLoaded = false;
    private saveTimer?: Phaser.Time.TimerEvent;
    private networkManager = NetworkManager.getInstance();
    private font: SettingsFont;
    private activeSection: SettingsSectionKey = 'Sounds';
    private readonly titleOffsetX = 10;
    private readonly titleOffsetY = 10;
    private readonly titleScale = 1.25;
    private readonly contentOffsetY = 26;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
        this.scene = scene;
        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.font = new SettingsFont(scene);

        this.sectionList = new SettingsSectionList(scene, this.container);
        this.sectionList.setOnSectionChange((section) => this.setActiveSection(section));
        this.sectionList.setOnAction((action) => {
            console.log('[Settings] Action selected:', action);
        });

        this.soundPanel = new SettingsSoundPanel(scene, this.container, {
            onAudioChange: (key, value) => this.updateAudioSetting(key, value),
            onToggleChange: (key, value) => this.updateToggleSetting(key, value)
        });

        this.titleTextureKey = this.font.createTextTexture(this.activeSection, '#4b3435');
        this.titleImage = this.scene.add.image(0, 0, this.titleTextureKey).setOrigin(0, 0);
        this.container.add(this.titleImage);

        const placeholderKey = this.font.createTextTexture('Section coming soon', '#4b3435');
        this.placeholderImage = this.scene.add.image(0, 0, placeholderKey).setOrigin(0, 0);
        this.container.add(this.placeholderImage);

        this.setActiveSection(this.activeSection, true);
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
        if (visible) {
            this.ensureLoaded();
        }
    }

    layout(leftPageLeftEdgeX: number, leftPageTopEdgeY: number, rightPageLeftEdgeX: number, rightPageTopEdgeY: number, scale: number) {
        this.sectionList.layout(leftPageLeftEdgeX, leftPageTopEdgeY, scale);
        this.soundPanel.layout(rightPageLeftEdgeX, rightPageTopEdgeY + this.contentOffsetY * scale, scale);

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
        const isSounds = section === 'Sounds';
        this.soundPanel.setVisible(isSounds);
        if (this.placeholderImage) {
            this.placeholderImage.setVisible(!isSounds);
        }
    }

    private updateTitle(section: SettingsSectionKey) {
        if (!this.titleImage) return;
        const titleKey = this.font.createTextTexture(section, '#4b3435');
        this.titleTextureKey = titleKey;
        this.titleImage.setTexture(titleKey);
    }

    private ensureLoaded() {
        if (this.settingsLoaded) return;
        this.settingsLoaded = true;

        this.networkManager.getSettings().then((settings) => {
            if (settings) {
                this.settings = { ...settings, audio: { ...settings.audio } };
            }
            this.soundPanel.setValues(this.settings.audio);
            this.applyAudioSettings(this.settings.audio);
        });
    }

    private updateAudioSetting(key: keyof IAudioSettings, value: number) {
        if (typeof this.settings.audio[key] !== 'number') return;
        (this.settings.audio[key] as number) = value;
        this.applyAudioSettings(this.settings.audio);
        this.scheduleSave();
    }

    private updateToggleSetting(key: keyof IAudioSettings, value: boolean) {
        if (typeof this.settings.audio[key] !== 'boolean') return;
        (this.settings.audio[key] as boolean) = value;
        this.applyAudioSettings(this.settings.audio);
        this.scheduleSave();
    }

    private applyAudioSettings(audio: IAudioSettings) {
        const gameScene = this.scene.scene.get('GameScene') as { getAudioManager?: () => { applyUserAudioSettings?: (settings: IAudioSettings) => void } | undefined };
        const audioManager = gameScene?.getAudioManager?.();
        audioManager?.applyUserAudioSettings?.(audio);
    }

    private scheduleSave() {
        this.saveTimer?.remove(false);
        this.saveTimer = this.scene.time.delayedCall(400, () => {
            this.networkManager.updateSettings(this.settings).then((next) => {
                if (next) {
                    this.settings = { ...next, audio: { ...next.audio } };
                }
            });
        });
    }

    destroy() {
        this.saveTimer?.remove(false);
        this.soundPanel.destroy();
        this.container.destroy();
    }
}
