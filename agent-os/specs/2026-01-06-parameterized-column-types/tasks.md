# Tasks — Parameterized column types (TML-1808)

Source: https://linear.app/prisma-company/issue/TML-1808/parameterized-types

## Phase 0 — Alignment checkpoints (before code)

- [x] Confirm contract shape for type params:
  - [x] `StorageColumn.typeParams?: Record<string, unknown>` (JS/type params only)
  - [x] `storage.types?: Record<string, StorageTypeInstance>` for named, codec-owned type instances
- [x] Decide how columns reference named type instances:
  - [x] Use an explicit field (`StorageColumn.typeRef?: string`) to reference a key of `storage.types` (do not reserve magic keys inside `typeParams`)
- [x] Decide how parameterized codec descriptors are plumbed into emission:
  - [x] Prefer declarative (JSON-friendly) pack metadata + type-only imports over executable renderers in `EmitOptions`
  - [x] Emit stays “no runtime module execution” for artifacts: the emitter may execute, but emitted `contract.json`/`contract.d.ts` contain no executable code
- [x] Decide `schema()` public shape for helpers:
  - [x] Add a `schema.types` namespace (keep `schema.tables` unchanged)
  - [x] Lifecycle: helpers are initialized during runtime context creation and surfaced through `schema(context).types` (typed from `contract.d.ts`)
- [x] Confirm no-emit/zero-emit compatibility:
  - [x] All new contract fields are plain JSON-serializable data and preserve literal typing in TS-first authoring (`as const`)
  - [x] Parameterized typing can be driven by types-only imports (no runtime registries required for typing)

## Phase 1 — Contract schema + validation (tests first)

### 1.1 Update contract types

- [x] Add type-level tests for new storage fields (where applicable)
- [x] Update `@prisma-next/sql-contract/types` (`packages/2-sql/1-core/contract/src/types.ts`):
  - [x] Extend `StorageColumn` with `typeParams?: Record<string, unknown>`
  - [x] Extend `StorageColumn` with `typeRef?: string`
  - [x] Add `SqlStorage.types?: Record<string, StorageTypeInstance>`
  - [x] Add `StorageTypeInstance` type (codecId + nativeType + typeParams)
- [x] Update Arktype validators in `@prisma-next/sql-contract/validators`

### 1.2 Update contract validation + normalization (Arktype)

- [x] Add tests in `packages/2-sql/2-authoring/contract-ts/test/` for:
  - [x] validating `storage.types` structure
  - [x] validating `columns[*].typeParams` as JSON object when present
  - [x] rejecting invalid shapes (non-object typeParams, non-object storage.types entries)
  - [x] rejecting array typeParams (must be plain object, not array)
  - [x] rejecting typeParams + typeRef on same column (mutually exclusive)
  - [x] rejecting typeRef pointing to missing storage.types key
- [x] Update Arktype validation in `packages/2-sql/2-authoring/contract-ts/src/contract.ts`:
  - [x] allow `storage.types`
  - [x] allow `columns[*].typeParams`
  - [x] allow `columns[*].typeRef`
  - [x] enforce typeParams/typeRef mutual exclusivity
  - [x] enforce typeRef points to existing storage.types key
  - [x] enforce typeParams is a plain object (reject arrays)
- [x] Update normalization (if present) so contracts have deterministic output (no implicit "magic" inference)
  - [x] Note: normalization intentionally skips typeParams/typeRef/storage.types (no defaults needed)

### 1.3 Update contract JSON schema (IDE validation)

- [x] Update `packages/2-sql/2-authoring/contract-ts/schemas/data-contract-sql-v1.json`:
  - [x] add `storage.types` with `StorageTypeInstance` definition
  - [x] add `columns[*].typeParams`
  - [x] add `columns[*].typeRef`
  - [x] fix `StorageColumn` to use `nativeType` + `codecId` (matching TS types)
- [x] Add schema/fixture tests verifying new fields are accepted and rejected appropriately
- [x] Update test fixtures to match new schema format

## Phase 1.4 — PR feedback: Consolidate codec typing surfaces

- [x] Consolidate `codecTypes` + parameterized renderers into a single surface:
  - [x] Extend `ComponentMetadata.types.codecTypes` to include optional `parameterized` map
  - [x] Remove unused `parameterizedCodecs` array from `ComponentMetadata`
  - [x] Update pgvector to use consolidated `codecTypes.parameterized` surface
  - [x] Remove unused `extractParameterizedCodecs` function (production uses `extractParameterizedRenderers`)
- [x] Normalize `TypeRenderer` at pack assembly time:
  - [x] `normalizeRenderer` function handles all forms: raw string, raw function, structured template, structured function
  - [x] `extractParameterizedRenderers` in `assembly.ts` normalizes renderers during extraction
  - [x] Emitter receives only normalized (function-form) renderers via `NormalizedTypeRenderer`
- [x] Enforce duplicate `codecId` as a hard error:
  - [x] Assembly throws when multiple descriptors provide renderer for same `codecId`
  - [x] Tests verify error case
  - [x] Document override policy in spec (done above)

## Phase 2 — Parameterized codec descriptors (framework components)

- [x] Define shared types for parameterized codec descriptors in `@prisma-next/contract/types`:
  - [x] metadata shape for "this codec supports typeParams" (`ParameterizedCodecDescriptor`)
  - [x] how emission finds the renderer for a `codecId` (`TypeRenderer` + `outputTypeRenderer`)
  - [x] how runtime finds param schema + init hooks (deferred - types support it, implementation in later phase)
- [x] Update descriptor meta shapes:
  - [x] `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts` - not needed for scalar types
  - [x] `packages/3-extensions/pgvector/src/core/descriptor-meta.ts` (reference implementation)
- [x] Add tests proving:
  - [x] descriptor meta can express parameterized codec(s)
  - [x] emit collects/assembles the descriptors for the selected adapter + extension packs

## Phase 3 — Emission plumbing (contract emit)

- [x] Add tests around the emit pipeline to prove parameterized descriptors are passed through
- [x] Update emission API surfaces (`packages/1-framework/1-core/migration/control-plane/src/emission/*`):
  - [x] extend `EmitOptions` / `ValidationContext` as needed to include parameterized codec descriptor info
  - [x] ensure family hooks can access this info during `generateContractTypes`
- [x] Update SQL family hook signature/implementation as needed (avoid coupling to specific adapters/extensions)

## Phase 4 — SQL family type emission (tests first)

- [x] Add tests in `packages/2-sql/3-tooling/emitter/test/` proving:
  - [x] a column with `typeParams` emits a parameterized TS type expression via the codec descriptor renderer
  - [x] deterministic output ordering when multiple parameterized types exist
- [x] Update `packages/2-sql/3-tooling/emitter/src/index.ts`:
  - [x] when `StorageColumn.typeParams` exists, use the parameterized renderer for the column's `codecId`
  - [x] for columns without `typeParams`, emit `CodecTypes['...']['output']` (normal scalar behavior)

## Phase 5 — Runtime initialization + schema() helpers (tests first)

- [x] Define how runtime receives the parameterized codec descriptors (parallel to emission plumbing)
- [x] Add runtime tests to `@prisma-next/sql-runtime` for:
  - [x] validating `storage.types` and `typeParams` against codec-provided schemas
  - [x] rejecting invalid params early with a stable error envelope/code
- [x] Update runtime context creation (`createRuntimeContext` and related types):
  - [x] resolve `storage.types` into initialized helper objects by calling codec-owned init hooks (if present)
  - [x] store initialized helpers on the runtime context
- [x] Update `schema()` (`packages/2-sql/4-lanes/relational-core/src/schema.ts`) to surface helpers:
  - [x] return `{ tables, types }` (or equivalent), keeping `tables` unchanged
  - [x] add type tests verifying `schema(context).types.*` is strongly typed from `contract.d.ts`

## Phase 6 — Reference implementation: pgvector dimensioned types (tests first)

- [x] Decide pgvector contract authoring shape:
  - [x] column inline typeParams (`{ length: 1536 }`) and/or named `storage.types` instance (e.g. `Vector1536`)
- [x] Update `@prisma-next/extension-pgvector`:
  - [x] define `typeParams` schema (arktype) for vector length
  - [x] provide TS type(s) for vectors (e.g. `Vector<N extends number>`)
  - [x] provide a parameterized codec descriptor for `pg/vector@1` that renders `Vector<length>`
  - [x] optionally provide runtime helper factories (if we want `schema.types.Vector1536`-style APIs)
- [x] Add type tests (d.ts tests) proving:
  - [x] model field / schema column types resolve to `Vector<1536>` when params are present
  - [x] operations like `cosineDistance` remain available on the column builder

## Phase 7 — Second reference parameterized type (test-only)

- [ ] Add a lightweight test-only parameterized codec to prove the framework is generic:
  - [ ] params schema + renderer that produces a distinctive TS type expression
  - [ ] runtime validation test
  - [ ] schema helper surface test (if applicable)

## Phase 8 — No-emit/zero-emit workflow compatibility (tests first)

- [ ] Add type-level tests proving parameterized column typing works without emitted `contract.d.ts`:
  - [ ] TS-authored contract object (`as const`) retains literal `typeParams`/`typeRef` and drives lane typing
  - [ ] No-emit typing composes parameterized codec type maps via types-only imports (no runtime execution)
- [ ] Add runtime/canonicalization tests proving the same canonical JSON/coreHash is produced in both workflows (TS-first vs emitted JSON)


