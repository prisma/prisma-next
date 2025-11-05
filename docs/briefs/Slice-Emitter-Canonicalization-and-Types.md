## Emitter Slice — Canonicalization and Types Surface (contract.json + contract.d.ts)

Note: This overview has been split into three focused briefs (reading order):
- Slice 1 — Emission Pipeline (From IR): `02-Emitter-Pipeline-From-IR.md`
- Slice 2 — TS Contract Loader + CLI: `03-TS-Contract-Loader-and-CLI.md`
- Slice 3 — PSL Parser + CLI: `04-PSL-Parser-and-CLI.md`

### Objective

Implement the emitter pipeline that converts authored input (PSL or TS builder) into:

- Canonical, code-free `contract.json` with stable hashing
- Minimal, types-only `contract.d.ts` for compile-time inference by lanes

Align with the unified type identifier model: every column `type` canonicalizes to a fully qualified type ID (`ns/name@version`) owned by the adapter or an extension pack. Keep codecs out of JSON artifacts; provide type information via `.d.ts` only.

### References

- Architecture Overview: `docs/Architecture Overview.md`
- Data Contract: `docs/architecture docs/subsystems/1. Data Contract.md`
- Contract Emitter & Types: `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- Query Lanes: `docs/architecture docs/subsystems/3. Query Lanes.md`
- Ecosystem Extensions & Packs: `docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md`
- No-Emit Workflow: `docs/architecture docs/subsystems/9. No-Emit Workflow.md`
- ADR 010 (Canonicalization Rules), ADR 011 (Unified Plan), ADR 131 (Codec typing separation)

### Inputs

- Authoring source: PSL AST or TS builder IR
- Adapter target (`contract.target`) and (optional) extension manifests/pins

Adapter/Pack manifest (treat adapters as packs)
- Location: `packages/<adapter>/packs/manifest.json`
- Reuse pack manifest shape with an added `types` section for the emitter:
```json
{
  "id": "postgres",
  "version": "15.0.0",
  "targets": { "postgres": { "minVersion": "12" } },
  "capabilities": {},
  "types": {
    "codecTypes": {
      "import": {
        "package": "@prisma-next/adapter-postgres/exports/codec-types",
        "named": "CodecTypes",
        "alias": "PgTypes"
      }
    },
    "canonicalScalarMap": {
      "int2": "pg/int2@1",
      "int4": "pg/int4@1",
      "int8": "pg/int8@1",
      "float4": "pg/float4@1",
      "float8": "pg/float8@1",
      "text": "pg/text@1",
      "timestamp": "pg/timestamp@1",
      "timestamptz": "pg/timestamptz@1",
      "bool": "pg/bool@1"
    }
  }
}
```
Extensions will supply analogous manifests; the emitter reads all manifests to canonicalize types and generate `.d.ts` imports.

### Outputs

- `contract.json` (canonicalized)
  - `schemaVersion`, `targetFamily`, `target`, `coreHash`, `profileHash`
  - `models`, `storage` (tables/columns), constraints and indexes
  - `extensions.<ns>` payloads (where packs add their data)
  - Columns: `columns[name]: { type: string; nullable?: boolean }` where `type` is a typeId `ns/name@version`
- `contract.d.ts` (types-only)
  - Codec type map: `typeId → { input; output }` assembled from adapter + extensions. For MVP, import the full adapter/pack `CodecTypes` maps (do not Pick only used IDs).
  - Optionally re-export of Tables/Models/Relations interfaces as today

Note: Lanes take an optional generic/argument `codecTypes` to enable compile-time inference (see `ComputeColumnJsType`). The emitter should make it straightforward to import and pass this type map from `contract.d.ts` into `schema(contract, codecTypes)` and `sql({ contract, adapter, codecTypes })`.

### Canonicalization Rules (Emitter)

1) Column type normalization
- Accept authored column `type` as either:
  - Bare scalar (e.g., `int4`, `text`, `timestamptz`) or
  - Fully qualified typeId (e.g., `pg/int4@1`, `pg/text@1`, `core/iso-datetime@1`)
- Canonicalize all bare scalars to adapter-owned typeIds (e.g., `int4 → pg/int4@1`).
- Validate typeId format `ns/name@semverLike` and normalize case and separators consistently.

2) Remove codec decorations for columns
- Do not emit `extensions.<ns>.decorations.columns[].payload.typeId` for codec selection.
- Keep decorations for other extension metadata (indexes, predicates, views, etc.).

3) No codec mappings in JSON
- Do not emit `mappings.columnToCodec` or `mappings.codecTypes` in JSON.
- JSON remains code-free; the column `type` id plus `nullable` are sufficient.

4) Capability profile
- Compute `profileHash` from declared capability keys and pinned adapter/extension versions as per ADR 004, independent of codecs.

5) Hashing
- Canonicalize JSON per ADR 010 (key ordering, stable arrays, normalized scalars) and compute `coreHash` (schema meaning) and `profileHash` (capabilities/pins).

### Types Generation (`contract.d.ts`)

- Discover used typeIds by walking storage columns and any extension-owned sources.
- Generate a minimal `CodecTypes` map referencing adapter/pack type exports:

```ts
// contract.d.ts (excerpt)
import type { CodecTypes as PgTypes } from '@prisma-next/adapter-postgres/codec-types';
// import type { CodecTypes as PgVectorTypes } from '@prisma-next/pack-pgvector/codec-types';

// MVP: import full maps; optimization to Pick only used IDs can come later
export type CodecTypes = PgTypes; // & PgVectorTypes & ...
export type LaneCodecTypes = CodecTypes; // convenient alias for lanes
```

- Do not generate runtime objects; this is types-only for compile-time lane inference.

### Validation

- Structural: models ↔ storage, constraints, FKs, etc. (unchanged)
- Types:
  - Ensure each column `type` is a known typeId or scalar canonicalizable to a known typeId for the chosen adapter.
  - (Optional/strict) Verify that for each used typeId, a corresponding type entry exists in the referenced adapter/pack `CodecTypes` (compile-time) and that runtime registries are expected to provide implementations (not validated here).
- Extensions: validate extension payloads against pack schemas; deterministic canonicalization.

Implementation alignment: The current code already canonicalizes storage column types to adapter IDs and drops JSON codec mappings. Ensure validation errors refer to unknown typeIds when a scalar can’t be canonicalized.

### Lane and Runtime Contracts (for emitter outputs)

- Lanes: infer projection field types from `contract.d.ts` only: `CodecTypes[column.type].output`, applying nullability from storage. No runtime coupling.
- Lanes pass the types-only map through the API surface to enable compile-time inference:
  - `const tables = schema(contract, CodecTypes)`
  - `sql({ contract, adapter, codecTypes: CodecTypes })`
- Runtime: resolves codecs strictly by `registry.byId(column.type)`. Plan hints/overrides may supersede. Validate that all used typeIds are registered at startup/first execute.

### Acceptance Criteria

- `contract.json` contains only canonicalized adapter/extension typeIds for columns; no codec decorations/mappings.
- `contract.d.ts` exports a minimal `CodecTypes` for used ids, referencing adapter/pack types.
- Hashes are stable and reproducible across environments.
- Query lane type tests pass when using only `contract.json` + `contract.d.ts`.
- Runtime can execute with adapter codecs registered by id; missing codec ids produce a clear error.

### Migration/Compatibility Notes

- Authoring may continue to specify bare scalars; emitter canonicalizes to adapter ids.
- Existing tests referring to `mappings.columnToCodec`/decorations should be updated to rely on `column.type` ids.

### Test Plan (Emitter + TS-only Authoring Parity)

Goal: Prove emitter artifacts and TS-only authoring are equivalent for lanes and runtime, with both integration tests and type-level tests.

1) Emit Path (PSL-first)
- Golden emit test: given a PSL schema, emitter produces canonical `contract.json` + minimal `contract.d.ts`; re-emit is byte-identical; `coreHash` stable.
- Type tests: import emitted `contract.d.ts`; build a DSL plan from `contract.json`; assert `ResultType<typeof plan>` matches expected types (via `CodecTypes[typeId].output`, nullability).
- Ensure tests pass the `codecTypes` map into `schema`/`sql` to engage `ComputeColumnJsType` inference.
- Integration test: create runtime with emitted `contract.json`; build and execute a simple DSL plan; assert:
  - plan.sql and params are stable
  - meta.coreHash matches contract
  - meta.annotations.codecs contains the column `type` ids for projections/params

2) TS-only Path (No-Emit)
- Type tests: build the contract via TS builder (generic over adapter `CodecTypes`); construct the same DSL plan; assert `ResultType<typeof plan>` equals the emitted path type.
- Ensure the TS-only path passes the same type map generic through to `schema`/`sql`.
- Integration test: runtime initialized with the in-memory contract; execute the same plan; assert the same SQL, params, refs, projection, lane, meta.coreHash, and annotations as the emit path.

3) Parity Assertions
- Plans produced via emit path and TS-only path are identical modulo irrelevant metadata (timestamps); at minimum: `sql`, `params`, `meta.coreHash`, `meta.projection`, `meta.refs`, and `meta.annotations.codecs` match.
- `ResultType<typeof plan>` is identical across both authoring modes.

4) CI
- Run both suites in CI to guard regressions as the model extends; parity tests must remain green when new columns/types are added.

### TDD and Test Strategy

- Use TDD for all changes:
  - Write failing unit tests first for each element, then implement until green.
- Unit tests per element:
  - Canonicalization: bare scalar → adapter typeId; unknown scalar errors; idempotency when already typeId.
  - Manifest loading: adapter manifest parsed; `canonicalScalarMap` and `types.codecTypes.import` consumed correctly.
  - Types generation: `.d.ts` imports full adapter `CodecTypes`, exports `LaneCodecTypes` alias.
  - Lane wiring: passing `codecTypes` into `schema`/`sql` yields correct `ComputeColumnJsType` output types, including nullability.
  - Plan annotations: `projectionTypes` and `annotations.codecs` sourced from `columnMeta.type` for projections and params.
  - Runtime validation: error when a `column.type` id is missing in the registry; success when present.
- Integration tests end-to-end:
  - Emit path: author schema → emit artifacts → build plan → execute; assert SQL/params/meta and types.
  - TS-only path: same plan and execution outcomes; assert parity with emit path.

### Example App Update (prisma-next-demo)

- Update `examples/prisma-next-demo` to demonstrate both authoring modes:
  - Emitted mode: load `contract.json`, import `contract.d.ts` types, pass `LaneCodecTypes` into `schema`/`sql`.
  - TS-only mode: import the TS contract object directly, pass the same `LaneCodecTypes` into `schema`/`sql`.
- Provide two equivalent queries (one per mode) producing identical plans (SQL, params, meta) and identical `ResultType`s.

### Open Questions for Confirmation

1) Adapter typeId namespace and versions
- Confirm canonical adapter ids to use for base scalars (e.g., `pg/int4@1`, `pg/text@1`, `pg/timestamptz@1`).
- Provide the authoritative mapping from bare scalars → adapter typeIds in the emitter (or adapter-provided table).

2) Unknown type handling
- If a column `type` is an unknown id (neither scalar nor recognized typeId), should the emitter fail hard, or allow and defer to runtime validation? Proposed: fail at emit.

3) Minimal `.d.ts` scope
- Decision: for MVP, import the full adapter/pack `CodecTypes` maps (no Pick). Optimization to Pick used IDs can be added later.

3a) Export convenience alias
- Decision: emitter exports a `LaneCodecTypes` alias to standardize passing the map into `schema`/`sql`.

### TS-only Emission (No PSL)

Goal: emit `contract.json` + `contract.d.ts` from a TS contract entry without pulling the app source tree.

Runner approach (lowest friction): esbuild bundle + direct ESM import
- esbuild bundles the specified contract entry module with an allowlist of imports.
  - Allowed: `@prisma-next/*` packages; optionally later a `./contract/**` subtree.
  - All other imports are externalized/blocked.
- A small Node process dynamically imports the bundle and reads the exported contract object.
- Validate purity: object must be JSON-serializable (no functions/getters), then canonicalize types via adapter manifest and write artifacts.

Import whitelist policy (MVP)
- Allow only `@prisma-next/*` imports in the contract entry; deny everything else by default. Expand later if needed.

Out of scope (MVP)
- No extra `contract.meta.json`; canonical `contract.json` already includes `target`, `coreHash`, and optional `profileHash`.

4) Extension types
- For extension typeIds, can we rely on pack-provided `CodecTypes` being importable at emit time? If not present, should emitter fail or omit types? Proposed: fail to preserve determinism.

5) Bare scalar support timeline
- Keep scalar authoring support indefinitely (with canonicalization), or require explicit typeIds post-MVP? Proposed: keep support; canonicalize.

6) Profile hash inputs
- Any adapter/extension pinning that must participate in `profileHash` beyond capability keys? Confirm fields.


