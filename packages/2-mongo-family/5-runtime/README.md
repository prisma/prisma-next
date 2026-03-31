# @prisma-next/mongo-runtime

MongoDB runtime executor for Prisma Next.

## Responsibilities

- **Runtime executor**: `createMongoRuntime()` composes adapter and driver into a `MongoRuntime` that executes query plans
- **Command lowering**: Translates ORM query plans into MongoDB commands (`FindCommand`, `AggregateCommand`)
- **`$lookup` pipeline**: Builds aggregation pipelines for reference-relation includes
- **Lifecycle management**: Connection lifecycle via `close()`

## Dependencies

- **Depends on**:
  - `@prisma-next/mongo-core` (contract types, query plan types, lowering context)
  - `@prisma-next/runtime-executor` (`AsyncIterableResult` return type)
- **Depended on by**:
  - Integration tests (`test/integration/test/mongo/`)
