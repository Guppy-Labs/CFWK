import Phaser from 'phaser';
import { TiledObjectLayer } from '../map/TiledTypes';
import { PlayerAnimationController } from './PlayerAnimationController';
import { PlayerShadow } from './PlayerShadow';
import { MobileControls } from '../ui/MobileControls';
import { DesktopInteractButton } from '../ui/DesktopInteractButton';
import { NetworkManager } from '../network/NetworkManager';
import { currentUser } from '../index';
import { EmojiMap } from '../ui/EmojiMap';
import { GuiSwirlEffect } from '../fx/GuiSwirlEffect';
import { InteractionManager } from '../interaction/InteractionManager';
import { RemotePlayerManager } from './RemotePlayerManager';
import { OcclusionManager } from '../map/OcclusionManager';

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
    occlusionManager?: OcclusionManager | undefined;
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
    private chatBubble?: Phaser.GameObjects.Container;
    private chatTimer?: Phaser.Time.TimerEvent;

    private config: Required<Omit<PlayerControllerConfig, 'occlusionManager'>> & { occlusionManager?: OcclusionManager };

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
    private afkKickThreshold = 300000; // 5 minutes until kick (default)
    private afkAlpha = 1; // Current transparency (1 = fully visible)
    private afkKicked = false;
    private readonly afkOverlayId = 'cfwk-afk-overlay';
    private guiEffect?: GuiSwirlEffect;
    private isPageHidden = false;

    // Interaction system
    private interactionManager: InteractionManager;
    private interactKey?: Phaser.Input.Keyboard.Key;
    private mobileInteractListener?: () => void;
    private interactionLockUntil = 0;
    private desktopInteractButton?: DesktopInteractButton;

    // Local nameplate
    private localNameplate?: Phaser.GameObjects.Container;
    private localNameText?: Phaser.GameObjects.Text;
    private localNameBg?: Phaser.GameObjects.Graphics;
    private nameplateYOffset = -36;

    // External speed modifier (e.g., from water depth)
    private speedMultiplier = 1.0;
    private occlusionManager?: OcclusionManager;

    constructor(scene: Phaser.Scene, config: PlayerControllerConfig = {}) {
        this.scene = scene;
        this.config = {
            speed: config.speed ?? 1.6,
            sprintSpeed: config.sprintSpeed ?? 3.2,
            accel: config.accel ?? 0.35,
            drag: config.drag ?? 0.5,
            width: config.width ?? 16,
            height: config.height ?? 32,
            depth: config.depth ?? 260,
            occlusionManager: config.occlusionManager,
            maxStamina: config.maxStamina ?? 1,
            staminaDrainRate: config.staminaDrainRate ?? 0.3, // Per second
            staminaRegenRate: config.staminaRegenRate ?? 0.25, // Per second
            staminaRegenDelay: config.staminaRegenDelay ?? 1.0 // Seconds before regen starts
        };

        this.occlusionManager = config.occlusionManager;

        this.animationController = new PlayerAnimationController(scene, {
            frameWidth: 16,
            frameHeight: 32,
            idleFrames: 4,
            walkFrames: 4,
            runFrames: 6,
            idleFrameRate: 6,
            walkFrameRate: 8
        });

        // Initialize interaction system
        this.interactionManager = new InteractionManager();

        this.setupInput();
        this.setupCollisionTracking();

        this.guiEffect = new GuiSwirlEffect(this.scene);
        
        // Initialize activity time
        this.lastActivityTime = Date.now();

        // Premium AFK timer (20 minutes)
        if (currentUser?.isPremium) {
            this.afkKickThreshold = 1200000;
        }

        // Visibility handling (ensure AFK starts even when unfocused)
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        window.addEventListener('blur', this.handleWindowBlur);
        window.addEventListener('focus', this.handleWindowFocus);
    }

    private handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
            this.isPageHidden = true;
            this.forceAfkState();
        } else {
            this.isPageHidden = false;
        }
    };

    private handleWindowBlur = () => {
        this.isPageHidden = true;
        this.forceAfkState();
    };

    private handleWindowFocus = () => {
        this.isPageHidden = false;
    };

    private forceAfkState() {
        if (!this.player || this.isAfk) return;
        this.isAfk = true;
        this.networkManager.sendAfk(true);
        console.log('[PlayerController] AFK forced due to focus loss');
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
     * Set external speed multiplier (e.g., water depth slowdown)
     * @param multiplier 0-1 where 1 is full speed
     */
    setSpeedMultiplier(multiplier: number) {
        this.speedMultiplier = Phaser.Math.Clamp(multiplier, 0.1, 1.0);
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

        // Local nameplate
        this.createLocalNameplate();

        // Immediately send spawn position to server so other clients see correct location
        const x = Math.round(spawnX);
        const y = Math.round(spawnY - collidableHeight / 2);
        this.networkManager.sendPosition(x, y);
        this.networkManager.sendAnimation('idle', this.animationController.getDirection());
        this.lastSyncedX = x;
        this.lastSyncedY = y;
        this.lastSyncedAnim = 'idle';
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
    update(delta: number = 16.67) {
        if (!this.player) return;

        const body = this.player.body as MatterJS.BodyType | undefined;
        if (!body) return;

        const deltaSeconds = delta / 1000;

        // Check if chat or GUI is open - disable game inputs
        const chatFocused = this.scene.registry.get('chatFocused') === true;
        const guiOpen = this.scene.registry.get('guiOpen') === true;
        const isInteractionLocked = this.scene.time.now < this.interactionLockUntil;
        const inputBlocked = chatFocused || guiOpen || isInteractionLocked;

        // Get mobile input state
        const mobileInput = this.mobileControls?.getInputState();

        // Combine keyboard and mobile inputs (OR logic) - but only if chat is not focused
        const inputLeft = !inputBlocked && (this.cursors?.left?.isDown || this.wasd?.left.isDown || mobileInput?.left);
        const inputRight = !inputBlocked && (this.cursors?.right?.isDown || this.wasd?.right.isDown || mobileInput?.right);
        const inputUp = !inputBlocked && (this.cursors?.up?.isDown || this.wasd?.up.isDown || mobileInput?.up);
        const inputDown = !inputBlocked && (this.cursors?.down?.isDown || this.wasd?.down.isDown || mobileInput?.down);
        const inputSprint = !inputBlocked && (this.shiftKey?.isDown === true || mobileInput?.sprint === true);

        const isMoving = !!(inputLeft || inputRight || inputUp || inputDown);

        // Update stamina and sprint state
        this.updateStamina(deltaSeconds, isMoving, inputSprint);

        // Determine current speed based on sprint state and external modifiers
        const { speed, sprintSpeed, accel, drag } = this.config;
        const baseSpeed = this.isSprinting ? sprintSpeed : speed;
        const currentSpeed = baseSpeed * this.speedMultiplier;

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
        
        if (!isInteractionLocked) {
            this.animationController.update(this.player, inputX, inputY, this.currentRotation);
        }

        // Update shadow
        this.shadow?.update();

        // Update chat bubble position
        if (this.chatBubble && this.player) {
            const text = this.chatBubble.list[1] as Phaser.GameObjects.Text;
            const bubbleHeight = text ? text.height + 16 : 40;
            // Position well above head (approx -45px which clears standard sprite height)
            const yOffset = -45 - (bubbleHeight / 2);
            this.chatBubble.setPosition(this.player.x, this.player.y + yOffset);
            this.chatBubble.setDepth(99999);
        }

        // Update Y-based depth sorting (feet position = player.y + 3)
        // Higher Y (lower on screen) = higher depth (drawn in front)
        // Use small multiplier (0.01) to keep depth within safe range for occlusion system
        // Player depth range: ~260-270 (occluded layers start at 280)
            const feetY = this.player.y + 3;
            let yDepth = this.config.depth + (feetY * 0.01);

            if (this.occlusionManager) {
                const occlusionTags = this.occlusionManager.getOcclusionTagsAt(this.player.x, this.player.y, 4);
                if (occlusionTags.size > 0) {
                    const minBase = this.occlusionManager.getMinBaseDepthForTags(occlusionTags);
                    yDepth = (minBase - 10) + (feetY * 0.01);
                }
            }

            this.player.setDepth(yDepth);

        // Update AFK state
        this.updateAfkState(isMoving || inputSprint);

        // GUI/chat open effect
        const shouldShowSwirl = guiOpen || chatFocused;
        this.guiEffect?.setActive(shouldShowSwirl);
        if (shouldShowSwirl) {
            this.guiEffect?.update(this.player.x, this.player.y - 25);
        }

        // Update interaction detection
        this.interactionManager.updateLocalPlayer(this.player.x, this.player.y, this.currentRotation);
        this.interactionManager.update();

        // Update local nameplate position
        if (this.localNameplate) {
            this.localNameplate.setPosition(this.player.x, this.player.y + this.nameplateYOffset);
        }
        
        // Handle E key for interaction
        if (!inputBlocked && Phaser.Input.Keyboard.JustDown(this.interactKey!)) {
            this.tryInteract();
        }

        // Sync state to server
        this.syncToServer(delta);
    }

    /**
     * Update AFK state based on activity
     */
    private updateAfkState(hasInput: boolean) {
        if (!this.player) return;

        const now = Date.now();

        const activitySignal = this.scene.registry.get('afkActivity');
        if (typeof activitySignal === 'number' && activitySignal > this.lastActivityTime) {
            this.lastActivityTime = activitySignal;

            if (this.isAfk) {
                this.isAfk = false;
                this.networkManager.sendAfk(false);
                this.afkAlpha = 1;
                this.player.setAlpha(1);
                this.shadow?.setAlpha(1);
                this.hideAfkOverlay();
            }
        }

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
                this.hideAfkOverlay();
            }
            return;
        }

        const idleTime = now - this.lastActivityTime;

        // 5 minute kick
        if (idleTime >= this.afkKickThreshold && !this.afkKicked) {
            this.afkKicked = true;
            console.log('[PlayerController] AFK timeout - sending to limbo');
            localStorage.setItem('cfwk_afk', 'true');
            this.scene.events.emit('stop-audio');
            this.networkManager.disconnect();
            this.scene.scene.stop('UIScene');
            this.scene.scene.start('BootScene');
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

            const remainingMs = Math.max(0, this.afkKickThreshold - idleTime);
            this.showAfkOverlay(remainingMs);
        } else {
            this.hideAfkOverlay();
        }
    }

    private showAfkOverlay(remainingMs: number) {
        let overlay = document.getElementById(this.afkOverlayId);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = this.afkOverlayId;
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.background = 'rgba(0, 0, 0, 0.55)';
            overlay.style.zIndex = '9998';
            overlay.style.pointerEvents = 'none';
            overlay.style.fontFamily = 'Minecraft, monospace';
            overlay.style.color = '#ffffff';
            overlay.style.fontSize = '64px';
            overlay.style.textShadow = '4px 4px 0 #000';
            document.body.appendChild(overlay);
        }

        const totalSeconds = Math.ceil(remainingMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        overlay.innerHTML = `
            <div style="text-align:center;">
                <div style="font-size:18px; letter-spacing:2px; margin-bottom:8px; text-transform:uppercase;">AFK Disconnect</div>
                <div>${minutes}:${seconds.toString().padStart(2, '0')}</div>
            </div>
        `;
    }

    private hideAfkOverlay() {
        const overlay = document.getElementById(this.afkOverlayId);
        if (overlay) overlay.remove();
    }

    private createLocalNameplate() {
        if (!this.player) return;

        const os = this.scene.sys.game.device.os;
        const isMobile = os.android || os.iOS || os.iPad || os.iPhone || os.windowsPhone;
        const fontSize = isMobile ? '10px' : '6px';
        this.nameplateYOffset = isMobile ? -42 : -36;

        const namePrefix = currentUser?.isPremium ? '🦈 ' : '';
        const displayName = `${namePrefix}${currentUser?.username || 'You'}`;

        const padding = { x: 2, y: 1 };
        this.localNameText = this.scene.add.text(0, 0, displayName, {
            fontSize,
            fontFamily: 'Minecraft, monospace',
            color: '#ffffff',
            resolution: 2
        }).setOrigin(0.5);

        const textWidth = this.localNameText.width;
        const textHeight = this.localNameText.height;
        const bgWidth = textWidth + padding.x * 2;
        const bgHeight = textHeight + padding.y * 2;

        this.localNameBg = this.scene.add.graphics();
        this.localNameBg.fillStyle(0x000000, 0.6);
        this.localNameBg.fillRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight);

        this.localNameplate = this.scene.add.container(this.player.x, this.player.y + this.nameplateYOffset, [
            this.localNameBg,
            this.localNameText
        ]);
        this.localNameplate.setDepth((this.config.depth ?? 260) + 1000);
    }

    showChat(message: string) {
        // Remove existing bubble if any
        if (this.chatBubble) {
            this.chatBubble.destroy();
            this.chatBubble = undefined;
        }
        if (this.chatTimer) {
            this.chatTimer.remove(false);
            this.chatTimer = undefined;
        }

        const padding = 4;
        const arrowHeight = 4;
        const maxWidth = 120;

        const parsedMessage = EmojiMap.parse(message);

        // Create text
        const text = this.scene.add.text(0, 0, parsedMessage, {
            fontSize: '8px',
            fontFamily: 'Minecraft, "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
            color: '#f0f0f0',
            wordWrap: { width: maxWidth, useAdvancedWrap: true },
            align: 'center',
            resolution: 2
        }).setOrigin(0.5);

        const width = text.width + padding * 2;
        const height = text.height + padding * 2;

        // Create background
        const bg = this.scene.add.graphics();
        bg.fillStyle(0x000000, 0.6);
        bg.fillRoundedRect(-width/2, -height/2, width, height, 4);
        
        // Arrow
        bg.fillTriangle(
            -5, height/2,
            5, height/2,
            0, height/2 + arrowHeight
        );

        if (!this.player) {
            text.destroy();
            bg.destroy();
            return;
        }

        // Initial position setup
        const yOffset = -45 - (height / 2);
        this.chatBubble = this.scene.add.container(this.player.x, this.player.y + yOffset, [bg, text]);
        this.chatBubble.setDepth(99999);

        // Auto destroy
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
        
        // Interact key (F)
        this.interactKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F);
        
        // Initialize mobile controls (auto-detects touch devices)
        this.mobileControls = new MobileControls();
        
        // Initialize desktop interact button (auto-hides on mobile)
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
     * Set the remote player manager for interaction detection
     */
    setRemotePlayerManager(manager: RemotePlayerManager) {
        this.interactionManager.setRemotePlayerManager(manager);
    }

    /**
     * Set occlusion manager for depth sorting in occlusion zones
     */
    setOcclusionManager(manager: OcclusionManager) {
        this.occlusionManager = manager;
    }
    
    /**
     * Attempt to execute the current interaction
     */
    private tryInteract() {
        // Ignore if chat or GUI is open
        const chatFocused = this.scene.registry.get('chatFocused') === true;
        const guiOpen = this.scene.registry.get('guiOpen') === true;
        if (chatFocused || guiOpen) return;

        // Prevent re-trigger while locked
        if (this.scene.time.now < this.interactionLockUntil) return;

        const interaction = this.interactionManager.getCurrentInteraction();
        if (!interaction) return;

        // Play animation immediately, even if shove misses
        this.playInteractAnimation();

        // Notify server of shove attempt for animation sync
        this.networkManager.sendShoveAttempt(interaction.targetSessionId);

        // Delay actual shove by 1 animation frame for visual sync
        const frameDelayMs = this.animationController.getInteractFrameDurationMs();
        this.scene.time.delayedCall(frameDelayMs, () => {
            this.interactionManager.executeInteraction();
        });
    }

    /**
     * Play the interact animation and lock movement while it plays
     */
    playInteractAnimation() {
        if (!this.player) return;
        const durationMs = this.animationController.playInteract(this.player, this.currentRotation);
        this.interactionLockUntil = this.scene.time.now + durationMs;
    }
    
    /**
     * Get mobile controls instance (for external access if needed)
     */
    getMobileControls(): MobileControls | undefined {
        return this.mobileControls;
    }

    /**
     * Get desktop interact button instance
     */
    getDesktopInteractButton(): DesktopInteractButton | undefined {
        return this.desktopInteractButton;
    }

    /**
     * Check if player is currently moving
     */
    getIsMoving(): boolean {
        if (!this.player?.body) return false;
        const velocity = this.player.body.velocity as MatterJS.Vector;
        return Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1;
    }

    /**
     * Check if player is currently sprinting
     */
    getIsSprinting(): boolean {
        return this.isSprinting;
    }
    
    /**
     * Get current stamina (0-1)
     */
    getStamina(): number {
        return this.stamina;
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
    }
}
