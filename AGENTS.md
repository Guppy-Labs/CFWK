# AGENTS.md
<!-- Auto-maintained by continual-learning hook. Do not edit manually. -->

## Workspace overview

- Monorepo for **Cute Fish With Knives (CFWK)**: TypeScript/Node.js, a Vite-built **client** (Phaser 3 game and web shell), a **server** (multiplayer rooms, e.g. Colyseus-style `InstanceRoom` and related services), and **shared** contracts (e.g. `shared/types.ts`, items, quests).
- Game assets and static content live under **`client/public/`** (maps, dialogue JSON, fish tiles, fonts, UI art).
- **Standalone `splash/`** folder at the repo root is intentionally **not** bundled into the main client toolchain; it is for a separate WebGL/HTML splash that will be **exported to video**. Tech choices there do not need to match the main game stack.
- Judges-facing **`README.md`** is meant to be dense and impressive for competition review, not written as generic open-source contributor docs.
- **Admin tooling** includes a **sprite offset tuner** (admin dashboard) to overlay other animations on **idle** with transparency and read **x / y** pixel offsets for **config constants**.

## User preferences and corrections

- **Cursor plans:** When executing a saved plan, **do not edit the plan file**; use existing todos (mark `in_progress`, complete them) instead of recreating the list.
- **Marketing and site copy:** **Do not use emojis** in public-facing UI or prose the user considers professional-facing.
- **Quest UX:** **Side quests must not be auto-selected** by quest targeting. In the quest list, prefer **main → side → completed** ordering with clear **main-quest** affordances. When one NPC can start **multiple** quests, **only the earliest uncompleted** eligible quest should win so quest dialogue beats default lines.
- **Dev-only behavior:** Gate dev/test features with **`IS_DEV === "true"`** (env may be absent in production)—avoid tying dev tooling to unrelated session checks unless specified.
- **Visual effects:** If a full-screen effect (e.g. CRT on the high-quality preset) is enabled, the user expects **HUD and menus included**, not just the world layer—while keeping map/object rendering correct.
- **Typography and assets:** Prefer **reliable, locally served** fonts and **pixel/game font** paths when webfonts fail on some devices; treat **asset version / cache** (`cfwk_asset_version` and related wiring) as part of shipping visual updates.
- **Launch / loader UX:** Avoid swapping primary button labels (e.g. to “Launching…”) when an immediate full-screen cover or transition already hides the control. Match **AUTHENTICATING**-style transitions and navbar timing the user has defined for `/launch` → `/game`.
- **Splash / promo visuals:** Use **actual in-game assets** (e.g. fish tiles from `client/public/assets/fish/`) and coherent **perspective / cinematography** rather than disconnected generic sequences when building splash or trailer-style pieces.
- **Debugging wipe / session reset:** If behavior looks stale after a wipe or reconnect, consider **in-memory server caches** that may lag **periodic DB persistence** (e.g. advancements), not only the last row read from the database.
- **Finbook + intro:** On fresh or wiped progression, **defer** first-quest **auto-track** (and any associated quest-track SFX) until **`tutorial.introArrivalCompleted`** is true, so first Anchor Hollow **arrival dialogue** is not stepped on.

## Technical decisions

- **Economy model:** **One canonical integer** represents player money on the server; the client shows **bronze / silver / gold / platinum** with **100:1** conversion between tiers (display-only breakdown).
- **Multiplayer integrity:** Join and gameplay actions lean on **server authority** (authenticated instance join, validated inventory/equipment, admin-gated dangerous tools)—treat client predictions as non-authoritative. **Narrative spawns** (e.g. intro POI) must be applied **on the server** (e.g. join lifecycle teleport with hard reconcile); client-only `setPosition` is overridden by reconciliation.
- **Web admin / moderation:** Admin UI actions (e.g. ban, tempban, mute, send, wipe) should route through the same backend path as in-game slash commands—**`CommandProcessor.handleCommand`** (with equivalent auditing)—not a parallel, divergent implementation.
- **Wipe / forced disconnect client state:** On session-reset disconnects (e.g. code **4005**), clear **`localStorage` keys** that pin **last map/location** so the client does not reconnect to a stale map. At **`connectToInstance`**, clear **session-scoped singleton caches** (e.g. advancements on `NetworkManager`) so a new session does not reuse prior in-memory data.
- **Soft reconnect vs full reload:** In-game **reconnect** (without a full page refresh) can leave **dialogue advance**, **interact**, or other **input gating** inconsistent compared to a **hard reload**; when reproducing or fixing “stuck” dialogue, test both paths and ensure reconnect reinitializes the same **listeners and gates** as a fresh `connectToInstance` flow.
- **Tutorial / intro gating:** Do not read **advancements** synchronously on the first frame after connect for cutscene start; **await** fresh server-synced state (e.g. a bounded wait on advancements) so race conditions do not skip or mis-trigger flows.
- **Guide / tutorial input:** When the guide uses **`guideBlockAll`** with a **`guideAllowedActions`** list, the player controller’s action gating must **allow each listed action explicitly** (e.g. an interact exception matching the existing fishing exception). Otherwise the interact control can stay **dead** for keyboard and action routing even when the UI highlights the button.
- **Cutscene groups:** Reusable **cutscene group** flows chain a trigger (e.g. first join) to ordered steps such as **forced in-world dialogue**, **full-screen video**, and **comic** panels, with handoff and cleanup between segments—keep shared behavior in the cutscene API rather than one-off scene code.
- **Server structure:** **`InstanceRoom`** is being decomposed into **domain services** and **shared map utilities** under `server/src/` so room logic and map parsing stay maintainable.
- **Defeat flow:** Defeat uses an **in-instance recovery** pattern (respawn, heal, brief invulnerability) with UX that **defers** modal UI until after death presentation, and **mobs must not target** the player during that window.
- **Loot:** Monsters can define **per-enemy drop tables**; **coin pickups** can exist as world drops, but players **cannot manually drop** currency from inventory.
