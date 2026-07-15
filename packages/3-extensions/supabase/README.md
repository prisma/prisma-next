# @prisma-next/extension-supabase

Supabase extension pack for Prisma Next.

## Overview

This extension pack ships a Supabase-shaped contract — the `auth.*` and `storage.*` namespaces as `external` tables — so an application contract can compose them via `extensionPacks: [supabasePack]` and have the framework treat them correctly: the migration planner emits no DDL for them (they're Supabase-managed), and the verifier confirms they exist in the live database.

This is **M1 of the Supabase integration** — the walking-skeleton starter. Later milestones add the role-binding runtime (`asUser()` / `asAnon()` / `asServiceRole()`); RLS, cross-contract foreign keys into `auth.users`, and explicit `auth.*` queries arrive with their respective sibling projects. See [`projects/supabase-integration/README.md`](../../../projects/supabase-integration/README.md) for the integration's full delivery plan.

## Responsibilities

- **Supabase contract**: ships a PSL-authored contract describing the `auth.*` (`AuthUser`, `AuthIdentity`) and `storage.*` (`StorageBucket`, `StorageObject`) tables with `defaultControlPolicy: 'external'`, so the framework verifies them as present without managing their DDL.
- **`/pack` subpath**: an `ExtensionPack` value (`supabasePack` default + `supabasePackWith(options)` factory) that an app composes into its config via `extensionPacks`. Tree-shaking-clean — `/pack` imports no runtime code.
- **`/runtime` subpath**: a minimal runtime descriptor so the stock Postgres runtime's pack-requirements check passes when an app composes this pack. This is **not** the role-binding `SupabaseRuntime` yet — that lands in M2.
- **`/test/utils` subpath**: exports `bootstrapSupabaseShim(connectionString)` — the shared PGlite test fixture that seeds the external `auth`/`storage` schemas + their tables. Used by this package's classification e2e and by `examples/supabase`; downstream constituents (`postgres-rls`, `cross-contract-refs`) extend it.

## Dependencies

- **`@prisma-next/contract`**: contract types the `/pack` descriptor and emitted artefacts depend on.
- **`@prisma-next/family-sql`**: SQL family pack ref + `SqlControlExtensionDescriptor` type the `/pack` descriptor satisfies.
- **`@prisma-next/framework-components`**: shared component / pack-ref type shapes the descriptor consumes.
- **`@prisma-next/sql-runtime`**: `SqlRuntimeExtensionDescriptor` the `/runtime` minimal descriptor satisfies.
- **`@prisma-next/sql-contract-psl`**: `prismaContract` provider used by `prisma-next.config.ts` to emit the PSL-authored contract.
- **`@prisma-next/utils`**: `blindCast` helper for narrowing the imported `contract.json` to the emitted `Contract` type.

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
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import postgresPackRef from '@prisma-next/target-postgres/pack';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import supabasePack from '@prisma-next/extension-supabase/pack';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  contract: prismaContract('./src/contract.prisma', { target: postgresPackRef }),
  extensionPacks: [supabasePack],
});
```

See [`examples/supabase`](../../../examples/supabase) for the full runnable walking-skeleton app.

## What this pack does *not* ship (yet)

These belong to sibling Supabase-integration projects:

- **Role-binding runtime** (`asUser(jwt)` / `asAnon()` / `asServiceRole()`) — `extension-supabase` M2 (real `SupabaseRuntime` extends `PostgresRuntime`; issues `SET LOCAL role` below user middleware).
- **RLS authoring + policies** — PSL `policy_*` blocks + `@@rls`, TS `policySelect(...)` helpers, content-addressed wire names, `pg_policies` verifier. See [ADR 234](../../../docs/architecture%20docs/adrs/ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md) and the RLS section of the [Adapters & Targets subsystem doc](../../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md).
- **Cross-contract FK to `auth.users`** — [cross-contract FK references](../../../docs/architecture%20docs/subsystems/6.%20Ecosystem%20Extensions%20%26%20Packs.md) (`supabase:auth.AuthUser` PSL grammar; cross-space references in the TS builder). See also [ADR 226](../../../docs/architecture%20docs/adrs/ADR%20226%20-%20Cross-contract%20foreign-key%20references.md).
- **Explicit namespace-qualified queries** (`db.sql.auth.users`) — [`explicit-namespace-dsl`](../../../projects/explicit-namespace-dsl/spec.md).
- **Roles as first-class IR** (`anon` / `authenticated` / `service_role` / `authenticator`) — `postgres-rls` (`PostgresRole`).
- **`auth.uid()` / `auth.jwt()` / `auth.role()` session-GUC functions** — `postgres-rls` extends `bootstrapSupabaseShim` to seed them when its RLS tests need them.

## References

- [Supabase integration umbrella](../../../projects/supabase-integration/README.md) — § "Walking skeleton" + the canonical decisions log.
- [`extension-supabase` project spec](../../../projects/extension-supabase/spec.md) — full design (M1–M4).
- [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) — the package layout this extension follows.
- [ADR 224 — Control Policy](../../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md) — `external` dispatch.
