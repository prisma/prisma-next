# supabase-todos

A Prisma Next reference application running against a local Supabase stack. The example exercises Supabase Row Level Security (RLS) and Realtime through PN's contract-first runtime: app schema is authored as a PN contract, RLS policies are authored in PN migration files, and per-request reads/writes are scoped to the authenticated user via a userspace runtime factory.

This is the running-app deliverable for the Supabase PoC. The design rationale, requirements, and milestones live in [`projects/supabase-poc/spec.md`](../../projects/supabase-poc/spec.md) and [`projects/supabase-poc/plan.md`](../../projects/supabase-poc/plan.md).

> **Status:** Milestones 1–4 complete. The example scaffolds the schema, RLS policies, seed fixtures, an admin (RLS-bypassing) runtime, the per-request scoped runtime (`createSupabaseRuntime`), the Hono `/api/todos` + `/api/public/messages` API, and a Vite SPA with authentication, optimistic-CRUD todos, realtime subscriptions, and a public board.

## Architecture at a glance

```
                                         ┌────────────────────────────────────┐
                                         │  PostgreSQL (Supabase, port 54322) │
                                         │  ─ public.profiles                 │
                                         │  ─ public.todos          ◄──┐      │
                                         │  ─ public.public_messages   │      │
                                         │  ─ RLS policies on each      │      │
                                         └─────┬───────────────────────┼──────┘
                                               │ SQL                   │
                                               │ (BEGIN; SET LOCAL …)  │ logical replication
                                               ▼                       │ (supabase_realtime)
                                       ┌────────────────┐               │
                                       │ Hono (8787)    │               │
                                       │  ─ JWT verify  │      ┌────────┴───────────┐
   apiFetch (Bearer JWT)               │  ─ scoped PN   │      │ Supabase Realtime  │
   ──────────────────────────────────▶ │    runtime     │      │ broker (54321)     │
                                       │  ─ /api/todos  │      │  ─ enforces RLS    │
                                       │  ─ /api/public │      │  ─ filter on uid   │
                                       └────────────────┘      └────────┬───────────┘
                                                                        │ websocket
                                                                        │ (postgres_changes)
                                       ┌────────────────────────────────┴──────────┐
                                       │ Vite SPA (5173)                            │
                                       │  ─ supabase.auth.* (sign in / out)         │
                                       │  ─ apiFetch → /api/* (todos + public)      │
                                       │  ─ supabase.channel(...) (realtime only)   │
                                       └────────────────────────────────────────────┘
```

The architectural claim of this PoC: **the SPA never talks directly to Postgres for app data**. Every read / write goes through Hono → the per-request PN scoped runtime → Postgres, where RLS does the per-user isolation. The only direct browser-to-Supabase path is the Realtime WebSocket, which the broker filters by RLS exactly as PostgREST would. See [`src/client/supabase.ts`](src/client/supabase.ts) for the bright-line rule documented in code.

## Prerequisites

- **Node.js** matching this package's `engines.node` (`>=24`; see [`package.json`](package.json)).
- **pnpm** (the repo's package manager — run `corepack enable` if it's not already on your `PATH`).
- **Docker**, with the daemon running. `supabase start` boots Postgres + Auth + Realtime + Studio as containers.
- **Supabase CLI** — install via the [official instructions](https://supabase.com/docs/guides/local-development/cli/getting-started). On macOS: `brew install supabase/tap/supabase`.

## One-shot setup sequence

Run from the **repo root** unless noted otherwise.

1. **Install workspace dependencies.**

   ```bash
   pnpm install
   ```

2. **Move into the example.** All subsequent `supabase` CLI commands are scoped to this directory's [`supabase/config.toml`](supabase/config.toml).

   ```bash
   cd examples/supabase-todos
   ```

3. **Boot the local Supabase stack.** Brings up Postgres, Auth (GoTrue), Realtime, Studio, etc. as Docker containers. The first run pulls the images and takes ~1 minute; subsequent runs are seconds.

   ```bash
   supabase start
   ```

   Once it's up, `supabase status` prints the URLs and keys. Defaults match `.env.example`; copy it to `.env` to make the values available to the scripts and the SPA build:

   ```bash
   cp .env.example .env
   ```

   Note: the SPA reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (the `VITE_`-prefixed copies); the server reads `DATABASE_URL` / `SUPABASE_JWT_SECRET` / `SUPABASE_SERVICE_ROLE_KEY`. **The non-`VITE_`-prefixed variables MUST stay un-prefixed** — Vite would otherwise bundle the JWT secret and service-role key into the browser.

4. **Emit the contract.** Reads [`src/db/schema.ts`](src/db/schema.ts) and writes `src/db/contract.json` + `src/db/contract.d.ts`. These are the inputs to the runtime and the migration system.

   ```bash
   pnpm --filter supabase-todos contract:emit
   ```

5. **Apply the initial PN migration.** Runs [`migrations/20260428T0354_initial/migration.ts`](migrations/20260428T0354_initial/migration.ts) via `MigrationCLI`. Creates `profiles`, `todos`, `public_messages`; enables RLS on each; installs the role-targeted policies that scope reads/writes to `auth.uid()`.

   ```bash
   pnpm --filter supabase-todos migrate:up
   ```

6. **Seed fixtures.** Creates two confirmed auth users (`alice@example.test` / `password-alice`, `bob@example.test` / `password-bob`) via the Supabase admin API and inserts profiles, todos, and public messages. Also adds `public.todos` to the `supabase_realtime` publication so the SPA's realtime subscription receives `postgres_changes` events (cf. [`framework-limitations.md`](../../projects/supabase-poc/framework-limitations.md#fl-20)). Idempotent — re-running it is a no-op.

   ```bash
   pnpm --filter supabase-todos seed
   ```

   > The seed is **idempotent but not convergent**. If a row drifts (e.g. a test mutated it without cleaning up), `pnpm seed` will not repair it. Recovery: `supabase db reset` from this directory, then `pnpm migrate:up && pnpm seed` to rebuild the baseline.

7. **Run the test suite.** Vitest covers the in-example RLS migration factories ([`test/migrations/rls-ops.test.ts`](test/migrations/rls-ops.test.ts)), the admin / per-request runtime ([`test/runtime/`](test/runtime/)), the JWT + scoped-runtime middleware ([`test/server/middleware/`](test/server/middleware/)), and the Hono routes ([`test/server/routes/`](test/server/routes/)). 149 tests as of phase-4c.

   ```bash
   pnpm --filter supabase-todos test
   ```

## Running the demo

The PoC needs three processes for a full end-to-end run:

1. **Supabase stack** — `supabase start` (already running from setup step 3).
2. **Hono API** — listens on `127.0.0.1:8787` by default. Override with `HONO_PORT`.
3. **Vite dev server** — listens on `127.0.0.1:5173`, proxies `/api/*` to the Hono port.

Start them in separate terminals:

```bash
# Terminal A — Hono API. Watches src/server/index.ts and restarts on edit.
pnpm --filter supabase-todos dev:server

# Terminal B — Vite SPA.
pnpm --filter supabase-todos dev
```

Open <http://127.0.0.1:5173/>. The login form pre-fills `alice@example.test` / `password-alice`; click **Sign in**.

### Two-tab realtime + RLS demo

This procedure exercises the headline result: per-user isolation enforced by RLS, with realtime updates pushed only to the rightful subscriber.

1. **Tab A — alice.** Open <http://127.0.0.1:5173/>, sign in as `alice@example.test` / `password-alice`. The todos page renders her three seeded todos.
2. **Tab B — bob.** Open the same URL in a separate browser profile (or an incognito window so the auth session does not collide), sign in as `bob@example.test` / `password-bob`. The todos page renders his two seeded todos. Bob does not see alice's todos — RLS is doing its job at the server.
3. **Cross-user 404 (the security proof).** From Tab A's browser DevTools console (alice's session is active), try to read one of bob's todo ids directly. Pick one of bob's todo titles (e.g. `Read the spec`); use Studio (<http://127.0.0.1:54323>) or `psql` to grab its `id`. Then in DevTools:

   ```js
   const { data: { session } } = await window.supabase?.auth.getSession?.() ?? { data: { session: null } };
   await fetch(`/api/todos/${'<bob-todo-id>'}`, {
     headers: { Authorization: `Bearer ${session.access_token}` },
   }).then((r) => r.status);
   ```

   Expect **`404`**. The server's `GET /api/todos/:id` runs `SELECT … WHERE id = $1` under alice's RLS-scoped session; the policy filters bob's row out before the WHERE clause matches anything; the handler reports zero rows as 404. The 404 (not 403, not 200, not 500) is the proof that RLS is the single point of isolation. See `test/server/routes/todos.test.ts` for the same shape pinned as a vitest assertion.

4. **Realtime via psql.** Keep Tab A open on alice's todos page (the realtime channel is subscribed). From a third terminal:

   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -c "INSERT INTO public.todos (id, user_id, title, completed) \
         VALUES (gen_random_uuid(), '<alice-uid>', 'Inserted via psql', false);"
   ```

   (`<alice-uid>` is the uuid printed by `pnpm seed`, or `SELECT id FROM auth.users WHERE email = 'alice@example.test'`.)

   Tab A renders the new todo without a refresh. Bob's tab does **not** receive the event — the realtime broker enforces the same RLS policy the server enforces, and Tab B's filter (`user_id=eq.<bob-uid>`) doesn't match. This is the per-tab realtime proof.

5. **Public board.** From either tab, click the **Public board** tab. Both alice's and bob's tabs show the seeded messages. Now sign out from one tab — the public board still renders (it's a public route; the per-request scoped-runtime middleware attaches an `anon` session, and the RLS policy on `public_messages` grants SELECT to both `anon` and `authenticated`).

## Connection URLs — which one is used where

The example uses two distinct Postgres connection URLs, and which one a piece of code holds is what determines whether RLS is enforced.

| URL | Role | Used by | Notes |
|---|---|---|---|
| **Direct / service-role** (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) | superuser | `migrate:up`, the seed script, the admin runtime ([`src/server/db.ts`](src/server/db.ts)), and the **shared `pg.Pool` constructed at server start** in [`src/server/index.ts`](src/server/index.ts) | **Bypasses RLS unconditionally** *as the underlying connection*. The per-request scoped runtime borrows from this pool but downgrades each connection's role to `authenticated` / `anon` via `SET LOCAL ROLE` inside the per-plan transaction, which **does** enforce RLS. The pool itself is not directly used by request handlers. |
| **Pooled / Supavisor** (port `54329`, `pool_mode = 'transaction'`) | the same role as the direct URL, with `SET LOCAL` per request | available; not currently exercised | Suitable for production-shape deployments. The per-request runtime works against either URL; the local example uses the direct URL because it keeps the demo single-pool. |

Concretely: every `c.var.db.execute(plan)` call from a Hono handler runs `BEGIN; SELECT set_config('request.jwt.claims', $1, true); SET LOCAL ROLE "authenticated"; <plan>; COMMIT` against a `PoolClient` borrowed from the shared pool. The role downgrade is what activates the RLS policies; `auth.uid()` reads the `sub` claim from the GUC. See [`src/server/supabase-runtime.ts`](src/server/supabase-runtime.ts) for the lifecycle and [`src/server/middleware/scoped-runtime.ts`](src/server/middleware/scoped-runtime.ts) for the per-request envelope.

## Repository layout

```
examples/supabase-todos/
├── README.md                                     ← you are here
├── supabase/config.toml                          ← local stack config (auth, realtime, db)
├── prisma-next.config.ts                         ← contract emitter config
├── src/
│   ├── db/                                       ← contract (schema.ts → contract.json + .d.ts)
│   ├── server/
│   │   ├── index.ts                              ← Hono entry (T4.13 prereq)
│   │   ├── db.ts                                 ← admin (RLS-bypass) PN runtime
│   │   ├── supabase-runtime.ts                   ← per-request scoped runtime factory
│   │   ├── middleware/{jwt,scoped-runtime}.ts    ← phase-4a auth + RLS-scoping
│   │   └── routes/{todos,public-messages}.ts     ← phase-4b /api/* handlers
│   └── client/
│       ├── main.tsx                              ← React entry
│       ├── supabase.ts                           ← browser supabase-js (auth + channel only)
│       ├── api-fetch.ts                          ← Bearer-attaching fetch helper
│       ├── auth.tsx                              ← <AuthProvider> + useAuth()
│       ├── App.tsx, router.ts                    ← top-level shell
│       └── components/{LoginForm,TopNav,TodosPage,PublicBoardPage}.tsx
├── migrations/20260428T0354_initial/             ← PN migration (tables + RLS policies)
├── scripts/seed.ts                               ← demo fixtures + realtime publication
└── test/                                         ← vitest (149 tests as of phase-4c)
```

## What's next

The PoC is feature-complete through milestone 4. Milestone 5 (consolidation pass) finalises [`framework-limitations.md`](../../projects/supabase-poc/framework-limitations.md), the [agent skill](../../projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md), and the design sketches; see [`projects/supabase-poc/plan.md § Milestone 5`](../../projects/supabase-poc/plan.md).

## Cross-references

- [`projects/supabase-poc/spec.md`](../../projects/supabase-poc/spec.md) — PoC design and requirements.
- [`projects/supabase-poc/plan.md`](../../projects/supabase-poc/plan.md) — milestone plan and phase index.
- [`projects/supabase-poc/framework-limitations.md`](../../projects/supabase-poc/framework-limitations.md) — gaps surfaced by the PoC and the design sketches that close them.
- [`projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md`](../../projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md) — opinionated guide to authoring RLS in a PN codebase.
