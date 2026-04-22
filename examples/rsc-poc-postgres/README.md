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

**Scaffold only.** The five parallel Server Components, `/stress/always`
route, Server Action, k6 scripts, and integration test land in subsequent
PRs. See the project plan for the work breakdown.

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
| `/`               | Five parallel Server Components (varied shapes).     | `onFirstUse`  |
| `/stress/always`  | Same page, pinned to `always` mode to reproduce H3.  | `always`      |

Additional routes arrive in later PRs; this table is the planned surface.

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