import { Room, Client } from "colyseus";
import { randomUUID } from "crypto";
import { calculateWorldTime, DEFAULT_CHARACTER_APPEARANCE, getLootTable, selectFromLootTable, getItemDefinition, getRodStats, IPlayerStatsDelta, PlayerStatKey, PLAYER_STAT_KEYS, ClientMovementFrame, MovementInputState, ServerMovementReconcile, AINpcKind, PlayerAnim, SOFT_COLLISION_FORCE, SOFT_COLLISION_PLAYER_FOOT_HITBOX, IAdvancementAlertMessage, IAdvancementsState, IGuideTutorialState, DEFAULT_INVENTORY_SLOTS, DEFAULT_PLAYER_HEARTS_STATE, IPlayerHeartsState, isEquippableUsableItem, DEFAULT_PLAYER_MONEY_STATE, GlimmerbowlEntry, GlimmerbowlCombatStatePayload, GlimmerbowlFishLandEvent, GlimmerbowlFishLaunchEvent, GlimmerbowlFishReturnEvent, GlimmerbowlLaunchRequestPayload, DEFAULT_PLAYER_STATS, DEFAULT_USER_ADVANCEMENTS, DEFAULT_GUIDE_TUTORIAL_STATE } from "@cfwk/shared";
import { InstanceManager } from "../managers/InstanceManager";
import { InventoryCache } from "../managers/InventoryCache";
import { GlimmerbowlCache } from "../managers/GlimmerbowlCache";
import { CommandProcessor } from "../utils/CommandProcessor";
import User from "../models/User";
import BannedIP from "../models/BannedIP";
import { PlayerStatsCache } from "../managers/PlayerStatsCache";
import { AI_METERS_TO_PIXELS, AI_NPC_DEFINITIONS, getAiControllerById } from "../ai/registry";
import { ServerMapNavService } from "../ai/ServerMapNavService";
import { AiNpcRuntimeState } from "../ai/types";
import { AdvancementsManager } from "../managers/AdvancementsManager";
import { CommandAuditLogger } from "../utils/CommandAuditLogger";
import { getBetaModels } from "../db/betaStorage";
import { DEFAULT_FIRST_CONNECT_LOCATION_ID } from "../config/instance";
import { DroppedItemSchema, InstanceAiNpcSchema, InstancePlayerSchema, InstanceState, PositionSnapshot, RuntimeMovementState, ChestInteractionTarget, CustomTriggerRuntime, FishCombatRuntimeState, InteractiveHarvestTarget, RegionRuntime, SoftCollisionBody, SpawnRegionRuntime } from "./instance/InstanceRoomSchema";
import { ACCEL, AI_TO_AI_COLLISION_MAX_PUSH_PER_STEP, AI_TO_AI_COLLISION_MIN_PUSH_PER_STEP, DANGER_REGION_NAME, DRAG, DROP_REFINEMENT_RECIPES_BY_SOURCE, DROP_REFINEMENT_TOUCH_COOLDOWN_MS, DROP_REFINEMENT_TOUCH_RADIUS_PX, ENEMY_BRIDGE_CUSTOM_ID, ENEMY_BRIDGE_IMPULSE_DURATION_MS, ENEMY_BRIDGE_IMPULSE_SPEED, ENEMY_BRIDGE_WARN_COOLDOWN_MS, ENEMY_MELEE_KNOCKBACK_DURATION_MS, ENEMY_MELEE_KNOCKBACK_RECOVERY_TAIL_MS, ENEMY_MELEE_KNOCKBACK_SPEED, FISH_COMBAT_MAX_COOLDOWN_MS, FISH_COMBAT_MAX_LAUNCH_RANGE_PX, FISH_COMBAT_MIN_COOLDOWN_MS, GAME_TPS, GLIMMERING_CHEST_COMPONENT_ID, GLIMMERING_KEY_ITEM_ID, GREMLIN_DEATH_ANIM_MS, HARD_DISCREPANCY, HEED_THE_WARNING_QUEST_ID, HISTORY_SIZE, LIQUID_COLLECTION_RECIPES_BY_LIQUID, MAX_LATENCY_ESTIMATE_MS, MAX_LATENCY_THRESHOLD_SCALE, MAX_STEP_DT_MS, RECONCILE_INTERVAL_MS, SOFT_DISCREPANCY, SPRINT_SPEED, WALK_SPEED, YEKBUSH_COOLDOWN_MS, YEKBUSH_COMPONENT_ID } from "./instance/InstanceRoomConstants";
import { getRandomPointInSpawnRegion, isPointInPolygon, loadChestInteractionTarget, loadCustomTriggers, loadHarvestTargets, loadPlayerSpawnPoint, loadRegionByName, loadSpawnRegions } from "./instance/InstanceRoomMapRuntime";
import { createDefaultInstanceRoomDeps } from "./instance/context/InstanceRoomDeps";
import { InstanceRoomHost } from "./instance/context/InstanceRoomHost";
import { handleJoinLifecycle, registerJoinInventoryAndProgressionHandlers as registerJoinInventoryHandlersService } from "./instance/services/JoinLifecycleService";
import { JoinResolvedState, enforceIpBan as enforceIpBanService, getClientIP as getClientIPService, registerJoinConnection as registerJoinConnectionService, resolveJoinState as resolveJoinStateService } from "./instance/services/JoinStateResolver";
import { initializeJoinedPlayerState as initializeJoinedPlayerStateService, sendInitialJoinPayloads as sendInitialJoinPayloadsService } from "./instance/services/JoinPayloadService";
import {
    applyServerImpulse as applyServerImpulseService,
    clampNumber as clampNumberService,
    ensureRuntimeState as ensureRuntimeStateService,
    estimateClientLatencyMs as estimateClientLatencyMsService,
    getLatencyThresholdScale as getLatencyThresholdScaleService,
    getSnapshotAtTime as getSnapshotAtTimeService,
    handleMovementFrame as handleMovementFrameService,
    lerpNumber as lerpNumberService,
    predictKinematicStep as predictKinematicStepService,
    recordPositionSnapshot as recordPositionSnapshotService,
    registerMovementAndPresenceHandlers as registerMovementAndPresenceHandlersService,
    sanitizeMovementInput as sanitizeMovementInputService,
    sendMovementReconcile as sendMovementReconcileService,
    stepHardAuthorityMotion as stepHardAuthorityMotionService
} from "./instance/services/MovementMessageService";
import {
    applyDamageToPlayerHearts as applyDamageToPlayerHeartsService,
    applyEnemyDamage as applyEnemyDamageService,
    applyEnemyKnockbackFromFishLaunch as applyEnemyKnockbackFromFishLaunchService,
    despawnAiNpc as despawnAiNpcService,
    didPlayerDodgeMeleeAttack as didPlayerDodgeMeleeAttackService,
    isSpawnPointValid as isSpawnPointValidService,
    scheduleRegionRespawn as scheduleRegionRespawnService,
    spawnAiNpc as spawnAiNpcService,
    stepAiNpcSimulation as stepAiNpcSimulationService,
    stepEnemySpawning as stepEnemySpawningService,
    stepSoftEntityCollisions as stepSoftEntityCollisionsService,
    tryEnemyMeleeAttack as tryEnemyMeleeAttackService,
    trySpawnFromRegion as trySpawnFromRegionService
} from "./instance/services/AiSimulationService";
import { registerChatHandlers as registerChatHandlersService } from "./instance/services/ChatService";
import { registerAdminEventListeners as registerAdminEventListenersService } from "./instance/services/AdminService";
import { initializeRoomIntervals as initializeRoomIntervalsService, updateWorldTime as updateWorldTimeService } from "./instance/services/WorldTimeService";
import { handleDispose as handleDisposeService, handleLeave as handleLeaveService } from "./instance/services/LeaveDisposeService";
import {
    registerFishingHandlers as registerFishingHandlersService,
    registerInteractiveWorldHandlers as registerInteractiveWorldHandlersService,
    registerInventoryAndGlimmerbowlHandlers as registerInventoryAndGlimmerbowlHandlersService
} from "./instance/services/GameplayItemHandlersService";
import { registerNpcAndDebugHandlers as registerNpcAndDebugHandlersService } from "./instance/services/DebugNpcService";
import { registerShopHandlers as registerShopHandlersService } from "./instance/services/ShopService";
import {
    createDroppedCoins as createDroppedCoinsService,
    createDroppedItem as createDroppedItemService,
    getOrCreateHarvestCooldownMap as getOrCreateHarvestCooldownMapService,
    tryRefineDropsFromMovement as tryRefineDropsFromMovementService
} from "./instance/services/DroppedItemsService";
import {
    getItemCountFromSlots as getItemCountFromSlotsService,
    isNightWindowForGlimmeringKey as isNightWindowForGlimmeringKeyService,
    processQuestCompletionRewards as processQuestCompletionRewardsService,
    sendAdvancements as sendAdvancementsService,
    sendInventoryCountObjectiveForItem as sendInventoryCountObjectiveForItemService,
    shouldForceGlimmeringKeyCatch as shouldForceGlimmeringKeyCatchService,
    syncInventoryCountObjectives as syncInventoryCountObjectivesService,
    updateHeedTheWarningUnlockState as updateHeedTheWarningUnlockStateService
} from "./instance/services/ProgressionService";
import {
    buildAwakenedFishQueue as buildAwakenedFishQueueService,
    getFishCombatCooldownMs as getFishCombatCooldownMsService,
    getOrCreateFishCombatState as getOrCreateFishCombatStateService,
    handleGlimmerbowlCombatState as handleGlimmerbowlCombatStateService,
    handleGlimmerbowlLaunch as handleGlimmerbowlLaunchService,
    isFishCombatLaunchAllowed as isFishCombatLaunchAllowedService,
    processFishLanding as processFishLandingService,
    scheduleFishCombatTimer as scheduleFishCombatTimerService,
    selectFishForLaunch as selectFishForLaunchService
} from "./instance/services/GlimmerbowlService";
import {
    canUseDebugNpc as canUseDebugNpcService,
    createEmptyInventorySlots as createEmptyInventorySlotsService,
    getStatsUserId as getStatsUserIdService,
    giveDebugNpcItem as giveDebugNpcItemService,
    handleDangerExitHeal as handleDangerExitHealService,
    handleEnemyBridgeGate as handleEnemyBridgeGateService,
    hasAnyDelta as hasAnyDeltaService,
    hasOwnedScar as hasOwnedScarService,
    incrementStat as incrementStatService,
    initializeDebugNpcAvailabilityOnStartup as initializeDebugNpcAvailabilityOnStartupService,
    isBetaCampaignActive as isBetaCampaignActiveService,
    isDebugLocation as isDebugLocationService,
    isGlimmerbowlUnlocked as isGlimmerbowlUnlockedService,
    markActivity as markActivityService,
    normalizeHeartsState as normalizeHeartsStateService,
    normalizeMoneyAmount as normalizeMoneyAmountService,
    sendPlayerHeartsSnapshot as sendPlayerHeartsSnapshotService,
    sendPlayerMoneySnapshot as sendPlayerMoneySnapshotService,
    setHasOwnedScar as setHasOwnedScarService,
    setHasOwnedScarFromInventory as setHasOwnedScarFromInventoryService,
    wipePlayerGameplayData as wipePlayerGameplayDataService
} from "./instance/services/PlayerStateService";

/**
 * InstanceRoom - A Colyseus room representing a game world instance.
 * 
 * Each instance is bound to a specific map and has a player limit.
 * Multiple instances of the same location can exist simultaneously.
 */
export class InstanceRoom extends Room<InstanceState> {
    private instanceId: string = "";
    private deps = createDefaultInstanceRoomDeps();
    private instanceManager = this.deps.instanceManager;
    private timeUpdateInterval?: ReturnType<typeof setInterval>;
    private afkCheckInterval?: ReturnType<typeof setInterval>;
    private droppedItemCleanupInterval?: ReturnType<typeof setInterval>;
    private onlineTimeInterval?: ReturnType<typeof setInterval>;
    private statsBroadcastInterval?: ReturnType<typeof setInterval>;
    private fishingCasts = new Map<string, { depth: number; region: string; castAt: number; itemId?: string; clicksRequired?: number }>();
    private lastActivityBySession = new Map<string, number>();
    private movementRuntimeBySession = new Map<string, RuntimeMovementState>();
    private positionHistoryBySession = new Map<string, PositionSnapshot[]>();
    private lastReconcileSentAtBySession = new Map<string, number>();
    private gameTick: number = 0;
    private sprintStateBySession = new Map<string, boolean>();
    private pendingStatsDeltasBySession = new Map<string, IPlayerStatsDelta>();
    private tutorialStateBySession = new Map<string, IGuideTutorialState>();
    private glimmerbowlUnlockedByUserId = new Map<string, boolean>();
    private hasOwnedScarByUserId = new Map<string, boolean>();
    private fishCombatByUserId = new Map<string, FishCombatRuntimeState>();
    private fishCombatTimers = new Set<ReturnType<typeof setTimeout>>();
    private heartsByUserId = new Map<string, IPlayerHeartsState>();
    private moneyByUserId = new Map<string, number>();
    private defeatedByUserId = new Map<string, { defeatedAt: number; reason: string }>();
    private playerRespawnPoint: { x: number; y: number } = { x: 64, y: 64 };
    private wipedUserIds = new Set<string>();
    private harvestTargetsByObjectId = new Map<number, InteractiveHarvestTarget>();
    private harvestCooldownByUserId = new Map<string, Map<number, number>>();
    private chestInteractionTarget: ChestInteractionTarget | null = null;
    private navService = this.deps.navService;
    private aiRuntimeById = new Map<string, AiNpcRuntimeState>();
    private spawnRegions: SpawnRegionRuntime[] = [];
    private aiSpawnRegionByNpcId = new Map<string, SpawnRegionRuntime>();
    private customTriggersById = new Map<string, CustomTriggerRuntime>();
    private enemyBridgeWarnCooldownByUserId = new Map<string, number>();
    private enemyBridgeUnlockedByUserId = new Map<string, boolean>();
    private heedTheWarningStayObjectiveByUserId = new Map<string, boolean>();
    private dangerRegion: RegionRuntime | null = null;
    private wasInDangerByUserId = new Map<string, boolean>();
    private dropRefineTouchByUserAndDrop = new Map<string, number>();
    private dropRefineInsideByUserAndDrop = new Map<string, boolean>();
    private advancementsManager = this.deps.createAdvancementsManager('lobby.tmj');
    private debugNpcFeatureEnabled = false;
    private debugNpcFeatureInitialized = false;

    onCreate(options: { instanceId: string; locationId: string; mapFile: string; maxPlayers: number }) {
        console.log(`[InstanceRoom] Creating room for instance: ${options.instanceId}`);
        void this.initializeDebugNpcAvailabilityOnStartup();
        this.registerAdminEventListeners();
        this.initializeRoomState(options);
        this.initializeRoomIntervals();

        this.registerMovementAndPresenceHandlers();

        this.registerFishingHandlers();

        this.registerNpcAndDebugHandlers();

        this.registerInteractiveWorldHandlers();

        this.registerInventoryAndGlimmerbowlHandlers();

        this.registerChatHandlers();

        this.registerShopHandlers();
    }

    private registerShopHandlers() {
        registerShopHandlersService(this as unknown as InstanceRoomHost);
    }

    private registerInteractiveWorldHandlers() {
        registerInteractiveWorldHandlersService(this as unknown as InstanceRoomHost);
    }

    private registerInventoryAndGlimmerbowlHandlers() {
        registerInventoryAndGlimmerbowlHandlersService(this as unknown as InstanceRoomHost);
    }

    private registerMovementAndPresenceHandlers() {
        registerMovementAndPresenceHandlersService(this as unknown as InstanceRoomHost);
    }

    private registerFishingHandlers() {
        registerFishingHandlersService(this as unknown as InstanceRoomHost);
    }

    private registerNpcAndDebugHandlers() {
        registerNpcAndDebugHandlersService(this as unknown as InstanceRoomHost);
    }

    private registerChatHandlers() {
        registerChatHandlersService(this as unknown as InstanceRoomHost);
    }

    private registerAdminEventListeners() {
        registerAdminEventListenersService(this as unknown as InstanceRoomHost);
    }

    private initializeRoomState(options: { instanceId: string; locationId: string; mapFile: string; maxPlayers: number }) {
        this.instanceId = options.instanceId;
        this.maxClients = options.maxPlayers;

        const state = new InstanceState();
        state.instanceId = options.instanceId;
        state.locationId = options.locationId;
        state.mapFile = options.mapFile;
        this.setState(state);

        this.harvestTargetsByObjectId = loadHarvestTargets(options.mapFile);
        this.chestInteractionTarget = loadChestInteractionTarget(options.mapFile);
        this.harvestCooldownByUserId.clear();
        this.fishCombatByUserId.clear();
        this.spawnRegions = loadSpawnRegions(options.mapFile);
        this.aiSpawnRegionByNpcId.clear();
        this.customTriggersById = loadCustomTriggers(options.mapFile);
        this.dangerRegion = loadRegionByName(options.mapFile, DANGER_REGION_NAME);
        this.playerRespawnPoint = loadPlayerSpawnPoint(options.mapFile) ?? { x: 64, y: 64 };
        this.enemyBridgeWarnCooldownByUserId.clear();
        this.enemyBridgeUnlockedByUserId.clear();
        this.heedTheWarningStayObjectiveByUserId.clear();
        this.wasInDangerByUserId.clear();
        this.defeatedByUserId.clear();

        this.navService.initializeFromMap(options.mapFile);
        this.advancementsManager = new AdvancementsManager(options.mapFile);
        this.updateWorldTime();
    }

    private initializeRoomIntervals() {
        initializeRoomIntervalsService(this as unknown as InstanceRoomHost);
    }

    private createDroppedItem(itemId: string, amount: number, x: number, y: number) {
        createDroppedItemService(this as unknown as InstanceRoomHost, itemId, amount, x, y);
    }

    private createDroppedCoins(amount: number, x: number, y: number, denomination: "bronze" = "bronze") {
        createDroppedCoinsService(this as unknown as InstanceRoomHost, amount, x, y, denomination);
    }

    private tryRefineDropsFromMovement(client: Client, player: InstancePlayerSchema, nextX: number, nextY: number, now: number) {
        tryRefineDropsFromMovementService(this as unknown as InstanceRoomHost, client, player, nextX, nextY, now);
    }

    private markActivity(client: Client) {
        markActivityService(this as unknown as InstanceRoomHost, client);
    }

    async onJoin(client: Client, options: { username?: string; joinToken?: string }) {
        await handleJoinLifecycle(this as unknown as InstanceRoomHost, client, options);
    }

    private registerJoinInventoryAndProgressionHandlers() {
        registerJoinInventoryHandlersService(this as unknown as InstanceRoomHost);
    }

    private async enforceIpBan(clientIP: string | null): Promise<void> {
        await enforceIpBanService(clientIP);
    }

    private async resolveJoinState(
        client: Client,
        odcid: string,
        clientIP: string | null,
        options?: { forceMapSpawn?: boolean }
    ): Promise<JoinResolvedState> {
        return resolveJoinStateService(this as unknown as InstanceRoomHost, client, odcid, clientIP, options);
    }

    private registerJoinConnection(client: Client, odcid: string) {
        registerJoinConnectionService(this as unknown as InstanceRoomHost, client, odcid);
    }

    private initializeJoinedPlayerState(client: Client, options: { username?: string; joinToken?: string }, joinState: JoinResolvedState) {
        initializeJoinedPlayerStateService(this as unknown as InstanceRoomHost, client, options, joinState);
    }

    private async sendInitialJoinPayloads(client: Client, joinState: JoinResolvedState): Promise<void> {
        await sendInitialJoinPayloadsService(this as unknown as InstanceRoomHost, client, joinState);
    }

    /**
     * Extract client IP from Colyseus client
     */
    private getClientIP(client: Client): string | null {
        return getClientIPService(client);
    }

    async onLeave(client: Client, consented: boolean) {
        await handleLeaveService(this as unknown as InstanceRoomHost, client, consented);
    }

    onDispose() {
        handleDisposeService(this as unknown as InstanceRoomHost);
    }

    private async isGlimmerbowlUnlocked(userId: string): Promise<boolean> {
        return isGlimmerbowlUnlockedService(this as unknown as InstanceRoomHost, userId);
    }

    private async hasOwnedScar(userId: string): Promise<boolean> {
        return hasOwnedScarService(this as unknown as InstanceRoomHost, userId);
    }

    private async setHasOwnedScar(userId: string): Promise<void> {
        await setHasOwnedScarService(this as unknown as InstanceRoomHost, userId);
    }

    private async setHasOwnedScarFromInventory(userId: string, items: Array<{ itemId: string | null; count: number }>): Promise<void> {
        await setHasOwnedScarFromInventoryService(this as unknown as InstanceRoomHost, userId, items);
    }

    private isDebugLocation(): boolean {
        return isDebugLocationService();
    }

    private async isBetaCampaignActive(): Promise<boolean> {
        return isBetaCampaignActiveService();
    }

    private async initializeDebugNpcAvailabilityOnStartup() {
        await initializeDebugNpcAvailabilityOnStartupService(this as unknown as InstanceRoomHost);
    }

    private async canUseDebugNpc(): Promise<boolean> {
        return canUseDebugNpcService(this as unknown as InstanceRoomHost);
    }

    private createEmptyInventorySlots() {
        return createEmptyInventorySlotsService();
    }

    private async wipePlayerGameplayData(userId: string): Promise<void> {
        await wipePlayerGameplayDataService(this as unknown as InstanceRoomHost, userId);
    }

    private async giveDebugNpcItem(
        client: Client,
        player: InstancePlayerSchema,
        itemId: string,
        amount: number
    ): Promise<Array<{ itemId: string | null; count: number }> | null> {
        return giveDebugNpcItemService(this as unknown as InstanceRoomHost, client, player, itemId, amount);
    }

    private getOrCreateFishCombatState(userId: string): FishCombatRuntimeState {
        return getOrCreateFishCombatStateService(this as unknown as InstanceRoomHost, userId);
    }

    private scheduleFishCombatTimer(callback: () => void, delayMs: number) {
        scheduleFishCombatTimerService(this as unknown as InstanceRoomHost, callback, delayMs);
    }

    private buildAwakenedFishQueue(entries: GlimmerbowlEntry[]): string[] {
        return buildAwakenedFishQueueService(entries);
    }

    private isFishCombatLaunchAllowed(player: InstancePlayerSchema): boolean {
        return isFishCombatLaunchAllowedService(player);
    }

    private selectFishForLaunch(
        entries: GlimmerbowlEntry[],
        runtime: FishCombatRuntimeState,
        nowMs: number
    ): GlimmerbowlEntry | null {
        return selectFishForLaunchService(entries, runtime, nowMs);
    }

    private getFishCombatCooldownMs(speed: number): number {
        return getFishCombatCooldownMsService(speed);
    }

    private async handleGlimmerbowlCombatState(client: Client, data: GlimmerbowlCombatStatePayload): Promise<void> {
        await handleGlimmerbowlCombatStateService(this as unknown as InstanceRoomHost, client, data);
    }

    private async handleGlimmerbowlLaunch(client: Client, data: GlimmerbowlLaunchRequestPayload): Promise<void> {
        await handleGlimmerbowlLaunchService(this as unknown as InstanceRoomHost, client, data);
    }

    private processFishLanding(launchPayload: GlimmerbowlFishLaunchEvent, fishEntry: GlimmerbowlEntry) {
        processFishLandingService(this as unknown as InstanceRoomHost, launchPayload, fishEntry);
    }

    private applyEnemyKnockbackFromFishLaunch(aiId: string, launchFromX: number, launchFromY: number, damageAmount: number): void {
        applyEnemyKnockbackFromFishLaunchService(this as unknown as InstanceRoomHost, aiId, launchFromX, launchFromY, damageAmount);
    }

    private normalizeHeartsState(input: IPlayerHeartsState): IPlayerHeartsState {
        return normalizeHeartsStateService(input);
    }

    private normalizeMoneyAmount(input: number): number {
        return normalizeMoneyAmountService(input);
    }

    private getOrCreateHarvestCooldownMap(userId: string): Map<number, number> {
        return getOrCreateHarvestCooldownMapService(this as unknown as InstanceRoomHost, userId);
    }

    private handleEnemyBridgeGate(client: Client, player: InstancePlayerSchema, x: number, y: number) {
        handleEnemyBridgeGateService(this as unknown as InstanceRoomHost, client, player, x, y);
    }

    private handleDangerExitHeal(client: Client, player: InstancePlayerSchema, x: number, y: number) {
        handleDangerExitHealService(this as unknown as InstanceRoomHost, client, player, x, y);
    }

    private stepEnemySpawning() {
        stepEnemySpawningService(this as unknown as InstanceRoomHost);
    }

    private trySpawnFromRegion(region: SpawnRegionRuntime): boolean {
        return trySpawnFromRegionService(this as unknown as InstanceRoomHost, region);
    }

    private isSpawnPointValid(kind: AINpcKind, x: number, y: number): boolean {
        return isSpawnPointValidService(this as unknown as InstanceRoomHost, kind, x, y);
    }

    private scheduleRegionRespawn(region: SpawnRegionRuntime) {
        scheduleRegionRespawnService(region);
    }

    private tryEnemyMeleeAttack(attacker: AiNpcRuntimeState, targetSessionId: string, damageHearts: number) {
        tryEnemyMeleeAttackService(this as unknown as InstanceRoomHost, attacker, targetSessionId, damageHearts);
    }

    private didPlayerDodgeMeleeAttack(targetSessionId: string, now: number): boolean {
        return didPlayerDodgeMeleeAttackService(this as unknown as InstanceRoomHost, targetSessionId, now);
    }

    private applyDamageToPlayerHearts(targetSessionId: string, damageHearts: number) {
        applyDamageToPlayerHeartsService(this as unknown as InstanceRoomHost, targetSessionId, damageHearts);
    }

    private sendPlayerHeartsSnapshot(client: Client, overrideHearts?: IPlayerHeartsState) {
        sendPlayerHeartsSnapshotService(this as unknown as InstanceRoomHost, client, overrideHearts);
    }

    private sendPlayerMoneySnapshot(client: Client, overrideMoney?: number) {
        sendPlayerMoneySnapshotService(this as unknown as InstanceRoomHost, client, overrideMoney);
    }

    private applyEnemyDamage(aiId: string, damageAmount: number): boolean {
        return applyEnemyDamageService(this as unknown as InstanceRoomHost, aiId, damageAmount);
    }

    private despawnAiNpc(id: string) {
        despawnAiNpcService(this as unknown as InstanceRoomHost, id);
    }

    private stepHardAuthorityMotion(deltaTimeMs: number) {
        stepHardAuthorityMotionService(this as unknown as InstanceRoomHost, deltaTimeMs);
    }

    private ensureRuntimeState(client: Client, player: InstancePlayerSchema): RuntimeMovementState {
        return ensureRuntimeStateService(this as unknown as InstanceRoomHost, client, player);
    }

    private sanitizeMovementInput(input?: Partial<MovementInputState>): MovementInputState {
        return sanitizeMovementInputService(input);
    }

    private predictKinematicStep(
        baseX: number,
        baseY: number,
        baseVx: number,
        baseVy: number,
        input: MovementInputState,
        dtSec: number,
        speedMultiplier = 1
    ) {
        return predictKinematicStepService(baseX, baseY, baseVx, baseVy, input, dtSec, speedMultiplier);
    }

    private handleMovementFrame(client: Client, frame: ClientMovementFrame) {
        handleMovementFrameService(this as unknown as InstanceRoomHost, client, frame);
    }

    private async sendAdvancements(client: Client, updates: { alerts: IAdvancementAlertMessage[]; delayedNewQuestCounts: number[] }) {
        await sendAdvancementsService(this as unknown as InstanceRoomHost, client, updates);
    }

    private async shouldForceGlimmeringKeyCatch(userId: string, x: number, y: number): Promise<boolean> {
        return shouldForceGlimmeringKeyCatchService(this as unknown as InstanceRoomHost, userId, x, y);
    }

    private isNightWindowForGlimmeringKey(): boolean {
        return isNightWindowForGlimmeringKeyService();
    }

    private async processQuestCompletionRewards(client: Client, userId: string, alerts: IAdvancementAlertMessage[]) {
        await processQuestCompletionRewardsService(this as unknown as InstanceRoomHost, client, userId, alerts);
    }

    private getItemCountFromSlots(slots: Array<{ itemId: string | null; count: number }>, itemId: string): number {
        return getItemCountFromSlotsService(slots, itemId);
    }

    private async sendInventoryCountObjectiveForItem(
        client: Client,
        userId: string,
        itemId: string,
        slots: Array<{ itemId: string | null; count: number }>
    ) {
        await sendInventoryCountObjectiveForItemService(this as unknown as InstanceRoomHost, client, userId, itemId, slots);
    }

    private async syncInventoryCountObjectives(client: Client, userId: string) {
        await syncInventoryCountObjectivesService(this as unknown as InstanceRoomHost, client, userId);
    }

    private updateHeedTheWarningUnlockState(userId: string, state: IAdvancementsState) {
        updateHeedTheWarningUnlockStateService(this as unknown as InstanceRoomHost, userId, state);
    }

    private sendMovementReconcile(
        client: Client,
        player: InstancePlayerSchema,
        seqAck: number,
        authority: ServerMovementReconcile['authority'],
        hardOverride: boolean,
        errorDistance: number,
        reason?: string,
        hardThreshold?: number
    ) {
        sendMovementReconcileService(this as unknown as InstanceRoomHost, client, player, seqAck, authority, hardOverride, errorDistance, reason, hardThreshold);
    }

    private estimateClientLatencyMs(frame: ClientMovementFrame, now: number): number {
        return estimateClientLatencyMsService(frame, now);
    }

    private getLatencyThresholdScale(latencyMs: number): number {
        return getLatencyThresholdScaleService(latencyMs);
    }

    private recordPositionSnapshot(sessionId: string, x: number, y: number, time: number) {
        recordPositionSnapshotService(this as unknown as InstanceRoomHost, sessionId, x, y, time);
    }

    private getSnapshotAtTime(sessionId: string, timestamp: number): PositionSnapshot | null {
        return getSnapshotAtTimeService(this as unknown as InstanceRoomHost, sessionId, timestamp);
    }

    private applyServerImpulse(
        sessionId: string,
        vx: number,
        vy: number,
        durationMs: number,
        sourceSessionId: string,
        options?: { accumulate?: boolean; recoveryTailMs?: number }
    ) {
        applyServerImpulseService(this as unknown as InstanceRoomHost, sessionId, vx, vy, durationMs, sourceSessionId, options);
    }

    private stepAiNpcSimulation(deltaTimeMs: number) {
        stepAiNpcSimulationService(this as unknown as InstanceRoomHost, deltaTimeMs);
    }

    private stepSoftEntityCollisions(deltaTimeMs: number) {
        stepSoftEntityCollisionsService(this as unknown as InstanceRoomHost, deltaTimeMs);
    }

    private spawnAiNpc(kind: AINpcKind, x: number, y: number, spawnRegion?: SpawnRegionRuntime): string | null {
        return spawnAiNpcService(this as unknown as InstanceRoomHost, kind, x, y, spawnRegion);
    }

    private clampNumber(value: number, min: number, max: number): number {
        return clampNumberService(value, min, max);
    }

    private lerpNumber(a: number, b: number, t: number): number {
        return lerpNumberService(a, b, t);
    }

    private getStatsUserId(client: Client, player: InstancePlayerSchema): string | null {
        return getStatsUserIdService(client, player);
    }

    private incrementStat(client: Client, player: InstancePlayerSchema, key: PlayerStatKey, amount: number) {
        incrementStatService(this as unknown as InstanceRoomHost, client, player, key, amount);
    }

    private hasAnyDelta(delta: IPlayerStatsDelta): boolean {
        return hasAnyDeltaService(delta);
    }

    /**
     * Calculate and update the world time state
     */
    private updateWorldTime() {
        updateWorldTimeService(this as unknown as InstanceRoomHost);
    }
}
