# Live PG + EQL + ZeroKMS e2e harness

This directory hosts the live-Postgres + EQL bundle + ZeroKMS end-to-end harness for the cipherstash-integration example app. Seven `*.e2e.test.ts` files cover one codec or scenario each:

- `num.e2e.test.ts` — `EncryptedDouble` round-trip; `Gt`/`Gte`/`Lt`/`Lte`/`Between`/`Asc`/`Desc`.
- `bigint.e2e.test.ts` — `EncryptedBigInt` round-trip; equality + range + sort.
- `date.e2e.test.ts` — `EncryptedDate` round-trip; date range + sort.
- `bool.e2e.test.ts` — `EncryptedBoolean` round-trip; `Eq` / `Ne` / `InArray`.
- `json.e2e.test.ts` — `EncryptedJson` round-trip + `cipherstashJsonbPathQueryFirst` / `cipherstashJsonbGet` SELECT-expression helpers. The `cipherstashJsonbPathExists` predicate clause is skipped per the known limitation tracked at [TML-2504](https://linear.app/prisma-company/issue/TML-2504).
- `str-range.e2e.test.ts` — `EncryptedString({ orderAndRange: true })` supports `Gt` + `Asc` + `Ilike` coexistence.
- `mixed.e2e.test.ts` — mixed-codec query issues the minimum SDK round-trips (one per `(table, column)`).

## Local setup

```bash
pnpm --filter cipherstash-integration-example test:e2e
```

The harness's Vitest global setup (`global-setup.ts`):

1. `docker compose up -d` and waits for `pg_isready`.
2. Sets `DATABASE_URL` to the harness's local Postgres URL.
3. Runs `prisma-next migration apply` against the example app (installs the cipherstash baseline migration + the `users` table).
4. Skips cleanly (logging the missing env var) when `CS_WORKSPACE_CRN` / `CS_CLIENT_ID` / `CS_CLIENT_KEY` / `CS_DEFAULT_KEY_ID` are unset, so PRs without secrets configured don't fail the suite.

`vitest.config.ts` wires the global setup, scopes the run to `*.e2e.test.ts`, and pins `pool: 'threads'` + `maxWorkers: 1` + `isolate: false` + `fileParallelism: false` so every test file shares one Postgres connection and one CipherStash SDK encryption client (and the SDK isn't asked to run encrypts across files concurrently). Each test file truncates `users` in its `beforeAll` for clean-slate isolation.

## Container

The `docker-compose.yml` runs `postgres:16-alpine` on host port `54329` (non-standard to dodge a developer's locally installed Postgres on `5432`). `tmpfs` data volume so every boot starts from an empty cluster. Container name `cipherstash-e2e-postgres` avoids colliding with the workspace-root `docker-compose.yaml` (port `5433`, used by the framework's own e2e suite).

## Known limitations covered by skips

- **`cipherstashJsonbPathExists` predicate clause.** The EQL bundle's `jsonb_path_exists` function expects a hashed STE-VEC selector computed client-side by the CipherStash SDK's `selector(...)` API; the framework currently binds the JSONpath as a plain `pg/text@1` `ParamRef`. Predicate queries return zero rows. Tracked at [TML-2504](https://linear.app/prisma-company/issue/TML-2504); the round-trip and the two SELECT-expression helpers work correctly against the same column.
- **`EncryptedBigInt` capped at `Number.MAX_SAFE_INTEGER`.** `@cipherstash/stack`'s SDK and ZeroKMS only accept `JsPlaintext = string | number | boolean | object | array` for plaintexts (no `bigint`); the example app's SDK adapter at `src/sdk.ts` converts `bigint → Number` with an eager `Number.MAX_SAFE_INTEGER` bounds check. Values beyond the safe-integer range cannot be encrypted today.

## EQL bundle quoted-identifier workaround

`eql_v2.add_encrypted_constraint(table, column)` interpolates `%I` for both the constraint-name prefix **and** the (already double-quoted) identifier suffix, producing invalid SQL like `CONSTRAINT eql_v2_encrypted_constraint_"users"_"accountId"` whenever either name needs quoting (mixed case, reserved word, etc.).

Worked around in the example schema by `@map`-ing `accountId` → `accountid` and `emailVerified` → `emailverified` (matching the existing `@@map("users")` workaround for the reserved-word case). File upstream + drop the workaround when the bundle is fixed.
