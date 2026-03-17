import Phaser from 'phaser';
import {
    ADVANCEMENT_ACHIEVEMENT_CATALOG,
    ADVANCEMENT_LOCATION_CATALOG,
    ADVANCEMENT_QUEST_CATALOG,
    DEFAULT_GUIDE_TUTORIAL_STATE,
    IAdvancementsState,
    IQuestObjectiveEntry,
    IQuestProgressEntry
} from '@cfwk/shared';
import { NetworkManager } from '../../network/NetworkManager';
import { LocaleManager } from '../../i18n/LocaleManager';
import { SettingsFont } from '../settings/SettingsFont';

type FinbookSection = 'quests' | 'achievements' | 'locations';

export class FinbookTabUI {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private headerContainer: Phaser.GameObjects.Container;
    private leftContainer: Phaser.GameObjects.Container;
    private rightContainer: Phaser.GameObjects.Container;

    private readonly networkManager = NetworkManager.getInstance();
    private readonly localeManager = LocaleManager.getInstance();
    private readonly font: SettingsFont;

    private activeSection: FinbookSection = 'quests';
    private selectedQuestId = ADVANCEMENT_QUEST_CATALOG[0]?.id ?? '';
    private selectedLocationMapFile = ADVANCEMENT_LOCATION_CATALOG[0]?.mapFile ?? '';
    private selectedAchievementCategory = ADVANCEMENT_ACHIEVEMENT_CATALOG[0]?.category ?? 'fun';

    private advancementsState: IAdvancementsState = {
        enrolled: true,
        questProgress: {},
        completedAchievements: [],
        discoveredRegions: {},
        tutorial: { ...DEFAULT_GUIDE_TUTORIAL_STATE }
    };

    private textureKeys = new Set<string>();
    private localeChangedHandler?: () => void;
    private advancementsUpdateHandler?: (event: Event) => void;

    private pageLeftX = 0;
    private pageTopY = 0;
    private pageRightX = 0;
    private pageHeight = 0;
    private scale = 1;

    private readonly rowHeight = 16;

    private readonly pageWidth = 147;
    private readonly outerPagePadX = 12;
    private readonly innerPagePadX = 5;
    private readonly contentPadY = 8;
    private readonly sectionButtonHeight = 16;
    private readonly sectionButtonGap = 4;
    private readonly questRowGap = 3;
    private readonly questListScrollbarGutter = 7;
    private sectionButtonsBottomY = 0;

    private renderTextureKeys = new Set<string>();

    private readonly seenQuestStorageKey = 'cfwk_finbook_seen_quests';
    private readonly targetQuestStorageKey = 'cfwk_finbook_target_quest';
    private seenQuestIds = new Set<string>();
    private targetedQuestId: string | null = null;
    private hasLoadedAdvancementsState = false;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
        this.scene = scene;
        this.font = new SettingsFont(scene);

        this.container = this.scene.add.container(0, 0);
        parent.add(this.container);

        this.headerContainer = this.scene.add.container(0, 0);
        this.leftContainer = this.scene.add.container(0, 0);
        this.rightContainer = this.scene.add.container(0, 0);
        this.container.add([this.headerContainer, this.leftContainer, this.rightContainer]);

        this.loadLocalState();

        this.localeChangedHandler = () => this.render();
        window.addEventListener('locale:changed', this.localeChangedHandler as EventListener);

        this.advancementsUpdateHandler = (event: Event) => {
            const detail = (event as CustomEvent<IAdvancementsState>).detail;
            if (!detail) return;
            this.hasLoadedAdvancementsState = true;
            const previousState = this.advancementsState;
            const targetedBeforeUpdate = this.targetedQuestId;
            this.advancementsState = {
                enrolled: detail.enrolled,
                questProgress: { ...detail.questProgress },
                completedAchievements: [...detail.completedAchievements],
                discoveredRegions: Object.fromEntries(
                    Object.entries(detail.discoveredRegions).map(([mapFile, regions]) => [mapFile, [...regions]])
                ),
                tutorial: { ...detail.tutorial }
            };
            const isResetState = this.isAdvancementsResetState(this.advancementsState);
            if (isResetState) {
                this.resetSeenQuestState();
                this.setTargetedQuest(null, false);
            }
            this.reconcileTargetedQuest();
            if (isResetState) {
                this.selectTopQuest();
                this.autoTrackFirstQuest(true);
            } else {
                this.autoTargetNextQuestAfterCompletion(previousState, targetedBeforeUpdate);
                this.autoTrackFirstQuest(false);
            }
            this.render();
        };
        window.addEventListener('advancements:update', this.advancementsUpdateHandler as EventListener);

        const cached = this.networkManager.getCachedAdvancementsState();
        if (cached) {
            this.advancementsState = cached;
            this.hasLoadedAdvancementsState = true;
        }
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
        if (visible) {
            this.reconcileTargetedQuest();
            this.autoTrackFirstQuest(false);
            if (this.targetedQuestId && this.getSortedAvailableQuestIds().includes(this.targetedQuestId)) {
                this.selectedQuestId = this.targetedQuestId;
            } else {
                this.selectTopQuest();
            }
            this.networkManager.requestAdvancementsState();
            this.render();
        }
    }

    layout(leftPageLeftEdgeX: number, leftPageTopEdgeY: number, rightPageLeftEdgeX: number, _rightPageTopEdgeY: number, pageHeight: number, scale: number) {
        this.pageLeftX = leftPageLeftEdgeX;
        this.pageTopY = leftPageTopEdgeY;
        this.pageRightX = rightPageLeftEdgeX;
        this.pageHeight = pageHeight;
        this.scale = scale;
        this.render();
    }

    private render() {
        this.clearContainer(this.headerContainer);
        this.clearContainer(this.leftContainer);
        this.clearContainer(this.rightContainer);
        this.clearRenderTextures();

        this.renderSectionButtons();

        if (this.activeSection === 'quests') {
            this.renderQuests();
            return;
        }

        if (this.activeSection === 'locations') {
            this.renderLocations();
            return;
        }

        this.renderAchievements();
    }

    private renderSectionButtons() {
        const { x: leftContentX, width: leftContentWidth } = this.getLeftPageContentBounds();
        const startY = Math.floor(this.pageTopY + this.contentPadY * this.scale);

        const buttonY = startY;

        const sections: Array<{ id: FinbookSection; label: string }> = [
            { id: 'quests', label: this.t('finbook.section.quests', 'Quests') },
            { id: 'achievements', label: this.t('finbook.section.achievements', 'Achievements') },
            { id: 'locations', label: this.t('finbook.section.locations', 'Locations') }
        ];

        const buttonGap = Math.floor(this.sectionButtonGap * this.scale);
        const totalGaps = buttonGap * (sections.length - 1);
        const availableWidth = Math.max(1, leftContentWidth - totalGaps);
        const horizontalPadding = Math.floor(10 * this.scale);
        const minButtonWidth = Math.floor(28 * this.scale);

        const rawWidths = sections.map((section) => {
            const textWidth = this.font.measureBitmapTextWidth(section.label);
            return Math.max(minButtonWidth, textWidth + horizontalPadding);
        });

        const rawSum = rawWidths.reduce((sum, width) => sum + width, 0) || 1;
        const buttonWidths = rawWidths.map((width) => Math.max(minButtonWidth, Math.floor((width / rawSum) * availableWidth)));
        let allocated = buttonWidths.reduce((sum, width) => sum + width, 0);
        let remainder = availableWidth - allocated;
        let adjustIndex = 0;
        while (remainder !== 0 && buttonWidths.length > 0) {
            const delta = remainder > 0 ? 1 : -1;
            const index = adjustIndex % buttonWidths.length;
            if (delta > 0 || buttonWidths[index] > minButtonWidth) {
                buttonWidths[index] += delta;
                remainder -= delta;
            }
            adjustIndex += 1;
            if (adjustIndex > 2000) break;
        }

        let currentX = leftContentX;

        sections.forEach((section, index) => {
            const active = this.activeSection === section.id;
            const buttonWidth = buttonWidths[index] ?? minButtonWidth;
            const x = currentX;
            const y = buttonY;
            const bg = this.addNineSliceImage(
                this.headerContainer,
                x,
                y,
                active ? 'ui-group-button-selected' : 'ui-group-button-unselected',
                buttonWidth,
                Math.floor(this.sectionButtonHeight * this.scale)
            );
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerdown', () => {
                this.activeSection = section.id;
                this.render();
            });

            const color = active ? '#f2e9dd' : '#BABEC7';
            const label = this.makeTextImage(section.label, color);
            const baseScale = this.scale * 0.78;
            const maxLabelWidth = Math.max(1, buttonWidth - Math.floor(6 * this.scale));
            const measuredLabelWidth = this.font.measureBitmapTextWidth(section.label) * baseScale;
            const fitScale = measuredLabelWidth > maxLabelWidth
                ? baseScale * (maxLabelWidth / measuredLabelWidth)
                : baseScale;
            label.setOrigin(0.5, 0.5);
            label.setScale(fitScale);
            label.setPosition(
                Math.floor(x + buttonWidth / 2),
                Math.floor(y + (this.sectionButtonHeight * this.scale) / 2)
            );

            this.headerContainer.add([bg, label]);
            currentX += buttonWidth + buttonGap;
        });

        this.sectionButtonsBottomY = Math.floor(
            buttonY + this.sectionButtonHeight * this.scale
        );
    }

    private renderQuests() {
        const { x: leftX, width: listWidth } = this.getLeftPageContentBounds();
        const listY = Math.floor(this.sectionButtonsBottomY + 3 * this.scale);
        const listHeight = Math.floor(this.pageHeight * this.scale - (listY - this.pageTopY) - this.contentPadY * this.scale);

        this.addNineSliceImage(this.leftContainer, leftX, listY, 'ui-item-info-frame', listWidth, listHeight);

        const sorted = this.getSortedAvailableQuestIds();

        if (!sorted.includes(this.selectedQuestId)) {
            this.selectedQuestId = sorted[0] ?? '';
        }

        const scrollbarGutter = Math.floor(this.questListScrollbarGutter * this.scale);
        const scrollbarTrack = this.scene.add.rectangle(
            Math.floor(leftX + listWidth - scrollbarGutter + this.scale),
            Math.floor(listY + 3 * this.scale),
            Math.max(2, Math.floor(scrollbarGutter - 2 * this.scale)),
            Math.floor(listHeight - 6 * this.scale),
            0x1f2330,
            0.32
        ).setOrigin(0, 0);
        this.leftContainer.add(scrollbarTrack);

        const rowStartY = listY + Math.floor(4 * this.scale);
        sorted.forEach((questId, index) => {
            const y = rowStartY + index * (this.rowHeight + this.questRowGap) * this.scale;
            const isCompleted = this.isQuestCompleted(questId);
            const isSelected = this.selectedQuestId === questId;
            const isNew = !isCompleted && !this.seenQuestIds.has(questId);
            const rowX = Math.floor(leftX + 3 * this.scale);
            const rowWidth = Math.floor(listWidth - 6 * this.scale - scrollbarGutter);
            if (y + this.rowHeight * this.scale > listY + listHeight - 3 * this.scale) {
                return;
            }

            const rowBg = this.addNineSliceImage(
                this.leftContainer,
                rowX,
                Math.floor(y),
                isSelected ? 'ui-group-button-selected' : 'ui-group-button-unselected',
                rowWidth,
                Math.floor(this.rowHeight * this.scale)
            );
            rowBg.setInteractive({ useHandCursor: true });
            rowBg.on('pointerdown', () => {
                this.selectedQuestId = questId;
                this.markQuestSeen(questId);
                this.render();
            });

            if (isCompleted) {
                rowBg.setTint(0x4f5563);
            }

            const name = this.t(`advancements.quest.${questId}.name`, questId);
            this.leftContainer.add(rowBg);

            const newText = this.t('finbook.quest.new', 'NEW');
            const newBadgeWidth = isNew ? this.font.measureBitmapTextWidth(newText) * this.scale : 0;
            const isMainQuest = this.isMainQuest(questId);
            const hasMainQuestIcon = isMainQuest && this.scene.textures.exists('ui-quest-main-star');
            const iconSize = Math.max(8, Math.floor(11 * this.scale));
            const iconGap = Math.floor(1 * this.scale);
            const iconLeftPad = Math.floor(2 * this.scale);
            // Always reserve the main-quest icon slot so marquee width/overflow
            // calculations remain correct and independent from texture timing.
            const iconReserved = isMainQuest ? (iconSize + iconGap) : 0;
            if (hasMainQuestIcon) {
                const star = this.scene.add.image(
                    Math.floor(rowX + iconLeftPad + iconSize / 2),
                    Math.floor(y + (this.rowHeight * this.scale) / 2),
                    'ui-quest-main-star'
                );
                star.setDisplaySize(iconSize, iconSize);
                if (isCompleted) {
                    star.setTint(0x8a8a8a);
                    star.setAlpha(0.9);
                } else {
                    star.setTint(0xffffff);
                    star.setAlpha(1);
                }
                this.leftContainer.add(star);
            }
            const textX = Math.floor(rowX + 3 * this.scale + iconReserved);
            const textReservedRight = Math.floor(3 * this.scale + (isNew ? newBadgeWidth + 6 * this.scale : 0));
            const textWidth = Math.max(1, Math.floor(rowWidth - (textX - rowX) - textReservedRight));

            if (this.targetedQuestId === questId) {
                const glowOverlay = this.scene.add.rectangle(
                    rowX,
                    Math.floor(y),
                    rowWidth,
                    Math.floor(this.rowHeight * this.scale),
                    0xffd84d,
                    0
                ).setOrigin(0, 0);
                glowOverlay.setBlendMode(Phaser.BlendModes.ADD);
                this.leftContainer.add(glowOverlay);

                this.scene.tweens.add({
                    targets: glowOverlay,
                    alpha: { from: 0.08, to: 0.42 },
                    duration: 460,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
            }

            this.addMarqueeText(
                this.leftContainer,
                name,
                textX,
                Math.floor(y + 3 * this.scale),
                textWidth,
                isCompleted ? '#7f848d' : '#BABEC7',
                this.scale,
                10 * this.scale,
                rowBg
            );

            if (this.targetedQuestId === questId) {
                this.scene.tweens.add({
                    targets: rowBg,
                    alpha: { from: 1, to: 0.9 },
                    duration: 460,
                    yoyo: true,
                    repeat: -1
                });
                this.scene.tweens.addCounter({
                    from: 0,
                    to: 1,
                    duration: 460,
                    yoyo: true,
                    repeat: -1,
                    onUpdate: (tween) => {
                        const value = tween.getValue() ?? 0;
                        const color = Phaser.Display.Color.Interpolate.ColorWithColor(
                            new Phaser.Display.Color(255, 245, 170),
                            new Phaser.Display.Color(255, 196, 44),
                            100,
                            Math.floor(value * 100)
                        );
                        rowBg.setTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
                    }
                });
                rowBg.on('destroy', () => rowBg.clearTint());
            }

            if (isNew) {
                const newLabel = this.makeTextImage(newText, '#ff9f1c');
                newLabel.setOrigin(0, 0);
                newLabel.setScale(this.scale);
                const badgeX = Math.floor(rowX + rowWidth - (newBadgeWidth + 3 * this.scale));
                newLabel.setPosition(badgeX, Math.floor(y + 3 * this.scale));
                this.scene.tweens.add({
                    targets: newLabel,
                    alpha: { from: 1, to: 0.35 },
                    duration: 420,
                    yoyo: true,
                    repeat: -1
                });
                this.leftContainer.add(newLabel);
            }
        });

        this.renderQuestDetail();
    }

    private renderQuestDetail() {
        const questId = this.selectedQuestId;
        const { x: rightX, width: rightWidth } = this.getRightPageContentBounds();
        const topY = Math.floor(this.pageTopY + this.contentPadY * this.scale);
        const panelHeight = Math.floor(this.pageHeight * this.scale - (topY - this.pageTopY) - this.contentPadY * this.scale);

        if (!questId) return;

        this.addNineSliceImage(this.rightContainer, rightX, topY, 'ui-item-info-frame', rightWidth, panelHeight);

        const isCompleted = this.isQuestCompleted(questId);
        const isMainQuest = this.isMainQuest(questId);
        const progress = this.getQuestProgress(questId);
        const status = isCompleted
            ? this.t('finbook.quest.status.completed', 'Completed')
            : progress?.status === 'active'
                ? this.t('finbook.quest.status.inProgress', 'In Progress')
                : this.t('finbook.quest.status.notStarted', 'Not Started');
        const contentX = Math.floor(rightX + 4 * this.scale);
        const contentWidth = Math.floor(rightWidth - 8 * this.scale);

        this.addMarqueeText(
            this.rightContainer,
            this.t(`advancements.quest.${questId}.name`, questId),
            contentX,
            Math.floor(topY + 4 * this.scale),
            contentWidth,
            '#f2e9dd',
            this.scale * 1.1,
            12 * this.scale
        );

        const questType = isMainQuest
            ? this.t('finbook.quest.type.main', 'MAIN QUEST')
            : this.t('finbook.quest.type.side', 'SIDE QUEST');
        const questTypeImage = this.makeTextImage(questType, isMainQuest ? '#ffcc4d' : '#8e9199');
        questTypeImage.setOrigin(0, 0);
        questTypeImage.setScale(this.scale * 0.58);
        // Small extra breathing room under the title.
        questTypeImage.setPosition(contentX, Math.floor(topY + 16 * this.scale));
        this.rightContainer.add(questTypeImage);
        this.addQuestDetailDivider(contentX, contentWidth, Math.floor(topY + 27 * this.scale));

        const statusValue = this.makeTextImage(status, isCompleted ? '#7f848d' : '#f2e9dd');
        statusValue.setOrigin(0, 0);
        statusValue.setScale(this.scale);
        statusValue.setPosition(contentX, Math.floor(topY + 31 * this.scale));
        this.rightContainer.add(statusValue);
        this.addQuestDetailDivider(contentX, contentWidth, Math.floor(topY + 43 * this.scale));

        const objectiveText = this.getQuestObjectiveText(questId);
        let contentStartY = Math.floor(topY + 49 * this.scale);

        if (objectiveText) {
            const objectiveLabel = this.makeTextImage(this.t('finbook.quest.objective.nextLabel', 'Next Objective'), '#9A9EA7');
            objectiveLabel.setOrigin(0, 0);
            objectiveLabel.setScale(this.scale * 0.92);
            objectiveLabel.setPosition(contentX, Math.floor(topY + 49 * this.scale));
            this.rightContainer.add(objectiveLabel);

            const objectiveCardX = contentX;
            const objectiveCardY = Math.floor(topY + 58 * this.scale);
            const objectiveCardW = contentWidth;
            const objectiveCardH = Math.floor(18 * this.scale);
            const objectiveCard = this.addNineSliceImage(
                this.rightContainer,
                objectiveCardX,
                objectiveCardY,
                'ui-group-button-unselected',
                objectiveCardW,
                objectiveCardH
            );

            this.addMarqueeText(
                this.rightContainer,
                objectiveText,
                Math.floor(objectiveCardX + 4 * this.scale),
                Math.floor(objectiveCardY + 4 * this.scale),
                Math.floor(objectiveCardW - 8 * this.scale),
                '#f2e9dd',
                this.scale,
                10 * this.scale,
                objectiveCard
            );

            const objectiveDividerY = Math.floor(objectiveCardY + objectiveCardH + 6 * this.scale);
            this.addQuestDetailDivider(contentX, contentWidth, objectiveDividerY);
            contentStartY = Math.floor(objectiveDividerY + 6 * this.scale);
        }

        const desc = this.t(`finbook.quest.${questId}.description`, this.t('finbook.quest.descriptionFallback', 'Details coming soon.'));

        const buttonHeight = Math.floor(16 * this.scale);
        const buttonX = Math.floor(rightX + 4 * this.scale);
        const buttonY = Math.floor(topY + panelHeight - buttonHeight - 4 * this.scale);
        const buttonWidth = Math.floor(rightWidth - 8 * this.scale);

        const descBoxX = Math.floor(rightX + 4 * this.scale);
        const descBoxY = contentStartY;
        const descBoxW = Math.floor(rightWidth - 8 * this.scale);
        const descBoxH = Math.max(16, Math.floor(buttonY - descBoxY - 6 * this.scale));

        const descHover = this.scene.add.rectangle(descBoxX, descBoxY, descBoxW, descBoxH, 0x000000, 0).setOrigin(0, 0);
        descHover.setInteractive({ useHandCursor: true });
        this.rightContainer.add(descHover);

        this.addWrappedScrollingText(
            this.rightContainer,
            desc,
            Math.floor(descBoxX + 4 * this.scale),
            Math.floor(descBoxY + 4 * this.scale),
            Math.floor(descBoxW - 8 * this.scale),
            Math.floor(descBoxH - 8 * this.scale),
            '#BABEC7',
            this.scale,
            10 * this.scale,
            descHover
        );

        if (isCompleted && this.targetedQuestId === questId) {
            this.setTargetedQuest(null, false);
        }

        const canTrack = !isCompleted;
        const targetActive = canTrack && this.targetedQuestId === questId;
        const buttonText = canTrack
            ? (targetActive
                ? this.t('finbook.quest.untrack', 'Untrack')
                : this.t('finbook.quest.track', 'Track'))
            : this.t('finbook.quest.status.completed', 'Completed');

        const buttonBg = this.addNineSliceImage(
            this.rightContainer,
            buttonX,
            buttonY,
            targetActive ? 'ui-group-button-selected' : 'ui-group-button-unselected',
            buttonWidth,
            buttonHeight
        );
        if (canTrack) {
            buttonBg.setInteractive({ useHandCursor: true });
            buttonBg.on('pointerdown', () => {
                this.setTargetedQuest(targetActive ? null : questId, true);
            });
        } else {
            buttonBg.setAlpha(0.7);
        }

        const buttonLabel = this.makeTextImage(buttonText, canTrack ? '#f2e9dd' : '#9A9EA7');
        buttonLabel.setOrigin(0.5, 0.5);
        buttonLabel.setScale(this.scale);
        buttonLabel.setPosition(
            Math.floor(buttonX + buttonWidth / 2),
            Math.floor(buttonY + buttonHeight / 2)
        );

        this.rightContainer.add([buttonBg, buttonLabel]);

        if (targetActive) {
            this.scene.tweens.add({
                targets: buttonBg,
                alpha: { from: 1, to: 0.76 },
                duration: 420,
                yoyo: true,
                repeat: -1
            });
            this.scene.tweens.addCounter({
                from: 0,
                to: 1,
                duration: 420,
                yoyo: true,
                repeat: -1,
                onUpdate: (tween) => {
                    const value = tween.getValue() ?? 0;
                    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
                        new Phaser.Display.Color(255, 255, 255),
                        new Phaser.Display.Color(255, 224, 122),
                        100,
                        Math.floor(value * 100)
                    );
                    buttonBg.setTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
                }
            });
            buttonBg.on('destroy', () => buttonBg.clearTint());
        }
    }

    private addQuestDetailDivider(x: number, width: number, centerY: number) {
        const dividerHeight = Math.max(1, Math.floor(2 * this.scale));
        const dividerY = Math.floor(centerY - dividerHeight / 2);
        const divider = this.addNineSliceImage(
            this.rightContainer,
            x,
            dividerY,
            'ui-item-info-divider',
            Math.max(1, width),
            dividerHeight
        );
        divider.setAlpha(0.9);
    }

    private getSortedAvailableQuestIds(): string[] {
        const availableQuestIds = ADVANCEMENT_QUEST_CATALOG
            .filter((quest) => this.isQuestVisible(quest))
            .map((quest) => quest.id);

        return [...availableQuestIds].sort((a, b) => this.compareQuestListOrder(a, b));
    }

    private selectTopQuest() {
        const sorted = this.getSortedAvailableQuestIds();
        this.selectedQuestId = sorted[0] ?? '';
    }

    private setTargetedQuest(questId: string | null, shouldRender: boolean) {
        this.targetedQuestId = questId;
        this.persistTargetedQuest();
        this.scene.registry.set('targetedQuestId', this.targetedQuestId);
        window.dispatchEvent(new CustomEvent('finbook:quest-targeted', { detail: { questId: this.targetedQuestId } }));
        if (shouldRender) {
            this.render();
        }
    }

    private reconcileTargetedQuest() {
        if (!this.hasLoadedAdvancementsState) return;
        if (!this.targetedQuestId) return;
        const targetQuestId = this.targetedQuestId;
        const isVisible = this.isQuestVisibleById(targetQuestId);
        const isCompleted = this.isQuestCompleted(targetQuestId);
        if (!isVisible || isCompleted) {
            this.setTargetedQuest(null, false);
        }
    }

    private autoTrackFirstQuest(force: boolean) {
        if (!force && this.targetedQuestId) return;
        const firstQuestId = this.getSortedAvailableQuestIds().find((questId) => {
            if (this.isQuestCompleted(questId)) return false;
            return this.shouldAutoTrackQuest(questId);
        });
        if (!firstQuestId) return;
        this.setTargetedQuest(firstQuestId, false);
    }

    private autoTargetNextQuestAfterCompletion(previousState: IAdvancementsState, targetedBeforeUpdate: string | null) {
        const newlyCompletedInOrder = ADVANCEMENT_QUEST_CATALOG
            .map((entry) => entry.id)
            .filter((questId) => {
                const wasCompleted = previousState.questProgress[questId]?.status === 'completed';
                const isCompleted = this.advancementsState.questProgress[questId]?.status === 'completed';
                return !wasCompleted && isCompleted;
            });

        if (newlyCompletedInOrder.length === 0) return;

        for (const completedQuestId of newlyCompletedInOrder) {
            if (targetedBeforeUpdate && targetedBeforeUpdate !== completedQuestId) {
                continue;
            }

            const entry = ADVANCEMENT_QUEST_CATALOG.find((quest) => quest.id === completedQuestId);
            if (!entry) continue;

            const nextQuestIds = [
                ...(entry.nextQuestIds ?? []),
                ...(entry.nextQuestId ? [entry.nextQuestId] : [])
            ];

            for (const nextQuestId of nextQuestIds) {
                if (this.isQuestCompleted(nextQuestId)) continue;
                if (!this.getSortedAvailableQuestIds().includes(nextQuestId)) continue;
                if (!this.shouldAutoTrackQuest(nextQuestId)) continue;

                this.setTargetedQuest(nextQuestId, false);
                return;
            }
        }
    }

    private getQuestDependencyIds(quest: (typeof ADVANCEMENT_QUEST_CATALOG)[number]): string[] {
        const dependencies = [
            ...(quest.dependencyQuestIds ?? []),
            ...(quest.dependencyQuestId ? [quest.dependencyQuestId] : [])
        ];

        return Array.from(new Set(
            dependencies
                .map((questId) => String(questId).trim())
                .filter((questId) => questId.length > 0)
        ));
    }

    private isQuestVisible(quest: (typeof ADVANCEMENT_QUEST_CATALOG)[number]): boolean {
        const dependencies = this.getQuestDependencyIds(quest);
        if (dependencies.length === 0) return true;
        return dependencies.every((questId) => this.isQuestCompleted(questId));
    }

    private isQuestVisibleById(questId: string): boolean {
        const quest = ADVANCEMENT_QUEST_CATALOG.find((entry) => entry.id === questId);
        if (!quest) return false;
        return this.isQuestVisible(quest);
    }

    private isAdvancementsResetState(state: IAdvancementsState): boolean {
        const hasQuestProgress = Object.keys(state.questProgress).length > 0;
        const hasAchievements = state.completedAchievements.length > 0;
        const hasDiscoveredAreas = Object.values(state.discoveredRegions).some((regions) => Array.isArray(regions) && regions.length > 0);
        return !hasQuestProgress && !hasAchievements && !hasDiscoveredAreas;
    }

    private resetSeenQuestState() {
        this.seenQuestIds.clear();
        this.persistSeenQuests();
    }

    private renderLocations() {
        const { x: leftX, width: listWidth } = this.getLeftPageContentBounds();
        const listY = Math.floor(this.sectionButtonsBottomY + 4 * this.scale);
        const listHeight = Math.floor(this.pageHeight * this.scale - (listY - this.pageTopY) - this.contentPadY * this.scale);

        this.addNineSliceImage(this.leftContainer, leftX, listY, 'ui-item-info-frame', listWidth, listHeight);

        if (!ADVANCEMENT_LOCATION_CATALOG.some((entry) => entry.mapFile === this.selectedLocationMapFile)) {
            this.selectedLocationMapFile = ADVANCEMENT_LOCATION_CATALOG[0]?.mapFile ?? '';
        }

        ADVANCEMENT_LOCATION_CATALOG.forEach((entry, index) => {
            const y = Math.floor(listY + 4 * this.scale + index * this.rowHeight * this.scale);
            const unlocked = this.isRegionUnlocked(entry.mapFile);
            const isSelected = this.selectedLocationMapFile === entry.mapFile;

            const rowBg = this.addNineSliceImage(
                this.leftContainer,
                Math.floor(leftX + 3 * this.scale),
                Math.floor(y),
                isSelected ? 'ui-group-button-selected' : 'ui-group-button-unselected',
                Math.floor(listWidth - 6 * this.scale),
                Math.floor(this.rowHeight * this.scale)
            );
            rowBg.setInteractive({ useHandCursor: true });
            rowBg.on('pointerdown', () => {
                this.selectedLocationMapFile = entry.mapFile;
                this.render();
            });

            const label = unlocked ? entry.mapName : this.t('finbook.locked', '???');
            this.leftContainer.add(rowBg);
            this.addMarqueeText(
                this.leftContainer,
                label,
                Math.floor(leftX + 8 * this.scale),
                Math.floor(y + 3 * this.scale),
                Math.floor(listWidth - 16 * this.scale),
                unlocked ? '#BABEC7' : '#8e9199',
                this.scale,
                10 * this.scale,
                rowBg
            );
        });

        this.renderLocationAreas();
    }

    private renderLocationAreas() {
        const entry = ADVANCEMENT_LOCATION_CATALOG.find((value) => value.mapFile === this.selectedLocationMapFile);
        if (!entry) return;

        const { x: rightX, width: listWidth } = this.getRightPageContentBounds();
        const listY = Math.floor(this.pageTopY + this.contentPadY * this.scale);
        const listHeight = Math.floor(this.pageHeight * this.scale - (listY - this.pageTopY) - this.contentPadY * this.scale);

        this.addNineSliceImage(this.rightContainer, rightX, listY, 'ui-item-info-frame', listWidth, listHeight);

        const title = this.makeTextImage(entry.mapName, '#f2e9dd');
        title.setOrigin(0, 0);
        title.setScale(this.scale);
        title.setPosition(Math.floor(rightX + 4 * this.scale), Math.floor(listY + 4 * this.scale));
        this.rightContainer.add(title);

        const discovered = this.advancementsState.discoveredRegions[entry.mapFile] ?? [];
        const countText = this.makeTextImage(`${discovered.length}/${entry.regions.length}`, '#9A9EA7');
        countText.setOrigin(0, 0);
        countText.setScale(this.scale * 0.95);
        countText.setPosition(Math.floor(rightX + 4 * this.scale), Math.floor(listY + 13 * this.scale));
        this.rightContainer.add(countText);

        entry.regions.forEach((region, index) => {
            const y = Math.floor(listY + 24 * this.scale + index * this.rowHeight * this.scale);
            const unlocked = this.isAreaUnlocked(entry.mapFile, region.id);

            const rowBg = this.addNineSliceImage(
                this.rightContainer,
                Math.floor(rightX + 3 * this.scale),
                Math.floor(y),
                'ui-group-button-unselected',
                Math.floor(listWidth - 6 * this.scale),
                Math.floor(this.rowHeight * this.scale)
            );
            this.rightContainer.add(rowBg);

            this.addMarqueeText(
                this.rightContainer,
                unlocked ? region.id : this.t('finbook.locked', '???'),
                Math.floor(rightX + 8 * this.scale),
                Math.floor(y + 3 * this.scale),
                Math.floor(listWidth - 16 * this.scale),
                unlocked ? '#BABEC7' : '#8e9199',
                this.scale,
                10 * this.scale,
                rowBg
            );
        });
    }

    private renderAchievements() {
        const categories = Array.from(new Set(ADVANCEMENT_ACHIEVEMENT_CATALOG.map((entry) => entry.category)));
        if (!categories.includes(this.selectedAchievementCategory)) {
            this.selectedAchievementCategory = categories[0] ?? 'fun';
        }

        const { x: leftX, width: listWidth } = this.getLeftPageContentBounds();
        const listY = Math.floor(this.sectionButtonsBottomY + 4 * this.scale);
        const listHeight = Math.floor(this.pageHeight * this.scale - (listY - this.pageTopY) - this.contentPadY * this.scale);

        this.addNineSliceImage(this.leftContainer, leftX, listY, 'ui-item-info-frame', listWidth, listHeight);

        categories.forEach((category, index) => {
            const y = Math.floor(listY + 4 * this.scale + index * this.rowHeight * this.scale);
            const isSelected = category === this.selectedAchievementCategory;
            const rowBg = this.addNineSliceImage(
                this.leftContainer,
                Math.floor(leftX + 3 * this.scale),
                Math.floor(y),
                isSelected ? 'ui-group-button-selected' : 'ui-group-button-unselected',
                Math.floor(listWidth - 6 * this.scale),
                Math.floor(this.rowHeight * this.scale)
            );
            rowBg.setInteractive({ useHandCursor: true });
            rowBg.on('pointerdown', () => {
                this.selectedAchievementCategory = category;
                this.render();
            });

            const label = this.t(`finbook.achievementCategory.${category}`, category);
            this.leftContainer.add(rowBg);
            this.addMarqueeText(
                this.leftContainer,
                label,
                Math.floor(leftX + 8 * this.scale),
                Math.floor(y + 3 * this.scale),
                Math.floor(listWidth - 16 * this.scale),
                isSelected ? '#f2e9dd' : '#BABEC7',
                this.scale,
                10 * this.scale,
                rowBg
            );
        });

        const { x: rightX, width: achWidth } = this.getRightPageContentBounds();
        const achY = Math.floor(this.pageTopY + this.contentPadY * this.scale);
        this.addNineSliceImage(this.rightContainer, rightX, achY, 'ui-item-info-frame', achWidth, listHeight);

        const categoryTitle = this.makeTextImage(this.t(`finbook.achievementCategory.${this.selectedAchievementCategory}`, this.selectedAchievementCategory), '#f2e9dd');
        categoryTitle.setOrigin(0, 0);
        categoryTitle.setScale(this.scale);
        categoryTitle.setPosition(Math.floor(rightX + 4 * this.scale), Math.floor(achY + 4 * this.scale));
        this.rightContainer.add(categoryTitle);

        const achievements = ADVANCEMENT_ACHIEVEMENT_CATALOG.filter((entry) => entry.category === this.selectedAchievementCategory);

        const unlockedCount = achievements.filter((entry) => this.advancementsState.completedAchievements.includes(entry.id)).length;
        const progressText = this.makeTextImage(`${unlockedCount}/${achievements.length}`, '#9A9EA7');
        progressText.setOrigin(0, 0);
        progressText.setScale(this.scale * 0.95);
        progressText.setPosition(Math.floor(rightX + 4 * this.scale), Math.floor(achY + 13 * this.scale));
        this.rightContainer.add(progressText);

        achievements.forEach((achievement, index) => {
            const y = Math.floor(achY + 24 * this.scale + index * this.rowHeight * this.scale);
            const unlocked = this.advancementsState.completedAchievements.includes(achievement.id);
            const rowBg = this.addNineSliceImage(
                this.rightContainer,
                Math.floor(rightX + 3 * this.scale),
                Math.floor(y),
                unlocked ? 'ui-group-button-selected' : 'ui-group-button-unselected',
                Math.floor(achWidth - 6 * this.scale),
                Math.floor(this.rowHeight * this.scale)
            );
            const label = unlocked
                ? this.t(`advancements.achievement.${achievement.id}.name`, achievement.id)
                : this.t('finbook.locked', '???');
            this.rightContainer.add(rowBg);
            this.addMarqueeText(
                this.rightContainer,
                label,
                Math.floor(rightX + 8 * this.scale),
                Math.floor(y + 3 * this.scale),
                Math.floor(achWidth - 16 * this.scale),
                unlocked ? '#BABEC7' : '#8e9199',
                this.scale,
                10 * this.scale,
                rowBg
            );
        });
    }

    private getLeftPageContentBounds() {
        const x = Math.floor(this.pageLeftX + this.outerPagePadX * this.scale);
        const width = Math.floor(this.pageWidth * this.scale - (this.outerPagePadX + this.innerPagePadX) * this.scale);
        return { x, width };
    }

    private getRightPageContentBounds() {
        const x = Math.floor(this.pageRightX + this.innerPagePadX * this.scale);
        const width = Math.floor(this.pageWidth * this.scale - (this.outerPagePadX + this.innerPagePadX) * this.scale);
        return { x, width };
    }

    private addMarqueeText(
        parent: Phaser.GameObjects.Container,
        text: string,
        x: number,
        y: number,
        width: number,
        color: string,
        textScale: number,
        clipHeight: number,
        hoverTarget?: Phaser.GameObjects.GameObject
    ) {
        const textImage = this.makeTextImage(text, color);
        textImage.setOrigin(0, 0);
        textImage.setScale(textScale);
        textImage.setPosition(x, y);

        const measuredWidth = this.font.measureBitmapTextWidth(text) * textScale;
        if (measuredWidth <= width) {
            parent.add(textImage);
            return;
        }

        const maskGraphics = this.scene.add.graphics();
        maskGraphics.fillStyle(0xffffff, 1);
        maskGraphics.fillRect(x, y, width, Math.max(1, clipHeight));
        maskGraphics.setVisible(false);
        const mask = maskGraphics.createGeometryMask();
        textImage.setMask(mask);

        parent.add([maskGraphics, textImage]);

        const overflow = measuredWidth - width;
        const tween = this.scene.tweens.add({
            targets: textImage,
            x: x - overflow,
            duration: Math.max(1500, overflow * 30),
            delay: 700,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            paused: true
        });

        const reset = () => {
            tween.pause();
            textImage.setX(x);
        };

        if (hoverTarget && (hoverTarget as any).on) {
            (hoverTarget as any).on('pointerover', () => tween.play());
            (hoverTarget as any).on('pointerout', reset);
        }
    }

    private addWrappedScrollingText(
        parent: Phaser.GameObjects.Container,
        text: string,
        x: number,
        y: number,
        width: number,
        height: number,
        color: string,
        textScale: number,
        lineHeight: number,
        hoverTarget?: Phaser.GameObjects.GameObject
    ) {
        const lines = this.wrapText(text, Math.max(1, width / textScale));
        const textContainer = this.scene.add.container(x, y);

        lines.forEach((line, index) => {
            const image = this.makeTextImage(line, color);
            image.setOrigin(0, 0);
            image.setScale(textScale);
            image.setPosition(0, index * lineHeight);
            textContainer.add(image);
        });

        const maskGraphics = this.scene.add.graphics();
        maskGraphics.fillStyle(0xffffff, 1);
        maskGraphics.fillRect(x, y, width, Math.max(1, height));
        maskGraphics.setVisible(false);
        const mask = maskGraphics.createGeometryMask();
        textContainer.setMask(mask);

        parent.add([maskGraphics, textContainer]);

        const contentHeight = lines.length * lineHeight;
        if (contentHeight > height) {
            const overflow = contentHeight - height;
            const tween = this.scene.tweens.add({
                targets: textContainer,
                y: y - overflow,
                duration: Math.max(2000, overflow * 40),
                delay: 800,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
                paused: true
            });

            const reset = () => {
                tween.pause();
                textContainer.setY(y);
            };

            if (hoverTarget && (hoverTarget as any).on) {
                (hoverTarget as any).on('pointerover', () => tween.play());
                (hoverTarget as any).on('pointerout', reset);
            }
        }
    }

    private addNineSliceImage(
        parent: Phaser.GameObjects.Container,
        x: number,
        y: number,
        baseTextureKey: string,
        width: number,
        height: number
    ): Phaser.GameObjects.Image {
        const key = this.createNineSliceTexture(baseTextureKey, Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
        this.textureKeys.add(key);
        this.renderTextureKeys.add(key);
        const image = this.scene.add.image(x, y, key).setOrigin(0, 0);
        parent.add(image);
        return image;
    }

    private createNineSliceTexture(baseTextureKey: string, width: number, height: number): string {
        const sourceTexture = this.scene.textures.get(baseTextureKey);
        const sourceImage = sourceTexture.getSourceImage() as HTMLImageElement;
        const srcW = sourceImage.width;
        const srcH = sourceImage.height;

        const borderX = Math.floor((srcW - 1) / 2);
        const borderY = Math.floor((srcH - 1) / 2);
        const centerSrcW = Math.max(1, srcW - borderX * 2);
        const centerSrcH = Math.max(1, srcH - borderY * 2);

        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(sourceImage, 0, 0, borderX, borderY, 0, 0, borderX, borderY);
        ctx.drawImage(sourceImage, borderX, 0, centerSrcW, borderY, borderX, 0, centerW, borderY);
        ctx.drawImage(sourceImage, srcW - borderX, 0, borderX, borderY, borderX + centerW, 0, borderX, borderY);

        ctx.drawImage(sourceImage, 0, borderY, borderX, centerSrcH, 0, borderY, borderX, centerH);
        ctx.drawImage(sourceImage, borderX, borderY, centerSrcW, centerSrcH, borderX, borderY, centerW, centerH);
        ctx.drawImage(sourceImage, srcW - borderX, borderY, borderX, centerSrcH, borderX + centerW, borderY, borderX, centerH);

        ctx.drawImage(sourceImage, 0, srcH - borderY, borderX, borderY, 0, borderY + centerH, borderX, borderY);
        ctx.drawImage(sourceImage, borderX, srcH - borderY, centerSrcW, borderY, borderX, borderY + centerH, centerW, borderY);
        ctx.drawImage(sourceImage, srcW - borderX, srcH - borderY, borderX, borderY, borderX + centerW, borderY + centerH, borderX, borderY);

        const key = `__finbook_slice_${baseTextureKey}_${width}x${height}_${Math.random().toString(36).slice(2, 8)}`;
        if (this.scene.textures.exists(key)) {
            this.scene.textures.remove(key);
        }
        this.scene.textures.addCanvas(key, canvas);
        return key;
    }

    private wrapText(text: string, maxWidth: number): string[] {
        const words = text.split(/\s+/).filter(Boolean);
        if (words.length === 0) return [''];

        const lines: string[] = [];
        let current = words[0];

        for (let i = 1; i < words.length; i += 1) {
            const candidate = `${current} ${words[i]}`;
            if (this.font.measureBitmapTextWidth(candidate) <= maxWidth) {
                current = candidate;
            } else {
                lines.push(current);
                current = words[i];
            }
        }

        lines.push(current);
        return lines;
    }

    private getQuestProgress(questId: string): IQuestProgressEntry | null {
        return this.advancementsState.questProgress[questId] ?? null;
    }

    private getQuestObjectiveText(questId: string): string | null {
        const questEntry = ADVANCEMENT_QUEST_CATALOG.find((entry) => entry.id === questId);
        if (!questEntry) return null;

        const progress = this.getQuestProgress(questId);
        if (progress?.status === 'completed') return null;

        const stagedObjectives = questEntry.objectives ?? (questEntry.objective ? [questEntry.objective] : []);
        const activeIndex = typeof progress?.objectiveIndex === 'number'
            ? Math.max(0, Math.floor(progress.objectiveIndex))
            : 0;
        const activeObjective = stagedObjectives[Math.min(activeIndex, Math.max(0, stagedObjectives.length - 1))] ?? null;

        const objective = progress?.status === 'active'
            ? (activeObjective ?? questEntry.objective ?? questEntry.startObjective)
            : (questEntry.startObjective ?? activeObjective ?? questEntry.objective);
        if (!objective) return null;
        return this.objectiveToText(objective);
    }

    private objectiveToText(objective: IQuestObjectiveEntry): string {
        if (objective.kind === 'fish-catch') {
            return this.t('finbook.quest.objective.fishCatch', 'Catch a fish');
        }

        if (objective.kind === 'talk-to-npc' && objective.npcId) {
            const npcName = this.localeManager.t(`npc.${objective.npcId}.name`, undefined, objective.npcId);
            return this.t('finbook.quest.objective.talkToNpc', `Talk to ${npcName}`, { name: npcName });
        }

        if (objective.kind === 'stay-in-region' && objective.regionName) {
            const seconds = Number.isFinite(objective.durationMs)
                ? Math.max(1, Math.round((objective.durationMs as number) / 1000))
                : 60;
            return this.t(
                'finbook.quest.objective.stayInRegion',
                `Stay in ${objective.regionName} for ${seconds}s`,
                { region: objective.regionName, seconds }
            );
        }

        if (objective.kind === 'wait-for-time-window') {
            const startHour = Number.isFinite(objective.startHour)
                ? Math.max(0, Math.min(23, Math.floor(objective.startHour as number)))
                : 23;
            const endHour = Number.isFinite(objective.endHourExclusive)
                ? Math.max(0, Math.min(23, Math.floor(objective.endHourExclusive as number)))
                : 4;
            return this.t(
                'finbook.quest.objective.waitForTimeWindow',
                `Wait until night (${startHour}:00-${endHour}:00)`,
                { start: startHour, end: endHour }
            );
        }

        if (objective.kind === 'fish-near-location') {
            const location = typeof objective.locationName === 'string' && objective.locationName.trim().length > 0
                ? objective.locationName.trim()
                : this.t('finbook.quest.objective.generic', 'Complete the next task');
            return this.t(
                'finbook.quest.objective.fishNearLocation',
                `Fish near ${location}`,
                { location }
            );
        }

        if (objective.kind === 'harvest-interactive') {
            if (objective.componentId === 'glimmeringchest') {
                return this.t('finbook.quest.objective.openGlimmeringChest', 'Open the Glimmering Chest');
            }
            return this.t('finbook.quest.objective.harvestInteractive', 'Use nearby interactable');
        }

        if (objective.kind === 'inventory-count' && objective.itemId) {
            const itemName = this.localeManager.t(`items.${objective.itemId}.name`, undefined, objective.itemId);
            const count = Number.isFinite(objective.requiredCount)
                ? Math.max(1, Math.floor(objective.requiredCount as number))
                : 1;
            return this.t('finbook.quest.objective.inventoryCount', `Collect ${count} {item}`, {
                item: itemName,
                count
            });
        }

        if (objective.kind === 'refine-food') {
            const itemName = objective.itemId
                ? this.localeManager.t(`items.${objective.itemId}.name`, undefined, objective.itemId)
                : this.t('finbook.quest.objective.generic', 'Complete the next task');
            return this.t('finbook.quest.objective.refineFood', 'Refine {item} into liquid', { item: itemName });
        }

        if (objective.kind === 'bottle-liquid') {
            const liquidName = objective.liquidItemId
                ? this.localeManager.t(`items.${objective.liquidItemId}.name`, undefined, objective.liquidItemId)
                : this.t('finbook.quest.objective.generic', 'Complete the next task');
            const containerName = objective.containerItemId
                ? this.localeManager.t(`items.${objective.containerItemId}.name`, undefined, objective.containerItemId)
                : this.localeManager.t('items.jar.name', undefined, 'Jar');
            return this.t('finbook.quest.objective.bottleLiquid', 'Collect {liquid} using {container}', {
                liquid: liquidName,
                container: containerName
            });
        }

        return this.t('finbook.quest.objective.generic', 'Complete the next task');
    }

    private shouldAutoTrackQuest(questId: string): boolean {
        const entry = ADVANCEMENT_QUEST_CATALOG.find((quest) => quest.id === questId);
        if (!entry) return true;
        if (entry.allowAutoTrack === false) return false;
        if (entry.isSideQuest === true) return false;
        return true;
    }

    private isMainQuest(questId: string): boolean {
        const entry = ADVANCEMENT_QUEST_CATALOG.find((quest) => quest.id === questId);
        if (!entry) return true;
        return entry.isSideQuest !== true;
    }

    private compareQuestListOrder(aQuestId: string, bQuestId: string): number {
        const bucketFor = (questId: string): number => {
            if (this.isQuestCompleted(questId)) return 2;
            return this.isMainQuest(questId) ? 0 : 1;
        };

        const aBucket = bucketFor(aQuestId);
        const bBucket = bucketFor(bQuestId);
        if (aBucket !== bBucket) return aBucket - bBucket;

        const aIndex = ADVANCEMENT_QUEST_CATALOG.findIndex((quest) => quest.id === aQuestId);
        const bIndex = ADVANCEMENT_QUEST_CATALOG.findIndex((quest) => quest.id === bQuestId);
        const safeA = aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex;
        const safeB = bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex;
        return safeA - safeB;
    }

    private isQuestCompleted(questId: string): boolean {
        return this.advancementsState.questProgress[questId]?.status === 'completed';
    }

    private isRegionUnlocked(mapFile: string): boolean {
        const discovered = this.advancementsState.discoveredRegions[mapFile] ?? [];
        return discovered.length > 0;
    }

    private isAreaUnlocked(mapFile: string, regionId: string): boolean {
        const discovered = this.advancementsState.discoveredRegions[mapFile] ?? [];
        return discovered.includes(regionId);
    }

    private markQuestSeen(questId: string) {
        this.seenQuestIds.add(questId);
        this.persistSeenQuests();
    }

    private loadLocalState() {
        try {
            const seenRaw = window.localStorage.getItem(this.seenQuestStorageKey);
            if (seenRaw) {
                const parsed = JSON.parse(seenRaw);
                if (Array.isArray(parsed)) {
                    this.seenQuestIds = new Set(parsed.filter((value) => typeof value === 'string'));
                }
            }
        } catch {
            this.seenQuestIds = new Set<string>();
        }

        try {
            const target = window.localStorage.getItem(this.targetQuestStorageKey);
            this.targetedQuestId = target || null;
            this.scene.registry.set('targetedQuestId', this.targetedQuestId);
        } catch {
            this.targetedQuestId = null;
        }
    }

    private persistSeenQuests() {
        try {
            window.localStorage.setItem(this.seenQuestStorageKey, JSON.stringify(Array.from(this.seenQuestIds)));
        } catch {
            // ignore storage failures
        }
    }

    private persistTargetedQuest() {
        try {
            if (!this.targetedQuestId) {
                window.localStorage.removeItem(this.targetQuestStorageKey);
                return;
            }
            window.localStorage.setItem(this.targetQuestStorageKey, this.targetedQuestId);
        } catch {
            // ignore storage failures
        }
    }

    private makeTextImage(text: string, color: string): Phaser.GameObjects.Image {
        const key = this.font.createTextTexture(text, color);
        this.textureKeys.add(key);
        this.renderTextureKeys.add(key);
        return this.scene.add.image(0, 0, key);
    }

    private clearRenderTextures() {
        this.renderTextureKeys.forEach((key) => {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
            this.textureKeys.delete(key);
        });
        this.renderTextureKeys.clear();
    }

    private clearContainer(container: Phaser.GameObjects.Container) {
        const children = [...container.list];
        children.forEach((child) => {
            this.scene.tweens.killTweensOf(child);
            child.destroy();
        });
    }

    private t(key: string, fallback: string, params?: Record<string, string | number>) {
        return this.localeManager.t(key, params, fallback);
    }

    destroy() {
        if (this.localeChangedHandler) {
            window.removeEventListener('locale:changed', this.localeChangedHandler as EventListener);
            this.localeChangedHandler = undefined;
        }
        if (this.advancementsUpdateHandler) {
            window.removeEventListener('advancements:update', this.advancementsUpdateHandler as EventListener);
            this.advancementsUpdateHandler = undefined;
        }

        this.clearContainer(this.headerContainer);
        this.clearContainer(this.leftContainer);
        this.clearContainer(this.rightContainer);

        this.textureKeys.forEach((key) => {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        });
        this.textureKeys.clear();

        this.container.destroy();
    }
}
