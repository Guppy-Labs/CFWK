import Phaser from 'phaser';
import { TiledObjectLayer } from '../map/TiledTypes';
import { PlayerAnimationController } from './PlayerAnimationController';
import { PlayerShadow } from './PlayerShadow';
import { MobileControls } from '../ui/MobileControls';
import { NetworkManager } from '../network/NetworkManager';
import { currentUser } from '../index';

/**
 * Generates a consistent color from a string (user ID)
 */
function hashToColor(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    
    // Generate HSL values for nice colors
    const hue = Math.abs(hash) % 360;
    const saturation = 60 + (Math.abs(hash >> 8) % 30); // 60-90%
    const lightness = 55 + (Math.abs(hash >> 16) % 20);  // 55-75%
    
    return Phaser.Display.Color.HSLToColor(hue / 360, saturation / 100, lightness / 100).color;
}

export type PlayerControllerConfig = {
    speed?: number;
    sprintSpeed?: number;
    accel?: number;
    drag?: number;
    width?: number;
    height?: number;
    depth?: number;
    // Stamina config
    maxStamina?: number;
    staminaDrainRate?: number;
    staminaRegenRate?: number;
    staminaRegenDelay?: number;
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
    private shiftKey?: Phaser.Input.Keyboard.Key;
    private mobileControls?: MobileControls;
    private contactNormals: Phaser.Math.Vector2[] = [];
    private spawnPoint?: Phaser.Math.Vector2;
    private animationController: PlayerAnimationController;
    private shadow?: PlayerShadow;

    private config: Required<PlayerControllerConfig>;

    // Track last movement direction for animations
    private lastVx = 0;
    private lastVy = 0;
    private currentRotation = Math.PI / 2; // Facing down

    // Sprint and stamina state
    private stamina = 1; // 0-1 normalized
    private isSprinting = false;
    private staminaRegenTimer = 0; // Time until regen starts
    private isStaminaDepleted = false; // Flag for when stamina hits 0

    // Network sync
    private networkManager = NetworkManager.getInstance();
    private lastSyncedX = 0;
    private lastSyncedY = 0;
    private lastSyncedAnim = '';
    private lastSyncedDirection = -1;
    private syncTimer = 0;
    private readonly syncInterval = 50; // ms between position syncs

    // AFK tracking
    private lastActivityTime = 0;
    private isAfk = false;
    private readonly afkThreshold = 60000; // 1 minute until AFK
    private readonly afkKickThreshold = 300000; // 5 minutes until kick
    private afkAlpha = 1; // Current transparency (1 = fully visible)

    constructor(scene: Phaser.Scene, config: PlayerControllerConfig = {}) {
        this.scene = scene;
        this.config = {
            speed: config.speed ?? 1.6,
            sprintSpeed: config.sprintSpeed ?? 3.2,
            accel: config.accel ?? 0.18,
            drag: config.drag ?? 0.7,
            width: config.width ?? 16,
            height: config.height ?? 32,
            depth: config.depth ?? 260,
            maxStamina: config.maxStamina ?? 1,
            staminaDrainRate: config.staminaDrainRate ?? 0.3, // Per second
            staminaRegenRate: config.staminaRegenRate ?? 0.25, // Per second
            staminaRegenDelay: config.staminaRegenDelay ?? 1.0 // Seconds before regen starts
        };

        this.animationController = new PlayerAnimationController(scene, {
            frameWidth: 16,
            frameHeight: 32,
            idleFrames: 4,
            walkFrames: 4,
            runFrames: 6,
            idleFrameRate: 6,
            walkFrameRate: 8
        });

        this.setupInput();
        this.setupCollisionTracking();
        
        // Initialize activity time
        this.lastActivityTime = Date.now();
    }

    /**
     * Preload player assets (call in scene preload)
     */
    preload() {
        this.animationController.preload();
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
        // Create animations first
        this.animationController.createAnimations();
        
        // Initialize stamina in registry
        this.scene.registry.set('stamina', this.stamina);

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

        const { width, height, depth } = this.config;
        const scale = 1.2;
        const scaledWidth = width * scale;
        const scaledHeight = height * scale;
        const collidableHeight = scaledHeight / 6;

        const player = this.scene.matter.add.sprite(
            spawnX,
            spawnY - collidableHeight / 2,
            this.animationController.getInitialTextureKey()
        );

        // Scale player up by 1.7x
        player.setDisplaySize(scaledWidth, scaledHeight);
        player.setRectangle(scaledWidth, collidableHeight, { isStatic: false });

        // Align sprite so the body sits at the bottom of the visual
        const originY = 1 - collidableHeight / (2 * scaledHeight);
        player.setOrigin(0.5, originY);
        player.setFixedRotation();
        player.setFriction(0);
        player.setFrictionStatic(0);
        player.setFrictionAir(0);
        player.setDepth(depth);

        // Apply color tint based on user ID
        if (currentUser?._id) {
            const playerColor = hashToColor(currentUser._id);
            player.setTint(playerColor);
        }

        // Start idle animation
        player.play(this.animationController.getInitialAnimationKey());

        this.player = player;
        
        // Initialize shadow
        this.shadow = new PlayerShadow(this.scene, player);

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
    update(delta: number = 16.67) {
        if (!this.player) return;

        const body = this.player.body as MatterJS.BodyType | undefined;
        if (!body) return;

        const deltaSeconds = delta / 1000;

        // Get mobile input state
        const mobileInput = this.mobileControls?.getInputState();

        // Combine keyboard and mobile inputs (OR logic)
        const inputLeft = this.cursors?.left?.isDown || this.wasd?.left.isDown || mobileInput?.left;
        const inputRight = this.cursors?.right?.isDown || this.wasd?.right.isDown || mobileInput?.right;
        const inputUp = this.cursors?.up?.isDown || this.wasd?.up.isDown || mobileInput?.up;
        const inputDown = this.cursors?.down?.isDown || this.wasd?.down.isDown || mobileInput?.down;
        const inputSprint = this.shiftKey?.isDown === true || mobileInput?.sprint === true;

        const isMoving = !!(inputLeft || inputRight || inputUp || inputDown);

        // Update stamina and sprint state
        this.updateStamina(deltaSeconds, isMoving, inputSprint);

        // Determine current speed based on sprint state
        const { speed, sprintSpeed, accel, drag } = this.config;
        const currentSpeed = this.isSprinting ? sprintSpeed : speed;

        let vx = 0;
        let vy = 0;
        if (inputLeft) vx -= 1;
        if (inputRight) vx += 1;
        if (inputUp) vy -= 1;
        if (inputDown) vy += 1;

        if (vx !== 0 || vy !== 0) {
            // -- PHYSICS MOMENTUM ROTATION --
            // Instead of instantly snapping velocity to input, we drive velocity by FACING ANGLE.
            
            // 1. Calculate the Target Angle from Input
            const targetAngle = Math.atan2(vy, vx);

            // 2. Determine Turn Rate based on current speed (simulating momentum/inertia)
            const currentVel = this.player!.body?.velocity as MatterJS.Vector;
            const currentSpeedMag = currentVel ? Math.hypot(currentVel.x, currentVel.y) : 0;
            
            let turnRate = 0.4;
            if (currentSpeedMag > 2.0) turnRate = 0.04; // Sprinting/Running turns slow
            else if (currentSpeedMag > 0.5) turnRate = 0.15; // Walking turns average

            // 3. Smoothly rotate our "Physics Facing" towards the Input
            this.currentRotation = Phaser.Math.Angle.RotateTo(this.currentRotation, targetAngle, turnRate);

            // 4. Calculate NEW velocity based on the smoothed rotation
            // This ensures we run "forward" relative to where we are facing
            // creating the arc/slide effect.
            vx = Math.cos(this.currentRotation) * currentSpeed;
            vy = Math.sin(this.currentRotation) * currentSpeed;

            // Track direction for animations (pass input vector for "Intent")
            this.lastVx = vx;
            this.lastVy = vy;

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
            // Decelerate, but keep momentum direction...
            const current = this.player!.body?.velocity as MatterJS.Vector | undefined;
            this.player!.setVelocity((current?.x || 0) * drag, (current?.y || 0) * drag);
        }

        // Update animations based on sprint state
        this.animationController.setSprinting(this.isSprinting);

        // Update animations based on actual velocity
        const actualVelocity = this.player.body?.velocity as MatterJS.Vector | undefined;
        const animVx = actualVelocity?.x ?? 0;
        const animVy = actualVelocity?.y ?? 0;

        // Pass the physics rotation to the animation controller to sync them up
        // We reconstruct the input vector just to signal "intent" to the animator
        let inputX = 0;
        let inputY = 0;
        if (inputLeft) inputX -= 1;
        if (inputRight) inputX += 1;
        if (inputUp) inputY -= 1;
        if (inputDown) inputY += 1;
        
        this.animationController.update(this.player, inputX, inputY, this.currentRotation);

        // Update shadow
        this.shadow?.update();

        // Update AFK state
        this.updateAfkState(isMoving || inputSprint);

        // Sync state to server
        this.syncToServer(delta);
    }

    /**
     * Update AFK state based on activity
     */
    private updateAfkState(hasInput: boolean) {
        if (!this.player) return;

        const now = Date.now();

        // Any input resets the activity timer
        if (hasInput) {
            this.lastActivityTime = now;
            
            // If was AFK, clear it
            if (this.isAfk) {
                this.isAfk = false;
                this.networkManager.sendAfk(false);
                this.afkAlpha = 1;
                this.player.setAlpha(1);
                this.shadow?.setAlpha(1);
            }
            return;
        }

        const idleTime = now - this.lastActivityTime;

        // 5 minute kick
        if (idleTime >= this.afkKickThreshold) {
            console.log('[PlayerController] AFK timeout - disconnecting');
            this.networkManager.disconnect();
            // Redirect to login or show message
            window.location.href = '/login?reason=afk';
            return;
        }

        // 1 minute AFK - go semi-transparent
        if (idleTime >= this.afkThreshold && !this.isAfk) {
            this.isAfk = true;
            this.networkManager.sendAfk(true);
            console.log('[PlayerController] Player is now AFK');
        }

        // Smoothly transition to semi-transparent when AFK
        if (this.isAfk) {
            const targetAlpha = 0.4;
            this.afkAlpha += (targetAlpha - this.afkAlpha) * 0.05;
            this.player.setAlpha(this.afkAlpha);
            this.shadow?.setAlpha(this.afkAlpha);
        }
    }

    /**
     * Sync player state to the server
     */
    private syncToServer(delta: number) {
        if (!this.player) return;

        this.syncTimer += delta;

        const x = Math.round(this.player.x);
        const y = Math.round(this.player.y);
        const anim = this.animationController.getAnimation();
        const direction = this.animationController.getDirection();

        // Sync position at fixed interval or if moved significantly
        const positionChanged = Math.abs(x - this.lastSyncedX) > 1 || Math.abs(y - this.lastSyncedY) > 1;
        
        if (positionChanged && this.syncTimer >= this.syncInterval) {
            this.networkManager.sendPosition(x, y);
            this.lastSyncedX = x;
            this.lastSyncedY = y;
            this.syncTimer = 0;
        }

        // Sync animation/direction immediately when changed
        if (anim !== this.lastSyncedAnim || direction !== this.lastSyncedDirection) {
            this.networkManager.sendAnimation(anim, direction);
            this.lastSyncedAnim = anim;
            this.lastSyncedDirection = direction;
        }
    }

    /**
     * Update stamina based on sprint input
     */
    private updateStamina(deltaSeconds: number, isMoving: boolean, wantsSprint: boolean) {
        const { staminaDrainRate, staminaRegenRate, staminaRegenDelay } = this.config;

        // Can only sprint if moving, wants to sprint, and has stamina (and not in depleted cooldown)
        const canSprint = isMoving && wantsSprint && this.stamina > 0 && !this.isStaminaDepleted;

        if (canSprint) {
            // Sprinting - drain stamina
            this.isSprinting = true;
            this.stamina = Math.max(0, this.stamina - staminaDrainRate * deltaSeconds);

            // Check if stamina just ran out - only then apply the regen delay
            if (this.stamina <= 0) {
                this.isStaminaDepleted = true;
                this.isSprinting = false;
                this.staminaRegenTimer = staminaRegenDelay; // Only delay regen when fully depleted
            }
        } else {
            // Not sprinting
            this.isSprinting = false;

            // Handle regen timer (only active if stamina was fully depleted)
            if (this.staminaRegenTimer > 0) {
                this.staminaRegenTimer -= deltaSeconds;
            } else if (this.stamina < 1) {
                // Regenerate stamina (immediate if not depleted, delayed if depleted)
                this.stamina = Math.min(1, this.stamina + staminaRegenRate * deltaSeconds);

                // Clear depleted flag once we have some stamina back
                if (this.stamina >= 0.2) {
                    this.isStaminaDepleted = false;
                }
            }
        }

        // Update stamina in registry
        this.scene.registry.set('stamina', this.stamina);
    }

    private setupInput() {
        this.cursors = this.scene.input.keyboard?.createCursorKeys();
        this.wasd = this.scene.input.keyboard?.addKeys({
            up: 'W',
            down: 'S',
            left: 'A',
            right: 'D'
        }) as typeof this.wasd;
        this.shiftKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
        
        // Initialize mobile controls (auto-detects touch devices)
        this.mobileControls = new MobileControls();
    }
    
    /**
     * Get mobile controls instance (for external access if needed)
     */
    getMobileControls(): MobileControls | undefined {
        return this.mobileControls;
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
    
    /**
     * Clean up resources
     */
    destroy() {
        this.mobileControls?.destroy();
        this.shadow?.destroy();
    }
}
