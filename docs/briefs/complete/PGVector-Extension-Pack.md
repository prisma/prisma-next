# Brief: pgvector Extension Pack (SQL Family)

## Problem
- We need a first-class example of an extension pack that contributes new data types, operations, and (optionally) capabilities, end-to-end through emit → types → query lanes → runtime.
- This validates the packs model, registry assembly, and type import flow for SQL targets, and serves as the template for future packs.

## Goals
- Ship a `pgvector` extension pack that:
  - Adds a `vector` codec/type (e.g., `pg/vector@1`) with TS runtime type `number[]` (or Float32Array if we choose).
  - Exposes vector similarity operations (e.g., cosine distance) via the operations registry for `vector`.
  - Optionally declares capabilities (e.g., `ivfflat`, `vector.cosine`) that can gate features or provide hints.
- Integrate with CLI family assembly so `contract.d.ts` includes codec/operation types via imports from the pack.
- Demonstrate usage in `examples/prisma-next-demo` (new column + simple ANN-like query).
- Add unit/integration/e2e tests; follow TDD.

## Non-Goals
- Full ANN index management or migrations UI; basic capability/test hooks only.
- Cross-database abstraction for vector types (focus Postgres + pgvector).

## Design Overview
- Pack Manifest (`packs/manifest.json`):
  - `types.codecTypes.import`: points to a module exporting the TS type mapping for `pg/vector@1`.
  - `types.operationTypes.import`: points to a module exporting operation types for vector ops.
  - `operations[]`: entries for methods (e.g., `cosineDistance`) on `for: 'pg/vector@1'` with lowering templates.
  - Optional `capabilities`: e.g., `{ 'pgvector/ivfflat': true, 'pgvector/cosine': true }`.
- Assembly:
  - Family CLI (`@prisma-next/family-sql/cli`) consumes the pack via config and assembles operation registry + type imports (no framework/cli↔SQL coupling).
- Types:
  - Codec type: `CodecTypes['pg/vector@1']#output` → `number[]`.
  - Operation types: augment `OperationTypes` for `pg/vector@1` with methods like `cosineDistance(rhs: vector | number[]): number`.
- Lowering:
  - Operation lowering uses function or infix strategy, e.g., `strategy: 'function', template: 'cosine_distance({{lhs}}, {{rhs}})'`.
  - Keep SQL portable to Postgres+pgvector; avoid locking into non-standard schemas (qualify as needed).

## Public API (Pack)
- Package: `@prisma-next/extension-pgvector`
- Exports:
  - `packs/manifest.json` (consumed at runtime by CLI/family)
  - `types/codec-types.ts` – `export type CodecTypes = { 'pg/vector@1': { output: number[] } }` (merged into Contract mapping)
  - `types/operation-types.ts` – operation method typings for `pg/vector@1`
  - Optional runtime helpers (none required for MVP)

## CLI Config Example
- prisma-next.config.ts:
  - Add `pgvector()` descriptor to `extensions: []` alongside adapter/target.
  - Emit picks up codec/operation type imports from the pack; `contract.d.ts` reflects them.

## Query Usage Example (Demo)
- Add `embedding` column to `post` or `user` as `pg/vector@1`.
- Insert rows with vector values.
- Query top-N by distance (plan using SQL lane + op):
  - `tables.post.columns.embedding.cosineDistance(param('q'))` in select/orderBy.

## Work Plan (TDD)
1) Types & Manifest (Red → Green)
- Tests:
  - Unit: validate `packs/manifest.json` schema; verify codec/operation types importable.
  - Unit: contract emission includes pack’s type imports in `contract.d.ts`.
- Impl:
  - Add `@prisma-next/extension-pgvector` package skeleton with manifest and type modules.

2) Operation Registry & Lowering
- Tests:
  - Unit: assembling registry includes `cosineDistance` for `pg/vector@1`.
  - Unit: lowering produces expected SQL template given lhs/rhs.
- Impl:
  - Add `operations` entries in manifest; ensure `targetFamily: 'sql'` and correct templates.

3) Capability Gating (Optional)
- Tests:
  - Unit: when capability missing/false, calling the op results in PLAN.INVALID with hints/docs (pattern mirrors existing errors).
- Impl:
  - If needed, add check utility in vector op wiring to guard by capability.

4) Demo App Integration
- Tests:
  - Integration: emit contract with pgvector in config; types present; simple query compiles and executes.
  - E2E (example): seed vectors and query by cosine distance; verify rows ordered as expected.
- Impl:
  - Update `examples/prisma-next-demo` schema to add vector column; seed script to insert vectors; a new example query to perform similarity search.
  - README updates for enabling pgvector (extension creation) and env notes.

5) Documentation
- Brief kept current; README for the pack with install/config instructions and examples.
- Link from `AGENTS.md` and relevant reference docs.

## Tests to Add
- packages/extension-pgvector
  - Manifest schema validation test
  - Types import smoke tests (codec + operation types)
- packages/sql/tooling/emitter (or integration harness)
  - Emit integration: `contract.d.ts` contains merged types from pgvector
- packages/sql/lanes/*
  - Registry op presence and lowering tests for vector operations
- examples/prisma-next-demo
  - Seed + query integration test and/or script with expected output
- e2e (test/integration)
  - Full flow: config→emit→runtime execute distance order-by

## Acceptance Criteria
- Contract emission includes pgvector codec/operation type imports (verified in output `contract.d.ts`).
- Operation registry exposes vector ops; lowering produces correct SQL for Postgres+pgvector.
- Demo app compiles and runs with vector insert + similarity query; README updated.
- All new tests pass; coverage includes manifest, assembly, lowering, and demo flow.
- `pnpm lint:deps` passes (no new layering violations).

## Risks & Mitigations
- DB setup for pgvector: document `CREATE EXTENSION IF NOT EXISTS vector;` in demo README and tests. Use guards to skip if unavailable in CI.
- Type shape choices (`number[]` vs `Float32Array`): start with `number[]` for ergonomics; document potential future switch.
- SQL template stability: encapsulate in manifest; test lowering against fixtures.

## File Map (Proposed)
- packages/extensions/pgvector/
  - packs/manifest.json
  - src/types/codec-types.ts
  - src/types/operation-types.ts
  - package.json, README.md
- examples/prisma-next-demo/
  - prisma/contract.ts (add embedding column)
  - scripts/seed.ts (insert vectors)
  - src/queries/similarity-search.ts (example)

## References
- docs/Architecture Overview.md
- docs/reference/extensions-glossary.md
- docs/briefs/complete/20-CLI-Support-for-Extension-Packs.md
