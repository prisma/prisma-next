# @prisma-next/extension-supabase

Supabase extension pack for Prisma Next.

## Overview

This extension pack ships a **complete, faithful contract of everything Supabase owns in the database** — every `auth` (23) and `storage` (10) table of the reference platform version, their native enum types, and the three platform roles (`anon`, `authenticated`, `service_role`) — all `external`: an application contract composes them via `extensionPacks: [supabasePack]`, the migration planner emits no DDL for them (they're Supabase-managed), and `db verify` confirms they exist in the live database while tolerating the Supabase-internal schemas the pack doesn't declare (`realtime`, `vault`, …).

It also ships the role-binding runtime: `supabase({...})` returns a db whose `asUser(jwt)` / `asAnon()` / `asServiceRole()` bind the Postgres role + JWT claims per session, and `asServiceRole().supabase.{sql,orm}` exposes the pack's own `auth`/`storage` tables as a secondary root for admin reads. See [`projects/supabase-integration/README.md`](../../../projects/supabase-integration/README.md) for the integration's delivery plan.

## Contract generation

The contract is **introspected, not hand-authored**: `pnpm contract:generate` restores the checked-in reference fixture (`test/fixtures/supabase-reference/`, captured from **supabase/postgres:17.6.1.106** — PostgreSQL 17.6, gotrue v2.188.1, storage-api v1.54.1, supabase CLI 2.95.4, 2026-07-12) into a fresh PGlite database, introspects `auth` + `storage`, writes `src/contract/contract.prisma`, and emits. Reruns are byte-identical. The honest boundary of "faithful" — the handful of columns/defaults/indexes deliberately not declared, and why that's verify-safe under `external` — is recorded in [`src/contract/CONTRACT-FIDELITY.md`](./src/contract/CONTRACT-FIDELITY.md). To track a newer Supabase platform version, re-capture the fixture from a newer stack (record the new version pins in the fixture header) and rerun `contract:generate`.

## Responsibilities

- **Supabase contract**: the complete introspection-generated contract described above, `defaultControlPolicy: 'external'`, roles contributed as first-class `role` entities during emit (`prisma-next.config.ts`).
- **`/pack` subpath**: an `ExtensionPack` value (`supabasePack` default + `supabasePackWith(options)` factory) that an app composes into its config via `extensionPacks`. Tree-shaking-clean — `/pack` imports no runtime code.
- **`/runtime` subpath**: the `SupabaseRuntime` role-binding runtime and `supabase({...})` facade (session-coupled `set_config` role + claims binding, per [ADR 230](../../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md)), plus the `service_role`-only `.supabase` secondary root.
- **`/contract` subpath**: branded model handles for the commonly-referenced models (`AuthUser`, `AuthIdentity`, `AuthSession`, `StorageBucket`, `StorageObject`) used for cross-space FK references from app contracts. The handle set is deliberately curated, not one-per-table.
- **`/test/utils` subpath**: exports `bootstrapSupabaseShim(client)` — restores the full reference fixture (all Supabase schemas, tables, roles) into a test database and layers the grants/`auth.uid()`-style functions tests need. Used by this package's tests and by `examples/supabase`.

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

## What this pack does *not* ship

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
