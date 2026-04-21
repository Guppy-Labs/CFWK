import Phaser from 'phaser';
import { LightingManager } from './LightingManager';
import { TiledMapObject, TiledObjectLayer, getTiledProperty } from '../map/TiledTypes';

const WALL_LIGHT_TEXTURE_KEY = '__wall-light-falloff';
const DEFAULT_LIGHT_RADIUS = 180;
const DEFAULT_LIGHT_INTENSITY = 0.45;
const DEFAULT_LIGHT_COLOR = 0xffe585;
const FEATHER_PIXELS = 18;
const DEPTH_EPSILON = 0.01;

type WallLightBand = {
    x: number;
    y: number;
    radius: number;
    intensity: number;
    color: number;
    subtractDepth: number;
    addDepth: number;
};

type WallLightSpritePair = {
    addSprite: Phaser.GameObjects.Image;
    subtractSprite: Phaser.GameObjects.Image;
    baseIntensity: number;
    flickerPhase: number;
    flickerSpeed: number;
};

/**
 * Projects wall-light falloff in map-authorized polygons only.
 *
 * Implementation detail:
 * - A SUBTRACT pass below the base layer "cancels" light from lower layers.
 * - An ADD pass above the targeted top layer restores light for allowed layers.
 * - Both passes are geometry-masked to the LightDescriptors polygons.
 */
export class WallLightSystem {
    private static cachedSubtractBlendModeId?: number;
    private scene: Phaser.Scene;
    private lightingManager?: LightingManager;
    private maskImage: Phaser.GameObjects.Image;
    private descriptorMask: Phaser.Display.Masks.BitmapMask;
    private subtractBlendModeId?: number;
    private sprites: WallLightSpritePair[] = [];
    private elapsedMs = 0;

    private constructor(
        scene: Phaser.Scene,
        descriptorPolygons: Phaser.Math.Vector2[][],
        bands: WallLightBand[],
        lightingManager?: LightingManager
    ) {
        this.scene = scene;
        this.lightingManager = lightingManager;
        this.subtractBlendModeId = this.resolveSubtractBlendModeId();

        this.ensureFalloffTexture();

        this.maskImage = this.buildFeatheredMaskImage(descriptorPolygons);
        this.descriptorMask = this.maskImage.createBitmapMask();

        this.sprites = bands.map((band) => this.createSpritePair(band));
    }

    static createFromMap(
        scene: Phaser.Scene,
        map: Phaser.Tilemaps.Tilemap,
        lightingManager?: LightingManager
    ): WallLightSystem | undefined {
        const descriptorPolygons = this.extractDescriptorPolygons(map);
        if (descriptorPolygons.length === 0) {
            return undefined;
        }

        const layerDepthsByName = this.collectTileLayerDepths(map);
        if (layerDepthsByName.size === 0) {
            return undefined;
        }

        const orderedDepths = Array.from(new Set(layerDepthsByName.values())).sort((a, b) => a - b);
        const highestDepth = orderedDepths[orderedDepths.length - 1];
        const wallLightPoints = this.extractWallLightPoints(map);
        const bands: WallLightBand[] = [];

        for (const point of wallLightPoints) {
            const baseNameRaw = getTiledProperty(point, 'Base');
            const baseLayerName = typeof baseNameRaw === 'string' ? baseNameRaw.trim() : '';
            if (!baseLayerName) {
                continue;
            }

            const baseDepth = this.lookupLayerDepth(layerDepthsByName, baseLayerName);
            if (baseDepth === undefined || !Number.isFinite(baseDepth)) {
                console.warn(`[WallLightSystem] Ignoring WallLight with unknown Base layer "${baseLayerName}".`);
                continue;
            }

            const maxNameRaw = getTiledProperty(point, 'Max');
            const maxLayerName = typeof maxNameRaw === 'string' ? maxNameRaw.trim() : '';
            let topAffectedDepth = highestDepth;
            if (maxLayerName) {
                const maxDepth = this.lookupLayerDepth(layerDepthsByName, maxLayerName);
                if (maxDepth === undefined || !Number.isFinite(maxDepth)) {
                    console.warn(`[WallLightSystem] WallLight Max layer "${maxLayerName}" not found; using top map layer.`);
                } else {
                    const eligibleDepths = orderedDepths.filter((depth) => depth >= baseDepth && depth <= maxDepth);
                    if (eligibleDepths.length === 0) {
                        console.warn(`[WallLightSystem] WallLight band invalid (Base="${baseLayerName}", Max="${maxLayerName}").`);
                        continue;
                    }
                    topAffectedDepth = eligibleDepths[eligibleDepths.length - 1];
                }
            } else {
                const eligibleDepths = orderedDepths.filter((depth) => depth >= baseDepth);
                if (eligibleDepths.length === 0) continue;
                topAffectedDepth = eligibleDepths[eligibleDepths.length - 1];
            }

            const x = Number(point.x ?? 0) + Number(point.width ?? 0) * 0.5;
            const y = Number(point.y ?? 0) + Number(point.height ?? 0) * 0.5;
            const radius = this.parsePositiveNumber(getTiledProperty(point, 'Radius'), DEFAULT_LIGHT_RADIUS);
            const intensity = Phaser.Math.Clamp(
                this.parsePositiveNumber(getTiledProperty(point, 'Intensity'), DEFAULT_LIGHT_INTENSITY),
                0.05,
                1.4
            );
            const color = this.parseColor(getTiledProperty(point, 'Color')) ?? DEFAULT_LIGHT_COLOR;

            bands.push({
                x,
                y,
                radius,
                intensity,
                color,
                subtractDepth: baseDepth - DEPTH_EPSILON,
                addDepth: topAffectedDepth + DEPTH_EPSILON
            });
        }

        if (bands.length === 0) {
            return undefined;
        }

        return new WallLightSystem(scene, descriptorPolygons, bands, lightingManager);
    }

    update(deltaMs: number) {
        this.elapsedMs += deltaMs;

        const ambientBrightness = this.lightingManager?.getAmbientBrightness() ?? 1;
        const ambientScale = Phaser.Math.Clamp(1 - Math.pow(ambientBrightness, 0.62) * 0.82, 0.16, 1);

        for (const entry of this.sprites) {
            const t = this.elapsedMs * entry.flickerSpeed + entry.flickerPhase;
            const flicker = 1 + Math.sin(t) * 0.05 + Math.sin(t * 1.73) * 0.03;
            const alpha = Phaser.Math.Clamp(entry.baseIntensity * ambientScale * flicker, 0.02, 0.94);

            entry.addSprite.setAlpha(alpha);
            entry.subtractSprite.setAlpha(alpha * 0.98);
        }
    }

    destroy() {
        this.sprites.forEach((entry) => {
            entry.addSprite.clearMask(false);
            entry.subtractSprite.clearMask(false);
            entry.addSprite.destroy();
            entry.subtractSprite.destroy();
        });
        this.sprites = [];
        this.descriptorMask.destroy();
        this.maskImage.destroy();
    }

    private ensureFalloffTexture() {
        if (this.scene.textures.exists(WALL_LIGHT_TEXTURE_KEY)) {
            return;
        }

        const size = 512;
        const canvasTexture = this.scene.textures.createCanvas(WALL_LIGHT_TEXTURE_KEY, size, size);
        if (!canvasTexture) {
            return;
        }
        const ctx = canvasTexture.getContext();
        const center = size * 0.5;
        const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.08, 'rgba(255, 255, 255, 0.82)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.48)');
        gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.18)');
        gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.04)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        canvasTexture.refresh();
    }

    private buildFeatheredMaskImage(polygons: Phaser.Math.Vector2[][]): Phaser.GameObjects.Image {
        const mapKeys = this.scene.cache.tilemap.getKeys();
        let mapW = 2048;
        let mapH = 2048;
        if (mapKeys.length > 0) {
            const cached = this.scene.cache.tilemap.get(mapKeys[0]);
            if (cached?.data) {
                const d = cached.data;
                mapW = (d.width ?? 64) * (d.tilewidth ?? 32);
                mapH = (d.height ?? 64) * (d.tileheight ?? 32);
            }
        }

        const texKey = '__wall-light-mask-rt';
        if (this.scene.textures.exists(texKey)) {
            this.scene.textures.remove(texKey);
        }

        const rt = this.scene.textures.createCanvas(texKey, mapW, mapH);
        if (!rt) {
            const fallback = this.scene.add.image(0, 0, WALL_LIGHT_TEXTURE_KEY);
            fallback.setVisible(false);
            return fallback;
        }
        const ctx = rt.getContext();

        const blurRadius = Math.max(1, Math.round(FEATHER_PIXELS * 0.5));
        ctx.filter = `blur(${blurRadius}px)`;
        ctx.fillStyle = 'rgba(255,255,255,1)';
        for (const polygon of polygons) {
            if (polygon.length < 3) continue;
            ctx.beginPath();
            ctx.moveTo(polygon[0].x, polygon[0].y);
            for (let i = 1; i < polygon.length; i += 1) {
                ctx.lineTo(polygon[i].x, polygon[i].y);
            }
            ctx.closePath();
            ctx.fill();
        }

        rt.refresh();

        const image = this.scene.add.image(0, 0, texKey);
        image.setOrigin(0, 0);
        image.setVisible(false);
        return image;
    }

    private createSpritePair(band: WallLightBand): WallLightSpritePair {
        const addSprite = this.scene.add.image(band.x, band.y, WALL_LIGHT_TEXTURE_KEY);
        addSprite.setDisplaySize(band.radius * 2, band.radius * 2);
        addSprite.setBlendMode(Phaser.BlendModes.ADD);
        addSprite.setTint(band.color);
        addSprite.setDepth(band.addDepth);
        addSprite.setMask(this.descriptorMask);

        const subtractSprite = this.scene.add.image(band.x, band.y, WALL_LIGHT_TEXTURE_KEY);
        subtractSprite.setDisplaySize(band.radius * 2, band.radius * 2);
        if (this.subtractBlendModeId !== undefined) {
            subtractSprite.setBlendMode(this.subtractBlendModeId);
        } else {
            subtractSprite.setBlendMode(Phaser.BlendModes.MULTIPLY);
        }
        subtractSprite.setTint(band.color);
        subtractSprite.setDepth(band.subtractDepth);
        subtractSprite.setMask(this.descriptorMask);

        const basePhase = Math.random() * Math.PI * 2;
        return {
            addSprite,
            subtractSprite,
            baseIntensity: band.intensity,
            flickerPhase: basePhase,
            flickerSpeed: 0.0025 + Math.random() * 0.0018
        };
    }

    private static extractWallLightPoints(map: Phaser.Tilemaps.Tilemap): TiledMapObject[] {
        const poiLayer = map.getObjectLayer('POI') as TiledObjectLayer | null;
        if (!poiLayer || !Array.isArray(poiLayer.objects)) return [];
        return poiLayer.objects.filter((obj) =>
            obj.visible !== false
            && String(obj.name || '').trim().toLowerCase() === 'walllight'
        );
    }

    private static extractDescriptorPolygons(map: Phaser.Tilemaps.Tilemap): Phaser.Math.Vector2[][] {
        const descriptorLayer = map.getObjectLayer('LightDescriptors') as TiledObjectLayer | null;
        if (!descriptorLayer || !Array.isArray(descriptorLayer.objects)) return [];

        const polygons: Phaser.Math.Vector2[][] = [];
        for (const object of descriptorLayer.objects) {
            if (object.visible === false) continue;

            if (Array.isArray(object.polygon) && object.polygon.length >= 3) {
                polygons.push(
                    object.polygon.map((point) => new Phaser.Math.Vector2(
                        Number(object.x ?? 0) + Number(point.x ?? 0),
                        Number(object.y ?? 0) + Number(point.y ?? 0)
                    ))
                );
                continue;
            }

            const width = Number(object.width ?? 0);
            const height = Number(object.height ?? 0);
            if (width > 0 && height > 0) {
                const x = Number(object.x ?? 0);
                const y = Number(object.y ?? 0);
                polygons.push([
                    new Phaser.Math.Vector2(x, y),
                    new Phaser.Math.Vector2(x + width, y),
                    new Phaser.Math.Vector2(x + width, y + height),
                    new Phaser.Math.Vector2(x, y + height)
                ]);
            }
        }

        return polygons;
    }

    private static collectTileLayerDepths(map: Phaser.Tilemaps.Tilemap): Map<string, number> {
        const depths = new Map<string, number>();
        for (const layerData of map.layers) {
            const layer = (layerData as Phaser.Tilemaps.LayerData & { tilemapLayer?: Phaser.Tilemaps.TilemapLayer }).tilemapLayer;
            if (!layer || !Number.isFinite(layer.depth)) continue;
            depths.set(layerData.name, layer.depth);
            depths.set(layerData.name.toLowerCase(), layer.depth);
        }
        return depths;
    }

    private static lookupLayerDepth(depths: Map<string, number>, layerName: string): number | undefined {
        const exact = depths.get(layerName);
        if (exact !== undefined) return exact;
        return depths.get(layerName.toLowerCase());
    }

    private static parsePositiveNumber(value: unknown, fallback: number): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
        return parsed;
    }

    private static parseColor(value: unknown): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Phaser.Math.Clamp(Math.floor(value), 0, 0xffffff);
        }

        if (typeof value !== 'string') return undefined;
        const raw = value.trim();
        if (!raw) return undefined;

        const normalized = raw.startsWith('#')
            ? raw.slice(1)
            : raw.startsWith('0x') || raw.startsWith('0X')
                ? raw.slice(2)
                : raw;
        if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return undefined;
        const parsed = Number.parseInt(normalized, 16);
        if (!Number.isFinite(parsed)) return undefined;
        return parsed;
    }

    private resolveSubtractBlendModeId(): number | undefined {
        if (WallLightSystem.cachedSubtractBlendModeId !== undefined) {
            return WallLightSystem.cachedSubtractBlendModeId;
        }

        const renderer = this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
        const gl = renderer?.gl;
        if (!renderer || !gl || typeof renderer.addBlendMode !== 'function') {
            return undefined;
        }

        try {
            WallLightSystem.cachedSubtractBlendModeId = renderer.addBlendMode(
                [gl.ONE, gl.ONE],
                gl.FUNC_REVERSE_SUBTRACT
            );
            return WallLightSystem.cachedSubtractBlendModeId;
        } catch (error) {
            console.warn('[WallLightSystem] Unable to create subtract blend mode, using MULTIPLY fallback.', error);
            return undefined;
        }
    }
}
