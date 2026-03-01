## Summary

This change set adds a **compile-free** internal planning path for the build-only Kysely lane (plan from operation nodes + collect params during transform).

## What looks solid

- **Internal helper stays internal (no new public surface)**: the plan builder is deliberately not exported from the lane package root (aligns with Phase 3’s “no new public API” constraint).
  - [packages/2-sql/4-lanes/kysely-lane/src/index.ts (L1–L6)](packages/2-sql/4-lanes/kysely-lane/src/index.ts:1-6)
- **Param alignment invariants are explicit and exercised**: the lane collects `params` + `paramDescriptors` during transform and asserts ordering/indexing for `=` and `IN (...)`.
  - Lane test: [packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts (L52–L88)](packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts:52-88)
- `**meta.refs` determinism is explicit**: refs are deduped + sorted during transform.
  - [packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts (L24–L71)](packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts:24-71)

## Blocking issues (must fix before merge)

None noted in the `origin/main...HEAD` diff.

## Non-blocking concerns (important, but not a merge gate)

### 1) Missing compile-free-path test coverage for `limit` parameter indexing/alignment

- **Location**:
  - Limit param logic exists in transforms:
    - Lane: [packages/2-sql/4-lanes/kysely-lane/src/transform/transform-select.ts (L196–L207)](packages/2-sql/4-lanes/kysely-lane/src/transform/transform-select.ts:196-207)
  - Compile-free lane tests do not cover it: [packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts (L52–L88)](packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts:52-88)
- **Issue**: Phase 3 docs call out `limit` indexing as a representative invariant to lock in. Without a test, regressions in param indexing (especially alongside `IN (...)` lists or other expressions) could slip through.
- **Suggestion**: add a compile-free unit test that plans a query with `where(...)` + `limit(param)` and asserts:
  - `ParamRef.index` ordering
  - `plan.params` ordering
  - `meta.paramDescriptors` alignment

### 2) Guardrails are invoked in build-only compile-free helper, but not directly asserted

- **Location**:
  - Guardrail call: [packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts (L54–L55)](packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts:54-55)
- **Issue**: compile-free planning is a new entrypoint; it’s valuable to have at least one test proving guardrails are active on this path for multi-table ambiguity/qualification invariants.
- **Suggestion**: add one test that exercises a multi-table select with an unqualified ref and asserts the guardrail error is thrown.

### 3) Transformer semantics are duplicated between the lane and runtime integration (drift risk)

Not applicable in this diff range (no runtime attachment / integration package changes are present).

## Nits (optional)

- The slicing `params.slice(0, paramDescriptors.length)` is a reasonable safety measure, but consider asserting `params.length === paramDescriptors.length` during development/test to catch internal inconsistencies early.
  - Lane: [packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts (L57–L64)](packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts:57-64)

## Acceptance-criteria traceability

### Compile-free Kysely lane plan assembly from `.toOperationNode()`

- **Acceptance criterion**: “Build-only Kysely lane has a compile-free planning path based on `.toOperationNode()`.”
- **Implementation**:
  - [packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts (L46–L65)](packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts:46-65)
- **Evidence**:
  - [packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts (L52–L88)](packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts:52-88)

### Param ordering and descriptor alignment invariants

- **Acceptance criterion**: `ParamRef.index` aligns with `plan.params` and `meta.paramDescriptors`.
- **Implementation**:
  - [packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts (L159–L238)](packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts:159-238)
  - [packages/2-sql/4-lanes/kysely-lane/src/transform/transform-expr.ts (L31–L64)](packages/2-sql/4-lanes/kysely-lane/src/transform/transform-expr.ts:31-64)
- **Evidence**:
  - [packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts (L52–L88)](packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts:52-88)

### Guardrails remain active for supported shapes

- **Acceptance criterion**: multi-table ambiguity checks remain enforced.
- **Implementation**:
  - Build-only helper invokes guardrails: [packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts (L54–L55)](packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts:54-55)
- **Evidence**:
  - Not directly covered in the compile-free helper tests in this diff range (recommended follow-up: add a multi-table guardrail assertion test).

### No new public authoring API introduced in Phase 3

- **Acceptance criterion**: compile-free helpers remain internal.
- **Implementation**:
  - Public exports are type-only: [packages/2-sql/4-lanes/kysely-lane/src/index.ts (L1–L6)](packages/2-sql/4-lanes/kysely-lane/src/index.ts:1-6)

