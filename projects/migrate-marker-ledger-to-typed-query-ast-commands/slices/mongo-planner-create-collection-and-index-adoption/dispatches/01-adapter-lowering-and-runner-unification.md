# D1: Adapter lowering and runner unification

## What landed

- Five DDL command kinds (`createCollection`, `createIndex`, `dropCollection`, `dropIndex`, `collMod`) lowered in `MongoAdapterImpl.lower` to typed wire-command union members (`CreateCollectionWireCommand`, `CreateIndexWireCommand`, `DropCollectionWireCommand`, `DropIndexWireCommand`, `CollModWireCommand`) defined in `@prisma-next/mongo-wire`.
- `MongoDriverImpl.execute` extended to dispatch all five DDL kinds alongside existing DML kinds. Each DDL branch awaits the corresponding `execute*Command` method (eager `async`, not a generator) wrapped via `voidToAsyncIterable` + `castAs` to fit the `AsyncIterable<Row>` return type.
- `MongoCommandExecutor` and its test file deleted. `MongoRunner` now calls `adapter.lower` → `driver.execute` for DDL steps, the same path used for DML. `InspectionExecutor` retained for the `listCollections`/`listIndexes` introspection path.
- DDL lowering oracle test added (`packages/3-mongo-target/2-mongo-adapter/test/ddl-lowering-oracle.test.ts`): 29 cases covering all five kinds.
- Behavioral DDL test added (`packages/3-mongo-target/2-mongo-adapter/test/command-executor.test.ts`): exercises lower→driver.execute against mongodb-memory-server, covering creation, inspection, and drop for all five kinds.

## Typed wire-command idiom

DDL lowers to typed wire-command structs, not raw `Document` values. The struct carries `kind`, `collection`, and command-specific options as typed fields. The driver dispatches on `kind` in the same switch that handles DML. This keeps the adapter/driver boundary uniform: the adapter owns lowering, the driver owns transport, and the wire union is the contract between them.

## Open question 2 — response iteration and error fidelity

The spec left open whether MongoDB DDL errors surface correctly through the `driver.execute` async-iterable path. The behavioral test at `test/command-executor.test.ts` line 326 (`describe('error fidelity — server errors surface through driver.execute')`) answers this: `dropIndex` on a non-existent index and `collMod` on a missing collection both reject as expected. The `voidToAsyncIterable` wrapper (`[Symbol.asyncIterator].next` returns the awaited promise) preserves rejection so errors propagate to the caller. Response iteration is empty (DDL produces no rows), which the runner handles by consuming without yielding.

## Open question 3 — explicit index `name` on the wire

The spec asked whether `createIndex` sends an explicit `name` field. It does: `MongoAdapterImpl.lower` sets `options['name'] = command.name` when `command.name` is defined (`packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts` line 84). The DDL lowering oracle confirms this: `createIndex` cases that supply a name produce an options object with `name` set; cases that omit it produce an options object without `name`.
