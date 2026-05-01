# AC verification — `cloudflare-hyperdrive-runtime`

> Transient project artifact. Pulled from `projects/cloudflare-hyperdrive-runtime/reviews/code-review.md § Acceptance criteria scoreboard` at HEAD `74c8a7ce0` (m4 R1 Stream A SATISFIED). Useful for the close-out PR description; **dies at close-out** when `projects/cloudflare-hyperdrive-runtime/` is removed.
>
> Compiled by the orchestrator under m4 task 4.3, after the reviewer's m4 R1 verdict. Each row's evidence is preserved verbatim from the scoreboard so a reader of the close-out PR can audit on-disk without consulting the reviewer's log.

## Summary

- **Total ACs**: 20
- **PASS**: 19
- **FAIL**: 0
- **NOT VERIFIED**: 1 (AC-12 — `wrangler deploy` smoke; m4 Stream B, blocked on Cloudflare account access; orchestrator-tracked stop condition for unattended mode per `wip/unattended-decisions.md`)

The PR is review-clean for everything that does not require Cloudflare account credentials. AC-12 lands when a maker with a Cloudflare account + Hyperdrive entitlement runs `wrangler deploy` against `examples/prisma-next-cloudflare-worker` and verifies the SQL DSL / ORM / transaction routes serve real responses (TC-15).

## Acceptance criteria scoreboard

### Facade surface & types

- **AC-1** (m2) — PASS. Type narrowing: `postgresServerless<Contract>(...)` exposes `sql`/`context`/`stack`/`contract`/`connect` and rejects `orm`/`runtime`/`transaction` at the type level.
  - Evidence: `packages/3-extensions/postgres/test/postgres-serverless.types.test-d.ts` lines 15-45 (type test) + `packages/3-extensions/postgres/test/postgres-serverless.test.ts` lines 109-126 (runtime probe). Commit `a5114b8b7`.
- **AC-2** (m2) — PASS. `db.connect({ url })` returns `Runtime & AsyncDisposable`; multiple calls return distinct runtime instances (no closure cache).
  - Evidence: `postgres-serverless.test.ts` lines 181-203, 205-215, 217-224. Commit `a5114b8b7`.

### Workers compatibility

- **AC-3** (m3) — PASS. Workers compatibility: facade boots in workerd under `nodejs_compat`.
  - Evidence: `examples/prisma-next-cloudflare-worker/test/worker.integration.test.ts` lines 12-16 (`/health` boots under `vitest-pool-workers` with `compatibilityFlags: ['nodejs_compat']`). Commit `699d82283`.
- **AC-4** (m3) — PASS. SQL DSL plan execution + ORM-client query + `withTransaction(runtime, ...)` all execute against Hyperdrive in `wrangler dev`.
  - Evidence: `worker.integration.test.ts` lines 18-25 (SQL DSL), 27-33 (ORM), 35-42 (ORM relation traversal), 44-57 (transaction commit). Exercises `runtime.execute(...)`, `createOrmClient(runtime).<...>.all()`, and `withTransaction(runtime, ...)` against the local Docker Postgres origin.

### Lifecycle

- **AC-5** (m2/m3) — PASS. One `pg.Client` per `connect()`; `runtime.close()` called once on `Symbol.asyncDispose`.
  - Evidence: m2 unit tests `postgres-serverless.test.ts` lines 138-156, 205-215, 217-224 pin construct/connect/dispose counts; m3 integration confirms end-to-end under workerd (8/8 integration tests pass). The "calls `client.end()` exactly once" sub-clause routes through `runtime.close()` and is delegated to existing driver tests.
- **AC-6** (m3) — PASS (m3 R2). `pg-cursor` reachable; large-result early-`break` closes cursor without materializing remaining rows.
  - Evidence: `global-setup.ts` lines 131-142 seeds 10 000 posts; `worker.ts` lines 97-157 raises `LIMIT` to 10 000, derives `cancelled` from real for-await break state, and emits `rowsTransmitted` from a `pg_stat_statements`-driven side-channel query. `worker.integration.test.ts` lines 79-105 asserts `body.rowsTransmitted < 500` — the bound fails decisively if cursor is disabled (would record ~10 000). Bidirectional sanity check documented in commit `a41a3542d`.
- **AC-7** (m2) — PASS. No `pg.Pool` constructed on the serverless path.
  - Evidence: `postgres-serverless.ts` line 27 imports only `Client` from `pg`; tests at `postgres-serverless.test.ts` lines 128-136, 138-156, 226-234. Commit `a5114b8b7`.

### Symmetry & non-regression

- **AC-8** (m2) — PASS. Existing `postgres()` Node-facade input variants continue to work; existing tests pass unchanged.
  - Evidence: `git diff 46df63d20..HEAD -- packages/3-extensions/postgres/src/runtime/postgres.ts packages/3-extensions/postgres/src/runtime/binding.ts` is empty; existing 27-case `postgres.test.ts` suite passes.
- **AC-9** (m2) — PASS. `postgresServerless({ contractJson, extensions, middleware })` mirrors `postgres({ contractJson, extensions, middleware })` exactly.
  - Evidence: `postgres-serverless.types.test-d.ts` lines 62-84 — structural `toEqualTypeOf` comparison over `Pick<...>` of `contract`/`contractJson`/`extensions`/`middleware`/`verify`.

### Transactions

- **AC-10** (m3) — PASS. Multi-statement transaction (INSERT + UPDATE) commits atomically; rolls back on thrown error.
  - Evidence: `worker.integration.test.ts` lines 44-57 (commit; verified by re-reading user's `displayName`), 59-77 (rollback; throws inside body, asserts the pre-throw write did not persist). Exercises `withTransaction(runtime, ...)` against the local Postgres origin.
- **AC-11** (m3) — PASS. Failed transaction body leaves `pg.Client` in `end()`-able state.
  - Evidence: `worker.integration.test.ts` lines 59-77 — `/tx/rollback`'s `await using runtime` disposes the underlying client cleanly after the throw; the next test (lines 88-91) issues a follow-up request through a fresh `connect()` without observing a leak. m2 unit test `runtime is AsyncDisposable and disposes via close()` pins the dispose mechanism itself.

### Example & docs

- **AC-12** (m4) — **NOT VERIFIED** — m4 Stream B (Cloudflare access). `wrangler deploy` of `examples/prisma-next-cloudflare-worker` against a real Cloudflare account + Hyperdrive entitlement + Postgres origin. Out of m4 R1 unattended scope; orchestrator-tracked stop condition. Logged in `wip/unattended-decisions.md` (entry 3 — final stop). Lands when a maker with the credentials runs the smoke (TC-15).
- **AC-13** (m3) — PASS. Example README sufficient to bootstrap from scratch.
  - Evidence: [`examples/prisma-next-cloudflare-worker/README.md`](../../../examples/prisma-next-cloudflare-worker/README.md) (158 lines). Prerequisites, one-time bootstrap, per-session bring-up, `wrangler dev`, deploy, bundle-size + cold-start measurement, troubleshooting, known limitations. Documents Docker Postgres on port 5433 + `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` env-var path.
- **AC-14** (m4) — PASS (m4 R1). Deployment guide published under `docs/`.
  - Evidence: [`docs/Serverless Deployment Guide.md`](../../../docs/Serverless%20Deployment%20Guide.md) (286 lines, commit `74c8a7ce0`). Six FR7 sections: two-facades comparison + ADR 207 cross-link; Cloudflare Workers + Hyperdrive worked example (architecture, setup, worker code shape, ORM-client wiring, cursor streaming); generality table for other per-request runtimes; migrations-stay-on-Node story with Hyperdrive-DDL rationale; known limitations (transaction affinity, isolate memory, cursor default asymmetry, static `pg-pool` import, Node-only migrations); validation pointer to the example's vitest-pool-workers suite. Linked from `docs/README.md` under a new "Deploying" section. Zero `projects/` references — close-out clean. All relative links resolve.

### Architecture & quality

- **AC-15** (m2/m3/m4) — PASS (m3 R2 + re-verified m4 R1). `pnpm lint:deps` exit 0; "no dependency violations found (699 modules, 1384 dependencies cruised)".
- **AC-16** (m2/m3/m4) — PASS (m3 R2). `pnpm test:packages` 109/109 tasks succeed on m3 R2 HEAD (full turbo cache hit). Postgres package: 50/50 tests (15 serverless + 27 postgres + 8 config). m4 R1 docs-only commits do not invalidate the cache; gate stable.
- **AC-17** (m2) — PASS — facade construction + lifecycle. 15 unit tests in `postgres-serverless.test.ts` + 7 type tests in `postgres-serverless.types.test-d.ts`. ORM/transaction "threading" is covered by absence-tests (orm/runtime/transaction unreachable on the facade); end-to-end ORM/`withTransaction` wiring through the returned runtime is an m3 integration concern.
- **AC-18** (m3) — PASS (m3 R2). `vitest-pool-workers` integration test wired into CI.
  - Evidence: `vitest.config.ts` lines 17-20 soft-fails when env is unset; `globalSetup` lines 51-55 emits actionable error with `pnpm db:up && cp .env.example .env` hint. [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) lines 89-128 sets `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` on the `test` job and runs `pnpm --filter prisma-next-cloudflare-worker db:up` before `pnpm test:examples`. Commit `5f282018d`.

### Performance & footprint

- **AC-19** (m3) — PASS. Worker bundle < 1 MB compressed.
  - Evidence: [`examples/prisma-next-cloudflare-worker/README.md`](../../../examples/prisma-next-cloudflare-worker/README.md) lines 99-109 — `wrangler deploy --dry-run --outdir dist` reports "Total Upload: 1289.96 KiB / gzip: 254.14 KiB". 254 KiB compressed vs 1 MB AC-19 budget.
- **AC-20** (m3) — PASS (best-effort, m3). Cold-start `findMany({ take: 10 })` p50 < 200 ms.
  - Evidence: [`examples/prisma-next-cloudflare-worker/README.md`](../../../examples/prisma-next-cloudflare-worker/README.md) lines 111-120 — `wrangler dev` benchmark (`/orm/users?limit=10`): cold-start ~35 ms, warm p50 ~13 ms. Both inside the 200 ms ceiling. README correctly notes that production Hyperdrive cold-start may be slower; re-measure during m4 Stream B deployment validation.

## Outstanding for m4 Stream B

Stream B lands when a maker with a Cloudflare account + Hyperdrive entitlement + Postgres origin runs:

1. `wrangler hyperdrive create` against a real Postgres origin (PPg / Neon / RDS / Supabase) and updates `examples/prisma-next-cloudflare-worker/wrangler.jsonc` with the printed binding ID.
2. `wrangler deploy` of the example, then `curl` against each route (`/sql/users`, `/orm/users`, `/orm/posts`, `/tx/commit`, `/tx/rollback`, `/cursor/large`).
3. Records the outcomes (response shapes, latencies vs the local benchmark, any production-only surprises) in this doc as **AC-12 PASS** evidence, and re-measures **AC-20** against real-Hyperdrive cold-start.
4. Then 4.5 (migrate long-lived docs into `docs/` — only the audit doc remains; this AC-verification doc is consumed by the close-out PR description and dies with `projects/`), 4.6 (strip repo-wide refs to `projects/cloudflare-hyperdrive-runtime/`), and 4.7 (delete `projects/cloudflare-hyperdrive-runtime/`).
