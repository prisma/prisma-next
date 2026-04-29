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
- **Storage Type Control Hooks**: Provide control-plane hooks for contract-defined storage types (e.g., enums)
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
- SQL base codecs: `sql/char`, `sql/varchar`, `sql/int`, `sql/float`
- PostgreSQL aliases for base codecs: `pg/char`, `pg/varchar`, `pg/int`, `pg/float`
- Supports PostgreSQL types: `int2`, `int4`, `int8`, `float4`, `float8`, `text`, `bool`, `enum`
- Supports PostgreSQL types: `int2`, `int4`, `int8`, `float4`, `float8`, `text`, `timestamp`, `timestamptz`, `bool`, `enum`, `json`, `jsonb`
- Parameterized types: `character(n)`, `character varying(n)`, `numeric(p,s)`, `bit(n)`, `bit varying(n)`, `timestamp(p)`, `timestamptz(p)`, `time(p)`, `timetz(p)`, `interval(p)`

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

**Column Types Export (`column-types.ts`)**
- Exports column descriptors for built-in types and enum helpers (`enumType`, `enumColumn(typeRef, nativeType)`)
- Parameterized helpers: `charColumn(length)`, `varcharColumn(length)`, `numericColumn(precision, scale?)`, `bitColumn(length)`, `varbitColumn(length)`, `timeColumn(precision?)`, `timetzColumn(precision?)`, `intervalColumn(precision?)`

- Exports raw-JSON helpers (no validation):
  - `jsonColumn`, `jsonbColumn` — static descriptors for `pg/json@1` / `pg/jsonb@1` raw-JSONB columns
  - `json()`, `jsonb()` — function wrappers returning the same static descriptors (no schema parameter; schema-validated JSON columns ship from per-library extensions, see below)

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
- [ADR 163 - Postgres JSON and JSONB typed columns](../../../../docs/architecture%20docs/adrs/ADR%20163%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md)

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
- **`sql.enums: true`** - Supports contract-defined enum storage types

**Important**: Capabilities must be declared in **both** places:

1. **Adapter descriptor** (`src/exports/control.ts` and `src/exports/runtime.ts`): Capabilities are read during emission and included in the contract
2. **Runtime adapter code** (`src/core/adapter.ts`): The `defaultCapabilities` constant is used at runtime via `adapter.profile.capabilities`

The capabilities on the descriptor must match the capabilities in code. If they don't match, emitted contracts and runtime capability checks will diverge.

See `docs/reference/capabilities.md` and `docs/architecture docs/subsystems/5. Adapters & Targets.md` for details.

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

## JSON and JSONB support

The adapter supports PostgreSQL-native `json` and `jsonb` columns. Two
shapes are available, with different responsibilities:

| Shape | Where | Validation | TS type |
| --- | --- | --- | --- |
| Raw JSON / JSONB | `@prisma-next/adapter-postgres/column-types` (`json()`, `jsonb()`, `jsonColumn`, `jsonbColumn`) | None — encode/decode is JSON identity | `JsonValue` |
| Schema-validated JSON | Per-library extensions (e.g. `@prisma-next/extension-arktype-json/column-types` exports `arktypeJson(schema)`) | Library-specific, runs in `decode` | Inferred from the schema |

### Value semantics

Both `json` and `jsonb` accept any valid JSON value:

- object
- array
- string
- number
- boolean
- JSON `null` (distinct from SQL `NULL`)

`jsonb` uses normalized binary storage, so whitespace and object key order are not preserved.

### Raw JSON authoring (no schema)

```typescript
import { jsonb, json } from '@prisma-next/adapter-postgres/column-types';

table('audit', (t) =>
  t
    .column('payload', { type: jsonb(), nullable: false })
    .column('raw', { type: json(), nullable: true }),
);
```

`json()` / `jsonb()` are function wrappers around the static `jsonColumn` / `jsonbColumn` descriptors (kept for ergonomic consistency with the parameterized helpers). They take no arguments — the column's TS type resolves to `JsonValue`; runtime validation is the caller's responsibility.

### Schema-validated JSON authoring (per-library extensions)

For columns whose payload should be validated against a schema, use a per-library extension. The first such extension is `@prisma-next/extension-arktype-json`:

```typescript
import { arktypeJson } from '@prisma-next/extension-arktype-json/column-types';
import { type as arktype } from 'arktype';

const ProductSchema = arktype({
  name: 'string',
  price: 'number',
  'description?': 'string',
});

table('event', (t) =>
  t.column('product', { type: arktypeJson(ProductSchema), nullable: false }),
);
```

The codec id is library-bound (`arktype/json@1`), not target-bound. Validation runs in `decode` against the rehydrated schema; failures throw `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED`. The emit path renders the column's TS type through arktype's `expression`, so `contract.d.ts` carries the schema's source-like rendering directly. See `@prisma-next/extension-arktype-json`'s README for the full pipeline.

The postgres adapter previously bundled a generic Standard-Schema-driven `json(schema)` / `jsonb(schema)` factory; per Phase 4 of codec-registry-unification it was removed because the generic shape was lossy for narrowed types and produced surprising behavior beyond the JSON Schema subset. Per-library extensions own the serialize / rehydrate pipeline end-to-end.

## Higher-order codec authoring

Every parameterized Postgres codec (`char(N)`, `varchar(N)`, `numeric(p, s?)`, `bit(N)`, `varbit(N)`, `timestamp(p?)`, `timestamptz(p?)`, `time(p?)`, `timetz(p?)`, `interval(p?)`) is a *higher-order codec*: a curried `(params) => (ctx) => Codec<…, Brand<P>>` function whose TypeScript signature is the type-level surface and whose body is the runtime implementation. The brand (`Char<N>`, `Numeric<P, S>`, …) propagates through curried application — `charColumn(36)` resolves to `Char<36>` in the no-emit `FieldOutputType` path, with no `pnpm emit` step required.

Two surfaces ship for each parameterized type:

- **Column-author factory** (`@prisma-next/adapter-postgres/column-types`) — returns a `ColumnTypeDescriptor` whose `type` slot carries the curried factory for the no-emit resolver. Pack-author code uses these directly: `field.column(charColumn(36))`, `field.column(numericColumn(10, 2))`.
- **Framework-registration descriptor** — exposed through the control descriptor (`./control`) which registers `allPostgresParameterizedCodecs` through the framework's `parameterizedCodecs` slot for the emit path. The runtime descriptor (`./runtime`) ships an empty parameterized list — postgres-adapter codecs are resolved at runtime through their column-author factory's `type` slot, not through a separate runtime registration.

`paramsSchema` (Standard Schema) on each descriptor validates `typeParams` arriving from a serialized contract before the framework hands them to the factory; `renderOutputType` is the emit-path renderer that stamps the brand into `contract.d.ts`. Pack authors don't validate inside the factory body and don't render types ad-hoc — both responsibilities live on the descriptor.

For named storage type instances shared across multiple columns, declare an entry in `storage.types` and reference it via `typeRef`; the runtime aggregates every column referencing the entry into a single `Ctx.usedAt` (per-instance state derived from the column set). Inline calls (`field.column(charColumn(36))`) produce an anonymous instance per column.

For schema-validated JSON, the per-library extension pattern (above) ships a parameterized `CodecDescriptor` keyed under a library-bound codec id (`arktype/json@1`); the same `paramsSchema` / `renderOutputType` / curried-factory machinery applies.

See [ADR 205 — Higher-order codecs for parameterized types](../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) for the design rationale; the `Ctx` and `CodecDescriptor` primitives are documented in `@prisma-next/framework-components`'s README.

## Exports

- `./adapter`: Adapter implementation (`createPostgresAdapter`)
- `./codec-types`: PostgreSQL codec types (`CodecTypes`, `JsonValue`, `dataTypes`, brands such as `Char<N>` / `Numeric<P, S>`)
- `./column-types`: Column-author factories — parameterized helpers (`charColumn`, `varcharColumn`, `numericColumn`, `bitColumn`, `varbitColumn`, `timeColumn`, `timetzColumn`, `intervalColumn`) plus static descriptors and zero-arg helpers (`textColumn`, `int4Column`, `boolColumn`, `jsonColumn`, `jsonbColumn`, `timestampColumn`, `timestamptzColumn`, `enumColumn`, `enumType`, `json`, `jsonb`, etc.)
- `./types`: PostgreSQL-specific types
- `./control`: Control-plane entry point (adapter descriptor with parameterized codec descriptors registered through `types.codecTypes.parameterizedCodecs`)
- `./runtime`: Runtime-plane entry point (runtime adapter descriptor; ships an empty parameterized-codecs list — postgres-adapter codecs are resolved through the column-author `type` slot)

