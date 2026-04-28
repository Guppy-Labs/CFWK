import {
    ADVANCEMENT_QUEST_CATALOG,
    calculateWorldTime,
    DEFAULT_GUIDE_TUTORIAL_STATE,
    DEFAULT_USER_ADVANCEMENTS,
    IAdvancementAlertMessage,
    IAdvancementsState,
    IGuideTutorialState,
    IQuestCatalogEntry,
    IQuestObjectiveEntry,
    IQuestProgressEntry
} from '@cfwk/shared';
import User from '../models/User';
import { AI_METERS_TO_PIXELS } from '../ai/registry';
import { isPointInPolygon } from '../maps/geometry/pointInPolygon';
import { loadTiledMap } from '../maps/tiled/readMap';
import { extractAdvancementRegions } from '../maps/tiled/extract/advancementRegions';
import { extractFirePoints } from '../maps/tiled/extract/firePoints';
import { extractMapDisplayName } from '../maps/tiled/extract/mapDisplayName';
import { extractPoiPointsByName } from '../maps/tiled/extract/poi';

type QuestEvent =
    | { kind: 'npc'; npcId: string }
    | { kind: 'fish-catch' }
    | { kind: 'harvest-interactive'; componentId: string; mapObjectId?: number }
    | { kind: 'stay-in-region'; regionName: string; durationMs: number; resetOnExit: boolean }
    | { kind: 'time-window'; hour: number; startHour: number; endHourExclusive: number }
    | { kind: 'fish-near-location'; locationName: string }
    | { kind: 'inventory-count'; itemId: string; count: number }
    | { kind: 'refine-food'; itemId?: string; liquidItemId?: string }
    | { kind: 'bottle-liquid'; liquidItemId?: string; containerItemId?: string; outputItemId?: string }
    | { kind: 'leave-npc-radius'; locationName: string; radiusPx: number };

type QuestDefinition = {
    id: string;
    dependencyQuestIds: string[];
    isolated: boolean;
    completeOnStartEvent: boolean;
    start: QuestEvent | null;
    objectives: QuestEvent[];
};

type RegionDefinition = {
    name: string;
    polygon: Array<{ x: number; y: number }>;
    area: number;
};

type AdvancementsUpdate = {
    alerts: IAdvancementAlertMessage[];
    delayedNewQuestCounts: number[];
};

function toQuestEvent(objective: IQuestObjectiveEntry | undefined | null): QuestEvent | null {
    if (!objective) return null;
    if (objective.kind === 'fish-catch') {
        return { kind: 'fish-catch' };
    }
    if (objective.kind === 'talk-to-npc') {
        if (!objective.npcId) return null;
        return { kind: 'npc', npcId: objective.npcId };
    }
    if (objective.kind === 'harvest-interactive') {
        if (!objective.componentId) return null;
        return {
            kind: 'harvest-interactive',
            componentId: objective.componentId,
            mapObjectId: typeof objective.mapObjectId === 'number' ? objective.mapObjectId : undefined
        };
    }
    if (objective.kind === 'stay-in-region') {
        const regionName = typeof objective.regionName === 'string' ? objective.regionName.trim() : '';
        if (!regionName) return null;
        const durationMs = Number.isFinite(objective.durationMs) ? Math.max(1000, Math.floor(objective.durationMs!)) : 60_000;
        return {
            kind: 'stay-in-region',
            regionName,
            durationMs,
            resetOnExit: objective.resetOnExit !== false
        };
    }
    if (objective.kind === 'wait-for-time-window') {
        const startHourRaw = Number.isFinite(objective.startHour) ? Number(objective.startHour) : 23;
        const endHourRaw = Number.isFinite(objective.endHourExclusive) ? Number(objective.endHourExclusive) : 4;
        const startHour = Math.max(0, Math.min(23, Math.floor(startHourRaw)));
        const endHourExclusive = Math.max(0, Math.min(23, Math.floor(endHourRaw)));
        return {
            kind: 'time-window',
            hour: startHour,
            startHour,
            endHourExclusive
        };
    }
    if (objective.kind === 'fish-near-location') {
        const locationName = typeof objective.locationName === 'string' ? objective.locationName.trim() : '';
        if (!locationName) return null;
        return {
            kind: 'fish-near-location',
            locationName
        };
    }
    if (objective.kind === 'inventory-count') {
        const itemId = typeof objective.itemId === 'string' ? objective.itemId.trim() : '';
        if (!itemId) return null;
        const count = Number.isFinite(objective.requiredCount)
            ? Math.max(1, Math.floor(objective.requiredCount as number))
            : 1;
        return {
            kind: 'inventory-count',
            itemId,
            count
        };
    }
    if (objective.kind === 'refine-food') {
        return {
            kind: 'refine-food',
            itemId: typeof objective.itemId === 'string' ? objective.itemId : undefined,
            liquidItemId: typeof objective.liquidItemId === 'string' ? objective.liquidItemId : undefined
        };
    }
    if (objective.kind === 'bottle-liquid') {
        return {
            kind: 'bottle-liquid',
            liquidItemId: typeof objective.liquidItemId === 'string' ? objective.liquidItemId : undefined,
            containerItemId: typeof objective.containerItemId === 'string' ? objective.containerItemId : undefined,
            outputItemId: typeof objective.outputItemId === 'string' ? objective.outputItemId : undefined
        };
    }
    if (objective.kind === 'leave-npc-radius') {
        const locationName = typeof objective.locationName === 'string' ? objective.locationName.trim() : '';
        if (!locationName) return null;
        const radiusMeters = Number.isFinite(objective.radiusMeters) ? Math.max(1, objective.radiusMeters!) : 10;
        return {
            kind: 'leave-npc-radius',
            locationName,
            radiusPx: radiusMeters * AI_METERS_TO_PIXELS
        };
    }
    return null;
}

function isHourInWindow(hour: number, startHour: number, endHourExclusive: number): boolean {
    const normalizedHour = Math.max(0, Math.min(23, Math.floor(hour)));
    const normalizedStart = Math.max(0, Math.min(23, Math.floor(startHour)));
    const normalizedEnd = Math.max(0, Math.min(23, Math.floor(endHourExclusive)));
    if (normalizedStart === normalizedEnd) return true;
    if (normalizedStart < normalizedEnd) {
        return normalizedHour >= normalizedStart && normalizedHour < normalizedEnd;
    }
    return normalizedHour >= normalizedStart || normalizedHour < normalizedEnd;
}

function toQuestDefinition(entry: IQuestCatalogEntry): QuestDefinition | null {
    const dependencyQuestIds = Array.from(new Set((entry.dependencyQuestIds ?? [])
        .filter((questId): questId is string => typeof questId === 'string' && questId.trim().length > 0)
        .map((questId) => questId.trim())));

    if (dependencyQuestIds.length === 0 && entry.dependencyQuestId) {
        dependencyQuestIds.push(entry.dependencyQuestId);
    }

    const stagedObjectives = (entry.objectives ?? [])
        .map((objective) => toQuestEvent(objective))
        .filter((objective): objective is QuestEvent => objective !== null);

    const startObjective = toQuestEvent(entry.startObjective);
    const objectiveFallback = toQuestEvent(entry.objective);
    const startEvent = startObjective ?? objectiveFallback;

    const objectives = stagedObjectives.length > 0
        ? stagedObjectives
        : (startEvent ? [startEvent] : []);

    if (!startEvent && objectives.length === 0) return null;

    return {
        id: entry.id,
        dependencyQuestIds,
        isolated: false,
        completeOnStartEvent: entry.completeOnStartEvent === true,
        start: startEvent,
        objectives
    };
}

const QUEST_DEFINITIONS: QuestDefinition[] = ADVANCEMENT_QUEST_CATALOG
    .map((entry) => toQuestDefinition(entry))
    .filter((entry): entry is QuestDefinition => entry !== null);

const QUEST_DEFINITION_BY_ID = new Map(QUEST_DEFINITIONS.map((quest) => [quest.id, quest]));
const CAMPFIRE_STORIES_ID = 'campfire_stories';
const LEGACY_HEED_THE_WARNING_ID = 'travellers_errand';
const HEED_THE_WARNING_ID = 'heed_the_warning';

function createDefaultAdvancementsState(): IAdvancementsState {
    return {
        enrolled: DEFAULT_USER_ADVANCEMENTS.enrolled,
        questProgress: {},
        completedAchievements: [],
        discoveredRegions: {},
        tutorial: { ...DEFAULT_GUIDE_TUTORIAL_STATE }
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function matchesQuestEvent(expected: QuestEvent, received: QuestEvent): boolean {
    if (expected.kind !== received.kind) return false;
    if (expected.kind === 'npc' && received.kind === 'npc') {
        return expected.npcId === received.npcId;
    }
    if (expected.kind === 'harvest-interactive' && received.kind === 'harvest-interactive') {
        if (expected.componentId !== received.componentId) return false;
        if (typeof expected.mapObjectId !== 'number') return true;
        return expected.mapObjectId === received.mapObjectId;
    }
    if (expected.kind === 'stay-in-region' && received.kind === 'stay-in-region') {
        return expected.regionName === received.regionName;
    }
    if (expected.kind === 'time-window' && received.kind === 'time-window') {
        return isHourInWindow(received.hour, expected.startHour, expected.endHourExclusive);
    }
    if (expected.kind === 'fish-near-location' && received.kind === 'fish-near-location') {
        return expected.locationName === received.locationName;
    }
    if (expected.kind === 'inventory-count' && received.kind === 'inventory-count') {
        return expected.itemId === received.itemId && received.count >= expected.count;
    }
    if (expected.kind === 'refine-food' && received.kind === 'refine-food') {
        if (expected.itemId && received.itemId && expected.itemId !== received.itemId) return false;
        if (expected.liquidItemId && received.liquidItemId && expected.liquidItemId !== received.liquidItemId) return false;
        return true;
    }
    if (expected.kind === 'bottle-liquid' && received.kind === 'bottle-liquid') {
        if (expected.liquidItemId && received.liquidItemId && expected.liquidItemId !== received.liquidItemId) return false;
        if (expected.containerItemId && received.containerItemId && expected.containerItemId !== received.containerItemId) return false;
        if (expected.outputItemId && received.outputItemId && expected.outputItemId !== received.outputItemId) return false;
        return true;
    }
    if (expected.kind === 'leave-npc-radius' && received.kind === 'leave-npc-radius') {
        return expected.locationName === received.locationName && received.radiusPx >= expected.radiusPx;
    }
    return expected.kind === 'fish-catch' && received.kind === 'fish-catch';
}

export class AdvancementsManager {
    private readonly mapFileName: string;
    private readonly mapDisplayName: string;
    private readonly firePoints: Array<{ x: number; y: number }>;
    private readonly poiPointsByName: Map<string, Array<{ x: number; y: number }>>;
    private readonly regions: RegionDefinition[];
    private readonly fireAchievementRadiusPx = 6 * AI_METERS_TO_PIXELS;
    private readonly stateByUserId = new Map<string, IAdvancementsState>();
    private readonly currentRegionByUserId = new Map<string, string | null>();
    private readonly timedRegionStartByUserId = new Map<string, Map<string, number>>();

    constructor(mapFileName: string) {
        this.mapFileName = mapFileName;
        const mapData = this.loadMapData(mapFileName);
        this.mapDisplayName = mapData.mapName;
        this.firePoints = mapData.firePoints;
        this.poiPointsByName = mapData.poiPointsByName;
        this.regions = mapData.regions;
    }

    async initializeUser(userId: string): Promise<void> {
        if (!this.isPersistentUserId(userId)) return;
        await this.getOrLoadState(userId);
    }

    getPoiPointsByName(name: string): Array<{ x: number; y: number }> {
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        if (!normalizedName) return [];
        const points = this.poiPointsByName.get(normalizedName);
        if (!points) return [];
        return points.map((point) => ({ x: point.x, y: point.y }));
    }

    async getActiveFishNearLocationObjective(
        userId: string,
        locationName: string
    ): Promise<{ radiusMeters: number } | null> {
        if (!this.isPersistentUserId(userId)) return null;
        const normalizedLocationName = typeof locationName === 'string' ? locationName.trim() : '';
        if (!normalizedLocationName) return null;

        const state = await this.getOrLoadState(userId);
        if (!state) return null;

        for (const [questId, progress] of Object.entries(state.questProgress)) {
            if (progress.status !== 'active') continue;
            const entry = ADVANCEMENT_QUEST_CATALOG.find((quest) => quest.id === questId);
            if (!entry) continue;
            const stagedObjectives = entry.objectives ?? (entry.objective ? [entry.objective] : []);
            if (stagedObjectives.length === 0) continue;
            const objectiveIndex = Math.max(
                0,
                Math.min(
                    stagedObjectives.length - 1,
                    typeof progress.objectiveIndex === 'number' ? Math.floor(progress.objectiveIndex) : 0
                )
            );
            const objective = stagedObjectives[objectiveIndex];
            if (!objective || objective.kind !== 'fish-near-location') continue;
            if ((objective.locationName ?? '').trim() !== normalizedLocationName) continue;

            const radiusMeters = Number.isFinite(objective.radiusMeters)
                ? Math.max(1, Number(objective.radiusMeters))
                : 6;
            return { radiusMeters };
        }

        return null;
    }

    async getActiveHarvestObjective(
        userId: string,
        componentId: string
    ): Promise<{ mapObjectId?: number } | null> {
        if (!this.isPersistentUserId(userId)) return null;
        const normalizedComponentId = typeof componentId === 'string' ? componentId.trim().toLowerCase() : '';
        if (!normalizedComponentId) return null;

        const state = await this.getOrLoadState(userId);
        if (!state) return null;

        for (const [questId, progress] of Object.entries(state.questProgress)) {
            if (progress.status !== 'active') continue;
            const entry = ADVANCEMENT_QUEST_CATALOG.find((quest) => quest.id === questId);
            if (!entry) continue;
            const stagedObjectives = entry.objectives ?? (entry.objective ? [entry.objective] : []);
            if (stagedObjectives.length === 0) continue;
            const objectiveIndex = Math.max(
                0,
                Math.min(
                    stagedObjectives.length - 1,
                    typeof progress.objectiveIndex === 'number' ? Math.floor(progress.objectiveIndex) : 0
                )
            );
            const objective = stagedObjectives[objectiveIndex];
            if (!objective || objective.kind !== 'harvest-interactive') continue;
            if ((objective.componentId ?? '').trim().toLowerCase() !== normalizedComponentId) continue;
            return {
                mapObjectId: typeof objective.mapObjectId === 'number' ? Math.floor(objective.mapObjectId) : undefined
            };
        }

        return null;
    }

    async getStateForUser(userId: string): Promise<IAdvancementsState> {
        if (!this.isPersistentUserId(userId)) {
            return createDefaultAdvancementsState();
        }

        const state = await this.getOrLoadState(userId);
        if (!state) {
            return createDefaultAdvancementsState();
        }

        return {
            enrolled: state.enrolled,
            questProgress: { ...state.questProgress },
            completedAchievements: [...state.completedAchievements],
            discoveredRegions: Object.fromEntries(
                Object.entries(state.discoveredRegions).map(([mapFile, regions]) => [mapFile, [...regions]])
            ),
            tutorial: { ...state.tutorial }
        };
    }

    async updateTutorialState(userId: string, tutorialPatch: Partial<IGuideTutorialState>): Promise<IAdvancementsState | null> {
        if (!this.isPersistentUserId(userId)) {
            return null;
        }

        const state = await this.getOrLoadState(userId);
        if (!state) {
            return null;
        }

        state.tutorial = {
            ...state.tutorial,
            ...tutorialPatch,
            updatedAt: Date.now()
        };

        await this.persistState(userId, state);
        return {
            enrolled: state.enrolled,
            questProgress: { ...state.questProgress },
            completedAchievements: [...state.completedAchievements],
            discoveredRegions: Object.fromEntries(
                Object.entries(state.discoveredRegions).map(([mapFile, regions]) => [mapFile, [...regions]])
            ),
            tutorial: { ...state.tutorial }
        };
    }

    clearCachedUser(userId: string): void {
        this.stateByUserId.delete(userId);
        this.currentRegionByUserId.delete(userId);
        this.timedRegionStartByUserId.delete(userId);
    }

    async onNpcInteract(userId: string, npcId: string): Promise<AdvancementsUpdate> {
        if (!this.isPersistentUserId(userId)) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const state = await this.getOrLoadState(userId);
        if (!state) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const updates = this.applyQuestEvent(state, { kind: 'npc', npcId });
        if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
            await this.persistState(userId, state);
        }
        return updates;
    }

    async onFishCatch(userId: string): Promise<AdvancementsUpdate> {
        if (!this.isPersistentUserId(userId)) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const state = await this.getOrLoadState(userId);
        if (!state) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const updates = this.applyQuestEvent(state, { kind: 'fish-catch' });
        if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
            await this.persistState(userId, state);
        }
        return updates;
    }

    async onFishCatchNearLocation(userId: string, locationName: string): Promise<AdvancementsUpdate> {
        if (!this.isPersistentUserId(userId)) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }
        const normalizedLocationName = typeof locationName === 'string' ? locationName.trim() : '';
        if (!normalizedLocationName) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const state = await this.getOrLoadState(userId);
        if (!state) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const updates = this.applyQuestEvent(state, { kind: 'fish-near-location', locationName: normalizedLocationName });
        if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
            await this.persistState(userId, state);
        }
        return updates;
    }

    async onHarvestInteractive(userId: string, componentId: string, mapObjectId?: number): Promise<AdvancementsUpdate> {
        if (!this.isPersistentUserId(userId)) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const normalizedComponentId = componentId.trim().toLowerCase();
        if (!normalizedComponentId) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const state = await this.getOrLoadState(userId);
        if (!state) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const updates = this.applyQuestEvent(state, {
            kind: 'harvest-interactive',
            componentId: normalizedComponentId,
            mapObjectId: typeof mapObjectId === 'number' ? Math.floor(mapObjectId) : undefined
        });
        if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
            await this.persistState(userId, state);
        }
        return updates;
    }

    async onInventoryCount(userId: string, itemId: string, count: number): Promise<AdvancementsUpdate> {
        if (!this.isPersistentUserId(userId)) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }
        const normalizedItemId = typeof itemId === 'string' ? itemId.trim() : '';
        if (!normalizedItemId) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }
        const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

        const state = await this.getOrLoadState(userId);
        if (!state) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const updates = this.applyQuestEvent(state, {
            kind: 'inventory-count',
            itemId: normalizedItemId,
            count: normalizedCount
        });
        if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
            await this.persistState(userId, state);
        }
        return updates;
    }

    async onChatMessage(userId: string, x: number, y: number, message: string): Promise<IAdvancementAlertMessage[]> {
        if (!this.isPersistentUserId(userId)) return [];
        const trimmedMessage = message.trim();
        if (!trimmedMessage) return [];

        const state = await this.getOrLoadState(userId);
        if (!state) return [];

        if (state.completedAchievements.includes(CAMPFIRE_STORIES_ID)) return [];

        const nearFire = this.firePoints.some((firePoint) => {
            const dx = firePoint.x - x;
            const dy = firePoint.y - y;
            return Math.hypot(dx, dy) <= this.fireAchievementRadiusPx;
        });

        if (!nearFire) return [];

        state.completedAchievements.push(CAMPFIRE_STORIES_ID);
        state.completedAchievements = Array.from(new Set(state.completedAchievements));
        await this.persistState(userId, state);

        return [{ type: 'achievement-unlocked', achievementId: CAMPFIRE_STORIES_ID }];
    }

    async onFoodRefined(userId: string, itemId: string, liquidItemId: string): Promise<AdvancementsUpdate> {
        if (!this.isPersistentUserId(userId)) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const state = await this.getOrLoadState(userId);
        if (!state) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const updates = this.applyQuestEvent(state, {
            kind: 'refine-food',
            itemId: typeof itemId === 'string' ? itemId : undefined,
            liquidItemId: typeof liquidItemId === 'string' ? liquidItemId : undefined
        });
        if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
            await this.persistState(userId, state);
        }
        return updates;
    }

    async onLiquidBottled(userId: string, liquidItemId: string, containerItemId: string, outputItemId: string): Promise<AdvancementsUpdate> {
        if (!this.isPersistentUserId(userId)) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const state = await this.getOrLoadState(userId);
        if (!state) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }

        const updates = this.applyQuestEvent(state, {
            kind: 'bottle-liquid',
            liquidItemId: typeof liquidItemId === 'string' ? liquidItemId : undefined,
            containerItemId: typeof containerItemId === 'string' ? containerItemId : undefined,
            outputItemId: typeof outputItemId === 'string' ? outputItemId : undefined
        });
        if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
            await this.persistState(userId, state);
        }
        return updates;
    }

    async onPlayerMoved(
        userId: string,
        x: number,
        y: number,
        clientTimeOffsetMs: number = 0
    ): Promise<IAdvancementAlertMessage[]> {
        if (!this.isPersistentUserId(userId)) return [];

        const now = Date.now();
        const regionName = this.findRegionAtPosition(x, y);
        const previousRegion = this.currentRegionByUserId.get(userId) ?? null;
        const changedRegion = regionName !== previousRegion;

        if (changedRegion) {
            this.currentRegionByUserId.set(userId, regionName);
        }

        const state = await this.getOrLoadState(userId);
        if (!state) return [];

        const timedUpdates = this.applyTimedRegionObjectives(state, userId, regionName, now);
        const alerts: IAdvancementAlertMessage[] = [...timedUpdates.alerts];
        let shouldPersist = timedUpdates.alerts.length > 0 || timedUpdates.delayedNewQuestCounts.length > 0;

        const currentHour = this.getCurrentWorldHour(clientTimeOffsetMs);
        const timeWindowUpdates = this.applyQuestEvent(state, {
            kind: 'time-window',
            hour: currentHour,
            startHour: currentHour,
            endHourExclusive: currentHour
        });
        if (timeWindowUpdates.alerts.length > 0 || timeWindowUpdates.delayedNewQuestCounts.length > 0) {
            alerts.push(...timeWindowUpdates.alerts);
            shouldPersist = true;
        }

        const leaveRadiusAlerts = this.checkLeaveNpcRadiusObjectives(state, x, y);
        if (leaveRadiusAlerts.alerts.length > 0 || leaveRadiusAlerts.delayedNewQuestCounts.length > 0) {
            alerts.push(...leaveRadiusAlerts.alerts);
            shouldPersist = true;
        }

        if (!changedRegion || !regionName) {
            if (shouldPersist) {
                await this.persistState(userId, state);
            }
            return alerts;
        }

        const discoveredForMap = state.discoveredRegions[this.mapFileName] ?? [];
        if (discoveredForMap.includes(regionName)) {
            if (shouldPersist) {
                await this.persistState(userId, state);
            }
            return alerts;
        }

        state.discoveredRegions[this.mapFileName] = [...discoveredForMap, regionName];
        shouldPersist = true;

        if (shouldPersist) {
            await this.persistState(userId, state);
        }

        alerts.push({
            type: 'area-discovered',
            mapName: this.mapDisplayName,
            regionName
        });

        return alerts;
    }

    private applyTimedRegionObjectives(
        state: IAdvancementsState,
        userId: string,
        regionName: string | null,
        now: number
    ): AdvancementsUpdate {
        let runtime = this.timedRegionStartByUserId.get(userId);
        if (!runtime) {
            runtime = new Map<string, number>();
            this.timedRegionStartByUserId.set(userId, runtime);
        }

        const dueEvents: QuestEvent[] = [];
        const activeQuestIds = Object.keys(state.questProgress);
        const activeQuestIdSet = new Set(activeQuestIds);
        Array.from(runtime.keys()).forEach((questId) => {
            if (!activeQuestIdSet.has(questId)) {
                runtime.delete(questId);
            }
        });

        for (const [questId, progress] of Object.entries(state.questProgress)) {
            if (progress.status !== 'active') {
                runtime.delete(questId);
                continue;
            }

            const definition = QUEST_DEFINITION_BY_ID.get(questId);
            if (!definition) {
                runtime.delete(questId);
                continue;
            }

            const objectives = definition.objectives.length > 0 ? definition.objectives : [definition.start];
            const currentIndexRaw = typeof progress.objectiveIndex === 'number' ? Math.floor(progress.objectiveIndex) : 0;
            const currentIndex = Math.max(0, Math.min(currentIndexRaw, objectives.length - 1));
            const objective = objectives[currentIndex];

            if (!objective || objective.kind !== 'stay-in-region') {
                runtime.delete(questId);
                continue;
            }

            if (regionName !== objective.regionName) {
                if (objective.resetOnExit !== false) {
                    runtime.delete(questId);
                }
                continue;
            }

            const startedAt = runtime.get(questId) ?? now;
            runtime.set(questId, startedAt);
            if ((now - startedAt) >= objective.durationMs) {
                dueEvents.push({
                    kind: 'stay-in-region',
                    regionName: objective.regionName,
                    durationMs: objective.durationMs,
                    resetOnExit: objective.resetOnExit
                });
                runtime.delete(questId);
            }
        }

        const merged: AdvancementsUpdate = { alerts: [], delayedNewQuestCounts: [] };
        for (const event of dueEvents) {
            const update = this.applyQuestEvent(state, event);
            merged.alerts.push(...update.alerts);
            merged.delayedNewQuestCounts.push(...update.delayedNewQuestCounts);
        }

        return merged;
    }

    private checkLeaveNpcRadiusObjectives(
        state: IAdvancementsState,
        playerX: number,
        playerY: number
    ): AdvancementsUpdate {
        const events: QuestEvent[] = [];

        for (const [questId, progress] of Object.entries(state.questProgress)) {
            if (progress.status !== 'active') continue;
            const definition = QUEST_DEFINITION_BY_ID.get(questId);
            if (!definition) continue;

            const objectives = definition.objectives.length > 0 ? definition.objectives : [definition.start];
            const currentIndexRaw = typeof progress.objectiveIndex === 'number' ? Math.floor(progress.objectiveIndex) : 0;
            const currentIndex = Math.max(0, Math.min(currentIndexRaw, objectives.length - 1));
            const objective = objectives[currentIndex];

            if (!objective || objective.kind !== 'leave-npc-radius') continue;

            const poiPoints = this.poiPointsByName.get(objective.locationName);
            if (!poiPoints || poiPoints.length === 0) continue;

            const poi = poiPoints[0];
            const dx = playerX - poi.x;
            const dy = playerY - poi.y;
            const distPx = Math.sqrt(dx * dx + dy * dy);

            if (distPx >= objective.radiusPx) {
                events.push({
                    kind: 'leave-npc-radius',
                    locationName: objective.locationName,
                    radiusPx: distPx
                });
            }
        }

        const merged: AdvancementsUpdate = { alerts: [], delayedNewQuestCounts: [] };
        for (const event of events) {
            const update = this.applyQuestEvent(state, event);
            merged.alerts.push(...update.alerts);
            merged.delayedNewQuestCounts.push(...update.delayedNewQuestCounts);
        }
        return merged;
    }

    private applyQuestEvent(state: IAdvancementsState, event: QuestEvent): AdvancementsUpdate {
        const alerts: IAdvancementAlertMessage[] = [];
        const delayedNewQuestCounts: number[] = [];
        const now = Date.now();

        for (const [questId, progress] of Object.entries(state.questProgress)) {
            if (progress.status !== 'active') continue;
            const definition = QUEST_DEFINITION_BY_ID.get(questId);
            if (!definition) continue;
            const objectives = definition.objectives.length > 0 ? definition.objectives : [definition.start];
            const currentIndexRaw = typeof progress.objectiveIndex === 'number' ? Math.floor(progress.objectiveIndex) : 0;
            const currentIndex = Math.max(0, Math.min(currentIndexRaw, objectives.length - 1));
            const expectedObjective = objectives[currentIndex];
            if (this.shouldIgnoreQuestObjectiveEvent(questId, expectedObjective, event)) continue;
            if (!expectedObjective || !matchesQuestEvent(expectedObjective, event)) continue;

            if (currentIndex < objectives.length - 1) {
                progress.objectiveIndex = currentIndex + 1;
                alerts.push({ type: 'quest-objective', questId, objectiveIndex: progress.objectiveIndex });
                continue;
            }

            progress.status = 'completed';
            progress.completedAt = now;
            progress.objectiveIndex = currentIndex;
            alerts.push({ type: 'quest-completed', questId });

            const newlyAvailableCount = this.countNewlyAvailableQuests(state, questId);
            if (newlyAvailableCount > 0) {
                delayedNewQuestCounts.push(newlyAvailableCount);
            }
        }

        let startedQuestForNpcEvent = false;
        for (let questIndex = 0; questIndex < QUEST_DEFINITIONS.length; questIndex += 1) {
            const quest = QUEST_DEFINITIONS[questIndex];
            if (event.kind === 'npc' && startedQuestForNpcEvent) {
                break;
            }
            if (state.questProgress[quest.id]) continue;

            if (!this.areQuestDependenciesMet(state, quest.dependencyQuestIds)) {
                continue;
            }

            if (!quest.start || !matchesQuestEvent(quest.start, event)) {
                continue;
            }

            if (
                event.kind === 'npc'
                && quest.start.kind === 'npc'
                && this.hasEarlierUncompletedNpcStartQuest(state, questIndex, event.npcId)
            ) {
                continue;
            }

            if (this.isQuestStartBlocked(state, quest.id, quest.isolated)) {
                continue;
            }

            const nextEntry: IQuestProgressEntry = {
                questId: quest.id,
                status: 'active',
                startedAt: now,
                completedAt: null,
                objectiveIndex: 0
            };
            state.questProgress[quest.id] = nextEntry;
            alerts.push({ type: 'quest-started', questId: quest.id });
            const firstObjective = quest.objectives[0];
            const firstObjectiveMatchesStartEvent = Boolean(
                firstObjective && matchesQuestEvent(firstObjective, event)
            );
            if (
                quest.completeOnStartEvent
                && quest.objectives.length === 1
                && firstObjectiveMatchesStartEvent
            ) {
                nextEntry.status = 'completed';
                nextEntry.completedAt = now;
                nextEntry.objectiveIndex = 0;
                alerts.push({ type: 'quest-completed', questId: quest.id });

                const newlyAvailableCount = this.countNewlyAvailableQuests(state, quest.id);
                if (newlyAvailableCount > 0) {
                    delayedNewQuestCounts.push(newlyAvailableCount);
                }
            } else if (quest.objectives.length > 0) {
                // If the start event is also the first objective, consume it immediately
                // so the player is moved to the next actionable objective step.
                if (firstObjectiveMatchesStartEvent && quest.objectives.length > 1) {
                    nextEntry.objectiveIndex = 1;
                    alerts.push({ type: 'quest-objective', questId: quest.id, objectiveIndex: 1 });
                } else {
                    alerts.push({ type: 'quest-objective', questId: quest.id, objectiveIndex: 0 });
                }
            }

            if (event.kind === 'npc') {
                startedQuestForNpcEvent = true;
            }
        }

        return { alerts, delayedNewQuestCounts };
    }

    private shouldIgnoreQuestObjectiveEvent(_questId: string, _expectedObjective: QuestEvent | null | undefined, _event: QuestEvent): boolean {
        return false;
    }

    private countNewlyAvailableQuests(state: IAdvancementsState, completedQuestId: string): number {
        let count = 0;
        for (const quest of QUEST_DEFINITIONS) {
            if (!quest.dependencyQuestIds.includes(completedQuestId)) continue;
            if (state.questProgress[quest.id]) continue;
            if (!this.areQuestDependenciesMet(state, quest.dependencyQuestIds)) continue;
            count += 1;
        }
        return count;
    }

    private areQuestDependenciesMet(state: IAdvancementsState, dependencyQuestIds: string[]): boolean {
        if (dependencyQuestIds.length === 0) return true;
        return dependencyQuestIds.every((questId) => this.isQuestCompleted(state, questId));
    }

    private isQuestStartBlocked(state: IAdvancementsState, questId: string, newQuestIsIsolated: boolean): boolean {
        const activeQuestIds = Object.values(state.questProgress)
            .filter((quest) => quest.status === 'active')
            .map((quest) => quest.questId);

        if (activeQuestIds.includes(questId)) return true;
        if (activeQuestIds.length === 0) return false;

        if (newQuestIsIsolated) return true;

        for (const activeQuestId of activeQuestIds) {
            const activeDefinition = QUEST_DEFINITION_BY_ID.get(activeQuestId);
            if (activeDefinition?.isolated) {
                return true;
            }
        }

        return false;
    }

    private isQuestCompleted(state: IAdvancementsState, questId: string): boolean {
        return state.questProgress[questId]?.status === 'completed';
    }

    private hasEarlierUncompletedNpcStartQuest(
        state: IAdvancementsState,
        currentQuestIndex: number,
        npcId: string
    ): boolean {
        for (let index = 0; index < currentQuestIndex; index += 1) {
            const quest = QUEST_DEFINITIONS[index];
            if (!quest.start || quest.start.kind !== 'npc' || quest.start.npcId !== npcId) {
                continue;
            }

            const progress = state.questProgress[quest.id];
            if (progress?.status === 'completed') {
                continue;
            }
            if (progress?.status === 'active') {
                return true;
            }

            if (!this.areQuestDependenciesMet(state, quest.dependencyQuestIds)) {
                continue;
            }
            if (this.isQuestStartBlocked(state, quest.id, quest.isolated)) {
                continue;
            }

            return true;
        }

        return false;
    }

    private getCurrentWorldHour(offsetMs: number = 0): number {
        const normalizedOffset = Number.isFinite(offsetMs) ? Math.max(0, Math.floor(offsetMs)) : 0;
        const worldTime = calculateWorldTime(Date.now() + normalizedOffset);
        return Math.max(0, Math.min(23, Math.floor(worldTime.hour)));
    }

    /**
     * Applies a synthetic time-window event for the user using the supplied
     * client time offset so the Skip to Night feature can advance the
     * wait-for-time-window objective immediately without requiring the
     * player to move.
     */
    async applyTimeWindowForUser(userId: string, clientTimeOffsetMs: number): Promise<AdvancementsUpdate> {
        if (!this.isPersistentUserId(userId)) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }
        const state = await this.getOrLoadState(userId);
        if (!state) {
            return { alerts: [], delayedNewQuestCounts: [] };
        }
        const hour = this.getCurrentWorldHour(clientTimeOffsetMs);
        const updates = this.applyQuestEvent(state, {
            kind: 'time-window',
            hour,
            startHour: hour,
            endHourExclusive: hour
        });
        if (updates.alerts.length > 0 || updates.delayedNewQuestCounts.length > 0) {
            await this.persistState(userId, state);
        }
        return updates;
    }

    private findRegionAtPosition(x: number, y: number): string | null {
        let bestRegion: RegionDefinition | null = null;
        for (const region of this.regions) {
            if (!isPointInPolygon(x, y, region.polygon)) {
                continue;
            }

            if (!bestRegion || region.area < bestRegion.area) {
                bestRegion = region;
            }
        }

        if (bestRegion) {
            return bestRegion.name;
        }

        return null;
    }

    private async getOrLoadState(userId: string): Promise<IAdvancementsState | null> {
        const cached = this.stateByUserId.get(userId);
        if (cached) return cached;

        const user = await User.findById(userId).select('advancements').exec();
        if (!user) return null;

        const normalized = this.normalizeAdvancementsState(user.advancements);
        this.stateByUserId.set(userId, normalized.state);

        if (normalized.changed) {
            user.set('advancements', normalized.state);
            await user.save();
        }

        return normalized.state;
    }

    private normalizeAdvancementsState(value: unknown): { state: IAdvancementsState; changed: boolean } {
        let changed = false;
        const raw = isObject(value) ? value : {};

        const questProgress: Record<string, IQuestProgressEntry> = {};
        const rawQuestProgress = isObject(raw.questProgress) ? raw.questProgress : {};

        for (const [questId, questValue] of Object.entries(rawQuestProgress)) {
            if (!isObject(questValue)) {
                changed = true;
                continue;
            }

            const status = questValue.status === 'completed' ? 'completed' : questValue.status === 'active' ? 'active' : null;
            if (!status) {
                changed = true;
                continue;
            }

            questProgress[questId] = {
                questId,
                status,
                startedAt: typeof questValue.startedAt === 'number' ? questValue.startedAt : null,
                completedAt: typeof questValue.completedAt === 'number' ? questValue.completedAt : null,
                objectiveIndex: typeof questValue.objectiveIndex === 'number'
                    ? Math.max(0, Math.floor(questValue.objectiveIndex))
                    : 0
            };
        }

        if (questProgress[LEGACY_HEED_THE_WARNING_ID] && !questProgress[HEED_THE_WARNING_ID]) {
            const legacy = questProgress[LEGACY_HEED_THE_WARNING_ID];
            questProgress[HEED_THE_WARNING_ID] = {
                ...legacy,
                questId: HEED_THE_WARNING_ID
            };
            delete questProgress[LEGACY_HEED_THE_WARNING_ID];
            changed = true;
        } else if (questProgress[LEGACY_HEED_THE_WARNING_ID]) {
            delete questProgress[LEGACY_HEED_THE_WARNING_ID];
            changed = true;
        }

        const completedAchievements = Array.isArray(raw.completedAchievements)
            ? Array.from(new Set(raw.completedAchievements.filter((entry): entry is string => typeof entry === 'string')))
            : [];

        if (!Array.isArray(raw.completedAchievements)) {
            changed = true;
        }

        const discoveredRegions: Record<string, string[]> = {};
        if (isObject(raw.discoveredRegions)) {
            for (const [mapFile, regions] of Object.entries(raw.discoveredRegions)) {
                if (!Array.isArray(regions)) {
                    changed = true;
                    continue;
                }
                discoveredRegions[mapFile] = Array.from(new Set(regions.filter((region): region is string => typeof region === 'string')));
            }
        } else {
            changed = true;
        }

        const state: IAdvancementsState = {
            enrolled: true,
            questProgress,
            completedAchievements,
            discoveredRegions,
            tutorial: this.normalizeTutorialState(raw.tutorial)
        };

        if (!isObject(raw.tutorial)) {
            changed = true;
        }

        if (raw.enrolled !== true) {
            changed = true;
        }

        if (!isObject(value)) {
            changed = true;
        }

        return { state, changed };
    }

    private normalizeTutorialState(value: unknown): IGuideTutorialState {
        const raw = isObject(value) ? value : {};

        const allowedInteractionSteps: IGuideTutorialState['interactionStep'][] = ['idle', 'press_interact', 'completed'];
        const allowedRodSteps: IGuideTutorialState['rodStep'][] = ['idle', 'open_inventory', 'select_rod', 'equip_rod', 'close_inventory', 'completed'];
        const allowedFishingSteps: IGuideTutorialState['fishingStep'][] = ['idle', 'use_rod', 'hold_cast', 'wait_bite', 'reel', 'stop_fishing', 'completed'];
        const allowedFoodSteps: IGuideTutorialState['foodStep'][] = ['idle', 'open_inventory', 'select_berry', 'explain_food_score', 'equip_quickslot_1', 'close_inventory', 'consume_quickslot_1', 'completed'];
        const allowedFinbookSteps: IGuideTutorialState['finbookStep'][] = ['idle', 'open_inventory', 'open_finbook_tab', 'show_completed_quest', 'show_main_quest', 'show_title', 'show_status', 'show_objective', 'show_track_button', 'close_inventory', 'completed'];

        const interactionStep = typeof raw.interactionStep === 'string' && allowedInteractionSteps.includes(raw.interactionStep as IGuideTutorialState['interactionStep'])
            ? (raw.interactionStep as IGuideTutorialState['interactionStep'])
            : DEFAULT_GUIDE_TUTORIAL_STATE.interactionStep;

        const rodStep = typeof raw.rodStep === 'string' && allowedRodSteps.includes(raw.rodStep as IGuideTutorialState['rodStep'])
            ? (raw.rodStep as IGuideTutorialState['rodStep'])
            : DEFAULT_GUIDE_TUTORIAL_STATE.rodStep;
        const fishingStep = typeof raw.fishingStep === 'string' && allowedFishingSteps.includes(raw.fishingStep as IGuideTutorialState['fishingStep'])
            ? (raw.fishingStep as IGuideTutorialState['fishingStep'])
            : DEFAULT_GUIDE_TUTORIAL_STATE.fishingStep;
        const foodStep = typeof raw.foodStep === 'string' && allowedFoodSteps.includes(raw.foodStep as IGuideTutorialState['foodStep'])
            ? (raw.foodStep as IGuideTutorialState['foodStep'])
            : DEFAULT_GUIDE_TUTORIAL_STATE.foodStep;
        const finbookStep = typeof raw.finbookStep === 'string' && allowedFinbookSteps.includes(raw.finbookStep as IGuideTutorialState['finbookStep'])
            ? (raw.finbookStep as IGuideTutorialState['finbookStep'])
            : DEFAULT_GUIDE_TUTORIAL_STATE.finbookStep;

        return {
            interactionStep,
            rodStep,
            fishingStep,
            foodStep,
            finbookStep,
            interactionCompleted: raw.interactionCompleted === true,
            rodCompleted: raw.rodCompleted === true,
            fishingCompleted: raw.fishingCompleted === true,
            foodCompleted: raw.foodCompleted === true,
            finbookCompleted: raw.finbookCompleted === true,
            finbookAnchorEnteredAt: typeof raw.finbookAnchorEnteredAt === 'number' && Number.isFinite(raw.finbookAnchorEnteredAt) && raw.finbookAnchorEnteredAt > 0
                ? Math.floor(raw.finbookAnchorEnteredAt)
                : null,
            forceSalmonCatch: raw.forceSalmonCatch === true,
            forceFoodGuideHeal: raw.forceFoodGuideHeal === true,
            introCutsceneCompleted: raw.introCutsceneCompleted === true,
            introArrivalCompleted: raw.introArrivalCompleted === true,
            updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : null
        };
    }

    private async persistState(userId: string, state: IAdvancementsState): Promise<void> {
        await User.updateOne({ _id: userId }, { $set: { advancements: state } }).exec();
    }

    private isPersistentUserId(userId: string): boolean {
        return /^[a-f\d]{24}$/i.test(userId);
    }

    private loadMapData(mapFileName: string): {
        mapName: string;
        firePoints: Array<{ x: number; y: number }>;
        poiPointsByName: Map<string, Array<{ x: number; y: number }>>;
        regions: RegionDefinition[];
    } {
        const map = loadTiledMap(mapFileName);
        if (!map) {
            return {
                mapName: extractMapDisplayName(null, mapFileName),
                firePoints: [],
                poiPointsByName: new Map<string, Array<{ x: number; y: number }>>(),
                regions: []
            };
        }

        try {
            const mapName = extractMapDisplayName(map, mapFileName);
            const poiPointsByName = extractPoiPointsByName(map);
            const firePoints = extractFirePoints(map);
            const regions = extractAdvancementRegions(map);
            return { mapName, firePoints, poiPointsByName, regions };
        } catch (error) {
            console.error('[AdvancementsManager] Failed to parse map data:', error);
            return {
                mapName: extractMapDisplayName(null, mapFileName),
                firePoints: [],
                poiPointsByName: new Map<string, Array<{ x: number; y: number }>>(),
                regions: []
            };
        }
    }
}
