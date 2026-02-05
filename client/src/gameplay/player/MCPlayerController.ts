/**
 * MCPlayerController - Player controller specifically for the Main Character (cat)
 * 
 * This is a variant of PlayerController that uses the MCAnimationController
 * and handles the MC-specific requirements like:
 * - Different frame dimensions per direction
 * - Asymmetric hitbox alignment for E/W directions
 * - Character appearance customization
 */

import Phaser from 'phaser';
import { TiledObjectLayer } from '../map/TiledTypes';
import { MCAnimationController } from './MCAnimationController';
import { PlayerShadow } from './PlayerShadow';
import { MobileControls } from '../ui/MobileControls';
import { DesktopInteractButton } from '../ui/DesktopInteractButton';
import { NetworkManager } from '../network/NetworkManager';
import { createChatBubble, createNameplate, getOcclusionAdjustedDepth } from './PlayerVisualUtils';
import { currentUser } from '../index';
import { GuiSwirlEffect } from '../fx/GuiSwirlEffect';
import { InteractionManager, InteractionType } from '../interaction/InteractionManager';
import { DroppedItemManager } from '../items/DroppedItemManager';
import { RemotePlayerManager } from './RemotePlayerManager';
import { OcclusionManager } from '../map/OcclusionManager';
import { ICharacterAppearance, DEFAULT_CHARACTER_APPEARANCE, MC_FRAME_DIMENSIONS } from '@cfwk/shared';

export type MCPlayerControllerConfig = {
    speed?: number;
    sprintSpeed?: number;
    accel?: number;
    drag?: number;
    depth?: number;
    scale?: number;
    occlusionManager?: OcclusionManager | undefined;
    maxStamina?: number;
    staminaDrainRate?: number;
    staminaRegenRate?: number;
    staminaRegenDelay?: number;
};

/**
 * Manages MC player spawning, movement, and physics
 */
export class MCPlayerController {
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
    private desktopInteractButton?: DesktopInteractButton;
    private contactNormals: Phaser.Math.Vector2[] = [];
    private spawnPoint?: Phaser.Math.Vector2;
    private animationController: MCAnimationController;
    private shadow?: PlayerShadow;
    private chatBubble?: Phaser.GameObjects.Container;
    private chatBubbleYOffset: number = 0;
    private chatTimer?: Phaser.Time.TimerEvent;

    private config: Required<Omit<MCPlayerControllerConfig, 'occlusionManager'>> & { occlusionManager?: OcclusionManager };

    // Character appearance
    private characterAppearance: ICharacterAppearance = DEFAULT_CHARACTER_APPEARANCE;
    private isInitialized = false;

    // Track last movement direction for animations
    private currentRotation = Math.PI / 2; // Facing down

    // Sprint and stamina state
    private stamina = 1;
    private isSprinting = false;
    private staminaRegenTimer = 0;
    private isStaminaDepleted = false;

    // Network sync
    private networkManager = NetworkManager.getInstance();
    private lastSyncedX = 0;
    private lastSyncedY = 0;
    private lastSyncedAnim = '';
    private lastSyncedDirection = -1;
    private syncTimer = 0;
    private readonly syncInterval = 50;

    // AFK tracking
    private lastActivityTime = 0;
    private isAfk = false;
    private readonly afkThreshold = 60000;
    private afkKickThreshold = 300000;
    private afkAlpha = 1;
    private afkKicked = false;
    private afkOverlayContainer?: Phaser.GameObjects.Container;
    private afkOverlayShadow?: Phaser.GameObjects.Image;
    private afkOverlayBg?: Phaser.GameObjects.Image;
    private afkOverlayTitle?: Phaser.GameObjects.Text;
    private afkOverlayInfo?: Phaser.GameObjects.Text;
    private afkOverlayCountdown?: Phaser.GameObjects.Text;
    private afkOverlayNote?: Phaser.GameObjects.Text;
    private afkOverlayTextureKey?: string;
    private afkOverlayTextureCounter = 0;
    private guiEffect?: GuiSwirlEffect;

    // Interaction system
    private interactionManager: InteractionManager;
    private interactKey?: Phaser.Input.Keyboard.Key;
    private mobileInteractListener?: () => void;
    private interactionLockUntil = 0;

    // Local nameplate
    private localNameplate?: Phaser.GameObjects.Container;
    private nameplateYOffset = -36;

    // External speed modifier
    private speedMultiplier = 1.0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private _occlusionManager?: OcclusionManager;

    // MC-specific: hitbox dimensions (consistent regardless of visual size)
    private readonly hitboxWidth = 16;
    private readonly collidableHeight = 6; // Bottom portion for collision

    constructor(scene: Phaser.Scene, config: MCPlayerControllerConfig = {}) {
        this.scene = scene;
        this.config = {
            speed: config.speed ?? 1.6,
            sprintSpeed: config.sprintSpeed ?? 3.2,
            accel: config.accel ?? 0.35,
            drag: config.drag ?? 0.5,
            depth: config.depth ?? 260,
            scale: config.scale ?? 1.2,
            occlusionManager: config.occlusionManager,
            maxStamina: config.maxStamina ?? 1,
            staminaDrainRate: config.staminaDrainRate ?? 0.3,
            staminaRegenRate: config.staminaRegenRate ?? 0.25,
            staminaRegenDelay: config.staminaRegenDelay ?? 1.0
        };

        this._occlusionManager = config.occlusionManager;

        this.animationController = new MCAnimationController(scene, {
            walkFrameRate: 10,
            scale: this.config.scale
        });

        this.interactionManager = new InteractionManager();

        this.guiEffect = new GuiSwirlEffect(this.scene);
        this.lastActivityTime = Date.now();

        // Premium AFK timer (20 minutes)
        if (currentUser?.isPremium) {
            this.afkKickThreshold = 1200000;
        }

    }

    /**
     * Initialize the character with appearance data
     * This must be called before spawn() and will composite all character layers
     */
    async initialize(appearance?: ICharacterAppearance): Promise<void> {
        if (appearance) {
            this.characterAppearance = appearance;
        }

        await this.animationController.initialize(this.characterAppearance);
        
        this.setupInput();
        this.setupCollisionTracking();
        
        this.isInitialized = true;
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
     * Set external speed multiplier
     */
    setSpeedMultiplier(multiplier: number) {
        this.speedMultiplier = Math.max(0, Math.min(1, multiplier));
    }

    /**
     * Get current speed multiplier
     */
    getSpeedMultiplier(): number {
        return this.speedMultiplier;
    }

    /**
     * Set shadow visibility (hide when player is in water)
     */
    setShadowVisible(visible: boolean) {
        this.shadow?.setVisible(visible);
    }

    /**
     * Spawn the player at a spawn point defined in the map
     */
    spawn(map: Phaser.Tilemaps.Tilemap): Phaser.Physics.Matter.Sprite {
        if (!this.isInitialized) {
            throw new Error('MCPlayerController must be initialized before spawning. Call initialize() first.');
        }

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

        const { scale, depth } = this.config;
        
        // Get initial frame dimensions (south-facing)
        const initialDimensions = MC_FRAME_DIMENSIONS['S'];
        const scaledWidth = initialDimensions.width * scale;
        const scaledHeight = initialDimensions.height * scale;
        const scaledCollidableHeight = this.collidableHeight * scale;

        // Create the player sprite
        const player = this.scene.matter.add.sprite(
            spawnX,
            spawnY - scaledCollidableHeight / 2,
            this.animationController.getInitialTextureKey()
        );

        player.setDisplaySize(scaledWidth, scaledHeight);
        
        // Create hitbox - always based on the 16x27 base dimensions
        const hitboxW = this.hitboxWidth * scale;
        const hitboxH = scaledCollidableHeight;
        player.setRectangle(hitboxW, hitboxH, { isStatic: false });

        // Origin at bottom center for proper grounding
        const originY = 1 - hitboxH / (2 * scaledHeight);
        player.setOrigin(0.5, originY);
        player.setFixedRotation();
        player.setFriction(0);
        player.setFrictionStatic(0);
        player.setFrictionAir(0);
        player.setDepth(depth);

        // Start with walk animation (we'll add idle later)
        const initialAnimKey = this.animationController.getInitialAnimationKey();
        if (this.scene.anims.exists(initialAnimKey)) {
            player.play(initialAnimKey);
        }

        this.player = player;

        // Initialize shadow
        this.shadow = new PlayerShadow(this.scene, player);

        // Local nameplate
        this.createLocalNameplate();

        // Send initial position to server
        const x = Math.round(spawnX);
        const y = Math.round(spawnY - scaledCollidableHeight / 2);
        this.networkManager.sendPosition(x, y);
        this.networkManager.sendAnimation('walk', this.animationController.getDirection());
        this.lastSyncedX = x;
        this.lastSyncedY = y;
        this.lastSyncedAnim = 'walk';
        this.lastSyncedDirection = this.animationController.getDirection();

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
    update(delta: number) {
        if (!this.player?.body) return;

        // Update interaction manager with player position
        this.interactionManager.updateLocalPlayer(
            this.player.x,
            this.player.y,
            this.currentRotation
        );
        this.interactionManager.update();

        // Update local nameplate position
        if (this.localNameplate) {
            this.localNameplate.setPosition(this.player.x, this.player.y + this.nameplateYOffset);
        }

        // Check for interact key press
        if (this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
            this.tryInteract();
        }

        // Skip movement if locked (during interact animation)
        if (this.scene.time.now < this.interactionLockUntil) {
            return;
        }

        // Check GUI and chat state
        const guiOpen = this.scene.registry.get('guiOpen') === true;
        const chatFocused = this.scene.registry.get('chatFocused') === true;
        const inputBlocked = guiOpen || chatFocused;

        // Get input from keyboard and mobile
        const mobileInput = this.mobileControls?.getInputState();
        let moveUp = false, moveDown = false, moveLeft = false, moveRight = false;
        let wantSprint = false;

        if (!inputBlocked) {
            moveUp = this.cursors?.up?.isDown || this.wasd?.up?.isDown || mobileInput?.up || false;
            moveDown = this.cursors?.down?.isDown || this.wasd?.down?.isDown || mobileInput?.down || false;
            moveLeft = this.cursors?.left?.isDown || this.wasd?.left?.isDown || mobileInput?.left || false;
            moveRight = this.cursors?.right?.isDown || this.wasd?.right?.isDown || mobileInput?.right || false;
            wantSprint = this.shiftKey?.isDown || mobileInput?.sprint || false;
        }

        // Calculate target velocity
        let targetVx = 0, targetVy = 0;
        if (moveUp) targetVy -= 1;
        if (moveDown) targetVy += 1;
        if (moveLeft) targetVx -= 1;
        if (moveRight) targetVx += 1;

        // Normalize diagonal movement
        const len = Math.hypot(targetVx, targetVy);
        if (len > 0) {
            targetVx /= len;
            targetVy /= len;
        }

        // Handle stamina and sprinting
        const hasInput = len > 0;
        this.updateStamina(delta, wantSprint, hasInput);

        // Calculate speed
        let speed = this.config.speed;
        if (this.isSprinting) {
            speed = this.config.sprintSpeed;
        }
        speed *= this.speedMultiplier;

        // Apply movement
        targetVx *= speed;
        targetVy *= speed;

        const body = this.player.body as MatterJS.BodyType;
        const currentVx = body.velocity.x;
        const currentVy = body.velocity.y;
        const { accel, drag } = this.config;

        let newVx = currentVx;
        let newVy = currentVy;

        if (Math.abs(targetVx) > 0.01 || Math.abs(targetVy) > 0.01) {
            newVx = currentVx + (targetVx - currentVx) * accel;
            newVy = currentVy + (targetVy - currentVy) * accel;
        } else {
            newVx = currentVx * (1 - drag);
            newVy = currentVy * (1 - drag);
        }

        this.player.setVelocity(newVx, newVy);

        // Update rotation for animation
        if (hasInput) {
            this.currentRotation = Math.atan2(targetVy, targetVx);
        }

        // Update animation controller
        this.animationController.setSprinting(this.isSprinting);
        this.animationController.update(this.player, targetVx, targetVy, this.currentRotation);

        // Update sprite origin based on direction (for asymmetric E/W visuals)
        this.updateSpriteOriginForDirection();

        // Update shadow
        this.shadow?.update();

        // Update chat bubble position to follow player
        if (this.chatBubble && this.player) {
            this.chatBubble.setPosition(this.player.x, this.player.y - this.chatBubbleYOffset);
        }

        // Update depth sorting with occlusion awareness
        const feetY = this.player.getBottomLeft().y;
        const depth = getOcclusionAdjustedDepth(
            this._occlusionManager,
            this.player.x,
            feetY,
            this.config.depth ?? 260
        );
        this.player.setDepth(depth);

        // Update GUI swirl effect
        this.guiEffect?.update(this.player.x, this.player.y);

        // Network sync
        this.syncTimer += delta;
        if (this.syncTimer >= this.syncInterval) {
            this.syncTimer = 0;
            this.syncPositionIfNeeded();
        }

        // Update AFK tracking
        if (hasInput) {
            this.lastActivityTime = Date.now();
            if (this.isAfk) {
                this.exitAfkState();
            }
        }
        this.checkAfkState(delta);
    }

    /**
     * Update sprite origin to handle asymmetric E/W visuals
     * When facing E/W, the sprite is 19px wide but hitbox is 16px
     */
    private updateSpriteOriginForDirection() {
        if (!this.player) return;

        const dimensions = this.animationController.getCurrentFrameDimensions();
        const { scale } = this.config;
        const scaledWidth = dimensions.width * scale;
        const scaledHeight = dimensions.height * scale;
        const scaledCollidableHeight = this.collidableHeight * scale;

        // Update display size for current direction
        this.player.setDisplaySize(scaledWidth, scaledHeight);

        // Calculate origin Y (hitbox at bottom)
        const originY = 1 - scaledCollidableHeight / (2 * scaledHeight);

        // Calculate origin X offset for E/W directions
        // The cape adds 3px on the back of the character
        if (dimensions.width > this.hitboxWidth) {
            const extraWidth = dimensions.width - this.hitboxWidth;
            const extraScaled = extraWidth * scale;
            
            if (this.animationController.isFacingEast()) {
                // Cape on left (back), shift origin left so hitbox stays centered on sprite center
                const originX = 0.5 + (extraScaled / 2) / scaledWidth;
                this.player.setOrigin(originX, originY);
            } else if (this.animationController.isFacingWest()) {
                // Flipped: cape on right, shift origin right
                const originX = 0.5 - (extraScaled / 2) / scaledWidth;
                this.player.setOrigin(originX, originY);
            } else {
                this.player.setOrigin(0.5, originY);
            }
        } else {
            this.player.setOrigin(0.5, originY);
        }
    }

    /**
     * Update stamina
     */
    private updateStamina(delta: number, wantSprint: boolean, hasInput: boolean) {
        const dt = delta / 1000;

        // Determine if actually sprinting
        const canSprint = this.stamina > 0 && !this.isStaminaDepleted;
        this.isSprinting = wantSprint && hasInput && canSprint;

        if (this.isSprinting) {
            this.stamina -= this.config.staminaDrainRate * dt;
            this.staminaRegenTimer = this.config.staminaRegenDelay;

            if (this.stamina <= 0) {
                this.stamina = 0;
                this.isStaminaDepleted = true;
                this.isSprinting = false;
            }
        } else {
            if (this.staminaRegenTimer > 0) {
                this.staminaRegenTimer -= dt;
            } else {
                this.stamina = Math.min(this.config.maxStamina, this.stamina + this.config.staminaRegenRate * dt);
                if (this.stamina >= this.config.maxStamina * 0.2) {
                    this.isStaminaDepleted = false;
                }
            }
        }

        this.stamina = Math.max(0, Math.min(this.config.maxStamina, this.stamina));
        this.scene.registry.set('stamina', this.stamina);
    }

    /**
     * Sync position to server
     */
    private syncPositionIfNeeded() {
        if (!this.player) return;

        const x = Math.round(this.player.x);
        const y = Math.round(this.player.y);
        const anim = this.animationController.getAnimation();
        const direction = this.animationController.getDirection();

        const positionChanged = x !== this.lastSyncedX || y !== this.lastSyncedY;
        const animChanged = anim !== this.lastSyncedAnim || direction !== this.lastSyncedDirection;

        if (positionChanged) {
            this.networkManager.sendPosition(x, y);
            this.lastSyncedX = x;
            this.lastSyncedY = y;
        }

        if (animChanged) {
            this.networkManager.sendAnimation(anim, direction);
            this.lastSyncedAnim = anim;
            this.lastSyncedDirection = direction;
        }
    }

    /**
     * Setup input handlers
     */
    private setupInput() {
        this.cursors = this.scene.input.keyboard?.createCursorKeys();
        this.wasd = this.scene.input.keyboard?.addKeys({
            up: 'W',
            down: 'S',
            left: 'A',
            right: 'D'
        }) as typeof this.wasd;
        this.shiftKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

        // Interact key (F)
        this.interactKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F);

        // Initialize mobile controls
        this.mobileControls = new MobileControls();

        // Initialize desktop interact button
        this.desktopInteractButton = new DesktopInteractButton();

        // Connect controls to interaction system
        this.interactionManager.onInteractionChange((interaction) => {
            this.mobileControls?.setAvailableInteraction(interaction);
            this.desktopInteractButton?.setAvailableInteraction(interaction);
        });

        // Listen for mobile interact button press
        this.mobileInteractListener = () => {
            this.tryInteract();
        };
        window.addEventListener('mobile:interact', this.mobileInteractListener);
    }

    /**
     * Setup collision tracking
     */
    private setupCollisionTracking() {
        this.scene.matter.world.on('collisionstart', (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
            for (const pair of event.pairs) {
                if (pair.bodyA === this.player?.body || pair.bodyB === this.player?.body) {
                    const normal = new Phaser.Math.Vector2(pair.collision.normal.x, pair.collision.normal.y);
                    this.contactNormals.push(normal);
                }
            }
        });

        this.scene.matter.world.on('collisionend', (event: Phaser.Physics.Matter.Events.CollisionEndEvent) => {
            for (const pair of event.pairs) {
                if (pair.bodyA === this.player?.body || pair.bodyB === this.player?.body) {
                    const normal = new Phaser.Math.Vector2(pair.collision.normal.x, pair.collision.normal.y);
                    const idx = this.contactNormals.findIndex(n => n.equals(normal));
                    if (idx !== -1) {
                        this.contactNormals.splice(idx, 1);
                    }
                }
            }
        });
    }

    /**
     * Try to execute interaction
     */
    private tryInteract() {
        const chatFocused = this.scene.registry.get('chatFocused') === true;
        const guiOpen = this.scene.registry.get('guiOpen') === true;
        if (chatFocused || guiOpen) return;

        if (this.scene.time.now < this.interactionLockUntil) return;

        const interaction = this.interactionManager.getCurrentInteraction();
        if (!interaction) return;

        this.playInteractAnimation();
        if (interaction.type === InteractionType.Shove && interaction.targetSessionId) {
            this.networkManager.sendShoveAttempt(interaction.targetSessionId);

            const frameDelayMs = this.animationController.getInteractFrameDurationMs();
            this.scene.time.delayedCall(frameDelayMs, () => {
                this.interactionManager.executeInteraction();
            });
        } else {
            this.interactionManager.executeInteraction();
        }
    }

    /**
     * Play interact animation
     */
    playInteractAnimation() {
        if (!this.player) return;
        const durationMs = this.animationController.playInteract(this.player, this.currentRotation);
        this.interactionLockUntil = this.scene.time.now + durationMs;
    }

    /**
     * Set remote player manager
     */
    setRemotePlayerManager(manager: RemotePlayerManager) {
        this.interactionManager.setRemotePlayerManager(manager);
    }

    /**
     * Set dropped item manager for pickup interactions
     */
    setDroppedItemManager(manager: DroppedItemManager) {
        this.interactionManager.setDroppedItemManager(manager);
    }

    /**
     * Set occlusion manager
     */
    setOcclusionManager(manager: OcclusionManager) {
        this._occlusionManager = manager;
    }

    /**
     * Get mobile controls
     */
    getMobileControls(): MobileControls | undefined {
        return this.mobileControls;
    }

    /**
     * Get desktop interact button
     */
    getDesktopInteractButton(): DesktopInteractButton | undefined {
        return this.desktopInteractButton;
    }

    /**
     * Check if moving
     */
    getIsMoving(): boolean {
        if (!this.player?.body) return false;
        const velocity = this.player.body.velocity as MatterJS.Vector;
        return Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1;
    }

    /**
     * Check if sprinting
     */
    getIsSprinting(): boolean {
        return this.isSprinting;
    }

    /**
     * Get current stamina
     */
    getStamina(): number {
        return this.stamina;
    }

    /**
     * Show chat bubble (alias for showChatBubble)
     */
    showChat(message: string) {
        if (!this.player) return;

        if (this.chatBubble) {
            this.chatBubble.destroy();
            this.chatBubble = undefined;
        }
        if (this.chatTimer) {
            this.chatTimer.remove(false);
            this.chatTimer = undefined;
        }

        const bubble = createChatBubble({
            scene: this.scene,
            message,
            depth: 99999
        });

        const yOffset = 36 + 10 + (bubble.height / 2);
        this.chatBubbleYOffset = yOffset;
        this.chatBubble = bubble.container;
        this.chatBubble.setPosition(this.player.x, this.player.y - yOffset);

        // Auto destroy with fade
        this.chatTimer = this.scene.time.delayedCall(4000, () => {
            if (this.chatBubble) {
                this.scene.tweens.add({
                    targets: this.chatBubble,
                    alpha: 0,
                    duration: 300,
                    onComplete: () => {
                        this.chatBubble?.destroy();
                        this.chatBubble = undefined;
                    }
                });
            }
        });
    }

    /**
     * AFK state management
     */
    private checkAfkState(_delta: number) {
        const timeSinceActivity = Date.now() - this.lastActivityTime;

        if (!this.isAfk && timeSinceActivity > this.afkThreshold) {
            this.enterAfkState();
        }

        if (this.isAfk && !this.afkKicked && timeSinceActivity > this.afkKickThreshold) {
            this.handleAfkKick();
        }

        if (this.isAfk && this.player) {
            const targetAlpha = 0.3;
            this.afkAlpha = Phaser.Math.Linear(this.afkAlpha, targetAlpha, 0.05);
            this.player.setAlpha(this.afkAlpha);
            this.shadow?.setAlpha(this.afkAlpha);

            // Show AFK overlay with countdown
            const remainingMs = Math.max(0, this.afkKickThreshold - timeSinceActivity);
            this.showAfkOverlay(remainingMs);
        } else {
            this.hideAfkOverlay();
        }
    }

    private showAfkOverlay(remainingMs: number) {
        const uiScene = this.scene.scene.get('UIScene') as Phaser.Scene | undefined;
        if (!uiScene) return;

        const frameWidth = 320;
        const frameHeight = 170;
        const border = 4;
        const padding = 14;

        if (!this.afkOverlayContainer) {
            const textureKey = this.createNineSliceTexture(uiScene, 'ui-afk-frame', frameWidth, frameHeight, border, 3);
            this.afkOverlayTextureKey = textureKey;

            this.afkOverlayShadow = uiScene.add.image(0, 0, textureKey).setOrigin(0.5, 0.5);
            this.afkOverlayShadow.setTint(0x000000);
            this.afkOverlayShadow.setAlpha(0.5);
            this.afkOverlayShadow.setPosition(3, 4);

            this.afkOverlayBg = uiScene.add.image(0, 0, textureKey).setOrigin(0.5, 0.5);
            this.afkOverlayTitle = uiScene.add.text(0, 0, 'AFK WARNING', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '18px',
                color: '#f2f2f2'
            }).setOrigin(0, 0);

            this.afkOverlayInfo = uiScene.add.text(0, 0, 'Move or press any key to stay in-game.', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '12px',
                color: '#d8d8d8'
            }).setOrigin(0, 0);

            this.afkOverlayCountdown = uiScene.add.text(0, 0, 'Disconnect in 0:00', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '16px',
                color: '#ff8b8b'
            }).setOrigin(0, 0);

            this.afkOverlayNote = uiScene.add.text(0, 0, 'Tip: Shark rank extends AFK time to 20 min.', {
                fontFamily: 'Minecraft, monospace',
                fontSize: '11px',
                color: '#b9b9b9'
            }).setOrigin(0, 0);

            this.afkOverlayContainer = uiScene.add.container(0, 0, [
                this.afkOverlayShadow,
                this.afkOverlayBg,
                this.afkOverlayTitle,
                this.afkOverlayInfo,
                this.afkOverlayCountdown,
                this.afkOverlayNote
            ]);
            this.afkOverlayContainer.setDepth(9998);
            this.afkOverlayContainer.setScrollFactor(0);
        }

        const totalSeconds = Math.ceil(remainingMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        this.afkOverlayCountdown?.setText(`Disconnect in ${minutes}:${seconds.toString().padStart(2, '0')}`);

        if (this.afkOverlayContainer && this.afkOverlayBg && this.afkOverlayTitle && this.afkOverlayInfo && this.afkOverlayCountdown && this.afkOverlayNote) {
            const centerX = uiScene.cameras.main.centerX;
            const centerY = uiScene.cameras.main.centerY - 40;
            this.afkOverlayContainer.setPosition(centerX, centerY);
            this.afkOverlayContainer.setVisible(true);

            const left = -frameWidth / 2 + padding;
            const top = -frameHeight / 2 + padding;
            this.afkOverlayTitle.setPosition(left, top);
            this.afkOverlayInfo.setPosition(left, top + 28);
            this.afkOverlayCountdown.setPosition(left, top + 62);
            this.afkOverlayNote.setPosition(left, top + frameHeight - padding - 26);
        }
    }

    private hideAfkOverlay() {
        if (this.afkOverlayContainer) {
            this.afkOverlayContainer.setVisible(false);
        }
    }

    private createNineSliceTexture(scene: Phaser.Scene, key: string, width: number, height: number, border: number, scale: number = 1) {
        const srcTexture = scene.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = Math.floor(srcImage.width * scale);
        const srcH = Math.floor(srcImage.height * scale);
        const scaledBorder = Math.floor(border * scale);
        const outBorder = scaledBorder;

        const centerSrcW = srcW - scaledBorder * 2;
        const centerSrcH = srcH - scaledBorder * 2;
        const centerW = Math.max(1, width - outBorder * 2);
        const centerH = Math.max(1, height - outBorder * 2);

        const rtKey = `__afk_nineslice_${this.afkOverlayTextureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = srcW;
        srcCanvas.height = srcH;
        const srcCtx = srcCanvas.getContext('2d')!;
        srcCtx.imageSmoothingEnabled = false;
        srcCtx.drawImage(srcImage, 0, 0, srcW, srcH);

        // Top row
        ctx.drawImage(srcCanvas, 0, 0, scaledBorder, scaledBorder, 0, 0, outBorder, outBorder);
        ctx.drawImage(srcCanvas, scaledBorder, 0, centerSrcW, scaledBorder, outBorder, 0, centerW, outBorder);
        ctx.drawImage(srcCanvas, srcW - scaledBorder, 0, scaledBorder, scaledBorder, outBorder + centerW, 0, outBorder, outBorder);

        // Middle row
        ctx.drawImage(srcCanvas, 0, scaledBorder, scaledBorder, centerSrcH, 0, outBorder, outBorder, centerH);
        ctx.drawImage(srcCanvas, scaledBorder, scaledBorder, centerSrcW, centerSrcH, outBorder, outBorder, centerW, centerH);
        ctx.drawImage(srcCanvas, srcW - scaledBorder, scaledBorder, scaledBorder, centerSrcH, outBorder + centerW, outBorder, outBorder, centerH);

        // Bottom row
        ctx.drawImage(srcCanvas, 0, srcH - scaledBorder, scaledBorder, scaledBorder, 0, outBorder + centerH, outBorder, outBorder);
        ctx.drawImage(srcCanvas, scaledBorder, srcH - scaledBorder, centerSrcW, scaledBorder, outBorder, outBorder + centerH, centerW, outBorder);
        ctx.drawImage(srcCanvas, srcW - scaledBorder, srcH - scaledBorder, scaledBorder, scaledBorder, outBorder + centerW, outBorder + centerH, outBorder, outBorder);

        scene.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private createLocalNameplate() {
        if (!this.player) return;

        const os = this.scene.sys.game.device.os;
        const isMobile = os.android || os.iOS || os.iPad || os.iPhone || os.windowsPhone;
        const fontSize = isMobile ? '10px' : '6px';
        this.nameplateYOffset = isMobile ? -42 : -36;

        const displayName = currentUser?.username || 'You';

        const nameplate = createNameplate({
            scene: this.scene,
            text: displayName,
            isPremium: currentUser?.isPremium,
            fontSize,
            yOffset: this.nameplateYOffset,
            depth: (this.config.depth ?? 260) + 1000
        });

        this.localNameplate = nameplate.container;
        this.localNameplate.setPosition(this.player.x, this.player.y + this.nameplateYOffset);
    }

    private enterAfkState() {
        this.isAfk = true;
        this.networkManager.sendAfk(true);
    }

    private exitAfkState() {
        this.isAfk = false;
        this.afkAlpha = 1;
        this.player?.setAlpha(1);
        this.shadow?.setAlpha(1);
        this.networkManager.sendAfk(false);
        this.hideAfkOverlay();
    }

    private handleAfkKick() {
        this.afkKicked = true;
        localStorage.setItem('cfwk_afk', 'true');
        window.location.href = '/game?location=limbo';
    }

    /**
     * Get character appearance
     */
    getCharacterAppearance(): ICharacterAppearance {
        return this.characterAppearance;
    }

    /**
     * Clean up
     */
    destroy() {
        if (this.chatBubble) {
            this.chatBubble.destroy();
        }
        if (this.chatTimer) {
            this.chatTimer.remove(false);
        }
        this.localNameplate?.destroy();
        if (this.mobileInteractListener) {
            window.removeEventListener('mobile:interact', this.mobileInteractListener);
        }
        this.mobileControls?.destroy();
        this.desktopInteractButton?.destroy();
        this.shadow?.destroy();
        this.guiEffect?.destroy();
        this.interactionManager?.destroy();
        this.animationController?.destroy();
        this.afkOverlayContainer?.destroy(true);
        if (this.afkOverlayTextureKey && this.scene.textures.exists(this.afkOverlayTextureKey)) {
            this.scene.textures.remove(this.afkOverlayTextureKey);
        }
    }
}
