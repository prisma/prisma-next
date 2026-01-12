# @prisma-next/adapter-postgres

PostgreSQL adapter for Prisma Next.

## Package Classification

- **Domain**: targets
- **Layer**: adapters
- **Plane**: multi-plane (shared, migration, runtime)

## Overview

The PostgreSQL adapter implements the adapter SPI for PostgreSQL databases. It provides SQL lowering, capability discovery, codec definitions, and error mapping for PostgreSQL-specific behavior. It also exports both control-plane and runtime-plane adapter descriptors for config wiring.

## Purpose

Provide PostgreSQL-specific adapter implementation, codecs, and capabilities. Enable PostgreSQL dialect support in Prisma Next through the adapter SPI.

## Responsibilities

- **Adapter Implementation**: Implement `Adapter` SPI for PostgreSQL
  - Lower SQL ASTs to PostgreSQL dialect SQL
  - Render `includeMany` as `LEFT JOIN LATERAL` with `json_agg` for nested array includes
  - Advertise PostgreSQL capabilities (`lateral`, `jsonAgg`)
  - Normalize PostgreSQL EXPLAIN output
  - Map PostgreSQL errors to `RuntimeError` envelope
- **Codec Definitions**: Define PostgreSQL codecs for type conversion
  - Wire format to JavaScript type decoding
  - JavaScript type to wire format encoding
- **Codec Types**: Export TypeScript types for PostgreSQL codecs
- **Descriptors**: Provide adapter descriptors declaring capabilities and codec type imports

**Non-goals:**
- Transport/pooling management (drivers)
- Query compilation (sql-query)
- Runtime execution (runtime)

## Architecture

This package spans multiple planes:

- **Shared plane** (`src/core/**`): Core adapter implementation, codecs, and types that can be imported by both migration and runtime planes
- **Migration plane** (`src/exports/control.ts`): Control-plane entry point that exports the adapter descriptor for config files
- **Runtime plane** (`src/exports/runtime.ts`): Runtime-plane entry point that exports the runtime adapter descriptor

```mermaid
flowchart TD
    subgraph "Runtime"
        RT[Runtime]
        PLAN[Plan]
    end

    subgraph "Postgres Adapter"
        ADAPTER[Adapter]
        LOWERER[Lowerer]
        CODECS[Codecs]
        CAPS[Capabilities]
    end

    subgraph "Postgres Driver"
        DRIVER[Driver]
        PG[(PostgreSQL)]
    end

    subgraph "Descriptors"
        CONTROL[Control Descriptor]
        RUNTIME_DESC[Runtime Descriptor]
        CODECTYPES[Codec Types]
    end

    RT --> PLAN
    PLAN --> ADAPTER
    ADAPTER --> LOWERER
    ADAPTER --> CODECS
    ADAPTER --> CAPS
    ADAPTER --> DRIVER
    DRIVER --> PG
    CONTROL --> RT
    RUNTIME_DESC --> RT
    CODECTYPES --> RT
    CODECS --> CODECTYPES
```

## Components

### Core (`src/core/`)

**Adapter (`adapter.ts`)**
- Main adapter implementation
- Lowers SQL ASTs to PostgreSQL SQL
- Renders joins (INNER, LEFT, RIGHT, FULL) with ON conditions
- Renders `includeMany` as `LEFT JOIN LATERAL` with `json_agg` for nested array includes
- Renders DML operations (INSERT, UPDATE, DELETE) with RETURNING clauses
- Advertises PostgreSQL capabilities (`lateral`, `jsonAgg`, `returning`)
- Maps PostgreSQL errors to `RuntimeError`

**Codecs (`codecs.ts`)**
- PostgreSQL codec definitions
- Type conversion between wire format and JavaScript
- Supports PostgreSQL types: `int2`, `int4`, `int8`, `float4`, `float8`, `text`, `timestamp`, `timestamptz`, `bool`

**Types (`types.ts`)**
- PostgreSQL-specific types and utilities
- Re-exports SQL contract types

### Exports (`src/exports/`)

**Control Entry Point (`control.ts`)**
- Exports the control-plane adapter descriptor for CLI config
- Used by `prisma-next.config.ts` to declare the adapter

**Runtime Entry Point (`runtime.ts`)**
- Exports the runtime-plane adapter descriptor

**Adapter Export (`adapter.ts`)**
- Re-exports `createPostgresAdapter` from core

**Codec Types Export (`codec-types.ts`)**
- Exports TypeScript type definitions for PostgreSQL codecs
- Used in `contract.d.ts` generation

**Types Export (`types.ts`)**
- Re-exports PostgreSQL-specific types

## Dependencies

- **`@prisma-next/sql-contract`**: SQL contract types
- **`@prisma-next/sql-relational-core`**: SQL AST types and codec registry
- **`@prisma-next/cli`**: CLI config types and extension pack manifest types

## Related Subsystems

- **[Adapters & Targets](../../../../docs/architecture%20docs/subsystems/5.%20Adapters%20&%20Targets.md)**: Detailed adapter specification
- **[Ecosystem Extensions & Packs](../../../../docs/architecture%20docs/subsystems/6.%20Ecosystem%20Extensions%20&%20Packs.md)**: Extension pack model

## Related ADRs

- [ADR 005 - Thin Core Fat Targets](../../../../docs/architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)
- [ADR 016 - Adapter SPI for Lowering](../../../../docs/architecture%20docs/adrs/ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md)
- [ADR 030 - Result decoding & codecs registry](../../../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20&%20codecs%20registry.md)
- [ADR 065 - Adapter capability schema & negotiation v1](../../../../docs/architecture%20docs/adrs/ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md)
- [ADR 068 - Error mapping to RuntimeError](../../../../docs/architecture%20docs/adrs/ADR%20068%20-%20Error%20mapping%20to%20RuntimeError.md)
- [ADR 112 - Target Extension Packs](../../../../docs/architecture%20docs/adrs/ADR%20112%20-%20Target%20Extension%20Packs.md)
- [ADR 114 - Extension codecs & branded types](../../../../docs/architecture%20docs/adrs/ADR%20114%20-%20Extension%20codecs%20&%20branded%20types.md)

## Usage

### Runtime

```typescript
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createRuntime } from '@prisma-next/sql-runtime';

const runtime = createRuntime({
  contract,
  adapter: createPostgresAdapter(),
  driver: postgresDriver,
});
```

### CLI Config

```typescript
import postgresAdapter from '@prisma-next/adapter-postgres/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
});
```

## Capabilities

The adapter declares the following PostgreSQL capabilities:

- **`orderBy: true`** - Supports ORDER BY clauses
- **`limit: true`** - Supports LIMIT clauses
- **`lateral: true`** - Supports LATERAL joins for `includeMany` nested array includes
- **`jsonAgg: true`** - Supports JSON aggregation functions (`json_agg`) for `includeMany`
- **`returning: true`** - Supports RETURNING clauses for DML operations (INSERT, UPDATE, DELETE)
- **`nativeEnums: true`** - Supports native PostgreSQL enums with `CREATE TYPE ... AS ENUM` and append-only `ALTER TYPE ... ADD VALUE`

**Important**: Capabilities must be declared in **both** places:

1. **Adapter descriptor** (`src/exports/control.ts` and `src/exports/runtime.ts`): Capabilities are read during emission and included in the contract
2. **Runtime adapter code** (`src/core/adapter.ts`): The `defaultCapabilities` constant is used at runtime via `adapter.profile.capabilities`

The capabilities on the descriptor must match the capabilities in code. If they don't match, emitted contracts and runtime capability checks will diverge.

See `docs/reference/capabilities.md` and `docs/architecture docs/subsystems/5. Adapters & Targets.md` for details.

### Enum handling

- Enum identity is the column `nativeType` (e.g., `Role`).
- Migration planner emits `CREATE TYPE ... AS ENUM` before tables, appends new values with `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, and (if unused) can drop extra enums.
- Non-append changes (reorder/remove) are surfaced as conflicts.
- For targets without native enums, the shared planner can fall back to CHECK constraints per column when `supportsNativeEnums` is disabled.

## includeMany Support

The adapter supports `includeMany` for nested array includes using PostgreSQL's `LATERAL` joins and `json_agg`:

**Lowering Strategy:**
- Renders `includeMany` as `LEFT JOIN LATERAL` with a subquery that uses `json_agg(json_build_object(...))` to aggregate child rows into a JSON array
- The ON condition from the include is moved into the WHERE clause of the lateral subquery
- When both `ORDER BY` and `LIMIT` are present, wraps the query in an inner SELECT that projects individual columns with aliases, then uses `json_agg(row_to_json(sub.*))` on the result
- Uses different aliases for the table (`{alias}_lateral`) and column (`{alias}`) to avoid ambiguity

**Capabilities Required:**
- `lateral: true` - Enables LATERAL join support
- `jsonAgg: true` - Enables `json_agg` function support

**Example SQL Output:**
```sql
SELECT "user"."id" AS "id", "posts_lateral"."posts" AS "posts"
FROM "user"
LEFT JOIN LATERAL (
  SELECT json_agg(json_build_object('id', "post"."id", 'title', "post"."title")) AS "posts"
  FROM "post"
  WHERE "user"."id" = "post"."userId"
) AS "posts_lateral" ON true
```

## DML Operations with RETURNING

The adapter supports RETURNING clauses for DML operations (INSERT, UPDATE, DELETE), allowing you to return affected rows:

**Lowering Strategy:**
- Renders `RETURNING` clause after INSERT, UPDATE, or DELETE statements
- Returns specified columns from affected rows
- Supports returning multiple columns

**Capability Required:**
- `returning: true` - Enables RETURNING clause support

**Example SQL Output:**
```sql
-- INSERT with RETURNING
INSERT INTO "user" ("email", "createdAt") VALUES ($1, $2) RETURNING "user"."id", "user"."email"

-- UPDATE with RETURNING
UPDATE "user" SET "email" = $1 WHERE "user"."id" = $2 RETURNING "user"."id", "user"."email"

-- DELETE with RETURNING
DELETE FROM "user" WHERE "user"."id" = $1 RETURNING "user"."id", "user"."email"
```

**Note:** MySQL does not support RETURNING clauses. A future MySQL adapter would declare `returning: false` and either reject plans with RETURNING or provide an alternative implementation.

## Exports

- `./adapter`: Adapter implementation (`createPostgresAdapter`)
- `./codec-types`: PostgreSQL codec types (`CodecTypes`, `dataTypes`)
- `./types`: PostgreSQL-specific types
- `./control`: Control-plane entry point (adapter descriptor)
- `./runtime`: Runtime-plane entry point (runtime adapter descriptor)

