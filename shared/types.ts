export interface Fish {
    id: string;
    name: string;
    rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
}

export interface ChatMessage {
    sessionId: string;
    username: string;
    text: string;
    isSystem?: boolean; // New field for system messages
  isPremium?: boolean; // Shark tier badge
}

export interface PlayerInput {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    action: boolean; // Space bar for casting/reeling
}

export type MovementAuthorityMode = 'soft-client' | 'hard-server';

export interface MovementInputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
}

export interface ClientMovementFrame {
  seq: number;
  clientTime: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speedMultiplier: number;
  input: MovementInputState;
  anim: PlayerAnim;
  direction: number;
}

export interface ServerMovementReconcile {
  seqAck: number;
  serverTick: number;
  serverTime: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  authority: MovementAuthorityMode;
  hardOverride: boolean;
  errorDistance: number;
  hardThreshold?: number;
  reason?: string;
}

export interface ServerMovementImpulse {
  sourceSessionId: string;
  vx: number;
  vy: number;
  durationMs: number;
  authority: 'hard-server';
  serverTick: number;
  serverTime: number;
}

export const SOFT_COLLISION_PLAYER_FOOT_HITBOX = {
  width: 19.2,
  height: 7.2
} as const;

export const SOFT_COLLISION_FORCE = {
  pushScalar: 0.04,
  maxPushPerStep: 0.02,
  velocityTransfer: 0.35,
  epsilon: 0.0001
} as const;

export type AINpcAnim = 'idle' | 'walk' | 'attack' | 'death';

export type AINpcKind = 'evil_tim' | 'gremlin';

export type AINpcControllerId = 'general-enemy';

export interface IAiNpcHitbox {
  width: number;
  height: number;
  collidableHeight: number;
}

export interface IAiNpcState {
  id: string;
  kind: AINpcKind;
  controllerId: AINpcControllerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  moveTs: number;
  direction: number;
  anim: AINpcAnim;
  tint: number;
  hitbox: IAiNpcHitbox;
  currentHealth: number;
  maxHealth: number;
  pathDebug?: string;
}

export interface IGeneralEnemyControllerConfig {
  speedPxPerSecond: number;
  idleCheckFrequencyTicks: number;
  idleMoveChance: number;
  idleMoveRangeMinMeters: number;
  idleMoveRangeMaxMeters: number;
  chaseRangeMeters: number;
  pathRecomputeFrequencyTicks: number;
  attackCooldownMs: number;
  meleeRangePx: number;
  meleeDamageHearts: number;
}

export const DEFAULT_GENERAL_ENEMY_CONTROLLER_CONFIG: IGeneralEnemyControllerConfig = {
  speedPxPerSecond: 74,
  idleCheckFrequencyTicks: 100,
  idleMoveChance: 0.4,
  idleMoveRangeMinMeters: 2,
  idleMoveRangeMaxMeters: 4,
  chaseRangeMeters: 20,
  pathRecomputeFrequencyTicks: 5,
  attackCooldownMs: 3400,
  meleeRangePx: 24,
  meleeDamageHearts: 1
};

export type PlayerAnim = 'idle' | 'walk' | 'run' | 'cast' | 'reel';

export interface IPlayer {
    x: number;
    y: number;
  vx?: number;
  vy?: number;
  moveTs?: number;
    anim: PlayerAnim;
    isFishing: boolean;
    username: string;
    odcid?: string;      // MongoDB ObjectId for consistent color tinting
    direction?: number;   // 0-7 for 8-way direction
    isAfk?: boolean;     // AFK status for transparency
    afkSince?: number;   // Server timestamp (ms) when AFK started
    isGuiOpen?: boolean; // Whether main GUI is open
    isChatOpen?: boolean; // Whether chat is open/focused
}

  export const PLAYER_RENDER_SCALE = 1.35;

// --- Map System Types ---

export enum MapState {
    DRAFT = 'draft',
    REVIEW = 'review',
    STAGED = 'staged',
    DEPLOYED = 'deployed'
}

// Deprecated as enum, but used for defaults
export const DefaultLayers = {
    BACKGROUND: 'background',
    GROUND: 'ground',
    WALL: 'wall',
    DECO: 'deco',
    OBJECT: 'object'
};

export const SYSTEM_TILES = {
    SPAWN: 'SYSTEM_SPAWN',
    COLLISION: 'SYSTEM_COLLISION',
    ShowAbove: 'SYSTEM_SHOW_ABOVE',
    INVISIBLE: 'SYSTEM_INVISIBLE'
};

export interface ITile {
    _id?: string;
    id: string; // "flat_grass"
    name: string; // "Flat Grass"
    imageUrl: string; // "/uploads/tiles/flat_grass.png"
    movable: boolean; // can it be moved/pushed?
    speedMultiplier: number; // 1.0 is normal
    damagePerTick: number; // 0 is none
    behaviorId?: string; // "zombie2"
    hidden?: boolean; // lib hider
}

export interface ITileGroup {
    id: string;
    name: string;
    tiles: { x: number, y: number, tileId: string }[];
    previewUrl?: string;
}

export interface IFolder {
    itemType: 'folder';
    id: string; // "folder_TIMESTAMP"
    name: string;
    color: string;
    icon: string;
    items: (ITile | IFolder | string)[]; 
    collapsed: boolean;
}

export interface IMapLayerData {
    [coordinate: string]: string; // "x,y": "tile_id"
}

export interface ILayer {
    id: string;
    name: string;
    type: 'tile' | 'object';
    visible: boolean;
    locked: boolean;
  isPremium?: boolean; // Shark tier badge
    data: IMapLayerData;
    properties?: {
        collidable?: boolean;
        above?: boolean;
        solidRoof?: boolean;
    };
}

export interface IMap {
    _id?: string;
    name: string;
    state: MapState;
    width: number;
    height: number;
    palette: (string | ITile | IFolder)[];
    layers: ILayer[];
    createdAt: Date;
    updatedAt: Date;
}

export interface IMapData {
    id: string;
    name: string;
    width: number;
    height: number;
    layers: { id: string, name: string, data: { x: number, y: number, tileId: string }[] }[];
}

// --- Instance System Types ---

/**
 * Represents a game world location type.
 * Each location can have multiple instances.
 */
export interface ILocationConfig {
    id: string;           // "lobby", "forest_1", etc.
    name: string;         // "Main Lobby"
    mapFile: string;      // "lobby.tmj" - the Tiled map file
    maxPlayers: number;   // Max players per instance
    isPublic: boolean;    // Can anyone join?
}

/**
 * Information about a specific instance the client should join.
 * Returned by the server when client requests where to go.
 */
export interface IInstanceInfo {
    instanceId: string;      // Unique instance ID (e.g., "lobby-1", "lobby-2")
    locationId: string;      // Which location this is ("lobby")
    mapFile: string;         // Which map to load ("lobby.tmj")
    roomName: string;        // Colyseus room name to join
    currentPlayers: number;  // How many players currently
    maxPlayers: number;      // Max capacity
  spawnX?: number;         // Optional persisted rejoin X coordinate
  spawnY?: number;         // Optional persisted rejoin Y coordinate
}

/**
 * Response from /api/instance/join
 */
export interface IJoinInstanceResponse {
    success: boolean;
    instance?: IInstanceInfo;
    error?: string;
}

// --- Inventory System Types ---

export const DEFAULT_INVENTORY_SLOTS = 15;
export const DEFAULT_USABLE_EQUIP_SLOTS = 4;

export interface InventorySlot {
  index: number;
  itemId: string | null;
  count: number;
}

export interface IInventoryResponse {
  slots: InventorySlot[];
  totalSlots: number;
  equippedRodId?: string | null;
  equippedUsableIds?: Array<string | null>;
}

export interface IPlayerHeartsState {
  currentHearts: number;
  maxHearts: number;
}

export const DEFAULT_PLAYER_HEARTS_STATE: IPlayerHeartsState = {
  currentHearts: 9,
  maxHearts: 9
};

export interface IPlayerMoneyState {
  money: number;
}

export const DEFAULT_PLAYER_MONEY_STATE: IPlayerMoneyState = {
  money: 0
};

export type GlimmerFishTier = 'regular' | 'awakened';

export interface FishCombatStats {
  damage: number;
  speed: number;
  energy: number;
  critRate: number;
  critDamage: number;
}

export interface GlimmerbowlEntry {
  id: string;
  itemId: string;
  tier: GlimmerFishTier;
  stats: FishCombatStats;
  awakenedByScarId?: string | null;
}

export interface IGlimmerbowlResponse {
  entries: GlimmerbowlEntry[];
  unlocked: boolean;
  hasOwnedScar?: boolean;
}

export interface GlimmerbowlCombatStatePayload {
  active: boolean;
}

export interface GlimmerbowlLaunchRequestPayload {
  targetX: number;
  targetY: number;
}

export interface GlimmerbowlCombatHitResult {
  aiId: string;
  damage: number;
  isCrit: boolean;
}

export interface GlimmerbowlFishLaunchEvent {
  eventId: string;
  ownerSessionId: string;
  fishEntryId: string;
  fishItemId: string;
  launchedAt: number;
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  outboundMs: number;
  returnMs: number;
  arcHeightPx: number;
}

export interface GlimmerbowlFishLandEvent {
  eventId: string;
  ownerSessionId: string;
  fishEntryId: string;
  fishItemId: string;
  landedAt: number;
  targetX: number;
  targetY: number;
  radiusPx: number;
  hits: GlimmerbowlCombatHitResult[];
}

export interface GlimmerbowlFishReturnEvent {
  eventId: string;
  ownerSessionId: string;
  fishEntryId: string;
  fishItemId: string;
  returnStartedAt: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  returnMs: number;
  arcHeightPx: number;
}

// --- User Settings Types ---

export interface IAudioSettings {
  master: number;
  music: number;
  ambient: number;
  players: number;
  overlays: number;
  subtitlesEnabled: boolean;
  stereoEnabled: boolean;
}

export type VideoQualityPreset = 'low' | 'medium' | 'high' | 'custom';

export interface IVideoSettings {
  qualityPreset: VideoQualityPreset;
  fullscreen: boolean;
  visualEffectsEnabled: boolean;
  seasonalEffectsEnabled: boolean;
  bloomEnabled: boolean;
  vignetteEnabled: boolean;
  tiltShiftEnabled: boolean;
  crtEnabled: boolean;
  dustParticlesEnabled: boolean;
}

export type ControlActionKey =
  | 'moveUp'
  | 'moveLeft'
  | 'moveDown'
  | 'moveRight'
  | 'sprint'
  | 'interact'
  | 'inventory'
  | 'fish'
  | 'playerList'
  | 'chat'
  | 'dialogueAdvance';

export interface IControlsSettings {
  moveUp: string | null;
  moveLeft: string | null;
  moveDown: string | null;
  moveRight: string | null;
  sprint: string | null;
  interact: string | null;
  inventory: string | null;
  fish: string | null;
  playerList: string | null;
  chat: string | null;
  dialogueAdvance: string | null;
}

export const CONTROL_ACTION_KEYS: ControlActionKey[] = [
  'moveUp',
  'moveLeft',
  'moveDown',
  'moveRight',
  'sprint',
  'interact',
  'inventory',
  'fish',
  'playerList',
  'chat',
  'dialogueAdvance'
];

export interface IUserSettings {
  language: string;
  audio: IAudioSettings;
  video: IVideoSettings;
  controls: IControlsSettings;
}

export interface ISettingsResponse {
  settings: IUserSettings;
}

export type PlayerStatKey = 'distanceWalked' | 'distanceRan' | 'timeOnlineMs' | 'catches' | 'npcInteractions';

export interface IPlayerStats {
  distanceWalked: number;
  distanceRan: number;
  timeOnlineMs: number;
  catches: number;
  npcInteractions: number;
}

export type IPlayerStatRanks = Partial<Record<PlayerStatKey, number | null>>;

export interface IPlayerStatsResponse {
  stats: IPlayerStats;
  ranks: IPlayerStatRanks;
}

export type QuestProgressStatus = 'active' | 'completed';

export interface IQuestProgressEntry {
  questId: string;
  status: QuestProgressStatus;
  startedAt: number | null;
  completedAt: number | null;
  objectiveIndex?: number | null;
}

export interface IAdvancementsState {
  enrolled: boolean;
  questProgress: Record<string, IQuestProgressEntry>;
  completedAchievements: string[];
  discoveredRegions: Record<string, string[]>;
  tutorial: IGuideTutorialState;
}

export type GuideRodStep = 'idle' | 'open_inventory' | 'select_rod' | 'equip_rod' | 'close_inventory' | 'completed';

export type GuideFishingStep = 'idle' | 'use_rod' | 'hold_cast' | 'wait_bite' | 'reel' | 'stop_fishing' | 'completed';

export type GuideInteractionStep = 'idle' | 'press_interact' | 'completed';

export type GuideFoodStep = 'idle' | 'open_inventory' | 'select_berry' | 'explain_food_score' | 'equip_quickslot_1' | 'close_inventory' | 'consume_quickslot_1' | 'completed';

export interface IGuideTutorialState {
  interactionStep: GuideInteractionStep;
  rodStep: GuideRodStep;
  fishingStep: GuideFishingStep;
  foodStep: GuideFoodStep;
  interactionCompleted: boolean;
  rodCompleted: boolean;
  fishingCompleted: boolean;
  foodCompleted: boolean;
  forceSalmonCatch: boolean;
  forceFoodGuideHeal: boolean;
  updatedAt: number | null;
}

export const DEFAULT_GUIDE_TUTORIAL_STATE: IGuideTutorialState = {
  interactionStep: 'idle',
  rodStep: 'idle',
  fishingStep: 'idle',
  foodStep: 'idle',
  interactionCompleted: false,
  rodCompleted: false,
  fishingCompleted: false,
  foodCompleted: false,
  forceSalmonCatch: false,
  forceFoodGuideHeal: false,
  updatedAt: null
};

export const DEFAULT_USER_ADVANCEMENTS: IAdvancementsState = {
  enrolled: true,
  questProgress: {},
  completedAchievements: [],
  discoveredRegions: {},
  tutorial: { ...DEFAULT_GUIDE_TUTORIAL_STATE }
};

export type AdvancementAlertType =
  | 'quest-started'
  | 'quest-objective'
  | 'quest-completed'
  | 'new-quests'
  | 'achievement-unlocked'
  | 'area-discovered';

export interface IAdvancementAlertMessage {
  type: AdvancementAlertType;
  questId?: string;
  objectiveIndex?: number;
  achievementId?: string;
  mapName?: string;
  regionName?: string;
  count?: number;
}

export type IQuestCatalogEntry = {
  id: string;
  dependencyQuestId: string | null;
  dependencyQuestIds?: string[];
  isSideQuest?: boolean;
  allowAutoTrack?: boolean;
  completeOnStartEvent?: boolean;
  nextQuestId?: string;
  nextQuestIds?: string[];
  startObjective?: IQuestObjectiveEntry;
  objectives?: IQuestObjectiveEntry[];
  objective?: IQuestObjectiveEntry;
};

export type QuestObjectiveKind =
  | 'fish-catch'
  | 'talk-to-npc'
  | 'harvest-interactive'
  | 'stay-in-region'
  | 'wait-for-time-window'
  | 'fish-near-location'
  | 'inventory-count'
  | 'refine-food'
  | 'bottle-liquid';

export type IQuestObjectiveEntry = {
  kind: QuestObjectiveKind;
  npcId?: string;
  componentId?: string;
  mapObjectId?: number;
  regionName?: string;
  durationMs?: number;
  resetOnExit?: boolean;
  startHour?: number;
  endHourExclusive?: number;
  locationName?: string;
  radiusMeters?: number;
  itemId?: string;
  requiredCount?: number;
  liquidItemId?: string;
  containerItemId?: string;
  outputItemId?: string;
};

export type IAchievementCatalogEntry = {
  id: string;
  category: string;
};

export type ILocationCatalogRegionEntry = {
  id: string;
};

export type ILocationCatalogEntry = {
  mapFile: string;
  mapName: string;
  regions: ILocationCatalogRegionEntry[];
};

export const ADVANCEMENT_QUEST_CATALOG: IQuestCatalogEntry[] = [
  {
    id: 'first_catch',
    dependencyQuestId: null,
    nextQuestIds: ['heed_the_warning', 'anti_death_measures'],
    startObjective: { kind: 'talk-to-npc', npcId: 'fisherman' },
    objectives: [
      { kind: 'fish-catch' },
      { kind: 'talk-to-npc', npcId: 'fisherman' }
    ],
    objective: { kind: 'fish-catch' }
  },
  {
    id: 'heed_the_warning',
    dependencyQuestId: 'first_catch',
    dependencyQuestIds: ['first_catch'],
    startObjective: { kind: 'talk-to-npc', npcId: 'guard' },
    objectives: [
      { kind: 'stay-in-region', regionName: 'Danger', durationMs: 60_000, resetOnExit: true },
      { kind: 'talk-to-npc', npcId: 'guard' }
    ],
    objective: { kind: 'stay-in-region', regionName: 'Danger', durationMs: 60_000, resetOnExit: true }
  },
  {
    id: 'anti_death_measures',
    dependencyQuestId: 'first_catch',
    dependencyQuestIds: ['first_catch'],
    startObjective: { kind: 'talk-to-npc', npcId: 'merchant' },
    objectives: [
      { kind: 'harvest-interactive', componentId: 'yekbush' },
      { kind: 'talk-to-npc', npcId: 'merchant' }
    ],
    objective: { kind: 'harvest-interactive', componentId: 'yekbush' }
  },
  {
    id: 'merchant_side_brew',
    dependencyQuestId: 'anti_death_measures',
    dependencyQuestIds: ['anti_death_measures'],
    isSideQuest: true,
    allowAutoTrack: false,
    startObjective: { kind: 'talk-to-npc', npcId: 'merchant' },
    objectives: [
      { kind: 'talk-to-npc', npcId: 'merchant' },
      { kind: 'refine-food', itemId: 'yekberries', liquidItemId: 'yekjuiceliquid' },
      { kind: 'talk-to-npc', npcId: 'merchant' },
      { kind: 'bottle-liquid', liquidItemId: 'yekjuiceliquid', containerItemId: 'jar', outputItemId: 'yekjuice' },
      { kind: 'talk-to-npc', npcId: 'merchant' }
    ],
    objective: { kind: 'talk-to-npc', npcId: 'merchant' }
  },
  {
    id: 'village_weirdo',
    dependencyQuestId: null,
    dependencyQuestIds: ['heed_the_warning', 'anti_death_measures'],
    startObjective: { kind: 'talk-to-npc', npcId: 'traveller' },
    objectives: [
      { kind: 'inventory-count', itemId: 'yekberries', requiredCount: 5 },
      { kind: 'talk-to-npc', npcId: 'traveller' }
    ],
    objective: { kind: 'inventory-count', itemId: 'yekberries', requiredCount: 5 }
  },
  {
    id: 'wares_galore',
    dependencyQuestId: 'village_weirdo',
    dependencyQuestIds: ['village_weirdo'],
    isSideQuest: true,
    allowAutoTrack: false,
    completeOnStartEvent: true,
    startObjective: { kind: 'talk-to-npc', npcId: 'merchant' },
    objectives: [
      { kind: 'talk-to-npc', npcId: 'merchant' }
    ],
    objective: { kind: 'talk-to-npc', npcId: 'merchant' }
  },
  {
    id: 'bowl_that_shines',
    dependencyQuestId: 'village_weirdo',
    dependencyQuestIds: ['village_weirdo'],
    startObjective: { kind: 'talk-to-npc', npcId: 'wiseman' },
    objectives: [
      { kind: 'talk-to-npc', npcId: 'seamaster' },
      { kind: 'talk-to-npc', npcId: 'traveller' },
      { kind: 'wait-for-time-window', startHour: 23, endHourExclusive: 4 },
      { kind: 'fish-near-location', locationName: 'KeyLocation', radiusMeters: 6 },
      { kind: 'talk-to-npc', npcId: 'seamaster' },
      { kind: 'harvest-interactive', componentId: 'glimmeringchest' },
      { kind: 'talk-to-npc', npcId: 'seamaster' }
    ],
    objective: { kind: 'talk-to-npc', npcId: 'seamaster' }
  }
];

export const ADVANCEMENT_ACHIEVEMENT_CATALOG: IAchievementCatalogEntry[] = [
  { id: 'campfire_stories', category: 'fun' }
];

export const ADVANCEMENT_LOCATION_CATALOG: ILocationCatalogEntry[] = [
  {
    mapFile: 'anchor-hollow.tmj',
    mapName: 'Anchor Hollow',
    regions: [
      { id: 'Coast Town' }
    ]
  }
];

export type IPlayerStatsDelta = Partial<Record<PlayerStatKey, number>>;

export const PLAYER_STAT_KEYS: PlayerStatKey[] = [
  'distanceWalked',
  'distanceRan',
  'timeOnlineMs',
  'catches',
  'npcInteractions'
];

export const DEFAULT_PLAYER_STATS: IPlayerStats = {
  distanceWalked: 0,
  distanceRan: 0,
  timeOnlineMs: 0,
  catches: 0,
  npcInteractions: 0
};

export const DEFAULT_USER_SETTINGS: IUserSettings = {
  language: 'en_US',
  audio: {
    master: 1,
    music: 1,
    ambient: 1,
    players: 1,
    overlays: 1,
    subtitlesEnabled: false,
    stereoEnabled: true
  },
  video: {
    qualityPreset: 'high',
    fullscreen: false,
    visualEffectsEnabled: true,
    seasonalEffectsEnabled: true,
    bloomEnabled: false,
    vignetteEnabled: true,
    tiltShiftEnabled: true,
    crtEnabled: true,
    dustParticlesEnabled: true
  },
  controls: {
    moveUp: 'KeyW',
    moveLeft: 'KeyA',
    moveDown: 'KeyS',
    moveRight: 'KeyD',
    sprint: 'ShiftLeft',
    interact: 'KeyF',
    inventory: 'KeyE',
    fish: 'KeyR',
    playerList: 'Tab',
    chat: 'KeyT',
    dialogueAdvance: 'Space'
  }
};

// Re-export WorldTime module
export * from './WorldTime';
export * from './items';
export * from './fishing';

// --- Character Appearance Types ---

/**
 * Character appearance customization
 * Uses hue + brightness shifts instead of hex colors
 */
export type HueBrightnessShift = {
  hueShift: number;        // Degrees, e.g. -180 to 180
  brightnessShift: number; // -1 to 1 (negative = darker, positive = brighter)
};

export interface ICharacterAppearance {
  body: HueBrightnessShift;
  head: HueBrightnessShift;
  accessories: {
    neck: {
      itemId: string; // e.g. "scarf"
      equipped: boolean;
      hueShift: number;
      brightnessShift: number;
    };
    cape: {
      itemId: string; // e.g. "cape"
      equipped: boolean;
      hueShift: number;
      brightnessShift: number;
    };
  };
}

/**
 * Default character appearance (cat with default colors, cape and scarf equipped)
 */
export const DEFAULT_CHARACTER_APPEARANCE: ICharacterAppearance = {
  body: { hueShift: 0, brightnessShift: 0 },
  head: { hueShift: 0, brightnessShift: 0 },
  accessories: {
    neck: {
      itemId: 'scarf',
      equipped: true,
      hueShift: 0,
      brightnessShift: 0
    },
    cape: {
      itemId: 'cape',
      equipped: true,
      hueShift: 0,
      brightnessShift: 0
    }
  }
};

/**
 * Animation types available for MC character
 */
export type MCAnimationType = 'idle' | 'walk' | 'run';

/**
 * Direction identifiers for MC animations
 * N = North (up), S = South (down), E = East (right), W = West (left)
 * Diagonals: NE, SE, SW, NW
 */
export type MCDirection = 'N' | 'S' | 'E' | 'W' | 'NE' | 'SE' | 'SW' | 'NW';

/**
 * Frame dimensions for MC animations by direction
 * N/S directions are 16x27, E/W are 19x27 (cape extends), NE/NW/SE/SW are 18x27
 */
export const MC_FRAME_DIMENSIONS_BY_ANIM: Record<MCAnimationType, Record<MCDirection, { width: number; height: number }>> = {
  walk: {
    N: { width: 16, height: 27 },
    S: { width: 16, height: 27 },
    E: { width: 19, height: 27 },
    W: { width: 19, height: 27 },
    NE: { width: 18, height: 27 },
    SE: { width: 18, height: 27 },
    NW: { width: 18, height: 27 },
    SW: { width: 18, height: 27 }
  },
  idle: {
    N: { width: 16, height: 27 },
    S: { width: 14, height: 29 },
    E: { width: 19, height: 28 },
    W: { width: 19, height: 28 },
    NE: { width: 18, height: 27 },
    SE: { width: 18, height: 27 },
    NW: { width: 18, height: 27 },
    SW: { width: 18, height: 27 }
  },
  run: {
    N: { width: 16, height: 27 },
    S: { width: 16, height: 27 },
    E: { width: 19, height: 27 },
    W: { width: 19, height: 27 },
    NE: { width: 18, height: 27 },
    SE: { width: 18, height: 27 },
    NW: { width: 18, height: 27 },
    SW: { width: 18, height: 27 }
  }
};

/**
 * Frame dimensions for MC walk animations by direction
 */
export const MC_FRAME_DIMENSIONS = MC_FRAME_DIMENSIONS_BY_ANIM.walk;

/**
 * Number of frames per animation strip, by animation type
 */
export const MC_FRAMES_PER_ANIMATION_BY_ANIM: Record<MCAnimationType, number> = {
  walk: 8,
  idle: 10,
  run: 8
};

/**
 * Number of frames per animation strip for MC walk animations
 */
export const MC_FRAMES_PER_ANIMATION = MC_FRAMES_PER_ANIMATION_BY_ANIM.walk;

