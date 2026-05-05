# Summary

Make Prisma Next deployable on **serverless / per-request Postgres runtimes** by shipping a sibling `postgresServerless` facade alongside the existing `postgres()` factory. Cloudflare Workers + Hyperdrive is the primary tested target and primary documented path, but the facade is generic across runtimes whose lifecycle is per-invocation rather than long-lived (Workers, Vercel Edge/Serverless, AWS Lambda Node, Deno Deploy, Bun edge). The deliverable is the new facade, an end-to-end Cloudflare Worker example using it against a Hyperdrive-fronted Postgres, and a documented deployment guide.

# Description

Prisma Postgres (PPg) currently has no production-ready TCP connection pooling. The pre-existing pooling/caching surface (Accelerate) is incompatible with Prisma Next. To dogfood Prisma Next + PPg in serverless apps deployed on Cloudflare, we need a supported path that pools connections at the edge.

Cloudflare Hyperdrive provides exactly that: a Cloudflare-managed PgBouncer-equivalent that terminates the standard Postgres wire protocol at the edge, pools connections to the origin database, and exposes a configured connection string to the Worker via `env.HYPERDRIVE.connectionString`. Hyperdrive supports any Postgres-compatible origin (PPg, AWS RDS, Neon, etc.).

The original framing of this task was "build a Hyperdrive driver". On investigation that framing was misleading: Hyperdrive is not a separate protocol or transport — it is the standard Postgres wire protocol terminated at Cloudflare's edge. A Worker connects to it with `pg` using `env.HYPERDRIVE.connectionString`. **The actual gap is per-request lifecycle ergonomics**, not transport. The M1 audit confirmed `pg` + `pg-cursor` work under `nodejs_compat`; the existing `PostgresDirectDriverImpl` (`pgClient` binding kind) already implements the per-request lifecycle Hyperdrive needs (lazy `client.connect()`, no `pg.Pool`, explicit `client.end()`, mutex-serialized `acquireConnection` for transaction affinity). What's missing is a wrapper-level facade that:

1. Exposes only the static authoring surface at module scope (`sql`, `context`, `stack`, `contract`) — no closure-cached `orm` / `runtime()` / `transaction` (those bake in long-lived-process assumptions that are unsafe in per-request runtimes: stale connections across isolate idle periods, concurrent-query foot-guns on a shared `pg.Client`, no clean shutdown).
2. Returns a fresh `Runtime` per `connect(binding)` call — no closure cache, race-safe under concurrent `fetch` invocations.
3. Surfaces `[Symbol.asyncDispose]` on the Runtime so per-request teardown is `using`-syntax-clean.

The facade is **runtime-environment-shaped, not Cloudflare-product-shaped**. The user provides their own connection string from whatever env var their platform exposes (`env.HYPERDRIVE.connectionString` on Workers, `process.env.DATABASE_URL` on Lambda, etc.). This project ships and tests the Cloudflare Workers + Hyperdrive path end-to-end; deployment to other per-request runtimes follows from the same facade with no further code changes.

- **Users:** developers building per-request / serverless apps that want Prisma Next against Postgres. Cloudflare Workers + Hyperdrive is the primary tested + documented path, with PPg as the recommended origin; AWS Lambda / Vercel / Deno / Bun users are supported by the same facade without bespoke work.
- **Problems to solve:**
  1. Ship a `postgresServerless` facade with the lifecycle-correct surface (no closure-cached convenience methods, fresh runtime per connect, `using`-friendly disposal).
  2. Verify the PN runtime closure and `pg`/`pg-cursor` work under Cloudflare Workers' `nodejs_compat` (M1 audit complete; result: yes).
  3. Ship a working Cloudflare Worker example (`examples/`) that exercises the facade end-to-end against a Hyperdrive-fronted Postgres, with `vitest-pool-workers` CI integration.
  4. Document the deployment story in `docs/`, with Cloudflare Workers + Hyperdrive as the primary worked example.

# Requirements

## Functional Requirements

### FR1 — `postgresServerless` facade

A new wrapper facade `postgresServerless` is exported alongside the existing `postgres()` factory. Construction shape mirrors the existing facade for symmetry across the two:

```ts
const db = postgresServerless<Contract>({
  contractJson,
  extensions: [...],
  middleware: [...],
});
```

The returned client exposes **only** the static authoring surface:

- `db.sql` — `Db<TContract>` plan-builder (context-bound, runtime-free).
- `db.context` — `ExecutionContext<TContract>`.
- `db.stack` — `SqlExecutionStackWithDriver<'postgres'>`.
- `db.contract` — the validated contract (handy for lint integrations / type narrowing).
- `db.connect(binding) → Promise<Runtime>` — request-scoped runtime acquisition (see FR3).

The returned client deliberately does **not** expose `orm`, `runtime()`, or `transaction()`. Those convenience surfaces depend on a long-lived closure-cached runtime, which is unsafe in per-request runtimes (stale connections across isolate idle periods, concurrent-query foot-guns on a shared `pg.Client`, no clean shutdown). Per-request runtime users construct ORM / transactions from the runtime returned by `db.connect()`, mirroring the existing `examples/prisma-next-demo`'s ORM-client pattern (which already threads `runtime` explicitly).

### FR2 — Connection-string-only binding input

`postgresServerless().connect()` accepts a single binding shape:

```ts
db.connect({ url: string }) // typically: env.HYPERDRIVE.connectionString, or any other URL the user sources
```

No `hyperdrive: env.HYPERDRIVE` ergonomic; no `pg: Client | Pool` variant. The facade is runtime-environment-shaped, not Cloudflare-product-shaped — Hyperdrive is one origin among many, and on Cloudflare its `connectionString` is the value users pass. Users source the URL from whatever env var their platform exposes (`env.HYPERDRIVE.connectionString` on Workers, `process.env.DATABASE_URL` on Lambda, etc.).

### FR3 — Per-request lifecycle

`db.connect(binding)` returns a fresh `Runtime` per call:

- No closure cache. Multiple concurrent `fetch` invocations within one isolate get independent runtimes, race-safe.
- Each runtime constructs its own `pg.Client` via `new Client({ connectionString })` and routes through the existing `PostgresDirectDriverImpl` (`pgClient` `PostgresBinding` kind). No `pg.Pool` allocated. No driver-layer code changes — the audit confirmed the existing `pgClient` path already implements the lifecycle Hyperdrive (and any per-request runtime) needs.
- The returned `Runtime` exposes `[Symbol.asyncDispose]` so `await using runtime = await db.connect(...)` cleans up the underlying client on scope exit.
- `pg-cursor` enabled by default (the audit confirmed it works under `nodejs_compat` in workerd, including open / read-batches / early-`break` cancellation). Users can opt out via the wrapper's `cursor` option per parity with the Node facade.

### FR4 — Transactions

The returned `Runtime` supports the existing `withTransaction` helper from `@prisma-next/sql-runtime`. Transactions running through `postgresServerless` honor the existing semantics: BEGIN/COMMIT/ROLLBACK, multi-statement transactions sharing the underlying `pg.Client`, proper teardown on `fetch` end. Hyperdrive maintains transaction affinity within a single client connection.

### FR5 — Working end-to-end Cloudflare Worker example

A new example under `examples/` (working name: `prisma-next-cloudflare-worker`) demonstrating `postgresServerless` against Hyperdrive:

- Deployable Cloudflare Worker (`wrangler.jsonc` with `nodejs_compat`).
- Defines a `prisma-next.config.ts` and emits a contract.
- `wrangler hyperdrive create`-provisioned binding configured (with `localConnectionString` for `wrangler dev`).
- `fetch` handler running a representative SQL DSL query, an ORM client query (using `createOrmClient(runtime)` per the existing demo's pattern), and a transaction.
- README documenting setup (env vars, `wrangler hyperdrive create`, dev vs. prod).

### FR6 — Migrations remain a Node concern

Migrations (control plane) continue to run from Node via the existing `@prisma-next/driver-postgres/control` driver against the **origin** database connection string (not Hyperdrive). Hyperdrive's caching/pooling makes it a poor fit for DDL. No control-plane Hyperdrive driver in this project.

### FR7 — Documentation

A new doc under `docs/` (path TBD with docs team — likely `docs/products/` or `docs/onboarding/`) titled "Deploying Prisma Next to serverless runtimes" or similar, covering:

- The lifecycle distinction between long-lived (`postgres()`) and per-request (`postgresServerless()`) facades, with rationale for the asymmetry.
- Cloudflare Workers + Hyperdrive as the primary worked example: architecture (Worker → Hyperdrive → origin Postgres), setup steps (PPg/Postgres origin, `wrangler hyperdrive create`, `wrangler.jsonc` binding, `localConnectionString`), Worker code shape.
- Generality: `postgresServerless` works on any per-request runtime with a Postgres URL (Lambda, Vercel, Deno, Bun) — short pointer for each.
- Migration story (run from Node, not from the per-request runtime).
- Known limitations (transaction affinity within one underlying connection, isolate memory limits, etc.).

## Non-Functional Requirements

### NFR1 — No regressions for the Node deployment

All existing Node-based usages of `@prisma-next/postgres` continue to work unchanged. Existing tests pass without modification.

### NFR2 — Architectural integrity

Changes respect the layering rules in `architecture.config.json` and `pnpm lint:deps` continues to pass. Driver changes respect [ADR 159](docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md) (driver lifecycle) and [ADR 155](docs/architecture%20docs/adrs/ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md) (driver/codec boundary).

### NFR3 — Bundle size discipline

The Worker bundle for the example app stays under a reasonable size limit (target: < 1 MB compressed). We measure the bundle size as a baseline and call out the largest contributors so future work can shrink them.

**Assumption:** 1 MB is a conservative ceiling that fits well within Cloudflare's free-tier 3 MB limit and 10 MB paid limit. We refine after measurement.

### NFR4 — Cold-start latency

Worker cold-start (first request after deploy or after isolate eviction) target: under 200 ms for a simple `findMany({ take: 10 })` against a warm Hyperdrive pool.

**Assumption:** This target is informed by typical Workers cold-start budgets (~50ms isolate boot + driver setup). May need to be relaxed once measured.

### NFR5 — Test coverage

- Unit tests for the new wrapper input variant and any new driver code paths.
- An integration test for the Worker example using `wrangler dev` (or `vitest-pool-workers` / miniflare) against a local Postgres, exercising at least: simple query, ORM query, transaction, error path.
- Existing Node test suites continue to pass.

## Non-goals

- **Tested examples or CI integration on non-Cloudflare runtimes.** The `postgresServerless` facade is generic across per-request runtimes by design, but only the Cloudflare Workers + Hyperdrive path is tested and exemplified in this project. AWS Lambda / Vercel Edge / Vercel Serverless / Deno Deploy / Bun support follows from the same facade with no further code changes; the deployment guide acknowledges them but does not ship worked examples or CI for them.
- **Convenience surface (`orm` / `runtime()` / `transaction`) on the serverless facade.** Deliberately omitted (see FR1). The asymmetry with the existing `postgres()` facade is a feature: it forces users to acknowledge their environment's lifecycle and prevents the closure-cache foot-guns that would otherwise surface in production.
- **Dropping the convenience surface from the Node `postgres()` facade.** Out of scope; Node's long-lived process makes the closure-cached `db.orm` / `db.runtime()` / `db.transaction()` safe and useful. They stay.
- **AsyncLocalStorage-based per-request convenience surface.** Considered and rejected during shaping. Forces transitively-implicit context, makes the per-request lifecycle invisible at call sites, and adds a load-bearing dependency on `node:async_hooks` semantics. Explicit runtime threading is the correct design.
- **MySQL via Hyperdrive.** Hyperdrive supports MySQL too, but Prisma Next has no MySQL driver yet. Out of scope.
- **A Hyperdrive control-plane driver for migrations.** Migrations run from Node against the origin database. (See FR6.)
- **Driver-side codec normalization to canonical boundary values.** [ADR 155](docs/architecture%20docs/adrs/ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md) requires this, but it's an existing gap in the Node driver too. Tracked separately; not blocking this project.
- **Replacing `pg` with another underlying library** (e.g. `postgres.js`). M1 audit confirmed `pg` works under `nodejs_compat`. Not a goal.
- **PPg-specific control-plane integration** (preflight bundle uploads, etc.). Covered by [ADR 051](docs/architecture%20docs/adrs/ADR%20051%20-%20PPg%20preflight-as-a-service%20contract.md), tracked separately.
- **Caching configuration.** Hyperdrive's query cache is configured at the Hyperdrive resource level (Cloudflare dashboard / wrangler), not in PN. We document the considerations but don't expose configuration knobs.

# Acceptance Criteria

> **Status (m4 R1):** 19 / 20 PASS, 1 NOT VERIFIED (AC-12, blocked on real Cloudflare account + Hyperdrive). Evidence per AC is logged in [`assets/ac-verification.md`](assets/ac-verification.md).

## Facade surface & types

- [x] **AC1**: `postgresServerless<Contract>({ contractJson, extensions, middleware })` returns a client exposing `sql`, `context`, `stack`, `contract`, and `connect()` — and **does not** expose `orm`, `runtime()`, or `transaction()` (verified by a TypeScript negative-type test).
- [x] **AC2**: `db.connect({ url })` returns a `Runtime & AsyncDisposable`. Multiple calls return distinct runtime instances (no closure cache).

## Workers compatibility

- [x] **AC3**: `@prisma-next/postgres-serverless/runtime` (or chosen export path) and its full transitive dependency closure load successfully in the Cloudflare Workers runtime with `compatibility_flags = ["nodejs_compat"]`. Verified by the example Worker booting in `wrangler dev` without import errors.
- [x] **AC4**: SQL DSL plan execution, ORM-client query (constructed per-request from `runtime`), and `withTransaction(runtime, ...)` all execute successfully against a Hyperdrive-fronted Postgres in `wrangler dev`.

## Lifecycle

- [x] **AC5**: The serverless code path opens at most one underlying Postgres connection per `db.connect()` call, and `await using` disposal calls `client.end()` exactly once on scope exit (verified by mocked-`pg` unit test asserting construct/connect/end counts).
- [x] **AC6**: `pg-cursor` is reachable on the serverless path and exercised by an integration test that consumes a large-result-set query incrementally and cancels it via early `break` without materializing remaining rows.
- [x] **AC7**: No client-side `pg.Pool` is constructed on the serverless code path (verified by mocked-`pg` unit test).

## Symmetry & non-regression

- [x] **AC8**: Existing `postgres({ contract, url })`, `postgres({ contract, pg })`, `postgres({ contract, binding })` Node usage continues to work unchanged. Existing test suites pass.
- [x] **AC9**: Construction shape of `postgresServerless({ contractJson, extensions, middleware })` mirrors `postgres({ contractJson, extensions, middleware })` exactly (same option keys, same types where applicable).

## Transactions

- [x] **AC10**: A multi-statement transaction (e.g. INSERT then UPDATE) executed via `withTransaction(runtime, ...)` against Hyperdrive commits atomically on success and rolls back cleanly on thrown error.
- [x] **AC11**: A failed transaction body that triggers ROLLBACK leaves the underlying `pg.Client` in a state that is `client.end()`-able without leaks.

## Example & docs

- [ ] **AC12**: `examples/prisma-next-cloudflare-worker` deploys to a real Cloudflare account with `wrangler deploy` and successfully serves SQL DSL, ORM, and transaction requests against a real Hyperdrive-fronted Postgres. **NOT YET VERIFIED — blocked on Cloudflare account + Hyperdrive entitlement; will be closed by plan task M4 4.2.**
- [x] **AC13**: The example README documents end-to-end setup including the PPg/Postgres origin, `wrangler hyperdrive create`, `wrangler.jsonc` binding, and local dev via `localConnectionString`. Reviewer-verified to be sufficient to bootstrap from scratch.
- [x] **AC14**: The new deployment guide is published under `docs/` covering: facade-asymmetry rationale, Cloudflare Workers + Hyperdrive worked example, lifecycle expectations, generality across other per-request runtimes, migration story, known limitations.

## Architecture & quality

- [x] **AC15**: `pnpm lint:deps` passes; layering and plane rules are not violated.
- [x] **AC16**: `pnpm test:packages` passes (no regressions in existing suites).
- [x] **AC17**: New code has unit tests for `postgresServerless` (facade construction, `connect()` returning fresh runtimes, `[Symbol.asyncDispose]` calling `client.end()`, no `Pool` allocated, ORM client and transactions threaded through the returned runtime).
- [x] **AC18**: An automated integration test for the Worker example exists and runs in CI via `vitest-pool-workers` against a local Postgres.

## Performance & footprint

- [x] **AC19**: Worker bundle for the example app is under 1 MB compressed (measured: 254 KiB gzipped via `pnpm deploy:dry-run`).
- [x] **AC20**: Cold-start latency for an ORM `findMany({ take: 10 })` against a warm Hyperdrive pool is under 200 ms p50 in `wrangler dev` (measured: ~35 ms cold / ~13 ms warm against local Docker Postgres). Re-measure against real Hyperdrive in plan task 4.2.

# Other Considerations

## Security

- **Auth model:** unchanged. The Worker holds Hyperdrive credentials via the binding; Hyperdrive holds the origin DB credentials. The PN runtime never sees the origin URL on the Worker side.
- **Secret handling:** `localConnectionString` (used in `wrangler dev`) must not be committed. The example README must call this out and the example's `wrangler.jsonc` must reference an environment variable or `.dev.vars` entry.
- **TLS:** Hyperdrive uses TLS to the origin; Worker→Hyperdrive is internal Cloudflare transport. We do not need to manage TLS at the PN driver layer.

**Assumption:** No new authn/authz surfaces are introduced. If PPg requires per-request auth tokens (vs. static credentials), that's a follow-up.

## Cost

Estimated 30-day cost for example app + minimal usage:

- Cloudflare Workers: free tier sufficient for example/CI usage.
- Hyperdrive: free tier sufficient for example usage; production usage may incur charges based on origin connection time and query cache size.
- PPg or chosen origin: depends on tier; example targets free tier.

Order of magnitude: **$0–$10/month** for the example. Production usage scales with the origin database tier, not the PN runtime.

## Observability

- **Metrics to surface (best-effort):** per-request connection acquire latency, query latency, transaction lifecycle events. These are emitted via existing PN telemetry middleware ([ADR 024](docs/architecture%20docs/adrs/ADR%20024%20-%20Telemetry%20Schema.md)) — no new telemetry surface needed.
- **Logs:** error normalization continues via `normalize-error.ts`. We add Workers-aware error context (e.g. the Hyperdrive binding ID, Hyperdrive request ID if exposed in the connection metadata).
- **Hyperdrive's own observability** (connection counts, cache hit rate, query latency at the edge) lives in the Cloudflare dashboard. We document where to find it.

## Data Protection

No new personal data processing. Standard Postgres data flow: Worker → Hyperdrive → origin DB. Hyperdrive may cache query results at the edge (configurable per Hyperdrive resource); that's a deployment concern, not a PN concern. Document the implications in the new docs page.

## Analytics

No new analytics events. Existing telemetry middleware emits the standard query/error events.

# References

- Linear: [TML-2369 — Deploy Prisma Next on Cloudflare Workers with Hyperdrive](https://linear.app/prisma-company/issue/TML-2369)
- Linear (follow-up): [TML-2377 — ORM Class-Table-Inheritance bug for `@@base + @@map` discriminator schemas](https://linear.app/prisma-company/issue/TML-2377) — surfaced during M3 implementation; tracked separately, not blocking this project.
- PR: [#421 — feat(postgres): per-request facade for serverless runtimes](https://github.com/prisma/prisma-next/pull/421)
- Cloudflare Hyperdrive docs: <https://developers.cloudflare.com/hyperdrive/>
- ADRs:
  - [ADR 159 — Driver Terminology and Lifecycle](docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)
  - [ADR 155 — Driver/Codec Boundary and Lowering Responsibilities](docs/architecture%20docs/adrs/ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md)
  - [ADR 051 — PPg preflight-as-a-service contract](docs/architecture%20docs/adrs/ADR%20051%20-%20PPg%20preflight-as-a-service%20contract.md)
  - [ADR 152 — Execution Plane Descriptors and Instances](docs/architecture%20docs/adrs/ADR%20152%20-%20Execution%20Plane%20Descriptors%20and%20Instances.md)
- Existing implementation:
  - [Postgres driver](packages/3-targets/7-drivers/postgres/src/postgres-driver.ts)
  - [Postgres extension wrapper](packages/3-extensions/postgres/src/runtime/postgres.ts)
  - [SqlDriver SPI](packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts)

# Decisions

The shaping discussion resolved the following decisions. They are recorded here so the plan and implementation inherit them without revisiting.

1. **Topology — sibling facade `postgresServerless`, no driver-layer changes.** M1 audit confirmed the existing `PostgresDirectDriverImpl` (`pgClient` `PostgresBinding` kind) already implements the per-request lifecycle the serverless facade needs (lazy `client.connect()`, no `pg.Pool`, explicit `client.end()`, mutex-serialized `acquireConnection`). The new facade is a thin wrapper that constructs a `pg.Client` per `connect()` call and routes to the existing `pgClient` driver path. No new binding kinds, no new driver packages, no driver-layer code changes. See [`projects/cloudflare-hyperdrive-runtime/assets/workers-compat-audit.md`](assets/workers-compat-audit.md) for the audit's findings and rationale.
2. **Asymmetry between facades is intentional.** `postgres()` (Node) keeps `db.orm`, `db.runtime()`, `db.transaction()` — long-lived process makes the closure-cached convenience surface safe and useful. `postgresServerless()` deliberately omits them — closure caching across `fetch` invocations is unsafe (stale connections after isolate idle, concurrent-query races, no clean shutdown). Users acknowledge their environment's lifecycle through the import they choose.
3. **No `hyperdrive: env.HYPERDRIVE` ergonomic input.** The facade is runtime-environment-shaped, not Cloudflare-product-shaped. `db.connect({ url })` accepts any connection string; users source it from whatever env var their platform exposes (`env.HYPERDRIVE.connectionString` on Workers, others elsewhere). Hyperdrive is documented as the recommended Cloudflare path; not a special API surface.
4. **Underlying Postgres library**: `pg`. M1 audit confirmed `pg` + `pg-cursor` work under `nodejs_compat` in workerd, including cursor open / read-batches / early-break / close cycles.
5. **Streaming surface**: `pg-cursor` enabled by default on the serverless path. Audit-confirmed working. Users can opt out via the wrapper's `cursor` option for parity with the Node facade's existing surface.
6. **Local dev story**: both `wrangler dev` (ad-hoc) and `vitest-pool-workers` (CI integration tests).
7. **Hyperdrive types**: not a dependency. The facade's `connect({ url })` input is a plain `string`; users extract `env.HYPERDRIVE.connectionString` themselves. `@cloudflare/workers-types` may appear as a `devDependency` in the *example*, not in the facade package.
8. **Example app**: mirror [`examples/prisma-next-demo`](examples/prisma-next-demo) — same schema and same operations — adapted to the serverless ORM-client threading pattern (no `db.runtime()` calls; runtime threaded explicitly per the demo's existing `ormClientGetUsers(limit, runtime)` shape).
9. **CI integration test**: use `vitest-pool-workers` in CI; `wrangler deploy` is a documented manual smoke-test step.
10. **Bundle size**: measure and report (no hard CI gate in v1). M1 spike measured 53 KiB gzipped for `pg`+`pg-cursor`+worker glue alone; full PN-bundled estimate well under 1 MiB target.
11. **Project scope**: per-request runtimes broadly. Cloudflare Workers + Hyperdrive is the primary tested + documented path. Other per-request runtimes (Lambda, Vercel, Deno, Bun) supported by the same facade with no further work, but not exemplified or CI-tested in this project.
12. **Linear retitle**: TML-2369 retitled to "Deploy Prisma Next on Cloudflare Workers with Hyperdrive" — accurate as the project's primary deliverable, even though the underlying facade is generic.
