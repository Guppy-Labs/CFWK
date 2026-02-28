/**
 * DepthBands — single source of truth for all depth constants.
 *
 * Every `setDepth()` call in the game world should reference these values
 * instead of inlining magic numbers.
 *
 * ── Band layout (ascending render order) ──
 *
 *   GROUND layers         0, 10, 20 …
 *   WET_FOOTPRINT         15
 *   OCCLUDABLE layers     200, 210, 220 …       ← always below entities
 *   DROPPED_ITEM          460  (ENTITY - 40)
 *   FIRE                  490  (ENTITY - 10)
 *   ENTITY                500                    ← players / NPCs / AI
 *   ── elevated layers ── 520+                   ← when occluded
 *   NAMEPLATE_OFFSET      +1000  from owner
 *   DEBUG                 2000
 *   UI                    3000 – 10006
 *   ALWAYS_ON_TOP         99999
 *
 * ENTITY_BASE is set high enough (500) that no occludable tile/object
 * layer can accidentally overtake entity depth via Y-sorting.  With
 * OCCLUDABLE_STEP = 10 and ENTITY_BASE - 40 = 460 (DROPPED_ITEM),
 * this supports up to 26 non-ground layers per map before items
 * overlap — well beyond any realistic map.
 */

// ── Layer depth bands ──────────────────────────────────────────────

/** Base depth for the first ground layer, each subsequent one adds GROUND_STEP */
export const GROUND_BASE = 0;
export const GROUND_STEP = 10;

/** Base for the first occludable (non-ground) tile layer */
export const OCCLUDABLE_BASE = 200;
export const OCCLUDABLE_STEP = 10;

// ── Entity depth bands ─────────────────────────────────────────────

/**
 * Default depth for the main character and all "entity-class" objects.
 *
 * Must be above `OCCLUDABLE_BASE + maxLayers * OCCLUDABLE_STEP` so that
 * all tile / object layers render BEHIND entities by default.  The
 * occlusion system elevates layers in front when the camera player
 * enters an occluder zone.
 */
export const ENTITY_BASE = 500;

/** Dropped items render below entities but above all tile layers */
export const DROPPED_ITEM_BASE = ENTITY_BASE - 40;  // 460

/** Fire effects sit between items and entities */
export const FIRE_BASE = ENTITY_BASE - 10;           // 490

// ── Occlusion ───────────────────────────────────────────────────────

/** Extra depth added when a layer is elevated in front of the camera player */
export const OCCLUSION_OFFSET = 20;

// ── Y-sorting ───────────────────────────────────────────────────────

/**
 * Multiplied by the entity's feet-Y to produce fractional depth.
 * With a 2500 px tall map this gives ~25 depth units of range,
 * well within the 10-unit gap between occludable layers.
 */
export const Y_SORT_FACTOR = 0.01;

// ── Relative offsets (applied to owning entity depth) ───────────────

export const SHADOW_OFFSET   = -1;
export const DUST_OFFSET     = -2;
export const NAMEPLATE_OFFSET = 1000;

// ── Fixed "always above everything" depths ──────────────────────────

export const CHAT_BUBBLE_DEPTH   = 99999;
export const WET_FOOTPRINT_DEPTH = 15;

// ── Fire emitter sub-layer offsets ──────────────────────────────────

export const FIRE_EMITTER_OFFSETS = {
    smokeBack:  0,
    outerFlame: 1,
    flame:      2,
    core:       3,
    ember:      4,
    smokeFront: 5,
} as const;

// ── Water-effect micro-offsets ──────────────────────────────────────

export const WATER_OVERLAY_OFFSET = 0.01;   // fadeOverlay above player
export const WATER_UNDER_OFFSET   = -0.01;  // underwaterSprite below player
export const SPLASH_OFFSET        = 1;      // splash emitter above player

// ── Set of layer names treated as ground ────────────────────────────

export const GROUND_LAYER_NAMES: ReadonlySet<string> = new Set(['Ground', 'Water']);
