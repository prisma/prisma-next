# Design notes: migrate-marker-ledger-to-typed-query-ast-commands

> Synthesized design document. Read this if you want to understand **what the
> design is**, **what principles it serves**, and **what alternatives were
> considered and rejected**. Not a chronological log — it captures the settled
> design, standing independently of the discussion that produced it.
>
> Owned by the Orchestrator. Cross-linked from `spec.md`; never block execution
> on a design-notes update.

## Principles this design serves

- **One way to reach the wire.** Every database interaction — including control-plane marker/ledger operations — goes through the family adapter's `lower()` → driver path. No operation reaches the driver by a side channel.
- **Express, don't concatenate.** Operations are constructed as typed query-AST nodes, not assembled as raw SQL/command strings at the call site. The reason marker logic scattered is that there was no node to express it with; the fix is to add the node, not to police the strings.
- **Construction must be ergonomic, or callers route around it.** Hand-building frozen AST class instances (object-literal `SelectAst`/`InsertAst`/DDL nodes) is as cumbersome as raw strings — if it's painful, the next caller reaches for `driver.query(rawSql)` again and the divergence recurs. The existing `sql()` / `Root` builder is **contract-bound** (it resolves tables/columns from `context.contract.storage`, infers codecs, propagates `storageHash` types), and control-plane / migration contexts have **no contract**. So the AST extension is incomplete without a **contract-free query builder**: a thin, schema-less surface that emits the same `AnyQueryAst` + DDL nodes from string table/column names and bound params, with no codec inference and no type propagation. This is what makes "express, don't concatenate" actually cheaper than concatenating.
- **One home per concern.** Each family's marker/ledger CRUD lives behind a single control-adapter SPI surface. Reads, writes, parsing, and existence-probing are defined once per family, not re-derived per call site.
- **Deterministic lowering, target-specific rendering.** A target-agnostic AST node renders to the target's native wire form in the adapter. Dialect idioms (the Postgres invariant-merge, SQLite's table naming) live in lowering, not in the node.
- **Symmetry across families.** SQL and Mongo expose the same marker-ops surface shape. Asymmetry today is an accident of incremental growth, not a designed boundary.

## The model

### What "an AST for marker operations" means here

It does **not** mean a new semantic command alphabet (`ReadMarker` / `CasAdvanceMarker` / `AppendLedgerEntry`). Marker operations are ordinary DDL/DML — `CREATE SCHEMA`, `CREATE TABLE`, `INSERT`, `UPDATE`, `SELECT` — and should be expressed with the **general-purpose query AST**, extended to cover the constructs it doesn't yet support. The marker is simply the **first consumer** of that extension.

### Current state (verified)

The same logical operation is implemented inconsistently across families and, within SQL, across three independent sites:

| Concern | MongoDB | Postgres | SQLite |
|---|---|---|---|
| Marker write transport | Local `db.collection().insertOne()/findOneAndUpdate()` in `marker-ledger.ts` (bypasses adapter) | `driver.query(rawSql)` from runner / control-instance | `driver.query(rawSql)` from runner |
| Write SQL/command construction | Typed raw-command AST nodes (`RawInsertOneCommand`, `RawFindOneAndUpdateCommand`) — already exist, but executed locally | `buildMergeMarkerStatements` (raw strings, `statement-builders.ts`) + `writeContractMarker` (raw strings, `sql-marker.ts`, sign path) | `buildWriteMarkerStatements` (raw strings, `statement-builders.ts`) |
| Marker read | one path (`MongoControlAdapter.readMarker`) | `SqlControlAdapter.readMarker` + runtime `markerReader.readMarker` | + SQLite runner's **private** `readMarker` (third path) |
| Row parsing | one parser | `parseContractMarkerRow` in `5-runtime/marker.ts` **and** `9-family/verify.ts` (two copies) | (shares the SQL copies) |
| Marker-write SPI | full (`readMarker`, `readAllMarkers`, `initMarker`, `updateMarker`, `writeLedgerEntry`) | **read-only** (`readMarker`, `readAllMarkers`) — no write methods | (no SPI; private runner methods) |
| `invariants` storage + merge | `text`-array via `$setUnion` pipeline (accumulate + dedupe) | `text[]` via `array(select distinct unnest(invariants ‖ $8) order by 1)` (accumulate + dedupe + sort) | **JSON string, overwritten wholesale** on update (does NOT accumulate) |
| Marker table identity | `_prisma_migrations` collection | `prisma_contract.marker` / `.ledger` | `_prisma_marker` / `_prisma_ledger` |

Two consequences fall out of this table:

1. The Mongo side is **half-done**: it already constructs typed AST nodes but executes them with local `db.collection()` calls (`executeAggregate` / `executeInsertOne` / `executeFindOneAndUpdate`, with two `as` casts). Completing it means routing those nodes through `adapter.lower()` → driver — the same transport user queries use.
2. The SQL side has **no write SPI and no AST usage** for marker ops, and the hand-written builders have **silently diverged**: Postgres merge-dedupes invariants; SQLite overwrites them. Same operation, different behaviour — a latent correctness bug. Nothing forced agreement because the policy had no single home; giving each family one `updateMarker` SPI method that owns the accumulate-dedupe decision removes the divergence by construction.

### What the SQL query AST already supports (verified)

`AnyQueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst | RawSqlExpr` (`packages/2-sql/4-lanes/relational-core/src/ast/types.ts:1876`). `InsertAst` carries an `InsertOnConflict` node. So marker reads, the ledger insert, and the marker upsert are **already expressible** — the upsert collapses to a single `INSERT … ON CONFLICT (space) DO UPDATE SET …`, eliminating the insert/update branching at three call sites.

### What's genuinely missing (the AST extension)

1. **DDL nodes** — `CREATE SCHEMA` and `CREATE TABLE`. No AST form exists anywhere (the migration planner builds its own DDL as raw strings too — `buildCreateTableSql`, `buildAddColumnSql` in `postgres/.../planner-ddl-builders.ts`). This is the foundational addition — and the *only* AST gap for marker ops. The DML (reads, ledger insert, marker upsert) is already expressible.

   **DDL is a first-class member of the SQL query AST, not a migration-plane-only sibling (operator decision).** `create-schema` / `create-table` join `AnyQueryAst` and are lowerable anywhere a query is — the shared renderer renders them like any other kind, with **no runtime throw**. Rationale: applications may legitimately issue DDL at runtime (multi-tenant provisioning, dynamic/temp tables), no less likely than a raw SQL statement containing DDL; excluding DDL from the AST now would make it much harder to add later. We model DDL as a valid kind now and defer only the user-facing *authoring* surface (the marker bootstrap is the present consumer; runtime DDL stays anticipated, not foreclosed). The rejected alternative — a sibling `AnyDdlAst` union, or extending `AnyQueryAst` with a runtime throw on DDL — would either structurally exclude runtime DDL or make an illegal-but-representable state requiring a throw. This is expected to be recorded as an ADR at close-out (DDL as a first-class query-AST kind).

The invariant-merge is **not** an AST gap: it is a domain operation owned by the adapter's `updateMarker` SPI method, which computes the unioned set and emits a plain parameterized `UPDATE` (the advance runs under the migration txn + advisory lock, so there's no read-then-write race). See Open Questions.

3. **A contract-free query builder** — the construction ergonomics layer. The DDL nodes and the existing DML nodes are only usable in practice if there's a cheap way to build them without a contract. The existing `sql()`/`Root` builder can't serve here (it's contract-bound). So a schema-less builder that emits `SelectAst`/`InsertAst`(+`ON CONFLICT`)/`UpdateAst`/`DeleteAst` and the new DDL nodes — from plain string identifiers and bound params — is part of the foundational surface. Altitude (a module in `relational-core` next to the AST, vs a dedicated contract-free builder package) is a slice-planning decision.

   **Mongo gets the same treatment** (operator decision). Mongo's migration factories (`migration-factories.ts`) and marker ops hand-construct frozen command/filter classes (`CreateCollectionCommand`, `CreateIndexCommand`, `MongoAndExpr`, `MongoExistsExpr.exists(...)`, `MongoFieldFilter`, …) — the same cumbersome construction the SQL builder removes, and migration ops are its sharpest consumer. A contract-free Mongo construction surface (factory helpers over the existing command/filter AST) is feasible because those nodes already exist and `MongoQueryPlan` already has a `.build()` seam. Scope is "where it pays" — migration ops + marker ops first — not a blanket re-build of every Mongo node.

Because the migration planner's DDL is *also* raw strings, the DDL AST is a shared foundation: marker bootstrap is its first consumer; the planner adopting it is the "simplify migration operations" payoff. That adoption is **deliberately sequenced after** marker ops land.

### Target architecture

```
control-plane caller (db init/sign/verify, migration runner)
        │  calls one SPI surface (symmetric across families)
        ▼
<Family>ControlAdapter  ──lower(ast, ctx)──▶  Driver.execute(lowered)  ──▶  DB
   (reads + writes:                              (existing transport;
    init/update/ledger,                           no new side channel)
    expressed as query-AST nodes)
```

The control adapter is the single home for each family's marker ops; it expresses them as query-AST nodes and lowers them through the same transport as runtime queries.

## Alternatives considered

- **Target-agnostic semantic marker-operation command AST** (`ReadMarker` / `CasAdvanceMarker` / `AppendLedgerEntry` lowered per adapter). **Rejected because:** the operator's intent is to express marker ops with the *general* DDL/DML AST, not a bespoke alphabet; it collides with ADR 204 (domain actions vs composable primitives) by smuggling a domain action into a command vocabulary; and Mongo deliberately chose *raw* wire commands over semantic ones. The semantic layer stays at the SPI method level (`updateMarker(...)`), not in the AST.
- **Narrow AST extension (marker as sole DDL consumer), planner DDL untouched.** **Rejected because:** it leaves the migration planner's raw-string DDL in place, so the "simplify migration operations" goal never lands and the DDL AST has exactly one consumer. The operator chose to adopt the larger scope and sequence the planner adoption after marker ops.
- **Move marker-ledger from the adapter layer to the driver layer** (the original ticket's open suggestion). **Rejected because:** routing through `adapter.lower()` → driver already puts wire concerns in the driver while keeping construction in the adapter, consistent with the established ControlAdapter pattern (ADR 151/152/198/204). A bespoke driver-layer marker module would be a second pattern for the same job.

## Open questions

- **Invariant-merge realization** — **Resolved: a domain operation on the adapter, not an AST node.** Advancing the marker with accumulating invariants (union + dedupe) is domain policy; it lives in each family's `updateMarker` SPI method, which owns the policy once and composes plain query-AST nodes to realize it. The AST stays general-purpose — no marker-semantic node *and* no special array-union expression node. (An earlier draft proposed a typed merge-expression node; that re-imported marker semantics into the AST, which is the semantic-command-AST this project explicitly rejects — see Alternatives.) Each adapter realizes the merge the way its concurrency model allows: **SQL** computes the unioned set in the adapter (the runner already reads `existingMarker` before the upsert, and the advance runs under the migration transaction + advisory lock, so there is no read-then-write race) and emits a plain parameterized `UPDATE`; **Mongo** keeps its server-side `$setUnion` pipeline because its CAS path has no external lock and must merge atomically on the server. The only residual is the narrow SQL realization choice (compute-in-adapter vs emit dialect SQL) — a per-adapter lowering detail, not an AST-shape question. Working position: compute-in-adapter, plain `UPDATE`.
- **Postgres-merge vs SQLite-overwrite invariant divergence** — fix to converge, or preserve? **Working position:** converge on accumulate-dedupe (Postgres is correct per the per-space invariant model); treat SQLite overwrite as a latent bug fixed by this work. Confirm before changing SQLite behaviour, since it's observable.
- **Upsert via `INSERT … ON CONFLICT`** — collapse the insert-or-update branching into one statement? **Working position:** yes where supported (both Postgres and SQLite have UPSERT), capability-gated.
- **Codec-free lowering context** — `lower(ast, ctx: LowererContext<unknown>)` is contract-typed `unknown`, so a stub context should suffice; confirm the renderer has a codec-independent path for these simple statements. **Working position:** stub context; no codec dependency for marker DDL/DML.
- **"Single SPI" scope** — per-family consolidation, or a shared cross-family marker-ops interface hoisted to `framework-components`? **Working position:** per-family control adapter owns all marker ops; hoist a shared shape only if it falls out cleanly.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- Linear ticket: TML-2253
- ADRs: 021 (Contract Marker Storage), 190 (CAS concurrency, Mongo), 198 (Runner decoupled via visitor SPIs), 204 (Domain actions vs composable primitives), 212 (Contract spaces), 188/191/195 (migration operation model + planner IR).
- Subsystems: [`docs/architecture docs/subsystems/5. Adapters & Targets.md`](../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md), [`docs/architecture docs/subsystems/7. Migration System.md`](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
