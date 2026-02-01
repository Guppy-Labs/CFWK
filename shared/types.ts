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

// Re-export WorldTime module
export * from './WorldTime';

