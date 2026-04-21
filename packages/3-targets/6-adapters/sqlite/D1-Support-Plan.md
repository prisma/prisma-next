# D1 Support — Implementation Plan

## Summary

Cloudflare D1 is a managed, SQLite-compatible database. Prisma Next should support it as a first-class deployment target so that applications authored against the SQLite target can run on Cloudflare Workers, with migrations driven from the CLI via D1's REST API. This document captures the plan, the trade-offs chosen, and the alternatives considered and rejected.

The core insight is that D1 speaks the same SQL dialect as SQLite but offers a fundamentally different execution model: no interactive transactions over either REST or the Workers binding. Migrations and runtime queries therefore share the SQLite adapter's SQL generation unchanged but diverge in how they execute, lock, and guarantee atomicity.

## Dependencies

- **PR #341** (`feat/sqlite-migrations`) must land first. It adds the SQLite migration planner, runner, introspection, PSL type mappings, and control tables. D1 reuses the planner, DDL builders, introspection, and PSL mappings; it replaces the runner.
- No external blockers on the SQLite target's runtime plane, which is already complete.

## Architecture Overview

Prisma Next separates `family → target → adapter → driver`. For D1 we add a single new driver package that binds to the existing `targetId: 'sqlite'` — no new target, no new adapter. This is a first for the repo (every target has had a single driver until now), but the framework's capability aggregation already supports it: `mergeCapabilities` in the control API enrichment pipeline aggregates capability declarations from adapters, drivers, targets, and extensions indiscriminately, so a driver can contribute its own capability flags without any framework change.

### What we reuse from the SQLite target unchanged

- **Adapter SQL generation** (`packages/3-targets/6-adapters/sqlite/src/core/adapter.ts`). Pure SQL rendering, no runtime coupling, no Node-specific imports. D1 understands this SQL as-is.
- **Codecs and column types** (`codecs.ts`, `column-types.ts`).
- **PSL type mappings** (`control-mutation-defaults.ts` from PR #341) — maps PSL scalars to SQLite native types; identical for D1.
- **Schema introspection** (`control-adapter.ts` from PR #341). Uses `SELECT FROM sqlite_master` plus read-only PRAGMAs (`table_info`, `foreign_key_list`, `index_list`, `index_info`), all of which D1 honors as regular queries.
- **Migration planner + DDL builders** (`planner.ts`, `planner-ddl-builders.ts`, `statement-builders.ts` from PR #341). The planner takes a contract and a schema IR and produces operations; it never touches the driver. DDL builders emit pure SQL strings.
- **Default parsing** (`parseSqliteDefault`), **native type normalization** (`normalizeSqliteNativeType`).
- **Control tables** `_prisma_marker` and `_prisma_ledger` — schema is SQLite-compatible and works unchanged on D1.

### What's new for D1

- A driver package (`@prisma-next/driver-sqlite-d1` or similar, in `packages/3-targets/7-drivers/sqlite-d1/`) exporting both a runtime driver and a control driver.
- A D1-specific migration runner. PR #341's runner cannot execute on D1 because it relies on interactive reads inside a `BEGIN EXCLUSIVE` transaction. The new runner reshapes the lifecycle around D1's import API, which accepts a self-contained SQL file and runs it atomically server-side.
- New capability declarations on the driver side to gate runtime operations that require interactive transactions.
- An assertion-based gate in the ORM that checks this capability at mutation entry points and throws a typed error for unsupported operations on D1.

## Migration Strategy

### Control driver: two REST paths

Migrations are driven from the Node-based CLI, which has no Workers runtime. The control driver uses two distinct Cloudflare D1 REST API paths, chosen per operation:

**`POST /accounts/:id/d1/database/:db/query`** — single-statement queries with request/response semantics. Used for schema introspection, marker reads, and all non-migration control-plane work. Simple, one round-trip per query.

**`POST /accounts/:id/d1/database/:db/import`** — asynchronous SQL-file ingestion. The CLI uploads the migration SQL to a pre-signed R2 URL (returned by the D1 `init` call), tells D1 to ingest, and polls for completion. This path executes statements sequentially server-side with a different transaction-framing model than `/query`: in particular, `PRAGMA foreign_keys = OFF` takes effect and applies to subsequent statements in the same import. The import pipeline is atomic-on-failure — per wrangler's own comment, *"if the execution fails to complete, your DB will return to its original state and you can safely retry"* — which preserves marker/ledger integrity.

Wrangler exposes the same split without naming it. `wrangler d1 migrations apply` uses `/query` and silently loses data on recreate-table with CASCADE children. `wrangler d1 execute --file=migration.sql` uses the import API and does not. Prisma Next uses the import API from the start for migration application and avoids the trap.

Credentials: the same API token works for both endpoints. R2 upload uses the pre-signed URL D1 returns, so no separate R2 credentials are needed.

**Trade-off accepted**: the import API is multi-round-trip (init → upload → ingest → poll). Migrations are latency-tolerant, so this is fine. Non-migration reads stay on `/query` because they don't need the import path's semantics and latency would matter more per-call.

### Runner shape: pre-import reads → import submission → done

PR #341's runner wraps the entire migration in `BEGIN EXCLUSIVE … COMMIT` with interactive reads inside. D1's import API is not interactive — you submit a SQL file and poll for outcome. The lifecycle restructures into:

1. **Pre-import reads** (via `/query`): introspect current schema, read the marker, compute which operations to skip based on their postchecks, verify origin-hash compatibility. Non-atomic reads. If any check aborts the migration, no state has changed.
2. **Import submission**: construct a single SQL file containing, in order —
   - `PRAGMA foreign_keys = OFF;`
   - Control-table creation (idempotent): `CREATE TABLE IF NOT EXISTS _prisma_marker` / `_prisma_ledger`
   - Each non-skipped operation's DDL, including recreate-table operations for tables with incoming CASCADE FKs
   - `PRAGMA foreign_keys = ON;` followed by an inline assertion over `pragma_foreign_key_check` that raises on violations
   - Marker-version CAS: conditional `UPDATE _prisma_marker SET … WHERE storage_hash = :expected_origin`, guarded by a `changes()`-based assertion that raises on zero-row updates
   - Marker upsert via `INSERT … ON CONFLICT DO UPDATE`
   - Ledger insert
  
   Submit to `/import`. The import pipeline runs the file atomically end-to-end: any failed statement triggers a full rollback to the pre-import state, so DDL and marker/ledger updates are atomic with each other.

3. **Post-import**: nothing. Schema verification is dropped (see below).

### Foreign-key handling via the import API

The import API's execution model restores the standard SQLite recreate-table dance: `PRAGMA foreign_keys = OFF` at the top of the file, do the rebuild, `PRAGMA foreign_keys = ON` with an integrity check. Child rows with `ON DELETE CASCADE` survive parent rebuilds because FK enforcement is genuinely disabled during the DDL.

This works only because the import API executes statements in a framing where `PRAGMA foreign_keys` takes effect. Empirical testing confirmed that the same PRAGMA inside `/query` (or inside a `db.batch()` on miniflare) is a no-op, cascade fires, and children are silently wiped. The first version of this plan mistakenly proposed `PRAGMA defer_foreign_keys = ON` as a workaround; testing showed `defer_foreign_keys` does not prevent cascade actions under any D1 endpoint. It is not used.

Consequence: the planner's full range of operations, including recreate-table of tables with incoming FK constraints of any kind (including CASCADE), is supported from day one.

### Concurrency: marker-version CAS instead of `BEGIN EXCLUSIVE`

The native SQLite runner uses `BEGIN EXCLUSIVE` to prevent two concurrent migrators from racing. D1 offers no equivalent lock primitive — REST is stateless, binding batches are short-lived, and the import API has no session affinity.

The D1 runner replaces exclusive locking with optimistic concurrency on the marker row. The pre-import phase reads the marker's current storage-hash. The imported SQL file includes a conditional `UPDATE _prisma_marker SET … WHERE storage_hash = :expected_origin` — if the hash has moved since we read it, zero rows are affected and a follow-up assertion `SELECT CASE WHEN changes() = 0 THEN RAISE(ABORT, 'marker CAS failure') END` aborts the import. The import pipeline's atomic rollback then reverts everything. Two concurrent migrators cannot both succeed; the loser sees a CAS failure and can re-plan against the new state.

This is weaker than exclusive locking in one respect: two migrators might both enter the pre-import phase, both do full introspection, and one of them does throwaway work before the CAS fails. In practice that's fine — migrations are human-triggered from a CLI, and "both migrators independently try to apply the same plan" is a rare operational event, not a hot contention path.

### Schema verification: dropped

PR #341's runner verifies the post-DDL schema against the contract inside the transaction: introspect the live database, compare it against the contract, fail the migration if they diverge. This defends against planner bugs — a missing `NOT NULL`, a wrong type affinity, an index on the wrong column set — before marking the migration successful.

On D1, verification cannot happen atomically with the DDL — the import API is fire-and-poll, not interactive, so re-introspecting the live schema and comparing against the contract can only happen after the import has committed. **D1 migrations do not perform schema verification.** A migration is considered successful if the imported SQL file executes without errors and the foreign-key integrity assertion passes. Planner bugs may leak to runtime and surface there instead of at migration time.

This is the same model wrangler has used for D1 migrations since launch, and matches how most SQLite migration tooling operates. The loss relative to PR #341 is real but localized: the planner is already well-covered by unit tests, and the ORM's type-level contract checks catch many schema mismatches before a query even runs. Both alternatives for restoring verification (post-commit with a status column; pre-batch simulation) were considered and rejected — see the alternatives section.

## Runtime Strategy

### Runtime driver: Workers binding

Application code runs inside Cloudflare Workers with a bound D1 database at `env.DB`. The runtime driver accepts a `D1Binding` analogous to the existing `PostgresBinding` — variants for the binding directly (`{ kind: 'binding', db: D1Database }`) and potentially a REST variant for local development or serverless platforms other than Workers. The binding variant is the primary supported surface.

The driver implements `RuntimeDriverInstance & SqlDriver<D1Binding>`. Query execution maps to `db.prepare(sql).bind(...params).all() | .run() | .raw()`. Streaming uses D1's result-set iteration. The driver does *not* implement `transaction()` — see capability gating below.

### Capability gating: `interactiveTransaction`

Today the ORM at `packages/3-extensions/sql-orm-client/src/mutation-executor.ts` checks `typeof runtime.transaction === 'function'` and falls through silently if the method is absent, running nested writes without atomicity. That's a latent bug regardless of D1 — any driver that ships without a transaction method loses atomicity invisibly.

We introduce a new capability `interactiveTransaction: boolean` declared on the driver side:

- Native SQLite driver: `interactiveTransaction: true`
- Postgres driver: `interactiveTransaction: true`
- D1 driver: `interactiveTransaction: false`

The ORM's `withMutationScope` is replaced with an explicit assertion following the existing `assertReturningCapability` pattern (`packages/3-extensions/sql-orm-client/src/collection-contract.ts`, lines 325–331). The assertion fires at the same mutation entry points that today call `assertReturningCapability` — create, createAll, upsert, update, updateAll, delete, deleteAll — but only when the operation produces nested work (relations with writes) or the user calls the explicit `.transaction()` API. Flat single-statement operations (`find*`, flat `create`/`update`/`delete`, `updateMany`, `deleteMany`, `upsert`, homogeneous `createMany`) don't need the capability and remain available on D1.

The silent-fallthrough branch in `mutation-executor.ts` is removed: reaching that code with nested work and no transaction is a bug, not a runtime condition to tolerate.

### User-facing `.transaction()` API

The runtime client's `.transaction()` method is omitted from the D1 client's type signature (not merely throwing at call time). The ExecutionContext pattern already shapes clients per target; this becomes one more capability-driven type difference. A user migrating code from Postgres or native SQLite to D1 gets a compile-time error at every `.transaction()` call site, which is preferable to a runtime surprise.

### Operation compatibility matrix

| Operation | D1 | Reason |
|---|---|---|
| `findUnique`, `findFirst`, `findMany` | supported | single SELECT |
| Flat `create`, `update`, `delete` | supported | single statement |
| `updateMany`, `deleteMany` | supported | single statement |
| `upsert` | supported | single `INSERT … ON CONFLICT` |
| `createMany` (homogeneous column set) | supported | single statement |
| `createMany` (heterogeneous column sets) | supported via `atomicBatch` | multiple statements, atomic, non-interactive — fits D1 `batch()` |
| `create`/`update` with nested relations | **rejected** | requires reading the parent PK mid-transaction to feed child FKs |
| User `runtime.transaction()` | **rejected** | requires interactive transactions |

### `atomicBatch` capability (secondary)

Heterogeneous `createMany` today falls through the same transaction-wrapping path as nested writes, because it emits multiple INSERT statements grouped by column signature. On D1 this is unnecessary — D1's `batch()` can execute those grouped INSERTs atomically without an interactive transaction. A second capability `atomicBatch: boolean` lets the ORM recognize this and route heterogeneous `createMany` through `SqlDriver.batch([stmts])` (a new driver method) instead of the transaction-wrapping path.

This is additive, not blocking — without `atomicBatch`, heterogeneous `createMany` would be rejected alongside nested writes, which is over-restrictive. With `atomicBatch`, the common case of bulk-inserting rows with optional columns stays supported.

## New Capabilities Summary

| Capability | Level | SQLite (native) | Postgres | D1 |
|---|---|---|---|---|
| `interactiveTransaction` | driver | true | true | false |
| `atomicBatch` | driver | true (via `BEGIN IMMEDIATE`) | true (via `BEGIN`) | true (native) |

Both live under the `sql` capability namespace. Existing capabilities (`returning`, `jsonAgg`, `lateral`, `enums`, `defaultInInsert`, `orderBy`, `limit`) stay on the adapter — they're dialect concerns. `interactiveTransaction` and `atomicBatch` are runtime concerns, hence driver-level.

This pushes against a comment at `packages/1-framework/1-core/framework-components/src/framework-components.ts` lines 16–19 that says capabilities "must be declared on the adapter descriptor." The enrichment pipeline already permits driver-level capabilities; the comment reflects original intent, not current behavior. The comment should be updated as part of this work to reflect that capabilities are declared at the layer that owns the concern (SQL dialect → adapter; runtime behavior → driver).

## Alternatives Considered and Rejected

### Separate adapter package for D1

Rejected. D1 speaks identical SQLite dialect — there is no SQL-generation difference. Duplicating the adapter would create two packages that must stay in sync with no semantic reason for them to diverge. The runtime-execution difference is a driver concern, not a dialect concern, and capabilities already compose from drivers.

### New target descriptor for D1 (`targetId: 'd1'`)

Rejected for the same reason. The target identifies the SQL dialect; introducing `d1` as a separate target would require users to re-author their contracts or plumb cross-target equivalence. D1 and SQLite share a dialect; they differ in deployment target, which is what drivers exist to express.

### Keep `BEGIN EXCLUSIVE` in the runner by using a D1 Worker transaction broker

Rejected. The idea was to front D1 with a small Worker endpoint that holds a Durable Object session and serializes interactive transactions on the binding side. That Worker would expose the existing `ControlDriverInstance` surface to the CLI, and the existing PR #341 runner would execute unchanged.

Problems: D1's binding also does not provide interactive transactions — `db.batch()` is the only atomic primitive, and individual `prepare().run()` calls each commit independently. A Worker broker cannot conjure interactive transactions where D1 does not offer them. The only way to provide session-scoped write coordination would be a Durable Object that keeps the full migration state in memory, which is an independent distributed-systems project and well out of scope.

### Refactor the SQLite runner to abstract the transaction strategy

Rejected after reading the runner code. The interactive reads in `applyPlan` — postcheck-before-execute idempotency, precheck verification, post-execute postcheck, mid-transaction introspection — are baked into the control flow, not confined to the `BEGIN`/`COMMIT` envelope. A strategy pattern that abstracts only the transaction boundary leaves the interactive reads unresolved. Factoring them out too would essentially rewrite the runner. A parallel D1-specific runner with a reshaped lifecycle is cleaner than a half-factored abstract runner.

### Post-commit schema verification with a marker status column

Rejected. After the atomic batch commits, re-introspect the live database and verify it matches the contract; on verification failure, write a `verification_failed` status into the marker as a separate follow-up statement, and require the runtime to interpret this status.

Problems: the whole point of verification in PR #341 is that its result is atomic with the DDL apply — either the schema matches and the migration is marked successful, or neither happens. A post-commit verification step with a compensating status write destroys that invariant: the DDL is already live when we discover the mismatch, and the runtime now has a tri-state marker (applied-and-verified, applied-but-failed-verification, no-marker) that every downstream caller must handle. The operational ergonomics are worse than no verification — users get a successfully-applied migration that's somehow also a failure, and have to manually recover.

### Pre-batch schema simulation

Rejected. Apply the planned DDL to the introspected `SqlSchemaIR` in memory, verify the simulated IR matches the contract, then ship the batch. Would preserve the atomic guarantee: if simulation says the plan produces a matching schema and the batch executes cleanly, the live schema would match.

Problems: the simulator verifies the planner against a twin of itself. PR #341's post-DDL verification catches two classes of bug — planner bugs (planner's intent doesn't match the contract) *and* execution-path bugs (DDL renders or SQLite applies it differently than the planner expects). Simulation can only catch the first class, and does so by duplicating the planner's logic in another form. If the planner and the simulator are written from the same mental model (which they inevitably are, by the same authors), they tend to reproduce the same bugs. The addition does not meaningfully raise confidence beyond what the planner's own unit tests provide.

On top of that, the simulator carries a permanent maintenance tax: every new planner feature requires a matching simulator change, and the two must be kept in sync over the lifetime of the project. For a guarantee that provides little additional signal, the cost is not justified. Planner correctness is instead defended through unit tests on the planner directly, and through ORM-level runtime checks that catch schema mismatches at query time.

### Support nested writes on D1 via client-generated primary keys

Deferred, not rejected. If the ORM planner resolves nested-write PKs client-side (CUIDs, UUIDs) before constructing statements, all inserts can ship in one batch with the FK relationships pre-resolved — no need to read RETURNING mid-transaction. This unlocks nested writes on D1 without interactive transactions. The cost is that the planner must support client-generated PKs end-to-end, which is a cross-cutting feature touching contract authoring, codec generation, and mutation planning. It's the right long-term answer; for the first D1 release we gate nested writes and revisit once the planner supports this.

### Apply migrations via the `/query` REST endpoint

Rejected. `wrangler d1 migrations apply` takes this path, and so did the first draft of this plan. Empirical testing against miniflare — and third-party reports against remote D1 — confirm that `PRAGMA foreign_keys = OFF` inside `/query`'s implicit transaction is a no-op. Recreate-table migrations with CASCADE children silently lose data. The import API avoids this by using a different server-side execution framing. Whichever endpoint Cloudflare unifies eventually, we use the one that works today.

### Follow wrangler's model exactly (no marker, no hash, no verification)

Rejected. Wrangler's migrations are hand-authored SQL with no schema-of-record to verify against — the user is the source of truth. Prisma Next has a contract as the declared schema-of-record; discarding the marker and origin/destination hashes would surrender a meaningful correctness property independent of verification. Wrangler's use of the import API *is* adopted; its lack of marker and hash integrity is not.

### Advisory lock via a lease-row pattern

Rejected for this release, might revisit. The idea: before submitting the import, INSERT a row into a `_prisma_migration_lease` table with a TTL; on import failure, the lease expires and another migrator can proceed. This adds a layer of concurrency protection on top of marker CAS. For CLI-triggered human-paced migrations, marker CAS alone is sufficient, and the lease-row pattern adds operational complexity (stale leases, clock skew, cleanup) that isn't justified by the risk profile.

## Open Questions

- **Import API atomicity under mid-file failures.** Wrangler's comment states that failed imports return the database to its original state. Verify empirically that this covers *every* failure class we care about: syntax errors, `RAISE(ABORT)` raised by our assertions (FK check, marker CAS), and FK-integrity violations surfaced by `PRAGMA foreign_key_check`. If any of these are treated as "partial success," the marker/ledger integrity invariant fails.
- **Import API error granularity.** When the import fails, does the response tell us *which* statement failed and what the SQL error was, or only that the import failed? The CLI's error messages depend on this — we want to surface "operation X's DDL failed with message Y," not "the import failed."
- **Import API size limits.** Migrations are generally small, but the R2 upload step has per-object limits. Confirm no migration shape we reasonably expect hits them.
- **Per-table introspection parallelism on `/query`.** PR #341's control adapter comments that synchronous `node:sqlite` reads don't benefit from `Promise.all`. On D1 `/query` the opposite is true — parallelizing per-table PRAGMA reads can meaningfully cut pre-import time for large schemas. The control adapter may need either a configuration flag or a driver-hint mechanism to choose strategy.
- **Credentials config shape.** `/query` and `/import` both need account ID, database UUID, and API token; the Workers binding needs a binding name. The config-loader mechanism should accept both REST and binding shapes cleanly without forcing users to duplicate configuration between dev and prod.
- **Error-envelope mapping for D1.** D1's REST and binding surfaces return different error shapes than native SQLite's. The driver needs an error mapping table that surfaces comparable `RuntimeError` codes so ORM-level error handling stays consistent.

## Non-Goals

- D1 as a separate SQL dialect. We explicitly reuse the SQLite adapter's SQL output. If D1 ever diverges (new D1-only SQL features, incompatible PRAGMA semantics), we revisit — but not preemptively.
- Online schema migrations on D1. PR #341's planner is additive-plus-recreate; D1 inherits that scope. No online alter paths, no zero-downtime migrations.
- Interactive transactions via any mechanism. They are gated at the ORM layer; no runtime fallback, no emulation.
- Nested writes. See "client-generated primary keys" under deferred alternatives.
- Multi-region / session-consistency tuning (D1's `withSession`). Runtime driver uses default consistency; session-consistency modes are a future enhancement.
- Local development with native `node:sqlite`. The local story for D1 developers uses miniflare (what wrangler uses), which gives bit-compatible D1 behavior locally. The native-SQLite driver is not repurposed for D1 local dev.
