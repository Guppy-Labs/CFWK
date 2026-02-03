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

export interface InventoryEntry {
    itemId: string;
    count: number;
}

export interface IInventoryResponse {
    items: InventoryEntry[];
}

// Re-export WorldTime module
export * from './WorldTime';
export * from './items';

// --- Character Appearance Types ---

/**
 * Character appearance customization
 * Each layer can be tinted with primary/secondary colors
 */
export interface ICharacterAppearance {
  body: {
    primaryColor: string;    // Hex color for main body
    secondaryColor: string;  // Hex color for accents
  };
  accessories: {
    cape: {
      equipped: boolean;
      primaryColor: string;
      secondaryColor: string;
    };
    scarf: {
      equipped: boolean;
      primaryColor: string;
      secondaryColor: string;
    };
  };
}

/**
 * Default character appearance (cat with default colors, cape and scarf equipped)
 */
export const DEFAULT_CHARACTER_APPEARANCE: ICharacterAppearance = {
  body: {
    primaryColor: '#FFFFFF',
    secondaryColor: '#CCCCCC'
  },
  accessories: {
    cape: {
      equipped: true,
      primaryColor: '#FF6B6B',
      secondaryColor: '#CC5555'
    },
    scarf: {
      equipped: true,
      primaryColor: '#4ECDC4',
      secondaryColor: '#3BA99C'
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
 * N/S directions are 16x27, E/W are 19x27 (cape extends)
 */
export const MC_FRAME_DIMENSIONS: Record<MCDirection, { width: number; height: number }> = {
  N: { width: 16, height: 27 },
  S: { width: 16, height: 27 },
  E: { width: 19, height: 27 },
  W: { width: 19, height: 27 },
  NE: { width: 19, height: 27 }, // Uses E for now
  SE: { width: 19, height: 27 }, // Uses E for now
  NW: { width: 19, height: 27 }, // Uses E mirrored
  SW: { width: 19, height: 27 }  // Uses E mirrored
};

/**
 * Number of frames per animation strip
 */
export const MC_FRAMES_PER_ANIMATION = 8;

