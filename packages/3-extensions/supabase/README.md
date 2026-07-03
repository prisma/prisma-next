# @prisma-next/extension-supabase

Supabase extension pack for Prisma Next.

## Overview

This extension pack ships a Supabase-shaped contract — the `auth.*` and `storage.*` namespaces as `external` tables — so an application contract can compose them via `extensionPacks: [supabasePack]` and have the framework treat them correctly: the migration planner emits no DDL for them (they're Supabase-managed), and the verifier confirms they exist in the live database.

This is an early milestone of the Supabase integration. The package now includes the Supabase contract surface, exported handles for cross-contract relations, a role-bound runtime facade (`asUser()` / `asAnon()` / `asServiceRole()`), and a service-role-only internal root for `auth.*` and `storage.*` queries. The Postgres target provides PSL `policy_select` authoring, so the runnable example can define an RLS policy in the app contract and exercise it through the role-bound runtime. Direct merged `db.sql.auth.users` query surfaces and first-class Supabase role IR remain follow-up work. See [`projects/supabase-integration/README.md`](../../../projects/supabase-integration/README.md) for the integration's full delivery plan.

## Responsibilities

- **Supabase contract**: ships a PSL-authored contract describing the `auth.*` (`AuthUser`, `AuthIdentity`) and `storage.*` (`StorageBucket`, `StorageObject`) tables with `defaultControlPolicy: 'external'`, so the framework verifies them as present without managing their DDL.
- **`/pack` subpath**: an `ExtensionPack` value (`supabasePack` default + `supabasePackWith(options)` factory) that an app composes into its config via `extensionPacks`. Tree-shaking-clean — `/pack` imports no runtime code.
- **`/contract` subpath**: exports `AuthUser`, `AuthIdentity`, `StorageBucket`, and `StorageObject` handles so app contracts can declare relations and foreign keys that point into Supabase-managed schemas.
- **`/runtime` subpath**: exports the runtime descriptor plus the `supabase()` facade. The facade verifies user JWTs, creates app-contract role-bound surfaces with `asUser(jwt)` and `asAnon()`, and exposes a `service_role` surface with `asServiceRole()`. The service-role surface also includes a `.supabase` secondary root for the extension-owned `auth.*` and `storage.*` contract.
- **`/test/utils` subpath**: exports `bootstrapSupabaseShim(client)` — the shared Postgres/PGlite test fixture that seeds the external `auth`/`storage` schemas, their tables, Supabase platform roles, and `auth.uid()`. Used by this package's tests and by `examples/supabase`, including the RLS role-binding and cross-contract FK fixtures.

## Dependencies

- **`@prisma-next/contract`**: contract types the `/pack` descriptor and emitted artefacts depend on.
- **`@prisma-next/family-sql`**: SQL family pack ref + `SqlControlExtensionDescriptor` type the `/pack` descriptor satisfies.
- **`@prisma-next/framework-components`**: shared component / pack-ref types plus execution-stack helpers the pack and runtime consume.
- **`@prisma-next/postgres`, `@prisma-next/adapter-postgres`, `@prisma-next/driver-postgres`, `@prisma-next/target-postgres`**: the Postgres runtime stack and contract serializer behind the Supabase facade.
- **`@prisma-next/sql-builder` and `@prisma-next/sql-orm-client`**: the typed `.sql` and `.orm` query roots exposed by each role-bound surface.
- **`@prisma-next/sql-runtime`**: runtime descriptor and middleware/execution types used by the facade.
- **`@prisma-next/sql-contract-psl`**: `prismaContract` provider used by `prisma-next.config.ts` to emit the PSL-authored contract.
- **`@prisma-next/utils`**: `blindCast` helper for narrowing the imported `contract.json` to the emitted `Contract` type.
- **`jose` and `pg`**: JWT verification and PostgreSQL client/pool support.

## Installation

```bash
pnpm add @prisma-next/extension-supabase
```

## Configuration

Compose the pack into your application contract via `extensionPacks`. The pack's contract space (the `auth` and `storage` namespaces) joins the app's aggregate at emit time:

```ts
// prisma-next.config.ts
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import postgresPackRef from '@prisma-next/target-postgres/pack';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import supabasePack from '@prisma-next/extension-supabase/pack';

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
  migrations: {
    dir: 'migrations',
  },
});
```

See [`examples/supabase`](../../../examples/supabase) for the full runnable walking-skeleton app.

## Runtime usage

Use the `/runtime` facade when application code needs Supabase role binding:

```ts
import { supabase } from '@prisma-next/extension-supabase/runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export const db = await supabase<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
  jwtSecret: process.env['SUPABASE_JWT_SECRET']!,
});
```

Then bind each request to the role that should execute it:

```ts
const userDb = await db.asUser(jwt);
const profile = await userDb.orm.public.Profile.first({ userId });

const anonDb = db.asAnon();
const publicRows = await anonDb
  .execute(anonDb.sql.public.profile.select('id', 'username').build())
  .toArray();

const serviceDb = db.asServiceRole();
const authUsers = await serviceDb.supabase
  .execute(serviceDb.supabase.sql.auth.users.select('id', 'email').build())
  .toArray();
```

`asUser(jwt)` verifies the JWT using either `jwtSecret` or `jwksUrl` and derives the Supabase role from the token payload. `asAnon()` binds the `anon` role without a JWT. `asServiceRole()` binds `service_role`; its primary `.sql` and `.orm` roots stay scoped to the app contract, while `.supabase` exposes the Supabase-managed `auth` and `storage` namespaces.

## What is still follow-up work

These belong to sibling Supabase-integration projects:

- **Direct merged namespace-qualified queries** (`db.sql.auth.users`) — [`explicit-namespace-dsl`](../../../projects/explicit-namespace-dsl/spec.md). Today, use `db.asServiceRole().supabase.sql.auth.users` for Supabase-managed tables.
- **Roles as first-class IR** (`anon` / `authenticated` / `service_role` / `authenticator`) — `postgres-rls` (`PostgresRole`).
- **Supabase helper functions as first-class IR** — `auth.uid()` is seeded by `bootstrapSupabaseShim` and can be used in opaque RLS predicate strings today. `auth.jwt()` / `auth.role()` and function introspection/verification remain follow-up work.

## References

- [Supabase integration umbrella](../../../projects/supabase-integration/README.md) — § "Walking skeleton" + the canonical decisions log.
- [`extension-supabase` project spec](../../../projects/extension-supabase/spec.md) — full design (M1–M4).
- [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) — the package layout this extension follows.
- [ADR 224 — Control Policy](../../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md) — `external` dispatch.
