# Slice `planner-create-table-adopts-ddl-ast` — Dispatch plan

**Slice spec:** `./spec.md`

_Three dispatches: an in-slice spike that settles the table-level constraint node shape (mirroring how `ddl-in-query-ast` settled its visitor API), then the production constraint surface, then the planner call-site migration. The DDL nodes / constructors / adapter visitor already exist from slice 1 — this slice **extends** them and swaps the consumer from marker bootstrap to the migration planner, so it is tighter than slice 1's five dispatches. Each dispatch covers both Postgres and SQLite; a dispatch may fan out per-target at execution time if one review can't hold both._

### Dispatch 1: spike — settle the table-level constraint node shape

- **Outcome:** A thin vertical proof that a `CreateTable` node carrying **composite primary key, foreign key, and table-level unique** constraints lowers to correct dialect SQL through the existing adapter DDL visitor on **both** Postgres and SQLite, exercised on one representative user table (e.g. a join table with a composite PK + two FKs + a unique). The constraint API is decided and recorded in `design-notes.md`: the `constraints` representation (array of frozen `PrimaryKey`/`ForeignKey`/`Unique` sub-nodes vs alternative), whether FK on-delete/on-update actions are opaque strings or a small enum, and how SQLite's inline-only constraint forms are expressed. The decided skeleton is committed (may be partly throwaway).
- **Builds on:** The spec's chosen design; slice 1's `DdlNode` + `DdlColumn` + adapter DDL visitor (`ddl-renderer.ts`) as the surface being extended; `ExprVisitor`/frozen-class machinery as the pattern.
- **Hands to:** A settled constraint-node API the next dispatch builds the production surface against, recorded in `design-notes.md`.
- **Focus:** API decision only — one worked table, two targets, end-to-end (`createTable(...)` → `adapter.lower()` → string). Its job is to retire Open Question 1 before the production surface is built.

### Dispatch 2: land the table-level constraint surface (PG + SQLite)

- **Outcome:** The constraint surface from dispatch 1 is formalized for production: the family-base constraint shapes in `relational-core` (`ast/ddl-types.ts`), the target-concrete extension of `CreateTable` (`postgres`/`sqlite` `core/ddl/nodes.ts`), the contract-free `createTable(...)` constructor extended to accept `constraints` (target `contract-free/ddl.ts`; any shared helper in `relational-core/contract-free/column.ts`), and the Postgres + SQLite adapter DDL visitors rendering composite PK / FK / unique with correct identifier quoting and dialect forms (`6-adapters/{postgres,sqlite}/core/ddl-renderer.ts`). Tests pin the rendered SQL for each constraint kind on both dialects; `pnpm fixtures:check` confirms existing DML + the slice-1 `CreateTable`/`CreateSchema` lowering stays byte-identical.
- **Builds on:** Dispatch 1's settled constraint-node API + committed skeleton.
- **Hands to:** A production `CreateTable` node + constructor that expresses every constraint the migration planner's `CREATE TABLE` needs, lowered correctly by both adapters and pinned by tests — the surface dispatch 3 consumes.
- **Focus:** The constraint substrate (node + constructor + adapter rendering) only. No planner call sites change yet. Marker-bootstrap `CreateTable` (no table-level constraints) must remain byte-identical.

### Dispatch 3: migrate the planner's CreateTable / CreateSchema to the DDL AST

- **Outcome:** `CreateTableCall.toOp()` (Postgres + SQLite) and `CreateSchemaCall.toOp()` (Postgres) build their DDL node via the contract-free constructors and lower it through `adapter.lower()`, putting the resulting `.sql` on the `execute` step (step contract `sql: string` unchanged; `params` empty). The raw SQL-assembly — `buildCreateTableSql` (PG) / `renderCreateTableSql` (SQLite) — is deleted (native-type resolution retained as a node-construction input). `git grep` for those builders returns zero. Rendered `CREATE TABLE` (incl. composite PK / FK / unique) and `CREATE SCHEMA` are byte-stable vs current planner output, pinned by tests; migration fixtures/snapshots regenerated where they legitimately change; `pnpm fixtures:check` green.
- **Builds on:** Dispatch 2's production constraint surface.
- **Hands to:** A migration planner whose `CREATE TABLE`/`CREATE SCHEMA` shares the marker-bootstrap construction + lowering path — completing the slice-DoD. (The remaining planner op-families + Mongo planner-adoption are out-of-slice follow-ups per the spec.)
- **Focus:** Planner call sites only (`op-factory-call.ts` + `operations/tables.ts` + `planner-ddl-builders.ts`, both targets). Prechecks/postchecks (introspection `SELECT`s), the runner/preview/snapshot consumers, and the TS-render path are untouched per spec.

## Handoff completeness check

The three hand-offs add up to the slice-DoD: constraint node shape settled + recorded (D1); planner `toOp()` produces SQL via `adapter.lower()` with the raw builders grepping to zero (D3); rendered SQL byte-stable + fixtures green (D2 establishes the rendering, D3 proves planner parity). No slice-DoD item is unreachable from the sequence.
