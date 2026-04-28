# Supabase PoC — Plan

## Summary

Five milestones, in dependency order. Each ends with a one-line statement of what is observably true after it lands. Friction encountered during any milestone is recorded in [`framework-limitations.md`](framework-limitations.md) as it happens — not at the end.

**Spec:** [`spec.md`](spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution |

## Working rules for this project

These come from repo conventions ([`AGENTS.md`](../../AGENTS.md), [`.cursor/rules/`](../../.cursor/rules/)) and the spec's non-functional requirements. Reproduced here so the implementer doesn't have to hunt them down.

- **Tests first.** Every implementation task is preceded by a test task that captures the requirements it satisfies. The test task lands first; the implementation task makes it pass.
- **No edits to `packages/`.** Verified by `git diff main -- packages/` being empty before opening the PR (R-NF-1). If a milestone wants to "just add this one thing to the postgres adapter," it doesn't — it gets a `FL-NN` entry.
- **Friction captured continuously.** Any commit that introduces a workaround also adds the corresponding `FL-NN` entry in `framework-limitations.md`. No retrospective sweep at the end.
- **Skill captured continuously.** Whenever a milestone surfaces an opinionated decision, footgun, or anti-pattern worth advising future authors about, the corresponding section of `projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md` is updated on the same commit (R-FK-6). Same posture as `framework-limitations.md`.
- **Commit-as-you-go.** Small, focused commits with intent-driven messages. Don't batch.
- **Vitest.** Unit + integration tests live under `examples/supabase-todos/test/`. Integration tests assume `supabase start` is running locally; they are not run in CI.
- **CLI-first migration authoring.** Migrations are scaffolded by the `prisma-next migration` CLI, never hand-authored from a blank file. `prisma-next migration plan` derives `createTable` / `addForeignKey` / `addColumn` / etc. from the contract diff and writes a populated `migrations/<ts>_<name>/migration.ts`; `prisma-next migration new` scaffolds an empty `migration.ts` for cases where the planner has nothing to derive (pure `rawSql` ops, RLS-only follow-ups, etc.). The author then *edits* the scaffolded file to add ops the planner can't see — e.g. RLS bolt-on (FL-01's planner-side facet) or cross-schema FKs (FL-02). This is the same workflow a normal user would follow; the example demonstrates it rather than skipping past it.

## Phases and validation gates

The plan executes in **12 phases**. Each phase is one implement→review cycle in the orchestration loop. Phase IDs are stable references and are how the orchestrator addresses each round.

### Default validation gates

Every phase that touches the example runs these gates as a prerequisite for SATISFIED. The implementer runs them before declaring done; the reviewer treats them as the bar.

- `pnpm --filter supabase-todos typecheck`
- `pnpm --filter supabase-todos test` (or a scoped invocation when the round only touches a subset)
- `pnpm lint:deps`
- `git diff origin/main -- packages/` returns empty (enforces R-NF-1 / R-NF-2)

Phases that don't touch the example (e.g. `phase-close` after the example is migrated) run only the gates relevant to their scope; named explicitly per phase below.

### Phase index

| Phase | Tasks | One-line outcome | Phase-specific gates (in addition to default) |
|---|---|---|---|
| `phase-1a` | 1.1–1.3 | Example scaffolded; Supabase services config committed; PN contract emits cleanly. | `pnpm --filter supabase-todos contract:emit` succeeds; `supabase status` shows the local stack up. |
| `phase-1b` | 1.4–1.5 | RLS migration factories exist with passing tests-first vitest spec. | `pnpm --filter supabase-todos test test/migrations/rls-ops.test.ts` green; integration leg requires `supabase start`. |
| `phase-1c` | 1.6–1.7 | Initial PN migration applies; seed script populates fixtures. | `pnpm --filter supabase-todos migrate:up` succeeds; `pnpm --filter supabase-todos seed` idempotent (re-run leaves no duplicates). |
| `phase-1d` | 1.8–1.9 | Admin (service-role) runtime exists; vitest smoke tests pass. | `pnpm --filter supabase-todos test test/runtime/admin.test.ts` green. |
| `phase-1e` | 1.10–1.11 | Example `README.md` covers the M1 sequence; agent skill seeded with valid frontmatter and all eleven section headers. | Skill frontmatter parses (e.g. via `js-yaml`); `README.md` step list runs end-to-end on a fresh checkout. |
| `phase-2` | 2.1–2.4 | `createSupabaseRuntime` in transaction mode; integration tests prove RLS isolation, parallel-scope safety, error handling. | `pnpm --filter supabase-todos test test/runtime/factory.test.ts` green; type test in 2.3 compiles. |
| `phase-3` | 3.1–3.3 | *(stretch)* Connection-scope mode; same matrix passes against direct URL. | Parameterized integration matrix green for both modes. |
| `phase-4a` | 4.1–4.4 | Hono JWT-verification middleware + per-request scoped-runtime middleware; both vitest-tested. | `pnpm --filter supabase-todos test test/server/middleware/` green. |
| `phase-4b` | 4.5–4.8 | Todos JSON API + public messages endpoint; integration tests with two real users prove handlers don't filter manually. | `pnpm --filter supabase-todos test test/server/routes/` green. |
| `phase-4c` | 4.9–4.13 | Vite SPA: auth, todos page, realtime, public board; example `README.md` updated with `pnpm dev` step and two-tab demo procedure. | `pnpm --filter supabase-todos dev` boots without runtime errors; manual two-tab procedure documented in README. |
| `phase-5` | 5.1–5.6 | `framework-limitations.md` review-ready (every workaround `FL-NN`-tagged); three design sketches written; skill finalised; spec acceptance pass. | All `FL-NN` cross-links resolve; SKILL.md frontmatter still validates; spec checkboxes either ticked or have a documented `FL-NN`. |
| `phase-close` | C.1–C.5 | Skill migrated to `.claude/skills/`; repo-wide refs to `projects/supabase-poc/` stripped; project directory removed. | `rg 'projects/supabase-poc' . -g '!wip/'` returns empty; SKILL.md frontmatter validates at the new path; `git mv` history preserved. |

The orchestrator may revise this index between rounds (adding sub-phases, splitting a phase that grows too large) but only with a recorded plan amendment. See [`reviews/code-review.md` § Orchestrator notes](reviews/code-review.md#orchestrator-notes) for any such amendments.

## Milestones

### Milestone 1 — Local stack + schema + RLS authoring + plain PN roundtrip

> **After this milestone:** A fresh clone reaches a running local Supabase stack with the demo's tables and RLS policies authored in TypeScript and applied by PN's `MigrationCLI`. A vitest suite proves PN can talk to the database. RLS is in place but not yet *enforced* through the request runtime — that is M2.

This milestone exercises **two** parts of PN against a real Supabase database: the contract / runtime stack, and the migration system. The example introduces a small set of in-example RLS migration operation factories and uses them to author the demo's policies.

**Tasks:**

- [ ] **1.1 Scaffold `examples/supabase-todos/`.**
  Mirror the layout of `examples/prisma-next-demo/`: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `biome.jsonc`. Workspace deps: `@prisma-next/sql-runtime`, `@prisma-next/sql-lane`, `@prisma-next/sql-relational-core`, `@prisma-next/sql-contract`, `@prisma-next/adapter-postgres`, `@prisma-next/target-postgres` (provides `MigrationCLI` + the migration factories), `@prisma-next/driver-postgres`. NPM deps: `@supabase/supabase-js`, `pg`, `hono`, `jose`. Workspace-pin all PN deps via `workspace:*`. `package.json` scripts wired up: `contract:emit`, `migrate:up`, `seed`, `dev`, `test`.
- [ ] **1.2 Add Supabase config (services only).**
  Commit `examples/supabase-todos/supabase/config.toml`. **No `supabase/migrations/*.sql`** and no `seed.sql` — app-schema migrations are PN-driven (see 1.6) and seeding is a script (see 1.7). The Supabase CLI bootstraps `auth.*`, `realtime.*`, etc. on its own when `supabase start` runs.
- [ ] **1.3 Author the PN contract (TS DSL).**
  Under `examples/supabase-todos/src/db/schema.ts`, author the contract for `profiles`, `todos`, `public_messages` (column types only; RLS is not represented in the contract — note this in `framework-limitations.md` as friction). Wire `pnpm --filter supabase-todos contract:emit` (mirror `examples/prisma-next-demo`) to produce `contract.json` and `contract.d.ts`.
- [ ] **1.4 (Test) Vitest spec for the RLS migration factories.**
  Tests-first per [working rules](#working-rules-for-this-project). Under `examples/supabase-todos/test/migrations/rls-ops.test.ts`. Cover R-FM-1 through R-FM-7 (spec):
  - **Unit**: `enableRowLevelSecurity('public', 'todos')` returns an `Op` whose `execute[0].sql` matches `ALTER TABLE "public"."todos" ENABLE ROW LEVEL SECURITY` (exact, with quoted identifiers); `precheck` queries `pg_class.relrowsecurity = false`; `postcheck` queries `relrowsecurity = true`.
  - **Unit**: `createRlsPolicy({ schema, table, name, command: 'SELECT', to: ['authenticated'], using: '(user_id = auth.uid())' })` emits the expected `CREATE POLICY "..."  ON "public"."todos" FOR SELECT TO "authenticated" USING ((user_id = auth.uid()))` (verbatim `using`/`withCheck`).
  - **Unit**: omitted optional fields produce defaults (`command: 'ALL'`, no `TO` clause → policy applies to PUBLIC, no `USING` / `WITH CHECK`).
  - **Unit**: identifiers `'1bad'`, `'has space'`, `'inj"ect'`, `''` cause a synchronous throw with a clear error from `enableRowLevelSecurity`, `createRlsPolicy`, and `dropRlsPolicy` before any string concatenation runs (R-FM-2).
  - **Unit**: each factory's `Op` carries the conventional fields (`id`, `label`, `summary`, `target`, `operationClass`); `dropRlsPolicy` is `'destructive'`; the others are `'additive'` (R-FM-4, R-FM-5).
  - **Integration** (against `supabase start`): apply a small migration that creates a table, enables RLS, and adds one policy via the factories using `MigrationCLI` programmatically; assert `pg_policies` reflects it; re-run the migration and assert the precheck failure is surfaced cleanly (R-FM-6).
- [ ] **1.5 Implement the RLS migration factories.**
  Under `examples/supabase-todos/src/db/migrations/rls-ops.ts`. Exports `enableRowLevelSecurity`, `createRlsPolicy`, `dropRlsPolicy` with the signatures in [`spec.md` § Migration operation factories for RLS](spec.md#migration-operation-factories-for-rls-in-the-example). Internals:
  - Built on `rawSql({ id, label, summary, operationClass, target, precheck, execute, postcheck })` from `@prisma-next/target-postgres/migration`.
  - Identifier validation: small local helper `validateIdent(value, slot)` against `^[A-Za-z_][A-Za-z0-9_]*$`; throws synchronously on miss.
  - Identifier rendering: local `quoteIdentifier` (or pulled from a small in-example utility — do **not** reach into private adapter internals; if a public quote helper isn't exported, a 3-line in-example version is fine and is itself a `FL-NN`).
  - `target.id = 'postgres'`, `target.details.objectType = 'dependency'` (the `OperationClass` union has no `'policy'` value — see spec; record as `FL-NN` on the same commit).
  - Pre/postcheck steps query `pg_policies` (and `pg_class.relrowsecurity` for `enableRowLevelSecurity`); SQL composed with parameter placeholders where possible.
  - Confirm 1.4's tests pass.
- [ ] **1.6 Scaffold the initial migration via the CLI; bolt RLS on by hand.**
  This task demonstrates the [CLI-first migration authoring](#working-rules-for-this-project) workflow end-to-end. The planner does what it can from the contract; the author edits to add what the planner can't see (RLS bolt-on, FL-01's planner-side facet).
  - **Step 1 — scaffold from the contract.** From `examples/supabase-todos/`, run `pnpm exec prisma-next migration plan --name initial`. The planner reads the emitted contract (1.3) and writes `migrations/<ts>_initial/migration.ts` populated with the `createTable` ops it derived for `profiles`, `todos`, `public_messages` (3 tables, snake_case columns per the contract's `naming` config). The scaffolded file already includes the `MigrationCLI.run(import.meta.url, M)` footer and a populated `toContract` reference. **No hand-authoring of `createTable` ops.**
  - **Step 2 — edit to add the RLS bolt-on.** Open the scaffolded `migration.ts` and append calls to the in-example RLS factories from 1.5:
    - `enableRowLevelSecurity('public', 'profiles' | 'todos' | 'public_messages')` for all three tables.
    - `createRlsPolicy(...)` for the policy set:
      - `profiles`: `SELECT` and `UPDATE` for `authenticated` where `(id = (auth.uid())::text)` (cast on the function side per FL-03; SKILL.md §6).
      - `todos`: `SELECT` / `INSERT` / `UPDATE` / `DELETE` for `authenticated` with `using` / `withCheck` of `(user_id = (auth.uid())::text)`. No policy for `anon` (effectively zero rows).
      - `public_messages`: `SELECT` for `anon` *and* `authenticated` (`using: true`); `INSERT` for `authenticated` with `withCheck` of `(author_id = (auth.uid())::text)`.
  - **Step 3 — re-attest.** Run `pnpm exec tsx migrations/<ts>_<slug>/migration.ts` (or `pnpm --filter supabase-todos migrate:up` which goes through `prisma-next migration apply`) so the runner re-derives `ops.json` from the edited body and re-attests the package. Use `tsx`, not `node` directly — the file is TypeScript and Node's ESM loader doesn't compile `.ts` (`ERR_MODULE_NOT_FOUND`); the CLI's scaffold-time shebang+exec-bit are misleading on this point and tracked as FL-05.
  - **Step 4 — document the workflow in the migration's docblock.** A short header comment naming `migration plan` as the source of the table ops and explaining that the RLS ops were bolted on by hand (with cross-link to FL-01's planner-side facet). This is what makes the example pedagogical for the next user, rather than just "a working migration."
  - **Heads-up on cross-schema FKs (FL-02).** The planner cannot emit a `REFERENCES auth.users(id)` FK because `auth.users` is in another schema and the contract IR has no surface for it. Per the FL-02 decision (PoC-major-finding; production-blocker), the FK is omitted entirely; integrity is enforced application-side via the seed script and the `INSERT` policies' `withCheck`. Document this omission in the docblock alongside the RLS bolt-on note.
  - Use the **service-role** URL for `migrate:up` (RLS bypass; documented in 1.9).
- [ ] **1.7 Seed script.**
  Under `examples/supabase-todos/scripts/seed.ts`. Uses `@supabase/supabase-js` admin client (with the local service-role key from `supabase status`) to create two test users (`alice@example.test`, `bob@example.test`) and insert a few fixture rows in `todos` (owned by each) and `public_messages`. Idempotent — re-running it does not duplicate rows. Wired to `pnpm --filter supabase-todos seed`.
- [ ] **1.8 Plain PN runtime against `service_role` URL.**
  Under `examples/supabase-todos/src/server/db.ts`, build a stack (`postgresTarget`, `postgresAdapter`, `postgresDriver`), an `ExecutionContext` from the contract, and a plain `Runtime` bound to the local Supabase service-role URL (which bypasses RLS — appropriate for migrations/seeds/admin, not request handlers). This runtime is the "admin" runtime, used by the seed script and any maintenance tasks, not by request handlers.
- [ ] **1.9 Vitest smoke tests for the bare runtime.**
  Under `examples/supabase-todos/test/runtime/admin.test.ts`. Pre-seeded fixtures from 1.7. Assert PN reads all rows when RLS is bypassed (service-role) and that the contract types align with what the runtime returns. Baseline before M2 layers RLS on.
- [ ] **1.10 Example `README.md`.**
  Document the one-shot setup sequence: install Supabase CLI; `pnpm install`; `supabase start`; `pnpm --filter supabase-todos contract:emit`; `pnpm --filter supabase-todos migrate:up`; `pnpm --filter supabase-todos seed`; `pnpm --filter supabase-todos test`. Include a paragraph on which connection URL is used where (service-role for `migrate:up` / seed / admin runtime; pooled URL for the request runtime — pre-stating M2). Defer the `pnpm dev` step until M4.
- [ ] **1.11 Seed the agent skill.**
  Create `projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md` with valid frontmatter (`name: writing-rls-policies-with-pn`, action-oriented `description`) and all eleven required sections from [spec.md § The agent skill](spec.md#the-agent-skill-writing-rls-policies-with-pn) as headings. Fill the sections that are answerable now (Where to write it, Mandatory steps, Role targeting, the migration-factory examples — directly cribbed from 1.6's migration file). Remaining sections are kept as headers + a "TODO: populate when M2/M4 surfaces evidence" line so they're impossible to miss in subsequent commits. Cross-link to `framework-limitations.md` and to the example migration. (R-FK-1, R-FK-2 partial.)

### Milestone 2 — RLS via the userspace factory (transaction mode)

> **After this milestone:** Server code can produce a per-request RLS-scoped runtime; queries against `todos` return only the authenticated user's rows; the realistic Supabase pooled URL is supported.

This is the headline milestone of the PoC. Implements `createSupabaseRuntime` in `'transaction'` mode and proves it.

**Tasks:**

- [ ] **2.1 Vitest spec for the factory (tests-first).**
  Write the integration test before the implementation. Cover requirements R-FX-1, R-FX-2, R-FX-4, R-FX-5, R-FX-6, R-FX-7, R-FX-8 from the spec. Concretely:
  - Two seed users A, B; A has 2 todos, B has 3.
  - Authenticated as A: `SELECT * FROM todos` returns 2 rows, all A's. Same for B → 3 rows.
  - Authenticated as `anon` with no claims: `SELECT * FROM todos` returns 0 rows; `SELECT * FROM public_messages` returns the seeded messages.
  - 50 parallel `authenticate()` calls with distinct claims, each issuing a query, see no cross-contamination.
  - `authenticate({ role: 'totally-not-allowed' })` throws synchronously; no SQL is sent to the database (verified via a query log middleware on the test pool).
  - Pool with `max: 2`, 10 concurrent scoped queries: all complete; pool's `.idleCount + .waitingCount` returns to baseline within 100 ms.
  - A `for await` loop that throws mid-iteration: the wrapping transaction is rolled back, the connection is evicted from the pool (verified via `pool.totalCount` decreasing), and the original error reaches the caller.
  - `session.beginTransaction()` throws synchronously with `runtime/unsupported-scoped-tx`.
- [ ] **2.2 Implement `createSupabaseRuntime` (`'transaction'` mode).**
  Under `examples/supabase-todos/src/server/supabase-runtime.ts`. Internals:
  - Public surface: `createSupabaseRuntime({ context, pool, scopeMode, allowedRoles })` returning `{ authenticate({ jwtClaims, role }) → SupabaseSession }`. `SupabaseSession` is structurally a `SqlRuntime` plus `end(): Promise<void>`.
  - Implementation: a custom `SqlDriver` wrapper conforming to the existing driver SPI (`acquireConnection`, `query`, `execute`, `explain`, `connect` (no-op), `close`, `state`).
  - Each `acquireConnection()`: borrow `PoolClient`; `await client.query('BEGIN')`; `await client.query('SET LOCAL request.jwt.claims = $1', [JSON.stringify(jwtClaims)])`; if `role`, `await client.query('SET LOCAL ROLE ' + quoteIdent(validatedRole))` (role is allowlist-validated; identifier-quoted, not parameterized — `SET ROLE` doesn't accept parameters in Postgres). Return a `SqlConnection` proxy whose `release()` does `COMMIT; release` and whose `destroy(reason?)` does `ROLLBACK; release(reason)`.
  - On any error during the `BEGIN`/`SET LOCAL` phase: best-effort `ROLLBACK`, `client.release(error)`, rethrow normalized error.
  - `beginTransaction()` on the proxy throws `runtime/unsupported-scoped-tx`.
  - The wrapper does **not** own the pool. `close()` on the wrapper is a no-op.
  - Reuse the existing cursor / `execute` machinery from `@prisma-next/driver-postgres` rather than reimplementing it; the wrapper is a thin connection-acquisition layer over the same `PostgresQueryable` shape. (If composition turns out to be impossible without copy-paste, that's an `FL-NN`.)
  - Confirm 2.1's tests pass.
- [ ] **2.3 TS type test: factory output is `SqlRuntime`-compatible.**
  Add a type test asserting `ReturnType<Factory['authenticate']>` is structurally assignable to `SqlRuntime`. Catches drift if the upstream `SqlRuntime` shape changes.
- [ ] **2.4 Update `framework-limitations.md`.**
  At minimum: an entry covering "user transactions inside a scoped runtime are unsupported" (R-FX-8 / FL-NN). Anything else hit during 2.2 lands here too.

### Milestone 3 — Connection-scope mode *(stretch)*

> **After this milestone:** The factory also supports direct/session-mode connections with zero per-query overhead.

Optional. Spec accepts that this may be descoped if M2 takes longer than expected — in which case R-FX-3 moves to `framework-limitations.md` as a known gap and we close the PoC at M5.

**Tasks:**

- [ ] **3.1 Vitest spec for `'connection'` mode (tests-first).**
  Same matrix as 2.1, parameterized so each test runs once in `'transaction'` mode against the pooled URL and once in `'connection'` mode against the direct URL. Include a connection-mode-specific test: `session.beginTransaction()` works (the wrapper delegates).
- [ ] **3.2 Implement `'connection'` mode.**
  Borrow one `PoolClient` on `authenticate()`. On first `execute()`, run `SET request.jwt.claims = $1; SET ROLE <role>` once. Wrap the borrowed client in a 1-connection `SqlDriver`; build a `Runtime` around it. `session.end()` releases the client. Errors mid-query call `destroy(err)` rather than `release()`. `session.beginTransaction()` works (delegates to the underlying driver).
- [ ] **3.3 Auto-detect `scopeMode` (judgment call).**
  Helper `pickScopeMode(connectionString): ScopeMode` returning `'transaction'` for URLs containing `pgbouncer=true`, port `6543`, or matching known Supavisor patterns; otherwise `'connection'`. Exported alongside the factory. **If detection feels brittle in practice, drop it and require explicit choice** — record as `FL-NN`.

### Milestone 4 — HTTP API + UI + realtime

> **After this milestone:** The demo is complete: sign-in, todos CRUD, two-tab realtime, anon public board, all wired together.

All milestone-4 implementation tasks are preceded by a test task. UI behavior is verified manually (see `README.md` two-tab procedure); server endpoints and JWT-verification middleware are vitest-tested.

**Tasks:**

- [ ] **4.1 (Test) Hono JWT-verification middleware.**
  Vitest unit tests: valid token → request context populated with `{ jwtClaims, role }`; missing/invalid token → 401; explicitly-public route bypasses verification; expired token → 401 with stable error code.
- [ ] **4.2 Implement Hono JWT middleware.**
  Reads `Authorization: Bearer <token>`, verifies via `jose` against the local Supabase JWKS / shared secret. On success, attaches `c.var.jwt = { claims, role }` (role derived from `claims.role` defaulting to `'authenticated'`); on failure, returns 401. Public-route opt-out via a small `publicRoute()` helper.
- [ ] **4.3 (Test) Per-request scoped-runtime middleware.**
  Vitest unit tests: middleware calls `factory.authenticate(c.var.jwt)`, attaches the session to `c.var.db`, and `await session.end()` runs after the response (success and error paths). For unauthenticated public routes, attaches an anon session.
- [ ] **4.4 Implement per-request scoped-runtime middleware.**
  As described in 4.3. Errors during `end()` are logged but don't replace the original response error.
- [ ] **4.5 (Test) Todos JSON API.**
  Integration tests covering `GET /api/todos`, `POST /api/todos`, `PATCH /api/todos/:id`, `DELETE /api/todos/:id` with two real authenticated users. Crucially: assert that handler code does **not** include `WHERE user_id = ?` clauses — RLS handles isolation. A test that fakes a request with user A's token but asks for user B's todo by ID returns 404 (RLS-filtered to zero rows; handler returns 404 on empty).
- [ ] **4.6 Implement todos JSON API.**
  Endpoints under `examples/supabase-todos/src/server/routes/todos.ts`. Handlers use `c.var.db.execute(plan)` exclusively; no explicit per-user filtering.
- [ ] **4.7 (Test) Public messages endpoint.**
  Integration test: `GET /api/public/messages` returns seeded messages without a `Bearer` token. With a token, also returns them (authenticated users can read public).
- [ ] **4.8 Implement public messages endpoint.**
  Marked `publicRoute()`. The per-request-runtime middleware attaches an `anon`-scoped session; handler reads from `public_messages`.
- [ ] **4.9 Vite SPA — auth.**
  Login / signup form using `supabase.auth.signInWithPassword` / `signUp`. `apiFetch` helper attaches `supabase.auth.getSession().access_token` to outgoing requests. Sign-out wired.
- [ ] **4.10 Vite SPA — todos page.**
  Authenticated route. Lists current user's todos (from `GET /api/todos`); allows create / toggle complete / delete. Optimistic UI; reconciles on server response.
- [ ] **4.11 Vite SPA — realtime.**
  On the todos page, open `supabase.channel('todos:user:<uid>').on('postgres_changes', {schema: 'public', table: 'todos', filter: 'user_id=eq.<uid>'}).subscribe()`. Inserts/updates/deletes from the channel update the rendered list. **No PN code participates.** Document the two-tab demo procedure in the example's `README.md`.
- [ ] **4.12 Vite SPA — public board page.**
  Unauthenticated route calling `/api/public/messages`.
- [ ] **4.13 Update example `README.md`.**
  Add the `pnpm dev` step (deferred from 1.10), the two-tab realtime demo procedure, and the architectural diagram (browser → Hono → PN → Postgres + browser → Realtime → Postgres). Cross-link to `framework-limitations.md`.

### Milestone 5 — Consolidate findings + design sketches

> **After this milestone:** `framework-limitations.md` is review-ready: every workaround has an `FL-NN` entry, and three half-page design sketches close the doc.

Friction has been recorded continuously through M1–M4 (per the working rules). M5 is consolidation, not discovery.

**Tasks:**

- [ ] **5.1 Pass over `framework-limitations.md` for completeness.**
  Re-read `examples/supabase-todos/` looking for any workaround that didn't get an `FL-NN` entry. Any new entry added in this pass is itself a (mild) signal that the continuous-capture rule slipped — note the slip in the entry, so the team can calibrate next time.
- [ ] **5.2 Write the scoped-session SPI sketch.**
  Half a page. State the problem (no first-class concept of "runtime scoped to GUC profile + role"), propose two shapes (method on `SqlRuntime`; dedicated `SqlSessionScope` SPI on the driver), call out the trade-offs (interaction with `beginTransaction()`, capability gating, who picks transaction- vs connection-scope semantics).
- [ ] **5.3 Write the subscription lane sketch.**
  Half a page. Propose `db.subscribe(table).where(...) → AsyncIterable<ChangeEvent>`. Map onto `LISTEN/NOTIFY` for plain Postgres and onto Supabase Realtime for an adapter-level helper. Call out backpressure, replay, RLS-on-subscriptions trade-offs.
- [ ] **5.4 Write the RLS-aware contract metadata + lints sketch.**
  Half a page. Propose contract annotations (`@@rls(roles: [...])` PSL / `tables.todos.rls(...)` TS DSL) and a `SqlMiddleware` lint `rls/missing-session` that consults `plan.meta.refs.tables`. Note the dependency on Sketch 1.
- [ ] **5.5 Finalize the agent skill.**
  Re-read `projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md` against the completed example. Fill any remaining "TODO: populate" sections with concrete evidence collected during M2–M4 (anti-patterns hit, decisions made, performance notes). Verify each code snippet still compiles against the latest example. Ensure all `FL-NN` cross-links resolve. Re-run a self-check: would an agent who has never seen this codebase be able to follow the skill end-to-end and produce a correct policy? Record any gaps as `FL-NN` (suggesting framework-side fixes that would simplify the skill).
- [ ] **5.6 Spec acceptance pass.**
  Walk every checkbox in `spec.md` against the example, mark each one, or document why it's intentionally unchecked (and convert to `FL-NN` if appropriate).

### Close-out

- [ ] **C.1 Verify every acceptance criterion in [`spec.md`](spec.md).**
- [ ] **C.2 Decide whether to upstream anything.** Based on `framework-limitations.md`, propose follow-up project(s) for items the team agrees are worth lifting into framework packages. *(After PR review.)*
- [ ] **C.3 Migrate the agent skill to its permanent home.** Move `projects/supabase-poc/skills/writing-rls-policies-with-pn/` to `.claude/skills/writing-rls-policies-with-pn/` (single `git mv`). Fix relative links (the skill currently sits two levels closer to `projects/` and `examples/`; adjust paths accordingly). Verify frontmatter still validates. (Satisfies R-FK-5.)
- [ ] **C.4 Strip repo-wide references to `projects/supabase-poc/**`.** Replace with canonical `docs/` links or `.claude/skills/` links (for the skill — see C.3) or remove. Anything else worth keeping migrates to `docs/`. *(After merge.)*
- [ ] **C.5 Delete `projects/supabase-poc/`.** *(After merge; C.3 must have moved the skill out first.)*

## Test Coverage

Every requirement in [`spec.md`](spec.md#requirements) maps to at least one test or manual demo. Listed in the order requirements appear in the spec.

| Requirement | Test / Verification | Task |
|---|---|---|
| R-FE-1 (clean clone reaches demo) | Manual demo, README walkthrough | 1.10, 4.13 |
| R-FE-2 (sign-up/sign-in via SPA) | Manual demo | 4.9 |
| R-FE-3 (authenticated CRUD via SPA, all DB through PN) | Integration (server) + manual (UI) | 4.5, 4.6, 4.10 |
| R-FE-4 (two-tab realtime) | Manual demo, two-tab procedure | 4.11, 4.13 |
| R-FE-5 (anon page reads `public_messages`) | Integration + manual | 4.7, 4.8, 4.12 |
| R-FX-1 (transaction-mode RLS isolation) | Vitest integration | 2.1 |
| R-FX-2 (handlers don't filter by user, RLS does) | Vitest integration | 2.1, 4.5 |
| R-FX-3 (connection-mode RLS isolation) | Vitest integration *(stretch)* | 3.1 |
| R-FX-4 (no leakage across parallel scopes) | Vitest integration | 2.1 |
| R-FX-5 (role allowlist enforcement, no SQL on rejection) | Vitest unit | 2.1 |
| R-FX-6 (no connection leak under stress) | Vitest integration | 2.1 |
| R-FX-7 (mid-stream error → rollback + eviction) | Vitest integration | 2.1 |
| R-FX-8 (`beginTransaction()` in tx mode throws) | Vitest unit | 2.1 |
| R-FM-1 (factories exist & are used in the migration) | Vitest unit + manual review of `migrations/<ts>_initial/migration.ts` | 1.4, 1.5, 1.6 |
| R-FM-2 (identifier validation, synchronous throw) | Vitest unit | 1.4 |
| R-FM-3 (`using`/`withCheck` interpolated verbatim) | Vitest unit | 1.4 |
| R-FM-4 (`Op` shape: precheck/execute/postcheck consistent) | Vitest unit + integration | 1.4 |
| R-FM-5 (`dropRlsPolicy` mirrors `dropTable`) | Vitest unit | 1.4 |
| R-FM-6 (initial migration leaves DB in demo-ready state) | Vitest integration + manual `pnpm migrate:up` | 1.4, 1.6, 1.10 |
| R-FM-7 (only public migration surface used) | Code review + `git diff main -- packages/` | 1.5; close-out |
| R-FK-1 (skill exists with valid frontmatter) | Doc review | 1.11 |
| R-FK-2 (all eleven sections present and concrete) | Doc review | 1.11; continuous; 5.5 |
| R-FK-3 (code snippets compile against example, cross-links resolve) | Doc review + manual snippet check | 5.5 |
| R-FK-4 (skill cross-references `FL-NN` items it depends on) | Doc review | continuous; 5.5 |
| R-FK-5 (skill migrated to `.claude/skills/` at close-out) | Manual check | C.3 |
| R-FK-6 (skill updated continuously) | Commit history review | continuous |
| R-FG-1 (`framework-limitations.md` populated) | Doc review | continuous; 5.1 |
| R-FG-2 (three design sketches present) | Doc review | 5.2, 5.3, 5.4 |
| R-NF-1 (no `packages/` edits) | `git diff` check | continuous; close-out |
| R-NF-2 (no new package) | Repo audit | continuous |
| R-NF-3 (factory returns `SqlRuntime`-compatible) | TS type test | 2.3 |
| R-NF-4 (tests-first ordering) | Commit history review | continuous |
| R-NF-5 (friction logged continuously) | Commit history review | continuous |

## Open items

These are decisions deferred to execution time, not unresolved spec questions. Each has a "decide by" milestone.

| Item | Decide by | Default if not decided |
|---|---|---|
| Auto-detect for `scopeMode` is worth shipping | M3.3 | Drop; require explicit choice. Record as `FL-NN`. |
| Composition with existing `PostgresQueryable` is feasible without copy-paste | 2.2 | If not, copy with a clear comment + `FL-NN` entry. |
| Whether `@prisma-next/target-postgres/migration` exports a public `quoteIdentifier` helper | 1.5 | If not, write a 3-line in-example version + `FL-NN` entry; revisit during 5.1. |
| Supabase JWKS endpoint vs shared secret for local dev | 4.2 | Shared secret (simpler local setup). Document in README. |
| Whether `anon` page goes through the same per-request middleware or a dedicated path | 4.4 | Same middleware, anon session attached when no token. |

## Risks

- **Supabase CLI version drift** could break `supabase start` workflows between when the implementer scaffolds and when a reviewer runs the demo. Mitigation: pin Supabase CLI version in `README.md` and `.tool-versions`-style note.
- **`@supabase/supabase-js` realtime depends on Postgres logical replication being enabled** in the local stack. `supabase start` enables it by default; if a reviewer's environment doesn't, the realtime acceptance criterion would silently fail. Mitigation: README check ("verify replication is on") + an inline note in the realtime test setup.
- **The factory's wrapping driver may diverge from the postgres driver as PN evolves.** This is precisely the friction the gap doc is meant to capture. Not a blocker; record it.
