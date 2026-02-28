import Phaser from 'phaser';
import { TilesetEntry, TiledObjectLayer, TiledTilesetData } from './TiledTypes';
import { TileAnimationManager } from './TileAnimationManager';
import { CollisionManager } from './CollisionManager';
import { OcclusionManager } from './OcclusionManager';
import { LightingManager } from '../fx/LightingManager';
import { OCCLUDABLE_STEP, GROUND_STEP } from '../rendering/DepthBands';

export interface MapLoaderConfig {
    groundLayerNames: ReadonlySet<string>;
    occludableBaseDepth: number;
}

export interface MapLoadResult {
    map: Phaser.Tilemaps.Tilemap;
    lightingManager: LightingManager;
    groundLayers: Phaser.Tilemaps.TilemapLayer[];
}

type ObjectTilesetBinding = {
    name: string;
    firstGid: number;
    lastGid: number;
    tileWidth: number;
    tileHeight: number;
    tileOffsetX: number;
    tileOffsetY: number;
    columns: number;
    margin: number;
    spacing: number;
    textureKey?: string;
    tileImages?: Map<number, { textureKey: string; width: number; height: number }>;
};

type LayerDepthPlan = {
    depthByLayerName: Map<string, number[]>;
    occlusionOrderByLayerName: Map<string, number[]>;
};

/**
 * Handles map loading, tileset management, and layer creation
 */
export class MapLoader {
    private scene: Phaser.Scene;
    private config: MapLoaderConfig;
    
    private map?: Phaser.Tilemaps.Tilemap;
    private mapKey?: string;
    private lightingManager?: LightingManager;
    private tileAnimationManager?: TileAnimationManager;
    private groundLayers: Phaser.Tilemaps.TilemapLayer[] = [];

    constructor(scene: Phaser.Scene, config: MapLoaderConfig) {
        this.scene = scene;
        this.config = config;
    }

    /**
     * Preload map JSON file
     */
    preloadMap(mapFile: string): string {
        const mapKey = `map-${mapFile.replace('.tmj', '')}`;
        this.scene.load.tilemapTiledJSON(mapKey, `/maps/${mapFile}`);
        return mapKey;
    }

    /**
     * Load map and tilesets, then build layers
     * Returns a promise that resolves when map is fully loaded
     */
    loadMap(
        mapKey: string,
        collisionManager: CollisionManager,
        occlusionManager: OcclusionManager,
        onComplete: (result: MapLoadResult) => void
    ) {
        this.mapKey = mapKey;
        const mapCache = this.scene.cache.tilemap.get(mapKey);
        const mapData = mapCache?.data as {
            tilesets?: TiledTilesetData[];
            layers?: Array<{
                type?: string;
                objects?: Array<{ gid?: number }>;
            }>;
        } | undefined;
        this.map = this.scene.make.tilemap({ key: mapKey });

        const tilesets = mapData?.tilesets || [];
        const objectGidsInUse = new Set<number>();
        (mapData?.layers || []).forEach((layer) => {
            if (layer.type !== 'objectgroup') return;
            (layer.objects || []).forEach((obj) => {
                const raw = Number(obj.gid);
                if (!Number.isFinite(raw) || raw <= 0) return;
                const FLIP_H = 0x80000000;
                const FLIP_V = 0x40000000;
                const FLIP_D = 0x20000000;
                const gid = (raw >>> 0) & ~(FLIP_H | FLIP_V | FLIP_D);
                if (gid > 0) objectGidsInUse.add(gid);
            });
        });
        const tilesetKeys: TilesetEntry[] = [];
        const toLoad: string[] = [];

        const tilesetPadding = 2;

        tilesets.forEach((tileset: TiledTilesetData) => {
            const key = `tileset-${tileset.name}`;
            if (!this.scene.textures.exists(key) && tileset.image) {
                const paddedImage = tileset.image.startsWith('Tilesets/')
                    ? tileset.image.replace('Tilesets/', 'Tilesets_padded/')
                    : tileset.image;
                const url = encodeURI(`/maps/${paddedImage}`);
                this.scene.load.image(key, url);
                toLoad.push(key);
            }

            if (Array.isArray(tileset.tiles)) {
                for (const tile of tileset.tiles) {
                    if (!tile.image) continue;
                    const tileGid = tileset.firstgid + tile.id;
                    if (!objectGidsInUse.has(tileGid)) continue;
                    const imageKey = `tileset-${tileset.name}-tile-${tile.id}`;
                    if (this.scene.textures.exists(imageKey)) continue;
                    const imageUrl = encodeURI(`/maps/${tile.image}`);
                    this.scene.load.image(imageKey, imageUrl);
                    toLoad.push(imageKey);
                }
            }

            const usePadding = tileset.image?.startsWith('Tilesets/');
            tilesetKeys.push({ tileset, key, padding: usePadding ? tilesetPadding : 0 });
        });

        if (toLoad.length > 0) {
            this.scene.load.once('complete', () => {
                this.buildLayers(tilesetKeys, collisionManager, occlusionManager);
                onComplete(this.getResult());
            });
            this.scene.load.start();
        } else {
            this.buildLayers(tilesetKeys, collisionManager, occlusionManager);
            onComplete(this.getResult());
        }
    }

    /**
     * Build all map layers and setup managers
     */
    private buildLayers(
        tilesetKeys: TilesetEntry[],
        collisionManager: CollisionManager,
        occlusionManager: OcclusionManager
    ) {
        if (!this.map) return;

        // Ensure tileset textures use nearest filtering to reduce seams
        tilesetKeys.forEach(({ key }) => {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
            }
        });

        // Initialize lighting manager first
        this.lightingManager = new LightingManager(this.scene);
        this.lightingManager.setupFromMap(this.map);

        // Add tilesets to map
        const phaserTilesets = tilesetKeys
            .map(({ tileset, key, padding }) => {
                const pad = padding ?? 0;
                const margin = (tileset.margin ?? 0) + pad;
                const spacing = (tileset.spacing ?? 0) + pad * 2;
                return this.map!.addTilesetImage(
                    tileset.name,
                    key,
                    tileset.tilewidth,
                    tileset.tileheight,
                    margin,
                    spacing
                );
            })
            .filter((ts): ts is Phaser.Tilemaps.Tileset => ts !== null);

        const depthPlan = this.buildLayerDepthPlan();
        let groundDepthIndex = 0;
        let occludableDepthIndex = 0;
        this.groundLayers = [];

        // Create tile layers
        this.map.layers.forEach((layerData) => {
            const layer = this.map!.createLayer(layerData.name, phaserTilesets, 0, 0);
            if (!layer) return;

            // Enable lighting on all tile layers
            this.lightingManager?.enableLightingOn(layer);

            const plannedDepths = depthPlan.depthByLayerName.get(layerData.name);
            const plannedDepth = plannedDepths && plannedDepths.length > 0
                ? plannedDepths.shift()
                : undefined;

            if (this.config.groundLayerNames.has(layerData.name)) {
                const depth = plannedDepth ?? (groundDepthIndex * GROUND_STEP);
                layer.setDepth(depth);
                groundDepthIndex += 1;
                // Track ground layers for water detection
                this.groundLayers.push(layer);
            } else {
                const baseDepth = plannedDepth ?? (this.config.occludableBaseDepth + occludableDepthIndex * OCCLUDABLE_STEP);
                layer.setDepth(baseDepth);

                const plannedOcclusionOrders = depthPlan.occlusionOrderByLayerName.get(layerData.name);
                const occlusionOrder = plannedOcclusionOrders && plannedOcclusionOrders.length > 0
                    ? (plannedOcclusionOrders.shift() as number)
                    : occludableDepthIndex;

                // Register with occlusion manager
                occlusionManager.addOccludableLayer(layer, baseDepth, layerData.name, occlusionOrder);
                occludableDepthIndex += 1;
            }
        });

        this.renderObjectTileLayers(tilesetKeys, depthPlan, groundDepthIndex, occludableDepthIndex, occlusionManager);

        // Setup collision and occlusion from object layers
        collisionManager.setupFromObjectLayers(this.map);
        occlusionManager.setupFromObjectLayers(this.map);
        
        // Generate border from ground layers if map has Border Pad property
        collisionManager.setupGeneratedBorder(this.map, this.groundLayers, this.mapKey!);

        // Setup tile animations
        this.tileAnimationManager = new TileAnimationManager();
        this.tileAnimationManager.setup(this.map, tilesetKeys);
    }

    private renderObjectTileLayers(
        tilesetKeys: TilesetEntry[],
        depthPlan: LayerDepthPlan,
        groundDepthStart: number,
        occludableDepthStart: number,
        occlusionManager: OcclusionManager
    ) {
        if (!this.map) return;

        const objectLayers = this.map.objects as TiledObjectLayer[];
        if (!Array.isArray(objectLayers) || objectLayers.length === 0) return;

        const bindings: ObjectTilesetBinding[] = tilesetKeys
            .map((entry) => {
                const tileWidth = entry.tileset.tilewidth ?? this.map!.tileWidth;
                const tileHeight = entry.tileset.tileheight ?? this.map!.tileHeight;
                const tileCount = Number.isFinite(entry.tileset.tilecount)
                    ? Number(entry.tileset.tilecount)
                    : (Array.isArray(entry.tileset.tiles)
                        ? Math.max(0, ...entry.tileset.tiles.map((tile) => tile.id + 1))
                        : 0);

                const tileImages = new Map<number, { textureKey: string; width: number; height: number }>();
                if (Array.isArray(entry.tileset.tiles)) {
                    for (const tile of entry.tileset.tiles) {
                        if (!tile.image) continue;
                        const gid = entry.tileset.firstgid + tile.id;
                        tileImages.set(gid, {
                            textureKey: `tileset-${entry.tileset.name}-tile-${tile.id}`,
                            width: tile.imagewidth ?? tileWidth,
                            height: tile.imageheight ?? tileHeight
                        });
                    }
                }

                const lastGid = entry.tileset.firstgid + Math.max(0, tileCount - 1);

                return {
                    name: entry.tileset.name,
                    firstGid: entry.tileset.firstgid,
                    lastGid,
                    tileWidth,
                    tileHeight,
                    tileOffsetX: entry.tileset.tileoffset?.x ?? 0,
                    tileOffsetY: entry.tileset.tileoffset?.y ?? 0,
                    columns: Math.max(0, entry.tileset.columns ?? 0),
                    margin: entry.tileset.margin ?? 0,
                    spacing: entry.tileset.spacing ?? 0,
                    textureKey: entry.tileset.image ? entry.key : undefined,
                    tileImages: tileImages.size > 0 ? tileImages : undefined
                };
            })
            .filter((value) => Number.isFinite(value.firstGid) && Number.isFinite(value.lastGid))
            .sort((a, b) => b.firstGid - a.firstGid);

        let groundDepthIndex = groundDepthStart;
        let occludableDepthIndex = occludableDepthStart;

        for (const layer of objectLayers) {
            const tileObjects = (layer.objects || []).filter((obj) => Number.isFinite(obj.gid));
            if (tileObjects.length === 0) continue;

            let layerDepth = 0;
            let layerOcclusionOrder = -1;
            const plannedDepths = depthPlan.depthByLayerName.get(layer.name);
            if (plannedDepths && plannedDepths.length > 0) {
                layerDepth = plannedDepths.shift() as number;
            } else {
                if (this.config.groundLayerNames.has(layer.name)) {
                    layerDepth = groundDepthIndex * GROUND_STEP;
                    groundDepthIndex += 1;
                } else {
                    layerDepth = this.config.occludableBaseDepth + occludableDepthIndex * OCCLUDABLE_STEP;
                    occludableDepthIndex += 1;
                }
            }

            // Resolve occlusion order for non-ground object groups
            const isGroundLayer = this.config.groundLayerNames.has(layer.name);
            if (!isGroundLayer) {
                const plannedOcclusionOrders = depthPlan.occlusionOrderByLayerName.get(layer.name);
                layerOcclusionOrder = (plannedOcclusionOrders && plannedOcclusionOrders.length > 0)
                    ? (plannedOcclusionOrders.shift() as number)
                    : occludableDepthIndex - 1;
            }

            if ((layer as unknown as { visible?: boolean }).visible === false) {
                continue;
            }

            // Collect images for this layer so we can register them as an
            // occludable object group after the loop.
            const layerImages: Phaser.GameObjects.Image[] = [];

            for (const obj of tileObjects) {
                if (obj.visible === false) continue;
                const gidRaw = Number(obj.gid) >>> 0;

                const FLIP_H = 0x80000000;
                const FLIP_V = 0x40000000;
                const FLIP_D = 0x20000000;
                const gid = gidRaw & ~(FLIP_H | FLIP_V | FLIP_D);
                if (!gid) continue;

                const binding = bindings.find((item) => gid >= item.firstGid && gid <= item.lastGid);
                if (!binding) continue;

                const imageTile = binding.tileImages?.get(gid);
                const imageTextureKey = imageTile?.textureKey ?? binding.textureKey;
                if (!imageTextureKey || !this.scene.textures.exists(imageTextureKey)) continue;

                const localId = gid - binding.firstGid;
                let frameName: string | undefined;
                if (!imageTile) {
                    frameName = `objtile-${binding.name}-${localId}`;
                    const texture = this.scene.textures.get(imageTextureKey);
                    if (texture && !texture.has(frameName)) {
                        if (binding.columns <= 0) {
                            continue;
                        }

                        const col = localId % binding.columns;
                        const row = Math.floor(localId / binding.columns);
                        const sourceX = binding.margin + col * (binding.tileWidth + binding.spacing);
                        const sourceY = binding.margin + row * (binding.tileHeight + binding.spacing);
                        texture.add(frameName, 0, sourceX, sourceY, binding.tileWidth, binding.tileHeight);
                    }
                }

                const image = this.scene.add.image(
                    obj.x - binding.tileOffsetX,
                    obj.y + binding.tileOffsetY,
                    imageTextureKey,
                    frameName
                );
                image.setOrigin(0, 1);

                const displayWidth = obj.width && obj.width > 0
                    ? obj.width
                    : (imageTile?.width ?? binding.tileWidth);
                const displayHeight = obj.height && obj.height > 0
                    ? obj.height
                    : (imageTile?.height ?? binding.tileHeight);

                if (!imageTile) {
                    image.setScale(
                        displayWidth / Math.max(1, binding.tileWidth),
                        displayHeight / Math.max(1, binding.tileHeight)
                    );
                } else {
                    image.setDisplaySize(displayWidth, displayHeight);
                }
                image.setDepth(layerDepth);

                const flipH = obj.flippedHorizontal === true || (obj.flippedHorizontal === undefined && (gidRaw & FLIP_H) !== 0);
                const flipV = obj.flippedVertical === true || (obj.flippedVertical === undefined && (gidRaw & FLIP_V) !== 0);
                const flipD = obj.flippedAntiDiagonal === true || (obj.flippedAntiDiagonal === undefined && (gidRaw & FLIP_D) !== 0);
                if (flipH) image.setFlipX(true);
                if (flipV) image.setFlipY(true);
                if (flipD) image.setAngle(image.angle + 90);

                if (Number.isFinite(obj.rotation)) {
                    image.setAngle((obj.rotation as number) + image.angle);
                }

                // Apply scene lighting so object-layer tiles match lit tile layers
                this.lightingManager?.enableLightingOn(image);

                layerImages.push(image);
            }

            // Register non-ground object groups with occlusion manager
            if (!isGroundLayer && layerImages.length > 0 && layerOcclusionOrder >= 0) {
                occlusionManager.addOccludableObjectGroup(layerImages, layerDepth, layer.name, layerOcclusionOrder);
            }
        }
    }

    private buildLayerDepthPlan(): LayerDepthPlan {
        const depthByLayerName = new Map<string, number[]>();
        const occlusionOrderByLayerName = new Map<string, number[]>();

        if (!this.mapKey) {
            return { depthByLayerName, occlusionOrderByLayerName };
        }

        const mapCache = this.scene.cache.tilemap.get(this.mapKey);
        const rawLayers = (mapCache?.data?.layers || []) as Array<{
            name?: string;
            type?: string;
            visible?: boolean;
        }>;

        let groundOrder = 0;
        let occludableOrder = 0;
        for (const rawLayer of rawLayers) {
            const layerName = rawLayer.name;
            if (!layerName) continue;
            const isTileLayer = rawLayer.type === 'tilelayer';
            const isRenderableObjectTileLayer =
                rawLayer.type === 'objectgroup'
                && rawLayer.visible !== false
                && Array.isArray((rawLayer as any).objects)
                && (rawLayer as any).objects.some((obj: { gid?: number }) => Number.isFinite(obj.gid) && Number(obj.gid) !== 0);

            if (!isTileLayer && !isRenderableObjectTileLayer) continue;

            if (this.config.groundLayerNames.has(layerName)) {
                const depth = groundOrder++ * GROUND_STEP;
                const depthBucket = depthByLayerName.get(layerName) || [];
                depthBucket.push(depth);
                depthByLayerName.set(layerName, depthBucket);
                continue;
            }

            const depth = this.config.occludableBaseDepth + occludableOrder * OCCLUDABLE_STEP;
            const depthBucket = depthByLayerName.get(layerName) || [];
            depthBucket.push(depth);
            depthByLayerName.set(layerName, depthBucket);

            const orderBucket = occlusionOrderByLayerName.get(layerName) || [];
            orderBucket.push(occludableOrder);
            occlusionOrderByLayerName.set(layerName, orderBucket);

            occludableOrder += 1;
        }

        return { depthByLayerName, occlusionOrderByLayerName };
    }

    private getResult(): MapLoadResult {
        return {
            map: this.map!,
            lightingManager: this.lightingManager!,
            groundLayers: this.groundLayers
        };
    }

    getMap(): Phaser.Tilemaps.Tilemap | undefined {
        return this.map;
    }

    getLightingManager(): LightingManager | undefined {
        return this.lightingManager;
    }

    getTileAnimationManager(): TileAnimationManager | undefined {
        return this.tileAnimationManager;
    }

    getGroundLayers(): Phaser.Tilemaps.TilemapLayer[] {
        return this.groundLayers;
    }

    /**
     * Update tile animations
     */
    update(delta: number) {
        this.tileAnimationManager?.update(delta);
    }

    destroy() {
        this.lightingManager?.destroy();
    }
}
