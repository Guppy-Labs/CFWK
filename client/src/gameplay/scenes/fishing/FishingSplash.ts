import Phaser from 'phaser';
import { getItemDefinition } from '@cfwk/shared';

export class FishingSplash {
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

    private readonly catchSplashMassMin = 1;
    private readonly catchSplashMassMax = 12;
    private readonly catchSplashCountMin = 4;
    private readonly catchSplashCountMax = 12;
    private readonly catchSplashSpeedMin = 20;
    private readonly catchSplashSpeedMax = 70;
    private readonly catchSplashLifespanMin = 220;
    private readonly catchSplashLifespanMax = 520;
    private readonly catchSplashScaleStartMin = 0.3;
    private readonly catchSplashScaleStartMax = 1.25;
    private readonly catchSplashAlphaStart = 0.85;
    private readonly catchSplashSpreadBase = 4;
    private readonly catchSplashSpreadPower = 12;

    private splashEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

    constructor(private readonly scene: Phaser.Scene) {}

    create() {
        if (!this.scene.textures.exists(this.splashTextureKey)) {
            const graphics = this.scene.make.graphics({ x: 0, y: 0 }, false);
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

        this.splashEmitter = this.scene.add.particles(0, 0, this.splashTextureKey, {
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

    triggerWaterSplash(position: Phaser.Math.Vector2, castPower: number) {
        if (!this.splashEmitter) return;
        const power = Phaser.Math.Clamp(castPower, 0, 1);
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

    triggerCatchSplash(itemId: string, position: Phaser.Math.Vector2) {
        if (!this.splashEmitter) return;
        const def = getItemDefinition(itemId);
        const mass = def?.mass ?? this.catchSplashMassMin;
        const massRatio = Phaser.Math.Clamp(
            (mass - this.catchSplashMassMin) / Math.max(1, this.catchSplashMassMax - this.catchSplashMassMin),
            0,
            1
        );
        const count = Math.round(Phaser.Math.Linear(this.catchSplashCountMin, this.catchSplashCountMax, massRatio));
        const startScale = Phaser.Math.Linear(this.catchSplashScaleStartMin, this.catchSplashScaleStartMax, massRatio);
        const speedMin = Phaser.Math.Linear(this.catchSplashSpeedMin, this.catchSplashSpeedMax * 0.7, massRatio);
        const speedMax = Phaser.Math.Linear(this.catchSplashSpeedMax, this.catchSplashSpeedMax * 1.2, massRatio);
        const lifespanMin = Phaser.Math.Linear(this.catchSplashLifespanMin, this.catchSplashLifespanMax * 0.8, massRatio);
        const lifespanMax = Phaser.Math.Linear(this.catchSplashLifespanMax, this.catchSplashLifespanMax * 1.2, massRatio);

        this.splashEmitter.setParticleScale(startScale, this.splashScaleEnd);
        this.splashEmitter.setParticleSpeed(speedMin, speedMax);
        this.splashEmitter.setParticleLifespan({ min: lifespanMin, max: lifespanMax });
        this.splashEmitter.setParticleAlpha({ start: this.catchSplashAlphaStart, end: 0 });

        const spread = this.catchSplashSpreadBase + massRatio * this.catchSplashSpreadPower;
        this.splashEmitter.emitParticleAt(
            position.x + Phaser.Math.Between(-spread, spread),
            position.y + Phaser.Math.Between(-spread * 0.25, spread * 0.25),
            count
        );
    }

    destroy() {
        this.splashEmitter?.destroy();
        this.splashEmitter = undefined;
        if (this.scene.textures.exists(this.splashTextureKey)) {
            this.scene.textures.remove(this.splashTextureKey);
        }
    }
}
