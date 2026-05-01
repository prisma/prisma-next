# Prisma Next on Cloudflare Workers with Hyperdrive — Plan

## Summary

Ship a sibling `postgresServerless` facade alongside the existing `postgres()` factory, with a deployable Cloudflare Worker example using it against a Hyperdrive-fronted Postgres, plus a deployment guide. The facade is generic across per-request runtimes; Cloudflare + Hyperdrive is the primary tested + documented path. M1 audit (complete) confirmed the existing `PostgresDirectDriverImpl` already implements the lifecycle we need — no driver-layer changes required, the work is concentrated in a new wrapper-package facade.

**Spec:** [`spec.md`](./spec.md)
**M1 audit:** [`assets/workers-compat-audit.md`](./assets/workers-compat-audit.md)

## Shipping Strategy

Every milestone is **additive and immediately deployable**. No feature flags. The implicit gate that separates old behavior from new is **import-time opt-in**: the new code path is only reached when a user imports `postgresServerless` (M2) or runs the new example Worker (M3). Existing `postgres({ url|pg|binding })` callers see no change. No driver-layer code is modified.

Per-milestone safety:

- **M1 (audit) — complete.** Read-only investigation; produced [`assets/workers-compat-audit.md`](./assets/workers-compat-audit.md). No production code touched.
- **M2 (serverless facade)** — adds a new wrapper package (or new entrypoint within the existing wrapper — decided in M2 task 2.1) that exports `postgresServerless`. No driver-layer changes; no changes to the existing `postgres()` Node facade. Safe because nothing reaches the new code without explicit import.
- **M3 (example + integration tests)** — adds `examples/prisma-next-cloudflare-worker/` and a `vitest-pool-workers` integration test. No impact on existing packages or examples.
- **M4 (docs + close-out)** — docs migration + repo-wide reference cleanup + `projects/cloudflare-hyperdrive-runtime/` deletion. No runtime impact.

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

### Milestone 2: `postgresServerless` facade

**Goal:** Ship the new `postgresServerless` facade with full unit-test coverage. Construction shape mirrors the existing `postgres()` factory; runtime surface is intentionally narrowed (no `orm`, no `runtime()`, no `transaction()`). Per-`connect()` lifecycle, `[Symbol.asyncDispose]` on returned `Runtime`. No driver-layer changes.

**Tasks:**

- [ ] **2.1 — Add the `serverless` entrypoint to `@prisma-next/postgres`.**
  - Decision (locked): **new entrypoint within the existing `@prisma-next/postgres` package**, exported as `@prisma-next/postgres/serverless`. Same package because the serverless facade shares all runtime dependencies (`pg`, `pg-cursor`, the existing PN runtime stack) with the Node `postgres()` factory; there are no new transitive deps to isolate, so a separate package would add maintenance cost without architectural benefit.
  - Concretely: add `src/runtime/postgres-serverless.ts` (or similar), wire it into `package.json` `exports` under `./serverless`, add a `tsdown.config.ts` entry for the new build target, and update `architecture.config.json` only if the new entrypoint's plane/layer assignment needs a glob it doesn't already have (likely no change since the new file lives inside the existing package's runtime plane).
- [ ] **2.2 — Implement `postgresServerless<TContract>({ contractJson, extensions, middleware })` factory.**
  - Construction shape mirrors `postgres()`: validate contract via `validateContract`, build the SQL execution stack via `createSqlExecutionStack`, build the execution context via `createExecutionContext`, build `db.sql` via `sqlBuilder({ context })`. Exposes `sql`, `context`, `stack`, `contract`. Does not expose `orm`, `runtime()`, `transaction()`.
  - (Satisfies: TC-1, TC-12.)
- [ ] **2.3 — Implement `db.connect({ url }) → Promise<Runtime & AsyncDisposable>`.**
  - Each call: `instantiateExecutionStack(stack)` → `driverDescriptor.create({ cursor: undefined })` → driver `connect({ kind: 'pgClient', client: new Client({ connectionString: url }) })` → `createRuntime({...})`. No closure cache. The returned object is a `Runtime` augmented with `[Symbol.asyncDispose]` that calls `runtime.close()` (which transitively closes the underlying `pg.Client`).
  - (Satisfies: TC-2, TC-7, TC-10, TC-25.)
- [ ] **2.4 — Cursor wiring on the serverless facade.**
  - The audit confirmed `pg-cursor` works in Workers. Default: cursor enabled (no `cursor: { disabled: true }`). Expose the same `cursor` option the existing wrapper accepts so users can opt out (`cursor: { disabled: true }`) if they want buffered. The Node facade's hardcoded `cursor: { disabled: true }` is a separate concern — do not touch it in this PR.
  - (Satisfies: TC-9.)
- [ ] **2.5 — Unit tests.**
  - Negative type test: `db.orm` / `db.runtime` / `db.transaction` access fails to compile.
  - Mocked-`pg` lifecycle test: `db.connect()` constructs `pg.Client` exactly once; `await using` calls `client.end()` exactly once; no `Pool` constructor invoked.
  - Two consecutive `connect()` calls return distinct runtimes.
  - ~~Telemetry middleware events fire with correct shape on the serverless lifecycle.~~ — struck per orchestrator decision in m2 R1 triage; symmetric with Node factory which has no telemetry test, structural pass-through coverage already present.
  - Symmetric-options structural type test (`postgresServerless` and `postgres` accept same option key shape where types align).
  - Existing `@prisma-next/postgres` tests pass unchanged.
  - (Satisfies: TC-1, TC-2, TC-7, TC-10, TC-12, TC-20, TC-25.)
- [ ] **2.6 — Package layering.**
  - No `architecture.config.json` change expected (new entrypoint lives inside the existing `@prisma-next/postgres` package's runtime plane). Confirm by running `pnpm lint:deps` after the entrypoint is wired.
  - No new cross-domain imports. Driver-layer files untouched.
  - (Satisfies: TC-26, TC-18.)
- [ ] **2.7 — README updates per doc-maintenance rule.**
  - Update `packages/3-extensions/postgres/README.md` (or the new package's README) to mention both facades and link to the deployment guide once it exists.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test --filter @prisma-next/postgres` (and the new package if Option A)
- `pnpm test:packages` (workspace-wide; ensures no consumer regression — existing `db.orm` / `db.runtime` / `db.transaction` Node usages still work)
- `pnpm lint:deps`
- `pnpm build` for any package whose exports/types changed (refreshes `dist/*.d.mts` per AGENTS.md)

### Milestone 3: Example Cloudflare Worker app + integration tests

**Goal:** A deployable Cloudflare Worker example mirroring `examples/prisma-next-demo` (same schema, adapted to per-request runtime threading per spec Decision §8), with `wrangler dev` for ad-hoc development and a `vitest-pool-workers` integration test in CI.

**Tasks:**

- [ ] **3.1 — Scaffold `examples/prisma-next-cloudflare-worker`.**
  - `package.json`, `wrangler.jsonc` with `nodejs_compat`, `tsconfig.json`, `prisma-next.config.ts`. Schema mirrors `examples/prisma-next-demo`. Use `wrangler hyperdrive create` to provision the binding ID; the ID goes in `wrangler.jsonc`, the connection string goes in `.dev.vars` (gitignored).
- [ ] **3.2 — Implement Worker `fetch` handler.**
  - Module-scope: `const db = postgresServerless<Contract>({ contractJson, extensions, middleware })`.
  - Inside `fetch`: `await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString })`; route to one of: SQL DSL `select` via `runtime.execute(db.sql.user.select(...).build())`, ORM `findMany` via `createOrmClient(runtime).user.findMany(...)`, transaction via `withTransaction(runtime, ...)`.
  - (Satisfies: TC-3, TC-4, TC-5, TC-6, TC-8, TC-13, TC-14.)
- [ ] **3.3 — Local dev wiring.**
  - `wrangler.jsonc` references `localConnectionString` from `.dev.vars`. Add a script that brings up a local Postgres pre-seeded with the demo data (Docker Compose if available, or a `psql`-driven setup script — match what `examples/prisma-next-demo` uses for parity).
  - (Satisfies: TC-16, TC-24.)
- [ ] **3.4 — `vitest-pool-workers` integration test.**
  - Test file boots the Worker under `workerd` via `vitest-pool-workers`, points at a local Postgres, and exercises TC-3 through TC-6, TC-8, TC-9, TC-13, TC-14. Wire into CI via the existing test runner. Decide example-local vs. root devDependency for `vitest-pool-workers` — probably example-local to keep the root install slim.
  - (Satisfies: TC-3 through TC-6, TC-8, TC-9, TC-13, TC-14, TC-19, TC-21.)
- [ ] **3.5 — Example README.**
  - Setup steps (Postgres origin, `wrangler hyperdrive create`, `wrangler.jsonc` binding, `.dev.vars`, `wrangler dev`, `wrangler deploy`), known limitations (transaction affinity, isolate memory limits), troubleshooting.
  - (Satisfies: TC-16.)
- [ ] **3.6 — Bundle size measurement.**
  - `wrangler deploy --dry-run` against the example; record compressed size in the README.
  - (Satisfies: TC-22.)
- [ ] **3.7 — Cold-start best-effort benchmark.**
  - Run ORM `findMany({ take: 10 })` against `wrangler dev` cold-start; record p50; if > 200 ms, document in spec/plan rather than blocking.
  - (Satisfies: TC-23.)
- [ ] **3.8 — `fixtures:check` parity.**
  - Ensure `pnpm fixtures:check` passes if the example has emitted contract artifacts.

**Validation gate:**

- `pnpm typecheck:all`
- `pnpm test:examples --filter prisma-next-cloudflare-worker`
- `pnpm test:packages` (no regressions)
- `pnpm lint:deps`
- `pnpm fixtures:check`
- `pnpm build` (full)

### Milestone 4: Docs, real-world smoke verification, and close-out

**Goal:** Ship the deployment guide, prove the example works against a real Cloudflare account + real Hyperdrive, verify all acceptance criteria, and close out the project.

**Tasks:**

- [ ] **4.1 — Write the deployment guide under `docs/`** (path TBD with docs team — likely `docs/products/Deploying-to-Serverless-Runtimes.md` or similar). Sections per FR7: facade-asymmetry rationale, Cloudflare + Hyperdrive worked example, lifecycle expectations, generality across other per-request runtimes, migration story, known limitations. Cross-link from `docs/README.md` and `docs/onboarding/Getting-Started.md` if appropriate.
  - (Satisfies: TC-17.)
- [ ] **4.2 — `wrangler deploy` smoke test.**
  - Deploy `examples/prisma-next-cloudflare-worker` to a real Cloudflare account against a real Hyperdrive config (PPg if available, otherwise Neon/RDS). Run all routes via real HTTPS request. Record outcomes in the audit doc / a temporary `assets/smoke-test-results.md`.
  - (Satisfies: TC-15.)
- [ ] **4.3 — AC verification pass.**
  - Walk every AC in `spec.md`, confirm corresponding TC has passed, link evidence (test file + line, doc anchor, deploy URL). Record in `projects/cloudflare-hyperdrive-runtime/assets/ac-verification.md` (transient; useful for the close-out PR description).
- [ ] **4.4 — Decide on a new ADR.**
  - The serverless facade asymmetry (drop `orm`/`runtime()`/`transaction` for per-request lifecycle) is a design decision worth recording as an ADR if the team agrees it's load-bearing. Draft under `docs/architecture docs/adrs/` if so. If not, the deployment guide carries the rationale.
- [ ] **4.5 — Migrate long-lived docs into `docs/`.**
  - Deployment guide stays in `docs/`. ADR (if drafted) lives under `docs/architecture docs/adrs/`. Audit + AC-verification stay under `projects/` (transient).
- [ ] **4.6 — Strip repo-wide references to `projects/cloudflare-hyperdrive-runtime/**`.**
  - Search for any links from `docs/`, READMEs, scripts; replace with canonical `docs/` links or remove.
- [ ] **4.7 — Delete `projects/cloudflare-hyperdrive-runtime/`.**
  - Final commit of the close-out PR. PR title or body must reference `(TML-2369)` so Linear's GitHub integration auto-completes the issue.

**Validation gate:**

- `pnpm typecheck:all`
- `pnpm test:all` (full sweep before close-out)
- `pnpm lint:deps`
- `pnpm lint:docs`
- `pnpm fixtures:check`
- `pnpm build`
- Manual: real `wrangler deploy` succeeds and serves expected response (TC-15)
- Manual: AC-verification doc complete; every AC has linked evidence

## Open Items

Carried forward from the spec or surfaced during planning. Most resolve during execution.

1. **Package shape** — locked: new entrypoint `@prisma-next/postgres/serverless` within the existing package. No new package, no new architecture.config.json glob. (M2 task 2.1.)
2. **Where to install `vitest-pool-workers`** — root devDependency vs. example-local. Decide in M3 task 3.4. Probably example-local.
3. **Cloudflare account for the smoke test (M4 task 4.2)** — needs a Cloudflare account with a Hyperdrive entitlement and a Postgres origin. The maker provisions or borrows; not blocking M2-M3.
4. **Whether to draft a new ADR** for the facade asymmetry. Decide in M4 task 4.4.
5. **PPg as the smoke-test origin** — currently aspirational. If PPg's preflight or networking story isn't ready, fall back to Neon or AWS RDS. Spec is generic to any Postgres origin; PPg-specific verification can be a follow-up.
6. **Whether to backport `[Symbol.asyncDispose]` to the existing Node `postgres()` facade.** Additive, useful for Node CLIs that want `await using runtime = await db.connect({ url })`. Out of scope for this project; recommend opening a separate ticket.
7. **Whether the Node wrapper's hardcoded `cursor: { disabled: true }` should be removed.** Decision §3 in spec applies to the serverless facade only. The Node default has its own history — out of scope here; flag as a follow-up if the team wants to revisit.
8. **Re-export `PostgresCursorOptions` from `@prisma-next/driver-postgres/runtime`** (follow-up). The serverless facade currently uses `NonNullable<PostgresDriverCreateOptions['cursor']>` as a structural workaround because the type is internal to the driver package. Cleaner long-term to add the type to the driver's runtime export. Hygiene-only; doesn't affect correctness. Suggest filing as a separate ticket; out of scope for this project.
