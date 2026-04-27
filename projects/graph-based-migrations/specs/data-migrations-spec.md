# Summary

Data migrations are data transformation operations that execute as part of a migration edge in the graph. All migrations — structural and data — are authored in TypeScript as target-agnostic operation chains. At verification time the target adapter lowers the chain into a serialized target-native operation form and stores it in `ops.json` (for SQL targets this takes a `{ sql, params }` shape; document targets serialize their operations with a comparable shape appropriate to that target). At apply time the runner hands the serialized operations to the target adapter for execution — no TypeScript is loaded. Data transforms are first-class operations in the chain, positioned by the planner at the correct point between structural ops. Data transforms can opt into being routing-visible via `invariantId`; the routing layer (path selection on refs, marker-side applied-invariant storage, structured errors) is specced separately in `invariant-aware-routing.spec.md`.

# Description

Prisma Next's graph-based migration system models schema evolution as a directed graph of contract-hash states connected by structural migration edges. This works well when migrations are purely structural (path-independent), but breaks down when data transformations are involved — two databases at the same contract hash can have meaningfully different data depending on which path was taken.

Data migrations solve this by allowing data transform operations to be part of the operation chain on graph edges. The system doesn't reason about what the transforms do; it tracks that named data migrations were applied, and routes through paths that satisfy required invariants. This preserves the graph model's flexibility for structural routing while adding data-awareness without collapsing to linear history.

The primary user is a backend developer comfortable writing database queries (SQL for SQL targets, the target-native query shape for document targets) but not thinking about migration theory. They want to describe what should happen and have the system handle safety. The system should detect when data migrations are needed, scaffold the appropriate operations, and let the user fill in the data transformation logic.

# Requirements

These are the problems the system must solve. The Solution section describes how each is addressed.

## R0. No arbitrary code execution at apply time

Migrations must not involve executing arbitrary TypeScript at apply time. The authoring surface is TypeScript, but the output is the target-native serialized operation form stored in `ops.json` (e.g. `{ sql, params }` for SQL targets; an equivalent operation payload for document targets) that can be inspected, audited, and shipped to a SaaS runner without trusting user code. This is critical because: (1) migrations will eventually be serialized and shipped to a hosted service, where executing arbitrary code is a non-starter, (2) even locally, importing a TypeScript module executes top-level code, which is a security risk in team settings, (3) the lowered form enables plan-time visibility — reviewers see exactly what will execute.

## R1. Users can express data transformations during schema migration

Schema evolution often requires data transformations that the database cannot perform automatically: backfilling computed values, converting between types with ambiguous mappings, splitting/merging columns or tables, resolving constraint violations, seeding reference data. The system must provide a way for users to express data transformation queries as part of a migration. See [data-migration-scenarios.md](./data-migration-scenarios.md) for the full scenario enumeration.

## R2. Data migrations cover a wide range of schema evolution scenarios

The system must handle the common patterns — computed backfill, lossy type changes, column split/merge, table split/merge, normalization/extraction, key identity changes, constraint enforcement, data seeding. The query builder is the sole authoring surface for v1; if it can't express a scenario, that's either a gap to fill in the query builder or an out-of-scope limitation. Scenarios requiring application-level libraries (e.g., bcrypt hashing) or external data sources are out of scope and must be handled outside the migration system.

### Scenario coverage summary

See [data-migration-scenarios.md](./data-migration-scenarios.md) for full details per scenario.

| Scenario | Auto-detect | Execution model | Known gaps |
|----------|------------|-----------------|------------|
| S1. Computed backfill | Yes (NOT NULL) | Full | — |
| S2. Lossy type change | Yes (type change) | Full (temp column for same-name) | QB expression support in SET (OQ-5) |
| S3. Column split | Yes (NOT NULL) | Full | QB expression support (OQ-5) |
| S4. Column merge | Yes (NOT NULL) | Full | QB expression support (OQ-5) |
| S5. Table split (vertical) | Yes (NOT NULL FK) | Full | QB INSERT...SELECT (OQ-5) |
| S6. Table split (horizontal) | No (detection gap, OQ-4) | Full (manual authoring) | QB INSERT...SELECT (OQ-5) |
| S7. Table merge | Yes (NOT NULL) | Full | QB INSERT...SELECT, joins (OQ-5) |
| S8. Semantic reinterpretation | No (no structural change) | **Out of scope** — deferred (pure data migration A→A) | — |
| S9. Denormalization | Yes (NOT NULL) | Full | QB subqueries in UPDATE (OQ-5) |
| S10. Normalization/extraction | Yes (NOT NULL + FK) | Full | QB INSERT...SELECT, joins (OQ-5) |
| S11. Key/identity change | Per-column only | Full (manual authoring) | Cross-table coordination (OQ-3) |
| S12. Encoding/format change | Type changes only | Full for type changes | Same-type format changes are S8 territory |
| S13. Constraint enforcement | Yes | Full | — |
| S14. Data seeding | Yes (NOT NULL FK) | Full | Check uses `return false` (always run) |
| S15. Soft↔hard delete | No (semantic) | Full (manual authoring) | — |
| S16. Encryption/hashing | — | **Out of scope** — requires app-level libraries | — |
| S17. Audit trail backfill | Yes (NOT NULL) if source is in DB | Partial — DB sources work, external sources out of scope | — |
| S18. Multi-tenant isolation | Yes (NOT NULL) | Full | — |

## R3. Data migrations are safe to retry after partial failure

If a migration fails midway (crash, timeout, constraint violation), re-running it must not corrupt data or produce duplicate effects. The system needs a mechanism to determine whether a data migration has already been applied, and skip it if so.

## R4. Users don't accidentally skip required data transformations

When the planner detects a structural change that implies data migration is needed (e.g., adding a NOT NULL column without a default), it must ensure the user addresses it before the migration can be applied. An unimplemented data migration keeps the package in draft state — `migration verify` cannot attest it, and `migration apply` rejects unattested packages.

## R5. Data migration queries have access to both old and new schema state

During a data migration, the user's queries need to read from old columns/tables (to get existing data) and write to new columns/tables (to populate transformed data). The old schema must not yet be torn down, and the new schema must already be partially set up.

## R6. Data migrations work on tables of all sizes

Small tables can be migrated within a single transaction for atomicity. Large tables may require batched updates outside of a transaction, or DDL that can't run in a transaction (e.g., `CREATE INDEX CONCURRENTLY`). The execution model must accommodate both extremes.

## R7. Data migrations participate in the graph model

The migration graph must be aware of data migrations. When multiple paths exist to the same contract hash, the system must be able to distinguish paths based on what data transformations they include, and select appropriately.

## R8. Environments can declare which data migrations are required

Different environments (production, staging, dev) may need different data migration guarantees. The system must allow environments to declare which named data migrations must have been applied, and route accordingly.

## R9. Users can author migrations manually

Users need to be able to write their own migration (structural DDL, data transformations, or both) without relying on the planner. This should use the same authoring surface as planner-generated migrations.

## R10. Planning works offline (no database connection required)

Per ADR 169, migration planning must not require a live database connection. Detection of data migration needs and scaffolding must work from contract diffs alone.

## R11. Post-apply verification catches schema mismatches

After a migration (including any data migration) completes, the system must verify that the database schema matches the destination contract. This is the hard safety net — if the migration didn't produce the expected schema state, apply fails.

## R12. No special rollback mechanism

Reverting a migration is just another migration in the opposite direction. The system should not introduce rollback-specific machinery for data migrations. A migration S2→S1 is an ordinary graph edge that can carry its own data migration.

# Solution

## Constraints

These apply across the entire solution:

- Only lowered SQL (`{ sql, params }`) is stored in `ops.json`. Lowering from query builder ASTs to SQL happens at verify time via the target adapter. No TypeScript is loaded or executed at apply time.
- User-authored data migration queries should be idempotent. The required `check` query provides the primary retry-safety mechanism, but truly idempotent `run` queries are the safest approach.

## Unified TypeScript authoring model (R0, R1, R2, R9)

All migrations — structural and data — are authored as TypeScript files that return a list of operations. The file is evaluated at verification time; data transform callbacks are called with a typed DSL client, the query builder produces `SqlQueryPlan` ASTs which are lowered to SQL via the postgres adapter, and the resulting `{ sql, params }` pairs are written to `ops.json`. At apply time, only the lowered SQL is loaded and executed — no TypeScript, no AST deserialization.

The planner generates these TypeScript files. When the planner detects patterns (NOT NULL without default, type change, nullable tightening), it scaffolds `migration.ts` with the appropriate operation sequence and `TODO` placeholders for data transforms. The user fills in the callbacks using the typed DSL client. The user can also author migration files manually via `migration new`.

`createBuilders<Contract>()` returns all builder functions with `dataTransform` typed so callbacks receive `Db<Contract>` — full autocomplete on table names, columns, and query methods. A data transform is just another operation in the chain:

```typescript
// migrations/0003_split_name/migration.ts
import type { Contract } from "../../src/prisma/contract.d"
import { createBuilders } from "@prisma-next/target-postgres/migration-builders"

const { addColumn, dropColumn, setNotNull, dataTransform } = createBuilders<Contract>()

export default () => [
  addColumn("user", "firstName", { nullable: true }),
  addColumn("user", "lastName", { nullable: true }),
  dataTransform("split-user-name", {
    check: (db) => db.user.select('id').where((f, fns) => fns.eq(f.firstName, null)).limit(1),
    run: (db) => [
      db.user.update({ firstName: 'unnamed' }).where((f, fns) => fns.eq(f.firstName, null)),
      db.user.update({ lastName: 'unnamed' }).where((f, fns) => fns.eq(f.lastName, null)),
    ],
  }),
  setNotNull("user", "firstName"),
  setNotNull("user", "lastName"),
  dropColumn("user", "name"),
]
```

The `check` and `run` callbacks receive a typed `Db<Contract>` client and return `Buildable` (query chain) or `Buildable[]`. At verification time, the resolver creates the DSL client from the contract and framework components, calls the callbacks, calls `.build()` on the results to capture `SqlQueryPlan` ASTs, and lowers them to SQL via the postgres adapter. The lowered `{ sql, params }` pairs are stored in `ops.json`. At apply time, the runner executes the SQL directly — no AST deserialization or lowering needed.

The DSL client supports extension query functions (e.g., pgvector's `cosineDistance`) via `queryOperations` exposed on control descriptors (see open question #11).

### Strategies (R2)

Common patterns are encapsulated as strategies — functions that expand to correctly-ordered sequences of primitive operations:

```typescript
import { columnSplit } from '@prisma-next/migration'

export default () =>
  columnSplit("users", "name", {
    columns: ["first_name", "last_name"],
    transform: (client) => client.users.update({
      firstName: expr("split_part(name, ' ', 1)"),
      lastName: expr("split_part(name, ' ', 2)"),
    }).where({ firstName: null }),
    check: (client) => client.users.findFirst({ where: { firstName: null } }),
  })
```

`columnSplit` internally produces: addColumn(first_name) → addColumn(last_name) → dataTransform → setNotNull(first_name) → setNotNull(last_name) → dropColumn(name). The ordering is correct by construction.

The planner detects when a strategy applies and scaffolds the appropriate call. The user provides only the information gap — how to derive the new values from the old. Building a library of strategies is future DX work; for v1, the planner emits raw operation sequences with the data transform positioned correctly.

### Serialization lifecycle

The migration TS file integrates with the existing Draft → Attested → Applied lifecycle:

1. **Scaffold (Draft)**: `migration plan` produces a `migration.ts` file. If a data migration is needed, the data transform's `check` and `run` are unimplemented. The package is in draft state (no `edgeId`).
2. **Author (Draft)**: User fills in the data transform logic using the query builder. Still draft — the TS hasn't been evaluated.
3. **Verify/Attest**: `migration verify` evaluates the TypeScript, captures all operation ASTs (structural and data), serializes them as JSON into `ops.json`. The `edgeId` is computed from the serialized content. The package is now attested.
4. **Apply**: `migration apply` reads the serialized ASTs from `ops.json`, the target adapter renders them to SQL, and executes them sequentially. No TypeScript is loaded.

The `migration.ts` file remains in the package as source code for reference, but is not part of the `edgeId` computation.

### Representation in ops.json

All operations — structural and data — are entries in `ops.json`. A data transform entry has two states:

**Draft** (before verification):
```json
{
  "id": "data_migration.split-user-name",
  "operationClass": "data",
  "source": "migration.ts",
  "check": null,
  "run": null
}
```

**Attested** (after verification):
```json
{
  "id": "data_migration.split-user-name",
  "operationClass": "data",
  "source": "migration.ts",
  "check": { /* serialized query AST */ },
  "run": [{ /* serialized query AST */ }]
}
```

Structural operations are serialized from their operation builders (`addColumn`, `setNotNull`, etc.) at the same verification step. The runner processes all operations sequentially.

### Manual authoring — `migration new` (R9)

`migration new` scaffolds a `migration.ts` with an empty operation list. The user writes operations using the same builders and `dataTransform` calls. This is the escape hatch for when the user wants full control — structural ops, data transforms, or both.

`migration new` derives `from` hash from the current migration graph state and `to` hash from the current emitted contract. Both can be overridden with `--from` and `--to` flags.

## Retry safety — required `check` (R3)

`check(client)` is **required** on every `dataTransform`. It returns one of:

- **A query AST** (the common case): the query describes *violations* — rows that indicate the migration still needs to run. Empty result = already applied (skip `run`). Non-empty result = needs to run. This is efficient (`LIMIT 1` for early exit) and the violation rows are useful for diagnostics.
- **`false`**: always run. For seeding, idempotent-by-construction cases, or when a meaningful check isn't worth writing.
- **`true`**: always skip. Use with caution.

The check executes in two roles:

- **Before `run` (retry)**: determines whether to skip `run`. If the check returns no violations, the data migration is already complete.
- **After `run` (validation)**: confirms that `run` did its job. If violations remain, the migration fails *before* subsequent tightening operations — producing a meaningful diagnostic ("47 rows still have first_name IS NULL") instead of a cryptic database error from a later SET NOT NULL.

The execution sequence for a data transform operation is: check → (skip or run) → check again → (fail or proceed).

## Detection and scaffolding (R4, R10)

The planner detects structural changes that imply a data migration is needed:

- NOT NULL column added without a default
- Non-widening type change (e.g., FLOAT → INTEGER)
- Existing nullable column becoming NOT NULL

Detection works offline (no database connection required). The planner scaffolds when the structural diff *could* need a data migration, even if affected tables might be empty at runtime.

When detection triggers, the planner produces a `migration.ts` with the structural operations and a `dataTransform` with unimplemented `check` and `run`. The unimplemented callbacks prevent `migration verify` from attesting the package — it stays in draft state until the user fills them in.

For non-widening type changes on the same column (e.g., `price FLOAT` → `price BIGINT`), the planner uses a **temp column strategy**: it emits addColumn(temp) → dataTransform → dropColumn(original) → renameColumn(temp → original) in the correct order.

## Planner-managed operation ordering (R5)

The planner emits operations in the correct order directly. There is no generic class-based partitioning framework — the planner knows the full contract and positions each operation (structural and data) where it belongs:

- Additive ops (create tables, add nullable columns) come first
- Data transforms come after the schema state they need is set up
- Tightening ops (SET NOT NULL, UNIQUE, CHECK constraints) come after the data transforms that populate/fix the data
- Destructive ops (drop columns, drop tables) come last

This ordering is the planner's responsibility because it sees the full contract diff and understands cross-table dependencies (FKs, referenced constraints). Strategies encapsulate common ordering patterns, but the planner makes the decisions.

### Transaction modes (R6)

Individual operations or groups of operations can carry transaction annotations. The runner respects these when executing:

| Mode | Behavior | Use case |
|------|----------|----------|
| `inline` (default) | All operations run in a single transaction. Full atomicity. | Small/fast migrations. |
| `isolated` | Specific operations run in their own transaction. | Data transforms on medium tables. |
| `unmanaged` | Specific operations run without transaction wrapping. | DDL that can't run in a transaction, large batch operations. |

The transaction model is composable — the user annotates individual operations or groups rather than declaring a single mode for the entire migration.

## Graph integration (R7, R8)

Graph integration and invariant-aware routing are specced in `invariant-aware-routing.spec.md`. In brief: data transforms opt into routing visibility via `invariantId?: string`; `migration.json` carries the attestation-covered aggregate `providedInvariants`; the marker table stores the applied-invariants set; and `migration apply --ref` / `migration status --ref` route through the shortest path covering the ref's required invariants minus what's already applied. Per-invariant ledger provenance is deferred (see that spec's Deferred section).

## Operation builder API

The operation builders are the primitives that both the planner and manual authoring use to construct migration operation chains. Each builder produces one or more operation entries that serialize to `ops.json`. The builders map 1:1 to the operations the Postgres planner currently produces.

### Table operations

```typescript
createTable(tableName, { columns, primaryKey?, uniques?, indexes?, foreignKeys? })
// → operationClass: 'additive'

dropTable(tableName)
// → operationClass: 'destructive'
```

### Column operations

```typescript
addColumn(tableName, columnName, { type, nullable?, default? })
// → operationClass: 'additive'
// When NOT NULL without default on non-empty table: uses temporary identity default

dropColumn(tableName, columnName)
// → operationClass: 'destructive'

alterColumnType(tableName, columnName, { newType })
// → operationClass: 'destructive'
// Warning: may cause table rewrite

setNotNull(tableName, columnName)
// → operationClass: 'destructive'
// Precheck: no NULL values exist

dropNotNull(tableName, columnName)
// → operationClass: 'widening'

setDefault(tableName, columnName, defaultValue)
// → operationClass: 'additive' (new default) or 'widening' (change default)

dropDefault(tableName, columnName)
// → operationClass: 'destructive'
```

### Constraint operations

```typescript
addPrimaryKey(tableName, { columns, constraintName? })
// → operationClass: 'additive'

addUnique(tableName, { columns, constraintName? })
// → operationClass: 'additive'

addForeignKey(tableName, { columns, references: { table, columns }, onDelete?, onUpdate?, constraintName? })
// → operationClass: 'additive'

dropConstraint(tableName, constraintName)
// → operationClass: 'destructive'
```

### Index operations

```typescript
createIndex(tableName, { columns, indexName?, unique? })
// → operationClass: 'additive'

dropIndex(tableName, indexName)
// → operationClass: 'destructive'
```

### Data transform operations

```typescript
dataTransform(name, {
  invariantId?: string,
  check: (client) => QueryAST | boolean,
  run: (client) => QueryAST | QueryAST[],
})
// → operationClass: 'data'
// name is the retry/ledger identity — used by the runner's check to decide whether a
// transform has already run against a database. invariantId, when set, is the opt-in
// routing key — the identity refs reference and the routing layer reads. See
// invariant-aware-routing.spec.md §D4.
```

### Type operations

```typescript
createType(typeName, definition)
// → operationClass: 'additive'
// For enums, domains, composite types
```

### Annotations

```typescript
transaction([...ops])
// Wraps a group of operations in a single transaction

noTransaction(op)
// Marks an operation to run outside any transaction
```

### Design notes

- Each builder produces an operation descriptor — a thin reference to contract elements by name. The resolver converts descriptors to `SqlMigrationPlanOperation` objects (with SQL, prechecks, postchecks) using the contract context and existing planner SQL generation helpers (`planner-ddl-builders.ts`, `planner-sql-checks.ts`).
- **Builders are target-specific** (Postgres builders produce Postgres SQL). This is an intentional decision: the alternative is a target-agnostic builder layer that each adapter must implement separately. Since `ops.json` already contains target-specific SQL, and the planner already produces target-specific operations, the builders should too. For a new target (MySQL, MongoDB), the builders would be reimplemented with the same ergonomic API but different internal SQL generation — the API surface is the shared contract, not the implementation. Shared logic can be factored out internally.
- Builders live alongside the planner in the target package (e.g., `packages/3-targets/3-targets/postgres/`), not in the framework tooling package. The planner reuses the same helpers.
- The `dataTransform` builder accepts typed callbacks `(db: Db<Contract>) => Buildable | Buildable[]`. At resolve time, the resolver creates a DSL client from the contract, calls the callbacks, calls `.build()` on the results, and lowers the resulting `SqlQueryPlan` ASTs to `{ sql, params }` via the postgres adapter. The lowered SQL is stored in `ops.json`.
- The planner uses these same builders to construct its output. When the planner emits TS, it writes calls to these builders in the correct order.
- **Descriptor resolution goes through `TargetMigrationsCapability`**. The operation descriptors are target-agnostic thin data, but resolving them to `SqlMigrationPlanOperation` (with SQL, prechecks, postchecks) is target-specific work. The CLI is target-agnostic and cannot import directly from a target package like `@prisma-next/target-postgres`. Instead, the target exposes a `resolveDescriptors(descriptors, context)` method on `TargetMigrationsCapability` — the same interface that already provides `createPlanner` and `createRunner`. The CLI loads the config, gets the target, and calls `target.migrations.resolveDescriptors()`. This follows the same pattern as `migration plan` (which calls `target.migrations.createPlanner()`) and `migration apply` (which calls `target.migrations.createRunner()`).
- **Descriptors reference contract elements by name, not by value.** Descriptors are intentionally thin — `addColumn("users", "email")` carries the column name as a string, not a full `StorageColumn` definition. The resolver looks up the actual `StorageColumn` from the destination contract (which has `codecId`, `typeParams`, `default`, etc.) and passes it to the existing SQL generation helpers. This avoids duplicating contract information in the migration: the contract is the single source of truth for column types, constraint details, and FK definitions. The descriptors are a join key into the contract, not a copy of it. This means descriptors can only reference things that exist in the destination contract — which is correct, since the destination contract describes the schema state after the migration.
- **Descriptors support overrides for intermediate states.** A migration often needs to express intermediate schema states that differ from the destination contract — for example, adding a column as nullable first, backfilling it, then tightening to NOT NULL. The destination contract says NOT NULL, but the `addColumn` step needs to be nullable. Descriptors accept an optional `overrides` parameter for this: `addColumn("users", "foo", { nullable: true })` adds the column as nullable regardless of what the contract says. The resolver applies overrides on top of the contract-looked-up definition. This keeps the contract as the source of truth while allowing the migration to express the multi-step pattern. Currently only `addColumn` supports `nullable` override — this is the primary case where intermediate state diverges from the destination contract. Other overrides can be added as needed.

## Post-apply verification (R11)

The existing post-apply schema verification (introspect database, compare against destination contract) serves as the hard safety net. No additional verification mechanism is needed — the runner already does this for structural migrations, and it naturally extends to cover migrations with data transforms.

## Rollback (R12)

No special rollback mechanism. Reverting state S1→S2 is a new migration S2→S1 — an ordinary graph edge that can carry its own data transforms if needed.

## Applicability to document databases

The unified migration model is designed to work for document databases (MongoDB, etc.), not just SQL targets.

**Why this works**: The contract in prisma-next represents the *application's* data model, not the database's schema. A document database may be schemaless at the storage layer, but the application domain is never schemaless — there are always expected shapes, types, and relationships. The contract makes this explicit and manageable. When evolving from one contract to another, the operations are semantically equivalent regardless of target: backfill a new field, reshape a document, split a collection, deduplicate records.

**What transfers without modification**: The serialization lifecycle (TS → JSON AST → adapter execution), the `check`/`run` contract, the graph model (edges, invariants, routing), the ledger, the Draft → Attested → Applied lifecycle, retry safety, and transaction modes.

**The key difference**: For SQL targets, many operations are structural DDL. For document databases, schema evolution *is* data transformation. The data transform mechanism becomes the primary migration surface. The operation chain model handles both naturally — a MongoDB migration is just a chain of data transforms with no structural ops.

**What requires target-specific work**: A MongoDB-flavored query builder client that produces MongoDB-shaped AST nodes. The JSON AST format has lower impedance mismatch for MongoDB than SQL, since MongoDB operations are natively JSON.

# Key Decisions

These document the major design choices, the alternatives considered, and why we chose this approach.

## D1. TypeScript-authored, AST-serialized — unified for structural and data

**Decision**: All migrations are authored as TypeScript operation chains, serialized to JSON ASTs at verification time, and rendered to target-specific queries at apply time. Data transforms are operations in the chain, not a separate mechanism.

**Alternatives considered**:
- **Operator algebra**: SMO-style typed operators with commutativity analysis. Rejected: expression language does "enormous work," opaque escape hatch needed for anything it can't express.
- **Arbitrary code execution at apply time**: Rejected: security risk for SaaS, top-level code execution on import, no auditability.
- **Separate `data-migration.ts` file**: Data migration as a separate file alongside `ops.json`. Rejected in favor of unified operation chain: simpler model, no class-based partitioning needed, data transforms positioned naturally in the sequence.

**Why unified chain**: One authoring surface for everything. The planner produces TS that includes both structural ops and data transforms in the correct order. Strategies encapsulate common patterns. Manual authoring (`migration new`) uses the same surface. No need for a separate partitioning framework.

## D2. Name over semantic postconditions; honest about what invariants are

> **Refined by `invariant-aware-routing.spec.md` §D4.** `name` retains its retry/ledger-identity role described below. The routing-visible invariant identity is now a separate, opt-in `invariantId?: string` field on `DataTransformOperation`. The discussion here remains a valid design note on identity-by-name vs. semantic postconditions.

**Decision**: The system tracks data migrations by **name** (identity, human-readable). The invariant is "named data migration X was applied."

**What this actually is**: Functionally, this is the same as carrying around proof that specific migrations ran. For any path segment that has data migrations, the model degenerates to "you must take this specific path" — which is linear history for that segment. Data migrations are inherently path-dependent; we're not trying to make them path-independent. The graph's flexibility only helps for structural-only segments.

**Why name**: The name is stable under code changes (fixing a bug in the migration doesn't change its identity), human-readable in CLI output and ref files, and serves as the primary key for invariant requirements.

**Alternative considered — semantic postconditions**: Carry checkable predicates about data state ("all phone numbers match E.164"). Problem: we can't exhaustively cover all possible postcondition checks with a typed representation. The required `check` on `dataTransform` gives us user-authored postconditions for retry safety without pretending the system can reason about them.

## D3. Required `check` postcondition

**Decision**: Every `dataTransform` must include a `check` that returns a query AST (violations — empty = done), `false` (always run), or `true` (always skip).

**Why required**: Solves three problems: (1) retry safety — check before run, skip if done, (2) post-run validation — check after run, fail before tightening ops if violations remain, (3) forces the user to think about "done."

## D4. Single-edge, planner-managed ordering

**Decision**: A migration is a single graph edge with an ordered operation chain. The planner positions operations (structural and data) in the correct order.

**Alternatives considered**:
- Split into multiple edges (additive → data → destructive). Rejected: requires synthesizing intermediate contracts, creates graph noise.
- Generic class-based partitioning. Rejected: doesn't handle constraint ops correctly (classified as additive but semantically tightening), and the planner already knows the right order.

**Why planner-managed**: The planner sees the full contract diff and understands cross-table dependencies. It positions each operation where it belongs. Strategies encapsulate common patterns but the planner makes the decisions. This eliminates the op partitioning edge case (OQ-1 from earlier versions).

## D5. Co-located with edges, not independent

**Decision**: Data transforms are operations within migration edges, not independent artifacts.

**Why**: A data transform needs a specific schema to run against. It has a natural home in the edge that creates that schema. Co-location means the structural path determines which transforms run — no separate routing needed.

## D6. Temp column strategy for same-column type changes

**Decision**: When a column's type changes without a rename (e.g., `price FLOAT` → `price BIGINT`), the planner emits addColumn(temp) → dataTransform → dropColumn(original) → renameColumn(temp).

**Why**: The only approach that gives the user a writable column of the correct target type while old data is still readable.

**Future refinement — `USING` clause**: For simple conversions expressible as a single SQL expression, `ALTER COLUMN TYPE ... USING` is simpler. The planner could offer common patterns and fall back to temp column when the user needs complex logic.

## D7. Planner detects, scaffolds with context, prevents accidental no-ops

**Decision**: The planner auto-detects data migration needs and scaffolds a `migration.ts` with the correct operation sequence, including an unimplemented `dataTransform`. The package stays in draft state until the user fills in the transform logic and runs `migration verify`.

# Acceptance Criteria

## Authoring and serialization

- [x] Migration TS files returning operation lists are recognized during verification
- [x] `check` and `run` receive a typed `Db<Contract>` client via `createBuilders<Contract>()`
- [x] `run` callback returns `Buildable | Buildable[]` — resolver calls `.build()` and lowers to SQL
- [x] `migration verify` evaluates the TypeScript, resolves callbacks, lowers to SQL, writes `{ sql, params }` to `ops.json`
- [x] No TypeScript is loaded at `migration apply` time — only lowered SQL from `ops.json`
- [x] The `migration.ts` source file is not part of the `edgeId` computation; only serialized ops are
- [x] A package with `TODO` sentinel in dataTransform prevents attestation (resolver throws)
- [x] `migration apply` rejects draft (unattested) packages

## Detection and scaffolding

- [x] `migration plan` scaffolds a `migration.ts` with `dataTransform` when it detects a NOT NULL column without default
- [x] `migration plan` scaffolds when it detects a non-widening type change
- [x] `migration plan` scaffolds when it detects a nullable → NOT NULL change
- [x] Scaffolded `dataTransform` includes `TODO` placeholder with comment
- [x] Scaffold generates `createBuilders<Contract>()` with contract type import
- [x] An unimplemented `dataTransform` (TODO sentinel) prevents attestation

## Execution

- [x] Operations execute in the order they appear in the chain
- [x] Data transform check runs before and after the transform's run step
- [ ] `inline`: all operations in one transaction; failure rolls back everything
- [ ] `isolated`: annotated operations get their own transaction
- [ ] `unmanaged`: annotated operations run without transaction wrapping
- [x] On retry, check determines whether to skip the data transform's run step

## Graph integration

- [ ] Migration application is recorded in the ledger on edge completion (retry/apply history — ledger semantics not owned by this spec)

See `invariant-aware-routing.spec.md` for acceptance criteria covering ref-declared required invariants, path selection, and marker-side applied-invariants storage.

## Rollback

- [ ] A migration S2→S1 with data transforms works identically to S1→S2

# Non-goals

- **Multiple data transforms per edge requiring dependency analysis between them**: For v1, data transforms in a single chain are ordered by the planner or manually by the user. Cross-transform dependency analysis is future work.
- **Pure data migrations (A→A)**: Data-only transformations with no schema change. ADR 039 currently rejects self-loops.
- **Strategy library**: Pre-built strategies (`columnSplit`, `nonNullBackfill`, `typeChange`, `tableExtraction`) are future DX work. For v1, the planner emits raw operation sequences.
- **Arbitrary code execution**: Scenarios requiring application-level libraries (e.g., bcrypt hashing, S16) or external data sources are out of scope.
- **Raw SQL escape hatch**: The query builder is the sole authoring surface. SQL is lowered from query builder ASTs at verify time. A future raw SQL escape hatch could be added as a builder method (e.g., `db.raw("UPDATE ...")`) that produces a `SqlQueryPlan` with the SQL embedded.
- **Runtime no-op detection**: Mock-style verification that transforms actually modified data. Future safety layer.
- **Content hash drift detection**: Descoped — the `migration.ts` is not part of `edgeId`, serialized ASTs have integrity via `edgeId`, and cross-environment comparison requires shared state.
- **Question-tree UX**: Interactive diff-driven authoring. Future layer.
- **Invariant routing**: Specced and scoped in `invariant-aware-routing.spec.md`. Ref management (`migration ref set/list/rm`) already landed; CLI surface for editing a ref's `invariants` array remains deferred in that spec.

# Open Questions

1. **Cross-table coordinated migrations (S11)**: PK type changes cascade across the FK graph. The planner needs FK graph awareness to emit coordinated ops across all referencing tables. For v1, user-authored manually.

2. **Environment ref format**: **Resolved.** Refs refactored to `migrations/refs/<name>.json` with `{ hash, invariants: string[] }`.

3. **Table drop detection gap (S6)**: Horizontal table splits may not trigger auto-detection. Known gap for v1.

4. **Query builder expressiveness**: UPDATE SET column = other_column (column-to-column references in SET values) is not supported by the query builder. INSERT...SELECT, subqueries with joins also not available. Users can express most backfills with literal values. Extension query functions (e.g., pgvector cosineDistance) are supported via `queryOperations` on control descriptors. The SQL builder AST is DML-focused (SELECT/INSERT/UPDATE/DELETE) and lacks DDL-oriented nodes like CASE expressions or type casts. Enum value mappings in `alterColumnType` USING clauses must be written as raw SQL strings in migration.ts. A future `CaseExpr` AST node would allow typed USING expressions.

5. **Operation builder API design**: **Resolved.** `createBuilders<Contract>()` returns typed builders. `dataTransform` callbacks receive `Db<Contract>` with full autocomplete. SQL lowered at verify time.

6. **Planner TS output format**: **Resolved.** The planner scaffolds `migration.ts` with `createBuilders<Contract>()` and builder calls. For data transforms, `TODO` placeholders are generated. The evaluate → resolve → lower → ops.json pipeline is complete.

7. **Contract changes after `migration new` require recreating the migration**: If the user runs `migration new`, writes their migration.ts, then realizes they need to tweak the contract (e.g., forgot NOT NULL), the `to` hash and `toContract` in `migration.json` are stale. There's no way to refresh them without deleting the package and starting over, losing the migration.ts work. A `migration refresh` command (or having verify detect the stale contract) would solve this — re-read the emitted contract and update the manifest's `to` hash + `toContract` without touching migration.ts.

8. **`OperationDescriptor` is a loose index-signature type**: The framework-level `OperationDescriptor` is `{ kind: string; [key: string]: unknown }` because the framework doesn't know target-specific descriptor shapes. This means scaffold code generation (`descriptorToBuilderCall`) uses untyped property access. The proper fix is a generic `TargetMigrationsCapability<..., TDescriptor>` parameter so the descriptor type flows through, but this requires reworking the capability interface. Fine for v1 since the scaffold serializer is the only consumer.

9. **Codec-specific type descriptors are hardcoded**: The descriptor planner maps `type_missing` to `createEnumType` by checking `codecId.startsWith('pg/enum')`. Non-enum codec types return a conflict. The proper approach is a codec hook registry that maps codec IDs to descriptor emitters, so each codec can declare what descriptors it needs. This avoids hardcoding prefix checks in the planner and scales to future codec types. Fine for v1 since enums are the only codec type that creates Postgres types.

10. **Draft edge anchoring with `--ref`**: When a draft migration exists and `--ref` targets a different node than the draft's source, `migration status` shows the contract node connected from the draft's source — not from the ref target. Handling this properly would require drawing dashed edges from both nodes to the contract, which could drastically change the graph shape and the dashed edge rendering doesn't support corners (only straight vertical/horizontal segments resolve to dashed characters; corners fall back to solid). Acceptable limitation for now.

11. **`queryOperations` duplication across control and runtime descriptors**: Extension packages (e.g., pgvector) have two descriptor exports: `./control` (used by CLI for migration planning, schema verification, DDL generation) and `./runtime` (used by app code for query execution). These are different types (`SqlControlExtensionDescriptor` vs `SqlRuntimeExtensionDescriptor`) with different fields, but they share static metadata from `descriptor-meta.ts`.

    Query operation definitions (e.g., pgvector's `cosineDistance` with its args, return type, and SQL lowering template) are static data defined in `descriptor-meta.ts`. Previously only wired to the runtime descriptor (`queryOperations: () => pgvectorQueryOperations`), because the control plane never needed to build queries.

    Data transform callbacks in migration.ts need a typed DSL client (`db.user.update(...)`) at resolve time. The resolver lives in target-postgres's control export, which only has access to control descriptors via `frameworkComponents`. To build the DSL client, it needs the `queryOperationTypes` record (method names → lowering templates) that comes from iterating `queryOperations()` on contributors.

    The flow: `frameworkComponents` (control descriptors) → iterate `queryOperations()` → build `BuilderContext.queryOperationTypes` → `sql()` creates DSL client → resolver passes client to callbacks → callbacks return `Buildable` → `.build()` captures `SqlQueryPlan`.

    Fix: add optional `queryOperations` to the control descriptor interface. Each extension adds one line to its control export pointing to the same static array from `descriptor-meta.ts`. This is duplication of wiring (one line per extension), not duplication of data. Long-term, the control/runtime descriptor split may benefit from a shared base that carries common static metadata like query operations, codec type metadata, and operation signatures — all of which are already shared via `descriptor-meta.ts` imports.

12. **No static verification that ops transform fromContract to toContract**: Attestation hashes the manifest + ops for integrity but does not verify that the operations actually transform the source contract's schema into the destination contract's schema. For planner-generated migrations this is correct by construction (the planner derives ops from the contract diff). For user-authored migrations (`migration new`), the ops could be wrong — the only validation is post-apply (the runner introspects the live database and compares against the destination contract). A static check would require an `applyOpsToSchema(fromSchema, ops) → resultSchema` function that simulates the ops against the source schema and compares the result to the destination contract. This does not exist. The gap means user-authored migrations can be attested and committed even if they are structurally incorrect — the error surfaces only at apply time against a real database.

# Other Considerations

## Security

- No TypeScript is executed at apply time. Only lowered SQL from ops.json is executed.
- Data migration SQL runs with the same database permissions as the migration runner.
- The `migration.ts` source is evaluated only at verification time on the author's machine.

## Observability

- The runner logs data migration start/completion/failure with the migration name and transaction mode.
- The ledger records migration applications (retry/apply history). The applied-invariants set (what `invariantId`s the database has seen) lives on the marker; see `invariant-aware-routing.spec.md`.

# References

- [data-migrations.md](./data-migrations.md) — Theory: invariants, guarded transitions, desired state model
- [data-migrations-solutions.md](./data-migrations-solutions.md) — Solution exploration: compatibility, routing, integration models
- [data-migration-scenarios.md](./data-migration-scenarios.md) — 18 schema evolution scenarios walked through against the design
- [data-migrations-response.md](./data-migrations-response.md) — Feedback on spec: unified TS authoring model, strategies, operation chains
- [april-milestone.md](./april-milestone.md) — VP1: prove data migrations work in the graph model
- [chat.md](./chat.md) — Design exploration: operator algebra, scenario enumeration, question-tree UX
- Planner implementation: `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`
- Runner implementation: `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`
- Operation types: `packages/1-framework/1-core/migration/control-plane/src/migrations.ts`
- ADR 037 — Transaction semantics and compensation
- ADR 038 — Operation idempotency classes
- ADR 039 — Graph integrity and validation
- ADR 044 — Pre/post check vocabulary
- ADR 169 — Offline planning and containerization
