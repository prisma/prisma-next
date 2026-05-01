# Summary

Make Prisma Next deployable on Cloudflare Workers, connecting to a Postgres origin (including Prisma Postgres / PPg) through Cloudflare Hyperdrive, with first-class ergonomics for the `env.HYPERDRIVE` binding. The deliverable is an end-to-end Worker example that uses the existing `@prisma-next/postgres` runtime to execute SQL/ORM queries against a Hyperdrive-fronted Postgres, with whatever driver/wrapper changes are necessary to make that pattern idiomatic and production-ready.

# Description

Prisma Postgres (PPg) currently has no production-ready TCP connection pooling. The pre-existing pooling/caching surface (Accelerate) is incompatible with Prisma Next. To dogfood Prisma Next + PPg in Worker-deployed apps, we need a supported path that pools connections at the edge.

Cloudflare Hyperdrive provides exactly that: a Cloudflare-managed PgBouncer-equivalent that terminates the standard Postgres wire protocol at the edge, pools connections to the origin database, and exposes a configured connection string to the Worker via `env.HYPERDRIVE`. Hyperdrive supports any Postgres-compatible origin, including PPg, AWS RDS, Neon, etc.

The original framing of this task was "build a Hyperdrive driver". On investigation, that framing is misleading: Hyperdrive is not a separate protocol or transport. It is the standard Postgres wire protocol terminated at Cloudflare's edge. A Worker connects to it with `pg` (or any other Postgres-compatible driver) using `env.HYPERDRIVE.connectionString`. The actual gap is **runtime environment compatibility** (Cloudflare Workers vs. Node) and **lifecycle ergonomics** (per-request `Client` vs. long-lived `Pool`, since Hyperdrive pools on its end).

This project therefore targets the deployment story end-to-end:

- **Users:** developers building Cloudflare Worker applications who want to use Prisma Next against Postgres via Hyperdrive — initially focused on PPg as the origin, but generic to any Postgres origin Hyperdrive supports.
- **Problems to solve:**
  1. Verify which parts of `@prisma-next/postgres` (and its transitive deps) actually run in the Workers runtime under `nodejs_compat`, and fix or work around what doesn't.
  2. Provide a per-request lifecycle path that doesn't double-pool on top of Hyperdrive.
  3. Provide ergonomic wiring so a Worker can do `postgres({ contract, hyperdrive: env.HYPERDRIVE })` instead of manually constructing `pg.Client`s.
  4. Ship a working example Worker (`examples/`) that proves the path end-to-end and serves as documentation.

# Requirements

## Functional Requirements

### FR1 — Workers-runtime compatibility for the Postgres runtime

`@prisma-next/postgres/runtime` and its full transitive dependency closure must load and execute inside the Cloudflare Workers runtime with `compatibility_flags = ["nodejs_compat"]`. No imports of Workers-incompatible Node APIs at module-load time, and no runtime calls into APIs unavailable in Workers.

The execution surface that must work in Workers:

- `postgres({ contract, ... })` construction.
- `db.sql` (SQL DSL) plan compilation and execution.
- `db.orm` (ORM lane) for the operations our existing examples use (`findMany`, `create`, `update`, `delete`, `findUnique`).
- `db.transaction(...)` over Hyperdrive.
- `db.runtime().connection()` for explicit connection acquisition.

### FR2 — Hyperdrive binding ergonomics

The `@prisma-next/postgres` wrapper accepts an `env.HYPERDRIVE` binding directly, e.g.:

```ts
const db = postgres({ contract, hyperdrive: env.HYPERDRIVE });
```

Internally this resolves to whatever `PostgresBinding` shape best fits the Workers + Hyperdrive lifecycle (see FR3). The wrapper retains its existing input variants (`url`, `pg`, `binding`).

### FR3 — Per-request lifecycle compatible with Workers + Hyperdrive

The driver path used for Hyperdrive must:

- Not allocate a long-lived client-side `pg.Pool` (Hyperdrive owns pooling; client-side pooling is wasteful and fights Hyperdrive's connection management).
- Use `pg-cursor` if and only if it works under the Workers runtime (audit-determined; see Decisions §3). If cursors work, streaming is available; if not, fall back to buffered reads with a documented limitation around large result sets.
- Open a per-request connection on demand, perform queries/transactions, and release/end cleanly when the request finishes — fitting the Workers isolate-per-request model.
- Honor the existing `SqlDriver<TBinding>` SPI ([driver-types.ts](packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts)) so the runtime, ORM, and middleware stay unchanged.

The mechanism that delivers this (new binding kind on the existing driver, sibling driver package, or refactor) is an implementation decision deferred to the plan, but the lifecycle properties above are required.

### FR4 — Transactions over Hyperdrive

`db.transaction(fn)` must work end-to-end against Hyperdrive: BEGIN/COMMIT/ROLLBACK, multi-statement transactions sharing one underlying Postgres session, and proper teardown on Worker request end. Hyperdrive maintains transaction affinity within a single client connection.

### FR5 — Working end-to-end example

A new example under `examples/` (working name: `prisma-next-cloudflare-worker`) that:

- Is a deployable Cloudflare Worker (with `wrangler.jsonc` and `nodejs_compat`).
- Defines a `prisma-next.config.ts` and emits a contract.
- Has a `wrangler hyperdrive create`-provisioned binding configured (with `localConnectionString` for `wrangler dev`).
- Exposes at least one `fetch` handler that runs a representative SQL DSL query, an ORM query, and a transaction.
- Includes a README documenting the setup steps (env vars, `wrangler hyperdrive create`, dev vs. prod).

### FR6 — Migrations remain a Node concern

Migrations (control plane) continue to run from Node via the existing `@prisma-next/driver-postgres/control` driver against the **origin** database connection string (not Hyperdrive). Hyperdrive's caching/pooling makes it a poor fit for DDL. No control-plane Hyperdrive driver in this project.

### FR7 — Documentation

A new doc (likely under `docs/products/` or `docs/onboarding/`) titled "Deploying to Cloudflare Workers with Hyperdrive" covering:

- Architecture (Worker → Hyperdrive → origin Postgres).
- Setup steps (PPg/Postgres origin, `wrangler hyperdrive create`, `wrangler.jsonc` binding).
- Lifecycle expectations (per-request client, no shared global state).
- Migration story (run from Node, not from the Worker).
- Known limitations (cursor support pending audit outcome, transaction affinity, isolate memory limits, etc.).

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

- **Edge runtime portability.** Vercel Edge, Deno Deploy, Bun, etc. are out of scope. Cloudflare Workers + Hyperdrive only.
- **MySQL via Hyperdrive.** Hyperdrive supports MySQL too, but Prisma Next has no MySQL driver yet. Out of scope.
- **A Hyperdrive control-plane driver for migrations.** Migrations run from Node against the origin database. (See FR6.)
- **Driver-side codec normalization to canonical boundary values.** [ADR 155](docs/architecture%20docs/adrs/ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md) requires this, but it's an existing gap in the Node driver too. Tracked separately; not blocking this project.
- **Replacing `pg` with another underlying library** (e.g. `postgres.js`) across the board. May be considered if `pg` proves unworkable in Workers, but not a goal in itself.
- **PPg-specific control-plane integration** (preflight bundle uploads, etc.). Covered by [ADR 051](docs/architecture%20docs/adrs/ADR%20051%20-%20PPg%20preflight-as-a-service%20contract.md), tracked separately.
- **Caching configuration.** Hyperdrive's query cache is configured at the Hyperdrive resource level (Cloudflare dashboard / wrangler), not in PN. We document the considerations but don't expose configuration knobs.

# Acceptance Criteria

## Workers compatibility

- [ ] **AC1**: `@prisma-next/postgres/runtime` and full transitive deps load successfully under the Workers runtime with `compatibility_flags = ["nodejs_compat"]`. Verified via the example Worker booting without import errors.
- [ ] **AC2**: All listed surfaces in FR1 (sql DSL, ORM, transactions, connection acquisition) execute successfully against a Hyperdrive-fronted Postgres in `wrangler dev`.

## Lifecycle

- [ ] **AC3**: The Hyperdrive code path opens at most one underlying Postgres connection per Worker request and closes it cleanly on request end (verified by inspecting Hyperdrive metrics or instrumenting connection lifecycle).
- [ ] **AC4**: Cursor behavior on the Hyperdrive path matches the Decisions §3 outcome — either `pg-cursor` is reachable and exercised by an integration test that consumes a large-result-set query incrementally, or it is intentionally absent and the limitation is documented.
- [ ] **AC5**: No client-side `pg.Pool` is allocated on the Hyperdrive code path.

## Ergonomics

- [ ] **AC6**: A Worker can call `postgres({ contract, hyperdrive: env.HYPERDRIVE })` and receive a working `PostgresClient<TContract>`.
- [ ] **AC7**: Existing Node usage (`postgres({ contract, url })`, `postgres({ contract, pg })`, `postgres({ contract, binding })`) continues to work unchanged.

## Transactions

- [ ] **AC8**: `db.transaction(fn)` against Hyperdrive completes a multi-statement transaction (e.g. INSERT then UPDATE) atomically: COMMIT on success, ROLLBACK on thrown error.
- [ ] **AC9**: A failed transaction body does not leak the underlying connection back into Hyperdrive's pool in an open-transaction state.

## Example & docs

- [ ] **AC10**: `examples/prisma-next-cloudflare-worker` deploys to a real Cloudflare account with `wrangler deploy` and successfully serves a `findMany` request against a real Hyperdrive-fronted Postgres.
- [ ] **AC11**: The example README documents end-to-end setup including PPg/Postgres origin, `wrangler hyperdrive create`, and local dev with `localConnectionString`.
- [ ] **AC12**: The new "Deploying to Cloudflare Workers with Hyperdrive" doc is published under `docs/` with architecture, setup, lifecycle, migrations, and limitations sections.

## Architecture & quality

- [ ] **AC13**: `pnpm lint:deps` passes; layering and plane rules are not violated.
- [ ] **AC14**: `pnpm test:packages` passes (no regressions in existing suites).
- [ ] **AC15**: New code has unit tests for the wrapper input variant and for any new driver code paths.
- [ ] **AC16**: An automated integration test for the Worker example exists and runs in CI (using `wrangler dev` or `vitest-pool-workers` with a local Postgres).

## Performance & footprint

- [ ] **AC17**: Worker bundle for the example app is under 1 MB compressed (baseline measurement; we may revise).
- [ ] **AC18**: Cold-start latency for `findMany({ take: 10 })` against a warm Hyperdrive pool is under 200 ms p50 in `wrangler dev` (best-effort measurement; revise as needed).

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

- Linear: [TML-2369 — PPg has no connection pooling, add a Hyperdrive driver](https://linear.app/prisma-company/issue/TML-2369/ppg-has-no-connection-pooling-add-a-hyperdrive-driver) (title to be updated to match reframed scope)
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

1. **Driver topology**: gated on a Workers compatibility audit (first plan task). The leading choice is **a new binding kind on the existing `@prisma-next/driver-postgres`** (e.g. `{ kind: 'hyperdrive', binding }`) that internally runs a per-request `pg.Client` lifecycle. The audit may push us to a sibling package or to a wrapper-only solution; that re-decision happens within the plan, not the spec.
2. **Underlying Postgres library**: stick with `pg`. Revisit only if the audit shows it's unworkable in Workers.
3. **Streaming surface**: cursor support on the Workers/Hyperdrive path is **desired** (Hyperdrive itself supports cursors via the standard Postgres wire protocol; the open question is whether `pg-cursor` works under `nodejs_compat` in Workers). The compat audit (plan M1) determines feasibility. If `pg-cursor` works in Workers, the Hyperdrive driver path keeps cursor support and the wrapper exposes it via the existing `cursor` option. If it does not, we fall back to buffered-only on the Workers path and document the limitation; large-result-set use cases would then need explicit `LIMIT`/`OFFSET` paging.
4. **Local dev story**: both `wrangler dev` (ad-hoc) and `vitest-pool-workers` (CI integration tests).
5. **Hyperdrive types**: dev-dependency on `@cloudflare/workers-types` in the wrapper package, plus a structural type so end-user packages without `@cloudflare/workers-types` are not forced to install it.
6. **Example app**: mirror [`examples/prisma-next-demo`](examples/prisma-next-demo) — same schema and same operations — so users can compare Node vs. Workers side-by-side.
7. **CI integration test**: use `vitest-pool-workers` in CI; `wrangler deploy` is a documented manual smoke-test step.
8. **Bundle size**: measure and report (no hard CI gate in v1). Tighten in a follow-up after we have real numbers.
9. **Linear retitle**: TML-2369 is being retitled to "Deploy Prisma Next on Cloudflare Workers with Hyperdrive" with description updated to note the reframing from the original "build a Hyperdrive driver" framing.
