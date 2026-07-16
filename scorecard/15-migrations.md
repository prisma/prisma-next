# Migrations

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma Next **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma Next public surface, but no proving Prisma Next integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma Next but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma Next.
- `—` **n/a** — feature does not apply to that database.

## Migrations — workflow

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| Author + apply migrations (plan → apply) | ✅ | ✅ | ✅ | `test/integration/test/cli.migration-apply.e2e.test.ts`; `test/e2e/framework/test/sqlite/migrations/additive.test.ts`; `test/integration/test/mongo/migration-e2e.test.ts` |
| `db init` (additive bootstrap) | ✅ | 🟡 | ✅ | `test/integration/test/cli.db-init.e2e.test.ts`; `test/integration/test/mongo/migration-e2e.test.ts` (`full lifecycle via control driver`) |
| `db update` (advance to contract) | ✅ | 🟡 | 🟡 | `test/integration/test/cli.db-update.e2e.test.ts` |
| Idempotent re-apply (no-op when in sync) | ✅ | 🟡 | ✅ | `test/integration/test/cli.migration-apply.e2e.test.ts` (`re-run after success is a no-op`); `test/integration/test/mongo/migration-e2e.test.ts` (`idempotent re-apply`) |
| Multiple migrations in DAG order | ✅ | 🟡 | — | `test/integration/test/cli.migration-apply.e2e.test.ts` (`applies multiple migrations in DAG order`) |
| Resume after partial apply | ✅ | 🟡 | — | `test/integration/test/cli.migration-apply.e2e.test.ts` (`resumes from last successful migration after failure`) |
| Drift detection / pre-DDL guard | ✅ | 🟡 | ✅ | `test/integration/test/cli.migrate-drift-check.e2e.test.ts`; `test/integration/test/mongo/aggregate-e2e.test.ts` (`per-space verify isolates extension drift`) |
| Migration ledger / history persistence | ✅ | 🟡 | ✅ | `test/integration/test/migration-ledger/*`; `test/integration/test/mongo/migration-e2e.test.ts` (`records a ledger entry`) |
| Ref advancement — `ref set` | ✅ | 🟡 | — | `test/integration/test/cli.db-ref-advancement.e2e.test.ts` (`advances an explicit ref on the default database`); `test/integration/test/cli.migrate-ref-advancement.e2e.test.ts` |
| Ref advancement — `ref delete` | 🟡 | 🟡 | — | |
| Ref advancement — `ref list` | 🟡 | 🟡 | — | |
| `dataTransform` (data-migration closure) | 🟡 | 🟡 | ✅ | `test/integration/test/mongo/migration-authoring-e2e.test.ts` (`multi-step migration lifecycle`) |
| `rawSql` / raw migration op | 🟡 | 🟡 | 🟡 | |
| `migrate reset` (drop + reapply, `--force`) | ❌ | ❌ | — | |
| `migrate resolve` (baselining, mark-applied/rolled-back) | ❌ | ❌ | — | |
| `migrate diff` arbitrary two-source + `--script` | ❌ | ❌ | — | |
| `db execute` (ad-hoc SQL runner) | ❌ | ❌ | — | |
| `db seed` | ❌ | ❌ | ❌ | |
| Shadow database | ❌ | ❌ | — | |
| Migration squashing | ❌ | ❌ | — | |
| Advisory locking / soft resets | ❌ | ❌ | — | |

## Migrations — columns & types

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| `createTable` | ✅ | ✅ | — | `test/integration/test/cli.migration-apply.e2e.test.ts`; `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`single table with PK`) |
| `createCollection` | — | — | ✅ | `test/integration/test/mongo/migration-authoring-e2e.test.ts` (`createCollection`) |
| `dropTable` | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/destructive.test.ts` (`drops a table removed from the contract`) |
| `dropCollection` | — | — | ✅ | `test/integration/test/mongo/migration-authoring-e2e.test.ts` (`dropCollection`) |
| `addColumn` | ✅ | ✅ | — | `test/integration/test/cli.db-update.e2e.test.ts`; `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`adds a new nullable column`) |
| `dropColumn` | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/destructive.test.ts` (`drops a column`) |
| `alterColumnType` | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/destructive.test.ts` (`changes a column type`) |
| `setNotNull` (nullability) | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/destructive.test.ts` (`tightens nullability (nullable to NOT NULL)`) |
| `dropNotNull` (nullability) | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/widening.test.ts` (`relaxes NOT NULL to nullable`) |
| `setDefault` | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/widening.test.ts` (`changes a column default`) |
| `dropDefault` | 🟡 | 🟡 | — | |
| Column change preserves data | ✅ | ✅ | — | `packages/3-targets/6-adapters/postgres/test/migrations/planner.reconciliation.integration.test.ts`; `test/e2e/framework/test/sqlite/migrations/destructive.test.ts` (`preserves data`) |
| Convert scalar column to array (Postgres) | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/native-array-columns.integration.test.ts` |
| JSON column + DB-level JSON default | ✅ | ✅ | — | `test/e2e/framework/test/dml.test.ts` (`typed jsonb/json`); `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`json survives insert and select`) |
| SQLite table rebuild (`recreateTable`) | — | ✅ | — | `test/e2e/framework/test/sqlite/migrations/widening.test.ts`; `test/e2e/framework/test/sqlite/migrations/fk-preservation.test.ts` |
| Descending index column ordering | ❌ | ❌ | — | |
| Partial index column ordering | ❌ | ❌ | — | |
| Opclass index column ordering | ❌ | ❌ | — | |

## Migrations — IDs, PKs & autoincrement

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| Single-column primary key | ✅ | ✅ | — | `test/integration/test/cli.migration-apply.e2e.test.ts`; `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`single table with PK`) |
| Compound primary key | 🟡 | 🟡 | — | |
| `addPrimaryKey` on existing table | 🟡 | 🟡 | — | |
| Integer autoincrement id | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`INTEGER PRIMARY KEY (auto-assigned rowid)`) |
| SQLite rebuild preserves indexes | — | ✅ | — | `test/e2e/framework/test/sqlite/migrations/fk-preservation.test.ts` (`preserves declared indexes`) |
| SQLite rebuild preserves uniques | — | ✅ | — | `test/e2e/framework/test/sqlite/migrations/fk-preservation.test.ts` (`preserves declared unique constraints`) |
| Change id column type | 🟡 | 🟡 | — | |

## Migrations — foreign keys

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| `addForeignKey` | ✅ | ✅ | — | `packages/3-targets/6-adapters/postgres/test/migrations/cross-namespace-fk.integration.test.ts`; `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`FK ON DELETE CASCADE`) |
| Referential action `cascade` | ✅ | ✅ | — | `test/integration/test/referential-actions.integration.test.ts` (`ON DELETE CASCADE removes child rows`); `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`FK ON DELETE CASCADE`) |
| Referential action `restrict` | ✅ | 🟡 | — | `test/integration/test/referential-actions.integration.test.ts` (`ON DELETE RESTRICT blocks parent deletion`) |
| Referential action `setNull` | ✅ | ✅ | — | `test/integration/test/referential-actions.integration.test.ts` (`ON DELETE SET NULL sets child FK to NULL`); `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`FK ON DELETE SET NULL`) |
| Referential action `setDefault` | ✅ | 🟡 | — | `test/integration/test/referential-actions.integration.test.ts` (`ON DELETE SET DEFAULT sets child FK to default value`) |
| Referential action `noAction` | 🟡 | 🟡 | — | |
| Cross-namespace / cross-space FK | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/cross-namespace-fk.integration.test.ts` |
| FK preserved through SQLite rebuild | — | ✅ | — | `test/e2e/framework/test/sqlite/migrations/fk-preservation.test.ts` |
| Drop FK | 🟡 | 🟡 | — | |
| Change FK | 🟡 | 🟡 | — | |
| Nullable↔required FK column | 🟡 | 🟡 | — | |
| Inline 1:1 FK gets a unique constraint | 🟡 | 🟡 | — | |
| Compound FK ordering | 🟡 | 🟡 | — | |
| Arbitrary-unique references | 🟡 | 🟡 | — | |

## Migrations — indexes & unique

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| `createIndex` | ✅ | ✅ | ✅ | `packages/3-targets/6-adapters/postgres/test/migrations/index-introspection.integration.test.ts`; `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`indexes`); `test/integration/test/mongo/migration-e2e.test.ts` (`applies createIndex and verifies the index exists`) |
| `dropIndex` | 🟡 | ✅ | ✅ | `test/e2e/framework/test/sqlite/migrations/destructive.test.ts` (`drops an index`); `test/integration/test/mongo/migration-e2e.test.ts` (`drops an index when the destination contract removes it`) |
| Replace index (drop old + create new) | 🟡 | ✅ | 🟡 | `test/e2e/framework/test/sqlite/migrations/destructive.test.ts` (`replaces an index`) |
| `addUnique` | 🟡 | ✅ | ✅ | `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`unique constraints`); `test/integration/test/mongo/migration-authoring-e2e.test.ts` (`creates a unique index`) |
| Composite unique | 🟡 | ✅ | 🟡 | `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`unique constraints`) |
| Index method `hash` | 🟡 | — | — | |
| Index method `BRIN` | 🟡 | — | — | |
| Index method `GIN` | 🟡 | — | — | |
| Index method `GiST` | 🟡 | — | — | |
| Index method `SP-GiST` | 🟡 | — | — | |
| Mongo index kind — unique | — | — | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` (`@@unique([name])`) |
| Mongo index kind — text | — | — | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` (`@@textIndex produces text index`) |
| Mongo index kind — wildcard | — | — | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` (`wildcard() produces wildcard index`) |
| Mongo index kind — geo | — | — | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` (`type: "2dsphere" produces 2dsphere index`) |
| Mongo index kind — hashed | — | — | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` (`type: "hashed" produces hashed index`) |
| Index rename to default | 🟡 | 🟡 | 🟡 | |
| Index rename to custom | 🟡 | 🟡 | 🟡 | |
| Descending index details | ❌ | ❌ | — | |
| Partial index details | ❌ | ❌ | (partial ignored) 🟡 | |
| Opclass index details | ❌ | ❌ | — | |

## Migrations — enums

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| `createNativeEnumType` | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/native-enum-lifecycle-e2e.integration.test.ts` (`create: CREATE TYPE is planned before the table, applies cleanly`) |
| `dropNativeEnumType` | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/native-enum-lifecycle-e2e.integration.test.ts` (`drop: DROP TYPE is planned after the dependent column is gone`) |
| `addNativeEnumValue` | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/native-enum-add-value.real-postgres.integration.test.ts` |
| Enum via CHECK constraint | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/enum-check-constraint.integration.test.ts` |
| Enum value-set change re-plans drop + recreate | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/enum-check-constraint.integration.test.ts` (`re-plans drop+recreate when enum members change`) |
| Enum authoring (Mongo) | — | — | 🟡 | |
| SQLite text-as-enum | — | 🟡 | — | |

## Migrations — defaults

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| Literal defaults migrated | ✅ | ✅ | — | `test/e2e/framework/test/dml.test.ts` (`applies literal defaults`); `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`default values`) |
| `now()` / current-timestamp default | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/widening.test.ts` (`round-trips a now() default`) |
| `uuid()` default (no drift) | ✅ | 🟡 | — | `packages/3-targets/6-adapters/postgres/test/migrations/planner.uuid.integration.test.ts` |
| Integer default (no drift) | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/default-drift.test.ts` (`verifies an integer @default(42) without drift`) |
| Change / drop default | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/widening.test.ts` (`changes a column default`) |
| Escaped-string default idempotency | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/widening.test.ts` (`round-trips a string default with an apostrophe`) |
| Postgres array / json / bigint defaults | 🟡 | — | — | |
| `dbgenerated(...)` defaults | 🟡 | 🟡 | — | |

## Migrations — native types

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| Create native `@db.*`-typed columns | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/native-array-columns.integration.test.ts` |
| Native array columns | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/native-array-columns.integration.test.ts` |
| SQLite rejects native `@db.*` types | — | 🟡 | — | |
| Safe type-change classification | ❌ | ❌ | — | |
| Risky type-change classification | ❌ | ❌ | — | |
| Not-castable type-change classification | ❌ | ❌ | — | |
| Extension-provided native types | ❌ | — | — | |
| citext native type | ❌ | — | — | |

## Migrations — extensions

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| `installExtension` | ✅ | — | — | `test/integration/test/extension-pgvector-scenario-a.e2e.integration.test.ts` |
| `createExtension` | 🟡 | — | — | |
| Extension version / schema / relocation management | ❌ | — | — | |
| Extension-type modifier diffing | ❌ | — | — | |

## Migrations — views

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| View entity (read-only models over DB views) | ❌ | ❌ | — | |
| Views excluded from migrations | ❌ | ❌ | — | |

## Migrations — existing-data safety

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| Static operation-class gating (additive/widening/destructive) | ✅ | ✅ | — | `test/integration/test/cli.db-update.e2e.test.ts` (`fails with DESTRUCTIVE_CHANGES`); `test/e2e/framework/test/sqlite/migrations/destructive.test.ts` |
| Required→optional column (safe) | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/widening.test.ts` (`relaxes NOT NULL to nullable`) |
| Empty-table-guarded NOT NULL / type tightening preserves data | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/destructive.test.ts` (`combined: drop column + change type + tighten nullability`) |
| Row-count-aware data-loss warnings | ❌ | ❌ | — | |
| Optional→required / added-required-without-default unexecutable diagnosis | ❌ | ❌ | — | |
| Adding-unique-that-data-violates warning | ❌ | ❌ | — | |
| `evaluateDataLoss` RPC | ❌ | ❌ | — | |

## Migrations — schema filters

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| `@@control(external)` policy | ✅ | 🟡 | ✅ | `test/integration/test/cli.control-policy.postgres.e2e.test.ts` (`external: zero DDL into namespace`); `test/integration/test/cli.control-policy.mongo.e2e.test.ts` |
| `@@control(tolerated)` policy | ✅ | 🟡 | 🟡 | `test/integration/test/cli.control-policy.postgres.e2e.test.ts` (`tolerated: preserves extra columns across update`) |
| `@@control(observed)` policy | ✅ | 🟡 | 🟡 | `test/integration/test/cli.control-policy.postgres.e2e.test.ts` |
| External tables incl. relations | 🟡 | 🟡 | — | |
| External tables incl. enums | 🟡 | 🟡 | — | |
| Drift detection with external tables | ✅ | 🟡 | ✅ | `test/integration/test/mongo/aggregate-e2e.test.ts` (`per-space verify isolates extension drift`) |
