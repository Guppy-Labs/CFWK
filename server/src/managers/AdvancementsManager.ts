import fs from 'fs';
import path from 'path';
import {
    DEFAULT_USER_ADVANCEMENTS,
    IAdvancementAlertMessage,
    IAdvancementsState,
    IQuestProgressEntry
} from '@cfwk/shared';
import User from '../models/User';
import { AI_METERS_TO_PIXELS } from '../ai/registry';

type QuestEvent =
    | { kind: 'npc'; npcId: string }
    | { kind: 'fish-catch' };

type QuestDefinition = {
    id: string;
    dependencyQuestId: string | null;
    isolated: boolean;
    start: QuestEvent;
    objectives: QuestEvent[];
};

type RegionDefinition = {
    name: string;
    polygon: Array<{ x: number; y: number }>;
};

type AdvancementsUpdate = {
    alerts: IAdvancementAlertMessage[];
    delayedNewQuestCounts: number[];
};

type TiledProperty = { name: string; value: unknown };

type TiledMapObject = {
    name?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    polygon?: Array<{ x: number; y: number }>;
};

type TiledLayer = {
    name?: string;
    type?: string;
    objects?: TiledMapObject[];
};

type TiledMap = {
    properties?: TiledProperty[];
    layers?: TiledLayer[];
};

const QUEST_DEFINITIONS: QuestDefinition[] = [
    {
        id: 'first_catch',
        dependencyQuestId: null,
        isolated: false,
        start: { kind: 'npc', npcId: 'fisherman' },
        objectives: [
            { kind: 'fish-catch' },
            { kind: 'npc', npcId: 'fisherman' }
        ]
    },
    {
        id: 'travellers_errand',
        dependencyQuestId: 'first_catch',
        isolated: false,
        start: { kind: 'npc', npcId: 'traveller' },
        objectives: [{ kind: 'npc', npcId: 'guard' }]
    }
];

const QUEST_DEFINITION_BY_ID = new Map(QUEST_DEFINITIONS.map((quest) => [quest.id, quest]));
const CAMPFIRE_STORIES_ID = 'campfire_stories';

function createDefaultAdvancementsState(): IAdvancementsState {
    return {
        enrolled: DEFAULT_USER_ADVANCEMENTS.enrolled,
        questProgress: {},
        completedAchievements: [],
        discoveredRegions: {}
    };
}

function humanizeMapName(mapFileName: string): string {
    const base = mapFileName.replace(/\.tmj$/i, '').replace(/[-_]+/g, ' ').trim();
    if (!base) return 'Unknown Region';
    return base
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function matchesQuestEvent(expected: QuestEvent, received: QuestEvent): boolean {
    if (expected.kind !== received.kind) return false;
    if (expected.kind === 'npc' && received.kind === 'npc') {
        return expected.npcId === received.npcId;
    }
    return expected.kind === 'fish-catch' && received.kind === 'fish-catch';
}

export class AdvancementsManager {
    private readonly mapFileName: string;
    private readonly mapDisplayName: string;
    private readonly firePoints: Array<{ x: number; y: number }>;
    private readonly regions: RegionDefinition[];
    private readonly fireAchievementRadiusPx = 6 * AI_METERS_TO_PIXELS;
    private readonly stateByUserId = new Map<string, IAdvancementsState>();
    private readonly currentRegionByUserId = new Map<string, string | null>();

    constructor(mapFileName: string) {
        this.mapFileName = mapFileName;
        const mapData = this.loadMapData(mapFileName);
        this.mapDisplayName = mapData.mapName;
        this.firePoints = mapData.firePoints;
        this.regions = mapData.regions;
    }

    async initializeUser(userId: string): Promise<void> {
        if (!this.isPersistentUserId(userId)) return;
        await this.getOrLoadState(userId);
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
            )
        };
    }

    clearCachedUser(userId: string): void {
        this.stateByUserId.delete(userId);
        this.currentRegionByUserId.delete(userId);
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

    async onPlayerMoved(userId: string, x: number, y: number): Promise<IAdvancementAlertMessage[]> {
        if (!this.isPersistentUserId(userId)) return [];
        if (this.regions.length === 0) return [];

        const regionName = this.findRegionAtPosition(x, y);
        const previousRegion = this.currentRegionByUserId.get(userId) ?? null;
        if (regionName === previousRegion) return [];

        this.currentRegionByUserId.set(userId, regionName);

        if (!regionName) return [];

        const state = await this.getOrLoadState(userId);
        if (!state) return [];

        const discoveredForMap = state.discoveredRegions[this.mapFileName] ?? [];
        if (discoveredForMap.includes(regionName)) {
            return [];
        }

        state.discoveredRegions[this.mapFileName] = [...discoveredForMap, regionName];
        await this.persistState(userId, state);

        return [{
            type: 'area-discovered',
            mapName: this.mapDisplayName,
            regionName
        }];
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

        for (const quest of QUEST_DEFINITIONS) {
            if (state.questProgress[quest.id]) continue;

            if (quest.dependencyQuestId && !this.isQuestCompleted(state, quest.dependencyQuestId)) {
                continue;
            }

            if (!matchesQuestEvent(quest.start, event)) {
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
            if (quest.objectives.length > 0) {
                alerts.push({ type: 'quest-objective', questId: quest.id, objectiveIndex: 0 });
            }
        }

        return { alerts, delayedNewQuestCounts };
    }

    private countNewlyAvailableQuests(state: IAdvancementsState, completedQuestId: string): number {
        let count = 0;
        for (const quest of QUEST_DEFINITIONS) {
            if (quest.dependencyQuestId !== completedQuestId) continue;
            if (state.questProgress[quest.id]) continue;
            count += 1;
        }
        return count;
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

    private findRegionAtPosition(x: number, y: number): string | null {
        for (const region of this.regions) {
            if (this.isPointInPolygon(x, y, region.polygon)) {
                return region.name;
            }
        }
        return null;
    }

    private isPointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;

            const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.0000001) + xi);
            if (intersects) {
                inside = !inside;
            }
        }
        return inside;
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
            discoveredRegions
        };

        if (raw.enrolled !== true) {
            changed = true;
        }

        if (!isObject(value)) {
            changed = true;
        }

        return { state, changed };
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
        regions: RegionDefinition[];
    } {
        const fullPath = this.resolveMapPath(mapFileName);
        if (!fullPath) {
            return {
                mapName: humanizeMapName(mapFileName),
                firePoints: [],
                regions: []
            };
        }

        try {
            const raw = fs.readFileSync(fullPath, 'utf8');
            const map = JSON.parse(raw) as TiledMap;
            const mapName = this.extractMapName(map, mapFileName);
            const firePoints = this.extractFirePoints(map);
            const regions = this.extractRegions(map);
            return { mapName, firePoints, regions };
        } catch (error) {
            console.error('[AdvancementsManager] Failed to parse map data:', error);
            return {
                mapName: humanizeMapName(mapFileName),
                firePoints: [],
                regions: []
            };
        }
    }

    private extractMapName(map: TiledMap, mapFileName: string): string {
        const properties = Array.isArray(map.properties) ? map.properties : [];
        const nameProp = properties.find((property) => property.name === 'Name');
        if (nameProp && typeof nameProp.value === 'string' && nameProp.value.trim().length > 0) {
            return nameProp.value.trim();
        }
        return humanizeMapName(mapFileName);
    }

    private extractFirePoints(map: TiledMap): Array<{ x: number; y: number }> {
        const poiLayer = (map.layers || []).find((layer) => layer.name === 'POI' && layer.type === 'objectgroup');
        if (!poiLayer || !Array.isArray(poiLayer.objects)) return [];

        return poiLayer.objects
            .filter((object) => object.name === 'Fire')
            .map((object) => {
                const x = (object.x ?? 0) + ((object.width ?? 0) / 2);
                const y = (object.y ?? 0) + ((object.height ?? 0) / 2);
                return { x, y };
            });
    }

    private extractRegions(map: TiledMap): RegionDefinition[] {
        const regionLayer = (map.layers || []).find((layer) => layer.name === 'Regions' && layer.type === 'objectgroup');
        if (!regionLayer || !Array.isArray(regionLayer.objects)) return [];

        const results: RegionDefinition[] = [];
        for (const object of regionLayer.objects) {
            if (!object.name || !Array.isArray(object.polygon) || object.polygon.length < 3) continue;

            const baseX = object.x ?? 0;
            const baseY = object.y ?? 0;
            const polygon = object.polygon.map((point) => ({ x: baseX + point.x, y: baseY + point.y }));

            results.push({
                name: object.name,
                polygon
            });
        }

        return results;
    }

    private resolveMapPath(mapFileName: string): string | null {
        const candidates = [
            path.resolve(__dirname, '../../../client/public/maps', mapFileName),
            path.resolve(__dirname, '../../client/public/maps', mapFileName),
            path.resolve(process.cwd(), '../client/public/maps', mapFileName),
            path.resolve(process.cwd(), 'client/public/maps', mapFileName)
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return candidate;
        }

        return null;
    }
}
