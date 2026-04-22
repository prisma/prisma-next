# rsc-poc-postgres

Next.js 16 App Router proof-of-concept for **Prisma Next runtime behavior
under RSC concurrent rendering**. Paired with `rsc-poc-mongo`; together they
cover VP3 of the WS3 runtime-pipeline milestone (Linear: [TML-2164][t]).

See `projects/rsc-concurrency-safety/plan.md` for the full project plan,
including hypotheses H1–H5 and acceptance criteria.

[t]: https://linear.app/prisma-company/issue/TML-2164/rsc-concurrency-safety-poc

## What this app exists to probe

The runtime (`RuntimeCoreImpl`) has mutable `verified` / `startupVerified`
flags, and the ORM client lazily populates a `Collection` cache. React
Server Components render concurrently within a single request, all sharing
one runtime instance. This app forces that configuration and instruments it
so we can observe what happens.

Specifically, this Postgres app targets:

- **H2** — Redundant marker reads on cold start under concurrent first-use
  (`onFirstUse` / `startup` modes). Bug (wasted roundtrips), not a
  correctness violation.
- **H3** — Skipped verification under concurrency when
  `verify.mode === 'always'`. Real correctness bug; reproduced on the
  `/stress/always` route.
- **H4** — pg pool pressure when component count exceeds pool size.
  Characterized by the `pool-pressure` k6 scenario, not fixed.

The companion `rsc-poc-mongo` app is a baseline — the Mongo runtime and ORM
have none of these hazards by construction, so comparing the two
**localizes** the SQL-stack issues.

## Status

Five parallel Server Components and one Server Action are implemented and
verified end-to-end against a local Postgres. The `/stress/always` route,
k6 scripts, and the H3 integration test land in subsequent PRs. See the
project plan for the work breakdown.

## Prerequisites

- Node.js ≥ 24 (see root `package.json` `engines.node`)
- pnpm (see root `package.json` `packageManager`)
- A Postgres 14+ instance with the `vector` extension available. The
  easiest path is the `pgvector/pgvector:pg17` Docker image:

  ```sh
  docker run --rm -d --name rsc-poc-pg -p 5432:5432 \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rsc_poc \
    pgvector/pgvector:pg17
  ```

- [k6](https://k6.io/) for running the stress scripts (install via
  `brew install k6` on macOS). Not needed for `pnpm dev`.

## Getting started

```sh
cp .env.example .env          # then edit DATABASE_URL if needed
pnpm install                  # from the repo root
pnpm --filter rsc-poc-postgres emit    # generate contract.json + contract.d.ts
pnpm --filter rsc-poc-postgres db:init # apply schema + marker
pnpm --filter rsc-poc-postgres seed    # populate sample data
pnpm --filter rsc-poc-postgres dev     # start Next.js on :3000
```

Open http://localhost:3000 and watch the diagnostics panel at the bottom
of the page for marker-read and connection-acquire counters.

## Routes

| Route             | Purpose                                              | Verify mode   |
|-------------------|------------------------------------------------------|---------------|
| `/`                      | Five parallel Server Components (varied shapes).        | `onFirstUse`              |
| `/stress/always`         | Same page, pinned to `always` mode to probe H3.         | `always`                  |
| `/stress/pool-pressure`  | Same page, pinned to `poolMax: 5` to probe H4.          | `onFirstUse` (poolMax=5)  |
| `/diag`                  | JSON snapshot of in-process counters.                   | —                         |

All four routes are live.

## The five Server Components

Rendered in parallel on `/`, each wrapped in its own `<Suspense>` so one
slow component doesn't block the others:

1. **`<TopUsers />`** — ORM `orderBy(...).take(10).all()`. Baseline ORM
   read path.
2. **`<PostsWithAuthors />`** — ORM `include('user', ...)`. Exercises the
   multi-query include dispatch path in `sql-orm-client`.
3. **`<RecentPostsRaw />`** — SQL DSL via `db.sql.post...build()` +
   `db.runtime().execute(plan)`. Only path that goes through
   `runtime.execute()` rather than `acquireRuntimeScope()` — the most
   direct way to exercise `verifyPlanIfNeeded()`.
4. **`<UserKindBreakdown />`** — ORM `groupBy().having().aggregate()`.
   Aggregate dispatch path.
5. **`<SimilarPostsSample />`** — pgvector similarity search via ORM.
   Exercises an extension-contributed operator (`cosineDistance`) on the
   shared runtime.

Plus **`<CreatePostForm />`** (client component) + `createPostAction`
(Server Action) — one smoke-level mutation to confirm reads and writes
can coexist on the shared runtime. Not exercised by k6; test by hand from
the browser.

## Observed behavior

Numbers below come from single runs on a local pgvector/pg17 container;
they're illustrative, not benchmarks.

### Cold start (any route, first request)

```
markerReads: 5, connectionAcquires: 11, connectionReleases: 11
```

Five marker reads for five parallel components on cold start **confirms
hypothesis H2** — each of the five concurrent components raced through
`verifyPlanIfNeeded()` before any of them flipped `verified` to true.
Subsequent requests show `markerReads: 5` remaining constant (the
`onFirstUse` contract holds after first flip).

### Baseline — `/` @ 10 VUs × 30s (`onFirstUse`, `poolMax: 10`)

```
iterations:     8,850 over 30s (~295 req/s)
markerReads Δ:  0          # runtime already warm
acquires Δ:     53,100     # 6 per request × 8,850
releases Δ:     53,100     # balanced
pool final:     10 total / 10 idle / 0 waiting
errors:         0
```

### Spike — `/stress/always` @ 50 VUs × 30s (`always`, `poolMax: 10`)

```
iterations:     ~240 over 30s (~8 req/s)
markerReads Δ:  266        # every execute verifies, as always-mode promises
acquires Δ:     447
releases Δ:     447        # balanced
pool final:     10 total / 10 idle / 0 waiting
pg timeouts:    thousands  # expected under this pressure on poolMax=10
```

Throughput collapses relative to baseline because every query carries an
extra marker-read round-trip in `always` mode — this is the whole point
of `always`. The invariant `acquiresΔ == releasesΔ` **holds** under the
predicted race window for H3; the integration test in the next PR pins
it more precisely.

### Pool pressure — `/stress/pool-pressure` ramp 1→100 VUs × 50s (`onFirstUse`, `poolMax: 5`)

```
iterations:     15,571 over 50s (~311 req/s)
markerReads Δ:  5          # cold start for this route's own runtime
acquires Δ:     93,431
releases Δ:     93,431     # still balanced at 100 VUs on poolMax: 5
pg timeouts:    0          # with fast queries, queue drains in time
```

With the PoC's tiny seed dataset, queries return fast enough that a
5-slot pool sustains 100 VUs without timeouts. Larger payloads, higher
query latency, or higher RSC per-page concurrency would change the
picture — this is the sizing observation H4 is about, not a safety bug.

### One counter bug found by running this

An earlier revision counted pool acquires *before* `super.connect()`
resolved. Under the spike scenario, `pg`'s `connectionTimeoutMillis`
rejected ~1,100 connects, so acquires outran releases by that delta.
Fixed by counting only on successful resolve. The `'release'` event
fires unconditionally from `pg-pool`'s `_release()` regardless of
what's happening inside `client.release()`, so that path was already
robust. See the comment block in `src/lib/pool.ts` for the gory details.

## Tests

```sh
# skips the whole suite — ppg-dev rejects concurrent connections, so the
# H2/H3 invariant tests need a real Postgres
pnpm --filter rsc-poc-postgres test

# runs the suite against a pgvector-capable Postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/rsc_poc \
  pnpm --filter rsc-poc-postgres test
```

Start a local Postgres (pgvector-enabled) once:

```sh
docker run --rm -d --name rsc-poc-pg -p 5434:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rsc_poc \
  pgvector/pgvector:pg17
```

The test suite (`test/always-mode-invariant.test.ts`) pins:

- **H2** — `onFirstUse` cold-start: K concurrent queries issue **1 to K**
  marker reads on first burst, then 0 on subsequent bursts.
- **H3** (revised) — `always` mode: K concurrent queries issue **exactly
  K** marker reads, regardless of concurrency. Covered for K ∈ {1, 5, 50}
  and across repeated bursts.
- **Balance** — `connectionAcquires === connectionReleases` in all
  scenarios.

Each test drops and recreates `public` + `prisma_contract` schemas before
running, so order-independence is guaranteed but concurrent `pnpm test`
runs against the same `DATABASE_URL` will corrupt each other. Vitest is
configured with `maxWorkers: 1` to serialize naturally.

Without `DATABASE_URL`, the whole `describe` is skipped (CI-friendly —
no Postgres service needed for `test:examples`). The source-level
reasoning in `projects/rsc-concurrency-safety/plan.md §2` is the primary
argument for H3; this test is the pin.

## Stress scripts

```sh
pnpm stress:baseline        # 10 VUs × 30s against /
pnpm stress:spike           # 50 VUs × 30s against /stress/always (H3)
pnpm stress:pool-pressure   # ramp 1 → 100 VUs with small pool (H4)
```

Each scenario writes a JSON summary next to the script for posterity.

## How the singleton works

`src/lib/db.ts` pins the runtime to `globalThis` via a `Symbol.for(...)`
key. This survives Next.js dev-mode HMR (module re-evaluation would
otherwise leak a new `pg.Pool` on every edit within seconds). In
production, there is no HMR — the pattern collapses to a regular
module-level singleton per Node process.

Each unique `(verifyMode, poolMax)` combination gets its own entry in the
registry, so `/` and `/stress/always` never share a runtime. They are
probing different hypotheses and must not contaminate each other's
counters.

## How the diagnostics work

`src/lib/pool.ts` defines `InstrumentedPool`, a subclass of `pg.Pool`.
Subclassing (not wrapping) is deliberate: `@prisma-next/postgres`'s
`resolvePostgresBinding()` uses `instanceof PgPool` to decide whether to
route the input into the `pgPool` binding branch. A composition wrapper
would fail that check.

`InstrumentedPool` overrides `connect()` to:

1. Count pool connection acquires.
2. Instrument the acquired `PoolClient` in place so that:
   - `client.query(sql, ...)` matches `sql` against the stable marker-read
     fragment (`prisma_contract.marker`) and bumps the marker-read counter
     if it's a verification query.
   - `client.release()` bumps the release counter.

Counters live in `src/lib/diag.ts`, also pinned to `globalThis` so they
survive HMR. The `<DiagPanel />` Server Component reads a snapshot and
renders it at page bottom.

## Layout

```
app/                 Next.js App Router entrypoints
  layout.tsx         Root layout
  page.tsx           Home (five parallel RSC — WIP)
  globals.css        Minimal dark theme
prisma/
  schema.prisma      PSL schema (reused from prisma-next-demo)
src/
  components/
    diag-panel.tsx   Server Component that renders counter snapshots
  lib/
    db.ts            globalThis-scoped runtime singleton
    diag.ts          In-process counter registry
    pool.ts          Instrumented pg.Pool subclass
  prisma/
    contract.json    Generated (gitignored by convention? see below)
    contract.d.ts    Generated
scripts/
  drop-db.ts         Reset schema
  seed.ts            Populate sample data
  stress.k6.js       k6 stress scenarios (WIP)
test/                Integration tests (WIP)
prisma-next.config.ts
next.config.js
package.json
tsconfig.json
```

Contract artifacts (`contract.json`, `contract.d.ts`) are committed
alongside the source — the plan's stop condition requires the app to run
out of the box after `pnpm install && pnpm emit`.

## Related

- Project plan: `projects/rsc-concurrency-safety/plan.md`
- Framework integration analysis §"Hard problem 2":
  `docs/reference/framework-integration-analysis.md`
- Companion Mongo app: `examples/rsc-poc-mongo/` (planned)