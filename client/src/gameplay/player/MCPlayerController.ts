/**
 * MCPlayerController - Player controller specifically for the Main Character (cat)
 */

import Phaser from 'phaser';
import { TiledObjectLayer } from '../map/TiledTypes';
import { MCAnimationController } from './MCAnimationController';
import { PlayerShadow } from './PlayerShadow';
import { NetworkManager } from '../network/NetworkManager';
import { createNameplate } from './PlayerVisualUtils';
import { currentUser } from '../index';
import { GuiSwirlEffect } from '../fx/GuiSwirlEffect';
import { InteractionManager, InteractionType } from '../interaction/InteractionManager';
import { DroppedItemManager } from '../items/DroppedItemManager';
import { RemotePlayerManager } from './RemotePlayerManager';
import type { NPCManager } from '../npc/NPCManager';
import type { LightingManager } from '../fx/LightingManager';
import { DepthManager, ENTITY_BASE, NAMEPLATE_OFFSET } from '../rendering/DepthManager';
import { ICharacterAppearance, DEFAULT_CHARACTER_APPEARANCE, ClientMovementFrame, ServerMovementReconcile, ServerMovementImpulse, SOFT_COLLISION_FORCE, PLAYER_RENDER_SCALE } from '@cfwk/shared';
import { MCInputManager } from './mc/MCInputManager';
import { MCBubbleManager } from './mc/MCBubbleManager';
import { MCAfkManager } from './mc/MCAfkManager';

export type MCPlayerControllerConfig = {
    speed?: number;
    sprintSpeed?: number;
    accel?: number;
    drag?: number;
    rotationRateMinDegPerSec?: number;
    rotationRateMaxDegPerSec?: number;
    depth?: number;
    scale?: number;
    depthManager?: DepthManager;
    maxStamina?: number;
    staminaDrainRate?: number;
    staminaRegenRate?: number;
    staminaRegenDelay?: number;
};

export class MCPlayerController {
    private scene: Phaser.Scene;
    private player?: Phaser.Physics.Matter.Sprite;
    private contactNormals: Phaser.Math.Vector2[] = [];
    private spawnPoint?: Phaser.Math.Vector2;
    private animationController: MCAnimationController;
    private shadow?: PlayerShadow;
    private equippedRodId: string | null = null;
    private isFishing = false;
    private onFishingStart?: (rodItemId: string) => void;

    private config: Required<Omit<MCPlayerControllerConfig, 'depthManager'>> & { depthManager?: DepthManager };

    private characterAppearance: ICharacterAppearance = DEFAULT_CHARACTER_APPEARANCE;
    private isInitialized = false;

    private currentRotation = Math.PI / 2;

    private lastDiagonalAngle?: number;
    private lastDiagonalReleaseTime: number | null = null;
    private wasDiagonalInput = false;
    private readonly diagonalReleaseLeewayMs = 150;
    private forcedFacingTarget?: number;

    private stamina = 1;
    private isSprinting = false;
    private staminaRegenTimer = 0;
    private isStaminaDepleted = false;

    private networkManager = NetworkManager.getInstance();
    private movementSeq = 0;
    private pendingMovementSeqs: number[] = [];
    private correctionOffsetX = 0;
    private correctionOffsetY = 0;
    private syncTimer = 0;
    private readonly syncInterval = 50;
    private readonly hardRubberbandThreshold = 48;
    private readonly PHYSICS_FPS = 60;
    private readonly IMPULSE_DECAY = 0.88;
    private networkMovementHandlersAttached = false;
    private impulseVx = 0;
    private impulseVy = 0;
    private lastMovementInput = {
        up: false,
        down: false,
        left: false,
        right: false,
        sprint: false
    };

    private interactionManager: InteractionManager;
    private interactionLockUntil = 0;

    private localNameplate?: Phaser.GameObjects.Container;
    private nameplateYOffset = -36;
    private nameplateHeight = 0;

    private speedMultiplier = 1.0;
    private _depthManager?: DepthManager;
    private _lightingManager?: LightingManager;

    private readonly hitboxWidth = 16;
    private readonly collidableHeight = 6;

    private readonly chatBubbleGap = 10;

    private inputManager: MCInputManager;
    private bubbleManager: MCBubbleManager;
    private afkManager: MCAfkManager;
    private guiEffect?: GuiSwirlEffect;

    constructor(scene: Phaser.Scene, config: MCPlayerControllerConfig = {}) {
        this.scene = scene;
        this.config = {
            speed: config.speed ?? 1.6,
            sprintSpeed: config.sprintSpeed ?? 3.2,
            accel: config.accel ?? 0.35,
            drag: config.drag ?? 0.5,
            rotationRateMinDegPerSec: config.rotationRateMinDegPerSec ?? 180,
            rotationRateMaxDegPerSec: config.rotationRateMaxDegPerSec ?? 540,
            depth: config.depth ?? ENTITY_BASE,
            scale: config.scale ?? PLAYER_RENDER_SCALE,
            maxStamina: config.maxStamina ?? 1,
            staminaDrainRate: config.staminaDrainRate ?? 0.3,
            staminaRegenRate: config.staminaRegenRate ?? 0.25,
            staminaRegenDelay: config.staminaRegenDelay ?? 1.0
        };

        this._depthManager = config.depthManager;

        this.animationController = new MCAnimationController(scene, {
            walkFrameRate: 10,
            walkAnimSpeedMin: 6,
            walkAnimSpeedMax: 14,
            walkAnimSpeedMaxVelocity: this.config.sprintSpeed,
            scale: this.config.scale
        });

        this.interactionManager = new InteractionManager();

        this.inputManager = new MCInputManager(this.scene, this.interactionManager, {
            onInteract: () => this.tryInteract()
        });

        this.bubbleManager = new MCBubbleManager(this.scene, () => this.getBubbleAnchor(), {
            gap: this.chatBubbleGap
        });

        this.afkManager = new MCAfkManager(
            this.scene,
            this.networkManager,
            () => this.player,
            () => this.shadow,
            {
                afkThreshold: 60000,
                afkKickThreshold: 300000,
                isPremium: Boolean(currentUser?.isPremium)
            }
        );

        this.guiEffect = new GuiSwirlEffect(this.scene);
    }

    async initialize(appearance?: ICharacterAppearance): Promise<void> {
        if (appearance) {
            this.characterAppearance = appearance;
        }

        await this.animationController.initialize(this.characterAppearance);
        this.setupCollisionTracking();

        this.isInitialized = true;
    }

    getPlayer(): Phaser.Physics.Matter.Sprite | undefined {
        return this.player;
    }

    getSpawnPoint(): Phaser.Math.Vector2 | undefined {
        return this.spawnPoint;
    }

    setSpeedMultiplier(multiplier: number) {
        this.speedMultiplier = Math.max(0, Math.min(1, multiplier));
    }

    getSpeedMultiplier(): number {
        return this.speedMultiplier;
    }

    setShadowVisible(visible: boolean) {
        this.shadow?.setVisible(visible);
    }

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

        const initialDimensions = this.animationController.getCurrentFrameDimensions();
        const scaledWidth = initialDimensions.width * scale;
        const scaledHeight = initialDimensions.height * scale;
        const scaledCollidableHeight = this.collidableHeight * scale;

        const player = this.scene.matter.add.sprite(
            spawnX,
            spawnY - scaledCollidableHeight / 2,
            this.animationController.getInitialTextureKey()
        );

        player.setDisplaySize(scaledWidth, scaledHeight);

        const hitboxW = this.hitboxWidth * scale;
        const hitboxH = scaledCollidableHeight;
        player.setRectangle(hitboxW, hitboxH, { isStatic: false });

        const originY = 1 - hitboxH / (2 * scaledHeight);
        player.setOrigin(0.5, originY);
        player.setFixedRotation();
        player.setFriction(0);
        player.setFrictionStatic(0);
        player.setFrictionAir(0);
        player.setDepth(depth);

        const initialAnimKey = this.animationController.getInitialAnimationKey();
        if (this.scene.anims.exists(initialAnimKey)) {
            player.play(initialAnimKey);
        }

        this.player = player;

        this.shadow = new PlayerShadow(this.scene, player, this._lightingManager);
        this.createLocalNameplate();
        this.attachNetworkMovementHandlers();

        const x = Math.round(spawnX);
        const y = Math.round(spawnY - scaledCollidableHeight / 2);
        this.sendMovementFrame(x, y, 0, 0);

        return player;
    }

    setDepth(depth: number) {
        this.player?.setDepth(depth);
    }

    update(delta: number) {
        if (!this.player?.body) return;

        this.interactionManager.updateLocalPlayer(
            this.player.x,
            this.player.y,
            this.currentRotation
        );
        this.interactionManager.update();

        if (this.localNameplate) {
            this.localNameplate.setPosition(this.player.x, this.player.y + this.nameplateYOffset);
        }

        const interactionLocked = this.scene.time.now < this.interactionLockUntil;

        const guiOpen = this.scene.registry.get('guiOpen') === true;
        const chatFocused = this.scene.registry.get('chatFocused') === true;
        const transitionBlocked = this.scene.registry.get('inputBlocked') === true;
        const inputBlocked = guiOpen || chatFocused || transitionBlocked;

        if (!inputBlocked) {
            const actionPresses = this.inputManager.getActionPresses();
            if (actionPresses.interactPressed && !interactionLocked) {
                this.tryInteract();
            }
            if (actionPresses.fishingPressed && !interactionLocked) {
                this.tryStartFishing();
            }
        }

        const movement = this.inputManager.getMovementInput(inputBlocked);
        this.lastMovementInput = {
            up: movement.moveUp,
            down: movement.moveDown,
            left: movement.moveLeft,
            right: movement.moveRight,
            sprint: movement.wantSprint
        };

        let inputVx = 0;
        let inputVy = 0;
        if (movement.moveUp) inputVy -= 1;
        if (movement.moveDown) inputVy += 1;
        if (movement.moveLeft) inputVx -= 1;
        if (movement.moveRight) inputVx += 1;

        const len = Math.hypot(inputVx, inputVy);
        if (len > 0) {
            inputVx /= len;
            inputVy /= len;
        }

        const movementIntensity = Math.min(1, len);
        const hasInput = movementIntensity > 0;

        const hasVertical = (movement.moveUp || movement.moveDown) && movement.moveUp !== movement.moveDown;
        const hasHorizontal = (movement.moveLeft || movement.moveRight) && movement.moveLeft !== movement.moveRight;
        const isDiagonalInput = hasVertical && hasHorizontal;

        if (isDiagonalInput) {
            this.lastDiagonalAngle = Math.atan2(inputVy, inputVx);
            this.lastDiagonalReleaseTime = null;
        } else if (this.wasDiagonalInput && !isDiagonalInput) {
            this.lastDiagonalReleaseTime = this.scene.time.now;
        }
        this.wasDiagonalInput = isDiagonalInput;
        this.updateStamina(delta, movement.wantSprint, movementIntensity);

        const body = this.player.body as MatterJS.BodyType;
        const currentVx = body.velocity.x;
        const currentVy = body.velocity.y;
        const currentSpeed = Math.hypot(currentVx, currentVy);

        const dt = delta / 1000;
        const maxRotationStep = this.getCurrentRotationRateRadPerSec(currentSpeed) * dt;

        if (this.forcedFacingTarget !== undefined) {
            this.currentRotation = this.rotateToward(this.currentRotation, this.forcedFacingTarget, maxRotationStep);
        } else if (hasInput) {
            const desiredRotation = Math.atan2(inputVy, inputVx);
            this.currentRotation = this.rotateToward(this.currentRotation, desiredRotation, maxRotationStep);
        } else if (
            this.lastDiagonalAngle !== undefined &&
            this.lastDiagonalReleaseTime !== null &&
            this.scene.time.now - this.lastDiagonalReleaseTime <= this.diagonalReleaseLeewayMs
        ) {
            this.currentRotation = this.rotateToward(this.currentRotation, this.lastDiagonalAngle, maxRotationStep);
        }

        let speed = this.config.speed;
        if (this.isSprinting) {
            speed = this.config.sprintSpeed;
        }
        speed *= this.speedMultiplier;

        const targetSpeed = speed * movementIntensity;
        const targetVx = hasInput ? Math.cos(this.currentRotation) * targetSpeed : 0;
        const targetVy = hasInput ? Math.sin(this.currentRotation) * targetSpeed : 0;
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

        // Additive impulse from external forces (shoves) — decays naturally per frame
        newVx += this.impulseVx;
        newVy += this.impulseVy;
        this.impulseVx *= this.IMPULSE_DECAY;
        this.impulseVy *= this.IMPULSE_DECAY;
        if (Math.abs(this.impulseVx) < 0.01) this.impulseVx = 0;
        if (Math.abs(this.impulseVy) < 0.01) this.impulseVy = 0;

        this.player.setVelocity(newVx, newVy);

        if (Math.abs(this.correctionOffsetX) > 0.01 || Math.abs(this.correctionOffsetY) > 0.01) {
            const applyX = this.correctionOffsetX * 0.2;
            const applyY = this.correctionOffsetY * 0.2;
            this.player.setPosition(this.player.x + applyX, this.player.y + applyY);
            this.correctionOffsetX -= applyX;
            this.correctionOffsetY -= applyY;
        }

        const hasActiveImpulse = Math.abs(this.impulseVx) > 0.05 || Math.abs(this.impulseVy) > 0.05;
        if (hasActiveImpulse && !hasInput) {
            this.animationController.updateShove(this.player);
        } else {
            this.animationController.setSprinting(this.isSprinting);
            this.animationController.update(this.player, targetVx, targetVy, this.currentRotation);
        }

        this.updateSpriteOriginForDirection();

        this.shadow?.update();
        this.bubbleManager.update();

        const feetY = this.player.getBottomLeft().y;
        const depth = this._depthManager
            ? this._depthManager.entityDepth(this.player.x, feetY, { baseDepth: this.config.depth ?? ENTITY_BASE })
            : (this.config.depth ?? ENTITY_BASE) + feetY * 0.01;
        this.player.setDepth(depth);

        this.guiEffect?.update(this.player.x, this.player.y);

        this.syncTimer += delta;
        if (this.syncTimer >= this.syncInterval) {
            this.syncTimer = 0;
            const bodyAfter = this.player.body as MatterJS.BodyType;
            this.syncMovementFrame(
                Math.round(this.player.x),
                Math.round(this.player.y),
                bodyAfter.velocity.x || 0,
                bodyAfter.velocity.y || 0
            );
        }

        if (hasInput) {
            this.afkManager.registerAfkActivity(Date.now());
        }
        this.afkManager.update(delta);
    }

    updateAfkOnly(delta: number) {
        this.afkManager.update(delta);
    }

    private updateSpriteOriginForDirection() {
        if (!this.player) return;

        const dimensions = this.animationController.getCurrentFrameDimensions();
        const { scale } = this.config;
        const scaledWidth = dimensions.width * scale;
        const scaledHeight = dimensions.height * scale;
        const scaledCollidableHeight = this.collidableHeight * scale;

        this.player.setDisplaySize(scaledWidth, scaledHeight);

        const originY = 1 - scaledCollidableHeight / (2 * scaledHeight);

        if (dimensions.width > this.hitboxWidth) {
            const extraWidth = dimensions.width - this.hitboxWidth;
            const extraScaled = extraWidth * scale;

            if (this.animationController.isFacingEast()) {
                const originX = 0.5 + (extraScaled / 2) / scaledWidth;
                this.player.setOrigin(originX, originY);
            } else if (this.animationController.isFacingWest()) {
                const originX = 0.5 - (extraScaled / 2) / scaledWidth;
                this.player.setOrigin(originX, originY);
            } else {
                this.player.setOrigin(0.5, originY);
            }
        } else {
            this.player.setOrigin(0.5, originY);
        }
    }

    private updateStamina(delta: number, wantSprint: boolean, movementIntensity: number) {
        const dt = delta / 1000;
        const clampedMovementIntensity = Phaser.Math.Clamp(movementIntensity, 0, 1);

        const canSprint = this.stamina > 0 && !this.isStaminaDepleted;
        this.isSprinting = wantSprint && clampedMovementIntensity > 0 && canSprint;

        if (this.isSprinting) {
            this.stamina -= this.config.staminaDrainRate * dt * clampedMovementIntensity;
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

    private rotateToward(current: number, target: number, maxStep: number): number {
        const delta = Phaser.Math.Angle.Wrap(target - current);
        if (Math.abs(delta) <= maxStep) {
            return target;
        }
        return Phaser.Math.Angle.Wrap(current + Math.sign(delta) * maxStep);
    }

    private getCurrentRotationRateRadPerSec(velocityMagnitude?: number): number {
        const minRateRad = Phaser.Math.DegToRad(this.config.rotationRateMinDegPerSec);
        const maxRateRad = Phaser.Math.DegToRad(this.config.rotationRateMaxDegPerSec);

        const speed = velocityMagnitude ?? this.getCurrentVelocityMagnitude();
        const speedMultiplier = Math.max(0.1, this.speedMultiplier);
        const minSpeed = this.config.speed * speedMultiplier;
        const maxSpeed = this.config.sprintSpeed * speedMultiplier;
        const speedRange = Math.max(0.01, maxSpeed - minSpeed);
        const speedRatio = Phaser.Math.Clamp((speed - minSpeed) / speedRange, 0, 1);

        return Phaser.Math.Linear(maxRateRad, minRateRad, speedRatio);
    }

    private getCurrentVelocityMagnitude(): number {
        const body = this.player?.body as MatterJS.BodyType | undefined;
        if (!body) return 0;
        return Math.hypot(body.velocity.x || 0, body.velocity.y || 0);
    }

    private syncMovementFrame(x: number, y: number, vx: number, vy: number) {
        const frame: ClientMovementFrame = {
            seq: ++this.movementSeq,
            clientTime: Date.now(),
            x,
            y,
            vx: vx * this.PHYSICS_FPS,
            vy: vy * this.PHYSICS_FPS,
            speedMultiplier: this.speedMultiplier,
            input: {
                up: this.lastMovementInput.up,
                down: this.lastMovementInput.down,
                left: this.lastMovementInput.left,
                right: this.lastMovementInput.right,
                sprint: this.lastMovementInput.sprint
            },
            anim: this.animationController.getAnimation(),
            direction: this.animationController.getDirection()
        };

        this.pendingMovementSeqs.push(frame.seq);
        if (this.pendingMovementSeqs.length > 120) {
            this.pendingMovementSeqs.splice(0, this.pendingMovementSeqs.length - 120);
        }

        this.networkManager.sendMovementFrame(frame);
    }

    private sendMovementFrame(x: number, y: number, vx: number, vy: number) {
        this.syncMovementFrame(x, y, vx, vy);
        this.networkManager.sendAnimation(this.animationController.getAnimation(), this.animationController.getDirection(), this.isSprinting);
    }

    private attachNetworkMovementHandlers() {
        if (this.networkMovementHandlersAttached) return;
        const room = this.networkManager.getRoom();
        if (!room) return;

        room.onMessage('movement:reconcile', (data: ServerMovementReconcile) => {
            this.handleMovementReconcile(data);
        });

        room.onMessage('movement:impulse', (data: ServerMovementImpulse) => {
            this.handleServerImpulse(data);
        });

        this.networkMovementHandlersAttached = true;
    }

    private handleMovementReconcile(data: ServerMovementReconcile) {
        if (!this.player?.body) return;
        if (!data || typeof data.seqAck !== 'number') return;

        this.pendingMovementSeqs = this.pendingMovementSeqs.filter((seq) => seq > data.seqAck);

        const dx = data.x - this.player.x;
        const dy = data.y - this.player.y;
        const error = Math.hypot(dx, dy);

        if (data.hardOverride || error >= this.hardRubberbandThreshold) {
            const toLocal = 1 / this.PHYSICS_FPS;
            this.player.setPosition(data.x, data.y);
            this.player.setVelocity(data.vx * toLocal, data.vy * toLocal);
            this.correctionOffsetX = 0;
            this.correctionOffsetY = 0;
            return;
        }

        if (error > 0.2) {
            this.correctionOffsetX += dx * 0.5;
            this.correctionOffsetY += dy * 0.5;
        }
    }

    private handleServerImpulse(data: ServerMovementImpulse) {
        if (!this.player?.body) return;
        const toLocal = 1 / this.PHYSICS_FPS;
        this.impulseVx += data.vx * toLocal;
        this.impulseVy += data.vy * toLocal;
    }

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
                    const idx = this.contactNormals.findIndex((n) => n.equals(normal));
                    if (idx !== -1) {
                        this.contactNormals.splice(idx, 1);
                    }
                }
            }
        });
    }

    private tryInteract() {
        const chatFocused = this.scene.registry.get('chatFocused') === true;
        const guiOpen = this.scene.registry.get('guiOpen') === true;
        const transitionBlocked = this.scene.registry.get('inputBlocked') === true;
        if (chatFocused || guiOpen || transitionBlocked) return;

        this.afkManager.registerAfkActivity(Date.now());

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

    playInteractAnimation() {
        if (!this.player) return;
        const durationMs = this.animationController.playInteract(this.player, this.currentRotation);
        this.interactionLockUntil = this.scene.time.now + durationMs;
    }

    setInteractionCooldown(durationMs: number) {
        const until = this.scene.time.now + Math.max(0, durationMs);
        this.interactionLockUntil = Math.max(this.interactionLockUntil, until);
    }

    setRemotePlayerManager(manager: RemotePlayerManager) {
        this.interactionManager.setRemotePlayerManager(manager);
    }

    setDroppedItemManager(manager: DroppedItemManager) {
        this.interactionManager.setDroppedItemManager(manager);
    }

    setNpcManager(manager: NPCManager) {
        this.interactionManager.setNpcManager(manager);
    }

    setDepthManager(manager: DepthManager) {
        this._depthManager = manager;
    }

    setLightingManager(manager: LightingManager) {
        this._lightingManager = manager;
    }

    getMobileControls() {
        return this.inputManager.getMobileControls();
    }

    getIsMoving(): boolean {
        if (!this.player?.body) return false;
        const velocity = this.player.body.velocity as MatterJS.Vector;
        return Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1;
    }

    getIsSprinting(): boolean {
        return this.isSprinting;
    }

    getStamina(): number {
        return this.stamina;
    }

    getSoftCollisionFootprint(): { x: number; y: number; width: number; height: number } | null {
        if (!this.player || !this.player.active || !this.player.body) return null;
        const scale = this.config.scale ?? 1;
        return {
            x: this.player.x,
            y: this.player.y,
            width: this.hitboxWidth * scale,
            height: this.collidableHeight * scale
        };
    }

    isAfkGhosted(): boolean {
        return this.afkManager.isAfkGhosted();
    }

    applySoftCollisionNudge(dx: number, dy: number) {
        if (this.isAfkGhosted()) return;
        if (!this.player?.body) return;

        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= 0.0001) return;

        const maxPerStep = SOFT_COLLISION_FORCE.maxPushPerStep;
        const scale = length > maxPerStep ? (maxPerStep / length) : 1;
        const pushX = dx * scale;
        const pushY = dy * scale;

        this.player.setPosition(this.player.x + pushX, this.player.y + pushY);
        this.impulseVx += pushX * 7;
        this.impulseVy += pushY * 7;

        if (this.localNameplate) {
            this.localNameplate.setPosition(this.player.x, this.player.y + this.nameplateYOffset);
        }
    }

    setForcedFacingTarget(targetAngle?: number) {
        if (targetAngle === undefined) {
            this.forcedFacingTarget = undefined;
            return;
        }
        this.forcedFacingTarget = Phaser.Math.Angle.Wrap(targetAngle);
    }

    getRotationTimeTo(targetAngle: number): number {
        const wrappedTarget = Phaser.Math.Angle.Wrap(targetAngle);
        const delta = Phaser.Math.Angle.Wrap(wrappedTarget - this.currentRotation);
        const currentRate = this.getCurrentRotationRateRadPerSec();
        return Math.abs(delta) / Math.max(0.0001, currentRate);
    }

    showChat(message: string) {
        this.bubbleManager.showChat(message);
    }

    setEquippedRodId(rodItemId: string | null) {
        this.equippedRodId = rodItemId;
    }

    setFishingActive(active: boolean) {
        this.isFishing = active;
    }

    setOnFishingStart(callback?: (rodItemId: string) => void) {
        this.onFishingStart = callback;
    }

    requestFishing() {
        this.tryStartFishing();
    }

    showFishingBubble(rodItemId: string) {
        this.bubbleManager.showFishingBubble(rodItemId);
    }

    private tryStartFishing() {
        if (!this.player || this.isFishing) return;
        const guiOpen = this.scene.registry.get('guiOpen') === true;
        const chatFocused = this.scene.registry.get('chatFocused') === true;
        const transitionBlocked = this.scene.registry.get('inputBlocked') === true;
        if (guiOpen || chatFocused || transitionBlocked) return;
        const nearWater = this.scene.registry.get('nearWater') === true;
        if (!nearWater) return;
        if (!this.equippedRodId) return;

        this.isFishing = true;
        this.showFishingBubble(this.equippedRodId);
        this.networkManager.sendFishingStart(this.equippedRodId);
        this.onFishingStart?.(this.equippedRodId);
    }

    getCharacterAppearance(): ICharacterAppearance {
        return this.characterAppearance;
    }

    destroy() {
        this.forcedFacingTarget = undefined;
        this.bubbleManager.destroy();
        this.inputManager.destroy();
        this.afkManager.destroy();
        this.localNameplate?.destroy();
        this.shadow?.destroy();
        this.guiEffect?.destroy();
        this.interactionManager?.destroy();
        this.animationController?.destroy();
        this.player?.destroy();
        this.player = undefined;
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
            depth: (this.config.depth ?? ENTITY_BASE) + NAMEPLATE_OFFSET
        });

        this.localNameplate = nameplate.container;
        this.nameplateHeight = nameplate.nameText.height + 2;
        this.localNameplate.setPosition(this.player.x, this.player.y + this.nameplateYOffset);
    }

    private getBubbleAnchor() {
        if (!this.player) return null;
        const nameplateTop = this.nameplateHeight
            ? this.player.y + this.nameplateYOffset - this.nameplateHeight / 2
            : (this.localNameplate?.getBounds().top ?? (this.player.y + this.nameplateYOffset));
        return { x: this.player.x, nameplateTop };
    }
}
