import Phaser from 'phaser';

/**
 * A screen-border stamina bar that depletes symmetrically from top center
 * down both sides to the bottom center.
 */
export class StaminaBar {
    private scene: Phaser.Scene;
    private graphics: Phaser.GameObjects.Graphics;

    // Stamina state
    private stamina = 1; // 0-1 normalized (target value)
    private displayStamina = 1; // 0-1 normalized (smoothly interpolated for display)
    private targetOpacity = 0;
    private currentOpacity = 0;

    // Config
    private readonly maxOpacity = 1.0;
    private readonly barThicknessRatio = 0.008; // Thickness as % of screen diagonal
    private readonly minThickness = 4;
    private readonly maxThickness = 16;
    private readonly normalColor = 0xf09b4d; // Orange
    private readonly lowColor = 0xe04040; // Red
    private readonly lowThreshold = 0.3; // Fade to red below this
    private readonly fadeSpeed = 2; // Opacity change per second
    private readonly staminaLerpSpeed = 8; // How fast display catches up to actual stamina
    private readonly padding = 2; // Padding from screen edge

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.graphics = scene.add.graphics();
        this.graphics.setDepth(3000); // Ensure it's above everything including debug (2000)
    }

    /**
     * Calculate thickness relative to screen size
     */
    private getThickness(): number {
        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const diagonal = Math.hypot(width, height);
        const thickness = diagonal * this.barThicknessRatio;
        return Phaser.Math.Clamp(thickness, this.minThickness, this.maxThickness);
    }

    /**
     * Set the current stamina (0-1)
     */
    setStamina(value: number) {
        this.stamina = Phaser.Math.Clamp(value, 0, 1);

        // Show bar when not full, hide when full
        this.targetOpacity = this.stamina < 1 ? this.maxOpacity : 0;
    }

    /**
     * Get current stamina (0-1)
     */
    getStamina(): number {
        return this.stamina;
    }

    /**
     * Update the visual (call every frame)
     */
    update(delta: number) {
        const deltaSeconds = delta / 1000;
        
        // Smoothly interpolate display stamina toward actual stamina (eased)
        const diff = this.stamina - this.displayStamina;
        if (Math.abs(diff) > 0.001) {
            // Use exponential easing for smooth start/stop
            this.displayStamina += diff * this.staminaLerpSpeed * deltaSeconds;
            
            // Clamp to prevent overshooting
            if (diff > 0) {
                this.displayStamina = Math.min(this.displayStamina, this.stamina);
            } else {
                this.displayStamina = Math.max(this.displayStamina, this.stamina);
            }
        } else {
            this.displayStamina = this.stamina;
        }
        
        // Smoothly transition opacity
        if (this.currentOpacity < this.targetOpacity) {
            this.currentOpacity = Math.min(this.currentOpacity + this.fadeSpeed * deltaSeconds, this.targetOpacity);
        } else if (this.currentOpacity > this.targetOpacity) {
            this.currentOpacity = Math.max(this.currentOpacity - this.fadeSpeed * deltaSeconds, this.targetOpacity);
        }

        this.draw();
    }

    /**
     * Get interpolated color based on stamina level
     */
    private getBarColor(): number {
        if (this.displayStamina >= this.lowThreshold) {
            return this.normalColor;
        }
        
        // Interpolate between red and orange based on how low stamina is
        const t = this.displayStamina / this.lowThreshold; // 0 at empty, 1 at threshold
        
        // Extract RGB components
        const normalR = (this.normalColor >> 16) & 0xFF;
        const normalG = (this.normalColor >> 8) & 0xFF;
        const normalB = this.normalColor & 0xFF;
        
        const lowR = (this.lowColor >> 16) & 0xFF;
        const lowG = (this.lowColor >> 8) & 0xFF;
        const lowB = this.lowColor & 0xFF;
        
        // Lerp each channel
        const r = Math.round(lowR + (normalR - lowR) * t);
        const g = Math.round(lowG + (normalG - lowG) * t);
        const b = Math.round(lowB + (normalB - lowB) * t);
        
        return (r << 16) | (g << 8) | b;
    }

    private draw() {
        this.graphics.clear();

        if (this.currentOpacity <= 0.01) return;

        const width = this.scene.scale.width;
        const height = this.scene.scale.height;
        const thickness = this.getThickness();
        
        // Use fillRect for pixel-perfect rectangles with no overlap
        // Bar hugs the screen edge (no padding needed with fillRect approach)
        const barColor = this.getBarColor();
        this.graphics.fillStyle(barColor, this.currentOpacity);
        
        // Define the rectangular regions for each segment
        // Top: from left edge to right edge, thickness tall
        // Sides: from below top bar to above bottom bar
        // Bottom: from left edge to right edge, thickness tall
        
        const topBarHeight = thickness;
        const bottomBarY = height - thickness;
        const sideHeight = height - thickness * 2; // Exclude top and bottom bars
        
        // Calculate segment lengths for stamina depletion
        // Path: top-center -> top-right corner -> right side -> bottom-right -> bottom-center
        const topHalf = (width / 2);
        const sideLength = sideHeight;
        const bottomHalf = (width / 2);
        const totalHalfPerimeter = topHalf + sideLength + bottomHalf;

        const drawLength = this.displayStamina * totalHalfPerimeter;

        // Draw right side (clockwise from top center)
        this.drawHalfBarFill(drawLength, width, height, thickness, topHalf, sideLength, bottomHalf, false);

        // Draw left side (counter-clockwise from top center)
        this.drawHalfBarFill(drawLength, width, height, thickness, topHalf, sideLength, bottomHalf, true);
    }

    private drawHalfBarFill(
        drawLength: number,
        width: number,
        height: number,
        thickness: number,
        topHalf: number,
        sideLength: number,
        bottomHalf: number,
        isLeft: boolean
    ) {
        if (drawLength <= 0) return;

        let remaining = drawLength;
        const centerX = width / 2;

        // 1. Top edge (horizontal bar from center outward)
        const topDraw = Math.min(remaining, topHalf);
        if (topDraw > 0) {
            if (isLeft) {
                // Draw from (centerX - topDraw) to centerX
                this.graphics.fillRect(centerX - topDraw, 0, topDraw, thickness);
            } else {
                // Draw from centerX to (centerX + topDraw)
                this.graphics.fillRect(centerX, 0, topDraw, thickness);
            }
            remaining -= topDraw;
        }

        // 2. Side edge (vertical bar, below top bar, above bottom bar)
        if (remaining > 0) {
            const sideDraw = Math.min(remaining, sideLength);
            const sideY = thickness; // Start below top bar
            if (isLeft) {
                this.graphics.fillRect(0, sideY, thickness, sideDraw);
            } else {
                this.graphics.fillRect(width - thickness, sideY, thickness, sideDraw);
            }
            remaining -= sideDraw;
        }

        // 3. Bottom edge (horizontal bar from corner toward center)
        if (remaining > 0) {
            const bottomDraw = Math.min(remaining, bottomHalf);
            const bottomY = height - thickness;
            if (isLeft) {
                // Draw from left edge toward center
                this.graphics.fillRect(0, bottomY, bottomDraw, thickness);
            } else {
                // Draw from right edge toward center
                this.graphics.fillRect(width - bottomDraw, bottomY, bottomDraw, thickness);
            }
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.graphics.destroy();
    }
}
