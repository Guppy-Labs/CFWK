import {
    Application,
    BlurFilter,
    Container,
    Graphics,
    Sprite,
    Texture
} from 'pixi.js';
import {
    FishAgentPhysics,
    FishState,
    applySpeedTarget,
    avoidPoint,
    chooseAmbientState,
    clamp,
    damp,
    limitVector,
    nextStateDurationMs,
    randomBetween,
    steerTowards,
    vectorLength
} from './FishBehavior';
import { createFishTexturePool, randomFishCountForHighDensity } from './FishAssets';

type FishAgent = FishAgentPhysics & {
    id: number;
    sprite: Sprite;
    tintShift: number;
    baseScale: number;
    previousState: FishState;
    headingRad: number;
};

type FoodPellet = {
    x: number;
    y: number;
    lifeMs: number;
    radius: number;
    sprite: Sprite;
};

type Ripple = {
    x: number;
    y: number;
    ageMs: number;
    lifeMs: number;
};

type AreaBounds = {
    left: number;
    top: number;
    width: number;
    height: number;
};

type FishBowlSimulatorOptions = {
    host: HTMLElement;
    pageElement: HTMLElement;
    heroElement: HTMLElement;
    newsElement: HTMLElement;
};

const GRID_CELL_SIZE = 72;
const BASE_FISH_ROTATION_RAD = Math.PI / 4; // Assets need +45deg to face right.
const MAX_ANGULAR_VELOCITY_RAD_PER_SEC = 2.4;

function lerpAngle(current: number, target: number, t: number): number {
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + delta * t;
}

function rotateTowards(current: number, target: number, maxStepRad: number): number {
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    const limited = clamp(delta, -maxStepRad, maxStepRad);
    return current + limited;
}

export class FishBowlSimulator {
    private readonly host: HTMLElement;
    private readonly pageElement: HTMLElement;
    private readonly heroElement: HTMLElement;
    private readonly newsElement: HTMLElement;

    private app: Application | null = null;
    private rootLayer: Container | null = null;
    private waterLayer: Container | null = null;
    private foodLayer: Container | null = null;
    private fishLayer: Container | null = null;
    private effectsLayer: Graphics | null = null;
    private maskGraphics: Graphics | null = null;
    private ribbonA: Sprite | null = null;
    private ribbonB: Sprite | null = null;

    private fish: FishAgent[] = [];
    private foods: FoodPellet[] = [];
    private ripples: Ripple[] = [];
    private texturePool: Texture[] = [];

    private enabled = true;
    private running = false;
    private nextFishId = 1;
    private area: AreaBounds = { left: 0, top: 0, width: 0, height: 0 };
    private simulationTimeMs = 0;
    private nowMs = performance.now();

    constructor(options: FishBowlSimulatorOptions) {
        this.host = options.host;
        this.pageElement = options.pageElement;
        this.heroElement = options.heroElement;
        this.newsElement = options.newsElement;
    }

    async start(): Promise<void> {
        if (this.running) return;
        if (!this.app) {
            await this.initPixi();
        }
        this.running = true;
        this.setCanvasVisible(this.enabled);
    }

    stop() {
        if (!this.running) return;
        this.running = false;
        this.setCanvasVisible(false);
    }

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        this.setCanvasVisible(enabled && this.running);
    }

    destroy() {
        window.removeEventListener('resize', this.handleResize);
        if (this.app) {
            this.app.ticker.remove(this.update);
            this.app.destroy(true, { children: true, texture: false });
            this.app = null;
        }
        this.host.innerHTML = '';
        this.fish = [];
        this.foods = [];
        this.ripples = [];
        this.running = false;
    }

    handlePointerDown(x: number, y: number): boolean {
        if (!this.enabled || !this.running) return false;
        if (!this.isPointInsideArea(x, y)) return false;

        let nearestFish: FishAgent | null = null;
        let nearestDistance = Infinity;
        for (const fish of this.fish) {
            const dist = vectorLength(fish.x - x, fish.y - y);
            if (dist < nearestDistance && dist <= fish.radius + 10) {
                nearestDistance = dist;
                nearestFish = fish;
            }
        }

        if (nearestFish) {
            this.triggerFlee(nearestFish, x, y);
            return true;
        }

        this.spawnFoodAt(x, y);
        return true;
    }

    private async initPixi() {
        const app = new Application();
        await app.init({
            resizeTo: window,
            backgroundAlpha: 0,
            antialias: true,
            preference: 'webgl'
        });

        this.app = app;
        this.host.innerHTML = '';
        this.host.appendChild(app.canvas as HTMLCanvasElement);

        const root = new Container();
        const water = new Container();
        const food = new Container();
        const fish = new Container();
        const effects = new Graphics();
        const mask = new Graphics();

        root.addChild(water);
        root.addChild(food);
        root.addChild(fish);
        root.addChild(effects);
        root.mask = mask;

        app.stage.addChild(root);
        app.stage.addChild(mask);

        const waterBase = new Sprite(Texture.WHITE);
        waterBase.tint = 0x10303c;
        waterBase.alpha = 0.5;
        water.addChild(waterBase);

        const ribbonA = new Sprite(Texture.WHITE);
        ribbonA.tint = 0x2d8fb0;
        ribbonA.alpha = 0.12;
        ribbonA.filters = [new BlurFilter({ strength: 18 })];
        water.addChild(ribbonA);

        const ribbonB = new Sprite(Texture.WHITE);
        ribbonB.tint = 0x6bc5de;
        ribbonB.alpha = 0.08;
        ribbonB.filters = [new BlurFilter({ strength: 24 })];
        water.addChild(ribbonB);

        this.rootLayer = root;
        this.waterLayer = water;
        this.foodLayer = food;
        this.fishLayer = fish;
        this.effectsLayer = effects;
        this.maskGraphics = mask;
        this.ribbonA = ribbonA;
        this.ribbonB = ribbonB;

        this.texturePool = await createFishTexturePool(42);
        this.setupAreaAndPopulation(true);

        this.nowMs = performance.now();
        app.ticker.add(this.update);
        window.addEventListener('resize', this.handleResize);
    }

    private readonly handleResize = () => {
        this.setupAreaAndPopulation(false);
    };

    private setupAreaAndPopulation(resetFish: boolean) {
        if (!this.app || !this.maskGraphics || !this.waterLayer || !this.ribbonA || !this.ribbonB) return;

        const newsRect = this.newsElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const safeTop = 0;
        const targetHeight = Math.max(260, Math.floor(newsRect.top));

        this.area = {
            left: 0,
            top: Math.floor(safeTop),
            width: Math.max(320, Math.floor(viewportWidth)),
            height: Math.max(260, targetHeight)
        };

        this.maskGraphics.clear();
        this.maskGraphics.rect(this.area.left, this.area.top, this.area.width, this.area.height).fill({ color: 0xffffff, alpha: 1 });

        const waterBase = this.waterLayer.children[0] as Sprite;
        waterBase.x = this.area.left;
        waterBase.y = this.area.top;
        waterBase.width = this.area.width;
        waterBase.height = this.area.height;

        this.ribbonA.x = this.area.left - 120;
        this.ribbonA.y = this.area.top + this.area.height * 0.28;
        this.ribbonA.width = this.area.width + 240;
        this.ribbonA.height = 58;

        this.ribbonB.x = this.area.left - 180;
        this.ribbonB.y = this.area.top + this.area.height * 0.64;
        this.ribbonB.width = this.area.width + 360;
        this.ribbonB.height = 74;

        if (resetFish) {
            this.resetFishPopulation();
            return;
        }

        const desiredCount = randomFishCountForHighDensity(this.area.width, this.area.height);
        while (this.fish.length < desiredCount) this.spawnFish();
        while (this.fish.length > desiredCount && this.fishLayer) {
            const removed = this.fish.pop();
            if (removed) this.fishLayer.removeChild(removed.sprite);
        }
    }

    private resetFishPopulation() {
        if (!this.fishLayer) return;
        this.fishLayer.removeChildren();
        this.fish = [];
        const count = randomFishCountForHighDensity(this.area.width, this.area.height);
        for (let i = 0; i < count; i += 1) this.spawnFish();
    }

    private spawnFish() {
        if (!this.fishLayer || this.texturePool.length === 0) return;

        const texture = this.texturePool[Math.floor(Math.random() * this.texturePool.length)];
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.eventMode = 'static';
        sprite.cursor = 'pointer';

        const width = this.area.width;
        const height = this.area.height;
        const compactViewport = width < 820 || height < 540;
        const veryCompactViewport = width < 560 || height < 420;
        const scaleMin = veryCompactViewport ? 0.62 : compactViewport ? 0.78 : 1.05;
        const scaleMax = veryCompactViewport ? 1.02 : compactViewport ? 1.24 : 1.8;
        const scale = randomBetween(scaleMin, scaleMax);
        sprite.scale.set(scale);
        sprite.alpha = randomBetween(0.86, 1);

        const radius = 10 * scale;
        const x = randomBetween(this.area.left + radius, this.area.left + this.area.width - radius);
        const y = randomBetween(this.area.top + radius, this.area.top + this.area.height - radius);
        const vx = randomBetween(-30, 30);
        const vy = randomBetween(-22, 22);
        const personality = randomBetween(0.72, 1.25);

        const fish: FishAgent = {
            id: this.nextFishId++,
            sprite,
            x,
            y,
            vx,
            vy,
            ax: 0,
            ay: 0,
            radius,
            preferredSpeed: randomBetween(34, 58),
            maxSpeed: randomBetween(88, 132),
            state: 'wander',
            stateUntilMs: this.nowMs + nextStateDurationMs('wander'),
            targetId: null,
            avoidUntilMs: 0,
            personality,
            tintShift: randomBetween(0.92, 1.08),
            patternSlot: Math.floor(Math.random() * 32),
            baseScale: scale,
            previousState: 'wander',
            headingRad: Math.atan2(vy, vx) + BASE_FISH_ROTATION_RAD
        };

        sprite.position.set(x, y);
        sprite.tint = Math.random() < 0.35 ? 0xd5f2ff : 0xffffff;
        sprite.rotation = fish.headingRad;

        this.fishLayer.addChild(sprite);
        this.fish.push(fish);
    }

    private triggerFlee(fish: FishAgent, sourceX: number, sourceY: number) {
        fish.state = 'flee';
        fish.stateUntilMs = this.nowMs + nextStateDurationMs('flee');
        fish.avoidUntilMs = this.nowMs + 1200;
        avoidPoint(fish, sourceX, sourceY, 520 * fish.personality);
        this.ripples.push({ x: fish.x, y: fish.y, ageMs: 0, lifeMs: 540 });
    }

    private spawnFoodAt(x: number, y: number) {
        if (!this.enabled || !this.running || !this.foodLayer) return;
        const drops = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < drops; i += 1) {
            const pelletSprite = new Sprite(Texture.WHITE);
            pelletSprite.tint = 0xffd27a;
            pelletSprite.alpha = 0.95;
            const radius = randomBetween(2.5, 4.6);
            pelletSprite.width = radius * 2;
            pelletSprite.height = radius * 2;
            pelletSprite.anchor.set(0.5);

            const px = x + randomBetween(-20, 20);
            const py = y + randomBetween(-14, 14);
            pelletSprite.position.set(px, py);
            this.foodLayer.addChild(pelletSprite);

            this.foods.push({
                x: px,
                y: py,
                lifeMs: randomBetween(4000, 7600),
                radius,
                sprite: pelletSprite
            });
        }
        this.ripples.push({ x, y, ageMs: 0, lifeMs: 720 });
    }

    private isPointInsideArea(x: number, y: number) {
        return (
            x >= this.area.left &&
            x <= this.area.left + this.area.width &&
            y >= this.area.top &&
            y <= this.area.top + this.area.height
        );
    }

    private readonly update = (ticker: { deltaMS: number }) => {
        if (!this.running || !this.app || !this.rootLayer || !this.effectsLayer || !this.ribbonA || !this.ribbonB) return;

        const dt = Math.min(34, ticker.deltaMS) / 1000;
        this.nowMs += ticker.deltaMS;
        this.simulationTimeMs += ticker.deltaMS;
        this.rootLayer.visible = this.enabled;
        if (!this.enabled) return;

        const now = this.nowMs;
        this.updateWaterMotion(now);
        this.updateFood(dt);

        const neighborhood = this.buildNeighborGrid();
        const centerX = this.area.left + this.area.width / 2;
        const centerY = this.area.top + this.area.height / 2;
        const patternRadius = Math.min(this.area.width, this.area.height) * 0.28;

        for (let i = 0; i < this.fish.length; i += 1) {
            const fish = this.fish[i];
            fish.ax = 0;
            fish.ay = 0;

            if (fish.stateUntilMs <= now) {
                fish.state = this.chooseNextState(fish);
                fish.stateUntilMs = now + nextStateDurationMs(fish.state);
                fish.targetId = null;
                fish.previousState = fish.state;
            }

            const nearby = this.collectNearbyFish(fish, neighborhood);
            const closeFood = this.findNearestFood(fish);
            if (closeFood) {
                fish.state = 'feed';
                fish.stateUntilMs = now + nextStateDurationMs('feed');
                steerTowards(fish, closeFood.x, closeFood.y, 240 * fish.personality);
            } else {
                this.applyStateForces(fish, nearby, centerX, centerY, patternRadius, now);
            }

            this.applySharedForces(fish, nearby, dt, now);
            // Cap translational acceleration so force blending stays natural.
            const maxAcceleration = fish.state === 'flee'
                ? 260
                : fish.state === 'feed'
                    ? 230
                    : 170;
            const limitedAcceleration = limitVector(fish.ax, fish.ay, maxAcceleration);
            fish.ax = limitedAcceleration.x;
            fish.ay = limitedAcceleration.y;

            fish.vx += fish.ax * dt;
            fish.vy += fish.ay * dt;
            applySpeedTarget(fish, 1);

            fish.x += fish.vx * dt;
            fish.y += fish.vy * dt;

            this.keepInsideArea(fish);
            this.updateFishSprite(fish, dt);
        }

        this.resolveFishBumps(neighborhood);
        this.drawRipples(dt);
    };

    private updateWaterMotion(now: number) {
        if (!this.ribbonA || !this.ribbonB) return;
        const t = now / 1000;
        this.ribbonA.x = this.area.left - 130 + Math.sin(t * 0.32) * 38;
        this.ribbonA.y = this.area.top + this.area.height * 0.27 + Math.sin(t * 0.9) * 8;
        this.ribbonB.x = this.area.left - 190 - Math.cos(t * 0.25) * 44;
        this.ribbonB.y = this.area.top + this.area.height * 0.63 + Math.cos(t * 0.7) * 10;
    }

    private updateFood(dt: number) {
        if (!this.foodLayer) return;
        for (let i = this.foods.length - 1; i >= 0; i -= 1) {
            const food = this.foods[i];
            food.lifeMs -= dt * 1000;
            food.y += dt * 7;
            food.sprite.position.set(food.x, food.y);
            food.sprite.alpha = clamp(food.lifeMs / 2400, 0, 1);
            if (food.lifeMs <= 0) {
                this.foodLayer.removeChild(food.sprite);
                this.foods.splice(i, 1);
            }
        }
    }

    private findNearestFood(fish: FishAgent): FoodPellet | null {
        let nearest: FoodPellet | null = null;
        let best = Infinity;
        for (const food of this.foods) {
            const distance = vectorLength(food.x - fish.x, food.y - fish.y);
            if (distance < best && distance < 220) {
                best = distance;
                nearest = food;
            }
            if (distance < fish.radius + food.radius + 4) {
                food.lifeMs = 0;
            }
        }
        return nearest;
    }

    private buildNeighborGrid(): Map<string, FishAgent[]> {
        const grid = new Map<string, FishAgent[]>();
        for (const fish of this.fish) {
            const key = this.gridKey(fish.x, fish.y);
            const cell = grid.get(key);
            if (cell) cell.push(fish);
            else grid.set(key, [fish]);
        }
        return grid;
    }

    private collectNearbyFish(fish: FishAgent, grid: Map<string, FishAgent[]>): FishAgent[] {
        const neighbors: FishAgent[] = [];
        const baseX = Math.floor(fish.x / GRID_CELL_SIZE);
        const baseY = Math.floor(fish.y / GRID_CELL_SIZE);

        for (let ox = -1; ox <= 1; ox += 1) {
            for (let oy = -1; oy <= 1; oy += 1) {
                const key = `${baseX + ox}:${baseY + oy}`;
                const bucket = grid.get(key);
                if (!bucket) continue;
                for (const other of bucket) {
                    if (other.id !== fish.id) neighbors.push(other);
                }
            }
        }

        return neighbors;
    }

    private applyStateForces(
        fish: FishAgent,
        nearby: FishAgent[],
        centerX: number,
        centerY: number,
        patternRadius: number,
        now: number
    ) {
        if (fish.state === 'rest') {
            fish.vx = damp(fish.vx, 0.962);
            fish.vy = damp(fish.vy, 0.962);
            return;
        }

        if (fish.state === 'flee' || fish.avoidUntilMs > now) {
            fish.ax += randomBetween(-32, 32);
            fish.ay += randomBetween(-26, 26);
            return;
        }

        if ((fish.state === 'chase' || fish.state === 'kiss') && nearby.length > 0) {
            if (fish.targetId === null || !nearby.some((entry) => entry.id === fish.targetId)) {
                fish.targetId = nearby[Math.floor(Math.random() * nearby.length)]?.id ?? null;
            }
            const target = nearby.find((entry) => entry.id === fish.targetId) ?? null;
            if (target) {
                const dx = target.x - fish.x;
                const dy = target.y - fish.y;
                const dist = Math.max(0.0001, vectorLength(dx, dy));
                if (fish.state === 'chase') {
                    steerTowards(fish, target.x, target.y, 260 * fish.personality);
                } else {
                    if (dist > 18) steerTowards(fish, target.x, target.y, 180 * fish.personality);
                    else {
                        fish.vx *= 0.92;
                        fish.vy *= 0.92;
                    }
                }
            }
        }

        if (fish.state === 'pattern') {
            const angle = (fish.patternSlot / 32) * Math.PI * 2 + this.simulationTimeMs * 0.00035;
            const targetX = centerX + Math.cos(angle) * patternRadius;
            const targetY = centerY + Math.sin(angle * 1.6) * (patternRadius * 0.62);
            steerTowards(fish, targetX, targetY, 160 * fish.personality);
        }

        if (fish.state === 'school') {
            this.applySchooling(fish, nearby, 1);
        } else if (fish.state === 'pattern') {
            this.applySchooling(fish, nearby, 0.6);
        } else if (fish.state === 'wander') {
            this.applySchooling(fish, nearby, 0.2);
        }

        if (fish.state === 'wander') {
            fish.ax += Math.sin(this.simulationTimeMs * 0.0008 + fish.id * 0.73) * 30 * fish.personality;
            fish.ay += Math.cos(this.simulationTimeMs * 0.0006 + fish.id * 0.37) * 24 * fish.personality;
        }
    }

    private applySchooling(fish: FishAgent, nearby: FishAgent[], intensity: number) {
        let cohesionX = 0;
        let cohesionY = 0;
        let alignX = 0;
        let alignY = 0;
        let count = 0;

        for (const other of nearby) {
            const dx = other.x - fish.x;
            const dy = other.y - fish.y;
            const dist = vectorLength(dx, dy);
            if (dist > 150 || dist < 22) continue;
            cohesionX += other.x;
            cohesionY += other.y;
            alignX += other.vx;
            alignY += other.vy;
            count += 1;
        }

        if (count >= 2) {
            cohesionX /= count;
            cohesionY /= count;
            steerTowards(fish, cohesionX, cohesionY, 24 * intensity);
            fish.ax += (alignX / count) * (0.18 * intensity);
            fish.ay += (alignY / count) * (0.18 * intensity);
        }
    }

    private applySharedForces(fish: FishAgent, nearby: FishAgent[], dt: number, now: number) {
        let localCentroidX = 0;
        let localCentroidY = 0;
        let localCount = 0;

        for (const other of nearby) {
            const dx = fish.x - other.x;
            const dy = fish.y - other.y;
            const dist = Math.max(0.0001, vectorLength(dx, dy));
            const minDist = fish.radius + other.radius + 8;
            if (dist < minDist) {
                const push = (minDist - dist) * 14;
                fish.ax += (dx / dist) * push;
                fish.ay += (dy / dist) * push;
            }

            if (dist < 95) {
                localCentroidX += other.x;
                localCentroidY += other.y;
                localCount += 1;
            }
        }

        // Anti-cluster correction: if local neighborhood gets dense, push fish away
        // from the local centroid to prevent eventual center clumping.
        if (localCount >= 7) {
            localCentroidX /= localCount;
            localCentroidY /= localCount;
            avoidPoint(fish, localCentroidX, localCentroidY, 62 + localCount * 4.2);
            fish.ax += randomBetween(-12, 12);
            fish.ay += randomBetween(-10, 10);
        }

        const edgeMargin = 48;
        const edgeForce = 240;
        const right = this.area.left + this.area.width;
        const bottom = this.area.top + this.area.height;
        if (fish.x < this.area.left + edgeMargin) fish.ax += edgeForce * dt;
        if (fish.x > right - edgeMargin) fish.ax -= edgeForce * dt;
        if (fish.y < this.area.top + edgeMargin) fish.ay += edgeForce * dt;
        if (fish.y > bottom - edgeMargin) fish.ay -= edgeForce * dt;

        fish.ax += randomBetween(-6, 6);
        fish.ay += randomBetween(-6, 6);

        // Let fish finish their current behavior phase to avoid jittery state churn.
    }

    private resolveFishBumps(grid: Map<string, FishAgent[]>) {
        for (const fish of this.fish) {
            const neighbors = this.collectNearbyFish(fish, grid);
            for (const other of neighbors) {
                if (other.id <= fish.id) continue;
                const dx = other.x - fish.x;
                const dy = other.y - fish.y;
                const dist = Math.max(0.0001, vectorLength(dx, dy));
                const minDist = fish.radius + other.radius;
                if (dist >= minDist) continue;

                const overlap = (minDist - dist) * 0.5;
                const nx = dx / dist;
                const ny = dy / dist;
                fish.x -= nx * overlap;
                fish.y -= ny * overlap;
                other.x += nx * overlap;
                other.y += ny * overlap;

                fish.vx -= nx * 9;
                fish.vy -= ny * 9;
                other.vx += nx * 9;
                other.vy += ny * 9;
            }
        }
    }

    private keepInsideArea(fish: FishAgent) {
        const right = this.area.left + this.area.width;
        const bottom = this.area.top + this.area.height;
        fish.x = clamp(fish.x, this.area.left + fish.radius, right - fish.radius);
        fish.y = clamp(fish.y, this.area.top + fish.radius, bottom - fish.radius);
    }

    private updateFishSprite(fish: FishAgent, dt: number) {
        fish.sprite.position.set(fish.x, fish.y);
        const velocity = limitVector(fish.vx, fish.vy, fish.maxSpeed);
        fish.vx = velocity.x;
        fish.vy = velocity.y;

        const speed = vectorLength(fish.vx, fish.vy);
        if (speed < fish.preferredSpeed * 0.6 && fish.state !== 'rest') {
            steerTowards(
                fish,
                fish.x + Math.sin(this.simulationTimeMs * 0.001 + fish.id) * 40,
                fish.y + Math.cos(this.simulationTimeMs * 0.001 + fish.id * 0.6) * 35,
                56
            );
        }

        // Use immutable baseScale to avoid cumulative growth/shrink drift.
        const pulse = 1 + Math.sin(this.simulationTimeMs * 0.0028 + fish.id) * 0.008;
        const heading = Math.atan2(fish.vy, fish.vx);
        const targetVisualAngle = heading + BASE_FISH_ROTATION_RAD;
        const smoothedTargetAngle = lerpAngle(fish.headingRad, targetVisualAngle, 0.28);
        const maxTurnStep = MAX_ANGULAR_VELOCITY_RAD_PER_SEC * dt;
        fish.headingRad = rotateTowards(fish.headingRad, smoothedTargetAngle, maxTurnStep);

        // Lightweight projective warping: no horizontal mirroring, only perspective compression/skew.
        const perspectiveX = 0.8 + 0.2 * Math.abs(Math.cos(heading));
        const perspectiveY = 1.02 + (1 - perspectiveX) * 0.38;
        fish.sprite.scale.set(fish.baseScale * perspectiveX, fish.baseScale * pulse * perspectiveY);
        fish.sprite.skew.x = Math.sin(heading) * 0.15;
        fish.sprite.rotation = fish.headingRad;
        fish.sprite.alpha = fish.state === 'rest'
            ? 0.78
            : clamp(0.84 + speed / fish.maxSpeed * 0.18, 0.78, 1);

        fish.vx = damp(fish.vx, 0.994 - dt * 0.1);
        fish.vy = damp(fish.vy, 0.994 - dt * 0.1);
    }

    private drawRipples(dt: number) {
        if (!this.effectsLayer) return;
        this.effectsLayer.clear();
        this.effectsLayer.stroke({ color: 0x8bdcff, alpha: 0.28, width: 1.5 });
        for (let i = this.ripples.length - 1; i >= 0; i -= 1) {
            const ripple = this.ripples[i];
            ripple.ageMs += dt * 1000;
            if (ripple.ageMs >= ripple.lifeMs) {
                this.ripples.splice(i, 1);
                continue;
            }
            const progress = ripple.ageMs / ripple.lifeMs;
            const radius = 8 + progress * 42;
            const alpha = (1 - progress) * 0.5;
            this.effectsLayer.stroke({ color: 0x8bdcff, alpha, width: 1.4 });
            this.effectsLayer.circle(ripple.x, ripple.y, radius);
        }
    }

    private gridKey(x: number, y: number): string {
        return `${Math.floor(x / GRID_CELL_SIZE)}:${Math.floor(y / GRID_CELL_SIZE)}`;
    }

    private chooseNextState(fish: FishAgent): FishState {
        const fishCount = this.fish.length;
        const roll = Math.random();

        if (fish.state === 'rest') {
            if (roll < 0.75) return 'wander';
            return fishCount > 18 ? 'school' : 'wander';
        }

        if (fish.state === 'wander') {
            if (roll < 0.18) return 'rest';
            if (roll < 0.48 && fishCount > 18) return 'school';
            if (roll < 0.62 && fishCount > 28) return 'pattern';
            if (roll < 0.78 && fishCount > 12) return 'chase';
            if (roll < 0.88 && fishCount > 14) return 'kiss';
            return 'wander';
        }

        if (fish.state === 'school' || fish.state === 'pattern') {
            return roll < 0.24 ? 'rest' : 'wander';
        }

        if (fish.state === 'chase' || fish.state === 'kiss') {
            if (roll < 0.28) return 'rest';
            if (roll < 0.74) return 'wander';
            return fishCount > 18 ? 'school' : 'wander';
        }

        if (fish.state === 'feed' || fish.state === 'flee') {
            return roll < 0.2 ? 'rest' : 'wander';
        }

        return chooseAmbientState(fishCount);
    }

    private setCanvasVisible(visible: boolean) {
        if (!this.app) return;
        const canvas = this.app.canvas as HTMLCanvasElement;
        canvas.style.display = visible ? 'block' : 'none';
    }
}
