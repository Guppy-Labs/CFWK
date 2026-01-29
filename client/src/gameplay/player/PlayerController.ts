import Phaser from 'phaser';
import { TiledObjectLayer } from '../map/TiledTypes';

export type PlayerControllerConfig = {
    speed?: number;
    accel?: number;
    drag?: number;
    width?: number;
    height?: number;
    textureKey?: string;
    depth?: number;
};

/**
 * Manages player spawning, movement, and physics
 */
export class PlayerController {
    private scene: Phaser.Scene;
    private player?: Phaser.Physics.Matter.Sprite;
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    private wasd?: {
        up: Phaser.Input.Keyboard.Key;
        down: Phaser.Input.Keyboard.Key;
        left: Phaser.Input.Keyboard.Key;
        right: Phaser.Input.Keyboard.Key;
    };
    private contactNormals: Phaser.Math.Vector2[] = [];
    private spawnPoint?: Phaser.Math.Vector2;

    private config: Required<PlayerControllerConfig>;

    constructor(scene: Phaser.Scene, config: PlayerControllerConfig = {}) {
        this.scene = scene;
        this.config = {
            speed: config.speed ?? 2.2,
            accel: config.accel ?? 0.18,
            drag: config.drag ?? 0.7,
            width: config.width ?? 22,
            height: config.height ?? 44,
            textureKey: config.textureKey ?? 'player-front',
            depth: config.depth ?? 260
        };

        this.setupInput();
        this.setupCollisionTracking();
    }

    /**
     * Get the player sprite
     */
    getPlayer(): Phaser.Physics.Matter.Sprite | undefined {
        return this.player;
    }

    /**
     * Get the spawn point
     */
    getSpawnPoint(): Phaser.Math.Vector2 | undefined {
        return this.spawnPoint;
    }

    /**
     * Spawn the player at a spawn point defined in the map
     */
    spawn(map: Phaser.Tilemaps.Tilemap): Phaser.Physics.Matter.Sprite {
        const objectLayers = map.objects as TiledObjectLayer[];
        let spawnX = 64;
        let spawnY = 64;

        for (const layer of objectLayers) {
            if (layer.type !== 'objectgroup') continue;
            for (const obj of layer.objects) {
                const isSpawn = obj.properties?.some((p) => p.name === 'Is Spawnpoint' && p.value === true);
                if (isSpawn || obj.name?.toLowerCase() === 'spawn') {
                    spawnX = obj.x;
                    spawnY = obj.y;
                    break;
                }
            }
        }

        this.spawnPoint = new Phaser.Math.Vector2(spawnX, spawnY);

        const { width, height, textureKey, depth } = this.config;
        const collidableHeight = height / 6;

        const player = this.scene.matter.add.sprite(
            spawnX,
            spawnY - collidableHeight / 2,
            textureKey
        );

        player.setDisplaySize(width, height);
        player.setRectangle(width, collidableHeight, { isStatic: false });

        const originY = 1 - collidableHeight / (2 * height);
        player.setOrigin(0.5, originY);
        player.setFixedRotation();
        player.setFriction(0);
        player.setFrictionStatic(0);
        player.setFrictionAir(0);
        player.setDepth(depth);

        this.player = player;
        return player;
    }

    /**
     * Set the player's depth
     */
    setDepth(depth: number) {
        this.player?.setDepth(depth);
    }

    /**
     * Update player movement based on input
     */
    update() {
        if (!this.player) return;

        const body = this.player.body as MatterJS.BodyType | undefined;
        if (!body) return;

        const inputLeft = this.cursors?.left?.isDown || this.wasd?.left.isDown;
        const inputRight = this.cursors?.right?.isDown || this.wasd?.right.isDown;
        const inputUp = this.cursors?.up?.isDown || this.wasd?.up.isDown;
        const inputDown = this.cursors?.down?.isDown || this.wasd?.down.isDown;

        let vx = 0;
        let vy = 0;
        if (inputLeft) vx -= 1;
        if (inputRight) vx += 1;
        if (inputUp) vy -= 1;
        if (inputDown) vy += 1;

        const { speed, accel, drag } = this.config;

        if (vx !== 0 || vy !== 0) {
            const len = Math.hypot(vx, vy) || 1;
            vx = (vx / len) * speed;
            vy = (vy / len) * speed;

            // Remove velocity components that push into walls
            if (this.contactNormals.length > 0) {
                this.contactNormals.forEach((normal) => {
                    const dot = vx * normal.x + vy * normal.y;
                    if (dot < 0) {
                        vx -= dot * normal.x;
                        vy -= dot * normal.y;
                    }
                });
            }

            const current = this.player!.body?.velocity as MatterJS.Vector | undefined;
            const targetX = (current?.x || 0) * (1 - accel) + vx * accel;
            const targetY = (current?.y || 0) * (1 - accel) + vy * accel;

            this.player!.setVelocity(targetX, targetY);
        } else {
            const current = this.player!.body?.velocity as MatterJS.Vector | undefined;
            this.player!.setVelocity((current?.x || 0) * drag, (current?.y || 0) * drag);
        }
    }

    private setupInput() {
        this.cursors = this.scene.input.keyboard?.createCursorKeys();
        this.wasd = this.scene.input.keyboard?.addKeys({
            up: 'W',
            down: 'S',
            left: 'A',
            right: 'D'
        }) as typeof this.wasd;
    }

    private setupCollisionTracking() {
        this.scene.matter.world.on('beforeupdate', () => {
            this.contactNormals = [];
        });

        this.scene.matter.world.on('collisionactive', (event: Phaser.Physics.Matter.Events.CollisionActiveEvent) => {
            if (!this.player?.body) return;
            const playerBody = this.player.body as MatterJS.BodyType;

            event.pairs.forEach((pair) => {
                const bodyA = pair.bodyA as MatterJS.BodyType;
                const bodyB = pair.bodyB as MatterJS.BodyType;
                if (bodyA !== playerBody && bodyB !== playerBody) return;

                const normal = pair.collision.normal;
                const nx = bodyA === playerBody ? normal.x : -normal.x;
                const ny = bodyA === playerBody ? normal.y : -normal.y;
                this.contactNormals.push(new Phaser.Math.Vector2(nx, ny));
            });
        });
    }
}
