# Prisma Next on Cloudflare Workers with Hyperdrive — Plan

## Status (m4 R1)

| Milestone | State                                              |
| --------- | -------------------------------------------------- |
| M1        | complete (audit, topology decision)                |
| M2        | complete (`postgresServerless` facade — SATISFIED) |
| M3        | complete (Worker example + CI — SATISFIED)         |
| M4        | Stream A complete; Stream B remaining (handover)   |

PR: [#421 — feat(postgres): per-request facade for serverless runtimes](https://github.com/prisma/prisma-next/pull/421). Latest commit on the branch at handover: `5f85a5c4f` (ADR 207 rewrite).

**The remaining work is M4 Stream B** (real `wrangler deploy` smoke test + close-out). It's blocked on a Cloudflare account with a Hyperdrive entitlement and a Postgres origin reachable from Cloudflare's edge — it has no further code-design questions. See M4 below for the concrete steps.

## Summary

Ship a sibling `postgresServerless` facade alongside the existing `postgres()` factory, with a deployable Cloudflare Worker example using it against a Hyperdrive-fronted Postgres, plus a deployment guide. The facade is generic across per-request runtimes; Cloudflare + Hyperdrive is the primary tested + documented path. M1 audit confirmed the existing `PostgresDirectDriverImpl` already implements the lifecycle we need — no driver-layer changes required, the work is concentrated in a new wrapper-package entrypoint.

**Spec:** [`spec.md`](./spec.md)
**M1 audit:** [`assets/workers-compat-audit.md`](./assets/workers-compat-audit.md)
**AC verification (m4 R1):** [`assets/ac-verification.md`](./assets/ac-verification.md)

## Shipping Strategy

Every milestone is **additive and immediately deployable**. No feature flags. The implicit gate that separates old behavior from new is **import-time opt-in**: the new code path is only reached when a user imports `postgresServerless` (M2) or runs the new example Worker (M3). Existing `postgres({ url|pg|binding })` callers see no change. No driver-layer code is modified.

Per-milestone safety:

- **M1 (audit) — complete.** Read-only investigation; produced [`assets/workers-compat-audit.md`](./assets/workers-compat-audit.md). No production code touched.
- **M2 (serverless facade) — complete.** New entrypoint `@prisma-next/postgres/serverless` within the existing `@prisma-next/postgres` package. No driver-layer changes; no changes to the existing `postgres()` Node facade. Nothing reaches the new code without explicit import.
- **M3 (example + integration tests) — complete.** Added `examples/prisma-next-cloudflare-worker/` + `vitest-pool-workers` integration test wired into CI. No impact on existing packages or examples.
- **M4 (docs + smoke + close-out)** — Stream A (durable docs + AC verification) complete. Stream B (real `wrangler deploy` smoke + repo-wide refs + delete `projects/`) remaining; no runtime impact.

## Test Design

Test cases derived from the spec's acceptance criteria. Every AC has at least one mapped test case; tasks reference the test case IDs they satisfy.

| AC    | TC     | Test Case                                                                                              | Type        | Milestone | Expected Outcome                                                                                              |
| ----- | ------ | ------------------------------------------------------------------------------------------------------ | ----------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| AC-1  | TC-1   | `postgresServerless<Contract>(...)` returns a client whose type exposes `sql`/`context`/`stack`/`contract`/`connect` and **rejects** access to `orm`/`runtime`/`transaction` at the type level | Unit (negative type test) | M2 | TS compile error on attempted access to absent fields |
| AC-2  | TC-2   | Two consecutive `db.connect({ url })` calls return distinct `Runtime` instances; `await using` disposes each independently | Unit | M2 | Distinct identities, `[Symbol.asyncDispose]` invoked exactly once per scope exit |
| AC-3  | TC-3   | Worker bundle imports `@prisma-next/postgres-serverless/runtime` (or chosen export path) under `compatibility_flags = ["nodejs_compat"]` | Integration | M3 | Worker boots without import error in `vitest-pool-workers` |
| AC-4  | TC-4   | `db.sql.from(table).select(...)` plan + `runtime.execute(plan)` against Hyperdrive returns rows | Integration | M3 | Rows returned matching projection |
| AC-4  | TC-5   | `createOrmClient(runtime).user.findMany({ take: 10 })` returns rows | Integration | M3 | Rows returned |
| AC-4  | TC-6   | `withTransaction(runtime, ...)` mixed INSERT + UPDATE commits atomically | Integration | M3 | Final state reflects both writes |
| AC-5  | TC-7   | `db.connect({ url })` constructs `pg.Client` exactly once; `[Symbol.asyncDispose]` calls `client.end()` exactly once | Unit (mocked `pg`) | M2 | Construct/connect/end counts: 1/1/1 |
| AC-5  | TC-8   | Connection is closed cleanly when the `fetch` handler returns (the integration variant of TC-7) | Integration | M3 | Hyperdrive-side / instrumented hook observes proper teardown |
| AC-6  | TC-9   | Large-result-set query (10k rows in a TEMP table) yielded incrementally via cursor; early `break` closes cursor without materializing remaining rows | Integration | M3 | Memory footprint stays bounded; cursor close observed |
| AC-7  | TC-10  | `pg.Pool` is **not** constructed on the serverless path | Unit (mocked `pg`) | M2 | Mock confirms `Pool` constructor never invoked |
| AC-8  | TC-11  | All existing `postgres()` Node-facade input variants (`url`, `pg`, `binding`) continue to work and existing tests pass unchanged | Unit + workspace test sweep | M2 | Existing wrapper unit tests + `pnpm test:packages` green |
| AC-9  | TC-12  | `postgresServerless({ contractJson, extensions, middleware })` accepts the same option keys as `postgres({...})` (verified by structural type test) | Unit (type test) | M2 | Type test asserts symmetric option keys |
| AC-10 | TC-13  | Transaction body that throws triggers ROLLBACK | Integration | M3 | Database state unchanged after thrown error |
| AC-11 | TC-14  | Failed transaction body + simulated rollback failure: underlying `pg.Client` is `client.end()`-able without leaks | Integration | M3 | No leaked open transaction; teardown completes |
| AC-12 | TC-15  | `wrangler deploy` of `examples/prisma-next-cloudflare-worker` serves SQL DSL, ORM, transaction routes against a real Hyperdrive | Manual | M4 | HTTP 200 with expected JSON for each route |
| AC-13 | TC-16  | Example README sufficient to bootstrap from scratch (PPg/Postgres origin, `wrangler hyperdrive create`, `localConnectionString`) | Review | M3 | Reviewer confirms |
| AC-14 | TC-17  | New deployment guide present under `docs/` covering all FR7 sections | Review | M4 | Reviewer confirms |
| AC-15 | TC-18  | `pnpm lint:deps` passes | CI | M2/M3/M4 | Exit code 0 |
| AC-16 | TC-19  | `pnpm test:packages` passes | CI | M2/M3/M4 | Exit code 0 |
| AC-17 | TC-20  | New code has unit tests covering `postgresServerless` facade + lifecycle + ORM/transaction threading | Review | M2 | Coverage report + reviewer sign-off |
| AC-18 | TC-21  | `vitest-pool-workers` integration test wired into CI and runs | CI | M3 | CI job invokes integration test and it passes |
| AC-19 | TC-22  | Worker bundle for the example app is < 1 MB compressed | Manual | M3 | `wrangler deploy --dry-run` reports compressed size; recorded |
| AC-20 | TC-23  | Cold-start ORM `findMany({ take: 10 })` p50 latency < 200 ms in `wrangler dev` | Manual | M3 or M4 | Best-effort benchmark recorded |

### Test cases derived from non-requirement spec sections

| Section        | TC     | Test Case                                                                              | Type   | Milestone | Expected Outcome                                                                                       |
| -------------- | ------ | -------------------------------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------ |
| Security       | TC-24  | Example `wrangler.jsonc` does not commit secrets; `localConnectionString` via env / `.dev.vars` only | Review | M3 | Reviewer confirms no plaintext credentials in committed files |
| Observability  | TC-25  | ~~Telemetry-event-shape test on the serverless lifecycle~~ — **struck**. Symmetric with the Node `postgres()` factory, which has no telemetry test either; selective enforcement otherwise. Middleware pass-through is structurally covered by the existing `postgres-serverless.test.ts` lines 236-254. | — | — | — |
| Architecture   | TC-26  | No driver-layer files modified; `architecture.config.json` updated only if a new package is created | Review | M2 | Diff confirms |

## Milestones

### Milestone 1: Workers compatibility audit & topology decision — complete

**Goal:** Determine empirically what runs in Cloudflare Workers under `nodejs_compat`, and pick the wrapper topology.

**Outcome:** [`assets/workers-compat-audit.md`](./assets/workers-compat-audit.md) — topology = sibling facade (`postgresServerless`), no driver-layer changes. `pg` + `pg-cursor` work in workerd. Bundle baseline (pg-only spike): 53 KiB gzipped.

**Validation gate (already passed):** audit doc exists with all five sections; spike artifacts under `wip/` (gitignored).

### Milestone 2: `postgresServerless` facade — complete

**Goal:** Ship the new `postgresServerless` facade with full unit-test coverage. Construction shape mirrors the existing `postgres()` factory; runtime surface is intentionally narrowed (no `orm`, no `runtime()`, no `transaction()`). Per-`connect()` lifecycle, `[Symbol.asyncDispose]` on returned `Runtime`. No driver-layer changes.

**Outcome:** Reviewer-verified `SATISFIED` (m2 R2). Construction + lifecycle implemented in [`packages/3-extensions/postgres/src/runtime/postgres-serverless.ts`](../../packages/3-extensions/postgres/src/runtime/postgres-serverless.ts), exported via [`packages/3-extensions/postgres/src/exports/serverless.ts`](../../packages/3-extensions/postgres/src/exports/serverless.ts) and the package's `./serverless` entrypoint. 15 unit tests + 7 type tests pin the surface and lifecycle. No driver-layer changes; `pnpm lint:deps` clean.

**Tasks:**

- [x] **2.1 — Add the `serverless` entrypoint to `@prisma-next/postgres`.** New entrypoint within the existing package, exported as `@prisma-next/postgres/serverless`. `package.json` `exports` and `tsdown.config.ts` updated; `architecture.config.json` unchanged (new file fits the existing runtime-plane glob). Commit `af867fda7`.
- [x] **2.2 — Implement `postgresServerless<TContract>({ contractJson, extensions, middleware })` factory.** Validates contract, builds the SQL execution stack and execution context, exposes `sql`, `context`, `stack`, `contract`. Does not expose `orm`, `runtime()`, `transaction()`. Commit `a5114b8b7`. (Satisfies TC-1, TC-12.)
- [x] **2.3 — Implement `db.connect({ url }) → Promise<Runtime & AsyncDisposable>`.** Each call: `instantiateExecutionStack(stack)` → `driverDescriptor.create(...)` → driver `connect({ kind: 'pgClient', client: new Client({ connectionString: url }) })` → `createRuntime(...)`. No closure cache. Returned `Runtime` carries `[Symbol.asyncDispose]` that calls `runtime.close()`. Commit `a5114b8b7`. (Satisfies TC-2, TC-7, TC-10, TC-25.)
- [x] **2.4 — Cursor wiring on the serverless facade.** Cursor enabled by default; the wrapper's `cursor` option lets users opt out for parity with the Node facade. Commit `a5114b8b7`. (Satisfies TC-9.)
- [x] **2.5 — Unit tests.** 15 unit tests in [`packages/3-extensions/postgres/test/postgres-serverless.test.ts`](../../packages/3-extensions/postgres/test/postgres-serverless.test.ts) (mocked `pg` for lifecycle, no `Pool` allocated, distinct runtimes per `connect()`, runtime-key absence probes). 7 type tests in [`packages/3-extensions/postgres/test/postgres-serverless.types.test-d.ts`](../../packages/3-extensions/postgres/test/postgres-serverless.types.test-d.ts) (negative type tests, structural option-key parity with `postgres()`). Existing 27-case `postgres.test.ts` suite passes unchanged. Telemetry test struck per m2 R1 triage (Node factory has none either; selective enforcement otherwise). Commit `a5114b8b7`, with one annotation follow-up in `a7daefbcb` (F1 closure). (Satisfies TC-1, TC-2, TC-7, TC-10, TC-12, TC-20, TC-25.)
- [x] **2.6 — Package layering.** `pnpm lint:deps` clean; no `architecture.config.json` change needed. Driver-layer files untouched. (Satisfies TC-26, TC-18.)
- [x] **2.7 — README updates.** [`packages/3-extensions/postgres/README.md`](../../packages/3-extensions/postgres/README.md) documents both facades and cross-links the deployment guide. Commits `20fe2e8e0`, `285a3c268`, `17645b242`, `62654a5d1` (the last three correct pre-existing Node-facade README drift surfaced during m2 R1).

**Validation gate (passed at m2 R2):**

- `pnpm typecheck`
- `pnpm test --filter @prisma-next/postgres`
- `pnpm test:packages` (workspace-wide; no consumer regression)
- `pnpm lint:deps`
- `pnpm build`

### Milestone 3: Example Cloudflare Worker app + integration tests — complete

**Goal:** A deployable Cloudflare Worker example mirroring `examples/prisma-next-demo` (same schema, adapted to per-request runtime threading per spec Decision §8), with `wrangler dev` for ad-hoc development and a `vitest-pool-workers` integration test in CI.

**Outcome:** Reviewer-verified `SATISFIED` (m3 R2). Example lives at [`examples/prisma-next-cloudflare-worker/`](../../examples/prisma-next-cloudflare-worker/). Bundle measures 254 KiB gzipped (vs 1 MB AC-19 budget). Cold-start in `wrangler dev` ~35 ms / warm ~13 ms (vs 200 ms AC-20 budget). 8/8 integration tests pass under `vitest-pool-workers`; CI wired with Docker Postgres bring-up.

**Tasks:**

- [x] **3.1 — Scaffold `examples/prisma-next-cloudflare-worker`.** `package.json`, `wrangler.jsonc` with `nodejs_compat`, `tsconfig.json`, `prisma-next.config.ts`. Schema mirrors the demo minus pgvector. Commit `40e47eb09`.
- [x] **3.2 — Implement Worker `fetch` handler.** Module-scope `db = postgresServerless<Contract>(...)`; per-request `await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString })`. Routes for `/sql/users`, `/orm/users`, `/orm/posts`, `/tx/commit`, `/tx/rollback`, `/cursor/large`, plus `/health`. ORM client built per request via `createOrmClient(runtime)`. Commits `83ffe5311`, `2f9dfe558`, `a41a3542d`. (Satisfies TC-3, TC-4, TC-5, TC-6, TC-8, TC-13, TC-14.)
- [x] **3.3 — Local dev wiring (Docker Postgres).** `docker-compose.yml` wires `postgres:16` on port 5433 (avoids clash with `examples/prisma-next-demo`'s Postgres.app). `pnpm db:up` / `db:down` / `db:reset` scripts; `.env.example` shipped, `.env` gitignored. `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` is the env-var path Wrangler reads for Hyperdrive local-dev. Decision renegotiated from `@prisma/dev` to Docker after the PGlite-via-`pg-cloudflare` hang under workerd (see Open items §9). Commits `2f9dfe558`, `aa9517998`, `3739e353e`. (Satisfies TC-16, TC-24.)
- [x] **3.4 — `vitest-pool-workers` integration test wired into CI.** Suite at [`examples/prisma-next-cloudflare-worker/test/worker.integration.test.ts`](../../examples/prisma-next-cloudflare-worker/test/worker.integration.test.ts) (8 tests). `globalSetup` brings up Docker Postgres, applies the schema, seeds 10 000 posts. Cursor test asserts `rowsTransmitted < 500` via a `pg_stat_statements` side-channel (fails decisively with cursor disabled). [`vitest.config.ts`](../../examples/prisma-next-cloudflare-worker/vitest.config.ts) carries the `cloudflare/workers-sdk#12984` Vite-8 bundling workarounds (`test.deps.optimizer.ssr.{include,rolldownOptions.external}`) and soft-fails when env is unset. CI wired in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) (`pnpm db:up` step + `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` env). Commits `699d82283`, `a41a3542d`, `5f282018d`. (Satisfies TC-3 through TC-6, TC-8, TC-9, TC-13, TC-14, TC-19, TC-21.)
- [x] **3.5 — Example README.** [`examples/prisma-next-cloudflare-worker/README.md`](../../examples/prisma-next-cloudflare-worker/README.md): prerequisites, one-time bootstrap, per-session bring-up, `wrangler dev`, deploy, bundle-size + cold-start measurements, troubleshooting, "why not `prisma dev`" callout, known limitations including the Class-Table-Inheritance gap (filed as TML-2377). Commits `7ab2e808e`, `3739e353e`. (Satisfies TC-16.)
- [x] **3.6 — Bundle size measurement.** `pnpm deploy:dry-run` reports 1289.96 KiB / gzip 254.14 KiB. Recorded in the example README. (Satisfies TC-22.)
- [x] **3.7 — Cold-start benchmark.** Best-effort `wrangler dev` against local Docker Postgres: cold-start ~35 ms, warm p50 ~13 ms. Recorded in the example README; production-Hyperdrive re-measure deferred to M4 task 4.2. (Satisfies TC-23.)
- [x] **3.8 — `fixtures:check` parity.** Passing on the example's emitted contract artifacts. Commit `aa9517998`.

**Validation gate (passed at m3 R2):**

- `pnpm typecheck:all`
- `pnpm test:examples --filter prisma-next-cloudflare-worker` (requires `pnpm db:up` first)
- `pnpm test:packages` (no regressions)
- `pnpm lint:deps`
- `pnpm fixtures:check`
- `pnpm build`

### Milestone 4: Docs, real-world smoke verification, and close-out — partially complete (Stream A done; Stream B remaining)

**Goal:** Ship the deployment guide, prove the example works against a real Cloudflare account + real Hyperdrive, verify all acceptance criteria, and close out the project.

M4 splits into two streams:

- **Stream A — durable docs + AC verification (no Cloudflare account needed). Complete.**
- **Stream B — real-world smoke + close-out (needs Cloudflare account + Hyperdrive entitlement + Postgres origin). Remaining; this is the handover surface.**

**Tasks:**

#### Stream A — complete

- [x] **4.1 — Deployment guide under `docs/`.** Landed at [`docs/Serverless Deployment Guide.md`](../../docs/Serverless%20Deployment%20Guide.md), cross-linked from [`docs/README.md`](../../docs/README.md) under a new "Deploying" section. Sections per FR7: facade-asymmetry rationale (cross-linking ADR 207), Cloudflare + Hyperdrive worked example, generality across other per-request runtimes (table-of-pointers per spec non-goal), migrations-on-Node story, known limitations. Commit `74c8a7ce0`. (Satisfies TC-17.)
- [x] **4.3 — AC verification pass.** Recorded at [`assets/ac-verification.md`](./assets/ac-verification.md). Pulled from the reviewer's m4 R1 scoreboard. Totals: **19 PASS / 0 FAIL / 1 NOT VERIFIED** (AC-12 only). All ACs except AC-12 are satisfied with on-disk evidence; AC-12 lands when Stream B runs. AC-20 (cold-start) should be re-measured against real Hyperdrive at the same time. Commit `20502f5d1`.
- [x] **4.4 — Decide on a new ADR.** Yes — the asymmetry is load-bearing for any future per-request runtime story (Lambda, Vercel, Deno, Bun) and any future per-family extension (mysql/mongo serverless), and `spec.md` doesn't survive close-out. Drafted as [`ADR 207 — Per-environment facade asymmetry`](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Per-environment%20facade%20asymmetry.md), indexed under § Adapters & Targets in [`ADR-INDEX.md`](../../docs/architecture%20docs/ADR-INDEX.md). Commits `9fec40bd5` (initial draft), `5f85a5c4f` (rewrite to lead with decision + grounding example, tighten the §1 protocol-level prose around `pg.Client` HOL blocking + cross-`fetch` transaction-state contamination).

#### Stream B — remaining (needs Cloudflare account + Hyperdrive entitlement + Postgres origin)

- [ ] **4.2 — `wrangler deploy` smoke test against real Cloudflare + real Hyperdrive.** (Satisfies TC-15 / closes AC-12; opportunity to re-measure AC-20.)
  - **Prerequisites the next maker provisions:**
    1. A Cloudflare account with a Hyperdrive entitlement.
    2. A Postgres origin reachable from Cloudflare's edge (Prisma Postgres if available; otherwise Neon, AWS RDS, Supabase, etc.). Apply the example's schema to it via `pnpm prisma-next db init` against the origin URL.
  - **Steps:**
    1. `cd examples/prisma-next-cloudflare-worker && pnpm exec wrangler hyperdrive create my-hyperdrive --connection-string="postgres://…<origin URL>"`. Note the printed binding ID.
    2. Replace the placeholder `id` in [`examples/prisma-next-cloudflare-worker/wrangler.jsonc`](../../examples/prisma-next-cloudflare-worker/wrangler.jsonc) (currently `00000000-0000-0000-0000-000000000000`) with the real binding ID.
    3. `pnpm deploy` (which delegates to `wrangler deploy`). Capture the deployed Worker URL.
    4. Smoke each route via `curl` and record observations: `/health`, `/sql/users`, `/orm/users`, `/orm/posts?userId=…`, `/tx/commit`, `/tx/rollback` (verify the rollback by reading back affected rows), `/cursor/large` (verify `rowsTransmitted` stays bounded — should still report < 500 against a real Hyperdrive in front of the seeded 10 000-row table).
    5. Re-measure cold-start latency for `/orm/users?limit=10` (curl the route after a 5-minute idle to force a cold isolate). Production cold-start over real Hyperdrive will be slower than the local 35 ms — re-evaluate against AC-20's 200 ms ceiling.
    6. Record outcomes (route → response shape → latency) in [`assets/ac-verification.md`](./assets/ac-verification.md) under AC-12 (and AC-20 if re-measured), and the deployed Worker URL.
  - **Risks the next maker should know about:**
    - The `pg-cloudflare` socket layer hangs under workerd's local Hyperdrive emulator when the local origin is `prisma dev`'s PGlite TCP shim. **This does not apply to real deployed Hyperdrive against a real Postgres origin** — M1 audit empirically confirmed the path works there. The known-broken case is local-dev only.
    - Hyperdrive caches query results at the edge; if you see stale reads after writes, the cache config is the suspect (deployment concern, not a PN concern). The deployment guide covers this.
    - Cloudflare's free tier is sufficient for example/CI usage; production usage may incur charges based on origin connection time + cache size. Order of magnitude is $0–$10/month for the example.

- [ ] **4.5 — Migrate long-lived docs into `docs/`.**
  - **Already done in Stream A:** [`docs/Serverless Deployment Guide.md`](../../docs/Serverless%20Deployment%20Guide.md) and [`docs/architecture docs/adrs/ADR 207 - Per-environment facade asymmetry.md`](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Per-environment%20facade%20asymmetry.md) already live in `docs/`.
  - **Decide and execute at close-out:** the M1 audit ([`assets/workers-compat-audit.md`](./assets/workers-compat-audit.md)) is the only remaining candidate for migration. Most of its content is already absorbed into ADR 207, the deployment guide, and the example README's "why not `prisma dev`" callout. Recommend dropping rather than migrating: the close-out PR strips `projects/cloudflare-hyperdrive-runtime/` entirely, which removes the audit doc with it. If the team disagrees, the audit's evergreen content (`pg`/`pg-cursor` works in workerd; `pg-cloudflare` is auto-pulled by `pg`'s runtime detection) can land as a short note appended to the deployment guide's "Validating end-to-end" section.
  - The AC-verification doc ([`assets/ac-verification.md`](./assets/ac-verification.md)) is consumed by the close-out PR description and dies with `projects/`. Do not migrate.

- [ ] **4.6 — Strip repo-wide references to `projects/cloudflare-hyperdrive-runtime/**`.**
  - `rg 'projects/cloudflare-hyperdrive-runtime' -- ':!projects/cloudflare-hyperdrive-runtime'` to surface the candidate set. Replace with canonical `docs/` links (deployment guide + ADR 207) or remove. The `docs/` content has been written to be self-contained and shouldn't reference `projects/`; verify before stripping.

- [ ] **4.7 — Delete `projects/cloudflare-hyperdrive-runtime/`.**
  - Final commit of the close-out PR. The existing PR ([#421](https://github.com/prisma/prisma-next/pull/421)) title and body already reference `TML-2369`, so Linear's GitHub integration will auto-complete the issue when this PR merges.

**Validation gate (Stream B):**

- `pnpm typecheck:all`
- `pnpm test:all` (full sweep before close-out)
- `pnpm lint:deps`
- `pnpm lint:docs`
- `pnpm fixtures:check`
- `pnpm build`
- Manual: `wrangler deploy` succeeds; every route returns the expected shape against real Hyperdrive (TC-15 / AC-12).
- Manual: AC-verification doc updated with AC-12 evidence and (optionally) AC-20 re-measurement.

## Open Items

Carried forward from the spec or surfaced during planning. Most resolve during execution.

1. **Package shape** — locked: new entrypoint `@prisma-next/postgres/serverless` within the existing package. No new package, no new architecture.config.json glob. (M2 task 2.1.)
2. **Where to install `vitest-pool-workers`** — locked: example-local devDependency in `examples/prisma-next-cloudflare-worker`. Keeps the root install slim; only this example needs the workerd test pool. (M3 task 3.4.)
3. **Cloudflare account for the smoke test (M4 task 4.2)** — needs a Cloudflare account with a Hyperdrive entitlement and a Postgres origin. The maker provisions or borrows; not blocking M2-M3.
4. **Whether to draft a new ADR** for the facade asymmetry. Decide in M4 task 4.4.
5. **PPg as the smoke-test origin** — currently aspirational. If PPg's preflight or networking story isn't ready, fall back to Neon or AWS RDS. Spec is generic to any Postgres origin; PPg-specific verification can be a follow-up.
6. **Whether to backport `[Symbol.asyncDispose]` to the existing Node `postgres()` facade.** Additive, useful for Node CLIs that want `await using runtime = await db.connect({ url })`. Out of scope for this project; recommend opening a separate ticket.
7. **Whether the Node wrapper's hardcoded `cursor: { disabled: true }` should be removed.** Decision §3 in spec applies to the serverless facade only. The Node default has its own history — out of scope here; flag as a follow-up if the team wants to revisit.
8. **Re-export `PostgresCursorOptions` from `@prisma-next/driver-postgres/runtime`** (follow-up). The serverless facade currently uses `NonNullable<PostgresDriverCreateOptions['cursor']>` as a structural workaround because the type is internal to the driver package. Cleaner long-term to add the type to the driver's runtime export. Hygiene-only; doesn't affect correctness. Suggest filing as a separate ticket; out of scope for this project.
9. **Local Postgres origin for M3 — renegotiated, locked: Docker Postgres.** The original choice (`prisma dev`, PGlite-backed PPg) was empirically broken under workerd's Hyperdrive emulator: every DB-touching route hangs after `pg-cloudflare`'s `CloudflareSocket` connects, then `Connection terminated unexpectedly` and workerd never recovers. Reproduces in plain `wrangler dev`, not just under `vitest-pool-workers`, so it's not a test-infra problem. Tracking issue: [`cloudflare/workers-sdk#12984`](https://github.com/cloudflare/workers-sdk/issues/12984) — third sub-issue ("Cannot perform I/O on behalf of a different Durable Object"); upstream fix not yet merged (PR #13062 only covers the bundling regressions). M1's "this works in `wrangler dev`" claim was empirically validated against a real Postgres on `localhost`, not against `prisma dev` — so the audit's conclusion still holds for real-Postgres origins, which is what M3 now uses. Docker keeps the local-dev story container-runtime-portable; ad-hoc PPg dogfooding moves to M4 against a real deployed Hyperdrive + PPg.
