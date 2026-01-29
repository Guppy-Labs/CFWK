import Phaser from 'phaser';
import { TiledObjectLayer, getTiledProperty } from './TiledTypes';

// Access Matter.js through Phaser's bundled version
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Matter = (Phaser.Physics.Matter as any).Matter as typeof MatterJS;

/**
 * Manages collision body creation from Tiled map data
 */
export class CollisionManager {
    private scene: Phaser.Scene;
    private bodies: MatterJS.BodyType[] = [];

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    /**
     * Get all collision bodies
     */
    getBodies(): MatterJS.BodyType[] {
        return this.bodies;
    }

    /**
     * Setup collision objects from object layers marked as Collidable
     */
    setupFromObjectLayers(map: Phaser.Tilemaps.Tilemap) {
        const objectLayers = map.objects as TiledObjectLayer[];

        const collisionLayers = objectLayers.filter((layer) => {
            if (layer.type !== 'objectgroup') return false;
            const collidableProp = getTiledProperty(layer, 'Collidable');
            return collidableProp === true || layer.name.toLowerCase().includes('collision');
        });

        collisionLayers.forEach((layer) => {
            layer.objects.forEach((obj) => {
                if (obj.polygon && obj.polygon.length > 0) {
                    this.createPolygonBody(obj.x, obj.y, obj.polygon);
                } else if (obj.width && obj.height) {
                    this.createRectangleBody(
                        obj.x + obj.width / 2,
                        obj.y + obj.height / 2,
                        obj.width,
                        obj.height
                    );
                }
            });
        });

        if (this.bodies.length > 0) {
            (this.scene.matter.world as Phaser.Physics.Matter.World).add(this.bodies);
        }

        (this.scene.matter.world as Phaser.Physics.Matter.World).setBounds(
            0, 0, map.widthInPixels, map.heightInPixels
        );
    }

    /**
     * Setup walkable bounds - create collision for tiles without ground coverage
     */
    setupWalkableBounds(map: Phaser.Tilemaps.Tilemap, groundLayerName: string, edgePadding: number = 9) {
        const groundIndex = map.layers.findIndex((layer) => layer.name === groundLayerName);
        if (groundIndex === -1) return;

        const tileWidth = map.tileWidth;
        const tileHeight = map.tileHeight;

        for (let ty = 0; ty < map.height; ty++) {
            for (let tx = 0; tx < map.width; tx++) {
                let walkable = false;

                for (let i = groundIndex; i < map.layers.length; i++) {
                    const layerName = map.layers[i].name;
                    const tile = map.getTileAt(tx, ty, false, layerName);
                    if (tile && tile.index !== -1) {
                        walkable = true;
                        break;
                    }
                }

                if (!walkable) {
                    const paddedWidth = tileWidth + edgePadding * 2;
                    const paddedHeight = tileHeight + edgePadding * 2;
                    this.createRectangleBody(
                        tx * tileWidth + tileWidth / 2,
                        ty * tileHeight + tileHeight / 2,
                        paddedWidth,
                        paddedHeight
                    );
                }
            }
        }

        if (this.bodies.length > 0) {
            (this.scene.matter.world as Phaser.Physics.Matter.World).add(this.bodies);
        }
    }

    private createPolygonBody(x: number, y: number, polygon: { x: number; y: number }[]) {
        const body = Matter.Bodies.fromVertices(
            x,
            y,
            [polygon],
            { isStatic: true, friction: 0, frictionStatic: 0, frictionAir: 0 },
            true
        );

        if (body && !Array.isArray(body)) {
            // Align polygon body to match Tiled coordinates
            let minPolyX = Infinity;
            let minPolyY = Infinity;
            polygon.forEach((p) => {
                if (p.x < minPolyX) minPolyX = p.x;
                if (p.y < minPolyY) minPolyY = p.y;
            });

            const targetMinX = x + minPolyX;
            const targetMinY = y + minPolyY;
            const currentMinX = body.bounds.min.x;
            const currentMinY = body.bounds.min.y;

            Matter.Body.setPosition(body, {
                x: body.position.x + (targetMinX - currentMinX),
                y: body.position.y + (targetMinY - currentMinY)
            });

            this.bodies.push(body);
        } else if (Array.isArray(body)) {
            this.bodies.push(...body);
        }
    }

    private createRectangleBody(x: number, y: number, width: number, height: number) {
        const body = Matter.Bodies.rectangle(
            x,
            y,
            width,
            height,
            { isStatic: true, friction: 0, frictionStatic: 0, frictionAir: 0 }
        );
        this.bodies.push(body);
    }
}
