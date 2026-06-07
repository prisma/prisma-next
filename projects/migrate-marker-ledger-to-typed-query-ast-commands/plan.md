# DDL in the SQL query AST — Plan

**Spec:** `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`
**Linear Project:** [Marker/ledger via typed query AST](https://linear.app/prisma-company/project/markerledger-via-typed-query-ast-dc62ab25d151)

## At a glance

Four slices, a mixed shape. A **foundational** slice expands the SQL query AST with a target-contributed DDL surface (proving the adapter DDL-lowering seam first, in-slice) and ships marker bootstrap as its first consumer. Two SQL slices then build on it in **parallel** (SQL marker ops; planner DDL adoption). A fourth **parallel** Mongo slice shares no code with the SQL work and closes the original ticket. The load-bearing unknown — the adapter↔target-DDL visitor seam — is front-loaded into the foundational slice's first dispatch rather than split into a throwaway spike slice (a spike produces no mergeable PR).

## Composition

### Stack (deliver in order)

1. **Slice `ddl-in-query-ast`** (foundational) — Linear: _TBD (create at pickup)_
   - **Outcome:** The SQL query AST represents `CREATE TABLE` (+ Postgres `CREATE SCHEMA`) as **target-contributed** frozen-class nodes (Postgres ships both; SQLite ships `CreateTable` only), with columns as opaque native-type strings and literal/function defaults. The adapter lowers them via a **DDL visitor** (the renderer's closed `switch` no longer enumerates DDL kinds); the target owns shape, the adapter owns SQL. A **contract-free constructor surface** builds these DDL nodes (and the existing DML nodes) without a contract. First consumer: **marker/ledger bootstrap DDL** is built and lowered through this path on both PG and SQLite (so the surface is never unused). No generic-core `ColumnType` enum or `CreateSchema` core node exists.
   - **Builds on:** None (external: existing `SelectAst`/`InsertAst`/`UpdateAst`, the `ExprVisitor`/frozen-class machinery, the three-layer migration-op IR as the pattern reference).
   - **Hands to:** (a) the **target-contributed DDL node surface** + (b) the **adapter DDL-lowering visitor seam** + (c) the **contract-free constructors** — the three stable surfaces slices 2 and 4 consume.
   - **Focus:** The AST expansion + lowering mechanism, validated end-to-end on `CreateTable`/`CreateSchema`. Marker bootstrap is the consumer that keeps it honest. The full marker CRUD (reads/writes/SPI consolidation, invariant-merge) is slice 2; planner DDL is slice 4. **First dispatch is the in-slice spike** that settles the visitor/dispatch API (spec Open Question 1) before the rest of the surface is built. **May fan out** at `drive-plan-slice` time (e.g. mechanism+nodes, then contract-free constructors + marker bootstrap) if one review can't hold it.

2. **Slice `sql-marker-ops-through-adapter`** — Linear: TML-2753
   - **Outcome:** SQL marker/ledger reads, writes, and ledger append are expressed as query-AST nodes and executed via the SQL control adapter's `lower()` → driver. `SqlControlAdapter` gains `initMarker`/`updateMarker`/`writeLedgerEntry` symmetric with Mongo. The duplicate SQL read paths, the two `parseContractMarkerRow` copies, and the three raw-SQL write builders collapse to one home. Invariant-merge converges on accumulate-dedupe across Postgres and SQLite (the `updateMarker` SPI owns the policy; SQLite stops overwriting). The marker upsert collapses to `INSERT … ON CONFLICT … DO UPDATE`.
   - **Builds on:** Slice 1's contract-free constructors and adapter-lowering path (bootstrap DDL already lands in slice 1; this slice adds the DML reads/writes and the SPI consolidation).
   - **Hands to:** A fully adapter-routed SQL marker path and the symmetric `SqlControlAdapter` write surface (the reference shape mirrored by Mongo).
   - **Focus:** SQL family marker/ledger DML + SPI consolidation + invariant-merge convergence. DDL surface already exists (slice 1). The PR states the observable SQLite invariant-merge change.

### Parallel group A (independent of the SQL stack)

- **Slice `mongo-marker-ledger-through-adapter`** — Linear: TML-2253
  - **Outcome:** Mongo marker/ledger operations route through `adapter.lower()` → driver instead of the local `executeAggregate`/`executeInsertOne`/`executeFindOneAndUpdate` helpers in `marker-ledger.ts`. The two `as` casts and the `extractDb` coupling for marker ops are eliminated. A **contract-free Mongo construction surface** (factory helpers over the existing `CreateCollectionCommand`/`CreateIndexCommand`/filter nodes) replaces hand-built frozen command classes, with marker ops as first consumer (migration ops as second). Closes the original ticket scope.
  - **Builds on:** None (Mongo's raw-command AST nodes already exist; no dependency on the SQL DDL work).
  - **Hands to:** A fully adapter-routed Mongo marker path and the contract-free Mongo construction surface that Mongo migration ops adopt next.
  - **Focus:** Mongo family only. Reuse existing `RawAggregateCommand`/`RawInsertOneCommand`/`RawFindOneAndUpdateCommand`. Decide `RawFindOneCommand`-vs-aggregate for `readMarker` at slice-planning time. **May fan out** (contract-free builder + marker routing vs migration-op adoption) if one review can't hold both.

### Parallel group B (planner adoption — **decomposed into multiple slices**)

The planner-adoption work ("simplify migrations" payoff) is **not one slice**. Grounding (TML-2754 pre-spec) showed slice 1 (TML-2761) shipped DDL-AST nodes only for `CreateTable`/`CreateSchema`, while the planner emits ~21 Postgres + ~7 SQLite DDL ops — adopting the rest means adding a node + adapter-visitor case + planner migration per op-family. The project spec anticipated this ("the planner-adoption slice scopes the rest"). So group B fans into a first slice plus tracked follow-ups, all in this project.

- **Slice `planner-create-table-adopts-ddl-ast`** (first) — Linear: TML-2754
  - **Outcome:** The planner's `CreateTableCall.toOp()` (PG + SQLite) and `CreateSchemaCall.toOp()` (PG) build the slice-1 DDL-AST nodes via the contract-free constructors and lower via `adapter.lower()`, replacing `buildCreateTableSql`/`renderCreateTableSql`. Extends the `CreateTable` node with a target-contributed table-level **constraint** surface (composite PK / FK / unique) that user tables need and marker bootstrap didn't. Spec: `slices/planner-create-table-adopts-ddl-ast/spec.md`.
  - **Builds on:** Slice 1's target-contributed DDL surface + adapter-lowering seam + contract-free constructors.
  - **Focus:** `CREATE TABLE`/`CREATE SCHEMA` only. Step contract `sql: string` unchanged (lower to `{sql,params}` inside `toOp()`); execute DDL steps only; TS-render path out. The table-constraint node shape is the load-bearing unknown, settled by dispatch 1 (in-slice spike), mirroring slice 1.

- **Follow-up slices (tracked; tickets created at pickup):**
  - **SQLite `CreateTable` planner adoption** — split out of `planner-create-table-adopts-ddl-ast` post-D3-review (that dispatch proved hard as a two-dialect unit; Postgres lands first per the sanctioned Postgres-then-SQLite fan-out). The shared substrate (constraint node + `createTable(constraints)` constructor + SQLite adapter constraint-rendering) already exists from D1/D2; this slice does the SQLite adapter byte-parity reconciliation + migrates SQLite `CreateTableCall.toOp()` onto the lower path, mirroring the proven Postgres pattern.
  - Postgres column ops (`AddColumn`/`DropColumn`/`AlterColumnType`/`SetNotNull`/`DropNotNull`/`SetDefault`/`DropDefault`); constraint ALTERs (`AddPrimaryKey`/`AddUnique`/`AddForeignKey`/`DropConstraint`); indexes (`CreateIndex`/`DropIndex`); Postgres types/db (`CreateEnumType`/`AddEnumValues`/`DropEnumType`/`RenameType`/`CreateExtension`); `DropTable`; SQLite `RecreateTable`.
- **Mongo planner adoption (tracked follow-up slice).** Planner adoption spans **all three targets, not just SQL.** The Mongo migration planner's ops (`CreateCollection`/`CreateIndex`/…) must construct the contract-free Mongo command surface and route through `MongoControlAdapter.lower()` → driver, symmetric to the SQL planner adoption. (See project spec DoD.)

## Dependencies (external)

- [ ] Existing SQL query AST (DML nodes, `ExprVisitor`, frozen-class machinery) — present; no blocker.
- [ ] Three-layer polymorphic IR pattern (reference: migration-op IR) — present; no blocker.
- [ ] Mongo raw-command AST nodes — present; no blocker.
- [x] Operator confirmation on the SQLite invariant overwrite→merge convergence — **confirmed** (accumulate-dedupe). Slice 2 states the observable change in its PR.
- [ ] Linear issue for slice 1 (`ddl-in-query-ast`) — **to create** (not a sub-issue; standalone under the project, related to TML-2753/2754).

## Sequencing rationale

- **Slice 1 is the shared foundation with two dependents.** Both slice 2 (SQL marker DML/SPI) and slice 4 (planner DDL) need the target-contributed DDL surface + adapter-lowering seam to exist. Slice 1 ships it *with marker bootstrap as consumer* so it's never an unused surface, then 2 and 4 can run in parallel after it.
- **Spike folded into slice 1, not split out.** The visitor/dispatch API is the load-bearing unknown that sank both prior attempts, but a spike yields knowledge, not a PR. Front-loading it as slice 1's first dispatch de-risks the slice without manufacturing a throwaway slice; its outcome lands in design-notes.
- **Mongo (group A) is parallel.** It shares no code with the SQL AST work and closes the literal ticket fastest. Sequencing it would only cost throughput.
- **Four slices, two of them parallelisable after slice 1.** This sits at the top of the 1–4 sweet spot. If slice 1 grows too large to review as one unit, it re-boundaries at `drive-plan-slice` time (mechanism+nodes, then constructors+bootstrap) — each resulting slice still ships with a consumer.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`
- [ ] Migrate long-lived docs into `docs/` (the DDL-as-query-AST-kind + adapter-DDL-seam ADR; subsystem-doc updates)
- [ ] Strip repo-wide references to `projects/migrate-marker-ledger-to-typed-query-ast-commands/**`
- [ ] Delete `projects/migrate-marker-ledger-to-typed-query-ast-commands/`
