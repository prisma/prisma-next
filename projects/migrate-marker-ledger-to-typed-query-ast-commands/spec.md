# Marker/ledger operations through the typed query AST

## Purpose

Make every contract-marker and migration-ledger operation reach the database the same way every other query does — constructed as a typed query-AST node and lowered through the family adapter — so that marker logic stops being hand-written raw SQL/driver calls scattered and silently diverging across the codebase.

## At a glance

Today the same logical operation — "advance the marker, append a ledger row" — is implemented four different ways:

- **Mongo** builds typed AST nodes but executes them with local `db.collection()` calls that bypass the adapter (two `as` casts in the bargain).
- **Postgres** hand-writes the SQL in two places (`buildMergeMarkerStatements`, `writeContractMarker`) and `driver.query()`s it directly.
- **SQLite** hand-writes its own third copy (`buildWriteMarkerStatements`) — which **overwrites** the invariants column where Postgres **merge-dedupes** it. Same operation, divergent behaviour.

The cause is structural: there is no typed way to express `CREATE TABLE` / the invariant-merge `UPDATE` in the SQL AST, so callers reach for strings, and strings drift. This project adds the missing AST nodes, routes all marker/ledger ops through the adapter's `lower()` → driver path, and consolidates each family's marker CRUD behind one control-adapter SPI. The marker is the first consumer of a DDL AST that the migration planner adopts afterward — collapsing the planner's own raw-string DDL builders.

```
before:  marker-ledger.ts ─▶ db.collection()           (Mongo, bypasses adapter)
         runner ───────────▶ driver.query(rawSql)      (Postgres/SQLite, 3 builders)

after:   one SPI surface ─▶ adapter.lower(queryAstNode) ─▶ driver.execute()   (both families)
```

## Non-goals

- **No semantic marker-command alphabet.** This project does not introduce target-agnostic `ReadMarker` / `CasAdvanceMarker` / `AppendLedgerEntry` commands. Marker ops are expressed with the general-purpose DDL/DML query AST. The semantic layer is the SPI method (`updateMarker(...)`), not an AST node.
- **No change to marker/ledger storage shape or wire semantics.** Table layouts (`prisma_contract.marker`, `_prisma_marker`, `_prisma_migrations`), the CAS/advisory-lock concurrency strategies (ADR 190 / ADR 043), and the per-space marker model (ADR 212) are preserved. The one exception is the deliberate convergence of invariant-merge semantics (see DoD).
- **No move of marker-ledger into the driver layer.** The original ticket floated this; superseded by routing through `adapter.lower()` → driver, which keeps wire transport in the driver and construction in the adapter without a second pattern.
- **No general DDL-AST completeness.** Only the DDL constructs marker bootstrap and the migration planner actually need are added. A fully general `CREATE TABLE`/`ALTER`/`CREATE INDEX` AST covering every dialect feature is not a goal; the planner-adoption slice defines the needed surface.
- **The contract-free builder is not a re-implementation of the contract-bound `sql()` builder.** It does not infer codecs, resolve tables/columns against a contract, propagate `storageHash`-branded types, or apply mutation defaults. It is a minimal node-constructor for contexts that have no contract. The two builders coexist; the contract-bound one stays the user-facing query surface.
- **No runtime query-path changes.** User-facing lanes, codecs, and runtime execution are untouched.

## Place in the larger world

- **Adapters & Targets** ([subsystem 5](../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md)) — the control-adapter SPI (`<Family>ControlAdapter`) is the seam this project consolidates onto. `SqlControlAdapter` grows write methods to match `MongoControlAdapter`'s existing surface.
- **Migration System** ([subsystem 7](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)) — the runner's marker advance + ledger append (per family) become AST-expressed and SPI-routed; the planner's raw-string DDL builders adopt the new DDL AST in the final phase.
- **SQL query AST** (`@prisma-next/sql-relational-core/ast`) — extended with DDL nodes (`CREATE SCHEMA` / `CREATE TABLE`) only. Existing `SelectAst`/`InsertAst`(+`InsertOnConflict`)/`UpdateAst` already cover the DML, including the marker upsert. DDL nodes are **first-class members of `AnyQueryAst`** (operator decision — runtime DDL is anticipated as a valid capability, so DDL is not confined to a migration-plane-only sibling union; the renderer renders DDL like any kind, no runtime throw; only the user-facing authoring surface is deferred). The invariant-merge is not an AST concern — it's a domain operation on the adapter SPI (see Open Question 1).
- **Contract-free query builder** (new, both families) — a thin, schema-less construction surface that emits the query/command AST + DDL nodes from string identifiers and bound params, with no codec inference and no contract-derived type propagation. Needed because the existing builders (`sql()`/`Root` for SQL) are contract-bound and control-plane / migration contexts have no contract; hand-building frozen AST nodes by object literal is as cumbersome as the raw strings this project removes. **SQL:** born with marker bootstrap as first consumer; the migration planner is its second. **Mongo:** a parallel contract-free surface over the existing command/filter AST (`CreateCollectionCommand`, `MongoFieldFilter`, …), scoped to where it pays — migration ops and marker ops — since those are the sites hand-constructing frozen classes today.
- **Mongo raw-command AST** (`@prisma-next/mongo-query-ast`) — already carries the nodes marker-ledger needs; the work is routing them through `adapter.lower()` rather than local execution.
- **ADRs that constrain the shape:** 021 (marker storage), 190 (Mongo CAS), 198 (runner decoupled via visitor SPIs), 204 (domain actions vs composable primitives), 212 (contract spaces). A new ADR is expected for the DDL AST + control-adapter marker-write SPI; ADR 198/204 may be amended.

## Cross-cutting requirements

- **No side-channel to the driver for marker/ledger ops.** After each slice, no marker/ledger operation in scope reaches the driver except through `adapter.lower()` → `driver.execute()`/`driver.query()`. (Mongo: no `db.collection()` in `marker-ledger.ts`; SQL: no `driver.query(rawMarkerSql)` outside adapter lowering.)
- **One marker-ops home per family.** Each family's marker/ledger reads, writes, parsing, and existence-probe are defined once, behind the control-adapter SPI. Duplicate read paths and duplicate parsers are removed, not merely wrapped.
- **Symmetric SPI shape.** `SqlControlAdapter` and `MongoControlAdapter` expose the same marker-ops surface (read + init + advance + ledger-append).
- **Determinism + golden parity preserved.** Lowered marker SQL/pipelines are byte-stable; existing golden/fixture tests stay green (`pnpm fixtures:check`), and control-adapter `lower()` stays byte-equivalent to runtime `lower()` for the same AST.
- **Green main between slices.** Every slice merges independently with CI green; no slice depends on a sibling merging concurrently.

## Transitional-shape constraints

- **Mongo and SQL marker paths may be migrated independently.** Completing Mongo (routing existing nodes through the adapter) does not require the SQL AST extension, and vice versa — the two family slices keep CI green on their own.
- **The DDL AST ships with its first consumer.** DDL nodes are introduced in the slice that uses them for marker bootstrap (so they are never merged as an unused, unvalidated surface). The migration planner adopts them only in a later slice.
- **No marker behaviour change mid-stream except the intended invariant-merge convergence.** Any slice that changes observable marker behaviour (the SQLite invariant overwrite→merge fix) states it explicitly in its PR and is gated on operator confirmation.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md) — repo-wide gates, docs/migration, Linear close-out, manual-QA roll-up, ADR audit).
- [ ] All in-scope marker/ledger operations for **both** families execute via `adapter.lower()` → driver; zero local `db.collection()` calls in `marker-ledger.ts` and zero `driver.query(rawMarkerSql)` outside adapter lowering.
- [ ] Each family's marker CRUD lives behind **one** control-adapter SPI surface; the three SQL read paths, the two `parseContractMarkerRow` copies, and the three SQL write builders (`buildMergeMarkerStatements`, `writeContractMarker`, `buildWriteMarkerStatements`) are collapsed (removed or unified), not duplicated.
- [ ] `SqlControlAdapter` exposes marker-write methods symmetric with `MongoControlAdapter`.
- [ ] A contract-free construction builder exists **per family** (SQL + Mongo) and is the construction path for in-scope marker/ledger/DDL nodes — no in-scope operation hand-builds AST/command nodes by object literal/constructor or concatenates raw SQL.
- [ ] The two `as` casts in Mongo `marker-ledger.ts` are eliminated (no new bare casts introduced; `pnpm` cast ratchet not regressed).
- [ ] Invariant-merge semantics converge on accumulate-dedupe across Postgres **and** SQLite (operator-confirmed); SQLite no longer overwrites the invariants column, and a test pins the merge behaviour for both dialects.
- [ ] The migration planner's DDL builders emit through the new DDL AST (the planner-adoption phase), or the residual is explicitly deferred with a tracked follow-up.
- [ ] An ADR records the DDL-AST + marker-write-SPI design; affected subsystem docs (Adapters & Targets, Migration System) updated.

## Open Questions

1. **Invariant-merge realization** — **Resolved: a domain operation on the adapter, not an AST node.** "Advance the marker, accumulating invariants" is domain policy, owned once per family by the `updateMarker` SPI method — consistent with this project's non-goal of keeping marker semantics out of the AST. The AST stays general-purpose: no marker-semantic node and no array-union expression node. SQL computes the unioned set in the adapter (the runner already reads the current marker; the advance runs under the migration txn + advisory lock, so there's no race) and emits a plain parameterized `UPDATE`. Mongo keeps its server-side `$setUnion` pipeline because its CAS path has no external lock. Residual: the narrow SQL realization choice (compute-in-adapter vs emit dialect SQL) — a per-adapter lowering detail, working position compute-in-adapter.
2. **Postgres-merge vs SQLite-overwrite divergence** — **Resolved (operator-confirmed): converge on accumulate-dedupe.** SQLite's wholesale overwrite is a latent bug; both dialects merge-dedupe invariants, with the policy owned by `SqlControlAdapter.updateMarker`. The slice that lands this states the observable SQLite behaviour change in its PR.
3. **Upsert via `INSERT … ON CONFLICT`** — collapse the insert/update branching? Working position: yes where capability-supported (both Postgres and SQLite).
4. **Codec-free `LowererContext`** — does routing control-plane statements through `lower()` need a stub/contract-free context? Working position: stub context suffices (`contract` is already `unknown`); confirm the renderer has no codec dependency for these statements.
5. **"Single SPI" altitude** — per-family consolidation vs a shared marker-ops interface hoisted to `framework-components`. Working position: per-family; hoist only if clean.
6. **Contract-free builder altitude + surface (per family)** — where each builder lives (SQL: a module in `relational-core` beside the AST vs a dedicated builder package; Mongo: alongside the command/filter AST in `mongo-query-ast`) and how much of the AST it covers in the first pass. SQL: marker needs `INSERT`/`UPDATE`/`SELECT` + `CREATE SCHEMA`/`CREATE TABLE`, planner needs the rest of the DDL surface. Mongo: scoped to migration-op + marker-op construction (collection/index commands + filter exprs). Working position: start each beside its AST covering exactly the marker/migration needs, widen as the planner / migration-op slices consume them; settle at slice-planning time.

## References

- Linear ticket: TML-2253 (originally Mongo-only; expanded to cross-family + DDL-AST foundation by operator decision). Slices: TML-2753 (SQL), TML-2754 (planner DDL).
- Linear Project: [Marker/ledger via typed query AST](https://linear.app/prisma-company/project/markerledger-via-typed-query-ast-dc62ab25d151).
- Design-discussion record: [`./design-notes.md`](./design-notes.md)
- ADRs: 021, 043, 190, 198, 204, 212; 188 / 191 / 195 (migration operation model + planner IR).
