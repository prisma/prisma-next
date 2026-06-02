# Brief: `@prisma-next/test-utils` extension + integration tests

## Task

Two changes that ship together:

1. **`test/utils/src/exports/index.ts`** — extend the `DevDatabase` interface with a required `ppgUrl: string` field. Populate it in `createDevDatabase` from `server.ppg.url` through the same `normalizeConnectionString` helper that handles `server.database.connectionString`.

2. **`packages/3-extensions/prisma-postgres-serverless/test/prisma-postgres-serverless.integration.test.ts`** — new file with **6–8 integration tests** that round-trip real SQL through the new facade against `@prisma/dev`'s in-process PPG endpoint:
   - SELECT round-trip (create table + insert + select-back, assert shape + values).
   - INSERT round-trip with rowCount (using `runtime().connection().query(...)` for raw SQL).
   - Transaction commit (open `transaction(fn)`, insert inside, commit, assert row persists).
   - Transaction rollback (open transaction, insert, throw, assert row absent).
   - `acquireConnection` lifecycle (acquire, run two queries, release; verify same session via observable behaviour).
   - Connection-level error normalisation (issue constraint-violating query, assert `SqlQueryError` with PPG's sqlState preserved).

No mocking. Real facade → real driver → real PPG protocol → real PGlite-backed PostgreSQL.

Full spec at `projects/ppg-serverless/slices/06-integration-tests-and-docs/spec.md`. Re-read it.

## Scope

**In:**

- `test/utils/src/exports/index.ts` — one field addition to `DevDatabase`, one line in `createDevDatabase`.
- `packages/3-extensions/prisma-postgres-serverless/test/prisma-postgres-serverless.integration.test.ts` — new file.
- (Possibly) `packages/3-extensions/prisma-postgres-serverless/package.json` — add `@prisma-next/test-utils: workspace:0.12.0` to `devDependencies` if it's not already there (postgres facade has it; mirror).

**Out:**

- README updates — D2 in this slice.
- `./config` / `./contract-builder` substantive impls — stay as stubs.
- Touching the facade's runtime code, the driver code, adapters, target packs, framework.
- Adding a separate `pnpm test:integration` command. Integration tests run inline via `pnpm test:packages`.
- ADR / docs/architecture updates.

## Completed when

1. `pnpm --filter @prisma-next/test-utils typecheck` exits 0.
2. `pnpm --filter @prisma-next/test-utils build` exits 0.
3. `pnpm --filter @prisma-next/prisma-postgres-serverless test` exits 0. Existing Slice-5 tests still pass (regression baseline) plus 6–8 new integration tests pass against real PPG.
4. `pnpm test:packages` workspace-wide exits 0. (AC-6 final check; this is the workspace-wide regression baseline.)
5. `pnpm lint:deps` exits 0.
6. `pnpm --filter @prisma-next/test-utils lint` and `pnpm --filter @prisma-next/prisma-postgres-serverless lint` exit 0.
7. **No transient project IDs** in source (canonical regex on +diff returns empty); manual prose-attribution sweep empty.
8. **No bare `as` casts** in production / test code added this dispatch.
9. Total integration-test file runtime is **< 2 minutes wallclock** (single file, all tests). If slower, surface.

## Standing instruction

Stay focused on the goal; control scope. The `test-utils` change is small; the bulk of this dispatch is the integration tests.

**Source-string rule:** the integration test file's `describe()` / `it()` titles and error messages are source-shipping content — no transient project IDs.

## References

- **Slice spec:** [`projects/ppg-serverless/slices/06-integration-tests-and-docs/spec.md`](../spec.md) — design + edge cases.
- **Slice plan:** [`projects/ppg-serverless/slices/06-integration-tests-and-docs/plan.md`](../plan.md) — sizing rationale + D1's expanded outcome description.
- **Existing test-utils:** [`test/utils/src/exports/index.ts`](../../../../../test/utils/src/exports/index.ts) — `DevDatabase`, `createDevDatabase`, `withDevDatabase`, `normalizeConnectionString`.
- **`@prisma/dev` `server.ppg.url`:** `node_modules/.pnpm/@prisma+dev@*/node_modules/@prisma/dev/dist/state-CDXGsSbm.d.ts` — `exportsSchema.ppg.url`.
- **The facade runtime under test:** [`packages/3-extensions/prisma-postgres-serverless/src/runtime/prisma-postgres-serverless.ts`](../../../../../packages/3-extensions/prisma-postgres-serverless/src/runtime/prisma-postgres-serverless.ts) (Slice 5).
- **Reference integration tests** (model the patterns): the postgres facade doesn't have a real-PG integration test (it uses pg-mem); look at any `*.integration.test.ts` in `test/integration/` for the `withDevDatabase` pattern. Or [`packages/3-targets/7-drivers/postgres/test/driver.prepared.integration.test.ts`](../../../../../packages/3-targets/7-drivers/postgres/test/driver.prepared.integration.test.ts) for a real-PG-via-`@prisma/dev` pattern.
- **`@prisma-next/sql-runtime`'s `Runtime.connection()`:** [`packages/2-sql/4-lanes/sql-runtime/src/`](../../../../../packages/2-sql/4-lanes/sql-runtime/src/) — the escape hatch for raw SQL. The facade's `runtime()` returns this Runtime; `runtime.connection()` returns a `SqlConnection` with `.query(sql, params)` etc.

**Calibration:**

- [`drive/calibration/failure-modes.md § F5`](../../../../drive/calibration/failure-modes.md#f5-destructive-git-operations-executed-by-subagents-without-orchestrator-approval) — no destructive git ops.
- [`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md) — standing forbids.

## Edge cases

| Edge case | Disposition |
|---|---|
| **`server.ppg.url` shape vs `server.database.connectionString` shape.** Both are URLs; both may have `localhost`/`::1` issues. | Normalize through the same `normalizeConnectionString` helper. |
| **`runtime().connection()` for raw DDL.** The integration test creates a table via raw SQL before the SQL-builder-driven SELECT. | Use `const conn = await runtime.connection(); await conn.query('CREATE TABLE ...'); await conn.release();`. The connection holds one PPG session for the DDL lifetime. |
| **`@prisma/dev` server startup latency** is ~200-500ms per test. 6–8 tests × 500ms ≈ 3-4 seconds setup overhead. Plus query runtime. | Acceptable. Total file runtime should land <30s; the 2-minute ceiling is the halt condition. |
| **Transaction rollback assertion**: the row must be ABSENT after rollback. Verify via a fresh query. | `await transaction(async (tx) => { await tx.connection().query('INSERT ...'); throw new Error('rollback'); }).catch(() => undefined); /* assert row absent via a separate query */`. The `withTransaction` semantic in `@prisma-next/sql-runtime` rolls back on thrown errors. |
| **PPG returns `Resultset` with `columns: []` for DDL** (`CREATE TABLE`, etc.). | OK — `rows.collect()` returns `[]`; rowCount via `runtime.connection().query(...)` is whatever PPG/PGlite reports. The tests don't need to inspect DDL results; just that the table exists for subsequent inserts. |
| **`SqlQueryError.sqlState` after constraint violation.** PostgreSQL returns sqlState `23505` for unique-violation. The driver normaliser (Slice 2) preserves this. | The integration test asserts `error instanceof SqlQueryError && error.sqlState === '23505'` after a unique-violation. |
| **`devDependencies` for the facade.** The facade may not currently list `@prisma-next/test-utils` (Slice 4 scaffold didn't add it explicitly). Check; add if missing. | Mirrors postgres facade's devDeps. |
| **Destructive git ops forbidden** (F5). |  |

## Operational metadata

- **Model tier:** Recommended: Sonnet (real integration test composition + workspace-wide regression check; design is settled but the test surface is new code).
- **Time-box:** 90 minutes wall-clock. Overrun → halt and surface.
- **Halt conditions:**
  - `server.ppg.url` doesn't materialise — read the actual `server` object at runtime; surface.
  - Workspace `pnpm test:packages` reveals unrelated regression — root-cause before continuing.
  - Test wants facade feature not exposed — surface; that's Slice 5 follow-up territory.
  - Total integration-test runtime exceeds 5 minutes — test scope is wrong; surface.

## Commit organisation

Suggested:

- **Two commits**: (1) test-utils extension (1-line API addition); (2) integration tests. Lets the reviewer verify the test-utils change is minimal in commit 1 before evaluating the substantial integration tests in commit 2.
- **Single commit** also acceptable if you prefer.

Surface your choice in the wrap-up.

**No `git add -A`.** **No `--amend`.** **No push** (single PR at project close-out).
