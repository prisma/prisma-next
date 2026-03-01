## Scope

Review range: `origin/main...HEAD`, plus on-disk project docs under `projects/kysely-lane-rollout/` updated in this worktree.

Primary intent source: `[projects/kysely-lane-rollout/spec.md](projects/kysely-lane-rollout/spec.md)` and the Phase 3 spec `[projects/kysely-lane-rollout/specs/03-compile-free-kysely-plan-assembly.spec.md](projects/kysely-lane-rollout/specs/03-compile-free-kysely-plan-assembly.spec.md)`.

## System intent (what new guarantees are introduced)

- **Compile-free build-only planning**: for supported Kysely query shapes, we can produce an AST-backed `SqlQueryPlan<Row>` from a Kysely operation tree (`.toOperationNode()`) without compiling SQL text.
- **Lane-owned params**: `ParamRef.index`, `plan.params`, and `meta.paramDescriptors` are collected during transformation, making ordering/indexing deterministic and owned by Prisma Next (not by Kysely compilation).

Key touchpoints:

- Build-only internal helper: [packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts (L46–L65)](packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts:46-65)
- Transform-time param collection: [packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts (L159–L238)](packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts:159-238)

## Subsystem fit (contracts, lanes, runtime, adapters/plugins)

- **Lane (SQL domain / build-only)**: `@prisma-next/sql-kysely-lane` gains an internal helper to build `SqlQueryPlan<Row>` from an operation node:
  - Guardrails run before transform: [packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts (L54–L65)](packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts:54-65)
  - The helper is intentionally not exported via the package root (Phase 3 “no new public API”): [packages/2-sql/4-lanes/kysely-lane/src/index.ts (L1–L6)](packages/2-sql/4-lanes/kysely-lane/src/index.ts:1-6)

This aligns with the architecture principle “plans are the product”: plans carry AST and metadata for inspection, not just SQL text.

## Boundary correctness (domains/layers/planes)

- **Good shape**:
  - Build-only Kysely lane changes live under `packages/2-sql/4-lanes/` (SQL domain lanes layer).

## Determinism & plan metadata invariants

### Param alignment

The core invariant is made explicit and reinforced:

- Transform assigns `ParamRef.index` as it collects params.
- Transform emits `metaAdditions.paramDescriptors` and collected `params`.
- Plan assembly slices `params` to descriptor length (ensuring plan params and descriptors stay aligned):
  - [packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts (L55–L64)](packages/2-sql/4-lanes/kysely-lane/src/internal/build-plan.ts:55-64)

Tests cover basic `=` and `IN (...)` list ordering:

- [packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts (L52–L88)](packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts:52-88)

### Refs determinism

The project plan calls out deterministic `meta.refs` as an invariant. The lane implementation is explicitly deterministic (dedupe + sort):

- [packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts (L24–L71)](packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts:24-71)

## Test strategy adequacy (architectural view)

What is well-covered:

- Transform-time param collection invariants for basic predicates (`=`, `IN`).

Key gaps for the Phase 3 “compile-free planning” guarantee:

- Explicit compile-free coverage for `limit` parameter indexing/alignment (Phase 3 plan calls out this test, but it is not present in the compile-free unit tests).
- Explicit coverage that guardrails run on the compile-free build-only helper path (the helper calls guardrails, but there is no direct test).

## Summary recommendations

- Add missing compile-free-path tests for `limit` (and at least one multi-table guardrail case) to lock in the Phase 3 invariants.
- Clarify ADR wording around extension pack contribution vs inference, and fix inconsistent terminology:
  - ADR 104 decision says contract JSON under `extensions.<namespace>` (easy to misread as “packs contribute PSL config”), but the rest of the ADR uses `contract.extensionPacks.<ns>`.
  - Suggested fix: make the Decision section explicitly say “PSL provides syntax; packs provide *data* (schemas/capabilities) + version pinning via `extensions { ... }`; emitted contract payload lives under `contract.extensionPacks.<ns>`”.
  - [docs/architecture docs/adrs/ADR 104 - PSL extension namespacing & syntax.md (L18–L18)](docs/architecture%20docs/adrs/ADR%20104%20-%20PSL%20extension%20namespacing%20%26%20syntax.md:18-18)
  - [docs/architecture docs/adrs/ADR 104 - PSL extension namespacing & syntax.md (L60–L65)](docs/architecture%20docs/adrs/ADR%20104%20-%20PSL%20extension%20namespacing%20%26%20syntax.md:60-65)

