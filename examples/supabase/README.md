# Supabase example

The canonical runnable Prisma Next + Supabase app, and the walking skeleton the [`extension-supabase`](../../packages/3-extensions/supabase) integration was built against. It exercises every piece of the stack end-to-end against a real Postgres (PGlite in CI; a live Supabase project for the acceptance run).

## What it demonstrates

- **`external` contract** — the app composes `supabasePack` via `extensionPacks`; the planner emits no DDL for `auth.*` / `storage.*`, and `db verify` confirms they exist in the database.
- **Cross-contract FK with cascade** — `Profile.userId → supabase:auth.AuthUser.id` (`onDelete: Cascade`); deleting an `auth.users` row removes the profile.
- **RLS through the framework authoring surface** — the `Profile` policies are declared in PSL (`policy_select` / `policy_update` + `@@rls` in [`src/contract.prisma`](src/contract.prisma)) and applied by `dbInit` — no hand-authored `CREATE POLICY`.
- **Role-bound runtime** — `asUser(jwt)` (RLS-scoped to the token owner), `asAnon()` (public-read policy), `asServiceRole()` (BYPASSRLS).
- **`service_role` admin root** — `asServiceRole().supabase.sql.auth.sessions` reads a Supabase-internal table, including a native-enum column (`aal`), via the secondary `.supabase` root.
- **Explicit namespace-qualified queries** — `db.sql.public.profile` and `db.sql.auth.sessions` address colliding names across schemas.

## The stack

[`prisma-next.config.ts`](prisma-next.config.ts) wires the SQL family + Postgres target and composes the Supabase pack:

```ts
extensionPacks: [supabasePack],
contract: prismaContract('./src/contract.prisma', {
  output: 'src/contract.json',
  target: postgresPackRef,
  createNamespace: postgresCreateNamespace,
}),
```

The contract is a single `Profile` model in `public` with a cross-contract FK into `auth.users` and three RLS policies (own-read, public-read, own-update-with-check). The queries live in [`src/profile-queries.ts`](src/profile-queries.ts) (app tables via a `RoleBoundDb`) and [`src/session-queries.ts`](src/session-queries.ts) (the `auth.sessions` admin read via `SupabaseInternalDb`, typed by its native `aal_level` enum).

## Running the tests

Two lanes (integration decision [C14](../../docs/architecture%20docs/Supabase%20Integration.md)):

**Hermetic (default — every PR, no Docker):**

```bash
pnpm test
```

Runs on PGlite (real Postgres in WASM) seeded by `bootstrapSupabaseShim`, which restores the Supabase reference fixture (schemas, tables, roles) and layers the grants + `auth.uid()`-style functions the RLS tests need. This lane covers the FK, RLS enforcement, the verifier, and namespace queries.

**Real-Supabase acceptance (manual — the launch ground truth):**

```bash
DATABASE_URL='postgres://…'        # a direct connection to your Supabase Postgres (service_role-capable)
SUPABASE_JWT_SECRET='…'            # the project's JWT secret (Settings → API → JWT Secret)
pnpm test
```

`test/real-supabase.acceptance.test.ts` runs the four handler flows — anon read, authenticated update-own, service-role admin read, and JWT failure — against the live project. It is **skipped** (green) whenever `DATABASE_URL` or `SUPABASE_JWT_SECRET` is unset, so it never runs on the normal CI path; it executes only when you supply both. JWTs are signed with the real `SUPABASE_JWT_SECRET` (HS256, exactly as GoTrue issues them), and the two `auth.users` rows the flows need are seeded over the privileged connection and torn down after.

> The acceptance run is the launch-blocking proof that the integration works against real Supabase, not just PGlite. Capture its output as launch evidence.
