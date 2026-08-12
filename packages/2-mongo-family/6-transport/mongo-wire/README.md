# @prisma-next/mongo-wire

Wire-level command and result types for MongoDB operations.

## Responsibilities

- **Wire commands**: Typed, frozen command classes for all MongoDB write and aggregation operations — `InsertOneWireCommand`, `InsertManyWireCommand`, `UpdateOneWireCommand`, `UpdateManyWireCommand`, `DeleteOneWireCommand`, `DeleteManyWireCommand`, `FindOneAndUpdateWireCommand`, `FindOneAndDeleteWireCommand`, `AggregateWireCommand`
- **Command union**: `AnyMongoWireCommand` discriminated union (discriminant: `kind`) for dispatch in drivers
- **Result types**: `InsertOneResult`, `InsertManyResult`, `UpdateOneResult`, `UpdateManyResult`, `DeleteOneResult`, `DeleteManyResult` — the shapes returned by drivers after command execution

## Dependencies

- **Depends on**:
  - `@prisma-next/mongo-value` (`Document`, `RawPipeline` for command payloads)
- **Depended on by**:
  - `@prisma-next/mongo-lowering` (adapter and driver interfaces reference wire commands)
  - `@prisma-next/adapter-mongo` (produces wire commands from query plans)
