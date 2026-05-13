# WS4 Multi-target Test Harness — Handoff

**Branch:** `ws4/multi-target-test-harness`
**Linear project:** https://linear.app/prisma-company/project/pn-may-ws4-multi-target-test-harness-ee1b4ec0a6ba
**Spec/plan:** `projects/multi-target-test-harness/{spec.md,plan.md}`

---

## What this branch does

Provides a three-layer test harness for running migration scenarios against multiple database targets (SQLite, Postgres, MongoDB) from a single test body.

```
L0  applyMigration(target, options, cb)     — generic, in @prisma-next/test-utils
L1  describeSqlMigration(name, body)        — SQL fan-out (SQLite + Postgres)
    describeMongoMigration(name, body)      — Mongo parallel shape
L2  sqliteTestTarget / postgresTestTarget   — concrete adapters (SQL)
    createMongoTestTarget({ uri })          — concrete adapter (Mongo)
```

---

## State of work

### M1 — infrastructure (🟡 mostly done)

All of these are landed:

- `TestTargetAdapter<TContract, TSchemaIR, TDriver, TPolicy>` interface + `applyMigration` core  
  `test/utils/src/migration-harness.ts`
- Concrete SQL adapters  
  `test/e2e/framework/test/migration-targets/{sqlite,postgres}.ts`
- L1 SQL fan-out helper with typed `before`/`after` DSL  
  `test/e2e/framework/test/migration-targets/sql-fanout.ts`
- Concrete Mongo adapter (see fix note below)  
  `test/integration/test/mongo/mongo-test-target.ts`
- L1 Mongo fan-out helper  
  `test/integration/test/mongo/mongo-fanout.ts`
- 35 existing SQLite migration tests migrated onto the new harness (no test-body changes)  
  `test/e2e/framework/test/sqlite/migrations/`
- Mongo spike tests (2 passing)  
  `test/integration/test/mongo/migration-fanout.spike.test.ts`

Two M1 items are **still pending** (documented in spec.md but not load-bearing for M3):

- Long-term home for concrete adapters — currently in test packages; see Open Questions in spec.md
- Workers dimension decision — carry-over from May planning; see Open Questions in spec.md

### M2 — ORM coverage (⬜ not started)

### M3 — migration scenario coverage (🔴 active priority, not started)

No M3 tests have been authored yet. The infrastructure is ready; the content is missing. See spec.md §M3 for the scenario list.

---

## Current test counts

```
SQL fan-out (additive, widening, destructive, default-drift):  57/60 passing
  3 Postgres failures — two tracked bugs, see below
Mongo spike:                                                    2/2 passing
Existing Mongo tests (mongo-spike, migration-e2e):             8/8 passing
```

---

## Bugs surfaced by the fan-out

### TML-2482 — numeric defaults authored as strings mismatch on Postgres

**Failing test:** `additive.test.ts > "creates a table with default values" — postgres`

Contract authors `.default('0')` (string) on an `int4` column. Postgres coerces `'0'` to `0` on storage; `parsePostgresDefault` returns the numeric `0`; `literalValuesEqual('0', 0)` is `false` (strict `===`). SQLite passes because it preserves the quoted literal through its normalizer.

Fix lives in schema verification (`verify-sql-schema.ts`) or the default normalizer — either coerce string numerics before comparison, or normalize them at introspection time. Related ticket TML-2107 (false `extra_default` on serial/identity columns in strict mode) is in the same general area.

### TML-2481 — `setDefault` skipped by value-blind idempotency probe

**Failing tests:**
- `widening.test.ts > "changes a column default" — postgres`
- `widening.test.ts > "round-trips a string default with an apostrophe" — postgres`

The Postgres runner's idempotency probe (runner.ts, runs before each op) checks whether postchecks are already satisfied. `setDefault`'s postcheck (`columnDefaultExistsCheck`) only checks `column_default IS NOT NULL` — it doesn't compare the value. When migrating from one default to another, the origin's default satisfies the postcheck, so the runner silently skips the `SET DEFAULT` op entirely. The planner emits the correct `ALTER TABLE … ALTER COLUMN … SET DEFAULT` SQL; it just never runs.

Fix is in the postcheck (`planner-sql-checks.ts:columnDefaultExistsCheck`) or in the runner's idempotency logic — either make the check value-aware, or suppress the probe specifically for `setDefault`. Related ticket TML-2135 (reconciliation planner needs dependency ordering) is in the same workstream; compound type+default changes rely on `setDefault` working correctly.

---

## Mongo adapter fix landed in this session

`test/integration/test/mongo/mongo-test-target.ts` had a pre-existing bug: `fromContract` was ignored — the planner always received `null`, and the runner plan omitted `origin.storageHash`. This broke multi-step migrations silently. Fixed in commit `f7847a8d6`.

The fix: plumb `fromContract` through to the planner call and conditionally include `origin: { storageHash: fromContract.storage.storageHash }` in the runner plan.

---

## `describeMongoMigration` design notes

The Mongo fan-out is parallel-but-separate from the SQL fan-out by design:

- SQL contracts use `field.column(descriptor)` where the descriptor is target-specific (e.g., `int4Column` vs `sqliteIntegerColumn`). Mongo fields are canonical (`field.objectId()`, `field.string()`), so there's no "column variation" to parameterize.
- Mongo has no typed query DSL (no `db.User.insert(...)` equivalent), so `before`/`after` callbacks receive the raw `MongoControlDriver` only, not a typed `db` builder.
- `MongoMemoryReplSet` startup is expensive (~60s). It's owned by `beforeAll`/`afterAll` inside each `describe` block; individual tests get a fresh database name via `createMongoTestTarget`.

One sharp edge: Mongo's planner does **not** emit a `createCollection` operation for models that have no indexes, validators, or options — those collections are implicitly created by MongoDB on the first insert. If a test uses a vanilla-collection origin (fields only, no indexes), `target.introspect()` after the origin apply will return an empty schema, and the verifier will report `missing_table`. Workaround: add at least one index to any origin model. This may warrant a separate planner ticket.

---

## Key files

| File | What it is |
|---|---|
| `test/utils/src/migration-harness.ts` | L0 generic harness — `TestTargetAdapter` interface + `applyMigration` |
| `test/e2e/framework/test/migration-targets/sql-fanout.ts` | L1 SQL fan-out — `describeSqlMigration`, typed `db` DSL, target registry |
| `test/e2e/framework/test/migration-targets/sqlite.ts` | SQLite concrete adapter |
| `test/e2e/framework/test/migration-targets/postgres.ts` | Postgres concrete adapter |
| `test/integration/test/mongo/mongo-fanout.ts` | L1 Mongo fan-out — `describeMongoMigration`, raw driver only |
| `test/integration/test/mongo/mongo-test-target.ts` | Mongo concrete adapter (fromContract fixed) |
| `test/e2e/framework/test/sqlite/migrations/` | 35 migrated tests (4 fanned, rest SQLite-only) |
| `test/integration/test/mongo/migration-fanout.spike.test.ts` | 2 Mongo spike tests |

---

## Related Linear tickets

| Ticket | What | Status |
|---|---|---|
| TML-2482 | Numeric string defaults mismatch on Postgres after introspection | Open, ready to fix |
| TML-2481 | `setDefault` silently skipped by value-blind idempotency probe | Open, ready to fix |
| TML-2107 | False `extra_default` on serial/identity columns in strict mode | Open; related to TML-2482 area |
| TML-2135 | Reconciliation planner needs dependency ordering | Open; related to TML-2481 (compound type+default) |
| TML-2108 | Primary key mismatch — needs rewrite | Operation builders now exist for the "missing" case; DROP+ADD reconciliation still missing; ticket is outdated |

---

## Immediate next steps for M3

1. Author SQL migration scenario tests using `describeSqlMigration`:
   - Add model, add field, add relation, drop model, rename field
   - Each test runs against both SQLite and Postgres automatically
   - Expected: the two open Postgres failures above will surface in the "change default" scenarios until TML-2481 / TML-2482 are fixed
2. Author parallel Mongo migration scenarios using `describeMongoMigration` for the same operations
3. Manual migrations — scaffold + apply on each target
4. Data migrations — on each target

The L1 API is stable; M3 is purely about writing test content. See spec.md §M3 for the full acceptance criteria.
