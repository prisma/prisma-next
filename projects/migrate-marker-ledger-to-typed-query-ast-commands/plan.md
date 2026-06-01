# Marker/ledger operations through the typed query AST — Plan

**Spec:** `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`
**Linear Project:** [Marker/ledger via typed query AST](https://linear.app/prisma-company/project/markerledger-via-typed-query-ast-dc62ab25d151)

## At a glance

Three slices, a mixed shape. A two-slice SQL **stack** (Slice 1: SQL marker ops + foundational surfaces → Slice 2: planner adopts the DDL AST) runs alongside a **parallel** Mongo slice that shares no code with it. "Marker operations first" = the SQL Slice 1 **and** the Mongo slice; "simplify planner DDL second" = SQL Slice 2. Each family delivers a **contract-free construction builder** as a cross-cutting enabler, born with its marker-ops consumer (never as an unused surface). Slices 1 and the Mongo slice may each fan out at `drive-plan-slice` time if a single review can't hold them.

## Composition

### Stack (deliver in order)

1. **Slice `sql-marker-ops-through-adapter`** — Linear: TML-2753
   - **Outcome:** SQL marker/ledger reads, writes, and the ledger append are expressed as typed query-AST nodes and executed via the SQL control adapter's `lower()` → driver. `SqlControlAdapter` gains marker-write methods (`initMarker` / `updateMarker` / `writeLedgerEntry`) symmetric with Mongo. The three SQL read paths, the two `parseContractMarkerRow` copies, and the three raw-SQL write builders (`buildMergeMarkerStatements`, `writeContractMarker`, `buildWriteMarkerStatements`) collapse to one home. Invariant-merge semantics converge across Postgres and SQLite (per Open Question 2): the accumulate-dedupe policy lives in `SqlControlAdapter.updateMarker` as a domain operation — it computes the unioned invariant set and emits a plain parameterized `UPDATE` (the advance runs under the migration txn + advisory lock, so no race). Adds the only AST surface this requires: `CREATE SCHEMA` / `CREATE TABLE` DDL nodes. The merge is **not** an AST node (see Open Question 1). Also introduces the **contract-free query builder** — the ergonomic construction layer marker ops use to build these nodes without a contract (the existing `sql()` builder is contract-bound and unusable here). The builder is born with marker bootstrap as its first consumer, never as an unused surface.
   - **Builds on:** None (external: existing `SelectAst`/`InsertAst`/`UpdateAst` + `RawSqlExpr`).
   - **Hands to:** The **DDL AST nodes + their adapter lowering**, the **contract-free builder** (both stable surfaces Slice 2 consumes), and the symmetric `SqlControlAdapter` write surface.
   - **Focus:** SQL family only (Postgres + SQLite). DDL nodes are introduced *with* their marker-bootstrap consumer, never as an unused surface. Mongo handled by the parallel slice; planner DDL adoption deliberately deferred to Slice 3.

2. **Slice `planner-ddl-adopts-ast`** — Linear: TML-2754
   - **Outcome:** The migration planner's raw-string DDL builders emit through the DDL AST introduced in Slice 1, so planned DDL and marker-bootstrap DDL share one construction + lowering path. This is the "simplify migration operations" payoff. Concretely, two string-render sites collapse: the pure op factories under `operations/*.ts` (e.g. `createTable`'s `` `CREATE TABLE ${qualified} (…)` ``) and the `planner-ddl-builders.ts` helpers (`buildCreateTableSql`, `buildAddColumnSql`, `buildForeignKeySql`, index builders) — in **both** the Postgres and SQLite targets — stop concatenating SQL and instead construct a DDL AST node lowered via `adapter.lower()`.
   - **Builds on:** Slice 1's DDL AST nodes + lowering, and the contract-free builder (the planner builds its DDL through the same surface).
   - **Hands to:** A single DDL construction surface for both control-plane bootstrap and migration planning.
   - **Focus:** Migration planner DDL only. Two scoping decisions, settled at `drive-plan-slice` time:
     - **Keep the step contract `SqlMigrationPlanOperationStep.sql: string`** for the first pass — builders construct the AST and immediately lower to `{ sql, params }`, leaving the runner, the `operation-preview.ts` DDL-detection path, and snapshot fixtures untouched. Promoting steps to carry the AST node end-to-end (lowered in the runner) is a **separable follow-on**, not this slice.
     - **`execute` DDL steps only.** Prechecks/postchecks are introspection `SELECT`s (`to_regclass(…) IS NULL`, `information_schema` lookups) — a different surface; they stay hand-built strings for this pass.
     - The TS-migration render path (`op-factory-call.ts` → `renderTypeScript()`) emits factory *calls*, not SQL, and is **out of scope** — SQL only materializes when `toOp()` runs.
   - **May fan out** into multiple slices (e.g. Postgres-then-SQLite, or per DDL-op family) if a single review can't hold it — re-boundary then, not now.

### Parallel group A (independent of the SQL stack)

- **Slice `mongo-marker-ledger-through-adapter`** — Linear: TML-2253
  - **Outcome:** Mongo marker/ledger operations route through `adapter.lower()` → driver instead of the local `executeAggregate` / `executeInsertOne` / `executeFindOneAndUpdate` helpers in `marker-ledger.ts`. The two `as` casts are eliminated; `extractDb` coupling for marker ops is removed. This closes the original ticket scope. Also introduces a **contract-free Mongo construction surface** (factory helpers over the existing command/filter AST — `CreateCollectionCommand`, `CreateIndexCommand`, `MongoFieldFilter`, …), so marker ops (and, as second consumer, migration ops) stop hand-building frozen command classes. Born with marker ops as first consumer.
  - **Builds on:** None (Mongo's raw-command AST nodes already exist; the builder is helpers over them).
  - **Hands to:** A fully adapter-routed Mongo marker path (reference shape the SQL slice mirrors for symmetry) **and** the contract-free Mongo construction surface that Mongo migration ops adopt next.
  - **Focus:** Mongo family only. No new semantic commands; reuse existing `RawAggregateCommand` / `RawInsertOneCommand` / `RawFindOneAndUpdateCommand`. Decide `RawFindOneCommand`-vs-aggregate for `readMarker`, and the builder's first-pass surface, at slice-planning time. **May fan out**: the contract-free builder + marker routing can split from the migration-op adoption if a single review can't hold both.

## Dependencies (external)

- [ ] Existing SQL query AST (`SelectAst`/`InsertAst`+`InsertOnConflict`/`UpdateAst`/`RawSqlExpr`) — present; no blocker.
- [ ] Mongo raw-command AST nodes — present; no blocker.
- [x] Operator confirmation on the SQLite invariant overwrite→merge convergence (spec Open Question 2) — **confirmed**: converge on accumulate-dedupe. Slice 1 states the observable SQLite change in its PR.

## Sequencing rationale

- **Mongo (group A) is parallel, not stacked.** It shares no code with the SQL AST work and closes the literal ticket fastest. Sequencing it would only cost throughput.
- **Slice 1 before Slice 3 is a real dependency**, not pacing: the planner can't adopt a DDL AST that doesn't exist yet. The DDL AST is born in Slice 1 (with marker as first consumer) precisely so Slice 3 has a validated surface to adopt — this is the operator's "marker operations first, planner DDL second" sequencing.
- **Why the DDL nodes and the contract-free builder live in Slice 1, not their own slices:** either as a standalone slice would fail slice-INVEST *Valuable* (it would be "preparation for a later slice" with no consumer). Shipping both foundational surfaces with their marker-bootstrap consumer keeps every slice independently valuable. If Slice 1 grows too large to review as one unit, it re-boundaries at `drive-plan-slice` time (e.g. builder+nodes, then marker SPI) — but each resulting slice still ships with a consumer.
- **Slice 2 may re-boundary into multiple slices** at pickup time; the project plan stays at three to respect the 1–4 sweet spot, and notes the fan-out rather than pre-committing to thin horizontal slices.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`
- [ ] Migrate long-lived docs into `docs/` (DDL-AST + marker-SPI ADR; subsystem-doc updates)
- [ ] Strip repo-wide references to `projects/migrate-marker-ledger-to-typed-query-ast-commands/**`
- [ ] Delete `projects/migrate-marker-ledger-to-typed-query-ast-commands/`
