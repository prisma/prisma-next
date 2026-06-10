# DDL in the SQL query AST (marker/ledger as first consumer)

## Purpose

Expand the SQL query AST to represent DDL (`CREATE TABLE`, `CREATE SCHEMA`, …) alongside the DML it already represents, as a **target-contributed** surface the adapter lowers — so that any database operation, including control-plane marker/ledger work and migration-planner DDL, is constructed as a typed AST node and reaches the wire through one path instead of hand-written, silently-diverging raw SQL.

## At a glance

The SQL query AST today represents DML (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) but **not DDL**. So every `CREATE TABLE` in the system is a raw string: the migration planner concatenates its own (`statement-builders.ts`, the `*Call.toOp()` factories), and marker bootstrap concatenates a third copy. Because there's no node to express DDL with, callers reach for strings — and strings drift. The sharpest symptom: the same "advance the marker, accumulate invariants" operation merge-dedupes on Postgres and **overwrites** on SQLite.

This project closes the gap by expanding the query AST itself:

```
before:  runner ──────────▶ driver.query("CREATE TABLE …")     (raw string, planner)
         marker bootstrap ▶ driver.query("CREATE TABLE …")     (raw string, 2nd copy)
         *Call.toOp() ────▶ { sql: "CREATE TABLE …" }          (raw string, 3rd path)

after:   target builds CreateTable AST node  ─lower(ast)─▶ adapter renders dialect SQL ─▶ driver
         (one construction path; one lowering path; target owns shape, adapter owns SQL)
```

The DDL surface is **target-contributed**, mirroring the migration-op IR's three-layer pattern (framework interface → family base → target concrete): Postgres ships `CreateTable` + `CreateSchema`; SQLite ships `CreateTable` only. The **target** defines the node's shape (table, columns as opaque native-type strings, literal/function defaults); the **adapter** owns lowering it to dialect SQL via a visitor (replacing the renderer's closed `switch`). This is what keeps adapters interchangeable on a target.

Marker/ledger operations are the **first consumer** (proving the surface against a real workload and killing the marker divergence); the migration planner's DDL is the **second** (the "simplify migrations" payoff).

## Non-goals

- **Not a generic-core DDL surface.** DDL nodes are contributed by the targets that have them. No closed `ColumnType` enum, no `now`/`empty-collection` default vocabulary, and no `CreateSchema` core node that no-ops on SQLite. (This is precisely the shape PR #661 took and that we are replacing.)
- **Not a reuse of the migration `*Call` IR as the DDL AST.** The migration-plan IR and the query AST are distinct ASTs with distinct facets. The planner is a *consumer* that adopts the query-AST DDL for rendering; it is not folded into it, nor vice versa.
- **Not a semantic marker-command alphabet.** No `ReadMarker`/`CasAdvanceMarker`/`AppendLedgerEntry` nodes. Marker semantics live at the SPI method (`updateMarker(...)`), expressed via general DDL/DML.
- **Not general DDL completeness.** Only the DDL constructs marker bootstrap and the migration planner actually need are added (`CREATE TABLE`/`CREATE SCHEMA` first; the planner-adoption slice scopes the rest — `ALTER`, `CREATE INDEX`, constraints, enums). A full dialect-complete DDL grammar is out of scope.
- **Not typed precheck/postcheck verification queries — deferred to a following slice.** The idempotency-probe SELECTs in `*Call.toOp()` (SQLite `SELECT COUNT(*) … FROM sqlite_master …`, Postgres `SELECT to_regclass(…) IS NULL`) stay raw SQL through the in-flight slices. They are the same "express, don't concatenate" violation and *will* become typed query-AST nodes, but converting them is carved out as an explicit follow-up slice (`typed-migration-verification-queries`): it first needs the contract-free builder to grow aggregate (`count`) and comparison/boolean projection — the AST already has `AggregateExpr.count`, but `CfSelectQuery.select(...)` is column-only today. Operator-decided on the #768 review; tracked in the plan. **This is a deferral, not a defense of the raw SQL — pointing at "every op already does it this way" is not a reason to keep it.**
- **No change to marker/ledger storage shape or wire semantics.** Table layouts (`prisma_contract.marker`/`.ledger`, `_prisma_marker`/`_prisma_ledger`, `_prisma_migrations`), the CAS/advisory-lock strategies (ADR 190/043), and the per-space marker model (ADR 212) are preserved. The one deliberate exception is the invariant-merge convergence (see DoD).
- **No user-facing runtime DDL authoring surface.** DDL becomes a valid, lowerable query-AST kind, but giving application authors a builder to emit it is deferred. (Modelling DDL as valid now avoids foreclosing it later.)
- **No runtime query-path changes.** User-facing lanes, codecs, and runtime DML execution are untouched.
- **Not a complete control-plane stack-lifecycle refactor.** This project routes marker/ledger/DDL operations through `adapter.lower()`, and PR #751 moved the **planner** onto the right ownership shape (`createPlanner` takes the orchestrator-built control adapter; `family.adapter` is gone). But the SQL family still retains a live adapter for its *other* methods, and `PostgresMigration` still builds its own — so a control operation can still hold more than one adapter instance, rather than the orchestrator constructing one and threading it everywhere the way `createExecutionStack` does in the runtime plane. Finishing that (runner bootstrap + `PostgresMigration` + dropping `getControlAdapter`/`lowerAst` from the family) is tracked separately as **TML-2856** (detailed in the plan's parallel-group-B follow-ups).

## Place in the larger world

- **SQL query AST** (`@prisma-next/sql-relational-core/ast`) — the surface this project expands. DML stays core/target-uniform; DDL becomes target-contributed via the three-layer polymorphic IR pattern. The renderer's closed `switch (ast.kind)` becomes a target-DDL visitor.
- **Adapters & Targets** ([subsystem 5](../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md)) — the **target** package contributes the concrete DDL node classes (shape); the **adapter** package owns lowering them (behaviour). `SqlControlAdapter` grows the marker-write surface symmetric with `MongoControlAdapter`.
- **Migration System** ([subsystem 7](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)) — the `*Call` factories (`toOp()`) and `statement-builders.ts` stop concatenating SQL and build query-AST DDL lowered through the adapter (planner-adoption slice).
- **Mongo raw-command AST** (`@prisma-next/mongo-query-ast`) — already carries the DDL-equivalent commands (`CreateCollectionCommand`, `CreateIndexCommand`); the Mongo work is routing marker ops through `adapter.lower()` and adding a contract-free construction surface, not expanding the command set.
- **Patterns/ADRs that constrain the shape:** [three-layer polymorphic IR](../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md), [frozen-class AST + visitor](../../docs/architecture%20docs/patterns/frozen-class-ast.md), [adapter SPI](../../docs/architecture%20docs/patterns/adapter-spi.md); ADRs 021, 043, 190, 195, 198, 204, 212. A new ADR is expected for "DDL as a target-contributed query-AST kind + the adapter DDL-lowering seam."

## Cross-cutting requirements

- **DDL nodes are target-contributed, lowered by the adapter.** No DDL node defines its own SQL string; the adapter renders it. No target is forced to stub a DDL kind it doesn't have. After the foundational slice, adding a DDL kind to a target is a target+adapter change, not a core change.
- **No side-channel to the driver for marker/ledger ops.** After each slice, no in-scope marker/ledger operation reaches the driver except through `adapter.lower()` → driver. (Mongo: no `db.collection()` in `marker-ledger.ts`; SQL: no `driver.query(rawMarkerSql)` outside adapter lowering.)
- **One marker-ops home per family.** Each family's marker/ledger reads, writes, parsing, and existence-probe are defined once, behind the control-adapter SPI. Duplicate read paths and parsers are removed, not wrapped.
- **Symmetric SPI shape.** `SqlControlAdapter` and `MongoControlAdapter` expose the same marker-ops surface (read + init + advance + ledger-append).
- **Determinism + golden parity preserved.** Lowered SQL/pipelines are byte-stable; existing golden/fixture tests stay green (`pnpm fixtures:check`); control-adapter `lower()` stays byte-equivalent to runtime `lower()` for the same AST.
- **Green main between slices.** Every slice merges independently with CI green; no slice depends on a sibling merging concurrently.

## Transitional-shape constraints

- **The DDL surface ships with its first consumer.** The foundational slice introduces the target-contributed DDL surface *with marker bootstrap as its consumer* — it is never merged as an unused, unvalidated surface. The migration planner adopts it only in a later slice.
- **Mongo and SQL marker paths migrate independently.** The Mongo slice (routing existing nodes through the adapter) shares no code with the SQL DDL work; each keeps CI green on its own.
- **No marker behaviour change mid-stream except the intended invariant-merge convergence.** The slice that lands the SQLite overwrite→merge fix states it explicitly in its PR and is gated on operator confirmation (already given).
- **The renderer-dispatch change is internal.** Converting the closed `switch` to visitor dispatch must keep every existing DML lowering byte-identical; golden fixtures are the guard.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md) — repo-wide gates, docs/migration, Linear close-out, manual-QA roll-up, ADR audit).
- [ ] The SQL query AST represents `CREATE TABLE` (+ Postgres `CREATE SCHEMA`) as **target-contributed** nodes; the adapter lowers them via visitor dispatch (no closed `switch` over DDL kinds in the renderer); no generic-core `ColumnType` enum or `CreateSchema` core node remains.
- [ ] All in-scope marker/ledger operations for **both** families execute via `adapter.lower()` → driver; zero `db.collection()` in `marker-ledger.ts` and zero `driver.query(rawMarkerSql)` outside adapter lowering.
- [ ] Each family's marker CRUD lives behind **one** control-adapter SPI; the duplicate SQL read paths, the two `parseContractMarkerRow` copies, and the three raw-SQL write builders are collapsed (removed/unified), not wrapped.
- [ ] `SqlControlAdapter` exposes marker-write methods symmetric with `MongoControlAdapter`.
- [ ] A contract-free construction surface exists **per family** (SQL + Mongo) and is the construction path for in-scope marker/ledger/DDL nodes — no in-scope operation hand-builds nodes by object literal or concatenates raw SQL.
- [ ] The two `as` casts in Mongo `marker-ledger.ts` are eliminated (cast ratchet not regressed).
- [ ] Invariant-merge converges on accumulate-dedupe across Postgres **and** SQLite (operator-confirmed); a test pins the merge for both dialects.
- [ ] The migration planner adopts the typed AST across **all three targets**, or the residual is explicitly deferred with tracked follow-up slices: the **SQL** planner (Postgres + SQLite) builds query-AST DDL lowered through the adapter, **and the Mongo migration planner** builds the contract-free Mongo command surface (`Create*Command` nodes) lowered through `MongoControlAdapter.lower()` — symmetric to the SQL adoption. Planner-adoption is not SQL-only; the Mongo migration planner still constructs its commands via the migration `*Call` path and must move onto the same adapter-lowering path the marker/ledger slice established.
- [ ] An ADR records "DDL as a target-contributed query-AST kind + adapter DDL-lowering seam"; affected subsystem docs (Adapters & Targets, Migration System) updated.

## Open Questions

1. **DDL visitor / dispatch API.** How the adapter dispatches over target-contributed DDL nodes (DDL visitor double-dispatch vs widened `lower()` input vs extensible kind→renderer table). Working position: frozen-class + DDL visitor mirroring `ExprVisitor`, adapter owns the implementation. **Resolved by the foundational slice's first dispatch (in-slice spike) before the rest of the DDL surface is committed.**
2. **Migration adoption: reuse vs extract.** Whether the `*Call` factories build query-AST DDL directly or via a thin shared helper. Working position: build directly via contract-free constructors; extract only if duplication bites. Settled at the planner-adoption slice.
3. **Contract-free builder altitude + surface (per family).** Where each builder lives and how much it covers first. Working position: beside its AST, covering exactly the marker/migration needs, widened as consumers demand.
4. **Upsert via `INSERT … ON CONFLICT`.** Collapse the insert/update branching. Working position: yes where capability-supported (both dialects).
5. **"Single SPI" altitude.** Per-family vs a hoisted shared interface. Working position: per-family; hoist only if clean.

## References

- Linear ticket: TML-2253 (originally Mongo-only; expanded to "DDL in the SQL query AST" + cross-family by operator decision).
- Linear Project: [Marker/ledger via typed query AST](https://linear.app/prisma-company/project/markerledger-via-typed-query-ast-dc62ab25d151).
- Design-discussion record: [`./design-notes.md`](./design-notes.md)
- Patterns: three-layer polymorphic IR; frozen-class AST + visitor; adapter SPI.
- ADRs: 021, 043, 190, 195, 198, 204, 212.
- Superseded approach: PR #661 (generic-core DDL in `AnyQueryAst`) — see "Non-goals" and design-notes "Alternatives considered".
