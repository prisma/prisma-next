# @prisma-next/postgres

Composition-root Postgres helper that builds a Prisma Next runtime client and exposes SQL, ORM, schema, and Kysely-integrated query access.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Plane**: runtime

## Overview

`@prisma-next/postgres/runtime` exposes a single `postgres(...)` helper that composes the Postgres execution stack and returns query/runtime roots:

- `db.sql`
- `db.kysely(runtime)`
- `db.schema`
- `db.orm`
- `db.context`
- `db.stack`

Runtime and connection resources are deferred until `db.runtime()` is called.

When URL binding is used, pool timeouts are configurable via `poolOptions`:

- `poolOptions.connectionTimeoutMillis` (default `20_000`)
- `poolOptions.idleTimeoutMillis` (default `30_000`)

## Responsibilities

- Build a static Postgres execution stack from target, adapter, and driver descriptors
- Build typed SQL and Kysely lane instances from the same execution context
- Build static schema and ORM roots from the execution context
- Normalize runtime binding input (`binding`, `url`, `pg`)
- Lazily instantiate runtime resources on first `db.runtime()` call
- Memoize runtime so repeated `db.runtime()` calls return one instance

## Dependencies

- `@prisma-next/sql-runtime` for stack/context/runtime primitives
- `@prisma-next/core-execution-plane` for stack instantiation
- `@prisma-next/target-postgres` for target descriptor
- `@prisma-next/adapter-postgres` for adapter descriptor
- `@prisma-next/driver-postgres` for driver descriptor
- `@prisma-next/sql-lane` for `sql(...)`
- `@prisma-next/integration-kysely` for `KyselyPrismaDialect` and contract-to-Kysely typing
- `@prisma-next/sql-relational-core` for `schema(...)`
- `@prisma-next/sql-orm-client` for `orm(...)`
- `@prisma-next/sql-contract` for `validateContract(...)` and contract types
- `kysely` for query-builder API surface
- `pg` for lazy `Pool` construction when using URL binding

## Architecture

```mermaid
flowchart TD
    App[App Code] --> Client[postgres(...)]
    Client --> Static[Roots: sql kysely(runtime) schema orm context stack]
    Client --> Lazy[runtime()]

    Lazy --> Instantiate[instantiateExecutionStack]
    Lazy --> Bind[Resolve binding: url or pg]
    Bind --> Pool[pg.Pool for url binding]
    Bind --> Reuse[Reuse Pool or Client for pg binding]
    Lazy --> Runtime[createRuntime]

    Runtime --> Target[@prisma-next/target-postgres]
    Runtime --> Adapter[@prisma-next/adapter-postgres]
    Runtime --> Driver[@prisma-next/driver-postgres]
    Runtime --> SqlRuntime[@prisma-next/sql-runtime]
    Runtime --> ExecPlane[@prisma-next/core-execution-plane]
```

## Related Docs

- Spec: `agent-os/specs/2026-02-10-postgres-one-liner-lazy-client/spec.md`
- Architecture: `docs/Architecture Overview.md`
- Subsystem: `docs/architecture docs/subsystems/4. Runtime & Plugin Framework.md`
- Subsystem: `docs/architecture docs/subsystems/5. Adapters & Targets.md`
