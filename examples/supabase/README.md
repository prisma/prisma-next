# Supabase example

The canonical runnable Prisma Next + Supabase app, and the walking skeleton the [`extension-supabase`](../../packages/3-extensions/supabase) integration was built against. It exercises every piece of the stack end-to-end against a real Postgres (PGlite for the hermetic lane; a live `supabase start` stack for the acceptance run — both in CI).

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

Two lanes:

**Hermetic (default — every PR, no Docker):**

```bash
pnpm test
```

Runs on PGlite (real Postgres in WASM) seeded by `restoreSupabaseReference` (the extension's internal test substrate), which restores the Supabase reference fixture — schemas, tables, roles, and the platform's real default privileges — so grants behave as on a fresh `supabase db reset`. This lane covers the FK, RLS enforcement, the verifier, and namespace queries.

**Real-Supabase acceptance (runs in CI against a live local stack):**

`test/real-supabase.acceptance.test.ts` runs the RLS role-binding flows — anon read, authenticated update-own, service-role read, JWT failure, and a GoTrue-issued token verified through the project's JWKS endpoint — against a live Supabase Postgres. CI runs it on every PR via the `supabase-acceptance` job (`.github/workflows/ci.yml`): `supabase start` in this directory (the minimal `supabase/config.toml` here is what the CLI needs), then the suite with credentials exported from `supabase status`.

To run it locally against your own stack:

```bash
supabase start                      # in examples/supabase
DATABASE_URL='postgres://…'         # supabase status → DB URL (direct, service_role-capable)
SUPABASE_JWT_SECRET='…'             # supabase status → JWT secret (for self-minted HS256 test tokens)
SUPABASE_URL='http://127.0.0.1:54321'  # supabase status → API URL (enables the GoTrue/JWKS test)
SUPABASE_ANON_KEY='…'               # supabase status → anon key
pnpm test
```

The suite is **skipped** (green) whenever `DATABASE_URL` or `SUPABASE_JWT_SECRET` is unset; the GoTrue/JWKS test additionally needs `SUPABASE_URL` + `SUPABASE_ANON_KEY`. Three flows self-mint HS256 tokens with the stack's real `SUPABASE_JWT_SECRET`; the JWKS flow uses a token the stack's own auth server issues (ES256 on a current stack) and verifies it through `/auth/v1/.well-known/jwks.json` — the signing configuration a new Supabase project has out of the box. Seeded `auth.users` rows are torn down after each flow.
