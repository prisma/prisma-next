# Plan — Pack Refs for Contract Authoring (Option A)

## Context

The `examples/prisma-next-demo/prisma/contract.ts` contract currently uses:

- `.target('postgres')`
- `.extensions({ postgres: { version: '15.0.0' }, pgvector: {} })`

This is wrong for two reasons:

1. `postgres` is the **target**, not an extension pack. It should never appear under `contract.extensions`.
2. The TS author should not manually type pack IDs/versions to describe composition; we want explicit, typed wiring that is ergonomic and hard to misuse.

We’ve aligned on **Option A**:

- `contract.extensions` is **pack-owned contract data** (namespaced JSON) — not a “list of installed components”.
- Contract authoring should support **pack refs** so that the author can be explicit without stringly-typed keys.

## Problem Statement

We need a contract authoring DX that:

- Makes the **target explicit** without repeating it as an “extension”.
- Makes it easy to include extension namespaces (e.g. `pgvector`) **without inventing ad-hoc keys**.
- Works for both workflows:
  - **Emit workflow** (migration/control plane tooling)
  - **No-emit workflow** (runtime uses TS contract directly)
- Preserves the core constraint that the **contract IR is JSON-serializable** (no functions, no descriptors stored).

## Goals

- Provide a **pack-ref-based authoring API** that is explicit and ergonomic:
  - `defineContract().target(postgresPack)`
  - `defineContract().extensionPacks({ pgvector })` (or similar)
- Ensure the built contract never encodes the target as an extension.
- Keep `contract.extensions` semantics clean: it is **extension data**, not “the list of packs”.
- Keep plane/layer boundaries intact:
  - SQL authoring packages (`packages/2-sql/**`) cannot import from targets (`packages/3-targets/**`).
  - Therefore pack-ref *types* must live in framework/core packages.

## Non-Goals

- Redesigning `contract.json` shape beyond optional metadata additions.
- Changing CLI config wiring (`prisma-next.config.ts`) — this is contract authoring DX.
- Implementing the full “DB extension lifecycle from manifests” work (tracked separately).
- Adding/standardizing capabilities auto-derivation (can be follow-up; see Open Questions).

## Proposed User-Facing API

### TS contract authoring (emit workflow)

```ts
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgres from '@prisma-next/target-postgres/pack';
import pgvector from '@prisma-next/extension-pgvector/pack';

export const contract = defineContract()
  .target(postgres)              // ✅ explicit, typed
  .extensionPacks({ pgvector })  // ✅ typed, key-safe
  .build();
```

### TS contract authoring (no-emit workflow)

Same imports and API. The contract authoring surface must be safe to run in an app build/runtime without Node `fs` access.

## Key Semantics

### 1) The built contract stays pure

Pack refs are used only as *inputs* during authoring:

- `contract.target` is still a string (`'postgres'`).
- `contract.extensions` remains a JSON object keyed by extension IDs containing pack-owned contract data.
- Pack refs (objects with manifests, factories, etc.) are never stored on the contract.

### 2) The target is not an extension

The authoring API should make it *hard* to create `extensions.postgres`:

- `extensions.postgres` can still exist as **pack-owned extension data** if we ever introduce a Postgres extension pack (separate from “target-postgres”), but we should not encourage it by default.
- The `target-postgres` pack is a target descriptor; it should be represented via `.target(...)`.

## Technical Design

### A) Introduce a shared “pack ref” type

Add a minimal shared type in the framework contract package, distinct from control/runtime descriptors:

- **Location (proposal)**: `@prisma-next/contract/pack-ref-types`
- **Type**:
  - `kind: 'target' | 'extension' | 'adapter' | 'driver' | 'family'` (string-extensible is fine)
  - `id: string`
  - `familyId: string`
  - `targetId?: string` (required for target-bound packs)
  - `manifest: ExtensionPackManifest`

This mirrors the “descriptor base” pattern in `@prisma-next/contract/framework-components`, but without plane-specific factory methods.

### B) Add `./pack` entrypoints for each component pack

For each component package (starting with `@prisma-next/target-postgres` and `@prisma-next/extension-pgvector`):

- Add `src/exports/pack.ts` that default-exports a pure pack ref object.
- Add `package.json` export: `"./pack": { "types": ..., "import": ... }`.

**Critical requirement for no-emit**: `./pack` must not read from disk at runtime.

#### Replace `readFileSync` manifest loading

Today, many `./control` and `./runtime` entrypoints read `packs/manifest.json` via `readFileSync`.

Plan:

- Switch to `import manifest from '../../packs/manifest.json' with { type: 'json' }`
- Validate with arktype (optional, but can keep for safety)
- Reuse the imported manifest in `./pack`, `./control`, and `./runtime`

This makes pack refs:

- bundler-friendly
- runtime-safe
- identical across planes (no duplication of manifest parsing logic)

### C) Extend SQL contract builder to accept pack refs (without storing them)

#### Target

Add an overload:

- `.target(targetId: string)` (existing)
- `.target(target: TargetPackRef)` (new)

Implementation extracts the `targetId` (or `id` fallback) and sets `state.target` to that string.

#### Extension packs

Add a dedicated method to avoid semantic overload of `extensions()`:

- `.extensionPacks(packs: Record<string, ExtensionPackRef>)`

Behavior:

- For each provided pack ref, ensure:
  - `pack.kind === 'extension'`
  - `pack.familyId` matches contract family (for SQL builder: `'sql'`)
  - if `pack.targetId` exists, it matches the contract target
- Mutate builder state to ensure an empty namespace entry exists:
  - `state.extensions = { ...state.extensions, [pack.id]: {} }`
- Do **not** store the pack ref object.

`extensions()` remains as-is: it sets **pack-owned data** directly.

### D) Update example contract and docs

Update `examples/prisma-next-demo/prisma/contract.ts` to:

- remove the bogus `extensions.postgres` entry entirely
- switch target selection to `target(postgresPack)`
- add pgvector via `.extensionPacks({ pgvector })` (or keep `.extensions({ pgvector: {} })` until pack refs land)

## Execution Plan (small PRs)

### Phase 1 — Introduce pack refs + `./pack` entrypoints

- Add shared `PackRef` type export (framework contract package).
- Add `./pack` export to:
  - `@prisma-next/target-postgres`
  - `@prisma-next/extension-pgvector`
- Refactor manifest loading in those packages to avoid `readFileSync` in runtime surfaces.

### Phase 2 — Contract builder enhancements

- Add `.target(packRef)` overload.
- Add `.extensionPacks(...)` method.
- Add unit tests in `packages/2-sql/2-authoring/contract-ts/test`:
  - accepts string target
  - accepts pack ref target
  - rejects `extensionPacks` entries that are not extensions
  - rejects mismatched familyId/targetId
  - ensures built contract stays JSON-shaped (no functions stored)

### Phase 3 — Update examples + “how to author contracts” docs

- Update example contract to the new pattern.
- Add a short explanation to the SQL contract authoring README about:
  - `.target('postgres')` vs `.target(postgresPack)`
  - `extensions()` (data) vs `extensionPacks()` (enable namespaces)

## Testing Strategy

- **Unit tests** for contract builder behavior (fast, no DB).
- **Integration sanity**: ensure `pnpm prisma-next emit` still works for the example app if it uses the new imports.
- If manifest loading is refactored away from `fs`, add minimal tests to confirm manifests still validate and are included in builds.

## Migration / Compatibility Notes

- Keep `.target('postgres')` working indefinitely (or until a planned breaking slice).
- Keep `.extensions({ pgvector: {} })` working as the “raw data” path.
- Add pack-ref ergonomics as additive API; avoid changing the meaning of `contract.extensions`.

## Open Questions

1. **Where should pack versions live (if anywhere) in the contract?**
   - We should *not* smuggle them into `contract.extensions` unless that’s explicitly the extension’s domain data.
   - If needed, prefer `contract.meta` (e.g., `meta.frameworkPacks`) as a separate, clearly-named structure.
2. **Should `extensionPacks()` also auto-populate `contract.capabilities`?**
   - Probably a follow-up: capabilities are currently derived during emit via manifests; for no-emit we may want an equivalent “compose capabilities” helper.
3. **Do we want “pack refs” for adapters/drivers too?**
   - Likely not in contract authoring, but maybe in config authoring.


