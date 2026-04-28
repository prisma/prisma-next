# Summary

Validate that a Supabase-style developer experience — RLS-protected per-request queries plus realtime UI — can be assembled on Prisma Next today, in userspace, with **no changes to framework packages**. Deliver:

1. a runnable example app under `examples/supabase-todos/`,
2. two thin **userspace toolkits** demonstrated in that app:
   - a `createSupabaseRuntime` runtime factory (RLS at query time),
   - a small set of `createRlsPolicy` / `enableRowLevelSecurity` migration operation factories (RLS at schema time),
3. a `framework-limitations.md` that records every friction point we hit, so the team can decide what (if anything) to upstream,
4. an agent skill `writing-rls-policies-with-pn` capturing when to use RLS in PN, how to express it with the migration factories, and security best practices. Authored in `projects/supabase-poc/skills/` during the PoC and migrated to `.claude/skills/` at close-out.

# Design

## The pattern: a userspace `createSupabaseRuntime` factory

The PoC introduces one new piece of code: a `createSupabaseRuntime` factory that lives **inside the example app** (not a framework package). It wraps the existing `@prisma-next/driver-postgres` to apply per-request RLS context (`request.jwt.claims` GUC + `ROLE`) and returns an ordinary PN `Runtime`. Server code authenticates a request, calls the factory, runs queries through the returned runtime, and disposes it on response completion.

```ts
const factory = createSupabaseRuntime({
  context,                            // ExecutionContext built from contract + stack
  pool,                               // shared pg.Pool for the process
  scopeMode: 'transaction',           // 'transaction' (default) | 'connection'
  allowedRoles: ['anon', 'authenticated'],
});

// per request:
const session = factory.authenticate({ jwtClaims, role: 'authenticated' });
try {
  for await (const row of session.execute(plan)) { ... }
} finally {
  await session.end();
}
```

**Key properties:**

- The returned `session` is structurally an ordinary `SqlRuntime`. Calling code treats it as such; nothing about the lane / plan / middleware story changes.
- The factory does not own the `pg.Pool`. The host process creates and owns it; the factory just borrows from it per scope.
- `authenticate()` is synchronous and cheap (the actual connection acquisition happens lazily on first `execute()`).
- `role` is validated against `allowedRoles` before being interpolated into `SET ROLE` (which is not parameterizable in Postgres). Disallowed values throw before any SQL runs.
- All RLS-relevant state (`request.jwt.claims`, `ROLE`) is set via parameterized `SET LOCAL` — never string-concatenated.

## Two scope modes, one default

The factory supports two implementations of "apply RLS context to this scope," chosen by `scopeMode`. They exist because Postgres deployments differ:

| `scopeMode` | When to use | Per-query overhead | Default? |
|---|---|---|---|
| `'transaction'` | Pooled URLs (Supavisor / pgbouncer transaction-mode). Connection is rebound between transactions, so only `SET LOCAL` inside `BEGIN..COMMIT` is safe. | 2 round-trips (`BEGIN; SET LOCAL …` and `COMMIT`) per plan. | **Yes — this is the production-realistic mode for Supabase.** |
| `'connection'` | Direct connections / session-mode poolers. State persists for the connection's lifetime. | Zero per-plan overhead after one-time `SET`. | No. Stretch goal; only built if M2 lands cleanly. |

**Transaction-scope mode (the primary path):**

- A `SqlDriver` wrapper is returned from `authenticate()`. Each call to its `acquireConnection()` borrows a `PoolClient` from the shared pool, issues `BEGIN`, then `SET LOCAL request.jwt.claims = $1` and `SET LOCAL ROLE <role>`, and returns a connection proxy. The proxy's `release()` issues `COMMIT` (or `ROLLBACK` if the connection is `destroy()`ed) and returns the client to the pool.
- `session.end()` is a no-op in this mode — every plan is already its own self-contained transaction.
- `session.beginTransaction()` (i.e. user-initiated transactions) is **out of scope** for this PoC. If invoked, the wrapper throws `runtime/unsupported-scoped-tx` with a clear message; the limitation is recorded as `FL-NN`. Reasoning: nesting an explicit user transaction inside the scope's implicit per-plan transaction has subtle semantics we don't want to figure out under PoC pressure.
- Mid-stream errors abort the cursor, roll back the wrapping transaction, release the connection (via `destroy()` so the pool evicts it), and re-throw the original error.

**Connection-scope mode (the stretch path):**

- `authenticate()` synchronously borrows one `PoolClient`, then on first `execute()` runs `SET request.jwt.claims = $1; SET ROLE <role>` once on it. A 1-connection `SqlDriver` is built around it; the `Runtime` wraps that driver.
- `session.end()` releases the client back to the pool. **Required** in this mode — without it the connection leaks.
- `session.beginTransaction()` works normally (the wrapped driver delegates).
- Errors mid-query call `destroy()` rather than `release()` so the pool evicts the connection (state may be indeterminate).

## The example app: where each piece lives

```
┌──────────────────┐                         ┌────────────────────┐
│   Vite SPA       │                         │  Local Supabase    │
│  (browser)       │ ───── HTTP ───────────► │   (docker)         │
│                  │                         │                    │
│ - supabase-js    │                         │ - GoTrue (auth)    │
│   • auth         │ ◄──── websocket ──────► │ - Realtime         │
│   • realtime     │                         │ - Supavisor pooler │
└──────────────────┘                         │ - Postgres         │
        │                                    └────────────────────┘
        │ Bearer token                                ▲
        ▼                                             │
┌──────────────────┐                                  │
│  Hono server     │ ─ pg pool ── createSupabaseRuntime
│  (Node)          │              authenticate({jwt})
│ - JWT verify     │                                  │
│ - todos JSON API │                                  │
│ - PN queries     │ ────────────────────────────────►│
└──────────────────┘
```

| Concern | Where | What |
|---|---|---|
| Auth (sign-in / token issuance) | Browser, via `@supabase/supabase-js` → local GoTrue | Out of PN's scope. Token returned to the browser, sent as `Bearer` to our Node server. |
| JWT verification | Node server, via `jose` against local Supabase JWKS / shared secret | Pure userspace; no PN involvement. |
| RLS-scoped queries | Node server, via `createSupabaseRuntime` + `authenticate()` | The PoC's central mechanism. |
| Realtime subscriptions | Browser, via `@supabase/supabase-js` realtime client | **PN is not involved.** The Node server is not involved. The browser opens a websocket directly to Supabase Realtime. RLS is enforced server-side by Realtime. |
| App-side schema authoring | TS-DSL contract under `src/db/schema.ts` → `contract.json` + `contract.d.ts` | Mirrors `examples/prisma-next-demo`. |
| App schema migrations (DDL) | PN migration files under `migrations/<ts>_*/migration.ts`, run by `MigrationCLI`. | Uses standard `createTable` / `addForeignKey` factories from `@prisma-next/target-postgres/migration`. |
| RLS enable + policy DDL | **Same PN migration files**, using a small set of in-example factories (`enableRowLevelSecurity`, `createRlsPolicy`, `dropRlsPolicy`) layered on top of the existing `rawSql` escape hatch. | Postgres owns enforcement at runtime; PN authors the policies. |
| Supabase-managed schemas (`auth.*`, `realtime.*`, etc.) | Supabase's own bootstrap (run by `supabase start`). | Untouched by us. |

**Server framework:** Hono (decided, not deferred — small footprint, modern types, pluggable).

**Domain:** a todos app with two roles:
- `anon`: read-only access to a `public_messages` table (a public board).
- `authenticated`: full CRUD on rows in `todos` where `user_id = auth.uid()`; can also read `public_messages`.

The public-board page is included specifically so the role-switching path through the factory is exercised, not just the authenticated path.

## Migration operation factories for RLS (in the example)

The PoC also introduces a small set of **migration operation factories** that let the example author RLS in TypeScript instead of as hand-written SQL files. They live in the example (`examples/supabase-todos/migrations/utils/rls-ops.ts`), import the public migration surface from `@prisma-next/target-postgres/migration`, and produce ordinary `Op` values usable inside any `Migration.operations` array.

**API:**

```ts
enableRowLevelSecurity(schema: string, table: string): Op;

dropRlsPolicy(schema: string, table: string, name: string): Op;

createRlsPolicy(spec: {
  schema: string;
  table: string;
  name: string;
  command?: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';   // default 'ALL'
  permissive?: 'PERMISSIVE' | 'RESTRICTIVE';                     // default 'PERMISSIVE'
  to?: ReadonlyArray<string>;                                    // omitted → PUBLIC
  using?: string;                                                // raw SQL expression
  withCheck?: string;                                            // raw SQL expression
}): Op;
```

**Demonstrated use** (`examples/supabase-todos/migrations/<ts>_initial/migration.ts`):

```ts
import { addForeignKey, createTable, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
import { createRlsPolicy, dropRlsPolicy, enableRowLevelSecurity } from '../utils/rls-ops';

export default class M extends Migration {
  override get operations() {
    return [
      createTable('public', 'todos', [/* … */], { columns: ['id'] }),
      addForeignKey('public', 'todos', { /* … */ }),
      enableRowLevelSecurity('public', 'todos'),
      createRlsPolicy({
        schema: 'public', table: 'todos', name: 'todos_select_own',
        command: 'SELECT', to: ['authenticated'],
        using: '(user_id = auth.uid())',
      }),
      createRlsPolicy({
        schema: 'public', table: 'todos', name: 'todos_insert_own',
        command: 'INSERT', to: ['authenticated'],
        withCheck: '(user_id = auth.uid())',
      }),
      // … update, delete, public_messages anon-read policy
    ];
  }
}
MigrationCLI.run(import.meta.url, M);
```

**Properties:**

- Each factory returns an `Op` with `precheck` / `execute` / `postcheck` steps consistent with the surrounding factories. Pre/postchecks query `pg_policies` (and `pg_class.relrowsecurity` for `enableRowLevelSecurity`) so a re-run is cleanly diagnosable.
- `using` and `withCheck` are passed through verbatim into `CREATE POLICY`. Consumers are expected to write these as trusted SQL fragments (the factories make no attempt to parse or validate them — same posture as `defaultSql` in `ColumnSpec`).
- `name`, `schema`, `table`, and any role names in `to` are validated against `^[A-Za-z_][A-Za-z0-9_]*$` and quoted with `quoteIdentifier` to make injection through identifier slots impossible.
- The factories deliberately reuse the public `rawSql({ id, label, operationClass, target, precheck, execute, postcheck })` shape — they are pure userspace and require zero changes to `@prisma-next/target-postgres`.

**Migrations are run by PN, not Supabase.** The example does *not* author RLS as `supabase/migrations/*.sql`; it authors them as PN migrations, run via the standard `MigrationCLI` against the local Supabase Postgres URL using a service-role connection. `supabase start` only brings up the Supabase services (auth, realtime, storage) and their internal schemas; our app schema and policies are entirely PN-driven. This is intentional: it exercises PN's migration system end-to-end against a real Supabase database.

**Known friction surfaced by this design** (recorded in `framework-limitations.md` as `FL-NN`):

- The closed `OperationClass` union exported by `@prisma-next/target-postgres` (`'table' | 'column' | 'index' | 'foreignKey' | 'primaryKey' | 'unique' | 'type' | 'dependency'`) has no `'policy'` value; the factory must pick `'dependency'` as the closest fit, losing semantic precision.
- The contract has no first-class RLS metadata; the example will hand-edit the planner-emitted migration to insert calls to the new factories. This is a friction point, not a defect — capture it.

## The agent skill: `writing-rls-policies-with-pn`

A workspace-level Cursor / Claude skill that codifies *how* to author RLS policies on Prisma Next. Distinct from `framework-limitations.md` (which is about what PN can't do): this is about what to do, when, and what to avoid, for *PN-on-Postgres* applications.

**Audience:** an agent (or a human) about to add or change an RLS policy in any PN-on-Postgres codebase.

**Triggering description (frontmatter `description`):** activated when authoring or reviewing migrations that touch RLS — e.g. creating policies, enabling row level security, or onboarding a new role.

**Required content** (each section short, opinionated, examples-first):

1. **When to use RLS, and when not.** Defense-in-depth for multi-user data; not a substitute for application-layer authorization on cross-cutting concerns; how to think about throughput cost.
2. **Mandatory steps when adding RLS to a table.** `enableRowLevelSecurity` first; default-deny means policies opt-in; one factory call per command (`SELECT` / `INSERT` / `UPDATE` / `DELETE`), not `ALL`.
3. **Asymmetric `USING` vs `WITH CHECK` on `UPDATE`.** Both must be set, and they often differ in subtle ways (visibility vs validation). Worked example.
4. **Role targeting.** Always set `to`; default `PUBLIC` is rarely what you want. Common values: `['authenticated']`, `['anon']`, `['authenticated', 'anon']`.
5. **Service-role usage.** `service_role` bypasses RLS. Only use it for migrations / seed / admin paths; never in request handlers. The runtime factory pattern (this PoC's `createSupabaseRuntime`) is how you avoid this.
6. **`auth.uid()` and anon.** It is `NULL` for anon. `(user_id = auth.uid())` returns no rows for anon naturally; in `WITH CHECK`, it fails the insert loudly — use that on purpose.
7. **Performance notes.** Index columns referenced by `using` / `withCheck`; the `(SELECT auth.uid())` wrapper pattern for plan reuse; cost of policies that join.
8. **Testing your policies.** Pattern: parameterized vitest matrix that authenticates as A, B, anon, and asserts row visibility per command. Reference the example app's tests as a concrete shape.
9. **Common anti-patterns.** Forgotten `ENABLE ROW LEVEL SECURITY`. `WITH CHECK` set but not `USING` on `UPDATE`. `SECURITY DEFINER` functions called from policies. RLS used as the only defense.
10. **Where to write it.** PN migration files via the `createRlsPolicy` / `enableRowLevelSecurity` / `dropRlsPolicy` factories, not as raw SQL. Cross-link to `examples/supabase-todos/migrations/<ts>_initial/migration.ts`.
11. **Known framework gaps the skill has to live with.** Cross-link to `framework-limitations.md` items (no contract-level RLS metadata; closed `OperationClass`).

**Authoring rules:**

- The skill is informed by what the PoC actually surfaces, not by speculation. Each anti-pattern listed must either be one we (or Supabase docs) have evidence of, or one we explicitly call out as theoretical.
- Code examples in the skill use the factories from the PoC. Once those are upstreamed, the skill will be edited; the skill explicitly states "currently in-example, see [`framework-limitations.md`](../../projects/supabase-poc/framework-limitations.md) Sketch 3" so it doesn't go stale silently.
- The skill stays under `projects/supabase-poc/skills/` until close-out. At close-out it migrates to `.claude/skills/` (permanent home).

## The gap-tracking deliverable

`projects/supabase-poc/framework-limitations.md` is the second deliverable, equal in importance to the running app. Format mirrors `projects/mongo-example-apps/framework-limitations.md`: numbered `FL-NN` entries with description, impact, workaround, status. **Populated continuously during execution, not at the end** — the moment a friction point is hit, it's recorded.

The doc closes with three half-page design sketches for what the team might consider upstreaming based on what the PoC surfaced:

1. **Scoped-session SPI** — promoting "runtime scoped to a GUC profile + role" from a userspace recipe to a first-class concept on `SqlRuntime` / `SqlDriver`.
2. **Subscription lane** — a contract-aware `db.subscribe(table).where(...) → AsyncIterable<ChangeEvent>` lane, lowered onto `LISTEN/NOTIFY` for plain Postgres or onto Supabase Realtime via an adapter-level helper.
3. **RLS-aware contract metadata + lints** — contract annotations marking tables as RLS-protected (so the planner emits `enableRowLevelSecurity` / `createRlsPolicy` calls automatically instead of hand-editing the migration), plus a SQL middleware lint that warns when a query touches an RLS-protected table without an authenticated session. Companion to this: making `OperationClass` extensible so packs can register a first-class `'policy'` object type instead of falling back to `'dependency'`.

These are documentation, not commitments. Each is sized to fit on half a page and is intended to seed a follow-up project, not to be itself implemented.

# Requirements

## Functional

### Example app (R-FE)

- **R-FE-1.** A fresh `git clone` reaches a working demo via a documented sequence: install Supabase CLI; `pnpm install`; `supabase start` (brings up Supabase services); `pnpm --filter supabase-todos contract:emit`; `pnpm --filter supabase-todos migrate:up` (PN's `MigrationCLI` creates app tables + RLS policies via the in-example factories); `pnpm --filter supabase-todos seed` (creates a few users via Supabase admin API + fixture rows); `pnpm --filter supabase-todos dev`. No secrets needed.
- **R-FE-2.** A user can sign up / sign in via the SPA. The browser holds the token; every API request to the Node server includes it as `Bearer`.
- **R-FE-3.** Authenticated users can list, create, edit, complete, and delete their own todos via the SPA. All DB access from the server goes through PN.
- **R-FE-4.** Two browser tabs signed in as the same user see each other's `INSERT` / `UPDATE` / `DELETE` on `todos` live, within the latency of Supabase Realtime.
- **R-FE-5.** An unauthenticated user can read `public_messages` via the SPA. The server fulfills this request through a factory-produced runtime authenticated as `role: 'anon'` with no claims.

### Factory correctness (R-FX)

- **R-FX-1.** With `scopeMode: 'transaction'` against the local Supavisor pooled URL: a session for user A reading `todos` returns only A's rows; a session for user B reads only B's. `anon` returns zero rows on `todos` and reads `public_messages` successfully.
- **R-FX-2.** Server handlers issuing `SELECT * FROM todos` (no explicit `WHERE user_id = ?`) return only the authenticated user's rows. The PoC must demonstrate this, because it is the proof RLS is doing the work.
- **R-FX-3.** With `scopeMode: 'connection'` against a direct (non-pooled) URL, behavior identical to R-FX-1 obtains.
- **R-FX-4.** A run of N parallel `authenticate()` calls with distinct claims, each executing a query, sees no cross-contamination. (No GUC leakage between concurrent scopes on the same pool.)
- **R-FX-5.** Calling `authenticate({ role: 'something-not-in-allowedRoles' })` throws synchronously; no SQL is sent to the database.
- **R-FX-6.** A pool with `max: 2` and 10 concurrent scoped runtimes completes a stress run with all connections returned to the pool. (No connection leaks via the scope wrapper.)
- **R-FX-7.** An error mid-stream in transaction mode rolls back the wrapping transaction, evicts the connection from the pool, and surfaces the original error to the caller.
- **R-FX-8.** In transaction mode, calling `session.beginTransaction()` throws `runtime/unsupported-scoped-tx` synchronously. Recorded as a known limitation (`FL-NN`).

### Migration factories (R-FM)

- **R-FM-1.** `enableRowLevelSecurity(schema, table)`, `createRlsPolicy(spec)`, and `dropRlsPolicy(schema, table, name)` are exported from `examples/supabase-todos/migrations/utils/rls-ops.ts` and used inside the example's PN migration file(s).
- **R-FM-2.** Identifier slots (`schema`, `table`, `name`, role names in `to`) are validated against `^[A-Za-z_][A-Za-z0-9_]*$` and rendered via `quoteIdentifier`. Invalid identifiers throw synchronously with a clear error before any SQL is constructed.
- **R-FM-3.** `using` and `withCheck` are interpolated verbatim into `CREATE POLICY` (consumers' responsibility to author trusted SQL — same contract as `ColumnSpec.defaultSql`). The factory does not attempt to parse or sanitize them.
- **R-FM-4.** Each emitted `Op` is shaped consistently with neighboring factories: `precheck` ensures the policy / RLS-state does not already exist, `execute` runs the `CREATE POLICY` / `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statement, `postcheck` queries `pg_policies` / `pg_class.relrowsecurity` to confirm. Re-running the migration on an already-applied database is diagnosable from the precheck output.
- **R-FM-5.** `dropRlsPolicy` mirrors `dropTable` (operation class `'destructive'`, precheck-then-postcheck against `pg_policies`).
- **R-FM-6.** The example's initial migration uses these factories to enable RLS and define the policies that R-FX-1 / R-FX-2 / R-FE-5 depend on. Running `pnpm --filter supabase-todos migrate:up` from a freshly `supabase start`-ed database leaves the schema in the state required by the demo.
- **R-FM-7.** Factories use only the publicly-exported migration surface (`rawSql`, `Op` shape) of `@prisma-next/target-postgres/migration`. No private imports, no patches to `packages/`.

### Agent skill (R-FK)

- **R-FK-1.** A skill `writing-rls-policies-with-pn` exists with a `SKILL.md` that has valid frontmatter (`name`, `description`) following the same shape as existing workspace skills (e.g. `.agents/skills/ast-visitor-pattern/SKILL.md`). Description is action-oriented and triggers on RLS authoring/review tasks.
- **R-FK-2.** Skill body covers all eleven required sections enumerated in [Design § The agent skill](#the-agent-skill-writing-rls-policies-with-pn). Each section is concrete (concrete code snippet, named anti-pattern, etc.), not aspirational.
- **R-FK-3.** Every code example in the skill compiles against the example app's contract and the in-example factories. The skill explicitly cross-links to `examples/supabase-todos/migrations/<ts>_initial/migration.ts` as a working reference and to `examples/supabase-todos/test/` for the testing pattern.
- **R-FK-4.** Skill cross-references the `FL-NN` entries that constrain its advice (no contract-level RLS metadata; closed `OperationClass`). When those gaps are eventually closed in follow-up work, the skill is the place that gets edited.
- **R-FK-5.** During the PoC the skill lives at `projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md`. Close-out migrates it to `.claude/skills/writing-rls-policies-with-pn/SKILL.md` unmodified (or with only mechanical edits — relative-link fixups).
- **R-FK-6.** Skill is **continuously updated** during execution: if a milestone surfaces an anti-pattern, footgun, or opinionated choice worth advice, the skill gets the entry on the same commit. No "draft now, fill in at the end."

### Gap-tracking deliverable (R-FG)

- **R-FG-1.** `projects/supabase-poc/framework-limitations.md` exists and contains every friction point hit during execution, with `FL-NN` IDs, description, impact, workaround in app, status. Empty buckets are explicitly marked "none observed."
- **R-FG-2.** The same doc contains three design sketches (scoped-session SPI, subscription lane, RLS-aware contract metadata) of roughly half a page each, each ending with stated trade-offs.

## Non-functional

- **R-NF-1. No framework changes.** The PoC PR contains no edits to any package under `packages/`. Friction points that would be solved by a framework change are recorded in `framework-limitations.md` and not patched. (Recommendations to upstream may be made; they are out of scope to *implement* in the PoC PR.)
- **R-NF-2. No new framework or workspace package.** The factory and JWT helpers live inside `examples/supabase-todos/src/server/`. Easy to copy into a downstream user project.
- **R-NF-3. Type safety end-to-end.** Server queries are typed via the contract. The factory's `authenticate()` returns a structurally ordinary `SqlRuntime`, so callers see standard PN types.
- **R-NF-4. Tests-first.** Tests for the factory (R-FX-1 through R-FX-8) are written before the implementation. Repo convention from `AGENTS.md`.
- **R-NF-5. Friction logged continuously.** Every commit that introduces an awkward workaround also adds the corresponding `FL-NN` entry. No retrospective sweep.
- **R-NF-6. No CI requirement.** Local-only. Vitest suites are runnable locally against `supabase start`; no CI integration is built.

# Non-goals

- **No `@prisma-next/supabase` package.** Glue stays in the example.
- **No upstream framework changes** as part of this PoC PR. Any "obviously beneficial" change becomes an `FL-NN` instead.
- **No reimplementation of Supabase Realtime in PN.** The browser uses `supabase-js`. We don't add `LISTEN/NOTIFY` helpers to the postgres driver.
- **No JWT issuance / verification logic in framework packages.** The example handles it; PN is uninvolved.
- **No Supabase Storage, Edge Functions, or Vault integration.**
- **No production-deployment story.**
- **No new ADRs as part of the PoC PR.** Design sketches in `framework-limitations.md` may *propose* future ADRs but do not become them during this project.
- **No user-initiated transactions in transaction-scope mode.** Throws fast; recorded as `FL-NN`.
- **No Linear project.** Local-only project tracking.

# Acceptance Criteria

**Setup**

- [ ] `supabase start` brings up the local stack against which the demo works end-to-end.
- [ ] `pnpm --filter supabase-todos dev` starts the SPA + server.
- [ ] The example's `README.md` documents the full setup sequence; a clean clone reaches the demo by following it.

**App behavior** (satisfies R-FE-*)

- [ ] Sign-up / sign-in via the SPA works (R-FE-2).
- [ ] Authenticated CRUD on todos works through the SPA, all DB through PN (R-FE-3).
- [ ] Two-tab realtime updates demonstrated (R-FE-4).
- [ ] Anon page reads `public_messages` (R-FE-5).

**Factory correctness** (satisfies R-FX-*)

- [ ] Vitest integration test: per-user RLS isolation in transaction mode (R-FX-1, R-FX-2).
- [ ] Vitest integration test: parallel-scope leakage check (R-FX-4).
- [ ] Vitest unit test: role allowlist enforcement, no SQL on rejection (R-FX-5).
- [ ] Vitest integration test: pool exhaustion + recovery (R-FX-6).
- [ ] Vitest integration test: mid-stream error → rollback + eviction (R-FX-7).
- [ ] Vitest unit test: `beginTransaction()` in transaction mode throws (R-FX-8).
- [ ] Connection-scope mode acceptance is conditional on M3 landing. If M3 is descoped, R-FX-3 moves to `framework-limitations.md` as a known gap; this is acceptable.

**Migration factories** (satisfies R-FM-*)

- [ ] Vitest unit tests: identifier validation rejects `'1bad'`, `'has space'`, `'inj"ect'` synchronously (R-FM-2).
- [ ] Vitest unit tests: each factory emits the expected SQL shape for representative inputs, including default values for omitted optional fields (R-FM-1, R-FM-3, R-FM-4, R-FM-5).
- [ ] Vitest integration test: running the initial migration against a freshly `supabase start`-ed database leaves `pg_policies` in the expected state, and re-running it surfaces the precheck failure cleanly (R-FM-4, R-FM-6).
- [ ] `git diff main -- packages/` remains empty after the factories are written (R-FM-7).

**Agent skill** (satisfies R-FK-*)

- [ ] `projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md` exists with valid frontmatter and all eleven body sections present and non-trivial (R-FK-1, R-FK-2).
- [ ] Each code snippet in the skill is copied from (or syntactically valid against) `examples/supabase-todos/` (R-FK-3).
- [ ] Skill cross-links to `framework-limitations.md` and to the example's migration + tests (R-FK-3, R-FK-4).
- [ ] Skill commit history shows entries added alongside the milestones whose work surfaced them (R-FK-6).
- [ ] At close-out, the skill is moved to `.claude/skills/` with only relative-link fixups (R-FK-5).

**Architectural constraints** (satisfies R-NF-*)

- [ ] `git diff main -- packages/` is empty on the PoC branch (R-NF-1).
- [ ] No new package under `packages/` (R-NF-2).
- [ ] The factory's signature returns a value structurally compatible with `SqlRuntime` (R-NF-3) — verified by a TS type test.
- [ ] Each task's commit history shows tests-first ordering (R-NF-4).

**Deliverable**

- [ ] `framework-limitations.md` populated continuously, with `FL-NN` entries and all three design sketches present (R-FG-1, R-FG-2).

# Alternatives considered

Recorded so the next reader doesn't re-litigate decisions already made.

| Decision | What we chose | What we rejected | Why |
|---|---|---|---|
| **Where the RLS glue lives** | Userspace factory in the example app (`createSupabaseRuntime`). | A `SqlMiddleware` that wraps each plan in `BEGIN; SET LOCAL …; <plan>; COMMIT`. | Middleware can't safely issue side statements without breaking the one-call-one-statement rule the runtime relies on. Doing it at the driver-wrapper level keeps PN's invariants intact. |
| **Where the RLS glue lives (alt)** | Same. | A new framework package `@prisma-next/supabase` shipping the factory and helpers. | The PoC's job is to validate the pattern, not to ship a package. If the pattern proves out, packaging is a follow-up. |
| **How RLS policies are authored** | TS migration operation factories (`createRlsPolicy`, etc.) in the example, used inside a PN `Migration`. | Hand-written `supabase/migrations/*.sql` files run by `supabase db reset`. | We want to validate that PN's migration system can express RLS authoring end-to-end. Going through `supabase db reset` would skip PN entirely and miss exactly the friction we want to surface. |
| **Where the migration factories live** | In the example app, layered on `rawSql`. | Upstream as `createRlsPolicy` exports of `@prisma-next/target-postgres/migration`. | Same R-NF-1 reasoning as the runtime factory — validate first, package later. The fact that `OperationClass` is a closed union (no `'policy'`) is itself friction worth recording before deciding on an upstream API. |
| **`OperationClass` for policy ops** | Pick `'dependency'` (catch-all) and record the imprecision as `FL-NN`. | Type-cast to add `'policy'`, or extend the union locally. | Type-casting the framework's exported types is a smell. The honest answer is that the union should be extensible; the friction belongs in `framework-limitations.md`, not in a workaround. |
| **Default `scopeMode`** | `'transaction'`. | `'connection'` default. | Supabase's default URL is the Supavisor transaction-mode pooler, which rebinds underlying connections between transactions. Session-level state is unsafe there; only `SET LOCAL` inside a transaction is. PostgREST does the same. Connection mode is faster but only safe on direct URLs. |
| **`scopeMode: 'connection'` priority** | Stretch (M3, optional). | Equal priority with transaction mode. | Transaction mode covers the realistic Supabase deployment; connection mode is a perf optimization for the minority direct-connection case. Spec acceptance criterion explicitly tolerates M3 being descoped. |
| **Transaction nesting in scoped runtime** | `session.beginTransaction()` in transaction mode throws fast. | Implementing nested-transaction semantics (savepoints, etc). | Subtle semantics that aren't part of the PoC's core question. Throwing makes the limitation explicit. |
| **Realtime mechanism** | Browser uses `@supabase/supabase-js` realtime client, websocket directly to Supabase Realtime. PN uninvolved. | Adding a `LISTEN/NOTIFY` helper to the postgres driver. | The PoC question is "how much do we support Supabase users today" — the answer for realtime is "100% via supabase-js, 0% via PN." Adding a `LISTEN/NOTIFY` helper would be PN doing more, not Supabase support. Capture as design sketch instead. |
| **JWT verification location** | Node server, via `jose` against local JWKS / shared secret. | A framework helper for verifying Supabase JWTs. | Would put service-specific auth logic into PN. The factory accepts pre-verified claims; consumers verify however they want. |
| **Server framework** | Hono. | Express, Fastify. | Smallest footprint, modern types, fewer moving parts for a PoC. |
| **Database for dev** | Local Supabase via `supabase start` (Docker). | Cloud Supabase. | Reproducible from a clean clone, no shared secrets, works offline. |
| **Gap doc shape** | `framework-limitations.md` with `FL-NN` entries, mirrors `projects/mongo-example-apps/`. | Section in spec, or short README in example. | Established repo pattern; numbered IDs make tracking easier when items move to follow-up projects. |
| **Skill placement during PoC** | Authored under `projects/supabase-poc/skills/`, migrated to `.claude/skills/` at close-out. | Author directly under `.claude/skills/` from day one. | `projects/<project>/**` is the contract for transient artifacts. A half-finished skill in `.claude/skills/` is a worse outcome for a `main`-tracking observer than the same draft inside the project dir. Migration at close-out is one mechanical move. |
| **Skill scope** | One skill: "writing RLS policies with PN," covering when / how / pitfalls. | Multiple smaller skills (one for migration factories, one for runtime factory, one for testing RLS). | The audience question is "I'm about to add RLS, what do I need to know?" — splitting forces them to consult three skills. Single skill, clear sections. |
| **CI integration** | None for this PoC. | Run vitest suites in CI. | The local stack is a heavy CI dependency for a PoC whose value is the friction it surfaces, not its automated test signal. |
| **Linear project** | None. | Create one. | Local-only execution; would add ceremony for no benefit at PoC scale. |

# References

- [Architecture Overview](../../docs/Architecture%20Overview.md)
- [Runtime & Middleware Framework subsystem](../../docs/architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md)
- [Adapters & Targets subsystem](../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md)
- [Postgres driver](../../packages/3-targets/7-drivers/postgres/src/postgres-driver.ts)
- [`prisma-next-demo` example](../../examples/prisma-next-demo/) — closest existing example to copy structure from
- [`prisma-next-demo` initial migration](../../examples/prisma-next-demo/migrations/20260422T0720_initial/migration.ts) — concrete shape of a PN migration file (factories + `MigrationCLI.run`)
- [`@prisma-next/target-postgres/migration` exports](../../packages/3-targets/3-targets/postgres/src/exports/migration.ts) — the public migration surface to layer on
- [`mongo-example-apps` project](../mongo-example-apps/) — same "validate framework via real example + track gaps" pattern
- Supabase RLS docs: <https://supabase.com/docs/guides/auth/row-level-security>
- Supavisor (transaction-mode pooling): <https://supabase.com/docs/guides/database/connecting-to-postgres>
- Supabase Realtime: <https://supabase.com/docs/guides/realtime>
- PostgREST RLS execution model: <https://postgrest.org/en/stable/auth.html>
