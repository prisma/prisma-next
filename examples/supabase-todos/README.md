# supabase-todos

A Prisma Next reference application running against a local Supabase stack. The example exercises Supabase Row Level Security (RLS) and Realtime through PN's contract-first runtime: app schema is authored as a PN contract, RLS policies are authored in PN migration files, and per-request reads/writes are scoped to the authenticated user via a userspace runtime factory.

This is the running-app deliverable for the Supabase PoC. The design rationale, requirements, and milestones live in [`projects/supabase-poc/spec.md`](../../projects/supabase-poc/spec.md) and [`projects/supabase-poc/plan.md`](../../projects/supabase-poc/plan.md).

> **Status:** Milestone 1 only. The example currently scaffolds the schema, RLS policies, seed fixtures, and an admin (RLS-bypassing) runtime. The per-request scoped runtime (`createSupabaseRuntime`) lands in M2 and the Hono API + Vite SPA land in M4. The `pnpm dev` step is intentionally absent until then.

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

   Once it's up, `supabase status` prints the URLs and keys. Defaults match `.env.example`; copy it to `.env` to make the values available to the scripts:

   ```bash
   cp .env.example .env
   ```

4. **Emit the contract.** Reads [`src/db/schema.ts`](src/db/schema.ts) and writes `src/db/contract.json` + `src/db/contract.d.ts`. These are the inputs to the runtime and the migration system.

   ```bash
   pnpm --filter supabase-todos contract:emit
   ```

5. **Apply the initial PN migration.** Runs [`migrations/20260428T0354_initial/migration.ts`](migrations/20260428T0354_initial/migration.ts) via `MigrationCLI`. Creates `profiles`, `todos`, `public_messages`; enables RLS on each; installs the role-targeted policies that scope reads/writes to `auth.uid()`.

   ```bash
   pnpm --filter supabase-todos migrate:up
   ```

6. **Seed fixtures.** Creates two confirmed auth users (`alice@example.test`, `bob@example.test`) via the Supabase admin API and inserts profiles, todos, and public messages. Idempotent — re-running it is a no-op.

   ```bash
   pnpm --filter supabase-todos seed
   ```

7. **Run the test suite.** Vitest covers the in-example RLS migration factories ([`test/migrations/rls-ops.test.ts`](test/migrations/rls-ops.test.ts)) and the admin runtime smoke tests ([`test/runtime/admin.test.ts`](test/runtime/admin.test.ts)).

   ```bash
   pnpm --filter supabase-todos test
   ```

## Connection URLs — which one is used where

The example uses two distinct Postgres connection URLs, and which one a piece of code holds is what determines whether RLS is enforced.

| URL | Role | Used by | Notes |
|---|---|---|---|
| **Direct / service-role** (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) | superuser | `migrate:up`, the seed script, the admin runtime ([`src/server/db.ts`](src/server/db.ts)) | **Bypasses RLS unconditionally.** Required for `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and admin seeding. **Never use it from a request handler.** |
| **Pooled / Supavisor** (forthcoming in M2) | `authenticated` or `anon` per request | `createSupabaseRuntime` (per-request scoped runtime) | RLS is enforced; each request opens a transaction and `SET LOCAL request.jwt.claims = …` / `SET LOCAL ROLE …` to scope visibility before executing the plan. |

Concretely, the M1 admin runtime is bound to `process.env['DATABASE_URL']` (the direct URL). The M2 request runtime will be bound to a pooled URL (typically `:6543` / `pgbouncer=true`) and produced per-request by a userspace factory. See [`projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md`](../../projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md) §5 for the broader pattern.

## What's next

M2 layers RLS through the per-request `createSupabaseRuntime` factory; M4 adds the Hono API + Vite SPA (including the `pnpm dev` step and the two-tab realtime demo). See [`projects/supabase-poc/plan.md`](../../projects/supabase-poc/plan.md) for the milestone-by-milestone breakdown.

## Cross-references

- [`projects/supabase-poc/spec.md`](../../projects/supabase-poc/spec.md) — PoC design and requirements.
- [`projects/supabase-poc/plan.md`](../../projects/supabase-poc/plan.md) — milestone plan and phase index.
- [`projects/supabase-poc/framework-limitations.md`](../../projects/supabase-poc/framework-limitations.md) — gaps surfaced by the PoC and the design sketches that close them.
- [`projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md`](../../projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md) — opinionated guide to authoring RLS in a PN codebase.
