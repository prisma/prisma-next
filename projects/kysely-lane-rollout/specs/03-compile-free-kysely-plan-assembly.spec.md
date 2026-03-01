# Summary

Implement **compile-free** Kysely → Prisma Next plan assembly for the build-only Kysely lane, so we don’t construct a SQL string only to discard it. The primary value is **reduced coupling** to Kysely compilation artifacts (parameter ordering, placeholder rendering), while preserving the Phase 2 invariant that supported Kysely queries compile into **AST-backed `SqlQueryPlan<Row>`**.

# Description

For supported Kysely query shapes, Prisma Next executes by lowering PN SQL AST (`QueryAst`) via the adapter, not by treating Kysely’s compiled SQL string as the source of truth. However, Kysely’s default execution path produces a `CompiledQuery` that includes `sql`, `parameters`, and `query` (operation tree). For supported queries, we only need the operation tree and parameters — not the SQL text — so building SQL is wasted work.

This phase introduces a compile-free path for the **build-only lane** by:

- Taking the operation tree directly from Kysely query builders (`.toOperationNode()`).
- Transforming to PN AST (`QueryAst`) as before.
- Collecting `plan.params` and `meta.paramDescriptors` **during transformation** so param ordering/indexing is lane-owned and deterministic.

# Requirements

## Functional Requirements

- Build-only lane can assemble a `SqlQueryPlan<Row>` from a Kysely operation tree without calling `.compile()`.
- Parameter ordering and `ParamRef.index` invariants remain stable:
  - `QueryAst` param refs (`ParamRef.index`) align with `plan.params`.
  - `meta.paramDescriptors[index]` aligns with `plan.params[index - 1]`.
- Guardrails remain active for supported query shapes (especially multi-table ambiguity checks).
- No new public authoring surface is introduced as part of this phase; compile-free helpers remain internal until Phase 2 public surface work is explicitly updated.

## Non-Functional Requirements

- **No runtime compiler replacement:** we do not attempt to replace Kysely’s `QueryCompiler` in the runtime-attached integration. Compile-free behavior is scoped to the build-only lane.
- **Maintainability over micro-perf:** if avoiding SQL text construction increases complexity materially, prefer a smaller, test-proven internal helper and keep the public API stable.

## Non-goals

- Making runtime-attached Kysely execution compile-free (requires custom `QueryCompiler` / deeper Kysely coupling).
- Changing Postgres composition-root public API shape in this phase.
- Broad transformer expansion beyond the supported subset.

# Acceptance Criteria

- [x] Build-only Kysely lane has a compile-free planning path based on `.toOperationNode()`.
- [x] Tests demonstrate equivalence for representative supported shapes:
  - same `QueryAst` structure as the compiled flow for those shapes
  - same param ordering and descriptor alignment invariants
- [x] Docs record the go/no-go decision:
  - go: compile-free build-only plan assembly
  - no-go (for now): runtime compiler replacement
  - no new public API introduced in this phase

# Design Decisions (record)

1. **Go**: compile-free plan assembly in the build-only lane using `.toOperationNode()`.
2. **No-go (for now)**: replacing Kysely runtime compilation / introducing a custom `QueryCompiler`.
3. **Prefer lane-owned params**: collect params/descriptors during transform rather than relying on `CompiledQuery.parameters`.
4. **Avoid new public API**: keep plan-building helper internal until Phase 2 public surface changes explicitly adopt it.

# References

- Project tracker: `projects/kysely-lane-rollout/spec.md`
- Project plan: `projects/kysely-lane-rollout/plan.md`
- Phase 2 spec: `projects/kysely-lane-rollout/specs/02-kysely-lane-build-only.spec.md`

