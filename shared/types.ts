export interface Fish {
    id: string;
    name: string;
    rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
}

export interface ChatMessage {
    sessionId: string;
    username: string;
    text: string;
}

export interface PlayerInput {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    action: boolean; // Space bar for casting/reeling
}

export type PlayerAnim = 'idle' | 'walk' | 'cast' | 'reel';

export interface IPlayer {
    x: number;
    y: number;
    anim: PlayerAnim;
    isFishing: boolean;
    username: string;
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
