# Instance Room Guardrails

## Module Boundaries

- `room shell`: `server/src/rooms/InstanceRoom.ts`
  - Lifecycle orchestration only (`onCreate`, `onJoin`, `onLeave`, `onDispose`)
  - Delegates behavior to `instance/services/*`
- `services`: feature/domain logic (`movement`, `ai`, `chat`, `admin`, `progression`, etc.)
- `schema`: Colyseus replicated schema only
- `types`: runtime-only TS types
- `constants`: domain-specific constants
- `maps`: shared Tiled loaders/extractors/geometry; reusable by room/nav/advancements

## Dependency Direction

- `rooms/instance/services/*` can depend on:
  - `rooms/instance/schema/*`
  - `rooms/instance/types/*`
  - `rooms/instance/constants/*`
  - `server/src/maps/*`
  - managers/models/ai/util layers
- `server/src/maps/*` must not depend on `rooms/*`

## File Size Targets

- Soft target: <= 350 LOC
- Hard cap: <= 500 LOC for non-generated logic files
- If a service exceeds target, split by message family or simulation phase.

## Change Policy

- New gameplay handlers go into `instance/services/*`, not `InstanceRoom.ts`.
- Shared helpers used in 2+ domains move into `server/src/maps/*` or another shared utility module.
- Preserve existing client message contracts unless versioning is explicitly introduced.
