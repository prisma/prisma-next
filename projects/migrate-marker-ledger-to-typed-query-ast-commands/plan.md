# DDL in the SQL query AST — Plan

**Spec:** `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`
**Linear Project:** [Marker/ledger via typed query AST](https://linear.app/prisma-company/project/markerledger-via-typed-query-ast-dc62ab25d151)

## At a glance

The project unfolded in three arcs.

**Arc A (foundation + first consumers — shipped).** A foundational slice expanded the SQL query AST with a target-contributed DDL surface (proving the adapter DDL-lowering seam first, in-slice) and shipped marker bootstrap as its first consumer. Two SQL slices then built on it in parallel (SQL marker ops; planner DDL adoption for `CreateTable`/`CreateSchema` on Postgres). A parallel Mongo slice closed the original ticket. Slices 1–4 all merged; the project's marker/ledger DoD clauses are met.

**Arc B (prove planner adoption works across all three targets — Phase 1, in flight).** The remaining DoD clause — "the migration planner adopts the typed AST across all three targets" — reads as *demonstrated*, not *exhaustive*. Slice 4 proved Postgres on `CREATE TABLE`/`CREATE SCHEMA`; SQLite and Mongo still need a small pioneer slice each, plus PG needs an ALTER TABLE pioneer (a fundamentally different shape — multi-action, mutates existing object). The first port per target is the spec-discovery one; the rest is mechanical. Three slices in this arc — 5 (SQLite `CreateTable`), 6 (Mongo `CreateCollection` + `CreateIndex`), 7 (PG `AddColumn` — the simplest ALTER TABLE op, settles that node's shape). All three are independent and can run in parallel; PG's substrate is the highest-risk so slice 7 is the highest-value pioneer.

**Arc C (complete the refactor — Phase 2, deferred).** Port the remaining ops in all three targets, plus the cross-cutting precheck/postcheck-via-AST demolition, plus the ADR + subsystem-doc updates. Don't decompose Phase 2 now — let it shape after Phase 1 lands, when the substrate is fully settled and slice boundaries become obvious. This mirrors the discipline that paid off in slice 4 (which itself split mid-flight when the spec hit reality).

## Composition

### Stack (deliver in order)

1. ✅ **Slice `ddl-in-query-ast`** (foundational) — Linear: TML-2761 — *merged*
   - **Outcome:** The SQL query AST represents `CREATE TABLE` (+ Postgres `CREATE SCHEMA`) as **target-contributed** frozen-class nodes (Postgres ships both; SQLite ships `CreateTable` only), with columns as opaque native-type strings and literal/function defaults. The adapter lowers them via a **DDL visitor** (the renderer's closed `switch` no longer enumerates DDL kinds); the target owns shape, the adapter owns SQL. A **contract-free constructor surface** builds these DDL nodes (and the existing DML nodes) without a contract. First consumer: **marker/ledger bootstrap DDL** is built and lowered through this path on both PG and SQLite (so the surface is never unused). No generic-core `ColumnType` enum or `CreateSchema` core node exists.
   - **Builds on:** None (external: existing `SelectAst`/`InsertAst`/`UpdateAst`, the `ExprVisitor`/frozen-class machinery, the three-layer migration-op IR as the pattern reference).
   - **Hands to:** (a) the **target-contributed DDL node surface** + (b) the **adapter DDL-lowering visitor seam** + (c) the **contract-free constructors** — the three stable surfaces slices 2 and 4 consume.
   - **Focus:** The AST expansion + lowering mechanism, validated end-to-end on `CreateTable`/`CreateSchema`. Marker bootstrap is the consumer that keeps it honest. The full marker CRUD (reads/writes/SPI consolidation, invariant-merge) is slice 2; planner DDL is slice 4. **First dispatch is the in-slice spike** that settles the visitor/dispatch API (spec Open Question 1) before the rest of the surface is built. **May fan out** at `drive-plan-slice` time (e.g. mechanism+nodes, then contract-free constructors + marker bootstrap) if one review can't hold it.

2. ✅ **Slice `sql-marker-ops-through-adapter`** — Linear: TML-2753 — *merged*
   - **Outcome:** SQL marker/ledger reads, writes, and ledger append are expressed as query-AST nodes and executed via the SQL control adapter's `lower()` → driver. `SqlControlAdapter` gains `initMarker`/`updateMarker`/`writeLedgerEntry` symmetric with Mongo. The duplicate SQL read paths, the two `parseContractMarkerRow` copies, and the three raw-SQL write builders collapse to one home. Invariant-merge converges on accumulate-dedupe across Postgres and SQLite (the `updateMarker` SPI owns the policy; SQLite stops overwriting). The marker upsert collapses to `INSERT … ON CONFLICT … DO UPDATE`.
   - **Builds on:** Slice 1's contract-free constructors and adapter-lowering path (bootstrap DDL already lands in slice 1; this slice adds the DML reads/writes and the SPI consolidation).
   - **Hands to:** A fully adapter-routed SQL marker path and the symmetric `SqlControlAdapter` write surface (the reference shape mirrored by Mongo).
   - **Focus:** SQL family marker/ledger DML + SPI consolidation + invariant-merge convergence. DDL surface already exists (slice 1). The PR states the observable SQLite invariant-merge change.

### Parallel group A (independent of the SQL stack)

- ✅ **Slice `mongo-marker-ledger-through-adapter`** — Linear: TML-2825 (originally TML-2253, the umbrella; now closed) — *merged*
  - **Outcome:** Mongo marker/ledger operations route through `adapter.lower()` → driver instead of the local `executeAggregate`/`executeInsertOne`/`executeFindOneAndUpdate` helpers in `marker-ledger.ts`. The two `as` casts and the `extractDb` coupling for marker ops are eliminated. A **contract-free Mongo construction surface** (factory helpers over the existing `CreateCollectionCommand`/`CreateIndexCommand`/filter nodes) replaces hand-built frozen command classes, with marker ops as first consumer (migration ops as second). Closes the original ticket scope.
  - **Builds on:** None (Mongo's raw-command AST nodes already exist; no dependency on the SQL DDL work).
  - **Hands to:** A fully adapter-routed Mongo marker path and the contract-free Mongo construction surface that Mongo migration ops adopt next.
  - **Focus:** Mongo family only. Reuse existing `RawAggregateCommand`/`RawInsertOneCommand`/`RawFindOneAndUpdateCommand`. Decide `RawFindOneCommand`-vs-aggregate for `readMarker` at slice-planning time. **May fan out** (contract-free builder + marker routing vs migration-op adoption) if one review can't hold both.

### Parallel group B (planner adoption — **decomposed into multiple slices**)

The planner-adoption work ("simplify migrations" payoff) is **not one slice**. Grounding (TML-2754 pre-spec) showed slice 1 (TML-2761) shipped DDL-AST nodes only for `CreateTable`/`CreateSchema`, while the planner emits ~21 Postgres + ~7 SQLite DDL ops — adopting the rest means adding a node + adapter-visitor case + planner migration per op-family. The project spec anticipated this ("the planner-adoption slice scopes the rest"). So group B fans into a first slice plus tracked follow-ups, all in this project.

- ✅ **Slice `planner-create-table-adopts-ddl-ast`** (first planner-adoption slice; PG only) — Linear: TML-2754 — *merged in #751*
  - **Outcome:** The planner's `CreateTableCall.toOp()` (PG + SQLite) and `CreateSchemaCall.toOp()` (PG) build the slice-1 DDL-AST nodes via the contract-free constructors and lower via `adapter.lower()`, replacing `buildCreateTableSql`/`renderCreateTableSql`. Extends the `CreateTable` node with a target-contributed table-level **constraint** surface (composite PK / FK / unique) that user tables need and marker bootstrap didn't. Spec: `slices/planner-create-table-adopts-ddl-ast/spec.md`.
  - **Builds on:** Slice 1's target-contributed DDL surface + adapter-lowering seam + contract-free constructors.
  - **Focus:** `CREATE TABLE`/`CREATE SCHEMA` only. Step contract `sql: string` unchanged (lower to `{sql,params}` inside `toOp()`); execute DDL steps only; TS-render path out. The table-constraint node shape is the load-bearing unknown, settled by dispatch 1 (in-slice spike), mirroring slice 1.

#### Phase 1 — prove planner adoption works across all three targets (next)

Project DoD line: *"the migration planner adopts the typed AST across **all three targets**, or the residual is explicitly deferred with tracked follow-up slices."* Read literally — *demonstrated*, not *exhaustive*. The first port per target exposes the holes in the substrate; subsequent ports are mechanical. Phase 1 ships the minimum per target needed to declare adoption proven for that target.

Slice 4 already proved Postgres on `CREATE TABLE` / `CREATE SCHEMA`. Phase 1 adds three slices: one to prove SQLite, one to prove Mongo, and one to prove the **ALTER TABLE** family on Postgres (a fundamentally different shape from `CREATE TABLE` — multi-action, mutates an existing object, highest-risk PG substrate decision left in the project).

All three are independent and can run in parallel.

- **Slice 5 — `sqlite-create-table-adoption`.** Linear: TML-2859.
  - **Outcome:** SQLite `CreateTableCall.toOp()` builds the slice-1 `CreateTable` DDL-AST node via the contract-free constructors and lowers it through `SqlControlAdapter.lower()`, replacing SQLite's `renderCreateTableSql`. Shared substrate (constraint node + `createTable(constraints)` constructor + SQLite adapter constraint-rendering) already landed in slice 4's D1/D2; this slice does the SQLite adapter byte-parity reconciliation + the planner-side migration. Mirror of the proven Postgres pattern.
  - **Builds on:** Slice 4 (substrate complete).
  - **Focus:** SQLite only. Smallest, lowest-risk, most-grounded slice in Phase 1.

- **Slice 6 — `mongo-planner-create-collection-and-index-adoption`.** Linear: _TBD (create at pickup)_.
  - **Outcome:** `MongoMigrationPlanner` routes `CreateCollection` and `CreateIndex` ops through `MongoControlAdapter.lower()` via the contract-free Mongo command surface that TML-2825 established. Two op kinds (not one) so that the second exercises the substrate against a different command shape and surfaces gaps a single-op slice would miss.
  - **Builds on:** Slice 3 (Mongo contract-free command surface + adapter lowering path).
  - **Focus:** Mongo only. Validates the `MongoMigrationPlanner`-side adoption — different machine from SQL (Mongo command nodes, not DDL nodes).

- **Slice 7 — `pg-add-column-pioneer`.** Linear: _TBD (create at pickup)_.
  - **Outcome:** Postgres `AddColumnCall.toOp()` builds a target-contributed `ALTER TABLE … ADD COLUMN …` DDL node via the contract-free constructors and lowers through `SqlControlAdapter.lower()`, replacing `buildAddColumnSql`. The **ALTER TABLE node shape** is the load-bearing decision (one polymorphic node with a discriminated subaction list, vs separate node kinds per subaction) — settled by dispatch 1 (in-slice spike), mirroring how slice 1 settled the visitor seam and slice 4 settled the constraint shape. This is the simplest ALTER TABLE op (single action, no constraint interaction), making it the cleanest pioneer.
  - **Builds on:** Slice 1 (visitor + IR + constructors) + slice 4 (the proven planner-adoption pattern).
  - **Focus:** PG `AddColumn` only. The remaining 6 column ops, the 4 constraint ALTERs, and the rest of PG's ALTER TABLE surface all reuse the shape this slice settles — they ship in Phase 2.

**Project DoD vs Phase 1.** After 5 + 6 + 7 land, all three targets have demonstrated planner adoption against the substrate kinds that matter (CREATE-shape on SQLite, command-shape on Mongo, ALTER-shape on PG). Read literally, that meets the DoD. We could declare the project done here. We won't — Will explicitly intends to complete the refactor (Phase 2 below) — but the choice is real if priorities shift.

#### Phase 2 — complete the refactor (decomposition deferred)

The remaining op-families across all three targets, plus cross-cutting precheck/postcheck-via-AST demolition, plus the ADR + subsystem-doc updates (project DoD line 71).

**Don't decompose Phase 2 now.** Slice boundaries become obvious only once Phase 1's substrate decisions are settled — the ALTER TABLE shape (slice 7) determines whether PG's remaining column ops + constraint ALTERs collapse into one mechanical slice or split into several; SQLite's adoption pattern (slice 5) and Mongo's (slice 6) determine the same for their respective tails. The discipline that paid off in slice 4 (which itself split mid-flight from one two-dialect dispatch into Postgres-first + SQLite-follow-up) applies here.

Concrete scope to be ported in Phase 2 (sized at pickup):
- PG: remaining column ops (`DropColumn`, `AlterColumnType`, `SetNotNull`, `DropNotNull`, `SetDefault`, `DropDefault`); constraint ALTERs (`AddPrimaryKey`, `AddUnique`, `AddForeignKey`, `DropConstraint`); indexes (`CreateIndex`, `DropIndex`); types/db (`CreateEnumType`, `AddEnumValues`, `DropEnumType`, `RenameType`, `CreateExtension`); `DropTable`.
- SQLite: column ops (`AddColumn`, `DropColumn`); indexes (`CreateIndex`, `DropIndex`); `DropTable`; `RecreateTable` (the table-rebuild pattern).
- Mongo: remaining `MongoMigrationPlanner` ops not covered in slice 6.
- Cross-cutting: precheck/postcheck `SELECT to_regclass(...)` introspection — currently hand-built raw SQL in every op's `toOp()` — moves to query AST + lower. One pass after all ops migrated.
- ADR ("DDL as a target-contributed query-AST kind + adapter DDL-lowering seam") + subsystem-doc updates (Adapters & Targets, Migration System).
- **Finish applying the execution-plane stack-construction pattern to the control plane (TML-2856).** The execution plane already has the right pattern: `createExecutionStack` builds the adapter and driver from their descriptors **once**, and the orchestrator holds those instances and threads them to whatever needs them. The control plane is being moved onto the same shape.

  **Done in PR #751 (the planner path).** `createPlanner` now takes the control adapter instance directly (across the framework SPI, the SQL descriptor SPI, and the Postgres/SQLite/Mongo impls); `family.adapter` is gone from `SqlControlFamilyInstance`. The orchestrators that hold the control stack build the adapter and thread it: the CLI control client builds it once per `dbInit`/`dbUpdate` (`buildControlAdapter()`, mirroring `createExecutionStack`) and threads it through the db-init/db-update options → `db-run` → the aggregate `PlannerInput` → `synthStrategy` → `createPlanner`; the `migration plan` / `migration new` commands build it from their local stack and pass it directly.

  **Remaining for TML-2856.** The SQL family still constructs its **own** adapter internally (the held `controlAdapter` / `getControlAdapter`) for its non-planner methods (`lowerAst`, `readMarker`/`readAllMarkers`/`readLedger`, `verify`, `initMarker`/`updateMarker`/`writeLedgerEntry`, `introspect`, `bootstrap*`), and `PostgresMigration`'s constructor builds **another** one (`stack.adapter.create(stack)`). So one control operation still ends up with more than one adapter instance. The finish:
  - Thread the single orchestrator-built adapter to the migration runner's marker bootstrap and to `PostgresMigration` (drop its own `stack.adapter.create`), the way the planner now receives it.
  - The SQL family stops retaining a live adapter. Its methods already take `driver` as an explicit input; the ones that also need the adapter should take it the same way — passed in by the caller — or move off the family entirely if they are plain adapter operations. Then `getControlAdapter`, the held `controlAdapter`, and the `lowerAst` / `bootstrap*` passthroughs all come off `SqlControlFamilyInstance`.
  - Net end state: one adapter instance per control operation, constructed by the orchestrator, threaded explicitly, owned by nobody downstream. The family goes back to being a stateless contributor rather than a holder of live target instances — the same division the runtime plane already has.

  The remainder is a control-plane-wide change (the SQL family interface, the Postgres/SQLite runner marker bootstrap, and `PostgresMigration`) and is out of scope for this project's slices; tracked as its own ticket.

**End-state cleanup (project DoD):** once every Postgres op is migrated onto its `*Call.toOp()` (the `*Call` IR nodes are the common interface), the free Op-builder modules under `packages/3-targets/3-targets/postgres/src/core/migrations/operations/` have no callers and **must be deleted** — and so must the parallel free builders elsewhere. Marked for demolition:
- `operations/tables.ts` — now down to just the unmigrated `dropTable`.
- `operations/dependencies.ts` — `createExtension` / `installExtension` (the schema-side dead code is already gone); deleted once `CreateExtensionCall` adopts `toOp()` (and `installExtension`, the hand-rolled extension-pack baseline, is reconciled).
- the other `operations/*.ts` builders (`enums.ts`, `indexes.ts`, `columns.ts`, `constraints.ts`, `raw.ts`) — deleted as their ops adopt `toOp()`.
No free string-gluing Op-builder should survive the planner-adoption phase.

**Also for demolition: raw SQL in `*Call.toOp()` precheck/postcheck.** The idempotency-probe introspection (`SELECT to_regclass(...) IS NULL`, etc.) is still hand-built raw SQL in every op's `toOp()`. It's deferred by the slice spec and is cross-cutting (every op), but it's the same "express, don't concatenate" violation — these are `SELECT`s and should be expressed via the query AST + lowered like the `execute` step. Follow-up across all ops.

## Dependencies (external)

- [ ] Existing SQL query AST (DML nodes, `ExprVisitor`, frozen-class machinery) — present; no blocker.
- [ ] Three-layer polymorphic IR pattern (reference: migration-op IR) — present; no blocker.
- [ ] Mongo raw-command AST nodes — present; no blocker.
- [x] Operator confirmation on the SQLite invariant overwrite→merge convergence — **confirmed** (accumulate-dedupe). Slice 2 states the observable change in its PR.
- [x] Linear issues for shipped slices 1–4 — TML-2761 / TML-2753 / TML-2825 / TML-2754.
- [ ] Linear issues for Phase 1 slices 5 / 6 / 7 — **to create at pickup**.

## Sequencing rationale

### Arc A (shipped)

- **Slice 1 is the shared foundation with two dependents.** Both slice 2 (SQL marker DML/SPI) and slice 4 (planner DDL) need the target-contributed DDL surface + adapter-lowering seam to exist. Slice 1 ships it *with marker bootstrap as consumer* so it's never an unused surface, then 2 and 4 can run in parallel after it.
- **Spike folded into slice 1, not split out.** The visitor/dispatch API is the load-bearing unknown that sank both prior attempts, but a spike yields knowledge, not a PR. Front-loading it as slice 1's first dispatch de-risks the slice without manufacturing a throwaway slice; its outcome lands in design-notes.
- **Mongo (group A) is parallel.** It shares no code with the SQL AST work and closes the literal ticket fastest. Sequencing it would only cost throughput.

### Arc B / Phase 1 (next)

- **Prove each target before completing each target.** The DoD reads as "demonstrated across all three targets," not "every op migrated." The first port per target exposes substrate holes that are cheap to discover at slice size and expensive to discover at refactor size. Phase 1 ships the minimum per target needed to declare that target proven; Phase 2 ports the rest, mechanically, once the substrate is fully settled. This trades one round of small slices now for a much more tractable Phase 2 later.
- **Three independent pioneers, parallelisable.** Slices 5 (SQLite), 6 (Mongo), 7 (PG ALTER TABLE) touch disjoint substrate and can land in any order. PG's ALTER TABLE pioneer is the highest-risk substrate decision left in the project — it should not lag.
- **No new spike slices.** Each Phase 1 slice front-loads its own substrate-shape decision into dispatch 1 (in-slice spike), mirroring slices 1 and 4. The cross-target substrate is now mature enough that spike-as-slice would manufacture overhead.

### Arc C / Phase 2 (deferred)

- **Decompose Phase 2 after Phase 1 lands.** Slice boundaries for the remaining ops only become obvious once Phase 1 has settled the per-target adoption shapes. Slice 4 itself split mid-flight from a two-dialect dispatch into Postgres-first + SQLite-follow-up; the same discipline applies here. Premature decomposition risks slicing along the wrong axis.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`
- [ ] Migrate long-lived docs into `docs/` (the DDL-as-query-AST-kind + adapter-DDL-seam ADR; subsystem-doc updates)
- [ ] Strip repo-wide references to `projects/migrate-marker-ledger-to-typed-query-ast-commands/**`
- [ ] Delete `projects/migrate-marker-ledger-to-typed-query-ast-commands/`
