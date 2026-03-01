# Compile-free Kysely plan assembly (Phase 3)

## Summary

Avoid compiling SQL text for supported Kysely queries when Prisma Next immediately discards that SQL and instead lowers from PN SQL AST. We accomplish this by planning from Kysely operation trees (`.toOperationNode()`) and collecting `params` + `paramDescriptors` during transformation, reducing coupling to Kysely compilation artifacts while preserving Phase 2 AST-first invariants.

**Spec:** `projects/kysely-lane-rollout/specs/03-compile-free-kysely-plan-assembly.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will Madden | Drives Phase 3 implementation |
| Reviewer | SQL/Lanes maintainers | Confirms lane boundaries + invariants |
| Collaborator | Runtime/plugins maintainers | Confirms plan meta invariants remain compatible |

## Milestones

### Milestone 1: Compile-free plan assembly (build-only)

Deliverable: build-only lane can assemble `SqlQueryPlan<Row>` from `.toOperationNode()` without calling `.compile()`, while preserving param ordering and descriptor alignment invariants.

**Tasks:**

- [x] Implement compile-free path that consumes Kysely operation nodes (no `.compile()` required).
- [x] Collect `plan.params` and `meta.paramDescriptors` during transformation (lane-owned ordering/indexing).
- [x] Keep guardrails active for supported shapes (multi-table ambiguity, qualified refs).
- [x] Ensure no new public authoring API is introduced; keep helper internal until explicitly adopted by public surface work.

### Milestone 2: Parity and regression tests

Deliverable: tests prove compile-free behavior matches current compiled flow for representative supported shapes and enforces invariants.

**Tasks:**

- [x] Add unit tests covering:
  - simple select + where param
  - IN list param ordering
  - limit param indexing (if applicable)
- [x] Add integration/regression tests ensuring runtime-attached supported queries still produce AST-backed plans and are lowered via PN adapters.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Build-only lane plans from `.toOperationNode()` without `.compile()` | Unit | Milestone 1 | Assert no SQL compilation is required to plan |
| Param ordering + descriptor alignment invariants preserved | Unit | Milestone 2 | Assert `ParamRef.index` ↔ `params` ↔ `paramDescriptors` alignment |
| Go/no-go decision recorded + no new public API | Docs review | Milestone 1 | Verify lane root exports don’t introduce new authoring function |

## Open Items

- Performance measurement: we treat “avoid SQL string construction” primarily as **coupling reduction**, not a proven perf win. If we need perf evidence, add a micro-benchmark task.
- Runtime-attached compile-free execution is explicitly out of scope (would require custom Kysely `QueryCompiler`).

