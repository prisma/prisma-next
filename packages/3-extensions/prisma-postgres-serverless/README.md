# @prisma-next/prisma-postgres-serverless

Edge/serverless-friendly Prisma Postgres facade for Prisma Next. Install this single package to get config, runtime, and the transitive type dependencies needed to author and run a Prisma Postgres app against the `@prisma/ppg` WebSocket client — no `pg` / `pg-cursor` and no TCP transport, so the surface is portable to edge runtimes that do not expose raw TCP sockets.

> **Placeholder facade.** The package shell, build pipeline, and architecture-layering wiring are in place; the substantive `defineConfig`, `defineContract`, and `runtime()` implementations are not. Importing the package compiles cleanly; calling those exports throws `"prisma-postgres-serverless: <name> is not yet implemented; …"` at runtime. Use [`@prisma-next/postgres`](../postgres/README.md) for the time being.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Planes**: shared (config, contract-builder, family, target), runtime (runtime), migration (migration)

## Overview

This facade composes a Prisma Postgres execution stack on top of:

- the existing `postgres` target (`@prisma-next/target-postgres`) — same dialect, same migration ops as the long-lived facade;
- the existing `postgres` adapter (`@prisma-next/adapter-postgres`) — shared SQL lowering;
- the new `@prisma-next/driver-ppg-serverless` driver — WebSocket transport via `@prisma/ppg`.

Two facades therefore ship under separate package names, each pinning a different driver:

- [`@prisma-next/postgres`](../postgres/README.md) — long-lived Node process facade, TCP driver, closure-cached `runtime()` / `orm` / `transaction()`.
- `@prisma-next/prisma-postgres-serverless` — per-request facade for serverless / edge runtimes, WebSocket-only driver, no TCP fallback, no `pg-cursor`.

The asymmetry is intentional. Closure caching is unsafe across `fetch` invocations on serverless runtimes (stale connections after isolate idle, concurrent-query races, no clean shutdown), so the serverless facade is built to acquire a fresh runtime per request via an `AsyncDisposable`-shaped `connect()` call.

## Exports

| Subpath | Status (this release) | Notes |
|---|---|---|
| `./config` | Stub — throws | `defineConfig` signature published; body lands in a follow-up. |
| `./contract-builder` | Stub — throws | `defineContract` signature published; body lands in a follow-up. |
| `./family` | Re-export | `@prisma-next/family-sql/pack` (the value passed as `family:` to `defineContract`). |
| `./migration` | Re-export | `@prisma-next/target-postgres/migration` — Migration base class, CLI runner, op helpers. |
| `./runtime` | Stub — throws | `runtime()` factory + `PrismaPostgresServerlessOptions` type published; body lands in a follow-up. |
| `./target` | Re-export | `@prisma-next/target-postgres/pack` (the value passed as `target:` to `defineContract`). |

Compared to `@prisma-next/postgres`, two exports are deliberately absent:

- **No `./control`.** The migration control plane is served by `@prisma-next/postgres/control`; the serverless facade does not need its own.
- **No `./serverless`.** This package _is_ the serverless surface; there is no second facade hiding behind a subpath.

## Architecture

```mermaid
flowchart TD
    App[App Code] --> Client[prisma-postgres-serverless runtime]
    Client --> Static[Roots: sql, context, stack, contract]
    Client --> Lazy[connect / per-request runtime]

    Lazy --> Bind[Resolve binding: url or ppgClient]
    Bind --> NewSession[ppg Client.newSession per call or per connection]
    Lazy --> Runtime[createRuntime]

    Runtime --> Target[@prisma-next/target-postgres]
    Runtime --> Adapter[@prisma-next/adapter-postgres]
    Runtime --> Driver[@prisma-next/driver-ppg-serverless]
    Runtime --> SqlRuntime[@prisma-next/sql-runtime]
    Runtime --> ExecPlane[@prisma-next/framework-components/execution]
```

## Dependencies

- `@prisma/ppg` (via `@prisma-next/driver-ppg-serverless`) — Prisma Postgres WebSocket client.
- `@prisma-next/sql-runtime` — stack / context / runtime primitives.
- `@prisma-next/framework-components/execution` — stack instantiation.
- `@prisma-next/target-postgres` — target descriptor (shared with the long-lived facade).
- `@prisma-next/adapter-postgres` — adapter descriptor (shared with the long-lived facade).
- `@prisma-next/driver-ppg-serverless` — driver descriptor (this facade's defining choice).
- `@prisma-next/sql-builder`, `@prisma-next/sql-orm-client`, `@prisma-next/sql-contract` — authoring + ORM surfaces.

## Related Docs

- Architecture: [`docs/Architecture Overview.md`](../../docs/Architecture%20Overview.md)
- Subsystem: [`docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`](../../docs/architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md)
- Subsystem: [`docs/architecture docs/subsystems/5. Adapters & Targets.md`](../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md)
