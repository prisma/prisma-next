---
name: Pack Refs + Descriptor-First Composition (Manifest as Serialized View)
status: draft
owners:
  - framework
  - cli
  - sql-family
---

## Context

We currently have two related problems:

1. **Runtime disk IO for manifests**: Concrete component entrypoints (target/adapter/driver/extension) load `packs/manifest.json` using `readFileSync()` during module evaluation (e.g. `@prisma-next/adapter-postgres/control`). In consumer apps, this fails if `packs/manifest.json` is not published, or if the environment disallows disk access seen by the module (bundlers, serverless, edge-like environments).
2. **Descriptor ↔ pack conflation**: Framework component descriptors thread a nested `manifest: ExtensionPackManifest` through core types, and internal consumers read `descriptor.manifest.*` directly. This makes “pack” (distribution format) feel like a foundational concept of composition instead of an optional serialized view.

Additionally, contract authoring DX needs improvement:

- Authors should not encode targets as `contract.extensions.*`.
- Authors should be able to opt-in extension namespaces without stringly-typed pack IDs, while keeping contract IR JSON-serializable.

This plan unifies two earlier drafts into a single implementation roadmap:

- **Pack refs for TS contract authoring** (typed, ergonomic inputs; never stored on contract)
- **Descriptor-first composition** (descriptors own declarative fields; manifests become a serialized projection + hydration boundary concern)

## Goals

- Eliminate runtime `readFileSync()` from component entrypoints and make consuming Prisma Next in external apps work without `packs/manifest.json` on disk at runtime.
- Make descriptors the canonical model for composition: descriptors expose declarative fields directly (capabilities/types/operations/targets/version).
- Constrain `ExtensionPackManifest` usage to hydration boundaries only (CLI pack-loading, hosted preflight in the future).
- Add a pack-ref-based contract authoring API that:
  - makes targets explicit without encoding them as extensions
  - enables extension namespaces without ad-hoc keys
  - preserves the invariant: built contract IR is pure JSON (no descriptors, no functions)
- Keep plane/layer boundaries intact:
  - SQL authoring (`packages/2-sql/**`) must not import from targets (`packages/3-targets/**`).

## Non-goals

- Building a general-purpose module loader for all environments.
- Implementing hosted registry resolution / preflight.
- Redesigning the JSON schema of `packs/manifest.json` in this slice.
- Changing CLI config wiring (`prisma-next.config.ts`) beyond what’s required to migrate descriptor fields.

## Definitions

- **Descriptor**: the canonical framework component model used in config composition (family/target/adapter/driver/extension).
- **Declarative fields**: the serializable subset of a descriptor: `version`, `targets?`, `capabilities?`, `types?`, `operations?`.
- **Manifest**: a pure JSON projection of declarative descriptor fields intended for distribution and preflight (`packs/manifest.json`).
- **Hydration boundary**: the layer responsible for turning “serialized view” into a hydrated descriptor (CLI pack-loading, future registry preflight).
- **Pack ref**: a minimal serializable reference used as an *input* in TS authoring APIs; it is never stored on the contract.

## Proposed User-Facing API (contract authoring)

```ts
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgres from '@prisma-next/target-postgres/pack';
import pgvector from '@prisma-next/extension-pgvector/pack';

export const contract = defineContract()
  .target(postgres)              // typed pack ref input
  .extensionPacks({ pgvector })  // enables the namespace (data remains empty unless author sets it)
  .build();
```

Semantics:
- `contract.target` remains a string (e.g. `'postgres'`).
- `contract.extensions` remains pack-owned contract data only (namespaced JSON).
- Pack refs are inputs only; they are not stored on the contract.

## Implementation Plan (phased)

### Phase 0 — Pinpoint + stop the consumer failure (no runtime FS)

**Objective**: importing component entrypoints (e.g. `@prisma-next/adapter-postgres/control`) must not require `readFileSync()` or `packs/manifest.json` to exist on disk at runtime.

**Approach**:
- Replace `readFileSync(join(__dirname, '../../packs/manifest.json'))` with a build-time-hydrated manifest module.
- Ensure the built JS for entrypoints contains the manifest object (or imports it in a way that bundlers resolve) without requiring a separate JSON file to be present at runtime.

**Concrete changes**:
- For each concrete component package (start with Postgres ecosystem):
  - `packages/3-targets/3-targets/postgres`
  - `packages/3-targets/6-adapters/postgres`
  - `packages/3-targets/7-drivers/postgres`
  - `packages/3-extensions/pgvector`

Add a single internal module that exports a validated manifest object, e.g.:
- `src/core/manifest.ts` (shared by `./control`, `./runtime`, and new `./pack`).

Implementation options (pick one and standardize):
- **Option A (preferred)**: `import manifest from '../../packs/manifest.json' with { type: 'json' }` inside `src/core/manifest.ts`, validate once, export the object.
  - Ensure the build output does not require the JSON file at runtime (verify via inspection of built output in `dist/`).
- **Option B (fallback)**: generate `src/core/manifest.ts` from `packs/manifest.json` as a build step (checked in or generated during build), so runtime has zero JSON file dependency.

**Acceptance criteria**:
- `@prisma-next/{target,adapter,driver}-postgres/*` and `@prisma-next/extension-pgvector/*` no longer import `node:fs` in their public entrypoints.
- Importing those entrypoints in an external app does not attempt to read `packs/manifest.json` from disk.

### Phase 1 — Introduce PackRef type + `./pack` entrypoints (pure, no fs)

**Objective**: create a typed, pure “pack ref” surface for authoring without importing control/runtime descriptors.

**Changes**:
1. Add shared pack ref types in framework core:
   - New module: `@prisma-next/contract/pack-ref-types`
   - `PackRefBase` (extensible kind), plus helper aliases:
     - `TargetPackRef`, `ExtensionPackRef` (and optionally Adapter/Driver/Family if needed later)
   - Must be shared-plane safe (no control/runtime imports).

2. Add `./pack` exports for:
   - `@prisma-next/target-postgres`
   - `@prisma-next/extension-pgvector`
   - (optional, if useful for future DX) `@prisma-next/adapter-postgres`, `@prisma-next/driver-postgres`

`./pack` must:
- be pure (no disk IO, no Node-only APIs)
- default-export a pack ref object containing:
  - `kind`, `id`, `familyId`, `targetId?`
  - a declarative subset (see Phase 2) OR an interim `manifest` field until Phase 2 lands

3. Update `package.json` exports and `tsup.config.ts` entrypoints accordingly.

**Acceptance criteria**:
- Consumer code can import `@prisma-next/target-postgres/pack` and `@prisma-next/extension-pgvector/pack` in both emit and no-emit workflows.

### Phase 2 — Descriptor owns declarative fields; manifest becomes a projection

**Objective**: remove internal dependency on `ExtensionPackManifest` as the canonical source of truth.

**Step 2.1: Extend descriptor base types**
- Update `@prisma-next/contract/framework-components`:
  - Add declarative fields directly to `ComponentDescriptor`:
    - `version: string`
    - `targets?`
    - `capabilities?`
    - `types?` (including family-specific metadata like SQL storage type metadata)
    - `operations?`
  - Keep `manifest` temporarily for staged migration (optional), but treat it as derived.

**Step 2.2: Move internal consumers off `descriptor.manifest.*`**
- Update SQL family assembly to read:
  - `descriptor.operations` (instead of `descriptor.manifest.operations`)
  - `descriptor.types` (instead of `descriptor.manifest.types`)
  - `descriptor.capabilities` (instead of `descriptor.manifest.capabilities`)
  - `descriptor.version` / `descriptor.targets` as needed

Primary consumer:
- `packages/2-sql/3-tooling/family/src/core/instance.ts`

**Step 2.3: Implement manifest projection utilities**
- Introduce in a boundary-safe package (framework contract/control-plane):
  - `serializeDescriptorToManifest(descriptor) -> ExtensionPackManifest`
  - `assertManifestMatchesDescriptor(manifest, descriptor) -> void`

Rules:
- If both descriptor declarative fields and a manifest are present at hydration time, enforce strict equality (fail fast on mismatch).

**Step 2.4: Constrain manifest usage to boundaries**
- CLI pack loading remains a boundary utility (`@prisma-next/cli/pack-loading`).
- Update CLI/config validation and any other internal code paths to avoid relying on manifests except where explicitly intended (pack-loading / preflight).

**Step 2.5: Remove `manifest` from the shared descriptor model**
- Once all internal consumers migrate, remove `manifest` from `ComponentDescriptor`.
- Keep manifest types for pack-loading + serialized view usage.

**Acceptance criteria**:
- Internal composition flows (SQL family instance assembly and contract emit) do not require `ExtensionPackManifest` in-memory.
- Manifests are only used at hydration boundaries and for serialization.

### Phase 3 — Contract builder enhancements: `.target(packRef)` + `.extensionPacks(...)`

**Objective**: enable pack-ref-based contract authoring without storing pack refs on the contract.

**Changes** (in `@prisma-next/sql-contract-ts`):
1. Add overload:
   - `.target(targetId: string)` (existing)
   - `.target(packRef: TargetPackRef)` (new)
   - Implementation extracts target id (prefer `targetId`, fallback `id`) and sets builder state.

2. Add method:
   - `.extensionPacks(packs: Record<string, ExtensionPackRef>)`
   - Validations:
     - kind is `extension`
     - family matches `'sql'`
     - if packRef has `targetId`, it matches the selected target
   - Behavior:
     - ensures `state.extensions[pack.id] = {}` exists (namespace enabled)
     - does not store the ref object

3. Update docs and examples:
   - Fix `examples/prisma-next-demo/prisma/contract.ts`:
     - remove target-as-extension usage
     - use `.target(postgresPack)` and `.extensionPacks({ pgvector })`

**Acceptance criteria**:
- Unit tests cover:
  - accepts string target
  - accepts pack-ref target
  - rejects non-extension pack refs in `extensionPacks`
  - rejects familyId/targetId mismatches
  - ensures `.build()` returns JSON-shaped contract (no functions/refs stored)

### Phase 4 — Capability ergonomics (optional in this slice; decide explicitly)

There is an existing expectation that capabilities are declared by adapters (manifest + runtime capabilities) and flow into emitted contracts. Today, contracts only include whatever the author sets via `.capabilities(...)`.

Pick one (explicit decision in this plan):
- **Option A (follow-up)**: keep capabilities author-controlled for now; don’t change emit behavior.
- **Option B (recommended if you want “it just works”)**: add a family-level helper that composes capabilities from descriptors during emit if `contract.capabilities` is empty, and document precedence (explicit contract wins).

If Option B is chosen, add tests that:
- emitted contract includes adapter/target capabilities when contract omits them
- mismatch scenarios are deterministic and documented

## Test Plan

- Package unit tests:
  - `@prisma-next/sql-contract-ts` contract builder tests for pack refs.
  - Manifest/descriptor projection tests for equality and mismatch behavior.
- Integration sanity:
  - `pnpm test:integration` (existing CLI emit tests)
  - A small fixture that imports `@prisma-next/adapter-postgres/control` and asserts no `node:fs` usage (e.g., by mocking `node:fs` and ensuring import succeeds).
- Dependency validation:
  - `pnpm lint:deps` after moving types / introducing pack-ref types.

## Deliverables Checklist

- [ ] No runtime `readFileSync` in component entrypoints
- [ ] `./pack` entrypoints for postgres target + pgvector extension (and optionally adapter/driver)
- [ ] Pack ref types in framework core
- [ ] Descriptor base types own declarative fields
- [ ] SQL family assembly reads descriptor fields (not `descriptor.manifest`)
- [ ] Manifest projection helpers + strict mismatch assertion at boundaries
- [ ] Contract builder supports `.target(packRef)` and `.extensionPacks(...)`
- [ ] Example contract updated
- [ ] Tests updated/added

## Notes / Rationale

- This plan explicitly separates:
  - **composition model** (descriptor fields used by the framework)
  - **distribution artifact** (manifest JSON)
- It also ensures TS contract authoring remains safe for no-emit workflows by avoiding file IO and descriptor storage in the contract.


