export type FishState =
    | 'wander'
    | 'rest'
    | 'school'
    | 'chase'
    | 'kiss'
    | 'pattern'
    | 'flee'
    | 'feed';

export type FishAgentPhysics = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    ax: number;
    ay: number;
    radius: number;
    preferredSpeed: number;
    maxSpeed: number;
    state: FishState;
    stateUntilMs: number;
    targetId: number | null;
    avoidUntilMs: number;
    personality: number;
    patternSlot: number;
};

export function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function vectorLength(x: number, y: number): number {
    return Math.hypot(x, y);
}

export function normalize(x: number, y: number): { x: number; y: number } {
    const length = vectorLength(x, y);
    if (length < 0.00001) return { x: 0, y: 0 };
    return { x: x / length, y: y / length };
}

export function limitVector(x: number, y: number, maxLength: number): { x: number; y: number } {
    const length = vectorLength(x, y);
    if (length <= maxLength || length < 0.00001) return { x, y };
    const scale = maxLength / length;
    return { x: x * scale, y: y * scale };
}

export function damp(current: number, factor: number): number {
    return current * factor;
}

export function chooseAmbientState(fishCount: number): FishState {
    const roll = Math.random();
    if (roll < 0.14) return 'rest';
    if (roll < 0.34) return fishCount > 18 ? 'school' : 'wander';
    if (roll < 0.48) return fishCount > 28 ? 'pattern' : 'wander';
    if (roll < 0.62) return fishCount > 10 ? 'chase' : 'wander';
    if (roll < 0.72) return fishCount > 14 ? 'kiss' : 'wander';
    return 'wander';
}

export function nextStateDurationMs(state: FishState): number {
    switch (state) {
        case 'rest': return randomBetween(1500, 3800);
        case 'school': return randomBetween(2800, 6200);
        case 'pattern': return randomBetween(3600, 8200);
        case 'chase': return randomBetween(1200, 3000);
        case 'kiss': return randomBetween(1000, 2600);
        case 'flee': return randomBetween(800, 1600);
        case 'feed': return randomBetween(1000, 2600);
        default: return randomBetween(1800, 4600);
    }
}

export function steerTowards(
    fish: FishAgentPhysics,
    targetX: number,
    targetY: number,
    strength: number
) {
    const direction = normalize(targetX - fish.x, targetY - fish.y);
    fish.ax += direction.x * strength;
    fish.ay += direction.y * strength;
}

export function avoidPoint(
    fish: FishAgentPhysics,
    pointX: number,
    pointY: number,
    strength: number
) {
    const direction = normalize(fish.x - pointX, fish.y - pointY);
    fish.ax += direction.x * strength;
    fish.ay += direction.y * strength;
}

export function applySpeedTarget(fish: FishAgentPhysics, factor: number) {
    const velocity = limitVector(fish.vx, fish.vy, fish.maxSpeed * factor);
    fish.vx = velocity.x;
    fish.vy = velocity.y;
}
