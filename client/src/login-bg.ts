
const canvas = document.getElementById('fish-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let width: number;
let height: number;

const FISH_SIZE = 32;
const SCALE = 2;
const ACTUAL_SIZE = FISH_SIZE * SCALE;
const TILE_COLS = 18;
const TILE_ROWS = 17;
const TOTAL_FISH = 300;
const TILE_SHEET_SRC = '/assets/fish_tilesheet.png';

interface Fish {
    x: number;
    y: number;
    speed: number;
    baseSpeed: number;
    tileIndex: number;
    flip: boolean;
    wobbleOffset: number;
    rotation: number;
    rotationVelocity: number;
}

interface Bubble {
    x: number;
    y: number;
    size: number;
    speed: number;
    alpha: number;
}

const fishes: Fish[] = [];
const bubbles: Bubble[] = [];
let tileSheet: HTMLImageElement;
let lastTime = 0;
let isRushing = false;
let isSprintingOut = false;
let isSuccess = false;
let successStartTime = 0;

const MAX_SPEED = 50; 
const ACCEL = 1.5;
const DECEL = 0.983;

export function triggerSuccess() {
    isSuccess = true;
    successStartTime = performance.now();
}

export function rushFish() {
    isRushing = true;
    isSprintingOut = true;
    setTimeout(() => {
        isSprintingOut = false;
        fishes.length = 0;

        for(let i=0; i<15; i++) {
             spawnFish(undefined, true); 
        }

        setTimeout(() => {
            isRushing = false;
        }, 800);

    }, 600);
}

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}

function getRandomFishIndex(): number {
    return Math.floor(TOTAL_FISH * (1 - Math.sqrt(Math.random())));
}

function spawnFish(startSide?: 'left' | 'right', fastEntry: boolean = false) {
    const fromLeft = startSide === 'left' || (startSide === undefined && Math.random() > 0.5);
    
    let speed = (Math.random() * 0.5 + 0.2);
    
    if (fastEntry) {
        speed = 50;
    }

    const startOffset = fastEntry ? (Math.random() * 25 + 1) : 1;
    const dir = fromLeft ? 1 : -1;

    const fish: Fish = {
        x: fromLeft ? -ACTUAL_SIZE * startOffset : width + ACTUAL_SIZE * startOffset,
        y: Math.random() * (height - ACTUAL_SIZE),
        speed: speed * dir,
        baseSpeed: (Math.random() * 0.5 + 0.2) * dir,
        tileIndex: getRandomFishIndex(),
        flip: false,
        wobbleOffset: Math.random() * Math.PI * 2,
        rotation: 0,
        rotationVelocity: 0
    };
    
    fish.flip = !fromLeft;
    
    fishes.push(fish);
}

function init() {
    tileSheet = new Image();
    tileSheet.src = TILE_SHEET_SRC;
    tileSheet.onload = () => {
        resize();
        window.addEventListener('resize', resize);
        
        for(let i=0; i<15; i++) {
            const f = {
                x: Math.random() * width,
                y: Math.random() * (height - ACTUAL_SIZE),
                speed: (Math.random() * 0.5 + 0.2) * (Math.random() > 0.5 ? 1 : -1),
                baseSpeed: 0,
                tileIndex: getRandomFishIndex(),
                flip: false,
                wobbleOffset: Math.random() * Math.PI * 2,
                rotation: 0,
                rotationVelocity: 0
            };
            f.baseSpeed = f.speed;
            f.flip = f.speed < 0;
            fishes.push(f);
        }
        
        requestAnimationFrame(loop);
    };
}

function drawFish(fish: Fish, time: number) {
    const col = fish.tileIndex % TILE_COLS;
    const row = Math.floor(fish.tileIndex / TILE_COLS);
    
    const sx = col * FISH_SIZE;
    const sy = row * FISH_SIZE;
    
    // Bobbing motion
    const yOffset = Math.sin(time * 0.002 + fish.wobbleOffset) * 5;
    
    ctx.save();
    ctx.translate(fish.x + ACTUAL_SIZE/2, fish.y + yOffset + ACTUAL_SIZE/2);
    
    if (fish.flip) {
        ctx.scale(-1, 1);
    }

    ctx.rotate(fish.rotation);
    ctx.rotate(Math.PI / 4);
    
    // Draw
    ctx.drawImage(
        tileSheet,
        sx, sy, FISH_SIZE, FISH_SIZE,
        -ACTUAL_SIZE/2, -ACTUAL_SIZE/2, ACTUAL_SIZE, ACTUAL_SIZE
    );
    
    ctx.restore();
}

function loop(timestamp: number) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;
    
    let fishAlpha = 0.3;

    if (isSuccess) {
        ctx.globalAlpha = 1.0;
        const elapsed = timestamp - successStartTime;
        
        fishAlpha = Math.min(0.3 + (elapsed / 1500) * 0.7, 1.0);
        
        let r = 17, g = 17, b = 17;
        
        if (elapsed > 300) {
            if (elapsed < 1900) {
                const p = Math.min((elapsed - 300) / 1600, 1);
                const t = p * p; 
                
                r = 17 + (79 - 17) * t;
                g = 17 + (195 - 17) * t;
                b = 17 + (247 - 17) * t;
            } else {
                const p = Math.min((elapsed - 1900) / 600, 1);
                const t = p;
                
                r = 79 + (255 - 79) * t;
                g = 195 + (255 - 195) * t;
                b = 247 + (255 - 247) * t;
            }
        }

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(0, 0, width, height);

    } else {
        ctx.clearRect(0, 0, width, height);
    }
    
    ctx.globalAlpha = 1.0;
    for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        
        ctx.fillStyle = `rgba(255, 255, 255, ${b.alpha})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
        ctx.fill();
        
        const elapsed = (isSuccess && successStartTime > 0) ? timestamp - successStartTime : 0;
        const cameraSpeed = isSuccess ? (0.2 + (elapsed / 2500) * 0.8) : 0;
        
        b.y += (b.speed + cameraSpeed) * (dt * 0.5);
        b.alpha -= 0.0005 * dt;
        
        if (b.y > height + 50 || b.alpha <= 0) {
            bubbles.splice(i, 1);
        }
    }

    ctx.globalAlpha = fishAlpha;
    for (let i = fishes.length - 1; i >= 0; i--) {
        const fish = fishes[i];
        
        if (isSuccess) {

            const targetRot = -Math.PI / 2;
            const diff = targetRot - fish.rotation;
            
            // Spring constants
            const kP = 0.0005; // Stiffness
            const kD = 0.75; // Damping (0-1)
            
            fish.rotationVelocity += diff * kP * dt;

            fish.rotationVelocity *= kD;
            
            fish.rotationVelocity += (Math.random() - 0.5) * 0.00002 * dt;
            
            fish.rotation += fish.rotationVelocity * dt;

            fish.speed *= 0.90; 
            
            const elapsed = timestamp - successStartTime;
            const verticalSpeed = 0.2 + (elapsed / 2500) * 0.8; 
            fish.y -= verticalSpeed * dt;

            if (Math.random() < 0.1) {

                const cx = fish.x + ACTUAL_SIZE/2;
                const cy = fish.y + ACTUAL_SIZE/2 + 20;
                
                bubbles.push({
                    x: cx + (Math.random() - 0.5) * 20,
                    y: cy + (Math.random() - 0.5) * 10,
                    size: Math.random() * 3 + 1,
                    speed: Math.random() * 0.2 + 0.1,
                    alpha: 0.4 + Math.random() * 0.3
                });
            }

        } else {
            if (isSprintingOut) {
                fish.speed += Math.sign(fish.speed) * ACCEL;
                if(Math.abs(fish.speed) > MAX_SPEED) fish.speed = Math.sign(fish.speed) * MAX_SPEED;

            } else {
                if (Math.abs(fish.speed) > Math.abs(fish.baseSpeed)) {
                    fish.speed *= DECEL;
                }
            }

            fish.x += fish.speed * (dt * 0.1);
        }
        
        drawFish(fish, timestamp);

        if ((fish.speed > 0 && fish.x > width + 200) || 
            (fish.speed < 0 && fish.x < -200) ||
            (isSuccess && fish.y < -200)) {
            fishes.splice(i, 1);
        }
    }
    
    if (fishes.length < 20 && !isRushing && !isSuccess) {
        const chance = fishes.length < 10 ? 0.05 : 0.01;
        if (Math.random() < chance) spawnFish();
    }
    
    requestAnimationFrame(loop);
}

export { init };
