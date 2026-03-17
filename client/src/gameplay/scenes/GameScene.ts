/**
 * MAIN GAME ENTRY
 * Orchestrates map loading, physics, player, occlusion, and debug systems
 * using modular components.
 * Guppy Labs 2026
 */

import Phaser from 'phaser';
import { CameraController } from '../camera/CameraController';
import { MapLoader } from '../map/MapLoader';
import { CollisionManager } from '../map/CollisionManager';
import { OcclusionManager } from '../map/OcclusionManager';
import { TiledObjectLayer, getTiledProperty } from '../map/TiledTypes';
import { DepthManager } from '../rendering/DepthManager';
import { ENTITY_BASE, FIRE_BASE, DROPPED_ITEM_BASE, OCCLUSION_OFFSET, GROUND_LAYER_NAMES, OCCLUDABLE_BASE } from '../rendering/DepthBands';
import { MCPlayerController } from '../player/MCPlayerController';
import { StaticInteractiveTarget } from '../interaction/InteractionManager';
import { CharacterService } from '../player/CharacterService';
import { RemotePlayerManager } from '../player/RemotePlayerManager';
import { AINpcManager } from '../ai/AINpcManager';
import { DebugOverlay, ExtendedDebugInfo } from '../debug/DebugOverlay';
import { DustParticleSystem } from '../fx/DustParticleSystem';
import { FireParticleSystem } from '../fx/FireParticleSystem';
import { WaterSystem } from '../fx/water/WaterSystem';
import { LightingManager } from '../fx/LightingManager';
import { VisualEffectsManager } from '../fx/VisualEffectsManager';
import { SeasonalEffectsManager } from '../fx/SeasonalEffectsManager';
import { WorldTimeManager } from '../time/WorldTimeManager';
import { AudioManager, FootstepSurface } from '../audio/AudioManager';
import { LocaleManager } from '../i18n/LocaleManager';
import { DroppedItemManager } from '../items/DroppedItemManager';
import { NPCManager } from '../npc/NPCManager';
import { SoftCollisionSystem } from '../collision/SoftCollisionSystem';
import { Toast } from '../../ui/Toast';
import { DisconnectModal } from '../../ui/DisconnectModal';
import { DialogueManager } from '../dialogue/DialogueManager';
import type { UIScene } from './UIScene';
import {
    ADVANCEMENT_QUEST_CATALOG,
    DEFAULT_CHARACTER_APPEARANCE,
    DEFAULT_GUIDE_TUTORIAL_STATE,
    DEFAULT_USER_ADVANCEMENTS,
    DEFAULT_USER_SETTINGS,
    IAdvancementsState,
    ICharacterAppearance,
    IInstanceInfo,
    IQuestObjectiveEntry,
    IVideoSettings
} from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';
import { hideLoader, setLoaderText, showLoader, currentUser } from '../index';
import { SharedMCTextures } from '../player/SharedMCTextures';
import { FullscreenManager } from '../ui/FullscreenManager';
import { KeybindManager } from '../input/KeybindManager';

interface GameSceneData {
    instance: IInstanceInfo;
}

type HarvestCooldownUiEntry = {
    objectId: number;
    centerX: number;
    centerY: number;
    readyAt: number;
    startedAt: number;
    container: Phaser.GameObjects.Container;
    fill: Phaser.GameObjects.Rectangle;
};

export class GameScene extends Phaser.Scene {
    private static readonly WORLD_METERS_TO_PIXELS = 16;
    private instanceInfo?: IInstanceInfo;
    private networkManager = NetworkManager.getInstance();
    private keybindManager = KeybindManager.getInstance();
    private localeManager = LocaleManager.getInstance();
    private worldTimeManager = WorldTimeManager.getInstance();
    private characterService = CharacterService.getInstance();
    private unsubscribeDisconnect?: () => void;
    private unsubscribeServerTransfer?: () => void;
    private inventoryUpdateHandler?: (event: Event) => void;
    private rodUseHandler?: () => void;
    private isFishingTransition = false;
    private isTransferringServer = false;
    private fishingFadeTimer?: Phaser.Time.TimerEvent;
    private fishingAutoFaceTimer?: Phaser.Time.TimerEvent;

    // Managers
    private mapLoader?: MapLoader;
    private collisionManager?: CollisionManager;
    private occlusionManager?: OcclusionManager;
    private depthManager?: DepthManager;
    private mcPlayerController?: MCPlayerController;
    private cameraController?: CameraController;
    private remotePlayerManager?: RemotePlayerManager;
    private aiNpcManager?: AINpcManager;
    private droppedItemManager?: DroppedItemManager;
    private npcManager?: NPCManager;
    private softCollisionSystem?: SoftCollisionSystem;
    private debugOverlay?: DebugOverlay;
    private dustParticles?: DustParticleSystem;
    private waterSystem?: WaterSystem;
    private lightingManager?: LightingManager;
    private visualEffectsManager?: VisualEffectsManager;
    private seasonalEffectsManager?: SeasonalEffectsManager;
    private audioManager?: AudioManager;
    private dialogueManager?: DialogueManager;
    private groundLayers?: Phaser.Tilemaps.TilemapLayer[];
    private fires: FireParticleSystem[] = [];
    private lastTablistSnapshot = '';
    private currentVideoSettings: IVideoSettings = { ...DEFAULT_USER_SETTINGS.video };
    private advancementsState: IAdvancementsState = {
        enrolled: DEFAULT_USER_ADVANCEMENTS.enrolled,
        questProgress: {},
        completedAchievements: [],
        discoveredRegions: {},
        tutorial: { ...DEFAULT_GUIDE_TUTORIAL_STATE }
    };
    private advancementsUpdateHandler?: (event: Event) => void;
    private questDirectionArrow?: Phaser.GameObjects.Triangle;
    private questTargetMarker?: Phaser.GameObjects.Container;
    private harvestTargets: StaticInteractiveTarget[] = [];
    private readonly chestInteractionObjectId = 990001;
    private harvestCooldownUiByObjectId = new Map<number, HarvestCooldownUiEntry>();
    private dangerRegionPolygon: Array<{ x: number; y: number }> | null = null;
    private dangerStayStartedAtMs: number | null = null;
    private dangerStayDurationMs = 60_000;
    private dangerCountdownDisplay: string | null = null;
    private keyLocationPoi: { x: number; y: number } | null = null;
    private chestPoi: { x: number; y: number } | null = null;
    private keyLocationCue?: Phaser.GameObjects.Particles.ParticleEmitter;
    private bowlTravellerGuideTimer?: Phaser.Time.TimerEvent;
    private chestCinematicActive = false;
    private chestCinematicTimers: Phaser.Time.TimerEvent[] = [];
    private chestCinematicObjects: Phaser.GameObjects.GameObject[] = [];
    private chestCinematicInputBlockedBefore = false;
    
    // Character appearance (fetched async)
    private characterAppearance: ICharacterAppearance = DEFAULT_CHARACTER_APPEARANCE;

    constructor() {
        super('GameScene');
    }

    getMobileControls() {
        return this.mcPlayerController?.getMobileControls();
    }

    getGuideInventoryButtonRect(): Phaser.Geom.Rectangle | null {
        return this.mcPlayerController?.getGuideInventoryButtonRect() ?? null;
    }

    getGuideInteractButtonRect(): Phaser.Geom.Rectangle | null {
        return this.mcPlayerController?.getGuideInteractButtonRect() ?? null;
    }

    init(data: GameSceneData) {
        this.isTransferringServer = false;
        this.instanceInfo = data.instance;
        console.log('[GameScene] Received instance:', this.instanceInfo);
    }

    preload() {
        const mapFile = this.instanceInfo?.mapFile || 'lobby.tmj';

        this.load.image('ui-joystick-base', '/ui/Joystick01a.png');
        this.load.image('ui-joystick-handle', '/ui/Handle01a.png');
        this.load.spritesheet('quest-chest-open', '/assets/animations/chest-open.png', {
            frameWidth: 128,
            frameHeight: 128
        });
        
        // Initialize map loader and preload map
        this.mapLoader = new MapLoader(this, {
            groundLayerNames: GROUND_LAYER_NAMES,
            occludableBaseDepth: OCCLUDABLE_BASE
        });
        this.mapLoader.preloadMap(mapFile);

        // MC character doesn't need traditional preload - assets are composited at runtime
        this.mcPlayerController = new MCPlayerController(this, {
            speed: 1.6,
            sprintSpeed: 2.4,
            accel: 0.10,
            drag: 0.7,
            depth: ENTITY_BASE
        });

        // Initialize audio manager and preload audio assets
        this.audioManager = new AudioManager(this);
        this.audioManager.preload();
    }

    create() {
        this.cameras.main.setBackgroundColor('#121212');

        this.registry.set('inputBlocked', false);

        // Allow other systems to stop audio (e.g., disconnect/AFK)
        this.events.on('stop-audio', this.stopAllAudio, this);

        // Initialize managers
        this.collisionManager = new CollisionManager(this);
        this.occlusionManager = new OcclusionManager(ENTITY_BASE, OCCLUSION_OFFSET);
        this.depthManager = new DepthManager(this.occlusionManager);
        
        this.mcPlayerController?.setDepthManager(this.depthManager);
        this.mcPlayerController?.setOnFishingStart((rodItemId) => {
            this.startFishingWithAutoFacing(rodItemId);
        });
        
        // Initialize visual effects (Post-processing)
        this.visualEffectsManager = new VisualEffectsManager(this);
        
        // Initialize seasonal effects (weather particles + color tints)
        this.seasonalEffectsManager = new SeasonalEffectsManager(this);

        this.applyStartupSettings();
        this.setupQuestIndicators();

        // Launch UI Scene
        this.scene.launch('UIScene');
        const uiScene = this.scene.get('UIScene') as UIScene;

        this.debugOverlay = new DebugOverlay(this, uiScene);
        this.dialogueManager = new DialogueManager(this, uiScene);
        this.setupDebugToggle();

        // Show instance connection status
        this.showConnectionStatus();

        // If using MC character, we need to:
        // 1. Fetch character appearance
        // 2. Initialize MC controller (composites sprites)
        // 3. Then load the map
        this.initializeMCCharacterAndLoadMap();
    }

    /**
     * Initialize MC character with appearance data, then load the map
     */
    private async initializeMCCharacterAndLoadMap() {
        try {
            // Update loader text
            setLoaderText(this.localeManager.t('loader.finishingUp', undefined, 'Finishing Up...'));
            
            // Fetch character appearance from server
            this.characterAppearance = await this.characterService.fetchAppearance();
            console.log('[GameScene] Character appearance loaded:', this.characterAppearance);
            
            // Initialize MC controller (this composites all the sprite layers)
            await this.mcPlayerController?.initialize(this.characterAppearance);
            console.log('[GameScene] MC character initialized');
            
            // Initialize shared MC textures for remote players
            setLoaderText(this.localeManager.t('loader.preparingWorld', undefined, 'Preparing world...'));
            await SharedMCTextures.getInstance().initialize(this);
            console.log('[GameScene] Shared MC textures initialized for remote players');
            
            // Now load the map
            setLoaderText(this.localeManager.t('loader.loadingWorld', undefined, 'Loading world...'));
            this.loadMapLegacy();
        } catch (error) {
            console.error('[GameScene] Error initializing MC character:', error);
            Toast.error(this.localeManager.t('scene.game.characterFallback', undefined, 'Failed to load character, using default'));
            
            // Fall back to default appearance
            this.characterAppearance = DEFAULT_CHARACTER_APPEARANCE;
            await this.mcPlayerController?.initialize(this.characterAppearance);
            await SharedMCTextures.getInstance().initialize(this);
            this.loadMapLegacy();
        }
    }

    /**
     * Load the map (shared between MC and legacy paths)
     */
    private loadMapLegacy() {
        const mapFile = this.instanceInfo?.mapFile || 'lobby.tmj';
        const mapKey = `map-${mapFile.replace('.tmj', '')}`;
        
        if (!this.collisionManager || !this.occlusionManager) {
            console.error('[GameScene] Collision or occlusion manager not initialized');
            return;
        }
        
        this.mapLoader?.loadMap(mapKey, this.collisionManager, this.occlusionManager, (result) => {
            this.lightingManager = result.lightingManager;
            this.onMapLoaded(result.map, result.groundLayers);
        });
    }

    private setupDebugToggle() {
        this.registry.set('debugMenuActive', false);

        this.input.keyboard?.on('keydown-H', () => {
            // Ignore if chat is focused
            if (this.registry.get('chatFocused') === true) return;
            if (this.registry.get('guiOpen') === true) return;
            if (this.registry.get('guideBlockAll') === true) return;
            
            const shiftDown = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)?.isDown ?? false;
            this.debugOverlay?.toggle(shiftDown);
            this.registry.set('debugMenuActive', this.debugOverlay?.isEnabled() === true);
        });

        // Add toggle for visual effects (key 'V')
        this.input.keyboard?.on('keydown-V', () => {
            if (this.registry.get('chatFocused') === true) return;
            if (this.registry.get('guiOpen') === true) return;
            if (this.registry.get('guideBlockAll') === true) return;
            
            const enabled = !this.registry.get('visualEffectsEnabled');
            this.registry.set('visualEffectsEnabled', enabled);
            this.visualEffectsManager?.setAllEffectsEnabled(enabled);
            const state = enabled
                ? this.localeManager.t('system.on', undefined, 'ON')
                : this.localeManager.t('system.off', undefined, 'OFF');
            Toast.info(this.localeManager.t('scene.game.visualEffects', { state }, 'Visual Effects: {state}'), 2000);
        });
        
        // Add toggle for seasonal effects (key 'P')
        this.input.keyboard?.on('keydown-P', () => {
            if (this.registry.get('chatFocused') === true) return;
            if (this.registry.get('guiOpen') === true) return;
            if (this.registry.get('guideBlockAll') === true) return;
            
            const enabled = !this.registry.get('seasonalEffectsEnabled');
            this.registry.set('seasonalEffectsEnabled', enabled);
            this.seasonalEffectsManager?.setEnabled(enabled);
            const state = enabled
                ? this.localeManager.t('system.on', undefined, 'ON')
                : this.localeManager.t('system.off', undefined, 'OFF');
            Toast.info(this.localeManager.t('scene.game.seasonalEffects', { state }, 'Seasonal Effects: {state}'), 2000);
        });
        
        // Meow sound (key 'Z')
        this.input.keyboard?.on('keydown-Z', () => {
            if (this.registry.get('chatFocused') === true) return;
            if (this.registry.get('guiOpen') === true) return;
            if (this.registry.get('guideBlockAll') === true) return;
            
            this.audioManager?.playMeow();
        });

        // Default to user settings until profile settings load
        this.registry.set('visualEffectsEnabled', DEFAULT_USER_SETTINGS.video.visualEffectsEnabled);
        this.registry.set('seasonalEffectsEnabled', DEFAULT_USER_SETTINGS.video.seasonalEffectsEnabled);
    }

    private applyStartupSettings() {
        const cached = this.networkManager.getCachedSettings();
        if (cached) {
            this.keybindManager.hydrateFromSettings(cached);
            this.localeManager.setLocale(cached.language || 'en_US');
            this.audioManager?.applyUserAudioSettings?.(cached.audio);
            this.applyUserVideoSettings({
                ...cached.video,
                fullscreen: FullscreenManager.isEnabled()
            });
            return;
        }

        void this.networkManager.getSettings().then((settings) => {
            if (!settings) return;
            this.keybindManager.hydrateFromSettings(settings);
            this.localeManager.setLocale(settings.language || 'en_US');
            this.audioManager?.applyUserAudioSettings?.(settings.audio);
            this.applyUserVideoSettings({
                ...settings.video,
                fullscreen: FullscreenManager.isEnabled()
            });
        });
    }

    private showConnectionStatus() {
        // Intentionally no-op: connection toasts removed to reduce UI clutter.
    }

    /**
     * Get the active player sprite
     */
    private getActivePlayer(): Phaser.Physics.Matter.Sprite | undefined {
        return this.mcPlayerController?.getPlayer();
    }

    getAudioManager(): AudioManager | undefined {
        return this.audioManager;
    }

    private getFootstepSurfaceForPlayer(player: Phaser.Physics.Matter.Sprite): FootstepSurface {
        const mapFile = this.instanceInfo?.mapFile ?? '';
        if (!mapFile.startsWith('anchor-hollow')) {
            return 'sand';
        }

        const map = this.mapLoader?.getMap();
        if (!map) return 'sand';

        const feet = player.getBottomCenter();
        const trackedLayers = new Set(['Ground', 'Stone', 'Dock']);

        let bestDepth = Number.NEGATIVE_INFINITY;
        let bestLayerName: string | null = null;

        map.layers.forEach((layerData) => {
            if (!trackedLayers.has(layerData.name)) return;
            const layer = layerData.tilemapLayer;
            if (!layer || !layer.visible || layer.alpha <= 0) return;
            const tile = layer.getTileAtWorldXY(feet.x, feet.y, false);
            if (!tile || tile.index < 0) return;

            const depth = layer.depth ?? 0;
            if (depth >= bestDepth) {
                bestDepth = depth;
                bestLayerName = layerData.name;
            }
        });

        if (bestLayerName === 'Dock') return 'wood';
        if (bestLayerName === 'Stone') return 'stone';
        if (bestLayerName === 'Ground') return 'grass';
        return 'sand';
    }

    applyUserVideoSettings(video: IVideoSettings) {
        this.currentVideoSettings = { ...video };

        this.registry.set('visualEffectsEnabled', video.visualEffectsEnabled);
        this.registry.set('seasonalEffectsEnabled', video.seasonalEffectsEnabled);

        this.visualEffectsManager?.setBloomEnabled(video.bloomEnabled);
        this.visualEffectsManager?.setVignetteEnabled(video.vignetteEnabled);
        this.visualEffectsManager?.setTiltShiftEnabled(video.tiltShiftEnabled);
        this.visualEffectsManager?.setCrtEnabled(video.crtEnabled);
        this.visualEffectsManager?.setAllEffectsEnabled(video.visualEffectsEnabled);

        this.seasonalEffectsManager?.setEnabled(video.seasonalEffectsEnabled);
        this.dustParticles?.setEnabled(video.dustParticlesEnabled);

        if (this.scene.isActive('UIScene')) {
            const uiScene = this.scene.get('UIScene') as { applyUserVideoSettings?: (settings: IVideoSettings) => void } | undefined;
            uiScene?.applyUserVideoSettings?.(video);
        }

        void FullscreenManager.setEnabled(video.fullscreen);
    }

    getCurrentVideoSettings(): IVideoSettings {
        return { ...this.currentVideoSettings };
    }

    getPlayerPosition(): { x: number; y: number } | null {
        const player = this.getActivePlayer();
        if (!player) return null;
        return { x: player.x, y: player.y };
    }

    getNpcPosition(id: string): { x: number; y: number; name: string } | null {
        return this.npcManager?.getNpcById(id) ?? null;
    }

    private extractHarvestTargets(map: Phaser.Tilemaps.Tilemap): StaticInteractiveTarget[] {
        const objectLayers = map.objects as TiledObjectLayer[];
        const interactivesLayer = objectLayers.find((layer) => layer.name === 'Interactives');
        if (!interactivesLayer) return [];

        const targets: StaticInteractiveTarget[] = [];
        for (const object of interactivesLayer.objects || []) {
            const componentIdRaw = getTiledProperty(object, 'componentid');
            const componentId = typeof componentIdRaw === 'string' ? componentIdRaw.trim().toLowerCase() : '';
            if (componentId !== 'yekbush') continue;
            if (typeof object.id !== 'number') continue;

            const center = this.getObjectCenter(object);
            if (!center) continue;

            targets.push({
                objectId: Math.floor(object.id),
                componentId,
                x: center.x,
                y: center.y,
                rangePx: 3 * 32
            });
        }

        return targets;
    }

    private getObjectCenter(object: { x: number; y: number; width?: number; height?: number; polygon?: Array<{ x: number; y: number }> }): { x: number; y: number } | null {
        const baseX = Number(object.x ?? 0);
        const baseY = Number(object.y ?? 0);
        if (Array.isArray(object.polygon) && object.polygon.length > 0) {
            let sumX = 0;
            let sumY = 0;
            object.polygon.forEach((point) => {
                sumX += baseX + Number(point.x ?? 0);
                sumY += baseY + Number(point.y ?? 0);
            });
            return {
                x: sumX / object.polygon.length,
                y: sumY / object.polygon.length
            };
        }

        return {
            x: baseX + Number(object.width ?? 0) * 0.5,
            y: baseY + Number(object.height ?? 0) * 0.5
        };
    }

    private upsertHarvestCooldownUi(objectId: number, centerX: number, centerY: number, readyAt: number, cooldownMs: number) {
        const now = Date.now();
        const entry = this.harvestCooldownUiByObjectId.get(objectId);
        const startedAt = Math.max(0, readyAt - Math.max(1, cooldownMs));

        if (entry) {
            entry.centerX = centerX;
            entry.centerY = centerY;
            entry.readyAt = readyAt;
            entry.startedAt = startedAt;
            return;
        }

        const bg = this.add.rectangle(0, 0, 24, 4, 0x000000, 0.45).setOrigin(0.5, 0.5);
        const fill = this.add.rectangle(-11, 0, 22, 2, 0x86e17b, 0.9).setOrigin(0, 0.5);
        const container = this.add.container(centerX, centerY - 18, [bg, fill]);
        container.setDepth(ENTITY_BASE + 2100);
        container.setVisible(true);

        this.harvestCooldownUiByObjectId.set(objectId, {
            objectId,
            centerX,
            centerY,
            readyAt,
            startedAt,
            container,
            fill
        });

        if (readyAt <= now) {
            this.removeHarvestCooldownUi(objectId);
        }
    }

    private removeHarvestCooldownUi(objectId: number) {
        const entry = this.harvestCooldownUiByObjectId.get(objectId);
        if (!entry) return;
        entry.container.destroy(true);
        this.harvestCooldownUiByObjectId.delete(objectId);
    }

    private updateHarvestCooldownUi(timeMs: number) {
        this.harvestCooldownUiByObjectId.forEach((entry, objectId) => {
            if (timeMs >= entry.readyAt) {
                this.removeHarvestCooldownUi(objectId);
                return;
            }

            const total = Math.max(1, entry.readyAt - entry.startedAt);
            const elapsed = Math.max(0, Math.min(total, timeMs - entry.startedAt));
            const ratio = elapsed / total;
            entry.fill.width = Math.max(1, 22 * ratio);
            entry.container.setPosition(entry.centerX, entry.centerY - 18);
            entry.container.setVisible(true);
        });
    }

    private setupQuestIndicators() {
        const cached = this.networkManager.getCachedAdvancementsState();
        if (cached) {
            this.advancementsState = cached;
        }

        this.questDirectionArrow = this.add.triangle(0, 0, -8, -5, 9, 0, -8, 5, 0xffc04d, 0.85);
        this.questDirectionArrow.setVisible(false);
        this.questDirectionArrow.setDepth(ENTITY_BASE - 1);

        const markerStem = this.add.rectangle(0, -6.5, 3.2, 10.5, 0xff9a2e, 0.9).setOrigin(0.5, 1);
        const markerDot = this.add.circle(0, -2.1, 2.1, 0xff9a2e, 0.9);
        this.questTargetMarker = this.add.container(0, 0, [markerStem, markerDot]);
        this.questTargetMarker.setVisible(false);
        this.questTargetMarker.setDepth(ENTITY_BASE + 2001);
        this.questTargetMarker.setScale(1.08);

        this.advancementsUpdateHandler = (event: Event) => {
            const detail = (event as CustomEvent<IAdvancementsState>).detail;
            if (!detail) return;
            const previousBowlProgress = this.advancementsState.questProgress['bowl_that_shines'];
            this.advancementsState = {
                enrolled: detail.enrolled,
                questProgress: { ...detail.questProgress },
                completedAchievements: [...detail.completedAchievements],
                discoveredRegions: Object.fromEntries(
                    Object.entries(detail.discoveredRegions).map(([mapFile, regions]) => [mapFile, [...regions]])
                ),
                tutorial: { ...detail.tutorial }
            };
            this.maybeShowBowlTravellerGuide(previousBowlProgress, this.advancementsState.questProgress['bowl_that_shines']);
            this.refreshStaticInteractiveTargets();
        };

        window.addEventListener('advancements:update', this.advancementsUpdateHandler as EventListener);
    }

    private maybeShowBowlTravellerGuide(
        previousProgress: IAdvancementsState['questProgress'][string] | undefined,
        nextProgress: IAdvancementsState['questProgress'][string] | undefined
    ) {
        const previousIndex = typeof previousProgress?.objectiveIndex === 'number'
            ? Math.floor(previousProgress.objectiveIndex)
            : null;
        const nextIndex = typeof nextProgress?.objectiveIndex === 'number'
            ? Math.floor(nextProgress.objectiveIndex)
            : null;
        const transitionedToTravellerStep = nextProgress?.status === 'active' && nextIndex === 1 && previousIndex !== 1;
        if (!transitionedToTravellerStep) {
            return;
        }

        const uiScene = this.scene.get('UIScene') as UIScene | undefined;
        if (!uiScene) return;

        const targetRect = this.getGuideNpcScreenRect('traveller');
        uiScene.showGuideOverlay({
            message: this.localeManager.t(
                'guide.bowlThatShines.travellerHint',
                undefined,
                'Hm... I wonder if the traveller has had the info all along.'
            ),
            targetRect,
            dimBackground: true
        });

        this.bowlTravellerGuideTimer?.remove(false);
        this.bowlTravellerGuideTimer = this.time.delayedCall(4200, () => {
            uiScene.clearGuideOverlay();
            this.bowlTravellerGuideTimer = undefined;
        });
    }

    private getGuideNpcScreenRect(npcId: string): Phaser.Geom.Rectangle | null {
        const npc = this.getNpcPosition(npcId);
        if (!npc) return null;
        const camera = this.cameras.main;
        const width = 34;
        const height = 56;
        return new Phaser.Geom.Rectangle(
            npc.x - camera.scrollX - width / 2,
            npc.y - camera.scrollY - height,
            width,
            height
        );
    }

    private getTargetedQuestObjective(): { questId: string; objective: IQuestObjectiveEntry } | null {
        const targetedQuestId = this.registry.get('targetedQuestId') as string | null;
        if (!targetedQuestId) return null;

        const questEntry = ADVANCEMENT_QUEST_CATALOG.find((entry) => entry.id === targetedQuestId);
        if (!questEntry) return null;

        const progress = this.advancementsState.questProgress[targetedQuestId];
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

        return {
            questId: targetedQuestId,
            objective
        };
    }

    private getQuestObjectiveTarget(objective: IQuestObjectiveEntry, playerX: number, playerY: number): { x: number; y: number } | null {
        if (objective.kind === 'talk-to-npc' && objective.npcId) {
            const npc = this.getNpcPosition(objective.npcId);
            if (!npc) return null;
            return { x: npc.x, y: npc.y };
        }

        if (objective.kind === 'harvest-interactive' && objective.componentId) {
            const componentId = objective.componentId.trim().toLowerCase();
            if (componentId === 'glimmeringchest') {
                return this.chestPoi ? { x: this.chestPoi.x, y: this.chestPoi.y } : null;
            }
            const matching = this.harvestTargets.filter((target) => target.componentId === componentId);
            if (matching.length === 0) return null;

            if (typeof objective.mapObjectId === 'number') {
                const exact = matching.find((target) => target.objectId === Math.floor(objective.mapObjectId as number));
                if (exact) {
                    return { x: exact.x, y: exact.y };
                }
            }

            let best = matching[0];
            let bestDistance = Math.hypot(best.x - playerX, best.y - playerY);
            for (let index = 1; index < matching.length; index++) {
                const candidate = matching[index];
                const distance = Math.hypot(candidate.x - playerX, candidate.y - playerY);
                if (distance < bestDistance) {
                    best = candidate;
                    bestDistance = distance;
                }
            }

            return { x: best.x, y: best.y };
        }

        if (objective.kind === 'fish-near-location' && objective.locationName) {
            if (!this.keyLocationPoi) return null;
            if (objective.locationName !== 'KeyLocation') return null;
            return { x: this.keyLocationPoi.x, y: this.keyLocationPoi.y };
        }

        return null;
    }

    private updateDangerCountdownUi(timeMs: number) {
        const progress = this.advancementsState.questProgress?.heed_the_warning;
        const questIsOnStayObjective = progress?.status === 'active'
            && (typeof progress.objectiveIndex !== 'number' || Math.floor(progress.objectiveIndex) === 0);

        const player = this.getActivePlayer();
        if (!questIsOnStayObjective || !player || !this.dangerRegionPolygon) {
            this.dangerStayStartedAtMs = null;
            this.setDangerCountdownDisplay(null);
            return;
        }

        const inDanger = this.isPointInPolygon(player.x, player.y, this.dangerRegionPolygon);
        if (!inDanger) {
            this.dangerStayStartedAtMs = null;
            this.setDangerCountdownDisplay(null);
            return;
        }

        if (this.dangerStayStartedAtMs === null) {
            this.dangerStayStartedAtMs = timeMs;
        }

        const elapsed = Math.max(0, timeMs - this.dangerStayStartedAtMs);
        const remainingMs = Math.max(0, this.dangerStayDurationMs - elapsed);
        const remainingSeconds = (remainingMs / 1000).toFixed(1);
        this.setDangerCountdownDisplay(`${remainingSeconds}s`);
    }

    private setDangerCountdownDisplay(value: string | null) {
        if (this.dangerCountdownDisplay === value) return;
        this.dangerCountdownDisplay = value;
        this.registry.set('dangerZoneCountdown', value);
    }

    private extractRegionPolygon(map: Phaser.Tilemaps.Tilemap, regionName: string): Array<{ x: number; y: number }> | null {
        const objectLayer = map.getObjectLayer('Regions') as TiledObjectLayer | null;
        if (!objectLayer || !Array.isArray(objectLayer.objects)) return null;

        const target = objectLayer.objects.find((object) => object.name === regionName && Array.isArray(object.polygon) && object.polygon.length >= 3);
        if (!target || !Array.isArray(target.polygon)) return null;

        const baseX = Number(target.x ?? 0);
        const baseY = Number(target.y ?? 0);
        return target.polygon.map((point) => ({
            x: baseX + Number(point.x ?? 0),
            y: baseY + Number(point.y ?? 0)
        }));
    }

    private isPointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;
            const intersects = ((yi > y) !== (yj > y))
                && (x < ((xj - xi) * (y - yi)) / ((yj - yi) + 0.0000001) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    private updateQuestIndicators(time: number) {
        const objectiveData = this.getTargetedQuestObjective();
        if (!objectiveData) {
            this.questDirectionArrow?.setVisible(false);
            this.questTargetMarker?.setVisible(false);
            return;
        }

        const player = this.getActivePlayer();
        if (!player) {
            this.questDirectionArrow?.setVisible(false);
            this.questTargetMarker?.setVisible(false);
            return;
        }

        const target = this.getQuestObjectiveTarget(objectiveData.objective, player.x, player.y);
        if (!target) {
            this.questDirectionArrow?.setVisible(false);
            this.questTargetMarker?.setVisible(false);
            return;
        }

        const dx = target.x - player.x;
        const dy = target.y - player.y;
        const angle = Math.atan2(dy, dx);
        const distance = Math.max(1, Math.hypot(dx, dy));
        const directionX = dx / distance;
        const directionY = dy / distance;
        const hideArrowDistancePx = 10 * 10;

        const feet = player.getBottomCenter();
        const playerHalfWidth = Math.max(10, (player.displayWidth || 0) * 0.5);
        const arrowClearance = 16;
        const arrowPushOut = Math.max(34, playerHalfWidth + arrowClearance);
        const arrowX = feet.x + directionX * arrowPushOut;
        const arrowY = feet.y - 8 + directionY * arrowPushOut;
        const warp = 0.62 + 0.22 * Math.abs(directionX);

        if (this.questDirectionArrow) {
            if (distance <= hideArrowDistancePx) {
                this.questDirectionArrow.setVisible(false);
            } else {
                this.questDirectionArrow.setVisible(true);
                this.questDirectionArrow.setPosition(arrowX, arrowY);
                this.questDirectionArrow.setRotation(angle);
                this.questDirectionArrow.setScale(0.82, warp);
                this.questDirectionArrow.setAlpha(0.7 + Math.sin(time * 0.01) * 0.08);
                this.questDirectionArrow.setDepth((player.depth ?? ENTITY_BASE) - 1);
            }
        }

        if (this.questTargetMarker) {
            const bobOffset = Math.sin(time * 0.0045) * 1.2;
            this.questTargetMarker.setVisible(true);
            this.questTargetMarker.setPosition(target.x, target.y - 54 + bobOffset);
            this.questTargetMarker.setScale(1.12, 1.16);
            this.questTargetMarker.setAlpha(0.93);
        }
    }

    setDialogueActive(active: boolean, focusPoint?: { x: number; y: number }) {
        if (active) {
            this.registry.set('inputBlocked', true);
            this.mcPlayerController?.getMobileControls()?.setInputBlocked(true);
            if (focusPoint) {
                this.cameraController?.setDialogueFocus(focusPoint, 1.35);
            }
            this.audioManager?.setDialogueMuffle(true);
        } else {
            if (!this.isFishingTransition) {
                this.registry.set('inputBlocked', false);
                this.mcPlayerController?.getMobileControls()?.setInputBlocked(false);
            }
            this.cameraController?.clearDialogueFocus();
            this.audioManager?.setDialogueMuffle(false);
        }
    }

    setInteractionCooldown(durationMs: number) {
        this.mcPlayerController?.setInteractionCooldown(durationMs);
    }

    updateAfkOnly(delta: number) {
        this.mcPlayerController?.updateAfkOnly(delta);
    }

    private onMapLoaded(map: Phaser.Tilemaps.Tilemap, groundLayers: Phaser.Tilemaps.TilemapLayer[]) {
        this.groundLayers = groundLayers;
        // Pass lighting manager to local player (available now after map load)
        if (this.lightingManager) {
            this.mcPlayerController?.setLightingManager(this.lightingManager);
        }
        // Spawn player using active controller
        let player: Phaser.Physics.Matter.Sprite | undefined;
        
        player = this.mcPlayerController?.spawn(map);
        if (player && typeof this.instanceInfo?.spawnX === 'number' && typeof this.instanceInfo?.spawnY === 'number') {
            player.setPosition(this.instanceInfo.spawnX, this.instanceInfo.spawnY);
            player.setVelocity(0, 0);
        }
        
        if (player) {
            this.lightingManager?.enableLightingOn(player);

            if (this.cameraController) {
                this.cameraController.destroy();
            }
            this.cameraController = new CameraController(this, map, player, { zoom: 2 });

            // Initialize dust particle system for player
            this.dustParticles = new DustParticleSystem(this, player, map);
            this.dustParticles.setEnabled(this.currentVideoSettings.dustParticlesEnabled);

            // Initialize water system (splash, footprints, depth effects)
            this.waterSystem = new WaterSystem(this, player, groundLayers);
        }

        // Create fire effects from POI points in the map
        this.setupFireEffects(map);
        this.setupKeyLocationCue(map);
        this.setupChestPoi(map);

        // Load NPCs from POI points in the map
        this.npcManager = new NPCManager(this, {
            baseDepth: ENTITY_BASE,
            occlusionManager: this.occlusionManager,
            depthManager: this.depthManager,
            lightingManager: this.lightingManager
        });
        this.npcManager.loadAndSpawnFromMap(map);
        this.mcPlayerController?.setNpcManager(this.npcManager);

        this.harvestTargets = this.extractHarvestTargets(map);
        this.refreshStaticInteractiveTargets();
        this.dangerRegionPolygon = this.extractRegionPolygon(map, 'Danger');
        const heedQuestEntry = ADVANCEMENT_QUEST_CATALOG.find((entry) => entry.id === 'heed_the_warning');
        const stayObjective = heedQuestEntry?.objectives?.find((objective) => objective.kind === 'stay-in-region' && objective.regionName === 'Danger');
        if (stayObjective && typeof stayObjective.durationMs === 'number' && Number.isFinite(stayObjective.durationMs)) {
            this.dangerStayDurationMs = Math.max(1000, Math.floor(stayObjective.durationMs));
        }
        this.setDangerCountdownDisplay(null);

        // Initial occlusion update
        if (player) {
            this.occlusionManager?.update(player);
        }

        // Setup multiplayer and world time
        this.setupMultiplayer();
        if (this.mcPlayerController) {
            this.softCollisionSystem = new SoftCollisionSystem(
                this.mcPlayerController,
                this.remotePlayerManager,
                this.npcManager,
                this.aiNpcManager
            );
        }
        this.worldTimeManager.initialize();
        
        // Initialize seasonal effects with current season
        this.seasonalEffectsManager?.initialize();
        this.seasonalEffectsManager?.setInitialSeason(this.worldTimeManager.getTime().season);
        this.applyUserVideoSettings(this.currentVideoSettings);

        // Initialize audio (music and ambient sounds for this map)
        const mapFile = this.instanceInfo?.mapFile || 'lobby.tmj';
        const mapKey = `map-${mapFile.replace('.tmj', '')}`;
        this.audioManager?.initialize(mapKey);

        // Map is fully loaded - hide the loader and show controls
        hideLoader();
        this.mcPlayerController?.getMobileControls()?.show();

    }

    private setupFireEffects(map: Phaser.Tilemaps.Tilemap) {
        if (!this.lightingManager) return;
        
        this.fires = FireParticleSystem.createFromMap(this, map, FIRE_BASE);
        this.fires.forEach(fire => {
            fire.setupLight(this.lightingManager!, 120, 1.5);
        });
        
        // Register fire positions with audio manager for distance-based volume
        const firePositions = this.fires.map(fire => fire.getPosition());
        this.audioManager?.setFirePositions(firePositions);
    }

    private setupKeyLocationCue(map: Phaser.Tilemaps.Tilemap) {
        this.keyLocationPoi = this.findPoiPoint(map, 'KeyLocation');
        this.keyLocationCue?.stop();
        this.keyLocationCue?.destroy();
        this.keyLocationCue = undefined;

        if (!this.keyLocationPoi) {
            return;
        }

        const textureKey = 'quest-keylocation-cue';
        if (!this.textures.exists(textureKey)) {
            const graphics = this.make.graphics({ x: 0, y: 0 }, false);
            graphics.fillStyle(0xffffff, 0.7);
            graphics.fillCircle(4, 4, 4);
            graphics.fillStyle(0xffffff, 0.3);
            graphics.fillCircle(4, 4, 2);
            graphics.generateTexture(textureKey, 8, 8);
            graphics.destroy();
        }

        this.keyLocationCue = this.add.particles(
            this.keyLocationPoi.x,
            this.keyLocationPoi.y,
            textureKey,
            {
                lifespan: { min: 800, max: 1400 },
                speed: { min: 1, max: 6 },
                scale: { start: 0.22, end: 0.02 },
                alpha: { start: 0.3, end: 0 },
                frequency: 280,
                quantity: 1,
                emitZone: {
                    type: 'random',
                    source: new Phaser.Geom.Circle(0, 0, 10)
                },
                blendMode: Phaser.BlendModes.ADD
            }
        );
        this.keyLocationCue.setDepth(FIRE_BASE - 2);
        this.keyLocationCue.stop();
    }

    private setupChestPoi(map: Phaser.Tilemaps.Tilemap) {
        this.chestPoi = this.findTileLayerCenter(map, 'Chest');
    }

    private refreshStaticInteractiveTargets() {
        const targets = [...this.harvestTargets];
        if (this.isBowlChestStepActive() && this.chestPoi) {
            targets.unshift({
                objectId: this.chestInteractionObjectId,
                componentId: 'glimmeringchest',
                x: this.chestPoi.x,
                y: this.chestPoi.y,
                rangePx: 3 * GameScene.WORLD_METERS_TO_PIXELS
            });
        }
        this.mcPlayerController?.setStaticInteractives(targets);
    }

    private findTileLayerCenter(map: Phaser.Tilemaps.Tilemap, layerName: string): { x: number; y: number } | null {
        const layerData = map.layers.find((layer) => layer.name === layerName);
        if (!layerData || !Array.isArray(layerData.data)) return null;

        const tileWidth = Number(map.tileWidth || 0);
        const tileHeight = Number(map.tileHeight || 0);
        const layerOffsetX = Number((layerData as any).x ?? 0);
        const layerOffsetY = Number((layerData as any).y ?? 0);

        for (let ty = 0; ty < layerData.data.length; ty += 1) {
            const row = layerData.data[ty];
            if (!Array.isArray(row)) continue;
            for (let tx = 0; tx < row.length; tx += 1) {
                const tile = row[tx];
                if (!tile || tile.index < 0) continue;
                const centerX = layerOffsetX + (tx * tileWidth) + tileWidth * 0.5;
                const centerY = layerOffsetY + (ty * tileHeight) + tileHeight * 0.5;
                return { x: centerX, y: centerY };
            }
        }

        return null;
    }

    private findPoiPoint(map: Phaser.Tilemaps.Tilemap, name: string): { x: number; y: number } | null {
        const poiLayer = map.getObjectLayer('POI') as TiledObjectLayer | null;
        if (!poiLayer || !Array.isArray(poiLayer.objects)) return null;
        const poiObject = poiLayer.objects.find((object) => object.name === name);
        if (!poiObject) return null;
        return {
            x: Number(poiObject.x ?? 0) + Number(poiObject.width ?? 0) / 2,
            y: Number(poiObject.y ?? 0) + Number(poiObject.height ?? 0) / 2
        };
    }

    private updateKeyLocationCue(hour: number) {
        if (!this.keyLocationCue || !this.keyLocationPoi) return;
        const isNightWindow = hour >= 23 || hour < 4;
        const isKeyStepActive = this.isBowlFishNearLocationStepActive();

        const shouldEmit = isNightWindow && isKeyStepActive;
        const isCurrentlyOn = this.keyLocationCue.on;
        if (shouldEmit && !isCurrentlyOn) {
            this.keyLocationCue.start();
        } else if (!shouldEmit && isCurrentlyOn) {
            this.keyLocationCue.stop();
        }
        this.keyLocationCue.setPosition(this.keyLocationPoi.x, this.keyLocationPoi.y);
    }

    private isBowlFishNearLocationStepActive(): boolean {
        const progress = this.advancementsState.questProgress['bowl_that_shines'];
        if (progress?.status !== 'active') return false;
        const questEntry = ADVANCEMENT_QUEST_CATALOG.find((entry) => entry.id === 'bowl_that_shines');
        if (!questEntry || !Array.isArray(questEntry.objectives) || questEntry.objectives.length === 0) return false;
        const objectiveIndex = typeof progress.objectiveIndex === 'number'
            ? Math.max(0, Math.min(questEntry.objectives.length - 1, Math.floor(progress.objectiveIndex)))
            : 0;
        const objective = questEntry.objectives[objectiveIndex];
        return objective?.kind === 'fish-near-location' && objective.locationName === 'KeyLocation';
    }

    private isBowlChestStepActive(): boolean {
        const progress = this.advancementsState.questProgress['bowl_that_shines'];
        if (progress?.status !== 'active') return false;
        const questEntry = ADVANCEMENT_QUEST_CATALOG.find((entry) => entry.id === 'bowl_that_shines');
        if (!questEntry || !Array.isArray(questEntry.objectives) || questEntry.objectives.length === 0) return false;
        const objectiveIndex = typeof progress.objectiveIndex === 'number'
            ? Math.max(0, Math.min(questEntry.objectives.length - 1, Math.floor(progress.objectiveIndex)))
            : 0;
        const objective = questEntry.objectives[objectiveIndex];
        return objective?.kind === 'harvest-interactive' && objective.componentId === 'glimmeringchest';
    }

    private setupMultiplayer() {
        this.remotePlayerManager = new RemotePlayerManager(this, {
            playerFrontDepth: ENTITY_BASE,
            occlusionManager: this.occlusionManager,
            depthManager: this.depthManager,
            lightingManager: this.lightingManager,
            groundLayers: this.groundLayers
        });
        this.remotePlayerManager.initialize();

        this.aiNpcManager = new AINpcManager(this, {
            baseDepth: ENTITY_BASE,
            occlusionManager: this.occlusionManager,
            depthManager: this.depthManager,
            lightingManager: this.lightingManager,
            groundLayers: this.groundLayers
        });
        this.aiNpcManager.initialize();

        this.softCollisionSystem?.updateBindings(this.remotePlayerManager, this.npcManager, this.aiNpcManager);

        this.droppedItemManager = new DroppedItemManager(this, {
            occlusionManager: this.occlusionManager,
            depthManager: this.depthManager,
            baseDepth: DROPPED_ITEM_BASE
        });
        this.droppedItemManager.initialize();

        // Connect remote player manager to player controller for interaction detection
        const activeController = this.mcPlayerController;
        if (activeController && this.remotePlayerManager) {
            activeController.setRemotePlayerManager(this.remotePlayerManager);
        }
        // Listen for chat messages (relayed from UIScene) for chat bubbles
        this.game.events.on('chat-message', this.handleChatMessage, this);

        this.inventoryUpdateHandler = (event: Event) => {
            const customEvent = event as CustomEvent<{ equippedRodId?: string | null }>;
            const equippedRodId = customEvent.detail?.equippedRodId ?? null;
            this.mcPlayerController?.setEquippedRodId(equippedRodId);
        };
        window.addEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);

        this.rodUseHandler = () => {
            this.mcPlayerController?.requestFishing();
        };
        window.addEventListener('hud:rod-use', this.rodUseHandler);
        this.networkManager.getInventory().then((data) => {
            if (data?.equippedRodId !== undefined) {
                this.mcPlayerController?.setEquippedRodId(data.equippedRodId ?? null);
            }
        });
        
        // Listen for shove events from server
        this.setupShoveListener();
        this.setupShoveAttemptListener();
        this.setupFishingListener();
        this.setupHarvestListener();
        this.setupChestListener();
        
        // Listen for server disconnection
        this.unsubscribeDisconnect = this.networkManager.onDisconnect((code) => {
            if (this.isTransferringServer) return;
            console.log(`[GameScene] Server disconnected with code: ${code}`);
            this.stopAllAudio();
            this.registry.set('inputBlocked', true);
            this.mcPlayerController?.getMobileControls()?.setInputBlocked(true);

            const error = this.networkManager.getConnectionError();
            const detail = error ? ` (${error})` : ` (code ${code})`;

            if (code === 4003) {
                DisconnectModal.show({
                    title: this.localeManager.t('scene.game.bannedTitle', undefined, 'BANNED'),
                    message: this.localeManager.t('scene.game.bannedMessage', undefined, 'You have been banned from Cute Fish With Knives.'),
                    showReconnect: false,
                    icon: 'ban'
                });
                return;
            }

            if (code === 4000) {
                DisconnectModal.show({
                    title: this.localeManager.t('scene.game.afkTitle', undefined, 'AFK Timeout'),
                    message: this.localeManager.t('scene.game.afkMessage', undefined, 'You were disconnected for being idle. Reconnect when you are ready to play.'),
                    icon: 'afk',
                    onReconnect: () => {
                        this.scene.stop('UIScene');
                        this.scene.start('BootScene');
                    }
                });
                return;
            }

            if (code === 4005) {
                DisconnectModal.show({
                    title: this.localeManager.t('scene.game.wipedTitle', undefined, 'Game Wiped'),
                    message: this.localeManager.t('scene.game.wipedMessage', undefined, 'Your gameplay data was reset by an admin. Please reconnect.'),
                    icon: 'disconnect',
                    onReconnect: () => {
                        this.scene.stop('UIScene');
                        this.scene.start('BootScene');
                    }
                });
                return;
            }

            DisconnectModal.show({
                title: this.localeManager.t('scene.game.offlineTitle', undefined, 'Server Offline'),
                message: `The connection to the game server was lost${detail}.<br>Please try again later.`,
                icon: 'disconnect',
                onReconnect: () => {
                    this.scene.stop('UIScene');
                    this.scene.start('BootScene');
                }
            });
        });

        this.unsubscribeServerTransfer = this.networkManager.onServerTransfer((locationId) => {
            this.beginServerTransfer(locationId);
        });
        
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
             this.game.events.off('chat-message', this.handleChatMessage, this);
             this.unsubscribeDisconnect?.();
             this.unsubscribeServerTransfer?.();
             if (this.inventoryUpdateHandler) {
                 window.removeEventListener('inventory:update', this.inventoryUpdateHandler as EventListener);
             }
             if (this.rodUseHandler) {
                 window.removeEventListener('hud:rod-use', this.rodUseHandler);
             }
                         if (this.advancementsUpdateHandler) {
                                 window.removeEventListener('advancements:update', this.advancementsUpdateHandler as EventListener);
                                 this.advancementsUpdateHandler = undefined;
                         }
             this.events.off('stop-audio', this.stopAllAudio, this);
             this.events.off('fishing:stop', this.stopFishing, this);
                         this.fishingAutoFaceTimer?.remove(false);
                         this.fishingAutoFaceTimer = undefined;
                             this.questDirectionArrow?.destroy();
                             this.questDirectionArrow = undefined;
                             this.questTargetMarker?.destroy();
                             this.questTargetMarker = undefined;
                        this.keyLocationCue?.stop();
                        this.keyLocationCue?.destroy();
                        this.keyLocationCue = undefined;
                        this.keyLocationPoi = null;
                        this.chestPoi = null;
                        this.bowlTravellerGuideTimer?.remove(false);
                        this.bowlTravellerGuideTimer = undefined;
                        this.cleanupChestCinematic(true);
                             this.harvestCooldownUiByObjectId.forEach((entry) => entry.container.destroy(true));
                             this.harvestCooldownUiByObjectId.clear();
               this.npcManager?.destroy();
                         this.dialogueManager?.destroy();
        });

        this.events.on('fishing:stop', this.stopFishing, this);
    }

    private beginServerTransfer(locationId: string) {
        if (this.isTransferringServer) return;
        this.isTransferringServer = true;

        localStorage.setItem('cfwk_join_location_override', locationId);
        setLoaderText(this.localeManager.t('scene.boot.connecting', undefined, 'Connecting...'));
        showLoader();

        this.registry.set('inputBlocked', true);
        this.mcPlayerController?.getMobileControls()?.setInputBlocked(true);
        this.stopAllAudio();

        this.networkManager.disconnect();
        this.scene.stop('UIScene');
        this.scene.start('BootScene');
    }

    private stopAllAudio() {
        this.audioManager?.destroy();
    }

    private handleChatMessage(data: { sessionId: string; message: string }) {
        const mySessionId = this.networkManager.getSessionId();
        if (data.sessionId === mySessionId) {
            this.mcPlayerController?.showChat(data.message);
        } else {
            this.remotePlayerManager?.showChat(data.sessionId, data.message);
        }
    }

    private startFishingWithAutoFacing(rodItemId: string) {
        if (this.isFishingTransition) return;

        const player = this.getActivePlayer();
        const target = player
            ? this.waterSystem?.getNearestExposedWaterTileWorldPosition(player.x, player.y)
            : undefined;

        if (!player || !target) {
            this.startFishingTransition(rodItemId);
            return;
        }

        const desiredRotation = Math.atan2(target.y - player.y, target.x - player.x);
        const rotationSeconds = this.mcPlayerController?.getRotationTimeTo(desiredRotation) ?? 0;
        const rotationDelayMs = Math.ceil(rotationSeconds * 1000);

        this.mcPlayerController?.setForcedFacingTarget(desiredRotation);
        this.registry.set('inputBlocked', true);
        this.mcPlayerController?.getMobileControls()?.setInputBlocked(true);

        this.fishingAutoFaceTimer?.remove(false);
        this.fishingAutoFaceTimer = this.time.delayedCall(rotationDelayMs, () => {
            this.fishingAutoFaceTimer = undefined;
            this.startFishingTransition(rodItemId);
        });
    }

    private startFishingTransition(rodItemId: string) {
        if (this.isFishingTransition) return;
        this.isFishingTransition = true;
        this.registry.set('inputBlocked', true);
        this.mcPlayerController?.getMobileControls()?.setInputBlocked(true);

        if (this.fishingFadeTimer) {
            this.fishingFadeTimer.remove(false);
        }

        this.fishingFadeTimer = this.time.delayedCall(250, () => {
            this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
                this.mcPlayerController?.setForcedFacingTarget(undefined);
                this.scene.launch('FishingScene', { rodItemId });
                this.scene.pause();
            });
            this.cameras.main.fadeOut(250, 0, 0, 0);
        });
    }

    private stopFishing() {
        this.isFishingTransition = false;
        this.fishingAutoFaceTimer?.remove(false);
        this.fishingAutoFaceTimer = undefined;
        this.fishingFadeTimer?.remove(false);
        this.fishingFadeTimer = undefined;
        this.networkManager.sendFishingStop();
        this.mcPlayerController?.setFishingActive(false);
        this.mcPlayerController?.setForcedFacingTarget(undefined);
        this.registry.set('inputBlocked', false);
        this.mcPlayerController?.getMobileControls()?.setInputBlocked(false);
        this.cameras.main.fadeIn(220, 0, 0, 0);
    }

    /**
     * Setup listener for shove events from server
     */
    private setupShoveListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.onMessage("shove", (data: {
            attackerSessionId: string;
            targetSessionId: string;
        }) => {
            const mySessionId = this.networkManager.getSessionId();

            if (data.targetSessionId === mySessionId) {
                // We are the victim — camera shake, walk anim handled by impulse
                this.cameras.main.shake(80, 0.0015);
                console.log('[GameScene] We got shoved!');
            } else {
                const remoteTarget = this.remotePlayerManager?.getPlayers().get(data.targetSessionId);
                // Victim gets shove walk animation (forward/backward relative to facing)
                remoteTarget?.startShoveState(600);

                // Apply shove hit effect when we are the attacker (local validation)
                if (data.attackerSessionId === mySessionId) {
                    remoteTarget?.playShoveEffect();
                }
            }

            if (data.attackerSessionId === mySessionId) {
                console.log('[GameScene] We shoved someone!');
            }
        });
    }

    /**
     * Setup listener for shove attempts (play animation even on miss)
     */
    private setupShoveAttemptListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.onMessage("shoveAttempt", (data: {
            attackerSessionId: string;
            targetSessionId: string;
        }) => {
            const mySessionId = this.networkManager.getSessionId();

            if (data.attackerSessionId === mySessionId) {
                // Local player already plays animation on input
                return;
            }

            const remoteAttacker = this.remotePlayerManager?.getPlayers().get(data.attackerSessionId);
            remoteAttacker?.playInteractAnimation();
        });
    }

    private setupFishingListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.onMessage("fishing:start", (data: { sessionId: string; rodItemId: string | null }) => {
            if (!data?.rodItemId) return;
            const mySessionId = this.networkManager.getSessionId();
            if (data.sessionId === mySessionId) {
                return;
            }
            this.remotePlayerManager?.showFishingBubble(data.sessionId, data.rodItemId);
        });
    }

    private setupHarvestListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        const applyCooldown = (payload: { objectId?: number; readyAt?: number; cooldownMs?: number; centerX?: number; centerY?: number }) => {
            if (!Number.isFinite(payload.objectId) || !Number.isFinite(payload.readyAt)) return;
            const objectId = Math.floor(Number(payload.objectId));
            const readyAt = Math.floor(Number(payload.readyAt));
            if (objectId <= 0) return;

            this.mcPlayerController?.setInteractiveCooldown(objectId, readyAt);

            const target = this.harvestTargets.find((entry) => entry.objectId === objectId);
            const centerX = Number.isFinite(payload.centerX) ? Number(payload.centerX) : (target?.x ?? 0);
            const centerY = Number.isFinite(payload.centerY) ? Number(payload.centerY) : (target?.y ?? 0);
            const cooldownMs = Number.isFinite(payload.cooldownMs) ? Math.floor(Number(payload.cooldownMs)) : 40_000;
            this.upsertHarvestCooldownUi(objectId, centerX, centerY, readyAt, cooldownMs);
        };

        room.onMessage('interactive:harvest:success', (data: { objectId?: number; readyAt?: number; cooldownMs?: number; centerX?: number; centerY?: number }) => {
            applyCooldown(data);
        });

        room.onMessage('interactive:harvest:cooldown', (data: { objectId?: number; readyAt?: number; cooldownMs?: number; centerX?: number; centerY?: number }) => {
            applyCooldown(data);
        });
    }

    private setupChestListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.onMessage('interactive:chest:opened', (data: { centerX?: number; centerY?: number; componentId?: string }) => {
            if (data?.componentId !== 'glimmeringchest') return;
            const fallback = this.chestPoi;
            const centerX = Number.isFinite(data?.centerX) ? Number(data.centerX) : (fallback?.x ?? 0);
            const centerY = Number.isFinite(data?.centerY) ? Number(data.centerY) : (fallback?.y ?? 0);
            this.playChestOpenCinematic(centerX, centerY);
        });
    }

    private playChestOpenCinematic(centerX: number, centerY: number) {
        if (this.chestCinematicActive) return;
        this.chestCinematicActive = true;
        this.chestCinematicInputBlockedBefore = this.registry.get('inputBlocked') === true;
        this.registry.set('inputBlocked', true);
        this.mcPlayerController?.getMobileControls()?.setInputBlocked(true);

        const chestAnimKey = 'quest-chest-open-anim';
        if (!this.anims.exists(chestAnimKey)) {
            this.anims.create({
                key: chestAnimKey,
                frames: this.anims.generateFrameNumbers('quest-chest-open', { start: 0, end: 10 }),
                frameRate: 14,
                repeat: 0
            });
        }

        const chest = this.add.sprite(centerX, centerY, 'quest-chest-open', 0);
        chest.setDepth(ENTITY_BASE + 2200);
        chest.setScale(1.0);
        this.chestCinematicObjects.push(chest);

        const bowlInChest = this.add.image(centerX, centerY - 4, 'ui-glimmerbowl', 0);
        bowlInChest.setDepth(ENTITY_BASE + 2201);
        bowlInChest.setScale(2.2);
        bowlInChest.setVisible(false);
        this.chestCinematicObjects.push(bowlInChest);

        let hasShownBowlInChest = false;
        chest.on(Phaser.Animations.Events.ANIMATION_UPDATE, (_anim: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame) => {
            const frameIndex = Number(frame.textureFrame);
            if (!hasShownBowlInChest && Number.isFinite(frameIndex) && frameIndex >= 4) {
                hasShownBowlInChest = true;
                bowlInChest.setVisible(true);
            }
        });

        chest.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
            const pauseTimer = this.time.delayedCall(750, () => {
                this.startChestRevealOverlay();
            });
            this.chestCinematicTimers.push(pauseTimer);
        });

        chest.play(chestAnimKey);
    }

    private startChestRevealOverlay() {
        const whiteFade = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0xffffff, 0);
        whiteFade.setOrigin(0, 0);
        whiteFade.setScrollFactor(0);
        whiteFade.setDepth(20000);
        this.chestCinematicObjects.push(whiteFade);

        const bowlReveal = this.add.image(this.scale.width * 0.5, this.scale.height * 0.52, 'ui-glimmerbowl', 0);
        bowlReveal.setScrollFactor(0);
        bowlReveal.setDepth(20001);
        bowlReveal.setScale(2.2);
        bowlReveal.setAlpha(0.25);
        this.chestCinematicObjects.push(bowlReveal);

        const topText = this.add.text(this.scale.width * 0.5, this.scale.height * 0.26, '', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '48px',
            color: '#1a1a1a',
            stroke: '#ffffff',
            strokeThickness: 4
        }).setOrigin(0.5).setScrollFactor(0).setDepth(20002).setAlpha(0);
        this.chestCinematicObjects.push(topText);

        const bottomText = this.add.text(this.scale.width * 0.5, this.scale.height * 0.78, '', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '46px',
            color: '#1a1a1a',
            stroke: '#ffffff',
            strokeThickness: 4
        }).setOrigin(0.5).setScrollFactor(0).setDepth(20002).setAlpha(0);
        this.chestCinematicObjects.push(bottomText);

        this.tweens.add({
            targets: whiteFade,
            alpha: 0.9,
            duration: 550,
            ease: 'Quad.easeOut'
        });
        this.tweens.add({
            targets: bowlReveal,
            alpha: 1,
            scale: 8.8,
            duration: 650,
            ease: 'Back.easeOut'
        });
        this.tweens.add({
            targets: topText,
            alpha: 1,
            duration: 220,
            ease: 'Sine.easeOut'
        });
        this.tweens.add({
            targets: bottomText,
            alpha: 1,
            duration: 220,
            ease: 'Sine.easeOut',
            delay: 120
        });

        const unlockTitle = this.localeManager.t('cinematic.glimmerbowlUnlocked.title', undefined, 'GLIMMERBOWL');
        const unlockSubtitle = this.localeManager.t('cinematic.glimmerbowlUnlocked.subtitle', undefined, 'UNLOCKED');
        this.typewriterText(topText, unlockTitle, 62);
        const bottomTimer = this.time.delayedCall(280, () => {
            this.typewriterText(bottomText, unlockSubtitle, 68);
        });
        this.chestCinematicTimers.push(bottomTimer);

        const holdTimer = this.time.delayedCall(3000, () => {
            this.tweens.add({
                targets: [whiteFade, bowlReveal, topText, bottomText],
                alpha: 0,
                duration: 420,
                ease: 'Sine.easeIn',
                onComplete: () => {
                    this.showBowlReturnToSeaMasterGuide();
                    this.cleanupChestCinematic();
                }
            });
        });
        this.chestCinematicTimers.push(holdTimer);

    }

    private typewriterText(textObject: Phaser.GameObjects.Text, fullText: string, stepMs: number) {
        textObject.setText('');
        let index = 0;
        const timer = this.time.addEvent({
            delay: Math.max(20, Math.floor(stepMs)),
            loop: true,
            callback: () => {
                index += 1;
                textObject.setText(fullText.slice(0, index));
                if (index >= fullText.length) {
                    timer.remove(false);
                }
            }
        });
        this.chestCinematicTimers.push(timer);
    }

    private showBowlReturnToSeaMasterGuide() {
        const uiScene = this.scene.get('UIScene') as UIScene | undefined;
        if (!uiScene) return;

        const seamasterTarget = this.getGuideNpcScreenRect('seamaster') ?? undefined;
        uiScene.showGuideOverlay({
            text: this.localeManager.t('guide.bowlThatShines.returnToSeamaster', undefined, 'Show the Sea Master what you found.'),
            target: seamasterTarget,
            targetPadding: 14,
            dimBackground: true
        });

        const timer = this.time.delayedCall(4200, () => {
            uiScene.clearGuideOverlay();
        });
        this.chestCinematicTimers.push(timer);
    }

    private cleanupChestCinematic(force = false) {
        this.chestCinematicTimers.forEach((timer) => timer.remove(false));
        this.chestCinematicTimers = [];
        this.chestCinematicObjects.forEach((object) => {
            if (!object.active) return;
            object.destroy();
        });
        this.chestCinematicObjects = [];
        this.chestCinematicActive = false;
        if (!force) {
            this.registry.set('inputBlocked', this.chestCinematicInputBlockedBefore);
            this.mcPlayerController?.getMobileControls()?.setInputBlocked(this.chestCinematicInputBlockedBefore);
        }
    }

    update(_time: number, delta: number) {
        if (this.isTransferringServer) return;

        // Update map (tile animations)
        this.mapLoader?.update(delta);

        // Update player movement using active controller
        this.mcPlayerController?.update(delta);

        // Enforce containment zones
        const player = this.getActivePlayer();
        if (player && this.collisionManager) {
            this.collisionManager.enforceContainment(player);
        }
        
        // Update camera zoom based on player feet line segment
        if (player && this.cameraController) {
            const bottomLeft = player.getBottomLeft();
            const bottomRight = player.getBottomRight();
            this.cameraController.update(bottomLeft.x, bottomRight.x, bottomLeft.y);
        }

        // Update dust particles
        this.dustParticles?.update();

        // Update water system (splash, footprints, depth effects)
        this.waterSystem?.update(delta);
        const nearWater = this.waterSystem?.isNearWater(2.5) ?? false;
        if (this.registry.get('nearWater') !== nearWater) {
            this.registry.set('nearWater', nearWater);
        }
        
        // Apply water effects to player
        const activeController = this.mcPlayerController;
        if (activeController && this.waterSystem) {
            activeController.setSpeedMultiplier(this.waterSystem.getSpeedMultiplier());
            // Hide shadow when player is in water
            activeController.setShadowVisible(!this.waterSystem.getIsInWater());
        }

        // Update footstep sounds based on player movement and water state
        if (activeController) {
            const isMoving = activeController.getIsMoving();
            const isSprinting = activeController.getIsSprinting();
            const inWater = this.waterSystem?.getIsInWater() ?? false;
            const isWet = this.waterSystem?.getIsWet() ?? false;
            const waterDepth = this.waterSystem?.getDepth() ?? 0;
            const surface = player ? this.getFootstepSurfaceForPlayer(player) : 'sand';
            this.audioManager?.updateFootsteps(isMoving, isSprinting, inWater, isWet, waterDepth, surface);
        }
        
        // Update fire volume based on player distance to nearest fire
        if (player && this.audioManager) {
            this.audioManager.updateFireVolume(player.x, player.y);
        }

        // Update world time and lighting
        this.worldTimeManager.update(delta);
        const worldTime = this.worldTimeManager.getTime();
        this.lightingManager?.updateFromWorldTime(worldTime);
        this.updateKeyLocationCue(worldTime.hour);
        
        // Update seasonal effects (particles + color tints)
        const playerVel = (player?.body as any)?.velocity || { x: 0, y: 0 };
        this.seasonalEffectsManager?.update(worldTime, delta, playerVel);

        // Update occlusion
        if (player) {
            this.occlusionManager?.update(player);
        }

        // Update fire effects
        if (this.depthManager) {
            this.fires.forEach(fire => {
                fire.updateOcclusion(this.depthManager!);
                fire.updateLight(delta);
            });
        }

        // Update remote players
        this.remotePlayerManager?.update(delta);
        this.aiNpcManager?.update(delta);
        this.softCollisionSystem?.update();

        // Update NPC depth sorting with current occlusion state
        this.npcManager?.update();

        const debugEnabled = this.debugOverlay?.isEnabled() === true;
        this.aiNpcManager?.drawDebugPaths(debugEnabled);

        // Update dropped item fade and nearby pickup cards
        if (player) {
            this.droppedItemManager?.update(player.x, player.y);
        } else {
            this.droppedItemManager?.update();
        }

        this.updateHarvestCooldownUi(Date.now());
        this.updateQuestIndicators(_time);
        this.updateDangerCountdownUi(Date.now());

        // Update tablist registry
        this.updateTablistRegistry();

        // Update debug overlay
        if (debugEnabled) {
            const activeController = this.mcPlayerController;
            const mobileControls = activeController?.getMobileControls();
            const activeMap = this.mapLoader?.getMap();
            const playerBody = player?.body as MatterJS.BodyType | undefined;
            const playerVelX = playerBody?.velocity?.x;
            const playerVelY = playerBody?.velocity?.y;
            const playerSpeed = playerVelX !== undefined && playerVelY !== undefined
                ? Math.hypot(playerVelX, playerVelY)
                : undefined;
            const playerHeadingDeg = playerVelX !== undefined && playerVelY !== undefined && playerSpeed !== undefined && playerSpeed > 0.0001
                ? Phaser.Math.RadToDeg(Math.atan2(playerVelY, playerVelX))
                : undefined;
            // Gather extended debug info
            const extendedDebug: ExtendedDebugInfo = {
                // Camera
                cameraZoom: this.cameraController?.getCurrentZoom(),
                targetZoom: this.cameraController?.getTargetZoom(),
                zoomRegions: this.cameraController?.getZoomRegions(),
                
                // Player
                playerX: player?.x,
                playerY: player?.y,
                playerVelX,
                playerVelY,
                playerSpeed,
                playerHeadingDeg,
                playerDepth: player?.depth,
                isMoving: activeController?.getIsMoving(),
                isSprinting: activeController?.getIsSprinting(),
                stamina: activeController?.getStamina(),
                
                // Fire POIs
                firePositions: this.fires.map(f => f.getPosition()),

                // NPC hitboxes
                npcHitboxes: this.npcManager?.getDebugHitboxes(),
                npcVisualBounds: this.npcManager?.getDebugVisualBounds(),
                aiNpcHitboxes: this.aiNpcManager?.getDebugHitboxes(),

                // Nav / A* grid (matches server default from map tile size)
                navGrid: activeMap
                    ? {
                        cellSize: Math.max(8, Math.floor((activeMap.tileWidth || 32) / 4)),
                        widthPx: activeMap.widthInPixels,
                        heightPx: activeMap.heightInPixels
                    }
                    : undefined,
                
                // Network
                isConnected: this.networkManager.isConnected(),
                remotePlayerCount: this.remotePlayerManager?.getPlayers().size,
                instanceId: this.instanceInfo?.instanceId,
                
                // Performance
                fps: this.game.loop.actualFps,

                // UI
                joystickDebug: mobileControls?.getJoystickDebugInfo(),
                
                // Generated border
                generatedBorder: this.collisionManager?.getGeneratedBorderPolygon(),
            };
            
            this.debugOverlay?.draw(
                this.collisionManager?.getBodies() || [],
                this.occlusionManager?.getRegions() || [],
                activeController?.getSpawnPoint(),
                player,
                worldTime,
                this.waterSystem?.getDebugInfo(),
                extendedDebug
            );
        }
    }

    private updateTablistRegistry() {
        const localName = currentUser?.username || 'Guest';
        const entries = [{ name: localName, isLocal: true }];

        if (this.remotePlayerManager) {
            const remotes = Array.from(this.remotePlayerManager.getPlayers().values());
            remotes.forEach((remote) => {
                entries.push({ name: remote.getUsername(), isLocal: false });
            });
        }

        const snapshot = entries.map(e => `${e.isLocal ? '1' : '0'}:${e.name}`).join('|');
        if (snapshot === this.lastTablistSnapshot) return;

        this.lastTablistSnapshot = snapshot;
        this.registry.set('tablistPlayers', entries);
    }
    
    shutdown() {
        this.dangerRegionPolygon = null;
        this.dangerStayStartedAtMs = null;
        this.setDangerCountdownDisplay(null);
        this.audioManager?.destroy();
        this.remotePlayerManager?.destroy();
        this.aiNpcManager?.destroy();
        this.droppedItemManager?.destroy();
        this.fires.forEach(fire => fire.destroy());
        this.fires = [];
        this.waterSystem?.destroy();
        this.seasonalEffectsManager?.destroy();
        this.mapLoader?.destroy();
        this.mcPlayerController?.destroy();
    }
}
