# Runtime DX: Constructed Contract + runtime-real mappings (TML-1831)

Date: 2026-02-15  
Status: Draft

## Summary

Unify the “contract” story so **the TypeScript `Contract` type matches the runtime value** consumed by applications (including the demo visualization), and ensure **mapping dictionaries are runtime-real** (not type-only “pretend” properties).

Today, we have several related-but-inconsistent representations:

- **`contract.json`**: canonical, hashable artifact (and future PSL output)
- **TS authoring output** (`defineContract()`): a constructed representation used directly in no-emit workflows
- **Emitted `contract.d.ts` `Contract` type**: preserves rich typing lost in JSON, but currently includes mapping dictionaries that are not present at runtime when loading via `validateContract()`

This mismatch breaks runtime introspection (e.g. rendering the contract tree in the demo during Vite HMR), because the iterable runtime value doesn’t match its TS type.

This work consolidates these so the **constructed contract** is the stable application-facing structure, and **serialization formats (JSON) are allowed to evolve independently**.

## Problem

- The emitted `Contract` type is shaped for application needs (fast lookups via mappings), but the runtime value returned by `validateContract()` does not contain those mappings.
- Different workflows (no-emit vs JSON+types) produce “contract-like” objects with different shapes.
- Consumers (demo visualization, lanes, tooling) can’t rely on a single predictable shape and end up with ad-hoc aliases (e.g. `ContractIR`) or defensive code.

## Goals

- **Single predictable contract surface**: a stable, application-shaped `Contract` representation used across:
  - TS authoring (no-emit): `defineContract()` produces it
  - JSON loading: `validateContract()` produces it
- **Type/value alignment**: the exported TypeScript `Contract` type **matches the runtime value**.
- **Runtime-real mappings**: schema/traversal mapping dictionaries (for fast lookups) exist on the runtime contract value, not just in `contract.d.ts`.
- **Strip `_generated` at runtime**: `_generated` is not present on the returned contract object.
- **Demo visualization**: renders the contract directly (no `ContractIR` aliases), covering all application-relevant parts of the contract.
- **Breaking changes allowed**: update call sites; no back-compat shims.

## Non-goals

- Preserving the exact shape of `contract.json` in the application-facing `Contract` surface.
- Defining a final exhaustive list of mappings up front (the mappings set is intentionally extensible).
- Removing internal parsing/normalization steps inside validators (as long as the returned value + exported type are identical).

## Design

### 1) Reframe the “Contract”

Treat `Contract` as the **constructed, application-facing contract object**.

- `contract.json` is a **canonical serialization artifact** used for hashing and distribution.
- `defineContract()` (TS authoring) and `validateContract()` (JSON ingestion) both produce the same constructed `Contract`.
- The constructed `Contract` is shaped for **application needs**, not for JSON serialization limitations.

### 2) Constructed Contract as a class (or factory)

Introduce a constructed `Contract` representation implemented as either:

- **A class** (preferred if we want encapsulated construction + invariants):
  - `new Contract(irLikeValue)` constructs, validates invariants, and computes mappings once
  - mappings stored as concrete properties (`contract.mappings`)
  - optional future: getters for computed/derived views

or

- **A factory function** (preferred if we want POJO-only runtime values):
  - `constructContract(irLikeValue): Contract`

Either way, the output must be a **plain traversable object** suitable for rendering/inspection and stable across workflows.

### 3) Mappings are real and extensible

The constructed contract includes a `mappings` object containing **runtime-real** derived dictionaries used for:

- fast name/id lookups
- traversal helpers for lanes and tooling
- stable “index-like” affordances for agents and visualization

The specific mapping families are not locked in by this spec; the key requirement is:

- **No mapping property exists only in types**
- Adding more mappings later is straightforward and non-breaking for existing consumers

#### Important: keep `mappings` runtime-real only

Some “maps” that exist in today’s emitted `contract.d.ts` (notably `codecTypes` and `operationTypes`) are **compile-time typing channels**, not runtime data. They must not be modeled as runtime keys on the constructed contract value, because:

- they cannot be faithfully reified/derived from JSON alone, and
- they create an immediate type/value mismatch (the root problem behind the demo visualization/HMR issue).

This is especially true for **parameterized codecs**, where output types vary based on per-column `typeParams` or `typeRef`—a relationship that is captured in the contract *type surface* (TS authoring / `contract.d.ts`), not in runtime registries.

### 4) Codec/operation type maps are type-only (do not exist at runtime)

We preserve excellent lane inference (row types, operation IO types) by carrying codec/operation type maps as **type-only attachments**, sourced from:

- TS authoring (no-emit): target/extension pack type exports (inferred from `.target()` and `.extensionPacks()`)
- JSON + `contract.d.ts`: emitted `CodecTypes` / `OperationTypes` types

But we **do not** represent these as runtime properties on `contract.mappings`.

Implementation sketch (conceptual):

- Update the SQL contract type surface to carry codec/op type maps via a **phantom** channel (e.g. `unique symbol` keyed), so generic code can still do:
  - `ExtractCodecTypes<TContract>`
  - `ExtractOperationTypes<TContract>`
- Update lanes to stop reading `contract.mappings.codecTypes` / `contract.mappings.operationTypes` as runtime values.
- Runtime execution continues to use `ExecutionContext.codecs` and `ExecutionContext.operations` (registries assembled from descriptors).

#### TS authoring ergonomics: infer codec types from packs

In the TS authoring surface, avoid forcing authors to manually compose codec types like:

```ts
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types'
import type { CodecTypes as PgVectorCodecTypes } from '@prisma-next/extension-pgvector/codec-types'
type AllCodecTypes = CodecTypes & PgVectorCodecTypes

defineContract<AllCodecTypes>().target(postgresPack).extensionPacks({ pgvector })
```

Instead, the builder should infer and accumulate the necessary type maps from:

- `.target(postgresPack)`
- `.extensionPacks({ pgvector })`

This keeps a single point of configuration while still providing deterministic typing (including parameterized codecs).

### 5) Workflow unification

#### TS authoring (no-emit)

- `defineContract()` must return the constructed `Contract`.
- If `defineContract()` currently returns an “IR-ish” shape, it becomes an internal implementation detail feeding the constructor/factory.

#### JSON ingestion (`validateContract`)

`validateContract<TContract>(json)` becomes:

1. validate JSON (arktype) and strip `_generated`
2. transform JSON into whatever internal shape is required (if needed)
3. **construct the runtime `Contract` object**
4. return the constructed `Contract` value typed as `TContract` (where `TContract` is the emitted `contract.d.ts` type)

Critical invariant:

- The returned runtime object must structurally match `TContract` for all **runtime-real** keys (including runtime-real `mappings`).
- Codec/operation type maps are provided by the TypeScript type parameter (from `contract.d.ts`) via the type-only channel, not via runtime properties.

### 6) Demo visualization

- Demo renders the constructed `Contract` directly.
- Remove any `ContractIR` aliases used only to make rendering possible.
- The visualization scope is “all application-relevant components” of the contract, not only storage schema.

### 7) Call site updates (breaking)

- Update internal consumers (lanes, demo, tooling) to rely on the constructed `Contract` surface.
- Remove any defensive branching based on “JSON vs TS contract shape” where possible.

## Acceptance Criteria

- `validateContract()` returns a runtime value whose shape matches `Contract` from `contract.d.ts`, excluding `_generated`.
- Demo visualization consumes the constructed `Contract` directly (no ad-hoc `ContractIR` aliases).
- Runtime-real mapping dictionaries used by consumers exist on the runtime contract value (not type-only “pretend keys”).
- Codec/operation type maps used for lane inference are type-only and must not be read as runtime properties.
- No backwards compatibility shims; call sites are updated.
- Specs live in `agent-os/specs/` (ignore stale `docs/specs/**` links in Linear for this repo/worktree).

## Testing Plan

- **Unit**
  - `validateContract()` returns an object with runtime-real `mappings` present and populated (at least minimally)
  - `_generated` is absent at runtime (not merely omitted from types)
  - `defineContract()` and `validateContract()` produce structurally compatible `Contract` values
  - Lanes do not rely on runtime presence of codec/operation type maps for inference (type-only channel is sufficient)
- **Demo/integration**
  - Demo contract visualization can render from `Contract` directly during Vite HMR without runtime/type mismatches
  - Convenience runtime wiring (e.g. lazy clients that validate contract before building context/stack) remains compatible with the separation of definition-only contract vs context registries

## Migration / Rollout Notes

- Do the change in a single breaking sweep:
  - update contract construction + validator
  - update demo visualization
  - update lanes/tooling call sites

## Documentation Updates

- Update relevant docs or READMEs if they describe the contract surface in a way that implies `Contract` must match JSON shape.
- Keep pointing to `agent-os/specs/` for in-repo spec sources.

