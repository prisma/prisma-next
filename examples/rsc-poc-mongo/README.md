# rsc-poc-mongo

Next.js 16 App Router proof-of-concept for **Prisma Next Mongo runtime
behavior under RSC concurrent rendering**. Paired with `rsc-poc-postgres`;
together they cover VP3 of the WS3 runtime-pipeline milestone (Linear:
[TML-2164][t]).

See `projects/rsc-concurrency-safety/plan.md` for the full project plan,
including hypotheses H1–H5 and acceptance criteria.

[t]: https://linear.app/prisma-company/issue/TML-2164/rsc-concurrency-safety-poc

## What this app exists to probe

The Postgres app probes hypotheses H1 (ORM Collection cache race), H2
(redundant cold-start marker reads under `onFirstUse`), H3 (per-query
verification under `always`), and H4 (pool pressure). This Mongo app is
the **baseline** that makes the Postgres-side findings stand out as
SQL-runtime-specific rather than inherent to Prisma Next's architecture.

Specifically:

- **`MongoRuntimeImpl` has no verification state.** No `verified` flag,
  no `startupVerified`, no marker reads. Nothing for H2 or H3 to
  manifest as — that's **hypothesis H5** in the project plan.

- **`mongoOrm()` eagerly builds all collections at init time.** No
  lazy-cache race to worry about, so H1 has no Mongo analogue either.

- **The Mongo driver's connection pool is fundamentally different** from
  pg's. `MongoClient` multiplexes commands over a small number of wire
  connections rather than borrowing a connection per query. The pool
  pressure observations on this side are not directly comparable to the
  Postgres ones, and that contrast is useful in its own right.

The Mongo app's deliverables are therefore:

- Five parallel Server Components (same conceptual shape as the
  Postgres app) to confirm RSC concurrent rendering works cleanly on
  the Mongo side.
- A `/stress/pool-pressure` route for H4-adjacent observations with a
  small `maxPoolSize`.
- Diagnostic counters that are **different from the Postgres side by
  design** — no `markerReads`, no `verifyMode`.
- A test suite that pins **"no H2/H3 analogue exists"** as an
  invariant, so a future change that accidentally introduces
  verification on the Mongo runtime would fail the test.

## Status

Five parallel Server Components, one Server Action, `/stress/pool-pressure`
route, k6 scripts, and the concurrency invariant test suite are all
implemented and verified end-to-end against both a local MongoDB and
`mongodb-memory-server` in CI.

## Prerequisites

- Node.js ≥ 24 (see root `package.json` `engines.node`)
- pnpm (see root `package.json` `packageManager`)
- A MongoDB 6+ instance. The PoC uses plain commands with no
  transactions, so a standalone `mongo:7` container is sufficient:

  ```sh
  docker run --rm -d --name rsc-poc-mongo -p 27020:27017 mongo:7
  ```

- [k6](https://k6.io/) for running the stress scripts (install via
  `brew install k6` on macOS). Not needed for `pnpm dev`.

## Getting started

```sh
cp .env.example .env                # then edit DB_URL if needed
pnpm install                        # from the repo root
pnpm --filter rsc-poc-mongo emit    # generate contract.json + contract.d.ts
pnpm --filter rsc-poc-mongo seed    # populate sample data
pnpm --filter rsc-poc-mongo dev     # start Next.js on :3000
```

Open http://localhost:3000 and watch the diagnostics panel at the bottom
of the page for command and connection counters.

## Routes

| Route                    | Purpose                                                 | Pool                   |
|--------------------------|---------------------------------------------------------|------------------------|
| `/`                      | Five parallel Server Components (varied shapes).        | `maxPoolSize: 100`     |
| `/stress/pool-pressure`  | Same page, pinned to `maxPoolSize: 5` to probe H4.      | `maxPoolSize: 5`       |
| `/diag`                  | JSON snapshot of in-process counters.                   | —                      |

All three routes are live. There is no `/stress/always` analogue because
`MongoRuntimeImpl` has no `verifyMode` dimension — that's the point of
this app.

## The five Server Components

Rendered in parallel on `/`, each wrapped in its own `<Suspense>` so one
slow component doesn't block the others:

1. **`<ProductList />`** — ORM `orderBy(...).take(10).all()`. Baseline
   ORM read path, equivalent to the Postgres app's `<TopUsers />`.
2. **`<OrdersWithUser />`** — ORM `include('user').take(5).all()`.
   Exercises the multi-query include dispatch. Equivalent to
   `<PostsWithAuthors />` on the Postgres side.
3. **`<ProductsBySearch />`** — `db.query.from('products').match(...)`
   pipeline via `runtime.execute(plan)`. Drops to the query-builder
   path, equivalent to `<RecentPostsRaw />`.
4. **`<EventTypeStats />`** — `db.query.from('events').group(...)`
   aggregate pipeline. Equivalent to `<UserKindBreakdown />`.
5. **`<SearchEvents />`** — ORM `events.variant('SearchEvent').all()`.
   Exercises the polymorphism discriminator path; no direct analogue
   on the Postgres side (polymorphism is modeled differently there).

Plus **`<CreateEventForm />`** (client component) + `createEventAction`
(Server Action) — one smoke-level mutation (inserting a `SearchEvent`)
to confirm reads and writes can coexist on the shared Mongo runtime.
Not exercised by k6; test by hand from the browser.

## Observed behavior

Numbers below come from single runs against a local `mongo:7` container;
they're illustrative, not benchmarks.

### Cold start (`/`, first request)

```
commandsStarted: 5, commandsSucceeded: 5, commandsFailed: 0
connectionsCheckedOut: 5, connectionsCheckedIn: 5
connectionsCreated: 4, connectionsClosed: 0
```

**Exactly 5 commands** for 5 parallel Server Components — one per
component. No per-command verification round-trip, no marker reads.
**This is what makes the contrast with the Postgres app's H2 behavior
observable**: on Postgres, the same cold-start page showed 5 marker
reads *in addition to* the 5 data queries. On Mongo, there's just the
5 data queries. H5 confirmed.

### Baseline — `/` @ 10 VUs × 30s (`maxPoolSize: 100`)

```
iterations:     14,003 over 30s (~467 req/s)
commandsΔ:      70,015      # exactly 5 × iterations — no multiplier
failedΔ:        0
checkOutsΔ:     70,015
checkInsΔ:      70,015      # balanced
tcpCreatedΔ:    0           # pool already warm; connections reused
```

Compared to the Postgres baseline (8,850 iters @ ~295 req/s, 53,100
acquires = 6 per request), the Mongo app is ~60% faster and does fewer
operations per page. The "6 vs 5" difference per request is the marker
read the Postgres runtime issues that the Mongo runtime doesn't.

### Pool pressure — `/stress/pool-pressure` ramp 1→100 VUs × 50s (`maxPoolSize: 5`)

```
iterations:     17,503 over 50s (~350 req/s)
commandsΔ:      87,515      # exactly 5 × iterations
failedΔ:        0           # no waitQueueTimeoutMS breaches
checkOutsΔ:     87,515
checkInsΔ:      87,515      # still balanced at 100 VUs on maxPoolSize: 5
tcpCreatedΔ:    1           # pool grew to max during ramp
```

With the PoC's tiny dataset, the Mongo driver sustains 100 VUs on a
5-slot pool without timeouts. Commands multiplex over the connections
rather than queueing for distinct ones — a useful contrast to the
Postgres model where each query exclusively holds a pool connection for
its lifetime.

## Stress scripts

```sh
pnpm stress:baseline        # 10 VUs × 30s against /
pnpm stress:pool-pressure   # ramp 1 → 100 VUs with small pool
```

There is no `spike` scenario on the Mongo side. On the Postgres side,
`spike` hits `/stress/always` to exercise the `always`-mode invariant.
No such mode exists on the Mongo runtime, so the scenario has nothing
to stress.

## How the singleton works

`src/lib/db.ts` pins the Mongo runtime to `globalThis` via a
`Symbol.for(...)` key. Same pattern as the Postgres app: survives
Next.js dev-mode HMR in development; in production it collapses to a
regular module-level singleton per Node process.

Each unique `poolMax` gets its own entry in the registry, so `/` (pool
default) and `/stress/pool-pressure` (pool 5) never share a runtime or
a MongoClient.

`getDb()` is async on the Mongo side (unlike the Postgres app's
synchronous `getDb()`) because constructing a MongoClient requires
awaiting `client.connect()` before the runtime can serve requests.
Server Components that call this suspend on the first request and
resolve from the cached entry thereafter.

## How the diagnostics work

Unlike the Postgres app, there's no `InstrumentedPool` subclass. The
Mongo driver owns its connection pool inside `MongoClient` and that
class isn't designed to be subclassed. Instead, we attach listeners for
the documented `CMAP` (connection monitoring) and `APM` (command
monitoring) events **before** `client.connect()`:

- `commandStarted` / `commandSucceeded` / `commandFailed` — one MongoDB
  command per event. The Mongo analogue of a pg query.
- `connectionCheckedOut` / `connectionCheckedIn` — a pool connection
  borrowed for the duration of a command.
- `connectionCreated` / `connectionClosed` — underlying TCP connections
  opened and closed.

Listeners push counts into `src/lib/diag.ts` (`globalThis`-backed, same
pattern as the Postgres app's diag). The `<DiagPanel />` Server
Component reads a snapshot at page bottom; `/diag` exposes the same data
as JSON.

Deliberately **no marker-reads counter** — the Mongo runtime doesn't
issue them, and a counter that's always zero muddles the contrast with
the Postgres side. Omitting it keeps the snapshot shape honest.

## Tests

```sh
pnpm --filter rsc-poc-mongo test
```

Unlike the Postgres invariant test (which requires `DATABASE_URL`
because `@prisma/dev` rejects concurrent connections), the Mongo tests
run standalone via `mongodb-memory-server`. No external database is
needed; CI runs them as-is.

The test suite (`test/concurrency-invariants.test.ts`) pins:

- **H5 (no marker reads)** — K concurrent queries issue **exactly K**
  commands through the runtime, with no verification multiplier.
  Covered for K ∈ {1, 5, 50} plus a cold-start burst case.
- **Balance invariants** — `connectionsCheckedOut === connectionsCheckedIn`
  across single queries, cold bursts, default-pool contention, and
  small-pool contention (K=50 on `maxPoolSize: 5`).
- **Cumulative invariants** — repeated bursts keep the per-command
  accounting linear: K × BURSTS commands, balanced check-outs/ins.

If a future change accidentally introduces a verification round-trip on
the Mongo runtime, the "exactly K commands" assertion fails immediately
and makes the regression visible.

## Layout

```
app/                           Next.js App Router entrypoints
  layout.tsx                   Root layout
  page.tsx                     Home (five parallel RSC, default pool)
  globals.css                  Minimal dark theme
  actions.ts                   Server Action: createEventAction
  diag/route.ts                /diag JSON handler
  stress/pool-pressure/page.tsx
prisma/
  contract.prisma              PSL schema (reused from retail-store)
src/
  components/
    create-event-form.tsx      Client: Server Action form
    diag-panel.tsx             Server Component: counter snapshot
    parallel-reads-page.tsx    Shared body for / and /stress/pool-pressure
  lib/
    db.ts                      globalThis-scoped Mongo runtime singleton
    diag.ts                    In-process counter registry
  prisma/
    contract.json              Generated
    contract.d.ts              Generated
  server-components/
    event-type-stats.tsx
    orders-with-user.tsx
    product-list.tsx
    products-by-search.tsx
    search-events.tsx
scripts/
  seed.ts                      Populate sample data
  stress.k6.js                 k6 stress scenarios (baseline, pool-pressure)
test/
  concurrency-invariants.test.ts
prisma-next.config.ts
next.config.js
package.json
tsconfig.json
vitest.config.ts
```

## Related

- Project plan: `projects/rsc-concurrency-safety/plan.md`
- Framework integration analysis §"Hard problem 2":
  `docs/reference/framework-integration-analysis.md`
- Companion Postgres app: `examples/rsc-poc-postgres/`
