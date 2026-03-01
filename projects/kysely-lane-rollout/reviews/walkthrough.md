## Before / After (intention in code)
```ts
// BEFORE: Kysely build-only lane plans via `.compile()` (produces SQL text).
// See: createKyselyLane().build(...)
```

```ts
// AFTER: Compile-free plan assembly exists internally by consuming `.toOperationNode()`
// and collecting params/descriptors during AST transform (no SQL string required).
// See: buildKyselyPlan(contract, opNode)
```

## Sources
- **Spec (project)**: [`projects/kysely-lane-rollout/spec.md`](projects/kysely-lane-rollout/spec.md)
- **Spec (phase 3, local/on-disk)**: [`projects/kysely-lane-rollout/specs/03-compile-free-kysely-plan-assembly.spec.md`](projects/kysely-lane-rollout/specs/03-compile-free-kysely-plan-assembly.spec.md)
- **Commit range**: `origin/main...HEAD`
- **Commits**:
  - `3c6fda35` feat(sql-kysely-lane): collect params during AST transform
  - `8f77ab28` feat(sql-kysely-lane): build plans from operation nodes
  - `bb121e86` refactor(sql-kysely-lane): keep plan builder internal

## Intent
Add a **compile-free** planning path for the build-only Kysely lane by planning from Kysely operation nodes and collecting params/descriptors during transform.

## Change map
- **Implementation**:
  - [packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts (L1–L65)](packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts:1-65)
  - [packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts (L159–L238)](packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts:159-238)
- **Tests (evidence)**:
  - [packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts (L52–L88)](packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts:52-88)

## The story
1. Introduce an internal build-only-lane helper that turns a Kysely **operation node** into a Prisma Next `SqlQueryPlan<Row>` without compiling SQL.
2. Make parameter handling lane-owned by collecting `params` + `paramDescriptors` during transformation, so `ParamRef.index` aligns with `plan.params` deterministically.

## Behavior changes & evidence
- **Build-only lane can assemble plans without SQL compilation**: previously the build-only surface planned via `.compile()` (which constructs SQL text) → now an internal helper can plan directly from `.toOperationNode()` and transform-time param collection.
  - **Why**: reduce coupling to Kysely compilation artifacts (placeholder rendering / param ordering) and avoid constructing SQL strings that Prisma Next immediately discards in AST-first lowering.
  - **Implementation**:
    - [packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts (L46–L65)](packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts:46-65)
    - [packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts (L159–L238)](packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts:159-238)
  - **Tests**:
    - [packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts (L52–L88)](packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts:52-88)

- **Params + descriptors are collected during AST transform**: previously param ordering relied on `CompiledQuery.parameters` / compilation → now transforms can emit `params` and `paramDescriptors` from the operation tree traversal.
  - **Why**: keep \(ParamRef.index \leftrightarrow plan.params \leftrightarrow meta.paramDescriptors\) alignment lane-owned and deterministic.
  - **Implementation**:
    - [packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts (L159–L238)](packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts:159-238)
    - [packages/2-sql/4-lanes/kysely-lane/src/transform/transform-expr.ts (L31–L64)](packages/2-sql/4-lanes/kysely-lane/src/transform/transform-expr.ts:31-64)
  - **Tests**:
    - [packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts (L52–L88)](packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts:52-88)

## Compatibility / migration / risk
- **Risk**: transform-time parameter collection is sensitive to Kysely AST shape differences between `.toOperationNode()` and compiled `query` nodes. The tests cover basic select + where and `IN (...)` ordering, but more coverage may be needed for `limit`, joins, and nested expressions.

## Follow-ups / open questions
- Add explicit tests for `limit` parameter indexing/alignment on the compile-free path (Phase 3 plan calls this out).

## Non-goals / intentionally out of scope
- Replacing Kysely runtime SQL compilation (`QueryCompiler`) to make runtime execution compile-free (explicitly deferred in the Phase 3 spec).
