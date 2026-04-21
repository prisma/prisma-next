# Task spec — Walk-schema audit

## Why

The Postgres target today has two planner pipelines:

- **Walk-schema planner** (`planner.ts` 902 LOC + `planner-reconciliation.ts` 798 LOC) — invoked by `db update`. Receives the live-DB schema IR and walks tables/columns/indexes/constraints alongside the contract, emitting `SqlMigrationPlanOperation[]` directly.
- **Issue-based planner** (`descriptor-planner.ts` 464 LOC) — invoked by `migration plan`. Receives `SchemaIssue[]` from `verifySqlSchema` and maps them through a strategy chain + default issue-to-descriptor mapping.

Phase 4 of the project plan (`collapse the two planners`) folds walk-schema logic into the issue-based pipeline. Phase 1 (`walk-schema → class-flow IR`) benefits from the same audit — it needs to know which call classes each walk-schema branch must construct.

**The audit is a research deliverable, not a code change.** Its output is consumed by Phase 1's `OpFactoryCall` class inventory (confirms the call-class list is complete) and is the authoritative checklist for Phase 4's absorption work.

## Deliverables

A single artifact committed alongside the Phase 1 PR at `projects/postgres-class-flow-migrations/assets/walk-schema-audit.md` (not in `wip/` — the plan references it, so it stays in the project folder until close-out, at which point it's deleted with the project).

The artifact contains one table row per walk-schema branch, with these columns:

| Column | Content |
|---|---|
| Source function | `planner.ts:buildDatabaseDependencyOperations` / `planner-reconciliation.ts:buildAlterColumnTypeOperation` / etc. — fully qualified |
| Line range | Approximate, for reviewability |
| Triggering condition | What contract/schema shape makes this branch fire |
| Corresponding `SchemaIssue` kind(s) | The issue kind(s) `verifySqlSchema` emits for the same shape; `NONE` if the branch depends on information not surfaced by `verifySqlSchema` |
| Emits operation class(es) | `additive` / `widening` / `destructive` / `data` |
| Corresponding `OpFactoryCall` class(es) | `CreateTableCall`, `DataTransformCall`, etc. — the call class Phase 1 must construct at this site |
| Covered by existing strategy? | Name of the issue-planner strategy that already handles the same issue, or `NO` |
| Absorbable by Phase 4? | `yes`, `yes-with-issue-extension`, or `no-investigate`. If `yes-with-issue-extension`, name the field to add to `SchemaIssue` |

## Scope

Every branch that produces an operation (`SqlMigrationPlanOperation`), a conflict (`SqlPlannerConflict`), or a cascade of ops (e.g. `enumRebuildRecipe` → 4 ops) is one row. Pure helpers (SQL string builders, lookup helpers, target-detail builders) are NOT rows — they're composed by the branch rows.

Walk-schema files in scope:
- `planner.ts` — every `private buildX` method on the planner class (`buildDatabaseDependencyOperations`, `buildStorageTypeOperations`, `buildTableOperations`, `buildColumnOperations`, `buildAddColumnOperation`, `buildPrimaryKeyOperations`, `buildUniqueOperations`, `buildIndexOperations`, `buildFkBackingIndexOperations`, `buildForeignKeyOperations`).
- `planner-reconciliation.ts` — every `buildX` function (`buildReconciliationOperationFromIssue`, `buildDropTableOperation`, `buildDropColumnOperation`, `buildDropIndexOperation`, `buildDropConstraintOperation`, `buildDropNotNullOperation`, `buildSetNotNullOperation`, `buildAlterColumnTypeOperation`, `buildDefaultOperation`, `buildDropDefaultOperation`, `buildConflict`).
- `planner-recipes.ts` — `enumRebuildRecipe` and any other recipes.

Out of scope: `planner-strategies.ts` (already issue-based), `runner.ts`, `scaffolding.ts`.

## Method

1. Open each walk-schema file in editor-friendly mode; read top-to-bottom.
2. For each `buildX` function / branch, fill one row of the table.
3. Cross-reference `SchemaIssue` kinds by reading `packages/2-sql/1-core/sql-schema-ir` and the `verifySqlSchema` output type.
4. Cross-reference existing strategies in `planner-strategies.ts` to populate the "covered by existing strategy?" column.
5. For each branch with `SchemaIssue` kind `NONE`, propose the minimal `SchemaIssue` extension that would surface the required information. Keep the proposal local (single field on an existing issue variant, or a new issue variant) — avoid broad refactors.

## Acceptance criteria

- [ ] Table row exists for every walk-schema branch identified in §Scope.
- [ ] `Corresponding OpFactoryCall class(es)` column is populated for every row. Any cell reading "(new call class)" flags a missing call-class type — Phase 1's inventory must either add that class or collapse the branch into an existing class.
- [ ] `Corresponding SchemaIssue kind(s)` column is populated. Cells reading `NONE` are listed in a short summary section with proposed issue extensions.
- [ ] Summary section at the bottom counts: total branches, branches absorbable-as-is, branches needing issue extensions, branches needing deeper investigation.
- [ ] The document includes a stability note: "this audit is consumed by Phase 1 and Phase 4; if either phase discovers the audit is wrong for a branch, the audit is updated before proceeding".
- [ ] Review by a reviewer familiar with `planner-reconciliation.ts` (Author of PR #349 or equivalent) before Phase 1 work begins.

## Non-goals

- No code changes. If the author spots a bug, open a separate issue.
- No predictions about Phase 4 strategy ordering — that's Phase 4's work.
- No completeness claim beyond walk-schema. `db init` has its own pipeline, unaffected by this project.

## Estimate

0.5 day of focused reading + table-filling for someone already familiar with the Postgres planner. 1–1.5 days for someone new to it.

## References

- Plan: `projects/postgres-class-flow-migrations/plan.md` §"Phase 1", §"Phase 4"
- Spec: `projects/postgres-class-flow-migrations/spec.md` §R2.10
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-reconciliation.ts`
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts`
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-recipes.ts`
- `packages/2-sql/1-core/sql-schema-ir/src/` (`SchemaIssue` definitions)
