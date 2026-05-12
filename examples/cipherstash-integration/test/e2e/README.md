# Live PG + EQL + ZeroKMS e2e harness (scaffold)

This directory will host the live-Postgres + EQL bundle + ZeroKMS
end-to-end harness covering the seven `AC-E2E-*` acceptance criteria
from the cipherstash-integration project-2 spec
(`AC-E2E-NUM` / `BIGINT` / `DATE` / `BOOL` / `JSON` / `STR-RANGE` /
`MIXED`).

## Status

**Scaffolded; not yet executable end-to-end.**

The Docker-based Postgres + EQL bundle pieces below are in place and
verified to apply cleanly. The actual test files are blocked on a
runtime middleware lifecycle issue surfaced while wiring the harness
— see "Blocker" below.

## What's here

- `docker-compose.yml` — single-service `postgres:16-alpine` on host
  port `54329` (non-standard to dodge a developer's locally installed
  Postgres on `5432`). `tmpfs` data volume so every boot starts from
  an empty cluster. Container name `cipherstash-e2e-postgres` to
  avoid colliding with the workspace-root `docker-compose.yaml`
  (port `5433`, used by the framework's own e2e suite).

## What's verified

1. `docker compose up -d` with this file produces a reachable
   Postgres 16 cluster (`pg_isready` passes within ~3 s).
2. With `DATABASE_URL=postgres://cipherstash:cipherstash@localhost:54329/cipherstash_e2e`,
   `prisma-next migration apply` against the example app applies
   cleanly: the cipherstash baseline migration installs the EQL
   bundle (eql-2.2.1) and the app migration creates `users`. The
   `eql_v2_configuration` table ends up populated with active
   search-config entries for every column.
3. `docker compose down` tears the container down cleanly.

## Blocker (out of harness scope)

Runtime middleware lifecycle ordering means the
`bulkEncryptMiddleware.beforeExecute` hook runs **after** `lower()`
has already encoded params, but the cipherstash codec's
`encode(envelope)` reads `handle.ciphertext` which is filled in by
that very middleware. Result: every write through the example app
fails with

> Failed to encode parameter <X> with codec 'cipherstash/<codec>@1':
> cipherstash codec: envelope has no ciphertext at encode time.

Reference points:

- `packages/2-sql/5-runtime/src/sql-runtime.ts` —
  `executeAgainstQueryable` does
  `runBeforeCompile -> lower(encode) -> runWithMiddleware(beforeExecute)`.
- `packages/1-framework/1-core/framework-components/src/execution/run-with-middleware.ts`
  — `beforeExecute` chain runs immediately before `runDriver()`,
  after `lower()`.
- `packages/3-extensions/cipherstash/src/middleware/bulk-encrypt.ts` —
  middleware design assumes pre-encode invocation.
- `packages/3-extensions/cipherstash/src/execution/cell-codec-factory.ts`
  — `encode()` throws if `handle.ciphertext === undefined`.

The unit tests in `bulk-encrypt-middleware.test.ts` pass because they
drive the middleware directly against a synthesized `InsertAst` /
`UpdateAst` rather than going through the runtime; the runtime path
isn't covered.

This needs a framework-runtime fix (either run cipherstash-aware
`beforeExecute` before `lower`, or restructure the codec so encode
emits a placeholder and the middleware mutates wire-form bytes).
Filing under TML follow-up; out of scope for the harness round.

## Also discovered: EQL bundle camelCase bug

Independently surfaced while bringing the schema online:

`eql_v2.add_encrypted_constraint(table, column)` interpolates `%I`
for both the constraint-name prefix **and** the (already
double-quoted) identifier suffix, producing invalid SQL like
`CONSTRAINT eql_v2_encrypted_constraint_"users"_"accountId"` whenever
either name needs quoting (mixed case, reserved word, etc.).

Worked around in the example schema by `@map`-ing `accountId` →
`accountid` and `emailVerified` → `emailverified` (matching the
existing `@@map("users")` workaround for the reserved-word case).
File upstream + drop the workaround when the bundle is fixed.

## Resuming the harness

When the runtime-middleware blocker is resolved, this directory
should grow:

- `setup.ts` — Vitest global-setup that:
  1. `docker compose up -d` and waits for `pg_isready`.
  2. Sets `DATABASE_URL` to the harness's PG URL (overriding the
     example app's `.env`).
  3. Runs `prisma-next migration apply`.
  4. Skips cleanly (logging the missing env var) when
     `CS_WORKSPACE_CRN` is unset, so PRs without secrets configured
     don't fail the suite.
- `vitest.config.ts` — wires `setup.ts` and scopes to `*.e2e.test.ts`.
- One `<ac>.e2e.test.ts` per acceptance criterion, building on the
  example app's `db` + `createCipherstashSdk()`.

The bare-column `ORDER BY` D8 bet (cipherstashAsc/Desc) gets
verified the first time `AC-E2E-NUM` runs end-to-end; if it breaks,
the documented fallback is `eql_v2.order_by_<index>(col)` wrapping
in `src/execution/helpers.ts`.
