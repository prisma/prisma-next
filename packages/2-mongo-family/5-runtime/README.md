# @prisma-next/mongo-runtime

MongoDB runtime executor for Prisma Next.

## Responsibilities

- **Runtime executor**: `createMongoRuntime()` composes adapter and driver into a `MongoRuntime` with a single `execute(plan)` entry point. Plans satisfy `MongoQueryPlanLike` (typically `MongoQueryPlan<Row>` from `@prisma-next/mongo-query-ast`). Execution is one path for reads and writes: `adapter.lower(plan)` produces a wire command, then the driver runs it.
- **Unified flow**: There is no separate `execute` vs `executeCommand`; all operations use `execute(plan)`.
- **Lowering**: Happens in the adapter (`lower(plan)`), not inside the runtime.
- **Lifecycle management**: Connection lifecycle via `close()`

## Dependencies

- **Depends on**:
  - `@prisma-next/mongo-core` (contract types, `MongoAdapter`, `MongoQueryPlanLike`, wire command types)
  - `@prisma-next/mongo-query-ast` (`MongoQueryPlan`, `AnyMongoCommand` — the typed plan shape)
  - `@prisma-next/runtime-executor` (`AsyncIterableResult` return type)
- **Depended on by**:
  - Integration tests (`test/integration/test/mongo/`)
