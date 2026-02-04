import Phaser from 'phaser';

/**
 * Configuration for water depth effects
 */
interface WaterDepthConfig {
    /** Maximum depth in tiles before effects are fully applied */
    maxDepthTiles: number;
    /** How much the player sinks at max depth (pixels) */
    maxSinkAmount: number;
    /** Speed multiplier at max depth (0.5 = 50% speed) */
    minSpeedMultiplier: number;
    /** Tiles into water before slowdown starts */
    slowdownStartTiles: number;
}

/**
 * WaterDepthEffect - Creates visual and gameplay effects based on water depth
 * 
 * Features:
 * - Calculates distance from nearest non-water tile
 * - Visually sinks the player deeper into water
 * - Clips bottom of player sprite
 * - Provides speed multiplier for movement slowdown
 */
export class WaterDepthEffect {
    private scene: Phaser.Scene;
    private player: Phaser.GameObjects.Sprite;
    private waterLayer?: Phaser.Tilemaps.TilemapLayer;
    
    private config: WaterDepthConfig = {
        maxDepthTiles: 3,           // Max depth tracking (3 tiles deep)
        maxSinkAmount: 6,          // Sink 10 pixels at max depth
        minSpeedMultiplier: 0.4,    // 40% speed at max depth
        slowdownStartTiles: 1.0     // Start slowing after 1 tile in (first tile is just waves)
    };

    // State
    private currentDepth: number = 0;  // 0 = not in water, 1+ = tiles deep
    private targetDepth: number = 0;
    private sinkOffset: number = 0;
    private isInWater: boolean = false;
    
    // Visual elements
    private playerMask?: Phaser.Display.Masks.GeometryMask;
    private maskGraphics?: Phaser.GameObjects.Graphics;
    private fadeOverlay?: Phaser.GameObjects.Graphics;  // Gradient fade at water line
    private fadeMask?: Phaser.Display.Masks.BitmapMask;  // Mask fade to player pixels
    
    // Cache for depth calculations
    private depthCache: Map<string, number> = new Map();
    private lastCacheUpdate: number = 0;
    private cacheUpdateInterval: number = 500; // Rebuild cache every 500ms

    constructor(scene: Phaser.Scene, player: Phaser.GameObjects.Sprite, waterLayer?: Phaser.Tilemaps.TilemapLayer) {
        this.scene = scene;
        this.player = player;
        this.waterLayer = waterLayer;

        this.createVisualElements();
    }

    /**
     * Set the water layer reference
     */
    setWaterLayer(layer: Phaser.Tilemaps.TilemapLayer) {
        this.waterLayer = layer;
        this.depthCache.clear();
    }

    /**
     * Create visual effect elements
     */
    private createVisualElements() {
        // Mask graphics for clipping player
        this.maskGraphics = this.scene.add.graphics();
        this.maskGraphics.setVisible(false);
        
        // Create geometry mask
        this.playerMask = new Phaser.Display.Masks.GeometryMask(this.scene, this.maskGraphics);
        
        // Create fade overlay for water line (semi-transparent gradient effect)
        this.fadeOverlay = this.scene.add.graphics();
        this.fadeOverlay.setDepth(999); // Above player
        
        // Create bitmap mask from player sprite so fade only shows over visible pixels
        this.fadeMask = new Phaser.Display.Masks.BitmapMask(this.scene, this.player);
        this.fadeOverlay.setMask(this.fadeMask);
    }

    /**
     * Calculate water depth at a given world position
     * Returns 0 if not in water, or distance to nearest non-water tile (in sub-tile precision)
     */
    private calculateDepthAt(worldX: number, worldY: number): number {
        if (!this.waterLayer) return 0;

        const tileX = this.waterLayer.worldToTileX(worldX);
        const tileY = this.waterLayer.worldToTileY(worldY);
        
        if (tileX === null || tileY === null) return 0;

        // Check if current position is in water
        const currentTile = this.waterLayer.getTileAt(tileX, tileY);
        if (!currentTile || currentTile.index < 0) return 0;

        // Get tile size for sub-tile calculations
        const tileWidth = this.waterLayer.tilemap.tileWidth;
        const tileHeight = this.waterLayer.tilemap.tileHeight;

        // Find the nearest non-water tile and calculate precise pixel distance
        return this.findNearestNonWaterDistancePrecise(worldX, worldY, tileX, tileY, tileWidth, tileHeight);
    }

    /**
     * Find distance to nearest non-water tile with sub-tile (pixel) precision
     */
    private findNearestNonWaterDistancePrecise(
        worldX: number, worldY: number,
        tileX: number, tileY: number,
        tileWidth: number, tileHeight: number
    ): number {
        if (!this.waterLayer) return 0;

        const maxSearch = this.config.maxDepthTiles + 2;
        const visited = new Set<string>();
        const queue: Array<{ x: number; y: number; dist: number }> = [{ x: tileX, y: tileY, dist: 0 }];
        
        // Directions: 4-way (orthogonal only for tile distance)
        const directions = [
            { dx: 0, dy: -1 },  // up
            { dx: 0, dy: 1 },   // down
            { dx: -1, dy: 0 },  // left
            { dx: 1, dy: 0 }    // right
        ];

        let nearestNonWaterTile: { x: number; y: number } | null = null;
        let nearestTileDist = maxSearch;

        while (queue.length > 0) {
            const current = queue.shift()!;
            const key = `${current.x},${current.y}`;
            
            if (visited.has(key)) continue;
            visited.add(key);

            // Check if this tile is non-water (or out of bounds)
            const tile = this.waterLayer.getTileAt(current.x, current.y);
            const isWater = tile && tile.index >= 0;
            
            if (!isWater && current.dist > 0) {
                // Found non-water tile - record it if it's the nearest
                if (current.dist < nearestTileDist) {
                    nearestTileDist = current.dist;
                    nearestNonWaterTile = { x: current.x, y: current.y };
                }
                continue; // Don't explore beyond non-water tiles
            }

            // Don't search beyond max depth
            if (current.dist >= maxSearch) continue;

            // Add neighbors to queue
            for (const dir of directions) {
                const nx = current.x + dir.dx;
                const ny = current.y + dir.dy;
                const nkey = `${nx},${ny}`;
                
                if (!visited.has(nkey)) {
                    queue.push({ x: nx, y: ny, dist: current.dist + 1 });
                }
            }
        }

        // If we found a non-water tile, calculate precise pixel distance
        if (nearestNonWaterTile) {
            // Calculate the center of the nearest non-water tile
            const nearestTileCenterX = (nearestNonWaterTile.x + 0.5) * tileWidth;
            const nearestTileCenterY = (nearestNonWaterTile.y + 0.5) * tileHeight;
            
            // Calculate pixel distance and convert to tile units
            const pixelDist = Math.sqrt(
                Math.pow(worldX - nearestTileCenterX, 2) +
                Math.pow(worldY - nearestTileCenterY, 2)
            );
            
            // Convert to tile units (average of tile dimensions)
            const avgTileSize = (tileWidth + tileHeight) / 2;
            const tileDistance = pixelDist / avgTileSize;
            
            // Subtract 0.5 since we measured to tile center, and depth starts at edge
            // Also apply a curve to make depth rise slower initially (first tile is just waves)
            const rawDepth = Math.max(0, tileDistance - 0.5);
            
            // Apply easing: depth rises slowly at first, then faster
            // This makes the first tile (waves over sand) have minimal depth
            const easedDepth = rawDepth * rawDepth / this.config.maxDepthTiles;
            
            return Math.min(easedDepth * this.config.maxDepthTiles, this.config.maxDepthTiles);
        }

        // No non-water tile found within search range
        return this.config.maxDepthTiles;
    }

    /**
     * Update depth cache periodically
     */
    private updateCache() {
        const now = Date.now();
        if (now - this.lastCacheUpdate > this.cacheUpdateInterval) {
            this.depthCache.clear();
            this.lastCacheUpdate = now;
        }
    }

    /**
     * Get the current speed multiplier based on water depth
     */
    getSpeedMultiplier(): number {
        if (!this.isInWater || this.currentDepth <= this.config.slowdownStartTiles) {
            return 1.0;
        }

        // Calculate slowdown based on depth beyond the start threshold
        const effectiveDepth = this.currentDepth - this.config.slowdownStartTiles;
        const maxEffectiveDepth = this.config.maxDepthTiles - this.config.slowdownStartTiles;
        const depthRatio = Math.min(1, effectiveDepth / maxEffectiveDepth);
        
        // Lerp from 1.0 to minSpeedMultiplier
        return 1.0 - (1.0 - this.config.minSpeedMultiplier) * depthRatio;
    }

    /**
     * Get animation time scale based on water depth
     * Animations slow down proportionally to depth
     */
    getAnimationTimeScale(): number {
        // Use speed multiplier directly - deeper water = slower animations
        return this.getSpeedMultiplier();
    }

    /**
     * Get current water depth (0 = not in water)
     */
    getDepth(): number {
        return this.currentDepth;
    }

    /**
     * Check if player is in water
     */
    getIsInWater(): boolean {
        return this.isInWater;
    }

    /**
     * Main update loop - call each frame
     */
    update(_delta: number) {
        this.updateCache();

        // Calculate depth at player's feet
        const feetX = this.player.x;
        const feetY = this.player.y + 3;
        
        this.targetDepth = this.calculateDepthAt(feetX, feetY);
        this.isInWater = this.targetDepth > 0;

        // Smooth depth transition
        const depthLerpSpeed = 0.15;
        this.currentDepth += (this.targetDepth - this.currentDepth) * depthLerpSpeed;
        
        // Apply visual effects
        this.updateVisuals();
    }

    /**
     * Update visual effects based on current depth
     */
    private updateVisuals() {
        // Apply animation time scale to player
        const timeScale = this.getAnimationTimeScale();
        if (this.player.anims) {
            this.player.anims.timeScale = timeScale;
        }

        // Clear fade overlay
        this.fadeOverlay?.clear();

        if (!this.isInWater || this.currentDepth < 0.1) {
            // Not in water - clear effects
            this.sinkOffset = 0;
            this.player.clearMask();
            return;
        }

        // Calculate sink amount based on depth (only after 1 tile, like slowdown)
        const effectiveDepth = Math.max(0, this.currentDepth - this.config.slowdownStartTiles);
        const maxEffectiveDepth = this.config.maxDepthTiles - this.config.slowdownStartTiles;
        const depthRatio = Math.min(1, effectiveDepth / maxEffectiveDepth);
        this.sinkOffset = depthRatio * this.config.maxSinkAmount;

        // Don't apply visual clipping until we're past the start threshold
        if (effectiveDepth <= 0) {
            this.player.clearMask();
            return;
        }

        // Calculate clip height (how much of player is underwater)
        const playerHeight = this.player.displayHeight;
        const playerWidth = this.player.displayWidth;
        const clipHeight = this.sinkOffset;
        
        // Create fade gradient at water line
        const fadeHeight = 4; // Height of fade gradient
        const playerX = this.player.x;
        const playerY = this.player.y;
        const waterLineY = playerY + (playerHeight * (1 - this.player.originY)) - clipHeight;
        
        // Calculate player visual bounds (accounting for origin)
        const playerLeftX = playerX - (playerWidth * this.player.originX);
        
        if (this.fadeOverlay && clipHeight > 0) {
            // Draw gradient fade from transparent to semi-opaque water color
            const steps = 4;
            const stepHeight = fadeHeight / steps;
            
            for (let i = 0; i < steps; i++) {
                const alpha = (i / steps) * 0.4; // Fade from 0 to 0.4 alpha
                const y = waterLineY - fadeHeight + (i * stepHeight);
                
                this.fadeOverlay.fillStyle(0x5588aa, alpha);
                this.fadeOverlay.fillRect(playerLeftX, y, playerWidth, stepHeight);
            }
        }
        
        // Update mask to clip bottom of player (below the fade)
        if (this.maskGraphics) {
            this.maskGraphics.clear();
            
            // Create a rectangle that covers everything EXCEPT the clipped bottom
            // The mask shows what's visible, so we draw a large rect minus the bottom
            const maskWidth = 200;
            const maskHeight = 200;
            
            this.maskGraphics.fillStyle(0xffffff);
            this.maskGraphics.fillRect(
                playerX - maskWidth / 2,
                playerY - maskHeight,
                maskWidth,
                maskHeight + (playerHeight * (1 - this.player.originY)) - clipHeight
            );
            
            this.player.setMask(this.playerMask!);
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.maskGraphics?.destroy();
        this.fadeOverlay?.clearMask();
        this.fadeMask?.destroy();
        this.fadeOverlay?.destroy();
        this.player.clearMask();
        // Reset animation time scale
        if (this.player.anims) {
            this.player.anims.timeScale = 1;
        }
        this.depthCache.clear();
    }
}
