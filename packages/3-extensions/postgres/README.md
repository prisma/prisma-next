# @prisma-next/postgres

Composition-root Postgres helper that builds a Prisma Next runtime client and exposes SQL, ORM, schema, and Kysely-integrated query access.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Plane**: runtime

## Overview

`@prisma-next/postgres/runtime` exposes a single `postgres(...)` helper that composes the Postgres execution stack and returns query/runtime roots:

- `db.sql`
- `db.kysely` (lane-owned build-only authoring surface: `build(query)` + `whereExpr(query)`)
- `db.schema`
- `db.orm`
- `db.context`
- `db.stack`

`db.kysely` is produced by `@prisma-next/sql-kysely-lane` and intentionally exposes lane behavior, not raw Kysely execution APIs. `build(query)` infers plan row type from `query.compile()`, and `whereExpr(query)` produces `ToWhereExpr` payloads for ORM `.where(...)` interop.

Runtime resources are deferred until `db.runtime()` or `db.connect(...)` is called.
Connection binding can be provided up front (`url`, `pg`, `binding`) or deferred via `db.connect(...)`.

When URL binding is used, pool timeouts are configurable via `poolOptions`:

- `poolOptions.connectionTimeoutMillis` (default `20_000`)
- `poolOptions.idleTimeoutMillis` (default `30_000`)

## Responsibilities

- Build a static Postgres execution stack from target, adapter, and driver descriptors
- Build typed SQL and a build-only Kysely authoring surface from the same execution context
- Build static schema and ORM roots from the execution context
- Normalize runtime binding input (`binding`, `url`, `pg`)
- Lazily instantiate runtime resources on first `db.runtime()` or `db.connect(...)` call
- Connect the internal Postgres driver through `db.connect(...)` or from initial binding options
- Memoize runtime so repeated `db.runtime()` calls return one instance

## Dependencies

- `@prisma-next/sql-runtime` for stack/context/runtime primitives
- `@prisma-next/core-execution-plane` for stack instantiation
- `@prisma-next/target-postgres` for target descriptor
- `@prisma-next/adapter-postgres` for adapter descriptor
- `@prisma-next/driver-postgres` for driver descriptor
- `@prisma-next/sql-lane` for `sql(...)`
- `@prisma-next/sql-kysely-lane` for contract-to-Kysely typing and build-only Kysely plan assembly
- `@prisma-next/sql-relational-core` for `schema(...)`
- `@prisma-next/sql-orm-client` for `orm(...)`
- `@prisma-next/sql-contract` for `validateContract(...)` and contract types
- `pg` for lazy `Pool` construction when using URL binding

## Architecture

```mermaid
flowchart TD
    App[App Code] --> Client[postgres(...)]
    Client --> Static[Roots: sql kysely(build-only) schema orm context stack]
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
