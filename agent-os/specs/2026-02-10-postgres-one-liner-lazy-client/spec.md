# Postgres one-liner lazy client (Drizzle-like)

Date: 2026-02-10  
Status: Draft  
Linear: [TML-1891](https://linear.app/prisma-company/issue/TML-1891/spec-tracking-postgres-one-liner-lazy-client-milestone-0) (tracking), [TML-1837](https://linear.app/prisma-company/issue/TML-1837/runtime-dx-decouple-runtime-driver-instantiation-from-connection) (related)

## Summary

Create an **app-facing, Postgres-specific one-liner** that returns a **lazy client**:

- `import postgres from '@prisma-next/postgres/runtime'`
- `const db = postgres<Contract>({ contractJson, url, extensions, plugins })` (emitted-contract workflow)
- `const db = postgres({ contract, url, extensions, plugins })` (no-emit / TS-authored contract workflow)

The returned `db` exposes **static query roots immediately** (`db.sql`, `db.schema`, `db.orm`) while deferring **all runtime/driver/pool instantiation** until the first `db.runtime()` call.

This spec also relocates `validateContract()` to **shared-plane** code so runtime helpers can validate emitted contracts without importing authoring/migration-plane packages.

## Context

Today, demo and app setup requires composing several primitives manually:

- `createSqlExecutionStack` + Postgres target/adapter/driver descriptors
- `createExecutionContext` (static)
- `instantiateExecutionStack` + driver binding + `createRuntime` (dynamic)

We want a Drizzle-like ergonomic entrypoint while preserving Prisma Next’s “static context first” architecture and aligning with the **TML-1837 direction**: separate driver instantiation from connection binding structurally (even if we offer `url` sugar).

## Goals

- Provide `@prisma-next/postgres/runtime` default export `postgres(...)` that returns a **lazy client** with surface:
  - `db.sql`, `db.schema`, `db.orm` (static roots)
  - `db.context` (static execution context)
  - `db.stack` (static execution stack descriptors)
  - `db.runtime(): Runtime` (**lazy**, memoized)
- `postgres(...)` performs **no**:
  - runtime instantiation
  - driver instance creation
  - `pg` pool/client creation
  - database connection activity
- If `contractJson` is provided, validate internally using shared-plane `validateContract<TContract>(contractJson)`.
- Update the demo so its configuration collapses to **one file** with **one helper function call**.

## Non-goals

- Implement the full TML-1837 driver lifecycle refactor (this helper must remain compatible with the direction).
- Provide cross-target generic “one-liner” helpers (Postgres only for MVP).
- Add a broad test suite beyond minimal smoke / demo validation.
- Add “override knobs” for stack construction (KISS for MVP).

## Proposed API

### Public entrypoint

- Package: `@prisma-next/postgres`
- Runtime entrypoint: `@prisma-next/postgres/runtime`
- Export: **default** `postgres`

### TypeScript signatures (proposal)

```ts
// @prisma-next/postgres/runtime
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExtractCodecTypes, ExtractOperationTypes } from '@prisma-next/sql-contract/types';
import type {
  ExecutionContext,
  Plugin,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import type { SelectBuilder } from '@prisma-next/sql-lane';
import type { OrmRegistry } from '@prisma-next/sql-orm-lane';
import type { SchemaHandle } from '@prisma-next/sql-relational-core/schema';
import type { Client, Pool } from 'pg';

export type PostgresTargetId = 'postgres';

export type PostgresBinding =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'pgPool'; readonly pool: Pool }
  | { readonly kind: 'pgClient'; readonly client: Client };

export interface PostgresClient<TContract extends SqlContract<SqlStorage>> {
  readonly sql: SelectBuilder<
    TContract,
    unknown,
    ExtractCodecTypes<TContract>,
    ExtractOperationTypes<TContract>
  >;
  readonly schema: SchemaHandle<TContract>;
  readonly orm: OrmRegistry<TContract, ExtractCodecTypes<TContract>>;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
  runtime(): Runtime;
}

export interface PostgresOptionsBase<TContract extends SqlContract<SqlStorage>> {
  readonly url?: string;
  readonly pg?: Pool | Client;
  readonly binding?: PostgresBinding;

  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
  readonly plugins?: readonly Plugin<TContract>[];
}

export type PostgresOptionsWithContract<TContract extends SqlContract<SqlStorage>> =
  PostgresOptionsBase<TContract> & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type PostgresOptionsWithContractJson<TContract extends SqlContract<SqlStorage>> =
  PostgresOptionsBase<TContract> & {
    readonly contractJson: unknown;
    readonly contract?: never;
  };

export default function postgres<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptionsWithContractJson<TContract>,
): PostgresClient<TContract>;
export default function postgres<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptionsWithContract<TContract>,
): PostgresClient<TContract>;
```

Notes:

- `url` / `pg` are **sugar**; the structural model is `binding`.
- If multiple binding inputs are provided (`url` + `pg`, etc), the helper throws an error at `postgres(...)` call time (pure validation, still no runtime instantiation).
- `extensions` are runtime extension pack **descriptors** (e.g. `@prisma-next/extension-pgvector/runtime`).

### Examples

#### Emitted-contract workflow

```ts
import postgres from '@prisma-next/postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  url: process.env.DATABASE_URL!,
  extensions: [pgvector],
});

// Static (no runtime init, no DB connect)
db.sql;
db.schema;
db.orm;
db.context;
db.stack;

// Lazy boundary (first call instantiates runtime + driver + pool)
const runtime = db.runtime();
```

#### No-emit workflow (TS-authored contract)

```ts
import postgres from '@prisma-next/postgres/runtime';
import { contract } from './contract';

export const db = postgres({
  contract,
  url: process.env.DATABASE_URL!,
});
```

#### Binding with `pg` objects

```ts
import postgres from '@prisma-next/postgres/runtime';
import { Pool } from 'pg';
import { contract } from './contract';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

export const db = postgres({
  contract,
  pg: pool, // sugar for binding
});
```

## Lazy-init semantics (explicit)

### Import-time semantics

Importing `@prisma-next/postgres/runtime` and the file that calls `postgres(...)` must be **side-effect free** with respect to runtime:

- Allowed at import-time:
  - building the stack **descriptors** via `createSqlExecutionStack({ target, adapter, driver, extensionPacks })`
  - validating/normalizing `contractJson` via `validateContract<TContract>(...)`
  - building the static `ExecutionContext` via `createExecutionContext({ contract, stack })`
  - constructing the query roots `sql({ context })`, `schema(context)`, `orm({ context })`
- Not allowed at import-time:
  - calling `instantiateExecutionStack(...)`
  - creating a `pg` `Pool`/`Client`
  - calling `driverDescriptor.create(...)`
  - calling `createRuntime(...)`

### `db.runtime()` semantics

- **First call**:
  - resolves binding (`binding` \|\| sugar `url`/`pg`)
  - creates `pg` `Pool` only when binding is `url`
  - calls `instantiateExecutionStack(stack)`
  - creates the driver instance via the Postgres driver descriptor
  - calls `createRuntime({ stackInstance, context, driver, plugins, verify })`
  - memoizes and returns the runtime
- **Subsequent calls**:
  - returns the memoized runtime

### Binding model and TML-1837 alignment

Even though `url` is ergonomic, the helper treats it as sugar for an explicit binding model:

- Structural form: `binding: { kind: 'url' | 'pgPool' | 'pgClient', ... }`
- Sugar form:
  - `url: string` → `binding: { kind: 'url', url }`
  - `pg: Pool` → `binding: { kind: 'pgPool', pool }`
  - `pg: Client` → `binding: { kind: 'pgClient', client }`

This keeps the surface compatible with the future direction where driver instantiation and connection binding are further decoupled (TML-1837), without forcing new abstractions into the MVP.

Milestone 0 confirmation (2026-02-10): scope boundaries are explicitly aligned to TML-1837 by modeling binding structurally and retaining `url` only as sugar.

## Implementation sketch (composition of existing primitives)

The helper is a composition layer; it must internally use existing primitives and descriptors:

- **Static (in `postgres(...)`)**:
  - `createSqlExecutionStack` from `@prisma-next/sql-runtime`
  - `createExecutionContext` from `@prisma-next/sql-runtime`
  - Postgres descriptors:
    - `@prisma-next/target-postgres/runtime`
    - `@prisma-next/adapter-postgres/runtime`
    - `@prisma-next/driver-postgres/runtime`
  - query roots:
    - `sql` from `@prisma-next/sql-lane`
    - `schema` from `@prisma-next/sql-relational-core/schema`
    - `orm` from `@prisma-next/sql-orm-lane`
- **Dynamic (in `db.runtime()`)**:
  - `instantiateExecutionStack` from `@prisma-next/core-execution-plane/stack`
  - driver binding via `executionStack.driver.create({ connect: ..., cursor: ... })`
  - `createRuntime` from `@prisma-next/sql-runtime`

Runtime verify defaults (MVP):

- `verify: { mode: 'onFirstUse', requireMarker: false }`

## Contract validation relocation (shared-plane)

### Problem

`validateContract()` currently lives in `@prisma-next/sql-contract-ts/contract` (authoring surface). Runtime helpers (like this Postgres one-liner) should not depend on authoring/migration-plane packages.

### Proposal

Move `validateContract()` to shared-plane SQL contract package:

- **New location**: `packages/2-sql/1-core/contract` (`@prisma-next/sql-contract`)
- **New export path**: `@prisma-next/sql-contract/validate`
  - Export `validateContract<TContract extends SqlContract<SqlStorage>>(value: unknown): TContract`

### Migration plan (breaking; no shims)

- Add new `@prisma-next/sql-contract/validate` export (shared-plane).
- Update all call sites importing `validateContract` from `@prisma-next/sql-contract-ts/contract` to import from `@prisma-next/sql-contract/validate`.
- Remove `validateContract` from `@prisma-next/sql-contract-ts/contract` (or remove the `./contract` export entirely if it becomes empty/unnecessary).

Call sites to update (non-exhaustive examples; implementation should use repo-wide search):

- `examples/prisma-next-demo/src/prisma/context.ts`
- `examples/prisma-orm-demo/src/prisma-next/runtime.ts`
- integration tests and rules docs currently referencing `@prisma-next/sql-contract-ts/contract`

## Packaging

### New package

Create `@prisma-next/postgres` as a composition package whose runtime entrypoint is:

- `@prisma-next/postgres/runtime` → default export `postgres(...)`

### Dependencies (runtime surface)

`@prisma-next/postgres` depends on:

- `@prisma-next/sql-runtime` (stack/context/runtime primitives + plugin types)
- `@prisma-next/core-execution-plane` (stack instantiation)
- `@prisma-next/target-postgres` (target descriptor)
- `@prisma-next/adapter-postgres` (adapter descriptor)
- `@prisma-next/driver-postgres` (driver descriptor)
- `@prisma-next/sql-lane` (sql root)
- `@prisma-next/sql-relational-core` (schema root)
- `@prisma-next/sql-orm-lane` (orm root)
- `@prisma-next/sql-contract` (contract types + `validateContract`)
- `pg` (only to create a `Pool` for `url` binding and to type `Pool`/`Client`)

### Entry points and internal module layout

Proposed structure (exact file names flexible; exports must be curated and side-effect free):

```
packages/3-extensions/postgres/               # new package location
  package.json                                # name: @prisma-next/postgres
  src/
    exports/
      runtime.ts                              # default export postgres
    runtime/
      postgres.ts                             # implementation
      binding.ts                              # PostgresBinding + sugar resolution
      types.ts                                # PostgresOptions/PostgresClient types
  README.md                                   # added when implementing (per doc-maintenance rule)
```

## Demo migration plan (one file, one call)

Target: `examples/prisma-next-demo` config collapses to a single module that exports `db`.

### Proposed changes

- **Add** `examples/prisma-next-demo/src/prisma/db.ts` (or `src/db.ts`) that:
  - imports `postgres` from `@prisma-next/postgres/runtime`
  - imports either `contractJson` (emitted workflow) or `contract` (no-emit workflow)
  - imports `pgvector` descriptor (if still used)
  - calls `postgres(...)` exactly once and exports `db`
- **Update** consumers to import from that file:
  - query modules use `db.sql` / `db.orm` / `db.schema` roots
  - runtime usage calls `db.runtime()` when executing plans
- **Remove** the split `context.ts` + `runtime.ts` modules once no longer referenced.

Acceptance check:

- The demo’s “Prisma Next config” reduces to **one file** that contains **one helper call** to `postgres(...)`.

## Risks / mitigations

- **Layering/cycles**: moving `validateContract()` into `@prisma-next/sql-contract` must not introduce new dependency cycles.
  - Mitigation: keep it self-contained and only depend on existing `@prisma-next/sql-contract/*` exports + `arktype` (already in the package).
- **Driver binding evolution (TML-1837)**: current driver API uses `driverDescriptor.create({ connect: ... })`.
  - Mitigation: isolate binding logic in one internal function so future refactors only touch `binding.ts`.

## Testing plan (MVP)

- **Demo smoke**:
  - `pnpm dev` and CLI entrypoints still work
  - runtime instantiation occurs only after `db.runtime()` is called
- **Minimal automated validation**:
  - Add a small unit test in the new package asserting:
    - `postgres(...)` does not call `instantiateExecutionStack` / `createRuntime` eagerly (can be verified via spies/mocks)
    - `db.runtime()` memoizes (same instance returned on subsequent calls)
