# @prisma-next/postgres

One-liner lazy Postgres client for Prisma Next runtime composition.

## Package Classification

- **Domain**: targets
- **Layer**: clients
- **Plane**: runtime

## Overview

`@prisma-next/postgres/runtime` exposes a single `postgres(...)` helper that composes the SQL execution stack for Postgres and returns static query roots immediately:

- `db.sql`
- `db.schema`
- `db.orm`
- `db.context`
- `db.stack`

Runtime and connection resources are deferred until `db.runtime()` is called.

## Responsibilities

- Build a static Postgres execution stack from target, adapter, and driver descriptors
- Build static query roots from the execution context
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
- `@prisma-next/sql-relational-core` for `schema(...)`
- `@prisma-next/sql-orm-lane` for `orm(...)`
- `@prisma-next/sql-contract` for `validateContract(...)` and contract types
- `pg` for lazy `Pool` construction when using URL binding

## Architecture

```mermaid
flowchart TD
    App[App Code] --> Client[postgres(...)]
    Client --> Static[Static roots: sql schema orm context stack]
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
