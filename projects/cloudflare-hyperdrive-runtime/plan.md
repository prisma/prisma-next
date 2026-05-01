# Prisma Next on Cloudflare Workers with Hyperdrive — Plan

## Summary

Make Prisma Next deployable on Cloudflare Workers with a Postgres origin (initially Prisma Postgres) fronted by Cloudflare Hyperdrive. The work is structured around a short Workers-compatibility audit that gates the driver topology decision, followed by additive driver/wrapper changes, an example Worker app that mirrors `prisma-next-demo`, and documentation. Success means a Worker can call `postgres({ contract, hyperdrive: env.HYPERDRIVE })` and execute SQL DSL, ORM, and transaction workloads end-to-end against a real Hyperdrive-fronted Postgres.

**Spec:** [`spec.md`](./spec.md)

## Shipping Strategy

Every milestone is **additive and immediately deployable**. No feature flags. The implicit gate that separates old behavior from new is **call-site opt-in**: the new Hyperdrive code path is only reached when a user calls `postgres({ hyperdrive: ... })` (M2) or runs the new example Worker (M3). Existing `postgres({ url })` / `postgres({ pg })` / `postgres({ binding })` callers see no change.

Per-milestone safety:

- **M1 (audit)** — read-only investigation; produces a decision doc as a project asset. No production code touched. Always safe to merge.
- **M2 (driver/wrapper)** — adds a new binding kind and/or a new wrapper input variant. Existing input variants and the existing driver code paths are untouched. Safe because nothing reaches the new code without explicit opt-in.
- **M3 (example + integration tests)** — adds `examples/prisma-next-cloudflare-worker/` and a `vitest-pool-workers` integration test. No impact on existing packages or examples. Safe.
- **M4 (docs + close-out)** — docs migration + repo-wide reference cleanup + `projects/cloudflare-hyperdrive-runtime/` deletion. No runtime impact. Safe.

If the M1 audit reveals a blocker that requires a non-additive change to the existing Postgres driver (e.g. a refactor of how `pg-cursor` is imported), that change must be split into a separate, behavior-preserving prep commit/PR within M2 with its own tests, before the additive Hyperdrive path lands on top.

## Test Design

Test cases derived from the spec's acceptance criteria. Every AC has at least one mapped test case; tasks in subsequent milestones reference the test case IDs they satisfy.

| AC    | TC     | Test Case                                                                                              | Type        | Milestone | Expected Outcome                                                                                              |
| ----- | ------ | ------------------------------------------------------------------------------------------------------ | ----------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| AC-1  | TC-1   | Worker bundle imports `@prisma-next/postgres/runtime` under `compatibility_flags = ["nodejs_compat"]`  | Integration | M3        | Worker boots without import error in `vitest-pool-workers`                                                    |
| AC-2  | TC-2   | `db.sql` SELECT against Hyperdrive in Workers runtime returns rows                                     | Integration | M3        | Rows returned matching expected projection                                                                    |
| AC-2  | TC-3   | `db.orm.user.findMany({ take: 10 })` against Hyperdrive in Workers runtime returns rows                | Integration | M3        | Rows returned                                                                                                 |
| AC-2  | TC-4   | `db.transaction(...)` mixed INSERT + UPDATE against Hyperdrive commits atomically                      | Integration | M3        | Final state reflects both writes                                                                              |
| AC-2  | TC-5   | `db.runtime().connection()` acquires + releases a connection against Hyperdrive                        | Integration | M3        | Acquire/release cycle completes without leaks                                                                 |
| AC-3  | TC-6   | Hyperdrive code path opens at most one underlying Postgres connection per request                      | Unit        | M2        | Mocked `pg.Client` is constructed once per request lifecycle; `connect()` and `end()` called exactly once     |
| AC-3  | TC-7   | Connection is closed cleanly when the `fetch` handler returns                                          | Integration | M3        | Hyperdrive lifecycle metrics or instrumented hook observes proper teardown                                    |
| AC-4  | TC-8a  | If the M1 audit confirms `pg-cursor` works in Workers: large-result-set (e.g. 10k rows) `execute()` over Hyperdrive yields rows incrementally and an early `break` closes the cursor without materializing remaining rows | Integration | M3        | Cursor is opened, closed on `break`; memory footprint stays bounded                                          |
| AC-4  | TC-8b  | If the M1 audit shows `pg-cursor` does not work in Workers: the Hyperdrive path is intentionally buffered, no `pg-cursor` is reachable from it, and the limitation is documented in the example README + deployment guide | Unit + Review | M2 + M4 | Either path satisfies AC-4; chosen path matches the audit outcome                                            |
| AC-5  | TC-9   | `pg.Pool` is not constructed on the Hyperdrive code path                                               | Unit        | M2        | Mock-based test confirms only `pg.Client` is constructed, never `pg.Pool`                                     |
| AC-6  | TC-10  | `postgres({ contract, hyperdrive: env.HYPERDRIVE })` returns a working `PostgresClient<TContract>`     | Unit        | M2        | Returned object exposes `sql`, `orm`, `context`, `runtime()`, `transaction()`, `connect()` per existing shape |
| AC-7  | TC-11  | All existing wrapper input variants (`url`, `pg`, `binding`) continue to work                          | Unit        | M2        | Existing wrapper unit tests pass unchanged                                                                    |
| AC-8  | TC-12  | Transaction body that throws triggers ROLLBACK                                                         | Integration | M3        | Database state unchanged after thrown error                                                                   |
| AC-9  | TC-13  | Transaction body that throws AND simulated rollback failure: connection is destroyed (not released)    | Integration | M3        | Connection is `destroy()`ed; no leaked open transaction                                                       |
| AC-10 | TC-14  | `wrangler deploy` of `examples/prisma-next-cloudflare-worker` serves a real `findMany` request         | Manual      | M4        | HTTP 200 with expected JSON                                                                                   |
| AC-11 | TC-15  | Example README documents PPg/Postgres origin setup, `wrangler hyperdrive create`, `localConnectionString` | Manual    | M3        | Reviewer confirms README is sufficient to bootstrap the example from scratch                                  |
| AC-12 | TC-16  | New "Deploying to Cloudflare Workers with Hyperdrive" doc exists under `docs/` with required sections  | Manual      | M4        | Reviewer confirms architecture, setup, lifecycle, migrations, limitations sections are present and accurate   |
| AC-13 | TC-17  | `pnpm lint:deps` passes                                                                                | CI          | M2/M3/M4  | Exit code 0                                                                                                   |
| AC-14 | TC-18  | `pnpm test:packages` passes                                                                            | CI          | M2/M3/M4  | Exit code 0                                                                                                   |
| AC-15 | TC-19  | New driver/wrapper code paths have unit tests                                                          | Review      | M2        | Coverage report + reviewer sign-off                                                                           |
| AC-16 | TC-20  | `vitest-pool-workers` integration test is wired into CI and runs                                       | CI          | M3        | CI job invokes the integration test and it passes                                                             |
| AC-17 | TC-21  | Worker bundle for the example app is < 1 MB compressed                                                 | Manual      | M3        | `wrangler deploy --dry-run` reports compressed size; baseline recorded in plan/spec                           |
| AC-18 | TC-22  | Cold-start `findMany({ take: 10 })` p50 latency < 200 ms in `wrangler dev`                             | Manual      | M3 or M4  | Best-effort benchmark recorded; revised target if measurement disagrees                                       |

### Test cases derived from non-requirement spec sections

| Section        | TC     | Test Case                                                                              | Type   | Milestone | Expected Outcome                                                                                       |
| -------------- | ------ | -------------------------------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------ |
| Security       | TC-23  | Example `wrangler.jsonc` does not commit secrets; `localConnectionString` via env/dev.vars only | Review | M3 | Reviewer confirms no plaintext credentials in the committed example                                  |
| Observability  | TC-24  | Existing telemetry middleware emits expected events on the Workers code path           | Unit   | M2        | Telemetry events fire with correct shape on the new binding's lifecycle                                |
| Architecture   | TC-25  | Driver-layer changes respect ADR 159 (driver lifecycle) and ADR 155 (driver/codec boundary) | Review | M2   | Reviewer confirms no responsibility leaks; binding-determined options stay at create/connect boundary  |

## Milestones

### Milestone 1: Workers compatibility audit & driver-topology decision

**Goal:** Determine empirically what does and doesn't work when the existing PN Postgres runtime is loaded under `nodejs_compat` in Cloudflare Workers, and produce a written decision on the driver topology (a/b/c from spec Decision §1) with supporting evidence.

**Deliverable:** `projects/cloudflare-hyperdrive-runtime/assets/workers-compat-audit.md` documenting:

1. Which transitive imports of `@prisma-next/postgres/runtime` (if any) fail to load under `nodejs_compat` and why.
2. What happens end-to-end if you wire `postgres({ pg: new Client({ connectionString: env.HYPERDRIVE.connectionString }) })` today (does it work, partially work, or fail?).
3. Whether `pg-cursor` actually works in Workers under `nodejs_compat` (open a cursor, read in batches, close it). The wrapper's existing `cursor: { disabled: true }` is a separate concern; the audit needs an empirical answer for the Workers/Hyperdrive path.
4. The chosen topology (a/b/c) with rationale.
5. Bundle-size baseline if we can produce one (no budget enforcement, just a reading).

**Tasks:**

- [ ] **1.1 — Spike: minimal Worker that imports `@prisma-next/postgres/runtime`** — scaffold throwaway Worker (under `wip/` or in the audit notes), enable `nodejs_compat`, `wrangler dev` it, observe import errors. Record findings. (Decision input; unblocks: TC-8, TC-9, TC-10.)
- [ ] **1.2 — Spike: end-to-end query through Hyperdrive with `pgClient` binding** — run a `postgres({ pg: new Client({ connectionString: env.HYPERDRIVE.connectionString }) })` flow against a local Postgres in `wrangler dev` (using `localConnectionString` so we don't need a real Hyperdrive). Try a simple SELECT, an ORM call, and a transaction. Note what works and what doesn't. (Decision input.)
- [ ] **1.3 — `pg-cursor` Workers compatibility check** — empirically run a cursor-based query through the spike worker (open cursor, read 100 rows, read another 100, close). Confirm whether `pg-cursor` works under `nodejs_compat`, and whether it's statically imported regardless of `cursor: { disabled: true }` (informs bundle-size). Record outcome. (Unblocks: TC-8a or TC-8b.)
- [ ] **1.4 — Bundle size baseline** — `wrangler deploy --dry-run` (or `--outdir`) on the spike worker; record compressed bundle size and largest contributors. (Informs AC-17.)
- [ ] **1.5 — Decision: driver topology** — synthesize 1.1–1.4 into the audit doc. Pick (a) new binding kind on existing driver, (b) sibling driver package, or (c) wrapper-only. Record rationale and update spec Decision §1 if needed. (Unblocks all M2 tasks.)

**Validation gate:**

- `pnpm lint:deps` (no code touched in production packages, but cheap to run)
- Audit doc exists at `projects/cloudflare-hyperdrive-runtime/assets/workers-compat-audit.md` with all five sections filled in
- Spike code lives under `wip/` (per the WIP rule) and is not committed to the project's deliverable surface

### Milestone 2: Driver / wrapper changes

**Goal:** Implement whichever option (a/b/c) the M1 audit selected, with full unit-test coverage. The Hyperdrive code path is reachable via `postgres({ hyperdrive: env.HYPERDRIVE })`. Existing input variants are untouched.

**Tasks (assuming the audit picks option (a) — adjust task list if (b) or (c) is chosen):**

- [ ] **2.1 — Add Hyperdrive `PostgresBinding` kind** — extend `PostgresBinding` in [`packages/3-targets/7-drivers/postgres/src/postgres-driver.ts`](packages/3-targets/7-drivers/postgres/src/postgres-driver.ts) with `{ kind: 'hyperdrive', binding: HyperdriveLike }`. Add a structural `HyperdriveLike` type so we don't force `@cloudflare/workers-types` on consumers. (Satisfies: TC-10.)
- [ ] **2.2 — Implement per-request driver path** — new `PostgresHyperdriveDriverImpl` (or factory) inside the postgres driver package: per-`acquireConnection` `pg.Client`, `connect()` on use, `end()` on release/destroy. No `Pool`, no `Cursor`. Wire into `createBoundDriverFromBinding`. (Satisfies: TC-6, TC-9.)
- [ ] **2.3 — Cursor vs. buffered wiring on the Hyperdrive path** — implement whichever the M1 audit selected:
  - If cursors work: keep `pg-cursor` reachable on the Hyperdrive driver path; let the wrapper expose `cursor` config the same way it does today. (Satisfies: TC-8a.)
  - If cursors don't work: ensure the Hyperdrive driver path never reaches `executeWithCursor`, with a guard + unit test, and document the limitation. (Satisfies: TC-8b.)
- [ ] **2.4 — Wrapper input variant** — extend [`packages/3-extensions/postgres/src/runtime/binding.ts`](packages/3-extensions/postgres/src/runtime/binding.ts) and `postgres.ts` to accept `hyperdrive: env.HYPERDRIVE` and translate to the new `PostgresBinding` kind. Update `PostgresBindingInput` discriminated union. (Satisfies: TC-10, TC-11.)
- [ ] **2.5 — Unit tests** — for the new binding kind, the per-request driver lifecycle (mocked `pg.Client`), the wrapper input variant, and assertions that no `Pool`/`Cursor` is constructed. Existing wrapper unit tests must pass unchanged. (Satisfies: TC-6, TC-8, TC-9, TC-10, TC-11, TC-19, TC-24, TC-25.)
- [ ] **2.6 — Type plumbing** — `@cloudflare/workers-types` as `devDependency` of the wrapper package; structural `HyperdriveLike` exported as the public type. Update README of both touched packages per the doc-maintenance rule.
- [ ] **2.7 — Architecture/ADR review touch** — confirm no `architecture.config.json` updates are needed (the new binding lives in the same package); if any cross-package import was added, update `architecture.config.json` and verify `pnpm lint:deps`. (Satisfies: TC-17, TC-25.)

**Validation gate:**

- `pnpm typecheck`
- `pnpm test --filter @prisma-next/driver-postgres --filter @prisma-next/postgres`
- `pnpm test:packages` (workspace-wide; ensures no consumer regression)
- `pnpm lint:deps`
- `pnpm build --filter @prisma-next/driver-postgres --filter @prisma-next/postgres` (refreshes `dist/*.d.mts` per CLAUDE.md guidance)

### Milestone 3: Example Worker app + integration tests

**Goal:** A deployable Cloudflare Worker example mirroring `examples/prisma-next-demo`, with `wrangler dev` for ad-hoc development and a `vitest-pool-workers` integration test in CI exercising the full surface.

**Tasks:**

- [ ] **3.1 — Scaffold `examples/prisma-next-cloudflare-worker`** — `package.json`, `wrangler.jsonc` with `nodejs_compat`, `tsconfig.json`, `prisma-next.config.ts`. Schema and operations mirror `examples/prisma-next-demo` per spec Decision §6. Use `wrangler hyperdrive create` (driven by the maker, not committed) to provision the binding ID; document the steps in the README.
- [ ] **3.2 — Implement Worker `fetch` handler** — at minimum: a route that runs a SQL DSL `SELECT`, a route that runs an ORM `findMany`, and a route that runs a multi-statement transaction. Use the new `postgres({ contract, hyperdrive: env.HYPERDRIVE })` ergonomics. (Satisfies: TC-2, TC-3, TC-4, TC-5.)
- [ ] **3.3 — Local dev wiring** — `wrangler.jsonc` references `localConnectionString` from `.dev.vars` (gitignored). Add a `docker-compose` or a script that brings up a local Postgres pre-seeded with the demo data. Document in the example README. (Satisfies: TC-15, TC-23.)
- [ ] **3.4 — `vitest-pool-workers` integration test** — new test file (likely in the example or in `test/integration/`) that boots the Worker under `workerd` via `vitest-pool-workers`, points at a local Postgres, and exercises TC-1 through TC-5, TC-7, TC-12, TC-13. Wire into CI via the existing test runner (likely as part of `test:examples` or a new filter). (Satisfies: TC-1, TC-2, TC-3, TC-4, TC-5, TC-7, TC-12, TC-13, TC-16, TC-20.)
- [ ] **3.5 — Example README** — setup steps (Postgres origin, `wrangler hyperdrive create`, `wrangler.jsonc` binding, `.dev.vars`, `wrangler dev`, `wrangler deploy`), known limitations (no streaming, transaction affinity), troubleshooting. (Satisfies: TC-15.)
- [ ] **3.6 — Bundle size measurement** — `wrangler deploy --dry-run` in the example; record compressed size in the README and in the audit doc / spec. (Satisfies: TC-21.)
- [ ] **3.7 — Cold-start best-effort benchmark** — run `findMany({ take: 10 })` against `wrangler dev` cold-start; record p50; if > 200 ms, document in spec/plan rather than blocking. (Satisfies: TC-22.)
- [ ] **3.8 — `fixtures:check` parity** — if the example has emitted contract artifacts, ensure `pnpm fixtures:check` passes (per AGENTS.md guidance to use `fixtures:check` not ad-hoc emit-and-diff).

**Validation gate:**

- `pnpm typecheck:all`
- `pnpm test:examples --filter prisma-next-cloudflare-worker` (or whatever filter the new package needs)
- `pnpm test:packages` (no regressions)
- `pnpm lint:deps`
- `pnpm fixtures:check`
- `pnpm build` (full)

### Milestone 4: Docs, real-world smoke verification, and close-out

**Goal:** Ship the deployment guide, prove the example works against a real Cloudflare account + real Hyperdrive, verify all acceptance criteria, and close out the project (migrate long-lived docs into `docs/`, delete `projects/cloudflare-hyperdrive-runtime/`).

**Tasks:**

- [ ] **4.1 — Write `docs/products/Deploying to Cloudflare Workers with Hyperdrive.md`** (exact path TBD with docs team) — architecture diagram, setup steps, lifecycle expectations, migrations story, known limitations. Cross-link from `docs/README.md` and `docs/onboarding/Getting-Started.md` if appropriate. (Satisfies: TC-16.)
- [ ] **4.2 — `wrangler deploy` smoke test** — deploy the example to a real Cloudflare account against a real Hyperdrive config (PPg or similar origin). Run `findMany`, ORM call, and transaction via real HTTPS request. Record outcomes in the audit doc. (Satisfies: TC-14.)
- [ ] **4.3 — AC verification pass** — walk every AC in the spec, confirm the corresponding TC has passed, link the evidence (test file + line, doc anchor, deploy URL). Record in `projects/cloudflare-hyperdrive-runtime/assets/ac-verification.md` (will be deleted at close-out, but useful for the close-out PR description).
- [ ] **4.4 — Migrate long-lived docs into `docs/`** — the new deployment guide stays in `docs/`. The audit + AC-verification stay under `projects/` (transient). If a new ADR is warranted (e.g. "Workers-aware driver lifecycle"), draft it under `docs/architecture docs/adrs/`.
- [ ] **4.5 — Strip repo-wide references to `projects/cloudflare-hyperdrive-runtime/**`** — search for any links from `docs/`, READMEs, scripts; replace with canonical `docs/` links or remove. (Per drive-project-workflow.mdc.)
- [ ] **4.6 — Delete `projects/cloudflare-hyperdrive-runtime/`** — final commit on the close-out PR removes the project directory. PR title or body must reference `(TML-2369)` so Linear's GitHub integration auto-completes the issue.

**Validation gate:**

- `pnpm typecheck:all`
- `pnpm test:all` (full sweep before close-out)
- `pnpm lint:deps`
- `pnpm lint:docs`
- `pnpm fixtures:check`
- `pnpm build`
- Manual: real `wrangler deploy` succeeds and serves expected response (TC-14)
- Manual: AC-verification doc is complete; every AC has linked evidence

## Open Items

Carried forward from the spec or surfaced during planning. Most resolve during execution.

1. **Driver topology (a/b/c)** — decided in M1 task 1.5. Plan tasks in M2 are written assuming option (a); if (b) or (c) is chosen, M2 task list is rewritten before M2 starts.
2. **`pg.Client` lifecycle when `acquireConnection` is called multiple times within one Worker request** — for the ORM client + a separate `connection()` call in the same `fetch`, do we open one `pg.Client` per `acquireConnection`, or do we reuse one per request via a request-scoped cache? Decide in M2 task 2.2 with a unit test pinning the behavior.
3. **Where to install `vitest-pool-workers`** — root devDependency vs. example-local. Decide in M3 task 3.4. Probably example-local.
4. **Cloudflare account for the smoke test (M4 task 4.2)** — needs a Cloudflare account with a Hyperdrive entitlement and a Postgres origin. The maker provisions or borrows; not blocking M1–M3.
5. **Whether to draft a new ADR** for "Workers-aware driver lifecycle" — depends on what the M1 audit + M2 changes look like. Decide in M4 task 4.4.
6. **PPg as the smoke-test origin** — currently aspirational. If PPg's preflight or networking story isn't ready, fall back to Neon or AWS RDS for the smoke test. The spec is generic to any Postgres origin; PPg-specific verification can be a follow-up.
7. **`AsyncIterable<Row>` semantics if we end up buffered** — only relevant if the M1 audit decides cursor support is not viable on the Workers path. With buffered execution, the iterable yields all rows after the query completes (not while it streams), and `break`-mid-iteration cancels nothing. If we land on buffered, confirm no consumer in the SQL/ORM lanes assumes streaming-as-it-arrives semantics, and document the limitation in the deployment guide. If cursors work, this open item closes.
