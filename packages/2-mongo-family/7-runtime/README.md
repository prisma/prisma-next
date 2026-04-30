# @prisma-next/mongo-runtime

MongoDB runtime executor for Prisma Next.

## Package Classification

- **Domain**: mongo
- **Layer**: runtime
- **Plane**: runtime

## Overview

The Mongo runtime package implements the Mongo family runtime by extending the abstract `RuntimeCore` base class from `@prisma-next/framework-components/runtime` with Mongo-specific lowering and driver dispatch. It provides the public runtime API for MongoDB, layering Mongo concerns (adapter lowering and wire-command dispatch) on top of the shared middleware lifecycle.

## Usage

Construct the runtime with a **`MongoCodecRegistry`** shared with the adapter so encode and decode resolve the same codecs. Use `createDefaultMongoCodecRegistry()` from `@prisma-next/adapter-mongo` when you want the built-in Mongo codecs, or build a registry with `createMongoCodecRegistry()` and register codecs explicitly.

Typed reads that attach a **`resultShape`** on the query plan are decoded after the driver yields each row: scalars and scalar arrays run through their `codecId` entries; `kind: 'unknown'` subtrees are passed through unchanged; plans without `resultShape` (for example raw commands) leave rows as the driver returned them.

Example:

```ts
import { createDefaultMongoCodecRegistry, createMongoAdapter } from '@prisma-next/adapter-mongo';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import { createMongoRuntime } from '@prisma-next/mongo-runtime';

const codecs = createDefaultMongoCodecRegistry();
const runtime = createMongoRuntime({
  adapter: createMongoAdapter(codecs),
  driver: await createMongoDriver(url, dbName),
  codecs,
  contract,
  targetId: 'mongo',
});
```

## Responsibilities

- **Runtime executor**: `createMongoRuntime()` composes adapter, driver, and **codec registry** into a `MongoRuntime` with a single `execute(plan)` entry point accepting `MongoQueryPlan<Row>` from `@prisma-next/mongo-query-ast`. Execution lowers the plan through the adapter, runs the wire command on the driver, then **optionally decodes** each row when `plan.resultShape` is present.
- **Unified flow**: There is no separate `execute` vs `executeCommand`; all operations use `execute(plan)`.
- **Lowering**: Happens in the adapter (`lower(plan)`), wrapped by the runtime's `lower` override into a `MongoExecutionPlan`.
- **Middleware lifecycle inheritance**: `MongoRuntime` extends `RuntimeCore<MongoQueryPlan, MongoExecutionPlan, MongoMiddleware>` and inherits the `beforeExecute` / `onRow` / `afterExecute` lifecycle from the framework via `runWithMiddleware`. Mongo does **not** override `runBeforeCompile` (Mongo middleware has no `beforeCompile` hook today).
- **Lifecycle management**: Connection lifecycle via `close()`.

## Dependencies

- **Depends on**:
  - `@prisma-next/mongo-codec` (`MongoCodecRegistry` for decode)
  - `@prisma-next/mongo-lowering` (`MongoAdapter`, `MongoDriver` interfaces)
  - `@prisma-next/mongo-query-ast` (`MongoQueryPlan`, `AnyMongoCommand` — the typed plan shape)
  - `@prisma-next/framework-components` (`RuntimeCore` base class, `runWithMiddleware` helper, `RuntimeMiddleware` SPI, `AsyncIterableResult` return type)
- **Depended on by**:
  - Integration tests (`test/integration/test/mongo/` and `test/integration/test/cross-package/cross-family-middleware.test.ts`)

## Architecture

`MongoRuntimeImpl` extends `RuntimeCore<MongoQueryPlan, MongoExecutionPlan, MongoMiddleware>` and overrides:

- `lower(plan)` — calls the adapter's `lower(plan)` and wraps the resulting wire command into a `MongoExecutionPlan`.
- `runDriver(exec)` — dispatches the wire command to the Mongo driver via `driver.execute(exec.command)`.
- `close()` — closes the underlying driver.

`MongoRuntimeImpl` extends `RuntimeCore` but **overrides `execute`** so that after `runWithMiddleware` yields a raw driver row, the runtime can **`decodeMongoRow`** when the lowered plan carries `resultShape`, then yield the decoded row. `lower(plan)` copies `resultShape` from the query plan onto `MongoExecutionPlan`. Middleware `onRow` still sees the raw driver row (decode happens after the middleware loop for that row, before the consumer receives the value).

The execution template is: `lower` → `runWithMiddleware` (driver loop + middleware) → **per-row decode when `exec.resultShape` is set** → yield to consumer.

```mermaid
flowchart LR
  Plan[MongoQueryPlan] --> Runtime[MongoRuntime]
  Runtime -.extends.-> Core[RuntimeCore]
  Runtime --> Adapter[MongoAdapter.lower]
  Adapter --> Exec[MongoExecutionPlan]
  Runtime --> Driver[MongoDriver.execute]
```

## Related Subsystems

- **[Runtime & Middleware Framework](../../../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md)** — Runtime execution pipeline
- **[Adapters & Targets](../../../../docs/architecture%20docs/subsystems/5.%20Adapters%20&%20Targets.md)** — Adapter and driver responsibilities
