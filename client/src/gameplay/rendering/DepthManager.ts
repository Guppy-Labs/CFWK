/**
 * DepthManager — centralised authority for every `setDepth()` decision in the
 * game world.
 *
 * It wraps the low-level `OcclusionManager` (polygon geometry & layer
 * elevation) and exposes a high-level API that every entity/particle/effect
 * calls instead of doing ad-hoc depth arithmetic.
 *
 * Usage:
 *   const dm = new DepthManager();
 *   dm.setOcclusionManager(occlusionManager);
 *
 *   // per-frame for every entity:
 *   sprite.setDepth(dm.entityDepth(sprite.x, feetY));
 *   nameplate.setDepth(dm.nameplateDepth(sprite.depth));
 *   shadow.setDepth(dm.shadowDepth(sprite.depth));
 */

import { OcclusionManager } from '../map/OcclusionManager';
import {
    ENTITY_BASE,
    DROPPED_ITEM_BASE,
    FIRE_BASE,
    Y_SORT_FACTOR,
    SHADOW_OFFSET,
    DUST_OFFSET,
    NAMEPLATE_OFFSET,
    CHAT_BUBBLE_DEPTH,
    WATER_OVERLAY_OFFSET,
    WATER_UNDER_OFFSET,
    SPLASH_OFFSET,
    WET_FOOTPRINT_DEPTH,
    FIRE_EMITTER_OFFSETS,
    OCCLUSION_OFFSET,
    GROUND_LAYER_NAMES,
    OCCLUDABLE_BASE,
    OCCLUDABLE_STEP,
    GROUND_BASE,
    GROUND_STEP,
} from './DepthBands';

// ── public helpers re-exported so consumers only import DepthManager ──
export {
    ENTITY_BASE,
    DROPPED_ITEM_BASE,
    FIRE_BASE,
    FIRE_EMITTER_OFFSETS,
    CHAT_BUBBLE_DEPTH,
    WET_FOOTPRINT_DEPTH,
    GROUND_LAYER_NAMES,
    OCCLUDABLE_BASE,
    OCCLUDABLE_STEP,
    GROUND_BASE,
    GROUND_STEP,
    OCCLUSION_OFFSET,
    Y_SORT_FACTOR,
    NAMEPLATE_OFFSET,
};

/**
 * Options for the entity depth calculation.
 */
export interface EntityDepthOptions {
    /**
     * Base depth band for the entity.  Defaults to `ENTITY_BASE` (500).
     * Pass `DROPPED_ITEM_BASE` or `FIRE_BASE` for non-player objects.
     */
    baseDepth?: number;

    /**
     * Per-instance offset added to the base depth before Y-sorting.
     * Used e.g. for NPC `depthOffset` values defined in Tiled.
     */
    depthOffset?: number;

    /**
     * When **true** (the default for all world entities), the returned depth
     * is adjusted for the current occlusion state:
     *
     * 1. If the entity is *inside* an occluder polygon → behind occludable
     *    layers.
     * 2. If any occludable layer is currently elevated (because the camera
     *    player is inside an occluder region) → entity stays in front of
     *    those layers.
     * 3. Otherwise → normal Y-sorted depth.
     */
    occlusionAware?: boolean;
}

export class DepthManager {
    private occlusionManager?: OcclusionManager;

    constructor(occlusionManager?: OcclusionManager) {
        this.occlusionManager = occlusionManager;
    }

    // ── lifecycle ───────────────────────────────────────────────────

    setOcclusionManager(om: OcclusionManager) {
        this.occlusionManager = om;
    }

    getOcclusionManager(): OcclusionManager | undefined {
        return this.occlusionManager;
    }

    // ── entity depth (players, NPCs, AI, items, fires) ─────────────

    /**
     * Compute the depth for any world entity.
     *
     * This is the **single replacement** for the old
     * `getOcclusionAdjustedDepth()` free function.
     */
    entityDepth(
        x: number,
        feetY: number,
        opts: EntityDepthOptions = {},
    ): number {
        const base = (opts.baseDepth ?? ENTITY_BASE) + (opts.depthOffset ?? 0);
        let depth = base + feetY * Y_SORT_FACTOR;

        const om = this.occlusionManager;
        if (!om || opts.occlusionAware === false) return depth;

        // ── State 1: entity is INSIDE an occluder polygon ──────────
        const tags = om.getOcclusionTagsAt(x, feetY, 4);
        if (tags.size > 0) {
            const minBase = om.getMinBaseDepthForTags(tags);
            // Place entity behind all matched layers
            depth = (minBase - 10) + feetY * Y_SORT_FACTOR;
            return depth;
        }

        // ── State 2: layers are elevated (camera player is in a zone) ─
        const maxElevated = om.getMaxElevatedLayerDepth();
        if (maxElevated !== null) {
            const frontDepth = (maxElevated + 1) + feetY * Y_SORT_FACTOR;
            if (frontDepth > depth) depth = frontDepth;
        }

        return depth;
    }

    // ── accessory depths relative to owner sprite.depth ────────────

    shadowDepth(ownerDepth: number): number {
        return ownerDepth + SHADOW_OFFSET;
    }

    dustDepth(ownerDepth: number): number {
        return ownerDepth + DUST_OFFSET;
    }

    nameplateDepth(ownerDepth: number): number {
        return ownerDepth + NAMEPLATE_OFFSET;
    }

    chatBubbleDepth(): number {
        return CHAT_BUBBLE_DEPTH;
    }

    // ── water-effect depths ────────────────────────────────────────

    waterOverlayDepth(playerDepth: number): number {
        return playerDepth + WATER_OVERLAY_OFFSET;
    }

    waterUnderDepth(playerDepth: number): number {
        return playerDepth + WATER_UNDER_OFFSET;
    }

    splashDepth(playerDepth: number): number {
        return playerDepth + SPLASH_OFFSET;
    }

    footprintDepth(): number {
        return WET_FOOTPRINT_DEPTH;
    }

    // ── fire emitter depth helpers ─────────────────────────────────

    /**
     * Compute the fire's base depth. Fires Y-sort at their own position
     * to fix the old bug where all fires shared the same flat depth.
     */
    fireDepth(x: number, feetY: number): number {
        return this.entityDepth(x, feetY, { baseDepth: FIRE_BASE });
    }

    /**
     * Update a fire's depth based on its linked layer's occlusion state.
     * Returns the new base depth for the fire (caller applies emitter offsets).
     */
    fireOcclusionDepth(baseLayerTag: string | null, fallbackBaseDepth: number): number {
        if (!baseLayerTag || !this.occlusionManager) return fallbackBaseDepth;

        if (this.occlusionManager.isTagOccluded(baseLayerTag)) {
            return this.occlusionManager.getOccludedDepth(baseLayerTag) + 1;
        }
        return fallbackBaseDepth;
    }

    fireEmitterDepth(baseDepth: number, emitter: keyof typeof FIRE_EMITTER_OFFSETS): number {
        return baseDepth + FIRE_EMITTER_OFFSETS[emitter];
    }
}
