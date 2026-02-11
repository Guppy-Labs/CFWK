import Phaser from 'phaser';
import { DAYLIGHT_HOURS, getItemImagePath, getRodStats } from '@cfwk/shared';
import { LightingManager } from '../fx/LightingManager';
import { WorldTimeManager } from '../time/WorldTimeManager';
import { NetworkManager } from '../network/NetworkManager';
import { AudioManager } from '../audio/AudioManager';
import { FishingUi } from './fishing/FishingUi';
import { FishingPerspective } from './fishing/FishingPerspective';
import { FishingRodView } from './fishing/FishingRodView';
import { FishingSplash } from './fishing/FishingSplash';
import type { FishingSceneData } from './fishing/types';

export class FishingScene extends Phaser.Scene {
    private ui?: FishingUi;
    private perspective?: FishingPerspective;
    private rodView?: FishingRodView;
    private splash?: FishingSplash;

    private rodItemId?: string;
    private lightingManager?: LightingManager;
    private worldTimeManager = WorldTimeManager.getInstance();
    private guiOpenHandler?: (_parent: any, value: boolean) => void;
    private debugToggleHandler?: (event: KeyboardEvent) => void;
    private networkManager = NetworkManager.getInstance();

    private readonly waterBreathCycleSeconds = 2.8;
    private readonly waterBreathRangePx = 6;

    private waterTime = 0;
    private breathTime = 0;

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
    private readonly biteMessages = [
        'Your rod is shaking!',
        "Something's hooked!",
        'A fish is fighting!',
        'You got a bite!',
        'The line is tugging!'
    ];

    private readonly lineFinalSagMin = 50;
    private readonly lineFinalSagMax = 160;
    private readonly lineFinalSagPower = 1.15;
    private readonly lineFinalSagDistanceFactor = 0.35;
    private readonly lineFinalControl1T = 0.28;
    private readonly lineFinalControl2T = 0.82;
    private readonly lineFinalControl1SagRatio = 0.7;
    private readonly lineFinalControl2SagRatio = 0.2;
    private readonly lineFinalEndStraightness = 0.45;

    private readonly reelPullMaxProgress = 0.8;
    private readonly reelPullDownMin = 6;
    private readonly reelPullDownMax = 90;
    private readonly reelPullDownPower = 1.1;

    private castLineGraphics?: Phaser.GameObjects.Graphics;
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
    private biteAlertSound?: Phaser.Sound.WebAudioSound;
    private rodThrowPull = 0;
    private rodThrowTween?: Phaser.Tweens.Tween;
    private pendingCastRelease = false;

    constructor() {
        super({ key: 'FishingScene' });
    }

    init(data: FishingSceneData) {
        this.rodItemId = data?.rodItemId;
    }

    preload() {
        FishingUi.preload(this);
        FishingPerspective.preload(this);

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
        this.perspective = new FishingPerspective(this);
        this.perspective.create();
        this.rodView = new FishingRodView(this, this.rodItemId);
        this.rodView.create();
        this.enableSceneLighting();
        this.ensureUiVisible();
        this.setupDebugToggle();

        this.ui = new FishingUi(this, {
            onStop: () => {
                this.markAfkActivity();
                this.stopFishing();
            },
            onCastPress: () => this.handleCastPress(),
            onCastRelease: () => this.handleCastRelease()
        });
        this.ui.create();

        this.castLineGraphics = this.add.graphics();
        this.castLineGraphics.setDepth(4);

        this.splash = new FishingSplash(this);
        this.splash.create();

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
        this.perspective?.render(
            this.worldTimeManager.getTime(),
            this.waterTime,
            this.breathTime,
            this.waterBreathCycleSeconds,
            this.waterBreathRangePx
        );
        this.rodView?.update(this.breathTime, this.rodThrowPull);
        this.updateDebugOverlay();
        this.updateCastHold(delta);
        this.updateCastLine();
        this.updateBiteBars();
    }

    private markAfkActivity() {
        this.registry.set('afkActivity', Date.now());
    }

    private enableSceneLighting() {
        const perspectiveImage = this.perspective?.getImage();
        if (perspectiveImage) {
            this.lightingManager?.enableLightingOn(perspectiveImage);
        }
        const rodSprite = this.rodView?.getSprite();
        if (rodSprite) {
            this.lightingManager?.enableLightingOn(rodSprite);
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

    private layoutAll() {
        this.perspective?.layout();
        this.rodView?.layout();
        this.ui?.layout();
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

    private handleCastPress() {
        this.markAfkActivity();
        if (!this.ui) return;
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
        this.ui.setCastBarVisible(true);
        this.ui.setCastBarValue(0);
    }

    private handleCastRelease() {
        if (!this.isHoldingCast) return;
        this.isHoldingCast = false;

        if (this.castHoldDuration < this.castMinHoldMs) {
            this.castHoldDuration = 0;
            this.ui?.setCastBarVisible(false);
            this.releaseRodWithoutCast();
            return;
        }

        this.castPower = Phaser.Math.Clamp((this.castHoldDuration - this.castMinHoldMs) / (this.castMaxHoldMs - this.castMinHoldMs), 0, 1);
        this.currentDepth = Phaser.Math.Linear(this.castDepthMin, this.castDepthMax, this.castPower);
        this.pendingCastRelease = true;
        this.releaseRodWithCast();
    }

    private updateCastHold(_delta: number) {
        if (!this.isHoldingCast) return;
        this.castHoldDuration = Math.min(this.castMaxHoldMs, this.time.now - this.castHoldStart);
        const ratio = Phaser.Math.Clamp(this.castHoldDuration / this.castMaxHoldMs, 0, 1);
        this.setRodThrowPull(ratio);
        this.ui?.setCastBarValue(ratio);
    }

    private startCast() {
        this.casted = true;
        this.pendingCastRelease = false;
        this.ui?.setCastButtonLabel('Reel');
        this.playRodCastSound();
        this.ui?.setCastBarVisible(false);

        this.castTossProgress = 0;
        this.castSettleProgress = 0;
        this.isCastTossing = true;
        this.isCastSettling = false;
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
                this.splash?.triggerWaterSplash(splashPos, this.castPower);
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
        this.castLineEnd = undefined;
        this.castLineBaseEnd = undefined;
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
            this.ui?.setCastButtonLabel('Cast');
        }
        this.clearBite();
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
        this.cameras.main.shake(160, 0.004);
        this.startBiteAlert();

        const message = this.biteMessages[Phaser.Math.Between(0, this.biteMessages.length - 1)];
        const color = this.getBiteTextColor();
        this.ui?.setBiteText(message, true);
        this.ui?.setBiteHint('', true);
        this.ui?.setBiteTextColor(color);
        this.ui?.setBiteBarsVisible(true);
        this.ui?.setBiteTimeRatio(1);
        this.ui?.setBiteClickRatio(0);

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
        this.ui?.setBiteClickRatio(this.reelClicks / this.reelClicksNeeded);
        if (this.reelClicks >= this.reelClicksNeeded) {
            this.completeCatch();
        }
    }

    private updateBiteBars() {
        if (!this.biteActive || !this.biteWindowTimer) return;
        const remaining = Math.max(0, this.biteWindowMs - this.biteWindowTimer.getElapsed());
        const ratio = remaining / this.biteWindowMs;
        this.ui?.setBiteTimeRatio(ratio);
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
        this.stopBiteAlert();
        this.ui?.setBiteText('', false);
        this.ui?.setBiteHint('', false);
        this.ui?.setBiteBarsVisible(false);
    }

    private updateBiteHint(remainingMs: number) {
        const clicksLeft = Math.max(0, this.reelClicksNeeded - this.reelClicks);
        const secondsLeft = Math.max(0, remainingMs / 1000);
        const text = `Click ${clicksLeft} more times in ${secondsLeft.toFixed(1)} seconds!`;
        this.ui?.setBiteHint(text, true);
        this.ui?.setBiteTextColor(this.getBiteTextColor());
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
        const end = this.getCurrentLineEnd(start);

        if (this.isCastTossing) {
            const baseT = Phaser.Math.Clamp(this.castTossProgress, 0, 1);
            const perspective = Phaser.Math.Linear(1, 1.6, this.castPower);
            const t = Math.pow(baseT, perspective);
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
        return this.rodView?.getRodTipPosition()
            ?? new Phaser.Math.Vector2(this.scale.width * 0.7, this.scale.height * 0.5);
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
        const base = this.castLineBaseEnd;
        const progress = Phaser.Math.Clamp(
            (this.reelClicks / Math.max(1, this.reelClicksNeeded)) * this.reelPullMaxProgress,
            0,
            this.reelPullMaxProgress
        );
        const power = Math.pow(Phaser.Math.Clamp(this.castPower, 0, 1), this.reelPullDownPower);
        const downMax = Phaser.Math.Linear(this.reelPullDownMin, this.reelPullDownMax, power);
        const downOffset = downMax * progress;
        this.castLineEnd = new Phaser.Math.Vector2(base.x, base.y + downOffset);
    }

    private setupGuiOpenListener() {
        this.guiOpenHandler = (_parent: any, value: boolean) => {
            this.ui?.setFishingUiVisible(!value, this.isHoldingCast);
        };
        this.registry.events.on('changedata-guiOpen', this.guiOpenHandler);
        const current = this.registry.get('guiOpen') === true;
        this.ui?.setFishingUiVisible(!current, this.isHoldingCast);
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
            this.reelClicksNeeded = Math.max(1, Math.floor(data.clicksRequired));
            this.updateReelLinePull();
            this.ui?.setBiteClickRatio(this.reelClicks / this.reelClicksNeeded);
        });
    }

    private playCatchAnimation(itemId: string) {
        if (!this.casted) return;
        if (this.isReelInAnimating) return;

        this.splash?.triggerCatchSplash(itemId, this.getRodTipPosition());

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
                this.ui?.fadeCastButtonToIdle();
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
        this.ui?.destroy();
        this.ui = undefined;
        this.castLineGraphics?.destroy();
        this.castLineGraphics = undefined;
        this.splash?.destroy();
        this.splash = undefined;
        this.caughtItemSprite?.destroy();
        this.caughtItemSprite = undefined;
        this.perspective?.destroy();
        this.perspective = undefined;
        this.rodView?.destroy();
        this.rodView = undefined;
        this.lightingManager?.destroy();
        this.stopBiteAlert();
    }
}
