import Phaser from 'phaser';
import { DAYLIGHT_HOURS, getItemImagePath, getRodStats } from '@cfwk/shared';
import { LightingManager } from '../fx/LightingManager';
import { WorldTimeManager } from '../time/WorldTimeManager';
import { NetworkManager } from '../network/NetworkManager';
import { buildRodSideTexture } from '../rendering/rodSideTexture';
import { AudioManager } from '../audio/AudioManager';

type TileSnapshotData = {
    canvas: HTMLCanvasElement;
    playerTileCol: number;
    playerTileRow: number;
};

type FishingSceneData = {
    rodItemId?: string;
    tileSnapshot?: TileSnapshotData | null;
};

type BarVisual = {
    bg: Phaser.GameObjects.Image;
    fill: Phaser.GameObjects.TileSprite;
    maskGraphics: Phaser.GameObjects.Graphics;
    mask: Phaser.Display.Masks.GeometryMask;
    textureKey?: string;
    width: number;
    height: number;
    innerW: number;
    innerH: number;
    x: number;
    y: number;
    value: number;
};

export class FishingScene extends Phaser.Scene {
    // UI elements
    private stopButton?: Phaser.GameObjects.Container;
    private previewFrame?: Phaser.GameObjects.Image;
    private stopButtonBg?: Phaser.GameObjects.Image;
    private stopButtonLabel?: Phaser.GameObjects.Text;
    private buttonTextureKey?: string;
    private buttonTextureCounter = 0;
    private currentButtonWidth = 0;
    private currentButtonHeight = 0;
    private castButton?: Phaser.GameObjects.Container;
    private castButtonBg?: Phaser.GameObjects.Image;
    private castButtonLabel?: Phaser.GameObjects.Text;
    private castButtonTextureKey?: string;
    private castButtonTextureCounter = 0;
    private castButtonWidth = 0;
    private castButtonHeight = 0;
    private castBar?: BarVisual;
    private biteTimeBar?: BarVisual;
    private biteClickBar?: BarVisual;
    private biteText?: Phaser.GameObjects.Text;
    private biteHint?: Phaser.GameObjects.Text;
    private readonly frameMargin = 14;
    private readonly frameTopOffset = 70;
    private readonly buttonSpacing = 12;
    private readonly castButtonBottomMargin = 20;
    private readonly castBarSpacing = 10;
    private readonly biteTextTopRatio = 0.25;
    private readonly biteBarSpacing = 8;
    private readonly biteTextSize = 36;
    private readonly biteHintSize = 18;
    private readonly biteTextPadding = 24;

    // Perspective rendering
    private perspectiveCanvas?: HTMLCanvasElement;
    private perspectiveCtx?: CanvasRenderingContext2D;
    private perspectiveImage?: Phaser.GameObjects.Image;
    private perspectiveTextureKey?: string;
    private tileSnapshot?: TileSnapshotData | null;
    private rodItemId?: string;
    private lightingManager?: LightingManager;
    private worldTimeManager = WorldTimeManager.getInstance();
    private guiOpenHandler?: (_parent: any, value: boolean) => void;

    // Rod view
    private rodSideTextureKey?: string;
    private rodSideWidth = 0;
    private rodSideHeight = 0;
    private rodSprite?: Phaser.GameObjects.Image;
    private readonly rodMarginX = 40;
    private readonly rodOffsetXRatio = 0.25;
    private readonly rodBottomOverlap = 18;
    private readonly rodTargetWidthRatio = 0.015;
    private rodBaseX = 0;
    private rodBaseY = 0;
    private readonly rodBreathCycleSeconds = 2.8;
    private readonly rodBreathRangePx = 16;
    private readonly waterBreathCycleSeconds = 2.8;
    private readonly waterBreathRangePx = 6;
    private rodBaseScaleX = 1;
    private rodBaseScaleY = 1;
    private rodBaseOriginX = 1;
    private rodBaseOriginY = 1;
    private rodThrowPull = 0;
    private rodThrowTween?: Phaser.Tweens.Tween;
    private pendingCastRelease = false;
    private debugToggleHandler?: (event: KeyboardEvent) => void;
    private networkManager = NetworkManager.getInstance();

    // Water tileset rendering
    private readonly waterTilesetKey = 'fishing-water-tileset';
    private readonly waterTilesetUrl = encodeURI('/assets/special/ocean0a.png');
    private readonly waterTileSize = 32;
    private readonly waterTilesetColumns = 8;
    private readonly waterAnimTileIds = [0, 1, 2, 3, 4, 5, 6, 7];
    private readonly waterFrameDuration = 0.1;

    // Animation
    private waterTime = 0;
    private breathTime = 0;

    // Cast/reel state
    private isHoldingCast = false;
    private castHoldStart = 0;
    private castHoldDuration = 0;
    private readonly castMinHoldMs = 500;
    private readonly castMaxHoldMs = 2500;
    private readonly castDepthMin = 1;
    private readonly castDepthMax = 12;
    private casted = false;
    private castPower = 0;
    private currentDepth = 1;
    private biteTimer?: Phaser.Time.TimerEvent;
    private biteActive = false;
    private biteWindowTimer?: Phaser.Time.TimerEvent;
    private readonly biteWindowMs = 5000;
    private reelClicks = 0;
    private reelClicksNeeded = 10;
    private readonly baseBiteDelayMinMs = 4000;
    private readonly baseBiteDelayMaxMs = 12000;
    private hookItemId?: string;
    private readonly biteMessages = [
        'Your rod is shaking!',
        "Something's hooked!",
        'A fish is fighting!',
        'You got a bite!',
        'The line is tugging!'
    ];

    // Line curve tuning
    private readonly lineFinalSagMin = 50;
    private readonly lineFinalSagMax = 160;
    private readonly lineFinalSagPower = 1.15;
    private readonly lineFinalSagDistanceFactor = 0.35;
    private readonly lineFinalControl1T = 0.28;
    private readonly lineFinalControl2T = 0.82;
    private readonly lineFinalControl1SagRatio = 0.7;
    private readonly lineFinalControl2SagRatio = 0.2;
    private readonly lineFinalEndStraightness = 0.45;

    // Reel pull tuning
    private readonly reelPullMaxProgress = 0.8;

    // Splash particle tuning
    private readonly splashTextureKey = 'fishing-water-splash';
    private readonly splashCountMin = 6;
    private readonly splashCountMax = 14;
    private readonly splashSpeedMin = 25;
    private readonly splashSpeedMax = 80;
    private readonly splashLifespanMin = 260;
    private readonly splashLifespanMax = 540;
    private readonly splashScaleStartMin = 0.4;
    private readonly splashScaleStartMax = 1.1;
    private readonly splashScaleEnd = 0.1;
    private readonly splashAlphaStart = 0.8;
    private readonly splashGravity = 120;
    private readonly splashSpreadBase = 6;
    private readonly splashSpreadPower = 10;
    private readonly splashDepth = 3;

    // Cast line
    private castLineGraphics?: Phaser.GameObjects.Graphics;
    private castLineProgress = 0;
    private castLineTween?: Phaser.Tweens.Tween;
    private castLineEnd?: Phaser.Math.Vector2;
    private castLineBaseEnd?: Phaser.Math.Vector2;
    private castTossTween?: Phaser.Tweens.Tween;
    private castSettleTween?: Phaser.Tweens.Tween;
    private castTossProgress = 0;
    private castSettleProgress = 1;
    private isCastTossing = false;
    private isCastSettling = false;
    private castSettleStartLift = 0;
    private reelInTween?: Phaser.Tweens.Tween;
    private reelInStart?: Phaser.Math.Vector2;
    private reelInProgress = 0;
    private isReelInAnimating = false;
    private isReelReturning = false;
    private caughtItemSprite?: Phaser.GameObjects.Image;
    private castButtonFadeTween?: Phaser.Tweens.Tween;
    private biteAlertSound?: Phaser.Sound.WebAudioSound;
    private splashEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

    constructor() {
        super({ key: 'FishingScene' });
    }

    init(data: FishingSceneData) {
        this.tileSnapshot = data?.tileSnapshot;
        this.rodItemId = data?.rodItemId;
    }

    preload() {
        if (!this.textures.exists('ui-item-info-frame')) {
            this.load.image('ui-item-info-frame', '/ui/Frame07a.png');
        }
        if (!this.textures.exists('ui-group-button-selected')) {
            this.load.image('ui-group-button-selected', '/ui/Button08a.png');
        }
        if (!this.textures.exists('ui-hud-stamina-bg')) {
            this.load.image('ui-hud-stamina-bg', '/ui/Bar04a.png');
        }
        if (!this.textures.exists('ui-hud-stamina-fill')) {
            this.load.image('ui-hud-stamina-fill', '/ui/Fill02a.png');
        }
        if (!this.textures.exists(this.waterTilesetKey)) {
            this.load.image(this.waterTilesetKey, this.waterTilesetUrl);
        }
        if (this.rodItemId) {
            const rodImageKey = `item-${this.rodItemId}`;
            if (!this.textures.exists(rodImageKey)) {
                const rodPath = getItemImagePath(this.rodItemId);
                if (rodPath) {
                    this.load.image(rodImageKey, `/${rodPath}`);
                }
            }
        }
    }

    create() {
        this.cameras.main.setBackgroundColor('#0a1628');
        this.cameras.main.fadeIn(500, 0, 0, 0);

        this.lightingManager = new LightingManager(this);
        this.createPerspectiveView();
        if (this.textures.exists(this.waterTilesetKey)) {
            this.textures.get(this.waterTilesetKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
        }
        this.createRodDisplay();
        this.enableSceneLighting();
        this.ensureUiVisible();
        this.setupDebugToggle();
        this.createUI();
        this.createSplashEmitter();
        this.layoutAll();
        this.setupCatchListener();
        this.setupHookListener();
        this.setupGuiOpenListener();

        this.scale.on('resize', this.onResize, this);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    }

    update(_time: number, delta: number) {
        this.waterTime += delta * 0.001;
        this.breathTime += delta * 0.001;
        const gameScene = this.scene.get('GameScene') as any;
        gameScene?.updateAfkOnly?.(delta);
        this.worldTimeManager.update(delta);
        this.lightingManager?.updateFromWorldTime(this.worldTimeManager.getTime());
        this.renderPerspective();
        this.updateRodBreathing();
        this.updateDebugOverlay();
        this.updateCastHold(delta);
        this.updateCastLine();
        this.updateBiteBars();
    }

    private markAfkActivity() {
        this.registry.set('afkActivity', Date.now());
    }

    private createPerspectiveView() {
        const width = this.scale.width;
        const height = this.scale.height;

        this.perspectiveCanvas = document.createElement('canvas');
        this.perspectiveCanvas.width = width;
        this.perspectiveCanvas.height = height;
        this.perspectiveCtx = this.perspectiveCanvas.getContext('2d')!;

        this.perspectiveTextureKey = '__fishing_perspective_0';
        this.textures.addCanvas(this.perspectiveTextureKey, this.perspectiveCanvas);

        this.perspectiveImage = this.add.image(width / 2, height / 2, this.perspectiveTextureKey).setOrigin(0.5);
        this.perspectiveImage.setDepth(0);

        this.renderPerspective();
    }

    private createRodDisplay() {
        if (!this.rodItemId) return;
        const rodImageKey = `item-${this.rodItemId}`;
        if (!this.textures.exists(rodImageKey)) return;

        this.rodSideTextureKey = `__fishing_rod_side_${this.rodItemId}`;
        const rodSide = buildRodSideTexture(this.textures, rodImageKey, this.rodSideTextureKey);
        if (!rodSide || !this.rodSideTextureKey || !this.textures.exists(this.rodSideTextureKey)) return;
        this.rodSideWidth = rodSide.width;
        this.rodSideHeight = rodSide.height;

        this.rodSprite = this.add.image(0, 0, this.rodSideTextureKey).setOrigin(1, 1);
        this.rodSprite.setDepth(5);
    }

    private enableSceneLighting() {
        if (this.perspectiveImage) {
            this.lightingManager?.enableLightingOn(this.perspectiveImage);
        }
        if (this.rodSprite) {
            this.lightingManager?.enableLightingOn(this.rodSprite);
        }
        this.lightingManager?.updateFromWorldTime(this.worldTimeManager.getTime());
    }

    private ensureUiVisible() {
        if (this.scene.get('UIScene')) {
            this.scene.resume('UIScene');
            this.scene.bringToTop('UIScene');
            const uiScene = this.scene.get('UIScene') as any;
            uiScene?.setHudVisible?.(false);
        }
    }

    private setupDebugToggle() {
        this.debugToggleHandler = () => {
            if (this.registry.get('chatFocused') === true) return;
            if (this.registry.get('guiOpen') === true) return;

            const shiftDown = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)?.isDown ?? false;
            const gameScene = this.scene.get('GameScene') as any;
            gameScene?.debugOverlay?.toggle(shiftDown);
        };

        this.input.keyboard?.on('keydown-H', this.debugToggleHandler, this);
    }

    private updateDebugOverlay() {
        const gameScene = this.scene.get('GameScene') as any;
        const debugOverlay = gameScene?.debugOverlay;
        if (!debugOverlay?.isEnabled?.()) return;
        const worldTime = this.worldTimeManager.getTime();
        debugOverlay.draw([], [], undefined, undefined, worldTime, undefined, {
            fps: this.game.loop.actualFps
        });
    }

    private renderPerspective() {
        if (!this.perspectiveCanvas || !this.perspectiveCtx) return;
        if (!this.textures.exists(this.waterTilesetKey)) return;

        const canvas = this.perspectiveCanvas;
        const ctx = this.perspectiveCtx;
        const screenW = this.scale.width;
        const screenH = this.scale.height;

        if (canvas.width !== screenW || canvas.height !== screenH) {
            canvas.width = screenW;
            canvas.height = screenH;
        }

        ctx.imageSmoothingEnabled = false;

        const tilesetImage = this.textures.get(this.waterTilesetKey).getSourceImage() as HTMLImageElement | undefined;
        if (!tilesetImage) return;

        const breathOffset = Math.sin(this.breathTime * (Math.PI * 2) / this.waterBreathCycleSeconds) * this.waterBreathRangePx;
        const horizonY = screenH * 0.42 + breathOffset;
        const waterTop = horizonY;
        const waterBottom = screenH + breathOffset;

        const worldTime = this.worldTimeManager.getTime();
        const skyColor = this.getSkyColor(worldTime);
        // Sky
        ctx.fillStyle = skyColor;
        ctx.fillRect(0, 0, screenW, waterTop);

        // Water base
        ctx.fillStyle = '#1c4f7e';
        ctx.fillRect(0, waterTop, screenW, waterBottom - waterTop);

        const baseTileSize = this.waterTileSize * 3;
        const rows = Math.max(12, Math.ceil((waterBottom - waterTop) / (baseTileSize * 0.45))) + 1;
        const frameCount = this.waterAnimTileIds.length;

        for (let i = 0; i < rows - 1; i++) {
            const t = i / Math.max(1, rows - 1);
            const depth = Math.pow(t, 2.2);
            const nextDepth = Math.pow(Math.min(1, (i + 1) / Math.max(1, rows - 1)), 2.2);

            const y0 = waterTop + (waterBottom - waterTop) * depth;
            const y1 = waterTop + (waterBottom - waterTop) * nextDepth;
            const rowHeight = Math.max(1, y1 - y0);
            const scale = rowHeight / baseTileSize;
            const tileWidth = baseTileSize * scale;
            const cols = Math.ceil(screenW / tileWidth) + 4;

            const startX = screenW / 2 - (cols * tileWidth) / 2;

            for (let col = 0; col < cols; col++) {
                const animIndex = Math.floor((this.waterTime / this.waterFrameDuration + i * 0.3 + col * 0.2) % frameCount);
                const tileId = this.waterAnimTileIds[(animIndex + frameCount) % frameCount];
                const srcX = (tileId % this.waterTilesetColumns) * this.waterTileSize;
                const srcY = Math.floor(tileId / this.waterTilesetColumns) * this.waterTileSize;

                const drawX = startX + col * tileWidth;
                const drawY = y0;

                ctx.drawImage(
                    tilesetImage,
                    srcX,
                    srcY,
                    this.waterTileSize,
                    this.waterTileSize,
                    drawX,
                    drawY,
                    tileWidth + 1,
                    rowHeight + 1
                );
            }
        }

        // Update the Phaser texture from the canvas
        if (this.perspectiveTextureKey && this.perspectiveCanvas) {
            if (!this.textures.exists(this.perspectiveTextureKey)) {
                this.textures.addCanvas(this.perspectiveTextureKey, this.perspectiveCanvas);
            } else {
                this.textures.get(this.perspectiveTextureKey).refresh();
            }
            this.perspectiveImage?.setTexture(this.perspectiveTextureKey);
        }
    }

    private getSkyColor(worldTime: { season: number; hour: number; minute: number; second: number; brightness: number }) {
        const NIGHT_COLOR = { r: 160, g: 175, b: 255 };
        const DAWN_COLOR = { r: 255, g: 200, b: 180 };
        const DAY_COLOR = { r: 170, g: 210, b: 240 };
        const DUSK_COLOR = { r: 255, g: 170, b: 140 };

        const { sunrise, sunset } = DAYLIGHT_HOURS[worldTime.season as keyof typeof DAYLIGHT_HOURS];
        const currentHour = worldTime.hour + worldTime.minute / 60 + worldTime.second / 3600;
        const transitionDuration = 1.5;

        const lerpColor = (c1: typeof NIGHT_COLOR, c2: typeof NIGHT_COLOR, t: number) => ({
            r: Math.floor(Phaser.Math.Linear(c1.r, c2.r, t)),
            g: Math.floor(Phaser.Math.Linear(c1.g, c2.g, t)),
            b: Math.floor(Phaser.Math.Linear(c1.b, c2.b, t))
        });

        let baseColor = NIGHT_COLOR;
        if (currentHour < sunrise - transitionDuration) {
            baseColor = NIGHT_COLOR;
        } else if (currentHour < sunrise + transitionDuration) {
            if (currentHour < sunrise) {
                const t = (currentHour - (sunrise - transitionDuration)) / transitionDuration;
                baseColor = lerpColor(NIGHT_COLOR, DAWN_COLOR, t);
            } else {
                const t = (currentHour - sunrise) / transitionDuration;
                baseColor = lerpColor(DAWN_COLOR, DAY_COLOR, t);
            }
        } else if (currentHour < sunset - transitionDuration) {
            baseColor = DAY_COLOR;
        } else if (currentHour < sunset + transitionDuration) {
            if (currentHour < sunset) {
                const t = (currentHour - (sunset - transitionDuration)) / transitionDuration;
                baseColor = lerpColor(DAY_COLOR, DUSK_COLOR, t);
            } else {
                const t = (currentHour - sunset) / transitionDuration;
                baseColor = lerpColor(DUSK_COLOR, NIGHT_COLOR, t);
            }
        } else {
            baseColor = NIGHT_COLOR;
        }

        const brightness = Phaser.Math.Clamp(worldTime.brightness, 0, 1);
        const r = Phaser.Math.Clamp(Math.floor(baseColor.r * brightness), 0, 255);
        const g = Phaser.Math.Clamp(Math.floor(baseColor.g * brightness), 0, 255);
        const b = Phaser.Math.Clamp(Math.floor(baseColor.b * brightness), 0, 255);

        return `rgb(${r}, ${g}, ${b})`;
    }

    private createUI() {
        const frameScale = 2;
        this.previewFrame = this.add.image(0, 0, 'ui-item-info-frame').setOrigin(1, 0);
        this.previewFrame.setScale(frameScale);
        this.previewFrame.setDepth(10);

        this.stopButtonLabel = this.add.text(0, 0, 'Stop Fishing', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '12px',
            color: '#f2e9dd'
        }).setOrigin(0.5);

        this.stopButtonBg = this.add.image(0, 0, 'ui-group-button-selected').setOrigin(0.5);
        this.stopButton = this.add.container(0, 0, [this.stopButtonBg, this.stopButtonLabel]);
        this.stopButton.setDepth(10);

        this.stopButtonBg.setInteractive({ useHandCursor: false });
        this.stopButtonBg.on('pointerdown', () => {
            this.markAfkActivity();
            this.stopFishing();
        });

        this.castButtonLabel = this.add.text(0, 0, 'Cast', {
            fontFamily: 'Minecraft, monospace',
            fontSize: '18px',
            color: '#f2e9dd'
        }).setOrigin(0.5);
        this.castButtonBg = this.add.image(0, 0, 'ui-group-button-selected').setOrigin(0.5);
        this.castButton = this.add.container(0, 0, [this.castButtonBg, this.castButtonLabel]);
        this.castButton.setDepth(10);

        this.castButtonBg.setInteractive({ useHandCursor: false });
        this.castButtonBg.on('pointerdown', () => this.handleCastPress());
        this.castButtonBg.on('pointerup', () => this.handleCastRelease());
        this.castButtonBg.on('pointerout', () => this.handleCastRelease());
        this.castButtonBg.on('pointerupoutside', () => this.handleCastRelease());

        this.castBar = this.createBar(10);
        this.castBar.bg.setVisible(false);
        this.castBar.fill.setVisible(false);
        this.castBar.maskGraphics.setVisible(false);

        this.biteText = this.add.text(0, 0, '', {
            fontFamily: 'Minecraft, monospace',
            fontSize: `${this.biteTextSize}px`,
            color: '#f2e9dd'
        }).setOrigin(0.5, 0);
        this.biteText.setDepth(12);
        this.biteText.setVisible(false);

        this.biteHint = this.add.text(0, 0, '', {
            fontFamily: 'Minecraft, monospace',
            fontSize: `${this.biteHintSize}px`,
            color: '#f2e9dd'
        }).setOrigin(0.5, 0);
        this.biteHint.setDepth(12);
        this.biteHint.setVisible(false);

        this.biteTimeBar = this.createBar(11);
        this.biteClickBar = this.createBar(11);
        this.setBarVisible(this.biteTimeBar, false);
        this.setBarVisible(this.biteClickBar, false);

        this.castLineGraphics = this.add.graphics();
        this.castLineGraphics.setDepth(4);
    }

    private createSplashEmitter() {
        if (!this.textures.exists(this.splashTextureKey)) {
            const graphics = this.make.graphics({ x: 0, y: 0 }, false);
            const size = 8;
            graphics.fillStyle(0xffffff, 1);
            graphics.fillRect(2, 2, 4, 4);
            graphics.fillStyle(0xffffff, 0.7);
            graphics.fillRect(1, 3, 1, 2);
            graphics.fillRect(6, 3, 1, 2);
            graphics.fillRect(3, 1, 2, 1);
            graphics.fillRect(3, 6, 2, 1);
            graphics.generateTexture(this.splashTextureKey, size, size);
            graphics.destroy();
        }

        this.splashEmitter = this.add.particles(0, 0, this.splashTextureKey, {
            speed: { min: this.splashSpeedMin, max: this.splashSpeedMax },
            angle: { min: -160, max: -20 },
            scale: { start: this.splashScaleStartMin, end: this.splashScaleEnd },
            alpha: { start: this.splashAlphaStart, end: 0 },
            lifespan: { min: this.splashLifespanMin, max: this.splashLifespanMax },
            gravityY: this.splashGravity,
            quantity: 0,
            emitting: false
        });
        this.splashEmitter.setDepth(this.splashDepth);
    }

    private layoutAll() {
        // Resize perspective image
        if (this.perspectiveImage) {
            this.perspectiveImage.setPosition(this.scale.width / 2, this.scale.height / 2);
            this.perspectiveImage.setDisplaySize(this.scale.width, this.scale.height);
        }
        this.layoutRod();
        this.layoutUI();
    }

    private layoutRod() {
        if (!this.rodSprite || !this.rodSideWidth || !this.rodSideHeight) return;

        const width = this.scale.width;
        const height = this.scale.height;
        const targetWidth = width * this.rodTargetWidthRatio;
        const maxHeight = height * 0.9;

        let displayWidth = targetWidth;
        let displayHeight = (this.rodSideHeight / this.rodSideWidth) * displayWidth;
        if (displayHeight > maxHeight) {
            displayHeight = maxHeight;
            displayWidth = (this.rodSideWidth / this.rodSideHeight) * displayHeight;
        }

        const scaleX = displayWidth / this.rodSideWidth;
        const scaleY = displayHeight / this.rodSideHeight;
        this.rodBaseScaleX = scaleX;
        this.rodBaseScaleY = scaleY;
        this.rodBaseOriginX = this.rodSprite.originX;
        this.rodBaseOriginY = this.rodSprite.originY;
        this.rodSprite.setScale(scaleX, scaleY);
        this.rodBaseX = width * (1 - this.rodOffsetXRatio) - this.rodMarginX;
        this.rodBaseY = height + this.rodBottomOverlap;
        this.rodSprite.setPosition(this.rodBaseX, this.rodBaseY);
    }

    private updateRodBreathing() {
        if (!this.rodSprite) return;
        const bob = Math.sin(this.breathTime * (Math.PI * 2) / this.rodBreathCycleSeconds) * this.rodBreathRangePx;
        const pull = this.rodThrowPull;
        const pullRotation = Phaser.Math.Linear(0, 0.7, pull);
        const pullScaleX = 1 + pull * 0.22;
        const pullScaleY = 1 + pull * 0.48;
        const pullOffsetX = pull * 24;
        const pullOffsetY = pull * 16;
        this.rodSprite.setScale(this.rodBaseScaleX * pullScaleX, this.rodBaseScaleY * pullScaleY);
        this.rodSprite.setRotation(pullRotation);
        this.rodSprite.setPosition(this.rodBaseX + pullOffsetX, this.rodBaseY + bob + pullOffsetY);
    }

    private onResize() {
        this.layoutAll();
    }

    private stopFishing() {
        this.markAfkActivity();
        const gameScene = this.scene.get('GameScene');
        gameScene?.events.emit('fishing:stop');
        this.scene.stop();
        this.scene.resume('GameScene');
    }

    private layoutUI() {
        if (!this.previewFrame || !this.stopButton || !this.stopButtonBg || !this.stopButtonLabel) return;

        const width = this.scale.width;
        const frameX = width - this.frameMargin;
        const frameY = this.frameTopOffset;
        this.previewFrame.setPosition(frameX, frameY);

        const targetButtonWidth = Math.round(this.previewFrame.displayWidth);
        const targetButtonHeight = Math.max(18, Math.ceil(this.stopButtonLabel.height + 10));
        this.updateButtonTexture(targetButtonWidth, targetButtonHeight);

        this.stopButtonBg.setDisplaySize(targetButtonWidth, targetButtonHeight);
        this.stopButtonLabel.setPosition(0, 0);

        const buttonX = frameX - this.previewFrame.displayWidth / 2;
        const buttonY = frameY + this.previewFrame.displayHeight + this.buttonSpacing + targetButtonHeight / 2;
        this.stopButton.setPosition(buttonX, buttonY);

        if (!this.castButton || !this.castButtonBg || !this.castButtonLabel) return;

        const castButtonTargetWidth = Math.round(Math.min(320, Math.max(200, width * 0.35)));
        const castButtonTargetHeight = Math.max(26, Math.ceil(this.castButtonLabel.height + 16));
        this.updateCastButtonTexture(castButtonTargetWidth, castButtonTargetHeight);

        this.castButtonBg.setDisplaySize(castButtonTargetWidth, castButtonTargetHeight);
        this.castButtonLabel.setPosition(0, 0);

        const castButtonX = width / 2;
        const castButtonY = this.scale.height - this.castButtonBottomMargin - castButtonTargetHeight / 2;
        this.castButton.setPosition(castButtonX, castButtonY);

        if (this.castBar) {
            const castBarWidth = Math.round(castButtonTargetWidth * 0.9);
            const castBarHeight = Math.max(10, Math.round(castButtonTargetHeight * 0.35));
            const castBarY = castButtonY - castButtonTargetHeight / 2 - this.castBarSpacing - castBarHeight / 2;
            this.layoutBar(this.castBar, castButtonX, castBarY, castBarWidth, castBarHeight);
        }

        const biteTextX = width / 2;
        const biteTextY = Math.round(this.scale.height * this.biteTextTopRatio);
        this.biteText?.setPosition(biteTextX, biteTextY);

        if (this.biteTimeBar && this.biteClickBar) {
            const biteBarWidth = Math.round(Math.min(320, Math.max(220, width * 0.32)));
            const biteBarHeight = 10;
            const biteTimeY = biteTextY + this.biteTextSize + this.biteTextPadding;
            const biteClickY = biteTimeY + biteBarHeight + this.biteBarSpacing;
            const biteHintY = biteClickY + biteBarHeight + this.biteBarSpacing;
            this.layoutBar(this.biteTimeBar, biteTextX, biteTimeY, biteBarWidth, biteBarHeight);
            this.layoutBar(this.biteClickBar, biteTextX, biteClickY, biteBarWidth, biteBarHeight);
            this.biteHint?.setPosition(biteTextX, biteHintY);
        }
    }

    private updateButtonTexture(width: number, height: number) {
        if (
            width === this.currentButtonWidth
            && height === this.currentButtonHeight
            && this.buttonTextureKey
            && this.textures.exists(this.buttonTextureKey)
        ) {
            return;
        }
        this.currentButtonWidth = width;
        this.currentButtonHeight = height;

        const newKey = this.createNineSliceTexture('ui-group-button-selected', width, height, 6, 6);
        const oldKey = this.buttonTextureKey;
        this.buttonTextureKey = newKey;
        this.stopButtonBg?.setTexture(newKey);

        if (oldKey && oldKey !== newKey && this.textures.exists(oldKey)) {
            this.textures.remove(oldKey);
        }
    }

    private updateCastButtonTexture(width: number, height: number) {
        if (
            width === this.castButtonWidth
            && height === this.castButtonHeight
            && this.castButtonTextureKey
            && this.textures.exists(this.castButtonTextureKey)
        ) {
            return;
        }
        this.castButtonWidth = width;
        this.castButtonHeight = height;

        const newKey = this.createNineSliceTexture('ui-group-button-selected', width, height, 6, 6, `__fish_cast_btn_${this.castButtonTextureCounter++}`);
        const oldKey = this.castButtonTextureKey;
        this.castButtonTextureKey = newKey;
        this.castButtonBg?.setTexture(newKey);

        if (oldKey && oldKey !== newKey && this.textures.exists(oldKey)) {
            this.textures.remove(oldKey);
        }
    }

    private createNineSliceTexture(key: string, width: number, height: number, borderX: number, borderY: number, overrideKey?: string) {
        const srcTexture = this.textures.get(key);
        const srcImage = srcTexture.getSourceImage() as HTMLImageElement;
        const srcW = srcImage.width;
        const srcH = srcImage.height;

        const centerSrcW = srcW - borderX * 2;
        const centerSrcH = srcH - borderY * 2;
        const centerW = Math.max(1, width - borderX * 2);
        const centerH = Math.max(1, height - borderY * 2);

        const rtKey = overrideKey ?? `__fish_btn_${this.buttonTextureCounter++}`;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        ctx.drawImage(srcImage, 0, 0, borderX, borderY, 0, 0, borderX, borderY);
        ctx.drawImage(srcImage, borderX, 0, centerSrcW, borderY, borderX, 0, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, 0, borderX, borderY, borderX + centerW, 0, borderX, borderY);

        ctx.drawImage(srcImage, 0, borderY, borderX, centerSrcH, 0, borderY, borderX, centerH);
        ctx.drawImage(srcImage, borderX, borderY, centerSrcW, centerSrcH, borderX, borderY, centerW, centerH);
        ctx.drawImage(srcImage, srcW - borderX, borderY, borderX, centerSrcH, borderX + centerW, borderY, borderX, centerH);

        ctx.drawImage(srcImage, 0, srcH - borderY, borderX, borderY, 0, borderY + centerH, borderX, borderY);
        ctx.drawImage(srcImage, borderX, srcH - borderY, centerSrcW, borderY, borderX, borderY + centerH, centerW, borderY);
        ctx.drawImage(srcImage, srcW - borderX, srcH - borderY, borderX, borderY, borderX + centerW, borderY + centerH, borderX, borderY);

        this.textures.addCanvas(rtKey, canvas);
        return rtKey;
    }

    private createBar(depth: number): BarVisual {
        const textureKey = this.createNineSliceTexture('ui-hud-stamina-bg', 100, 10, 4, 2, `__fish_bar_${this.buttonTextureCounter++}`);
        const bg = this.add.image(0, 0, textureKey).setOrigin(0.5, 0.5);
        const fill = this.add.tileSprite(0, 0, 1, 1, 'ui-hud-stamina-fill').setOrigin(0, 0.5);
        const maskGraphics = this.add.graphics();
        maskGraphics.setVisible(false);
        const mask = maskGraphics.createGeometryMask();
        fill.setMask(mask);
        bg.setDepth(depth);
        fill.setDepth(depth);
        maskGraphics.setDepth(depth);
        return {
            bg,
            fill,
            maskGraphics,
            mask,
            textureKey,
            width: 100,
            height: 10,
            innerW: 1,
            innerH: 1,
            x: 0,
            y: 0,
            value: 0
        };
    }

    private layoutBar(bar: BarVisual, x: number, y: number, width: number, height: number) {
        if (bar.width !== width || bar.height !== height) {
            const newKey = this.createNineSliceTexture('ui-hud-stamina-bg', width, height, 4, 2, `__fish_bar_${this.buttonTextureCounter++}`);
            const oldKey = bar.textureKey;
            bar.textureKey = newKey;
            bar.bg.setTexture(newKey);
            if (oldKey && oldKey !== newKey && this.textures.exists(oldKey)) {
                this.textures.remove(oldKey);
            }
            bar.width = width;
            bar.height = height;
        }

        bar.x = x;
        bar.y = y;
        bar.bg.setPosition(x, y);

        bar.innerW = Math.max(1, width - 8);
        bar.innerH = Math.max(1, height - 4);
        const fillX = x - width / 2 + 4 - 1;
        bar.fill.setPosition(fillX, y);

        const fillTexture = this.textures.get('ui-hud-stamina-fill');
        const source = fillTexture.getSourceImage() as HTMLImageElement | undefined;
        if (source && source.height > 0) {
            const scaleY = bar.innerH / source.height;
            bar.fill.setTileScale(1, scaleY);
        }

        this.setBarValue(bar, bar.value);
    }

    private setBarValue(bar: BarVisual, value: number) {
        bar.value = Phaser.Math.Clamp(value, 0, 1);
        const fillWidth = Math.max(1, Math.round(bar.innerW * bar.value));
        const fillX = bar.x - bar.width / 2 + 4 - 1;
        if (bar.value <= 0) {
            bar.fill.setVisible(false);
            bar.maskGraphics.clear();
            return;
        }

        bar.fill.setVisible(true);
        bar.fill.setSize(bar.innerW, bar.innerH);
        bar.fill.setDisplaySize(bar.innerW, bar.innerH);
        bar.maskGraphics.clear();
        bar.maskGraphics.fillStyle(0xffffff, 1);
        bar.maskGraphics.fillRect(fillX, bar.y - bar.innerH / 2, fillWidth, bar.innerH);
    }

    private setBarVisible(bar: BarVisual, visible: boolean) {
        bar.bg.setVisible(visible);
        bar.fill.setVisible(visible);
        bar.maskGraphics.setVisible(false);
    }

    private handleCastPress() {
        this.markAfkActivity();
        if (!this.castButtonLabel) return;
        if (this.isReelInAnimating) return;
        if (this.biteActive) {
            this.handleReelClick();
            return;
        }
        if (this.casted) {
            this.reelLineBack();
            return;
        }

        this.isHoldingCast = true;
        this.castHoldStart = this.time.now;
        this.castHoldDuration = 0;
        if (this.castBar) {
            this.setBarVisible(this.castBar, true);
            this.setBarValue(this.castBar, 0);
        }
    }

    private handleCastRelease() {
        if (!this.isHoldingCast) return;
        this.isHoldingCast = false;

        if (this.castHoldDuration < this.castMinHoldMs) {
            this.castHoldDuration = 0;
            if (this.castBar) {
                this.setBarVisible(this.castBar, false);
            }
            this.releaseRodWithoutCast();
            return;
        }

        this.castPower = Phaser.Math.Clamp((this.castHoldDuration - this.castMinHoldMs) / (this.castMaxHoldMs - this.castMinHoldMs), 0, 1);
        this.currentDepth = Phaser.Math.Linear(this.castDepthMin, this.castDepthMax, this.castPower);
        this.pendingCastRelease = true;
        this.releaseRodWithCast();
    }

    private updateCastHold(delta: number) {
        if (!this.isHoldingCast) return;
        this.castHoldDuration = Math.min(this.castMaxHoldMs, this.time.now - this.castHoldStart);
        const ratio = Phaser.Math.Clamp(this.castHoldDuration / this.castMaxHoldMs, 0, 1);
        this.setRodThrowPull(ratio);
        if (this.castBar) {
            this.setBarValue(this.castBar, ratio);
        }
    }

    private startCast() {
        this.casted = true;
        this.pendingCastRelease = false;
        this.setCastButtonLabel('Reel');
        this.playRodCastSound();
        if (this.castBar) {
            this.setBarVisible(this.castBar, false);
        }

        this.castLineProgress = 0;
        this.castTossProgress = 0;
        this.castSettleProgress = 0;
        this.isCastTossing = true;
        this.isCastSettling = false;
        this.castLineTween?.stop();
        this.castTossTween?.stop();
        this.castSettleTween?.stop();

        const castDuration = Phaser.Math.Linear(300, 820, this.castPower);
        this.castTossTween = this.tweens.add({
            targets: this,
            castTossProgress: 1,
            duration: castDuration,
            ease: 'Sine.out',
            onComplete: () => {
                this.isCastTossing = false;
                this.isCastSettling = true;
                this.playWaterSplash();
                const splashPos = this.getCurrentLineEnd(this.getRodTipPosition());
                this.triggerWaterSplash(splashPos);
                const baseLift = this.getCastLift();
                const tossSettleMax = 0.7;
                this.castSettleStartLift = baseLift * (1 - tossSettleMax);
                this.castSettleTween = this.tweens.add({
                    targets: this,
                    castSettleProgress: 1,
                    duration: 900,
                    ease: 'Sine.out',
                    onComplete: () => {
                        this.isCastSettling = false;
                    }
                });
            }
        });

        this.castLineEnd = this.getCastTarget(this.castPower);
        this.castLineBaseEnd = this.castLineEnd.clone();
        this.networkManager.sendFishingCast(this.currentDepth, 'temperate');
        this.queueBite();
    }

    private resetCast(updateButtonLabel: boolean = true) {
        this.casted = false;
        this.castPower = 0;
        this.currentDepth = this.castDepthMin;
        this.castLineProgress = 0;
        this.castLineEnd = undefined;
        this.castLineBaseEnd = undefined;
        this.castLineTween?.stop();
        this.castTossTween?.stop();
        this.castSettleTween?.stop();
        this.isCastTossing = false;
        this.isCastSettling = false;
        this.castLineGraphics?.clear();
        this.reelInTween?.stop();
        this.reelInTween = undefined;
        this.reelInProgress = 0;
        this.reelInStart = undefined;
        this.isReelInAnimating = false;
        this.rodThrowTween?.stop();
        this.rodThrowTween = undefined;
        this.rodThrowPull = 0;
        this.pendingCastRelease = false;
        this.caughtItemSprite?.destroy();
        this.caughtItemSprite = undefined;
        if (updateButtonLabel) {
            this.setCastButtonLabel('Cast');
        }
        this.clearBite();
    }

    private setCastButtonLabel(text: string) {
        if (!this.castButtonLabel) return;
        this.castButtonLabel.setText(text);
    }

    private setRodThrowPull(value: number) {
        this.rodThrowPull = Phaser.Math.Clamp(value, 0, 1);
    }

    private releaseRodWithoutCast() {
        this.rodThrowTween?.stop();
        this.rodThrowTween = this.tweens.add({
            targets: this,
            rodThrowPull: 0,
            duration: 220,
            ease: 'Sine.out'
        });
    }

    private releaseRodWithCast() {
        this.rodThrowTween?.stop();
        this.rodThrowTween = this.tweens.add({
            targets: this,
            rodThrowPull: 0,
            duration: 140,
            ease: 'Sine.out'
        });
        if (this.pendingCastRelease) {
            this.startCast();
        }
    }

    private queueBite() {
        this.biteTimer?.remove(false);
        const rodStats = getRodStats(this.rodItemId);
        const speed = Math.max(0.1, rodStats.speedMultiplier);
        const minDelay = Math.round(this.baseBiteDelayMinMs / speed);
        const maxDelay = Math.round(this.baseBiteDelayMaxMs / speed);
        const delayMs = Phaser.Math.Between(minDelay, Math.max(minDelay + 1, maxDelay));
        this.biteTimer = this.time.delayedCall(delayMs, () => this.startBite());
    }

    private startBite() {
        if (!this.casted) return;
        if (this.isReelReturning) return;
        this.biteActive = true;
        this.reelClicks = 0;
        this.reelClicksNeeded = 10;
        this.hookItemId = undefined;
        this.cameras.main.shake(160, 0.004);
        this.startBiteAlert();

        if (this.biteText) {
            const message = this.biteMessages[Phaser.Math.Between(0, this.biteMessages.length - 1)];
            this.biteText.setText(message);
            this.updateBiteTextColor();
            this.biteText.setVisible(true);
        }

        if (this.biteHint) {
            this.biteHint.setText('');
            this.updateBiteTextColor();
            this.biteHint.setVisible(true);
        }

        if (this.biteTimeBar && this.biteClickBar) {
            this.setBarVisible(this.biteTimeBar, true);
            this.setBarVisible(this.biteClickBar, true);
            this.setBarValue(this.biteTimeBar, 1);
            this.setBarValue(this.biteClickBar, 0);
        }

        this.networkManager.sendFishingHook();

        this.biteWindowTimer?.remove(false);
        this.biteWindowTimer = this.time.delayedCall(this.biteWindowMs, () => this.failBite());
    }

    private handleReelClick() {
        this.markAfkActivity();
        if (!this.biteActive) return;
        this.cameras.main.shake(60, 0.003);
        this.reelClicks = Math.min(this.reelClicksNeeded, this.reelClicks + 1);
        this.playReelClickSounds(this.reelClicks);
        this.updateReelLinePull();
        if (this.biteClickBar) {
            this.setBarValue(this.biteClickBar, this.reelClicks / this.reelClicksNeeded);
        }
        if (this.reelClicks >= this.reelClicksNeeded) {
            this.completeCatch();
        }
    }

    private updateBiteBars() {
        if (!this.biteActive || !this.biteWindowTimer || !this.biteTimeBar) return;
        const remaining = Math.max(0, this.biteWindowMs - this.biteWindowTimer.getElapsed());
        const ratio = remaining / this.biteWindowMs;
        this.setBarValue(this.biteTimeBar, ratio);
        this.updateBiteHint(remaining);
        this.updateBiteAlertRate(ratio);
    }

    private completeCatch() {
        this.biteActive = false;
        this.networkManager.sendFishingCatch();
        this.clearBite();
    }

    private failBite() {
        if (!this.biteActive) return;
        this.biteActive = false;
        this.clearBite();
    }

    private clearBite() {
        this.biteTimer?.remove(false);
        this.biteWindowTimer?.remove(false);
        this.hookItemId = undefined;
        this.stopBiteAlert();
        if (this.biteText) {
            this.biteText.setVisible(false);
        }
        if (this.biteHint) {
            this.biteHint.setVisible(false);
        }
        if (this.biteTimeBar) {
            this.setBarVisible(this.biteTimeBar, false);
        }
        if (this.biteClickBar) {
            this.setBarVisible(this.biteClickBar, false);
        }
    }

    private updateBiteTextColor() {
        const color = this.getBiteTextColor();
        this.biteText?.setColor(color);
        this.biteHint?.setColor(color);
    }

    private updateBiteHint(remainingMs: number) {
        if (!this.biteHint) return;
        const clicksLeft = Math.max(0, this.reelClicksNeeded - this.reelClicks);
        const secondsLeft = Math.max(0, remainingMs / 1000);
        this.biteHint.setText(`Click ${clicksLeft} more times in ${secondsLeft.toFixed(1)} seconds!`);
        this.updateBiteTextColor();
    }

    private getBiteTextColor() {
        const worldTime = this.worldTimeManager.getTime();
        const { sunrise, sunset } = DAYLIGHT_HOURS[worldTime.season as keyof typeof DAYLIGHT_HOURS];
        const currentHour = worldTime.hour + worldTime.minute / 60 + worldTime.second / 3600;
        const isDay = currentHour >= sunrise && currentHour < sunset;
        return isDay ? '#101010' : '#ffffff';
    }

    private updateCastLine() {
        if (!this.castLineGraphics) return;
        if (!this.casted || !this.castLineEnd) {
            this.castLineGraphics.clear();
            return;
        }
        const start = this.getRodTipPosition();
        let end = this.getCurrentLineEnd(start);
        let t = 1;
        let curveScale = 1;

        if (this.isCastTossing) {
            const baseT = Phaser.Math.Clamp(this.castTossProgress, 0, 1);
            const perspective = Phaser.Math.Linear(1, 1.6, this.castPower);
            t = Math.pow(baseT, perspective);
            const lift = this.getCastLift();
            const settleStart = 0.35;
            const settleT = Phaser.Math.Clamp((baseT - settleStart) / (1 - settleStart), 0, 1);
            const settleEase = Phaser.Math.Easing.Quadratic.In(settleT);
            const tossSettleMax = 0.7;
            const settleLift = lift * (1 - settleEase * tossSettleMax);
            this.drawCastLineToss(start, end, t, settleLift, 0);
            return;
        }

        if (this.isCastSettling) {
            const settleT = Phaser.Math.Clamp(this.castSettleProgress, 0, 1);
            const settleEase = Phaser.Math.Easing.Quadratic.In(settleT);
            const settleLift = this.castSettleStartLift * (1 - settleEase);
            this.drawCastLineToss(start, end, 1, settleLift, settleT);
            return;
        }

        this.drawCastLineFinal(start, end);
    }

    private getCurrentLineEnd(start: Phaser.Math.Vector2) {
        if (!this.isReelInAnimating || !this.reelInStart) {
            if (!this.castLineEnd) return start;
            const breathOffset = this.getWaterBreathOffset();
            return new Phaser.Math.Vector2(this.castLineEnd.x, this.castLineEnd.y + breathOffset);
        }
        const t = Phaser.Math.Clamp(this.reelInProgress, 0, 1);
        return new Phaser.Math.Vector2(
            Phaser.Math.Linear(this.reelInStart.x, start.x, t),
            Phaser.Math.Linear(this.reelInStart.y, start.y, t)
        );
    }

    private drawCastLineToss(start: Phaser.Math.Vector2, end: Phaser.Math.Vector2, progress: number, lift: number, sagBlend: number) {
        if (!this.castLineGraphics) return;
        this.castLineGraphics.clear();
        this.castLineGraphics.lineStyle(2, 0x000000, 1);

        const sag = this.getFinalLineSag(start, end) * Phaser.Math.Clamp(sagBlend, 0, 1);

        const control1 = new Phaser.Math.Vector2(
            Phaser.Math.Linear(start.x, end.x, 0.25),
            Phaser.Math.Linear(start.y, end.y, 0.25) - lift + sag * this.lineFinalControl1SagRatio
        );
        const control2 = new Phaser.Math.Vector2(
            Phaser.Math.Linear(start.x, end.x, 0.75),
            Phaser.Math.Linear(start.y, end.y, 0.75) - lift * 0.85 + sag * this.lineFinalControl2SagRatio
        );

        const curve = new Phaser.Curves.CubicBezier(start, control1, control2, end);
        const points = curve.getPoints(26);
        const maxIndex = Math.max(1, Math.floor(points.length * progress));

        this.castLineGraphics.beginPath();
        this.castLineGraphics.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < maxIndex; i++) {
            this.castLineGraphics.lineTo(points[i].x, points[i].y);
        }
        this.castLineGraphics.strokePath();
    }

    private drawCastLineFinal(start: Phaser.Math.Vector2, end: Phaser.Math.Vector2) {
        if (!this.castLineGraphics) return;
        this.castLineGraphics.clear();
        this.castLineGraphics.lineStyle(2, 0x000000, 1);

        const sag = this.getFinalLineSag(start, end);
        const control1 = new Phaser.Math.Vector2(
            Phaser.Math.Linear(start.x, end.x, this.lineFinalControl1T),
            Phaser.Math.Linear(start.y, end.y, this.lineFinalControl1T) + sag * this.lineFinalControl1SagRatio
        );
        const control2 = new Phaser.Math.Vector2(
            Phaser.Math.Linear(start.x, end.x, this.lineFinalControl2T),
            Phaser.Math.Linear(start.y, end.y, this.lineFinalControl2T) + sag * this.lineFinalControl2SagRatio
        );

        const straightness = Phaser.Math.Clamp(this.lineFinalEndStraightness, 0, 1);
        control2.x = Phaser.Math.Linear(control2.x, end.x, straightness);
        control2.y = Phaser.Math.Linear(control2.y, end.y, straightness);

        const curve = new Phaser.Curves.CubicBezier(start, control1, control2, end);
        const points = curve.getPoints(26);

        this.castLineGraphics.beginPath();
        this.castLineGraphics.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            this.castLineGraphics.lineTo(points[i].x, points[i].y);
        }
        this.castLineGraphics.strokePath();
    }

    private getFinalLineSag(start: Phaser.Math.Vector2, end: Phaser.Math.Vector2) {
        const distance = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y);
        const power = Math.pow(Phaser.Math.Clamp(this.castPower, 0, 1), this.lineFinalSagPower);
        const baseSag = Phaser.Math.Linear(this.lineFinalSagMin, this.lineFinalSagMax, power);
        return Math.min(baseSag, distance * this.lineFinalSagDistanceFactor);
    }

    private getWaterBreathOffset() {
        return Math.sin(this.breathTime * (Math.PI * 2) / this.waterBreathCycleSeconds) * this.waterBreathRangePx;
    }

    private getRodTipPosition() {
        if (this.rodSprite) {
            const tip = this.rodSprite.getTopRight();
            return new Phaser.Math.Vector2(tip.x, tip.y + 12);
        }
        return new Phaser.Math.Vector2(this.scale.width * 0.7, this.scale.height * 0.5);
    }

    private getCastTarget(power: number) {
        const width = this.scale.width;
        const height = this.scale.height;
        const baseX = width * 0.5;
        const offsetX = Phaser.Math.Linear(-width * 0.08, width * 0.08, power);
        const y = Phaser.Math.Linear(height * 0.8, height * 0.43, power);
        return new Phaser.Math.Vector2(baseX + offsetX, y);
    }

    private getCastLift() {
        return Phaser.Math.Linear(this.scale.height * 0.12, this.scale.height * 0.22, this.castPower);
    }

    private updateReelLinePull() {
        if (!this.casted || !this.castLineBaseEnd) return;
        const start = this.getRodTipPosition();
        const base = this.castLineBaseEnd;
        const progress = Phaser.Math.Clamp(
            (this.reelClicks / Math.max(1, this.reelClicksNeeded)) * this.reelPullMaxProgress,
            0,
            this.reelPullMaxProgress
        );
        this.castLineEnd = new Phaser.Math.Vector2(
            Phaser.Math.Linear(base.x, start.x, progress),
            Phaser.Math.Linear(base.y, start.y, progress)
        );
    }

    private triggerWaterSplash(position: Phaser.Math.Vector2) {
        if (!this.splashEmitter) return;
        const power = Phaser.Math.Clamp(this.castPower, 0, 1);
        const count = Math.round(Phaser.Math.Linear(this.splashCountMin, this.splashCountMax, power));
        const startScale = Phaser.Math.Linear(this.splashScaleStartMin, this.splashScaleStartMax, power);
        const speedMin = Phaser.Math.Linear(this.splashSpeedMin, this.splashSpeedMax * 0.7, power);
        const speedMax = Phaser.Math.Linear(this.splashSpeedMax, this.splashSpeedMax * 1.25, power);
        const lifespanMin = Phaser.Math.Linear(this.splashLifespanMin, this.splashLifespanMax * 0.85, power);
        const lifespanMax = Phaser.Math.Linear(this.splashLifespanMax, this.splashLifespanMax * 1.2, power);

        this.splashEmitter.setParticleScale(startScale, this.splashScaleEnd);
        this.splashEmitter.setParticleSpeed(speedMin, speedMax);
        this.splashEmitter.setParticleLifespan({ min: lifespanMin, max: lifespanMax });
        this.splashEmitter.setParticleAlpha({ start: this.splashAlphaStart, end: 0 });

        const spread = this.splashSpreadBase + power * this.splashSpreadPower;
        this.splashEmitter.emitParticleAt(
            position.x + Phaser.Math.Between(-spread, spread),
            position.y,
            count
        );
    }

    private setupGuiOpenListener() {
        this.guiOpenHandler = (_parent: any, value: boolean) => {
            this.setFishingUiVisible(!value);
        };
        this.registry.events.on('changedata-guiOpen', this.guiOpenHandler);
        const current = this.registry.get('guiOpen') === true;
        this.setFishingUiVisible(!current);
    }

    private setFishingUiVisible(visible: boolean) {
        this.previewFrame?.setVisible(visible);
        this.stopButton?.setVisible(visible);
        this.castButton?.setVisible(visible);
        if (this.castBar) {
            this.setBarVisible(this.castBar, visible && this.isHoldingCast);
        }
    }

    private drawCastLine(start: Phaser.Math.Vector2, end: Phaser.Math.Vector2, progress: number, curveScale: number = 1) {
        if (!this.castLineGraphics) return;
        this.castLineGraphics.clear();
        this.castLineGraphics.lineStyle(2, 0x000000, 1);

        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        const curveOffset = Phaser.Math.Linear(18, 46, this.castPower) * curveScale;
        const control1 = new Phaser.Math.Vector2(
            Phaser.Math.Linear(start.x, midX, 0.4),
            Phaser.Math.Linear(start.y, midY, 0.4) - curveOffset
        );
        const control2 = new Phaser.Math.Vector2(
            Phaser.Math.Linear(midX, end.x, 0.6),
            Phaser.Math.Linear(midY, end.y, 0.6) + curveOffset * 0.4
        );

        const curve = new Phaser.Curves.CubicBezier(start, control1, control2, end);
        const points = curve.getPoints(24);
        const maxIndex = Math.max(1, Math.floor(points.length * progress));

        this.castLineGraphics.beginPath();
        this.castLineGraphics.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < maxIndex; i++) {
            this.castLineGraphics.lineTo(points[i].x, points[i].y);
        }
        this.castLineGraphics.strokePath();
    }

    private reelLineBack() {
        if (!this.casted || !this.castLineEnd) return;
        if (this.isReelInAnimating) return;
        this.isReelReturning = true;
        this.biteTimer?.remove(false);
        this.biteActive = false;
        this.clearBite();
        this.playRodReelSound();
        const start = this.getRodTipPosition();
        const end = this.getCurrentLineEnd(start);
        this.isReelInAnimating = true;
        this.reelInStart = new Phaser.Math.Vector2(end.x, end.y);
        this.reelInProgress = 0;
        this.reelInTween?.stop();
        this.reelInTween = this.tweens.add({
            targets: this,
            reelInProgress: 1,
            duration: 420,
            ease: 'Sine.inOut',
            onComplete: () => {
                this.isReelInAnimating = false;
                this.isReelReturning = false;
                this.resetCast();
            }
        });
    }

    private setupCatchListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;
        room.onMessage('fishing:catchResult', (data: { itemId?: string }) => {
            if (!data?.itemId) {
                this.resetCast();
                return;
            }
            this.playCatchAnimation(data.itemId);
        });
    }

    private setupHookListener() {
        const room = this.networkManager.getRoom();
        if (!room) return;
        room.onMessage('fishing:hooked', (data: { itemId?: string; clicksRequired?: number }) => {
            if (!this.biteActive) return;
            if (!data?.itemId || !data?.clicksRequired) return;
            this.hookItemId = data.itemId;
            this.reelClicksNeeded = Math.max(1, Math.floor(data.clicksRequired));
            this.updateReelLinePull();
            if (this.biteClickBar) {
                this.setBarValue(this.biteClickBar, this.reelClicks / this.reelClicksNeeded);
            }
        });
    }

    private playCatchAnimation(itemId: string) {
        if (!this.casted) return;
        if (this.isReelInAnimating) return;

        const textureKey = `item-${itemId}`;
        if (!this.textures.exists(textureKey)) {
            const imagePath = getItemImagePath(itemId);
            if (!imagePath) {
                this.resetCast();
                return;
            }
            this.load.image(textureKey, `/${imagePath}`);
            this.load.once(Phaser.Loader.Events.COMPLETE, () => {
                this.spawnCaughtItem(textureKey);
            });
            this.load.start();
            return;
        }

        this.spawnCaughtItem(textureKey);
    }

    private spawnCaughtItem(textureKey: string) {
        if (!this.castLineEnd) {
            this.resetCast();
            return;
        }

        const start = this.getRodTipPosition();
        this.isReelInAnimating = true;
        this.reelInStart = this.castLineEnd.clone();
        this.reelInProgress = 0;

        this.caughtItemSprite?.destroy();
        this.caughtItemSprite = this.add.image(this.reelInStart.x, this.reelInStart.y, textureKey).setOrigin(0.5, 0.5);
        this.caughtItemSprite.setDepth(6);
        this.caughtItemSprite.setScale(3.5);

        const apex = new Phaser.Math.Vector2(start.x, start.y - 120);
        const landing = new Phaser.Math.Vector2(this.scale.width / 2, this.scale.height - 20);
        const spinAmount = Phaser.Math.DegToRad(200);

        this.tweens.add({
            targets: this.caughtItemSprite,
            x: apex.x,
            y: apex.y,
            rotation: spinAmount * 0.6,
            duration: 260,
            ease: 'Sine.out'
        });

        this.tweens.add({
            targets: this.caughtItemSprite,
            x: landing.x,
            y: landing.y,
            rotation: spinAmount,
            duration: 420,
            delay: 260,
            ease: 'Quad.in'
        });

        this.reelInTween?.stop();
        this.reelInTween = this.tweens.add({
            targets: this,
            reelInProgress: 1,
            duration: 520,
            ease: 'Sine.inOut',
            onComplete: () => {
                this.isReelInAnimating = false;
                this.resetCast(false);
                this.fadeCastButtonToIdle();
            }
        });
    }

    private fadeCastButtonToIdle() {
        if (!this.castButton) return;
        this.castButtonFadeTween?.stop();
        this.castButton.setAlpha(1);
        this.castButtonFadeTween = this.tweens.add({
            targets: this.castButton,
            alpha: 0,
            duration: 500,
            ease: 'Sine.out',
            onComplete: () => {
                this.setCastButtonLabel('Cast');
                this.castButtonFadeTween = this.tweens.add({
                    targets: this.castButton,
                    alpha: 1,
                    duration: 500,
                    ease: 'Sine.out'
                });
            }
        });
    }

    private getAudioManager(): AudioManager | undefined {
        const gameScene = this.scene.get('GameScene') as { getAudioManager?: () => AudioManager | undefined };
        return gameScene?.getAudioManager?.();
    }

    private playRodCastSound() {
        const audio = this.getAudioManager();
        audio?.playRodCast(this.castPower);
    }

    private playRodReelSound() {
        const audio = this.getAudioManager();
        audio?.playRodReel();
    }

    private playReelClickSounds(clickIndex: number) {
        const audio = this.getAudioManager();
        if (!audio) return;
        if (clickIndex >= this.reelClicksNeeded) {
            audio.playRodReelBurst(3);
        } else {
            audio.playRodReel();
        }
        audio.playReelClick(clickIndex - 1);
    }

    private playWaterSplash() {
        const audio = this.getAudioManager();
        audio?.playWaterSplash();
    }

    private startBiteAlert() {
        const audio = this.getAudioManager();
        if (!audio) return;
        if (this.biteAlertSound) {
            audio.stopBiteAlertLoop(this.biteAlertSound);
        }
        this.biteAlertSound = audio.startBiteAlertLoop();
    }

    private updateBiteAlertRate(remainingRatio: number) {
        if (!this.biteAlertSound) return;
        const audio = this.getAudioManager();
        audio?.updateBiteAlertLoop(this.biteAlertSound, remainingRatio);
    }

    private stopBiteAlert() {
        const audio = this.getAudioManager();
        audio?.stopBiteAlertLoop(this.biteAlertSound);
        this.biteAlertSound = undefined;
    }

    shutdown() {
        this.scale.off('resize', this.onResize, this);
        if (this.scene.get('UIScene')) {
            const uiScene = this.scene.get('UIScene') as any;
            uiScene?.setHudVisible?.(true);
        }
        if (this.debugToggleHandler) {
            this.input.keyboard?.off('keydown-H', this.debugToggleHandler, this);
            this.debugToggleHandler = undefined;
        }
        if (this.guiOpenHandler) {
            this.registry.events.off('changedata-guiOpen', this.guiOpenHandler);
            this.guiOpenHandler = undefined;
        }
        this.stopButton?.destroy();
        this.previewFrame?.destroy();
        this.castButton?.destroy();
        this.castBar?.bg.destroy();
        this.castBar?.fill.destroy();
        this.castBar?.maskGraphics.destroy();
        this.biteTimeBar?.bg.destroy();
        this.biteTimeBar?.fill.destroy();
        this.biteTimeBar?.maskGraphics.destroy();
        this.biteClickBar?.bg.destroy();
        this.biteClickBar?.fill.destroy();
        this.biteClickBar?.maskGraphics.destroy();
        this.biteText?.destroy();
        this.biteHint?.destroy();
        this.castLineGraphics?.destroy();
        this.splashEmitter?.destroy();
        this.caughtItemSprite?.destroy();
        this.perspectiveImage?.destroy();
        this.rodSprite?.destroy();
        this.lightingManager?.destroy();
        if (this.buttonTextureKey && this.textures.exists(this.buttonTextureKey)) {
            this.textures.remove(this.buttonTextureKey);
        }
        if (this.castButtonTextureKey && this.textures.exists(this.castButtonTextureKey)) {
            this.textures.remove(this.castButtonTextureKey);
        }
        this.buttonTextureKey = undefined;
        this.castButtonTextureKey = undefined;
        this.currentButtonWidth = 0;
        this.currentButtonHeight = 0;
        this.castButtonWidth = 0;
        this.castButtonHeight = 0;
        [this.castBar, this.biteTimeBar, this.biteClickBar].forEach((bar) => {
            if (bar?.textureKey && this.textures.exists(bar.textureKey)) {
                this.textures.remove(bar.textureKey);
            }
        });
        if (this.perspectiveTextureKey && this.textures.exists(this.perspectiveTextureKey)) {
            this.textures.remove(this.perspectiveTextureKey);
        }
        if (this.rodSideTextureKey && this.textures.exists(this.rodSideTextureKey)) {
            this.textures.remove(this.rodSideTextureKey);
        }
        if (this.textures.exists(this.splashTextureKey)) {
            this.textures.remove(this.splashTextureKey);
        }
        this.stopBiteAlert();
    }
}
