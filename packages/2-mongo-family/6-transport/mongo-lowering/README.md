# @prisma-next/mongo-lowering

Adapter and driver interface contracts for the MongoDB transport layer.

## Responsibilities

- **Adapter interface**: `MongoAdapter` — defines `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>`, the contract for converting a typed query plan into a wire command. Async at the boundary: callers must `await lower(...)` so adapters may run async codec encodes (e.g. `resolveValue`) before producing the wire shape.
- **Driver interface**: `MongoDriver` — defines `execute<Row>(wireCommand): AsyncIterable<Row>` and `close()`, the contract for sending wire commands to a MongoDB instance

## Dependencies

- **Depends on**:
  - `@prisma-next/mongo-query-ast` (`MongoQueryPlan` — the typed plan shape accepted by the adapter)
  - `@prisma-next/mongo-wire` (`AnyMongoWireCommand` — the wire command shape produced by the adapter and consumed by the driver)
- **Depended on by**:
  - `@prisma-next/mongo-runtime` (composes adapter + driver into a runtime)
  - `@prisma-next/adapter-mongo` (implements `MongoAdapter`)
