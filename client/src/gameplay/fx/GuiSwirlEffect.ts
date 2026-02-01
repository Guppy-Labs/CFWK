import Phaser from 'phaser';

export class GuiSwirlEffect {
    private scene: Phaser.Scene;
    private particles?: Phaser.GameObjects.Particles.ParticleEmitterManager;
    private active = false;
    private angle = 0;
    private lastEmitTime = 0;
    private readonly emitIntervalMs = 60;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.ensureTexture();

        const config = {
            speedX: { min: -6, max: 6 },
            speedY: { min: -28, max: -16 },
            lifespan: { min: 700, max: 900 },
            alpha: { start: 0.5, end: 0 },
            scale: { start: 1, end: 0.2 },
            quantity: 1,
            frequency: -1,
            blendMode: Phaser.BlendModes.ADD
        } as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;

        this.particles = this.scene.add.particles(0, 0, 'gui-spark', config);
        this.particles.setDepth(900);
    }

    setActive(active: boolean) {
        this.active = active;
    }

    update(x: number, y: number) {
        if (!this.active || !this.particles) return;

        const now = this.scene.time.now;
        if (now - this.lastEmitTime < this.emitIntervalMs) return;
        this.lastEmitTime = now;

        this.angle += 0.4;
        const radius = 6;
        const offsetX = Math.cos(this.angle) * radius;
        const offsetY = Math.sin(this.angle) * radius * 0.5;

        this.particles.emitParticleAt(x + offsetX, y + offsetY);
    }

    destroy() {
        this.particles?.destroy();
    }

    private ensureTexture() {
        if (this.scene.textures.exists('gui-spark')) return;

        const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffe66d, 1);
        g.fillRect(0, 0, 2, 2);
        g.generateTexture('gui-spark', 2, 2);
        g.destroy();
    }
}
