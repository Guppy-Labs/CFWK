import Phaser from 'phaser';
import { TiledObjectLayer, getTiledProperty } from './TiledTypes';

// Access Matter.js through Phaser's bundled version
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Matter = (Phaser.Physics.Matter as any).Matter as typeof MatterJS;

/**
 * Represents an inverted collision zone (containment zone)
 * Player cannot leave this region once inside
 */
interface ContainmentZone {
    polygon: Phaser.Geom.Polygon;
    bounds: Phaser.Geom.Rectangle;
}

/**
 * Manages collision body creation from Tiled map data
 */
export class CollisionManager {
    private scene: Phaser.Scene;
    private bodies: MatterJS.BodyType[] = [];
    private containmentZones: ContainmentZone[] = [];

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
     * Get all containment zones (inverted collisions)
     */
    getContainmentZones(): ContainmentZone[] {
        return this.containmentZones;
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
                const isInverted = getTiledProperty(obj, 'Inverted') === true;

                if (obj.polygon && obj.polygon.length > 0) {
                    if (isInverted) {
                        this.createContainmentZone(obj.x, obj.y, obj.polygon);
                    } else {
                        this.createPolygonBody(obj.x, obj.y, obj.polygon);
                    }
                } else if (obj.width && obj.height) {
                    if (isInverted) {
                        // Create containment zone from rectangle
                        const rectPolygon = [
                            { x: 0, y: 0 },
                            { x: obj.width, y: 0 },
                            { x: obj.width, y: obj.height },
                            { x: 0, y: obj.height }
                        ];
                        this.createContainmentZone(obj.x, obj.y, rectPolygon);
                    } else {
                        this.createRectangleBody(
                            obj.x + obj.width / 2,
                            obj.y + obj.height / 2,
                            obj.width,
                            obj.height
                        );
                    }
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

    /**
     * Create a containment zone from a polygon (inverted collision)
     * Player cannot leave this zone once inside
     */
    private createContainmentZone(x: number, y: number, polygon: { x: number; y: number }[]) {
        // Convert to world coordinates
        const worldPoints = polygon.map(p => new Phaser.Geom.Point(x + p.x, y + p.y));
        const phaserPolygon = new Phaser.Geom.Polygon(worldPoints);

        // Calculate bounds for quick rejection tests
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        worldPoints.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        });

        const zone = {
            polygon: phaserPolygon,
            bounds: new Phaser.Geom.Rectangle(minX, minY, maxX - minX, maxY - minY)
        };
        this.containmentZones.push(zone);
        console.log('[CollisionManager] Created containment zone:', { x, y, bounds: zone.bounds, pointCount: worldPoints.length });
    }

    /**
     * Check if a point is inside any containment zone
     */
    isInsideContainmentZone(x: number, y: number): ContainmentZone | null {
        for (const zone of this.containmentZones) {
            // Quick bounds check first
            if (!zone.bounds.contains(x, y)) continue;

            // Precise polygon check
            if (zone.polygon.contains(x, y)) {
                return zone;
            }
        }
        return null;
    }

    // Track previous player position for containment enforcement
    private prevPlayerX = 0;
    private prevPlayerY = 0;

    /**
     * Enforce containment zones on a player sprite
     * Call this each frame with the player to constrain their movement
     */
    enforceContainment(player: Phaser.Physics.Matter.Sprite) {
        const currentX = player.x;
        const currentY = player.y;

        // Only check containment if we have a valid previous position
        if (this.prevPlayerX !== 0 || this.prevPlayerY !== 0) {
            const constrained = this.constrainToContainmentZone(
                this.prevPlayerX,
                this.prevPlayerY,
                currentX,
                currentY
            );

            // If constrained, update position and zero velocity
            if (constrained.x !== currentX || constrained.y !== currentY) {
                player.setPosition(constrained.x, constrained.y);
                player.setVelocity(0, 0);
            }

            // Update tracked position to the final (possibly constrained) position
            this.prevPlayerX = player.x;
            this.prevPlayerY = player.y;
        } else {
            // Initialize previous position
            this.prevPlayerX = currentX;
            this.prevPlayerY = currentY;
        }
    }

    /**
     * Constrain a position to stay inside a containment zone
     * Returns the constrained position
     */
    constrainToContainmentZone(
        currentX: number,
        currentY: number,
        newX: number,
        newY: number
    ): { x: number; y: number } {
        // Check if current position is inside any containment zone
        const zone = this.isInsideContainmentZone(currentX, currentY);
        if (!zone) {
            // Not in a containment zone, allow free movement
            return { x: newX, y: newY };
        }

        // We're in a containment zone - check if new position would leave it
        if (zone.polygon.contains(newX, newY)) {
            // Still inside, allow the move
            return { x: newX, y: newY };
        }

        // New position would leave the zone - find the closest valid position
        // Use binary search along the movement vector to find the edge
        let validX = currentX;
        let validY = currentY;
        let testX = newX;
        let testY = newY;

        // Binary search for the edge (10 iterations is sufficient precision)
        for (let i = 0; i < 10; i++) {
            const midX = (validX + testX) / 2;
            const midY = (validY + testY) / 2;

            if (zone.polygon.contains(midX, midY)) {
                validX = midX;
                validY = midY;
            } else {
                testX = midX;
                testY = midY;
            }
        }

        return { x: validX, y: validY };
    }
}
