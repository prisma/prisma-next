## Unified Type Identifiers for Columns — Simplify Codecs and Typing

### Objective

Simplify the model by making every column `type` a fully qualified type identifier (`ns/name@version`) and removing codec decorations and JSON mappings. This makes compile-time typing and runtime resolution deterministic without special-case fallbacks.

### Background (Current State)

- JSON contract stores storage scalars in `storage.tables.*.columns.*.type` (e.g., `int4`, `text`). Some work-in-progress fixtures also include codec decorations under `extensions.<ns>.decorations.columns[].payload.typeId`.
- Core `@prisma-next/sql` types (`packages/sql/src/types.ts`) infer projection types via:
  - `mappings.columnToCodec[table][column]` + `mappings.codecTypes[codecId].output` (preferred)
- Contract validation (`packages/sql/src/contract.ts`) currently requires `mappings.columnToCodec` and `mappings.codecTypes` and validates every column is mapped.
- Plan builder encodes codec IDs into `plan.meta.annotations.codecs` by reading `contract.mappings.columnToCodec`.

### Problems

- Decorations bloat JSON and duplicate schema information.
- Core fallback `ContractScalarToJsType` violates adapter ownership of scalar→JS mapping.
- JSON requiring `columnToCodec` couples runtime codec choice to the artifact and increases complexity.

### Decision

Adopt a unified type model:

- Column `type` is always a fully qualified type identifier (`ns/name@version`). Base “scalars” are adapter-owned type IDs (e.g., `pg/int4@1`, `pg/text@1`, `pg/timestamptz@1`). Extension types are pack-owned IDs.
- Remove codec decorations for columns and remove `mappings.columnToCodec` from JSON. Keep JSON code-free with only the column `type` ID and `nullable`.
- `contract.d.ts` provides a types-only `CodecTypes` map that unifies adapter + extension type IDs to `{ input; output }`. No codec maps appear in JSON.
- Lanes infer exclusively from the column `type` ID via `CodecTypes[typeId].output` and nullability. No scalar fallback branching.
- Runtime resolves codecs by `registry.byId(typeId)`. Plan hints and per-runtime overrides remain optional precedence controls.

### Scope of Work (Implementation Steps)

1) Canonicalize Column Types
- Accept authored column `type` as either a bare scalar (`int4`, `text`, `timestamptz`) or a fully qualified `typeId`.
- During validation/canonicalization (`packages/sql/src/contract.ts`):
  - Map bare scalars to adapter type IDs: e.g., `int4` → `pg/int4@1`, `text` → `pg/text@1`, `timestamptz` → `pg/timestamptz@1`.
  - Ensure the result is a string literal `ns/name@version` per column.
  - Remove the requirement for `mappings.columnToCodec` and `mappings.codecTypes`. Do not throw when mappings are absent.

2) Remove Codec Decorations for Columns
- Stop emitting and validating `extensions.<ns>.decorations.columns[].payload.typeId` for codec selection. Decorations remain for other extension metadata (indexes, predicates, etc.).

3) contract.d.ts Types Surface
- Emit or reference a unified types-only map for codec IO types:
  - `import type { CodecTypes as PgCodecTypes } from '@prisma-next/adapter-postgres/codec-types'`
  - For extensions, import their `CodecTypes` (when used).
  - `export type CodecTypes = PgCodecTypes & ExtA & ExtB` (or minimal Pick of used IDs).
- No `mappings.codecTypes` object in JSON; types-only mapping exists in `.d.ts` or TS-only builder generics.

4) Lane Typing (`packages/sql/src/types.ts`)
- Update `InferColumnType` to:
  - Read `columnMeta.type` as a `typeId` string literal.
  - Infer `CodecTypes[typeId].output` (preserving `nullable` by unioning `null` when true).
- Update `InferProjectionRow` accordingly; no other logic changes.

5) Plan Annotations for Codecs
- At plan build time (DSL lane), annotate `plan.meta.annotations.codecs` with the column type ID directly:
  - Projection alias → `column.type` (typeId)
  - WHERE param name → referenced column `type` (typeId)
- This replaces the previous read from `contract.mappings.columnToCodec`.

6) Runtime Resolution
- Runtime resolves codecs strictly by ID:
  - Precedence: plan hint → runtime override → `registry.byId(typeId)`; no by-scalar lookup.
  - Default registry selection remains first-by-registration order at the same ID (should be a single implementation for each ID). If multiple candidates exist erroneously, error.
- Validate at startup/first-use: every column `type` ID used by a plan must exist in the composed registry (adapter + packs). Fail with a stable error if missing.

7) Adapter Types and Registry
- Update Postgres adapter types-only export (`packages/adapter-postgres/src/exports/codec-types.ts`) to define adapter type IDs for base types, for example:
```ts
export type CodecTypes = {
  readonly 'pg/text@1': { readonly input: string; readonly output: string };
  readonly 'pg/int4@1': { readonly input: number; readonly output: number };
  readonly 'pg/float8@1': { readonly input: number; readonly output: number };
  readonly 'pg/timestamptz@1': { readonly input: string | Date; readonly output: string };
  // keep existing core ids as aliases only if required by tests, else migrate fully
};
```
- Ensure the adapter’s runtime `CodecRegistry` registers codecs under the same IDs.

8) Tests & Fixtures
- Update `packages/sql/test/fixtures/contract.json`:
  - Remove codec decorations for columns;
  - **Use fully qualified type IDs** (`pg/int4@1`, not `int4`) - contracts must always have fully qualified type IDs.
  - `validateContract()` does not perform canonicalization - it expects all types to already be fully qualified.
- Update or add `packages/sql/test/fixtures/contract.d.ts`:
  - Export `CodecTypes` referencing adapter types (`pg/*@1`) and any extensions.
- Update `packages/sql/test/sql.test.ts` expectations:
  - Plan annotations `meta.annotations.codecs` now equal the column `type` id (e.g., `pg/int4@1`), both for projections and params.
  - `ResultType<typeof plan>` infers via `CodecTypes[typeId].output`; nullability from storage.
- Remove tests that assert the presence of `mappings.columnToCodec`/`codecTypes` in JSON and any tests expecting scalar fallback behavior.

### Acceptance Criteria

- Column `type` must be a fully qualified typeId (`ns/name@version`) in all contracts (JSON, test fixtures, etc.).
- `validateContract()` does not perform canonicalization - it expects all types to already be fully qualified.
- Type canonicalization happens at authoring time (PSL parser or TS builder), not during validation.
- No codec decorations for columns, no `mappings.columnToCodec`/`mappings.codecTypes` required in JSON.
- Lanes infer result types solely from `CodecTypes[typeId].output` and nullability.
- Plan annotations encode codec IDs using the column `type` id for both projections and params.
- Runtime resolves codecs by ID, validates coverage, and executes with unchanged error taxonomy.
- All updated tests pass; old mapping-based tests are removed or rewritten.

### References

- Architecture Overview: lanes infer from `.d.ts`; runtime owns encode/decode
- Query Lanes: result typing rules and plan metadata
- ADR 131: Codec typing separation (emit-time types, lane compile-time, runtime registry)
- No-Emit Workflow: TS-only builder generics for types without emit

