# @prisma-next/mongo-runtime

MongoDB runtime executor for Prisma Next.

## Responsibilities

- **Runtime executor**: `createMongoRuntime()` composes adapter and driver into a `MongoRuntime` with a single `execute(plan)` entry point accepting `MongoQueryPlan<Row>` from `@prisma-next/mongo-query-ast`. Execution is one path for reads and writes: `adapter.lower(plan)` produces a wire command, then the driver runs it.
- **Unified flow**: There is no separate `execute` vs `executeCommand`; all operations use `execute(plan)`.
- **Lowering**: Happens in the adapter (`lower(plan)`), not inside the runtime.
- **Lifecycle management**: Connection lifecycle via `close()`

## Dependencies

- **Depends on**:
  - `@prisma-next/mongo-lowering` (`MongoAdapter`, `MongoDriver` interfaces)
  - `@prisma-next/mongo-query-ast` (`MongoQueryPlan`, `AnyMongoCommand` — the typed plan shape)
  - `@prisma-next/framework-components` (`AsyncIterableResult` return type, `RuntimeMiddleware` SPI)
- **Depended on by**:
  - Integration tests (`test/integration/test/mongo/`)
