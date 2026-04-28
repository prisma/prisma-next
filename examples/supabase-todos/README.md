# supabase-todos

A Prisma Next reference application running against a local Supabase stack. The example exercises Supabase Row Level Security (RLS) and Realtime through PN's contract-first runtime: app schema is authored as a PN contract, RLS policies are authored in PN migration files, and per-request reads/writes are scoped to the authenticated user via a userspace runtime factory.

This is the running-app deliverable for the Supabase PoC. The design rationale and requirements live in [`projects/supabase-poc/spec.md`](../../projects/supabase-poc/spec.md).

> **Status:** Feature-complete. The example scaffolds the schema, RLS policies, seed fixtures, an admin (RLS-bypassing) runtime, the per-request scoped runtime (`createSupabaseRuntime`), the Hono `/api/todos` + `/api/public/messages` API, and a Vite SPA with authentication, optimistic-CRUD todos, realtime subscriptions, and a public board.

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

7. **Run the test suite.** Vitest covers the in-example RLS migration factories ([`test/migrations/rls-ops.test.ts`](test/migrations/rls-ops.test.ts)), the admin / per-request runtime ([`test/runtime/`](test/runtime/)), the JWT + scoped-runtime middleware ([`test/server/middleware/`](test/server/middleware/)), and the Hono routes ([`test/server/routes/`](test/server/routes/)).

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
3. **Cross-user 404 (the security proof).** From Tab A's browser DevTools console (alice's session is active), try to read one of bob's todo IDs directly. The SPA exposes the `supabase` client on `window` in dev mode (see [`src/client/supabase.ts`](src/client/supabase.ts) — gated on `import.meta.env.DEV`, never present in a production build), and the demo uses it to read the active access token; the manual test does not need to scrape localStorage.

   First, while signed in as **bob** in Tab B, get one of bob's todo IDs from his DevTools console:

   ```js
   const { data: { session } } = await window.supabase.auth.getSession();
   const todos = await fetch('/api/todos', {
     headers: { Authorization: `Bearer ${session.access_token}` },
   }).then((r) => r.json());
   console.log(todos);
   // → [{ id: "…", user_id: "<bob-uid>", title: "Read the spec", … }, …]
   // Copy any `id` from the output for use below.
   ```

   Then switch to **Tab A** (alice's session), open that tab's DevTools, and run — substituting the copied UUID for `BOB_TODO_ID`:

   ```js
   const BOB_TODO_ID = 'paste-bob-todo-id-here';
   const { data: { session } } = await window.supabase.auth.getSession();
   const status = await fetch(`/api/todos/${BOB_TODO_ID}`, {
     method: 'PATCH',
     headers: {
       'Content-Type': 'application/json',
       Authorization: `Bearer ${session.access_token}`,
     },
     body: JSON.stringify({ completed: true }),
   }).then((r) => r.status);
   console.log(status); // expect 404
   ```

   Expect **`404`**. The server's `PATCH /api/todos/:id` runs `UPDATE … WHERE id = $1 RETURNING …` under alice's RLS-scoped session; the policy filters bob's row out before the WHERE clause matches anything; the handler reports zero returned rows as 404. The 404 (not 403, not 200, not 500) is the proof that RLS is the single point of isolation. See [`test/server/routes/todos.test.ts`](test/server/routes/todos.test.ts) for the same shape pinned as a vitest assertion.

4. **Realtime via psql.** Keep Tab A open on alice's todos page (the realtime channel is subscribed). First derive alice's auth-user UUID from a third terminal — `pnpm seed` also prints it, but `psql` is the most reliable source:

   ```bash
   ALICE_UID=$(psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -At -c "SELECT id FROM auth.users WHERE email = 'alice@example.test'")
   echo "$ALICE_UID"   # sanity-check the UUID
   ```

   Then issue the INSERT, interpolating `$ALICE_UID` (the surrounding shell, not psql, does the substitution — psql sees a literal UUID):

   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -c "INSERT INTO public.todos (id, user_id, title, completed)
         VALUES (gen_random_uuid(), '$ALICE_UID', 'Inserted via psql', false);"
   ```

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
│   │   ├── index.ts                              ← Hono entry
│   │   ├── db.ts                                 ← admin (RLS-bypass) PN runtime
│   │   ├── supabase-runtime.ts                   ← per-request scoped runtime factory
│   │   ├── middleware/{jwt,scoped-runtime}.ts    ← auth + RLS-scoping
│   │   └── routes/{todos,public-messages}.ts     ← /api/* handlers
│   └── client/
│       ├── main.tsx                              ← React entry
│       ├── supabase.ts                           ← browser supabase-js (auth + channel only)
│       ├── api-fetch.ts                          ← Bearer-attaching fetch helper
│       ├── auth.tsx                              ← <AuthProvider> + useAuth()
│       ├── App.tsx, router.ts                    ← top-level shell
│       └── components/{LoginForm,TopNav,TodosPage,PublicBoardPage}.tsx
├── migrations/20260428T0354_initial/             ← PN migration (tables + RLS policies)
├── scripts/seed.ts                               ← demo fixtures + realtime publication
└── test/                                         ← vitest (unit + integration)
```

## Production gaps

This example is **demo-scoped, not production-ready**. The architectural shape (contract-first PN runtime, RLS as the single point of per-user isolation) is the same one a production deployment would use — but several deployment-shaped concerns are deferred so the demo stays focused on the PoC's headline result. A reviewer evaluating "what would have to change before this could go anywhere near production" should know:

- **CORS is not enabled.** The Hono server binds to `127.0.0.1:8787` and the Vite dev server proxies `/api/*` to it, so the browser sees same-origin requests and CORS does not apply. A production deployment that serves the SPA from a different origin needs `import { cors } from 'hono/cors'` and `.use('*', cors({ origin: <spa-origin> }))` ahead of the JWT middleware. The swap-in shape is documented in [`src/server/index.ts`](src/server/index.ts).
- **JWT verification uses HS256 with a shared secret.** Local Supabase signs access tokens with HS256 and a fixed `JWT_SECRET` exposed via `supabase status -o env`; the example's [`createJwtMiddleware`](src/server/middleware/jwt.ts) is configured with that secret. A production deployment should switch to **RS256 + JWKS** (asymmetric keys, with the verifier fetching the public-key set from the auth service). The middleware's `algorithms` option already routes through `jose.jwtVerify`, so the swap is "construct a JWKS-backed key resolver and pass it instead of the shared secret"; the surface above the verifier is unchanged.
- **Seeded passwords are demo-only.** `alice@example.test` / `password-alice` and `bob@example.test` / `password-bob` are hard-coded in [`scripts/seed.ts`](scripts/seed.ts) and pre-filled in the [`LoginForm`](src/client/components/LoginForm.tsx) for one-click demo. Real deployments use the standard Supabase auth flow (email confirmation, password reset, OAuth providers, etc.) — none of which the SPA exercises. The login form's "sign-up" mode is wired but does not surface email-confirmation UX.
- **The pooled / Supavisor URL is not exercised.** The shared `pg.Pool` in [`src/server/index.ts`](src/server/index.ts) connects via the direct URL. For production a Supavisor `transaction`-mode URL is the conventional shape; the per-request runtime works against either ([`createSupabaseRuntime`](src/server/supabase-runtime.ts) is mode-agnostic). The demo uses the direct URL so the contributor reading a single connection string can reason about the whole stack without splitting attention across two pools.
- **Architectural improvements documented as framework gaps:**
  - [FL-18 — connection-scope mode descoped](../../projects/supabase-poc/framework-limitations.md#fl-18). Production deployments on direct connections want one-time `SET ROLE` per session, not per request. The current `'transaction'` mode pays a 4-round-trip envelope cost per plan; on networked Postgres this is the dominant latency for sub-millisecond reads.
  - [FL-19 — anon-session per-request envelope](../../projects/supabase-poc/framework-limitations.md#fl-19). Same root cause as FL-18, expressed in the public-route case: every `GET /api/public/messages` pays the envelope cost. Acceptable for low-traffic public endpoints; high-traffic ones want either FL-18 (connection-scope) or an HTTP cache layer above PN.
  - [FL-20 — realtime publication membership](../../projects/supabase-poc/framework-limitations.md#fl-20). The `ALTER PUBLICATION supabase_realtime ADD TABLE public.todos` step lives in the seed script because PN's contract IR has no notion of publication membership. A production deployment that doesn't run the seed (e.g. a CI job that loads its own fixtures) loses Realtime silently. The upstream fix would graduate this into a PN migration op.

These are recorded as gaps the PoC does not close; "addressing them" is a separate scope. If the patterns established here graduate into the framework, the [design sketches](../../projects/supabase-poc/framework-limitations.md#design-sketches--proposed-upstream-work) at the bottom of the framework-limitations doc are the path.

## Cross-references

- [`projects/supabase-poc/spec.md`](../../projects/supabase-poc/spec.md) — PoC design and requirements.
- [`projects/supabase-poc/framework-limitations.md`](../../projects/supabase-poc/framework-limitations.md) — gaps surfaced by the PoC and the design sketches that close them.
- [`projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md`](../../projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md) — opinionated guide to authoring RLS in a PN codebase.
