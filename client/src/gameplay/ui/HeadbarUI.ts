import Phaser from 'phaser';
import { calculateWorldTime, Season } from '@cfwk/shared';
import { HeadbarTabList, TabListEntry } from './HeadbarTabList';
import { MobileControls } from './MobileControls';
import { LocaleManager } from '../i18n/LocaleManager';
import { BitmapFontRenderer } from './BitmapFontRenderer';

export type HeadbarConfig = {
    bannerTextureKey?: string;
    textColor?: string;
    /** Opacity when GUI is closed (gameplay) */
    gameplayAlpha?: number;
    /** Opacity when GUI is open */
    guiOpenAlpha?: number;
};

const DEFAULT_HEADBAR_CONFIG: Required<HeadbarConfig> = {
    bannerTextureKey: 'ui-headbar-banner',
    textColor: '#BABEC7',
    gameplayAlpha: 0.6,
    guiOpenAlpha: 1.0
};

const SEASON_TEXTURE_KEYS: Record<Season, string> = {
    [Season.Winter]: 'ui-season-winter',
    [Season.Spring]: 'ui-season-spring',
    [Season.Summer]: 'ui-season-summer',
    [Season.Autumn]: 'ui-season-autumn'
};

export class HeadbarUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private contentContainer: Phaser.GameObjects.Container; // For time/date/year content
    private banner: Phaser.GameObjects.Image;
    private hitArea?: Phaser.GameObjects.Rectangle;
    private seasonIcon: Phaser.GameObjects.Image;
    private timeText: Phaser.GameObjects.Image;
    private dateText: Phaser.GameObjects.Image;
    private yearText: Phaser.GameObjects.Image;

    private config: Required<HeadbarConfig>;
    private localeManager = LocaleManager.getInstance();

    private textureCounter = 0;
    private bannerTextureKey?: string;
    private timeTextureKey?: string;
    private dateTextureKey?: string;
    private yearTextureKey?: string;

    private lastTimeStr = '';
    private lastDateStr = '';
    private lastYearStr = '';
    private currentSeason: Season = Season.Winter;

    // Tab list integration
    private tabList: HeadbarTabList;
    private isTabListVisible = false;
    private isAnimating = false;
    private currentBannerWidth = 0;
    private currentBannerHeight = 0;

    // Font rendering
    private readonly fontCharSize = 8;
    private readonly fontRenderer: BitmapFontRenderer;

    // Layout dimensions
    private readonly iconSize = 64; // 32x32 scaled 2x
    private readonly iconPadding = 12;
    private readonly iconTextGap = 24; // Gap between icon and text
    private readonly textPaddingRight = 16;
    private readonly bannerHeight = 76; // Tighter fit around content
    private readonly bannerMinWidth = 220;
    private readonly textScale = 1.5; // Scale up text
    private readonly bannerScale = 1.5; // Scale up banner before nine-slicing
    private readonly scaledCharGap = 2; // Gap between characters at scaled size

    // Animation timing
    private readonly expandDuration = 200;
    private readonly fadeDuration = 150;

    constructor(scene: Phaser.Scene, config: HeadbarConfig = {}) {
        this.scene = scene;
        this.fontRenderer = new BitmapFontRenderer(scene, this.fontCharSize);
        this.config = {
            bannerTextureKey: config.bannerTextureKey ?? DEFAULT_HEADBAR_CONFIG.bannerTextureKey,
            textColor: config.textColor ?? DEFAULT_HEADBAR_CONFIG.textColor,
            gameplayAlpha: config.gameplayAlpha ?? DEFAULT_HEADBAR_CONFIG.gameplayAlpha,
            guiOpenAlpha: config.guiOpenAlpha ?? DEFAULT_HEADBAR_CONFIG.guiOpenAlpha
        };

        this.container = this.scene.add.container(0, 0);
        this.container.setDepth(1000);

        // Create banner texture (nine-slice stretched)
        this.currentBannerWidth = this.bannerMinWidth;
        this.currentBannerHeight = this.bannerHeight;
        this.bannerTextureKey = this.createBannerTexture(this.currentBannerWidth, this.currentBannerHeight);
        this.banner = this.scene.add.image(0, 0, this.bannerTextureKey).setOrigin(0.5, 0);

        // Invisible hit area for mobile toggling
        this.hitArea = this.scene.add.rectangle(0, 0, this.currentBannerWidth, this.currentBannerHeight, 0x000000, 0);
        this.hitArea.setOrigin(0.5, 0);

        // Content container for time/date/year (so we can fade it as a group)
        this.contentContainer = this.scene.add.container(0, 0);

        // Create season icon (scaled 2x)
        this.seasonIcon = this.scene.add.image(0, 0, SEASON_TEXTURE_KEYS[Season.Winter]).setOrigin(0, 0.5);
        this.seasonIcon.setScale(2);

        // Create time, date, and year text images
        this.timeTextureKey = this.createTextTexture('12:00 AM');
        this.timeText = this.scene.add.image(0, 0, this.timeTextureKey).setOrigin(1, 0.5);

        this.dateTextureKey = this.createTextTexture('Winter Day 1');
        this.dateText = this.scene.add.image(0, 0, this.dateTextureKey).setOrigin(1, 0.5);

        this.yearTextureKey = this.createTextTexture('Year 1');
        this.yearText = this.scene.add.image(0, 0, this.yearTextureKey).setOrigin(1, 0.5);

        this.contentContainer.add([this.seasonIcon, this.timeText, this.dateText, this.yearText]);
        this.container.add([this.hitArea, this.banner, this.contentContainer]);

        // Create tab list (initially hidden)
        this.tabList = new HeadbarTabList(this.scene, this.container, {
            textColor: this.config.textColor
        });

        // Set initial alpha based on guiOpen state
        const guiOpen = this.scene.registry.get('guiOpen') === true;
        this.container.setAlpha(guiOpen ? this.config.guiOpenAlpha : this.config.gameplayAlpha);

        // Listen for GUI open changes
        this.scene.registry.events.on('changedata-guiOpen', this.onGuiOpenChange, this);

        if (MobileControls.isMobileDevice()) {
            this.hitArea.setInteractive({ useHandCursor: false });
            this.hitArea.on('pointerdown', this.onHeadbarPointerDown, this);
        }

        this.layout();
    }

    private onGuiOpenChange = (_parent: any, value: boolean) => {
        // Don't change alpha if tab list is visible
        if (this.isTabListVisible) return;
        
        this.scene.tweens.add({
            targets: this.container,
            alpha: value ? this.config.guiOpenAlpha : this.config.gameplayAlpha,
            duration: 150,
            ease: 'Sine.easeOut'
        });
    };

    private onHeadbarPointerDown() {
        if (this.isAnimating) return;
        if (this.scene.registry.get('guiOpen') === true) return;
        if (this.scene.registry.get('chatFocused') === true) return;

        if (this.isTabListVisible) {
            this.hideTabList();
        } else {
            this.showTabList();
        }
    }

    /**
     * Set players for the tab list
     */
    setPlayers(players: TabListEntry[]) {
        this.tabList.setPlayers(players);
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    /**
     * Show the tab list with smooth animation
     */
    showTabList() {
        if (this.isTabListVisible || this.isAnimating) return;
        this.isTabListVisible = true;
        this.isAnimating = true;

        // Calculate expanded dimensions
        // Tab list starts at the top content area, so only grow if needed
        const tabListWidth = this.tabList.getRequiredWidth();
        const tabListHeight = this.tabList.getRequiredHeight();
        const expandedWidth = Math.max(this.bannerMinWidth, tabListWidth);
        // Only expand height if tab list needs more space than normal banner
        const expandedHeight = Math.max(this.bannerHeight, tabListHeight);

        // Fade out the time/date content
        this.scene.tweens.add({
            targets: this.contentContainer,
            alpha: 0,
            duration: this.fadeDuration,
            ease: 'Sine.easeOut'
        });

        // Animate banner expansion then fade in tab list
        this.scene.tweens.chain({
            tweens: [
                {
                    targets: this,
                    currentBannerWidth: expandedWidth,
                    currentBannerHeight: expandedHeight,
                    duration: this.expandDuration,
                    ease: 'Sine.easeInOut',
                    onUpdate: () => {
                        this.updateBannerTexture();
                        this.layoutTabList();
                    }
                },
                {
                    targets: this.tabList.getContainer(),
                    alpha: 1,
                    duration: this.fadeDuration,
                    ease: 'Sine.easeOut',
                    onComplete: () => {
                        this.isAnimating = false;
                    }
                }
            ]
        });
    }

    /**
     * Hide the tab list with smooth animation
     */
    hideTabList() {
        if (!this.isTabListVisible || this.isAnimating) return;
        this.isTabListVisible = false;
        this.isAnimating = true;

        const normalWidth = this.calculateNormalBannerWidth();
        const normalHeight = this.bannerHeight;

        // Animate: fade out tab list, shrink banner, fade in content
        this.scene.tweens.chain({
            tweens: [
                {
                    targets: this.tabList.getContainer(),
                    alpha: 0,
                    duration: this.fadeDuration,
                    ease: 'Sine.easeOut'
                },
                {
                    targets: this,
                    currentBannerWidth: normalWidth,
                    currentBannerHeight: normalHeight,
                    duration: this.expandDuration,
                    ease: 'Sine.easeInOut',
                    onUpdate: () => {
                        this.updateBannerTexture();
                        this.layoutNormalContent();
                    }
                },
                {
                    targets: this.contentContainer,
                    alpha: 1,
                    duration: this.fadeDuration,
                    ease: 'Sine.easeOut',
                    onComplete: () => {
                        this.isAnimating = false;
                    }
                }
            ]
        });
    }

    private updateBannerTexture() {
        const oldKey = this.bannerTextureKey;
        this.bannerTextureKey = this.createBannerTexture(
            Math.floor(this.currentBannerWidth),
            Math.floor(this.currentBannerHeight)
        );
        this.banner.setTexture(this.bannerTextureKey);
        this.updateHitArea();
        if (oldKey && oldKey !== this.bannerTextureKey && this.scene.textures.exists(oldKey)) {
            this.scene.textures.remove(oldKey);
        }
    }

    private updateHitArea() {
        if (!this.hitArea) return;
        this.hitArea.setSize(Math.floor(this.currentBannerWidth), Math.floor(this.currentBannerHeight));
    }

    private layoutTabList() {
        // Position tab list content starting at top content area (same as time/date)
        this.tabList.layout(Math.floor(this.currentBannerWidth), 0);
    }

    private layoutNormalContent() {
        const bannerWidth = Math.floor(this.currentBannerWidth);

        // Position icon on the left
        const iconX = -bannerWidth / 2 + this.iconPadding;
        const iconY = this.bannerHeight / 2;
        this.seasonIcon.setPosition(Math.floor(iconX), Math.floor(iconY));

        // Position text on the right, stacked vertically (3 lines)
        const textX = bannerWidth / 2 - this.textPaddingRight;
        const scaledFontSize = Math.floor(this.fontCharSize * this.textScale);
        const lineHeight = scaledFontSize + 3;
        const totalTextHeight = lineHeight * 3 - 3;
        const textStartY = (this.bannerHeight - totalTextHeight) / 2 + scaledFontSize / 2;

        this.timeText.setPosition(Math.floor(textX), Math.floor(textStartY));
        this.dateText.setPosition(Math.floor(textX), Math.floor(textStartY + lineHeight));
        this.yearText.setPosition(Math.floor(textX), Math.floor(textStartY + lineHeight * 2));
    }

    private calculateNormalBannerWidth(): number {
        const timeWidth = this.measureText(this.lastTimeStr || '12:00 AM');
        const fallbackDate = this.localeManager.t('headbar.datePattern', {
            season: this.localeManager.t('headbar.season.winter', undefined, 'Winter'),
            day: 1
        }, 'Winter Day 1');
        const fallbackYear = this.localeManager.t('headbar.yearPattern', { year: 1 }, 'Year 1');
        const dateWidth = this.measureText(this.lastDateStr || fallbackDate);
        const yearWidth = this.measureText(this.lastYearStr || fallbackYear);
        const maxTextWidth = Math.max(timeWidth, dateWidth, yearWidth);
        const contentWidth = this.iconPadding + this.iconSize + this.iconTextGap + maxTextWidth + this.textPaddingRight;
        return Math.max(this.bannerMinWidth, contentWidth);
    }

    update() {
        const worldTime = calculateWorldTime();

        // Format time in 12-hour format
        const hour12 = worldTime.hour % 12 || 12;
        const ampm = worldTime.hour < 12 ? 'AM' : 'PM';
        const timeStr = `${hour12}:${worldTime.minute.toString().padStart(2, '0')} ${ampm}`;

        // Format date as localized "Season Day X"
        const seasonLabel = this.getSeasonLabel(worldTime.season);
        const dateStr = this.localeManager.t('headbar.datePattern', {
            season: seasonLabel,
            day: worldTime.dayOfSeason
        }, `${worldTime.seasonName} Day ${worldTime.dayOfSeason}`);

        // Format year
        const yearStr = this.localeManager.t('headbar.yearPattern', { year: worldTime.year }, `Year ${worldTime.year}`);

        // Update time text if changed
        if (timeStr !== this.lastTimeStr) {
            this.lastTimeStr = timeStr;
            const oldKey = this.timeTextureKey;
            this.timeTextureKey = this.createTextTexture(timeStr);
            this.timeText.setTexture(this.timeTextureKey);
            if (oldKey && this.scene.textures.exists(oldKey)) {
                this.scene.textures.remove(oldKey);
            }
        }

        // Update date text if changed
        if (dateStr !== this.lastDateStr) {
            this.lastDateStr = dateStr;
            const oldKey = this.dateTextureKey;
            this.dateTextureKey = this.createTextTexture(dateStr);
            this.dateText.setTexture(this.dateTextureKey);
            if (oldKey && this.scene.textures.exists(oldKey)) {
                this.scene.textures.remove(oldKey);
            }
        }

        // Update year text if changed
        if (yearStr !== this.lastYearStr) {
            this.lastYearStr = yearStr;
            const oldKey = this.yearTextureKey;
            this.yearTextureKey = this.createTextTexture(yearStr);
            this.yearText.setTexture(this.yearTextureKey);
            if (oldKey && this.scene.textures.exists(oldKey)) {
                this.scene.textures.remove(oldKey);
            }
        }

        // Update season icon if changed
        if (worldTime.season !== this.currentSeason) {
            this.currentSeason = worldTime.season;
            this.seasonIcon.setTexture(SEASON_TEXTURE_KEYS[worldTime.season]);
        }
    }

    private getSeasonLabel(season: Season): string {
        switch (season) {
            case Season.Winter:
                return this.localeManager.t('headbar.season.winter', undefined, 'Winter');
            case Season.Spring:
                return this.localeManager.t('headbar.season.spring', undefined, 'Spring');
            case Season.Summer:
                return this.localeManager.t('headbar.season.summer', undefined, 'Summer');
            case Season.Autumn:
            default:
                return this.localeManager.t('headbar.season.autumn', undefined, 'Autumn');
        }
    }

    layout() {
        const screenWidth = this.scene.scale.width;

        // Only recalculate if not showing tab list
        if (!this.isTabListVisible && !this.isAnimating) {
            this.currentBannerWidth = this.calculateNormalBannerWidth();
            this.currentBannerHeight = this.bannerHeight;

            // Recreate banner texture
            const oldBannerKey = this.bannerTextureKey;
            this.bannerTextureKey = this.createBannerTexture(this.currentBannerWidth, this.currentBannerHeight);
            this.banner.setTexture(this.bannerTextureKey);
            if (oldBannerKey && oldBannerKey !== this.bannerTextureKey && this.scene.textures.exists(oldBannerKey)) {
                this.scene.textures.remove(oldBannerKey);
            }
        }

        // Position container at top center
        this.container.setPosition(Math.floor(screenWidth / 2), 16);

        // Position banner centered
        this.banner.setPosition(0, 0);
        this.hitArea?.setPosition(0, 0);
        this.updateHitArea();

        this.layoutNormalContent();
    }

    private createBannerTexture(width: number, height: number) {
        const rtKey = `__headbar_banner_${this.textureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        const srcTexture = this.scene.textures.get(this.config.bannerTextureKey);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;

        // First, scale up the source image by bannerScale
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = Math.floor(srcImage.width * this.bannerScale);
        scaledCanvas.height = Math.floor(srcImage.height * this.bannerScale);
        const scaledCtx = scaledCanvas.getContext('2d')!;
        scaledCtx.imageSmoothingEnabled = false;
        scaledCtx.drawImage(srcImage, 0, 0, scaledCanvas.width, scaledCanvas.height);

        // Nine-slice the scaled banner
        // Border is 8 pixels in original, scaled up
        const border = Math.floor(8 * this.bannerScale);
        const srcW = scaledCanvas.width;
        const srcH = scaledCanvas.height;
        const centerSrcW = srcW - border * 2;
        const centerSrcH = srcH - border * 2;
        const centerW = width - border * 2;
        const centerH = height - border * 2;

        // Top row
        ctx.drawImage(scaledCanvas, 0, 0, border, border, 0, 0, border, border);
        ctx.drawImage(scaledCanvas, border, 0, centerSrcW, border, border, 0, centerW, border);
        ctx.drawImage(scaledCanvas, srcW - border, 0, border, border, border + centerW, 0, border, border);

        // Middle row
        ctx.drawImage(scaledCanvas, 0, border, border, centerSrcH, 0, border, border, centerH);
        ctx.drawImage(scaledCanvas, border, border, centerSrcW, centerSrcH, border, border, centerW, centerH);
        ctx.drawImage(scaledCanvas, srcW - border, border, border, centerSrcH, border + centerW, border, border, centerH);

        // Bottom row
        ctx.drawImage(scaledCanvas, 0, srcH - border, border, border, 0, border + centerH, border, border);
        ctx.drawImage(scaledCanvas, border, srcH - border, centerSrcW, border, border, border + centerH, centerW, border);
        ctx.drawImage(scaledCanvas, srcW - border, srcH - border, border, border, border + centerW, border + centerH, border, border);

        this.scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private createTextTexture(text: string) {
        const rtKey = `__headbar_text_${this.textureCounter++}`;
        const canvas = document.createElement('canvas');

        const width = this.measureText(text);
        const height = Math.floor(this.fontCharSize * this.textScale);

        canvas.width = Math.max(1, width);
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        this.fontRenderer.drawText(ctx, text, 0, 0, {
            scale: this.textScale,
            charGap: this.scaledCharGap
        });

        // Apply text color
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = this.config.textColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        this.scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private measureText(text: string): number {
        return this.fontRenderer.measureTextWidth(text, {
            scale: this.textScale,
            charGap: this.scaledCharGap
        });
    }

    destroy() {
        this.scene.registry.events.off('changedata-guiOpen', this.onGuiOpenChange, this);

        if (this.bannerTextureKey && this.scene.textures.exists(this.bannerTextureKey)) {
            this.scene.textures.remove(this.bannerTextureKey);
        }
        if (this.timeTextureKey && this.scene.textures.exists(this.timeTextureKey)) {
            this.scene.textures.remove(this.timeTextureKey);
        }
        if (this.dateTextureKey && this.scene.textures.exists(this.dateTextureKey)) {
            this.scene.textures.remove(this.dateTextureKey);
        }
        if (this.yearTextureKey && this.scene.textures.exists(this.yearTextureKey)) {
            this.scene.textures.remove(this.yearTextureKey);
        }

        if (this.hitArea) {
            this.hitArea.removeAllListeners();
            this.hitArea.destroy();
        }
        this.tabList.destroy();
        this.container.destroy();
    }
}
