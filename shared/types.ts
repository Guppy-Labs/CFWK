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

export type PlayerAnim = 'idle' | 'walk' | 'run' | 'cast' | 'reel';

export interface IPlayer {
    x: number;
    y: number;
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

export interface InventorySlot {
  index: number;
  itemId: string | null;
  count: number;
}

export interface IInventoryResponse {
  slots: InventorySlot[];
  totalSlots: number;
  equippedRodId?: string | null;
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

