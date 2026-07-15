---
name: prisma-next-supabase
description: "Use Prisma Next with a Supabase project via `@prisma-next/extension-supabase` — wire `extensionPacks: [supabasePack]`, declare cross-space FKs to `supabase:auth.AuthUser`, author RLS policies (`policy_select` / `policy_update` / `@@rls`, `auth.uid()` predicates), build `db.ts` with the `supabase()` factory, bind roles per request (`asUser(jwt)` / `asAnon()` / `asServiceRole()`), query `auth.*` / `storage.*` via the `db.supabase` admin root, and validate JWTs (`jwtSecret` / `jwksUrl`). Use for supabase, RLS, row level security, policy, role binding, anon, authenticated, service_role, auth.users, auth.uid(), JWT, SUPABASE_JWT_SECRET, InvalidJwtError, SupabaseConfigError, RoleBoundDb, session pooler, supabase:auth.AuthUser, @prisma-next/extension-supabase."
---

# Prisma Next — Supabase

> **Edit your data contract. Prisma handles the rest.**

This skill covers using Prisma Next against a **Supabase** project end-to-end: composing the Supabase extension pack, referencing Supabase-owned tables from your contract, authoring row-level-security (RLS) policies, and running role-bound queries through the `supabase()` runtime.

## When to Use

- User has a Supabase project (or wants one) and is wiring Prisma Next into it.
- User wants RLS policies on their tables (`policy_select`, `@@rls`, `auth.uid()`).
- User wants per-request role binding (`asUser(jwt)`, `asAnon()`, `asServiceRole()`).
- User wants a foreign key into `auth.users` (cross-space FK).
- User wants to read Supabase-internal tables (`auth.*`, `storage.*`) as an admin.
- User mentions: *supabase, RLS, row level security, policy, anon, authenticated, service_role, auth.users, auth.uid(), JWT, jwtSecret, jwksUrl, InvalidJwtError, RoleBoundDb, session pooler*.

## When Not to Use

- General contract editing (models, fields, relations) → `prisma-next-contract`.
- Non-Supabase `db.ts` wiring, middleware, teardown → `prisma-next-runtime`.
- General query shapes (filtering, includes, aggregates) → `prisma-next-queries` — everything there applies to a role-bound `db` too.
- Migration planning / applying → `prisma-next-migrations`.

## Key Concepts

- **The pack is an `external` contract space.** `@prisma-next/extension-supabase/pack` ships a complete, introspection-generated contract of everything Supabase owns — the `auth` and `storage` schemas, their native enum types, and the platform roles (`anon`, `authenticated`, `service_role`) — all with control policy `external`. Composed via `extensionPacks`, it means: the migration planner **emits no DDL** for those objects (Supabase manages them), and `db verify` **confirms they exist** in the live database. Your own tables stay `managed` as usual.
- **Roles come from the pack; you never declare them.** RLS `roles = [authenticated]` identifiers resolve against the composed contract. Pointing the runtime at a non-Supabase Postgres fails verify with a `not-found` issue naming the missing role — the common "wrong database" misconfiguration surfaces before queries run.
- **The runtime is role-first.** `supabase()` returns a `SupabaseDb` with **no top-level query surface** — there is no `db.sql` / `db.orm` until you bind a role. `await db.asUser(jwt)` / `db.asAnon()` / `db.asServiceRole()` each return a `RoleBoundDb` exposing `.sql`, `.orm`, `.raw`, `.execute(plan)`, and `.transaction(fn)`. This is deliberate: in a Supabase app there is no meaningful "no role" execution context, and defaulting to the connection's login role is a silent-RLS-bypass footgun.
- **Role binding is below middleware and cannot leak.** Each role-bound query runs on a connection that had `set_config('role', …)` and `set_config('request.jwt.claims', …)` applied beneath the user-middleware chain, with `RESET ALL` on release. Postgres-side `auth.uid()` / `auth.jwt()` read those session vars — RLS enforcement is Postgres's job; the runtime's job is binding the context.
- **RLS is enforced by policies *and* grants.** Policies filter *rows*; `GRANT` controls *table access*. Prisma Next authors and migrates the policies; it does not author grants (see *What Prisma Next doesn't do yet*). A role with policies but no `GRANT SELECT` gets a permission error, not filtered rows.
- **JWT validation is eager and configurable.** `asUser(jwt)` verifies the token (via `jose`) *before* any connection is acquired: signature + expiry against `jwtSecret` (the HS256 Supabase JWT secret) **xor** `jwksUrl` (asymmetric signing keys). Both or neither → `SupabaseConfigError`. Bad tokens throw `InvalidJwtError` with a typed `reason`. The Postgres role is derived from the token's `role` claim (defaults to `authenticated`).
- **Admin access to `auth.*` / `storage.*` is a secondary root on `service_role` only.** `db.asServiceRole().supabase` exposes the pack's own contract (`.sql`, `.orm`, `.nativeEnums`, `.execute`) — `service_role` is the one role with grants on those schemas over a direct connection. `asUser` / `asAnon` have no `.supabase`, and the primary `asServiceRole().sql` / `.orm` stay scoped to *your* contract.

## Workflow — Wire the pack into the config

The concept: the pack registers the Supabase contract space so your contract can reference it and the planner/verifier know what Supabase owns. The extension has no `/control` subpath yet, so it can't go through the target façade's `defineConfig({ extensions: [...] })` — it wires into the low-level config's `extensionPacks` (see *What Prisma Next doesn't do yet*). The low-level imports below are a **deliberate exception** to the façade-only import rule, forced by that gap; the block mirrors `examples/supabase/prisma-next.config.ts` verbatim — copy it rather than composing your own:

```typescript
// prisma-next.config.ts
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import supabasePack from '@prisma-next/extension-supabase/pack';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import postgresPackRef from '@prisma-next/target-postgres/pack';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [supabasePack],
  contract: prismaContract('./src/contract.prisma', {
    output: 'src/contract.json',
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
  }),
  migrations: { dir: 'migrations' },
});
```

## Workflow — Contract: FK into `auth.users` + RLS policies

The concept: your models live in your namespaces (`public`); Supabase's live in the pack's (`auth`, `storage`). A relation field typed `supabase:auth.AuthUser` is a **cross-space FK** — the planner emits `REFERENCES "auth"."users"("id")`, and the target table is verified, never migrated. RLS policies are top-level `policy_<operation>` blocks in the same namespace as their target model, and the target model must opt in with `@@rls`. Mirror `examples/supabase/src/contract.prisma`:

```prisma
types {
  Uuid = String @db.Uuid
}

namespace public {
  model Profile {
    id       Uuid   @id @default(uuid())
    username String
    userId   Uuid   @unique
    user     supabase:auth.AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
    @@map("profile")
    @@rls
  }

  // authenticated may read only their own profile.
  policy_select profile_owner_read {
    target = Profile
    roles  = [authenticated]
    using  = "\"userId\"::uuid = auth.uid()"
  }

  // anon may read every profile (a public directory listing).
  policy_select profile_public_read {
    target = Profile
    roles  = [anon]
    using  = "true"
  }

  // authenticated may update only their own profile, and may not
  // reassign it to another owner (WITH CHECK).
  policy_update profile_owner_write {
    target    = Profile
    roles     = [authenticated]
    using     = "\"userId\"::uuid = auth.uid()"
    withCheck = "\"userId\"::uuid = auth.uid()"
  }
}
```

The pieces:

- **Per-operation policy blocks**: `policy_select`, `policy_insert`, `policy_update`, `policy_delete`, `policy_all`. Body is `key = value`: `target` (a model in this namespace), `roles` (resolve against the composed contract — the pack supplies `anon` / `authenticated` / `service_role`), `using`, and (for write operations) `withCheck`. Multiple permissive policies per `(target, operation)` are valid — Postgres ORs them.
- **`@@rls` is required on policy targets.** A `policy_*` block whose target model lacks `@@rls` fails emit with `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE`. A model with `@@rls` and *no* policies is also meaningful: RLS enabled, deny-all.
- **Predicates are verbatim SQL strings.** Quote camelCase column names inside them (`\"userId\"`), and cast where needed — `auth.uid()` returns `uuid`. Renames in your contract do not rewrite predicate bodies.
- **TS-builder parity exists.** `@prisma-next/postgres/contract-builder` exports `policySelect` / `policyInsert` / `policyUpdate` / `policyDelete` / `policyAll`, `rlsEnabled(Model)`, and `role('anon')` — mirroring the PSL lowering key-for-key (identical emitted wire names). PSL is the canonical path shown here.

Emit + migrate as usual (`prisma-next contract emit`, then `prisma-next-migrations`). The plan creates your table, its FK, `ENABLE ROW LEVEL SECURITY`, and the `CREATE POLICY` statements — and **no DDL for `auth.*`**.

## Workflow — `db.ts` with the `supabase()` factory

The concept: instead of the stock `postgres()` factory, a Supabase app builds its client with `supabase()` from the extension's `/runtime` subpath. The factory is **async** (it prepares JWT key material — including the one-time JWKS fetch when `jwksUrl` is set), and the result is role-first.

```typescript
// src/prisma/db.ts
import { supabase } from '@prisma-next/extension-supabase/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = await supabase<Contract>({
  contractJson,
  url: process.env['DATABASE_URL'],          // direct Postgres connection — see pitfalls
  jwtSecret: process.env['SUPABASE_JWT_SECRET'], // xor jwksUrl: 'https://…/.well-known/jwks.json'
});
```

Options beyond the basics: `middleware` (same composition as `postgres()` — see `prisma-next-runtime`; middleware never sees the role-binding `set_config` calls), `poolOptions`, `pg` (BYO `pg.Pool` / `pg.Client` instead of `url`). Teardown is `await db.close()` / `await using` exactly as in `prisma-next-runtime` — the same script-hang rules apply.

## Workflow — Role-bound queries

The concept: bind the role that should execute the request, then query through the returned `RoleBoundDb` — every query surface from `prisma-next-queries` works, RLS-filtered by Postgres.

```typescript
// A signed-in user: rows are RLS-scoped to the JWT's auth.uid().
const userDb = await db.asUser(jwt); // async — throws InvalidJwtError on a bad/expired token
const mine = await userDb.orm.public.Profile.select('id', 'username').all();

// The anon role: sees what anon policies permit.
const listing = await db.asAnon().orm.public.Profile.select('id', 'username').all();

// service_role: BYPASSRLS — sees everything in YOUR contract.
const all = await db.asServiceRole().orm.public.Profile.select('id', 'username').all();

// Writes ride the same surfaces; RLS filters them too. An UPDATE against
// another owner's row affects 0 rows; a withCheck violation raises an error.
const updated = await userDb.orm.public.Profile
  .where({ userId: me })
  .updateCount({ username: 'new-name' });
```

Notes: `asAnon()` / `asServiceRole()` are sync; only `asUser` is async. Multi-namespace contracts address models by coordinate (`orm.public.Profile`, `sql.public.profile`) — see `prisma-next-queries` § *Namespace-aware accessors*. `RoleBoundDb.transaction(fn)` wraps work in a transaction on the role-bound session.

## Workflow — Admin reads of `auth.*` / `storage.*`

The concept: Supabase-internal tables are not part of your contract, so they are not on your query surfaces. The `service_role` binding carries a **secondary root** — `db.asServiceRole().supabase` — which is the *pack's* contract surface:

```typescript
const admin = db.asServiceRole();

// SQL builder over the pack contract:
const users = await admin.supabase
  .execute(admin.supabase.sql.auth.users.select('id', 'email').build())
  .toArray();

// ORM over the pack contract:
const sessions = await admin.supabase.orm.auth.AuthSession.select('id', 'aal').all();

// Native enum values (e.g. auth.aal_level) come typed:
type AalLevel = (typeof admin.supabase.nativeEnums.auth.AalLevel)['Value'];
```

Boundaries to respect: `asUser` / `asAnon` have **no** `.supabase` (they lack the grants); the admin root has **no** `.transaction` (it is a separate contract-bound runtime sharing the pool — a transaction spanning both roots is out of scope); and for user *management* (creating users, password resets) prefer the GoTrue Admin API — Supabase-internal schemas can drift across platform upgrades; direct `service_role` SQL is for ad-hoc admin reads.

## Workflow — Grants (one-time setup)

The concept: RLS policies are row filters on top of ordinary table privileges. After your first migration creates a table, grant the roles access **once** (Supabase's own dashboard-created tables get grants automatically; Prisma-Next-created tables do not):

```sql
GRANT SELECT ON public.profile TO anon, authenticated;
GRANT UPDATE ON public.profile TO authenticated;
GRANT ALL ON public.profile TO service_role;
```

Run it via the Supabase SQL editor or `psql`. Symptom of a missing grant: `permission denied for table …` instead of an empty result.

## Workflow — Connecting to a real Supabase project

The concept: the runtime needs a **direct, session-capable** Postgres connection — it binds roles with session-scoped `set_config` + `RESET ALL`.

- **Session pooler** (`aws-0-<region>.pooler.supabase.com:5432`, username `postgres.<project-ref>`) — works everywhere, IPv4. The default choice.
- **Direct connection** (`db.<project-ref>.supabase.co:5432`) — works, but is **IPv6-only** on new projects; from IPv4-only environments it fails DNS/connect.
- **Transaction pooler (port 6543) — do not use.** Transaction pooling breaks session GUCs; role binding will misbehave.

`DATABASE_URL` and `SUPABASE_JWT_SECRET` (Project Settings → API → JWT Secret) live in `.env`.

## Workflow — Testing without a Supabase project

The concept: RLS, roles, and JWT-claim session vars are plain Postgres mechanisms, so tests run hermetically on PGlite. `@prisma-next/extension-supabase/test/utils` exports `bootstrapSupabaseShim(client)`, which restores a reference snapshot of Supabase's schemas, tables, and roles into a test database. The canonical worked examples are `examples/supabase/test/rls-role-binding.integration.test.ts` (hermetic) and `examples/supabase/test/real-supabase.acceptance.test.ts` (env-guarded run against a live project). Test JWTs are self-signed HS256 tokens using the same secret the factory gets — no GoTrue round-trip needed.

## Common Pitfalls

1. **Using the transaction pooler (port 6543).** Session GUC role binding requires a session-capable connection — use the session pooler (5432) or the direct connection.
2. **Missing grants.** Policies without `GRANT` yield `permission denied`, not filtered rows. Run the one-time grants after the first migration.
3. **Expecting `db.sql` / `db.orm` on the top-level `db`.** The Supabase db is role-first; bind a role, query the `RoleBoundDb`.
4. **Forgetting `await`** — on the `supabase()` factory and on `asUser(jwt)`. Both are async; `asAnon()` / `asServiceRole()` are not.
5. **Expecting `.supabase` on `asUser` / `asAnon`.** Admin access to `auth.*` is `service_role`-only by construction.
6. **A `policy_*` block whose target lacks `@@rls`.** Emit fails with `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE` — add `@@rls` to the model.
7. **Unquoted camelCase columns or missing casts in predicates.** Predicates are verbatim SQL: `"userId"` needs quotes; compare uuid to `auth.uid()` with a `::uuid` cast where the column isn't already `uuid`.
8. **Passing both `jwtSecret` and `jwksUrl`** (or neither) — the `supabase()` promise rejects with `SupabaseConfigError`. It's an async factory, so the misconfiguration surfaces as a rejection (`await` / `.catch`), not a synchronous throw.
9. **Treating an RLS-filtered write as an error.** An `UPDATE` against a row the role can't see affects **0 rows** (no exception); only `withCheck` violations raise.

## What Prisma Next doesn't do yet

- **No `/control` subpath on the extension** — it can't register through the target façade's `defineConfig({ extensions: [...] })`; wiring goes through the low-level config's `extensionPacks` as shown above. File interest via `prisma-next-feedback`.
- **`GRANT` authoring.** Table privileges are not contract elements; run grants once by hand (SQL editor / `psql`). If you want grants managed by the contract, file via `prisma-next-feedback`.
- **Transactions spanning the app root and the `.supabase` admin root.** The two roots are separate contract-bound runtimes sharing one pool; a cross-root transaction is not supported.
- **Triggers / functions as contract elements.** The classic "create a profile row on signup" `auth.users` trigger is authored as raw SQL against your database, not in the contract. `auth.uid()` etc. appear only inside opaque policy predicate strings.
- **Supabase Realtime, storage uploads, PostgREST / `@supabase/supabase-js` interop, edge runtimes.** Out of scope for the extension — it speaks Postgres directly (Node.js / Bun).

## Reference Files

- `examples/supabase` — the canonical runnable app: config, contract, `db.ts`, hermetic + acceptance tests, README.
- `packages/3-extensions/supabase/README.md` — package-level reference (JWT modes, role-binding model, unsupported scope).
- `packages/3-extensions/supabase/src/runtime/supabase.ts` — the authoritative options/type surface (`SupabaseOptions`, `RoleBoundDb`, `ServiceRoleDb`).

## Checklist

- [ ] `extensionPacks: [supabasePack]` in the low-level `defineConfig` (no `/control` subpath exists).
- [ ] Cross-space FK typed `supabase:auth.AuthUser` with explicit `fields` / `references` (+ `onDelete` if wanted).
- [ ] Every policy target model carries `@@rls`; predicates quote camelCase columns and cast for `auth.uid()`.
- [ ] `db.ts` uses `await supabase<Contract>({ contractJson, url, jwtSecret | jwksUrl })` — exactly one JWT key source.
- [ ] Queries go through a `RoleBoundDb` from `asUser` / `asAnon` / `asServiceRole`; `asUser` is awaited.
- [ ] `auth.*` / `storage.*` reads go through `asServiceRole().supabase` only.
- [ ] One-time `GRANT`s applied for `anon` / `authenticated` / `service_role` on your tables.
- [ ] Connection is session-capable: session pooler or direct connection — never the 6543 transaction pooler.
- [ ] Did NOT confabulate a `/control` subpath, a top-level `db.sql`, `.supabase` on non-service roles, or grant authoring in the contract.
