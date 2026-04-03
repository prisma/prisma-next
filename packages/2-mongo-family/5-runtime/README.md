# @prisma-next/mongo-runtime

MongoDB runtime executor for Prisma Next.

## Responsibilities

- **Runtime executor**: `createMongoRuntime()` composes adapter and driver into a `MongoRuntime` that executes read plans and write commands
- **Read plan lowering**: Converts `MongoReadPlan` (typed AST stages) into `AggregateWireCommand` via `lowerPipeline`
- **Write command dispatch**: Delegates write command param resolution to the adapter, then executes via driver
- **Lifecycle management**: Connection lifecycle via `close()`

## Dependencies

- **Depends on**:
  - `@prisma-next/mongo-core` (contract types, command types, wire commands, lowering context)
  - `@prisma-next/mongo-query-ast` (`MongoReadPlan`, `lowerPipeline`)
  - `@prisma-next/runtime-executor` (`AsyncIterableResult` return type)
- **Depended on by**:
  - Integration tests (`test/integration/test/mongo/`)
