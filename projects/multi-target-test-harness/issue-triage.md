# Issue triage — failures surfaced by SQL fan-out

When the 27 portable SQLite migration tests were fanned out across SQLite + Postgres (54 test runs), 3 ran red — all on Postgres only, all `default_mismatch` during schema verification. They split into two distinct underlying bugs in the Postgres family path.

Run command: `pnpm --filter @prisma-next/e2e-tests test test/sqlite/migrations`
Result: 57 passed, 3 failed.

## Bug A — integer default normalizer round-trip

**Test:** `additive.test.ts > "creates a table with default values" — postgres`

**Verifier output:**
```
[SCHEMA_VERIFY_FAILED] Database schema does not satisfy contract (7 failures)
  - Column "Setting"."priority"  expected literal(0), got 0
  - Column "Setting"."is_active" expected literal(1), got 1
```

**Contract:**
```ts
priority: field.column(integerColumn).default('0'),
isActive: field.column(integerColumn).default('1').column('is_active'),
```

**What's happening:** the contract authors `'0'` (a string-shaped literal) for an integer column. SQLite's `parseSqliteDefault` canonicalises that and the introspected default round-trips to `literal(0)` (a numeric literal). Postgres' `parsePostgresDefault` does not — it returns the bare `0` text from `pg_get_expr` without normalising back into a `ColumnDefault.Literal`, so the verifier sees `actual: "0"` (string) ≠ `expected: literal(0)`.

**Likely fix location:** `packages/3-targets/3-targets/postgres/src/core/default-normalizer.ts` — `parsePostgresDefault` needs the same numeric-literal normalisation that `parseSqliteDefault` already implements (parse-as-number when value is in the safe-integer range, see `default-drift.test.ts` for the SQLite precedent).

**Severity:** medium. Real-world contracts using integer defaults can't migrate cleanly on Postgres. Workaround is `.default(0)` (numeric, not string), which is correct usage anyway, but the asymmetry between SQLite (forgiving) and Postgres (strict) is a bug.

## Bug B — widening planner missing change-default

**Tests:**
- `widening.test.ts > "changes a column default" — postgres`
- `widening.test.ts > "round-trips a string default with an apostrophe" — postgres`

**Verifier output (Test #1):**
```
[SCHEMA_VERIFY_FAILED] Database schema does not satisfy contract (5 failures)
  - Column "Setting"."status"   expected literal(active), got 'draft'::text
```

**Verifier output (Test #2):**
```
- Column "User"."nickname"  expected literal(It's), got 'old'::text
```

**What's happening:** Both tests apply an origin contract with one default, then a destination contract with a different default, under `policy: { allowedOperationClasses: ['additive', 'widening'] }`. After the migration:

- The runner reports `ok: true` (no failure surfaced).
- The introspected schema still shows the **origin** default (`'draft'::text`, `'old'::text`) — the change-default operation never ran.
- `verifySqlSchema` catches the drift.

So Postgres' widening planner is silently missing the "change column default" diff. SQLite handles this via recreate-table (whole table is rebuilt with new defaults). Postgres should be emitting an `ALTER TABLE … ALTER COLUMN … SET DEFAULT …` op classified as widening.

**Likely fix location:** `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` (or wherever the widening pass lives) — the diff between origin and destination default values for an existing column needs to produce a `ChangeColumnDefault` op when the defaults differ.

**Severity:** high — silent migration data loss-of-intent. The runner reports success, but the schema doesn't match the contract. Verification catches it here only because the test re-introspects and re-verifies; in production usage, a user might not notice until someone inserts a row and gets the old default value.

**Note:** the same scenarios pass on SQLite because SQLite's recreate-table strategy rewrites the whole table from the destination contract — defaults are part of that rewrite.

## Tests we did NOT fan out (and why)

- `fk-preservation.test.ts` (8 tests) — these specifically exercise SQLite's recreate-table strategy (`expect(plannedOperationIds).toContain('recreateTable.User')` etc.). Postgres doesn't recreate tables for FK preservation; it uses `ALTER` directly. The tests are inherently SQLite-specific.
- `additive.test.ts > "creates a table with INTEGER PRIMARY KEY (auto-assigned rowid)"` — kept SQLite-only. Tests rowid auto-increment behavior, which isn't a Postgres concept (Postgres needs `SERIAL` / `IDENTITY` for that, and `int4Column` doesn't add either).
- `widening.test.ts > "round-trips a now() default through apply + introspect without drift"` — kept SQLite-only. Tests `parseSqliteDefault` canonicalising `datetime('now')` ↔ `now()`. The Postgres equivalent is structurally different (canonical form is just `now()`).

## Status

Bugs A and B are open. They were surfaced by the harness on first run — exactly the M1 → M3 forcing-function the project is meant to provide. No code changes proposed in this doc; the issues should land in their owning workstreams (WS1 / WS3).
