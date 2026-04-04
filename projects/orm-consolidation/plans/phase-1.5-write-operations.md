# Phase 1.5: Mongo Write Operations — Execution Plan

## Summary

Add write operations (`create`, `update`, `delete`, `upsert`) to `MongoCollection`, mirroring the SQL ORM's full mutation surface. Phase 1 delivered a read-only `MongoCollection` with fluent chaining. This phase adds the remaining API surface so both families have symmetric read+write capabilities before Phase 2 extracts the shared `Collection` interface.

**Spec:** [projects/orm-consolidation/spec.md](../spec.md)

**Linear:** [TML-2194](https://linear.app/prisma-company/issue/TML-2194)

## Collaborators

| Role  | Person | Context                                          |
| ----- | ------ | ------------------------------------------------ |
| Maker | Will   | Drives execution                                 |
| FYI   | Alexey | SQL ORM owner — no changes to SQL ORM in Phase 1.5 |

## Key references (implementation)

- SQL `Collection` writes: [`sql-orm-client/src/collection.ts`](../../../packages/3-extensions/sql-orm-client/src/collection.ts) — `create`, `createAll`, `createCount`, `update`, `updateAll`, `updateCount`, `delete`, `deleteAll`, `deleteCount`, `upsert`
- SQL mutation compilation: [`sql-orm-client/src/query-plan-mutations.ts`](../../../packages/3-extensions/sql-orm-client/src/query-plan-mutations.ts)
- Mongo `MongoCollection` (read-only): [`mongo-orm/src/collection.ts`](../../../packages/2-mongo-family/4-orm/src/collection.ts)
- Mongo commands: [`mongo-core/src/commands.ts`](../../../packages/2-mongo-family/1-core/src/commands.ts) — `InsertOneCommand`, `UpdateOneCommand`, `DeleteOneCommand`
- Mongo wire commands: [`mongo-core/src/wire-commands.ts`](../../../packages/2-mongo-family/1-core/src/wire-commands.ts)
- Mongo results: [`mongo-core/src/results.ts`](../../../packages/2-mongo-family/1-core/src/results.ts)
- Mongo adapter: [`mongo-adapter/src/mongo-adapter.ts`](../../../packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts)
- Mongo driver: [`mongo-driver/src/mongo-driver.ts`](../../../packages/3-mongo-target/3-mongo-driver/src/mongo-driver.ts)
- Mongo runtime: [`mongo-runtime/src/mongo-runtime.ts`](../../../packages/2-mongo-family/5-runtime/src/mongo-runtime.ts)
- Mongo executor interface: [`mongo-orm/src/executor.ts`](../../../packages/2-mongo-family/4-orm/src/executor.ts)
- [ADR 180 — Dot-path field accessor](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)
- [ADR 183 — Pipeline-only for reads](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)

## Architecture

### Write command flow

```
MongoCollection.create(data)
        │
        ▼
  Map model field names → storage field names
  Attach codec metadata for encoding
        │
        ▼
  Build InsertOneCommand / InsertManyCommand
        │
        ▼
  MongoQueryExecutor.executeCommand(command, meta)
        │
        ▼
  MongoRuntime.executeCommand(command, meta)
        │
        ▼
  MongoAdapter.lowerCommand(command, context)
    ├── resolveDocument(): encode values for driver
    └── Build wire command (InsertOneWireCommand, etc.)
        │
        ▼
  MongoDriver.execute(wireCommand)
    └── collection.insertOne() / collection.findOneAndUpdate() / etc.
        │
        ▼
  Result: Row (constructed from input + insertedId, or returned document)
```

### Reads vs writes — different primitives

Per [ADR 183](../../../docs/architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md), all MongoDB **reads** use the aggregation pipeline exclusively. **Writes** use MongoDB's native write commands (`insertOne`, `updateOne`, `deleteOne`, etc.) — this is unchanged by ADR 183. Write operations flow through `MongoRuntime.executeCommand()`, not `MongoRuntime.execute()` (which is the read path).

### Returning documents from writes

SQL uses `RETURNING` clauses on `INSERT/UPDATE/DELETE` statements to atomically return affected rows in a single statement. MongoDB has no equivalent for bulk operations. The strategy varies by operation:

| ORM method | MongoDB primitive | How the document is returned |
|------------|-------------------|------------------------------|
| `create(data)` | `insertOne` | Constructed from input + `insertedId` |
| `createAll(data[])` | `insertMany` | Constructed from input + `insertedIds` |
| `createCount(data[])` | `insertMany` | Return `insertedCount` from result |
| `update(data)` | `findOneAndUpdate` | Returned atomically by the driver (`returnDocument: 'after'`) |
| `updateAll(data)` | `updateMany` + aggregate re-read | Re-read with same filter after write |
| `updateCount(data)` | `updateMany` | Return `modifiedCount` from result |
| `delete()` | `findOneAndDelete` | Returned atomically by the driver |
| `deleteAll()` | Aggregate read + `deleteMany` | Read matching docs first, then delete |
| `deleteCount()` | `deleteMany` | Return `deletedCount` from result |
| `upsert(input)` | `findOneAndUpdate` w/ `upsert: true` | Returned atomically by the driver |

**Consistency note:** The bulk document-returning operations (`updateAll`, `deleteAll`) use a two-step approach (write + read, or read + write). There is a narrow race window between the two operations — documents could be modified by concurrent operations between the steps. This is analogous to read-committed isolation behavior in SQL databases. For use cases requiring stronger consistency, MongoDB transactions can wrap the two operations.

### No `returning` capability gate

The SQL ORM gates row-returning write methods behind a `"returning"` contract capability because some SQL dialects (e.g. MySQL) lack `RETURNING` clause support. MongoDB universally supports the primitives we need (`findOneAndUpdate`, `findOneAndDelete`, construct-from-input for creates), so there is no analogous constraint. Adding a `returning` capability gate to the Mongo ORM would create dead conditional code — a check that never fails.

The Mongo `MongoCollection` write methods unconditionally return rows. Phase 2 may add a shared capability gate as part of the shared `Collection` interface extraction, where the Mongo target always provides the capability.

### No `hasWhere` type-level state (Phase 1.5 scope)

The SQL ORM tracks `State['hasWhere']` as a type-level flag on `Collection` to prevent calling `update()`/`delete()` without a `.where()` call. This requires a generic state parameter on the Collection class.

For Phase 1.5, `MongoCollection` enforces the `.where()` requirement at **runtime** (throw if `state.filters` is empty). Adding type-level state tracking is deferred to Phase 2, when the shared `Collection` interface introduces the state generic parameter.

## Target API surface

The following methods mirror the SQL `Collection` API:

```typescript
class MongoCollection<TContract, ModelName, TIncludes> {
  // --- Reads (Phase 1, already implemented) ---
  where(filter: MongoFilterExpr): MongoCollection<...>;
  select(...fields: ModelFieldKeys<...>[]): MongoCollection<...>;
  include<K>(relationName: K): MongoCollection<...>;
  orderBy(spec: ...): MongoCollection<...>;
  take(n: number): MongoCollection<...>;
  skip(n: number): MongoCollection<...>;
  all(): AsyncIterableResult<Row>;
  first(): Promise<Row | null>;

  // --- Creates (Phase 1.5) ---
  create(data: CreateInput<TContract, ModelName>): Promise<Row>;
  createAll(data: readonly CreateInput<TContract, ModelName>[]): AsyncIterableResult<Row>;
  createCount(data: readonly CreateInput<TContract, ModelName>[]): Promise<number>;

  // --- Updates (Phase 1.5, require .where()) ---
  update(data: Partial<DefaultModelRow<TContract, ModelName>>): Promise<Row | null>;
  updateAll(data: Partial<DefaultModelRow<TContract, ModelName>>): AsyncIterableResult<Row>;
  updateCount(data: Partial<DefaultModelRow<TContract, ModelName>>): Promise<number>;

  // --- Deletes (Phase 1.5, require .where()) ---
  delete(): Promise<Row | null>;
  deleteAll(): AsyncIterableResult<Row>;
  deleteCount(): Promise<number>;

  // --- Upsert (Phase 1.5) ---
  upsert(input: {
    create: CreateInput<TContract, ModelName>;
    update: Partial<DefaultModelRow<TContract, ModelName>>;
  }): Promise<Row>;
}
```

### Type utilities needed

- `DefaultModelRow<TContract, ModelName>` — a row type mapping each model field name to its JS output type (via codec). Already exists as `InferModelRow` in `mongo-core` / `InferRootRow` in `mongo-orm/types.ts`.
- `CreateInput<TContract, ModelName>` — required fields + optional fields with defaults. Needs to be defined for Mongo.

## New command types

### `mongo-core` commands

Add batch and document-returning commands alongside existing `*One` commands:

```typescript
// Batch insert
export class InsertManyCommand extends MongoCommand {
  readonly kind = 'insertMany' as const;
  readonly documents: ReadonlyArray<Record<string, MongoValue>>;

  constructor(collection: string, documents: ReadonlyArray<Record<string, MongoValue>>) { ... }
}

// Batch update
export class UpdateManyCommand extends MongoCommand {
  readonly kind = 'updateMany' as const;
  readonly filter: MongoExpr;
  readonly update: MongoUpdateDocument;

  constructor(collection: string, filter: MongoExpr, update: MongoUpdateDocument) { ... }
}

// Batch delete
export class DeleteManyCommand extends MongoCommand {
  readonly kind = 'deleteMany' as const;
  readonly filter: MongoExpr;

  constructor(collection: string, filter: MongoExpr) { ... }
}

// Atomic update + return document
export class FindOneAndUpdateCommand extends MongoCommand {
  readonly kind = 'findOneAndUpdate' as const;
  readonly filter: MongoExpr;
  readonly update: MongoUpdateDocument;
  readonly upsert: boolean;

  constructor(collection: string, filter: MongoExpr, update: MongoUpdateDocument, upsert: boolean) { ... }
}

// Atomic delete + return document
export class FindOneAndDeleteCommand extends MongoCommand {
  readonly kind = 'findOneAndDelete' as const;
  readonly filter: MongoExpr;

  constructor(collection: string, filter: MongoExpr) { ... }
}
```

### `mongo-core` wire commands

Mirror wire commands for each new command kind: `InsertManyWireCommand`, `UpdateManyWireCommand`, `DeleteManyWireCommand`, `FindOneAndUpdateWireCommand`, `FindOneAndDeleteWireCommand`.

### `mongo-core` result types

```typescript
export interface InsertManyResult {
  readonly insertedIds: ReadonlyArray<unknown>;
  readonly insertedCount: number;
}

export interface UpdateManyResult {
  readonly matchedCount: number;
  readonly modifiedCount: number;
}

export interface DeleteManyResult {
  readonly deletedCount: number;
}

// findOneAndUpdate / findOneAndDelete return the document directly —
// no special result type needed, the driver yields the document as a row.
```

### Adapter lowering

Extend `MongoAdapter.lowerCommand()` to handle the new command kinds. Each new command lowers to its wire command by resolving `MongoValue` / `MongoExpr` fields via `resolveDocument()` / `resolveValue()`.

### Driver execution

Extend `MongoDriver.execute()` to handle the new wire command kinds:

| Wire command | MongoDB driver call | Yields |
|---|---|---|
| `InsertManyWireCommand` | `collection.insertMany(documents)` | `InsertManyResult` |
| `UpdateManyWireCommand` | `collection.updateMany(filter, update)` | `UpdateManyResult` |
| `DeleteManyWireCommand` | `collection.deleteMany(filter)` | `DeleteManyResult` |
| `FindOneAndUpdateWireCommand` | `collection.findOneAndUpdate(filter, update, { returnDocument: 'after' })` | The document (or nothing if no match and not upsert) |
| `FindOneAndDeleteWireCommand` | `collection.findOneAndDelete(filter)` | The document (or nothing if no match) |

### Executor interface

The current `MongoQueryExecutor` only supports reads:

```typescript
export interface MongoQueryExecutor {
  execute<Row>(plan: MongoReadPlan<Row>): AsyncIterableResult<Row>;
}
```

Extend with a write command path:

```typescript
export interface MongoQueryExecutor {
  execute<Row>(plan: MongoReadPlan<Row>): AsyncIterableResult<Row>;
  executeCommand<Row>(command: AnyMongoCommand, meta: PlanMeta): AsyncIterableResult<Row>;
}
```

This mirrors the `MongoRuntime` interface, which already has both `execute()` and `executeCommand()`.

## Compilation: Collection → Command

### `create(data)` / `createAll(data[])`

1. Map model field names to storage field names using contract metadata.
2. Build `InsertOneCommand(collectionName, document)` for singular, or `InsertManyCommand(collectionName, documents)` for batch.
3. Execute via `executor.executeCommand()`.
4. Construct return row from input data + `insertedId` / `insertedIds` from the result.

For construct-from-input: the ORM knows the complete data that was inserted (the user provided it). The only unknown is the generated `_id`, which comes back from `insertedId`. The ORM merges the input with `{ _id: insertedId }` to produce the return row.

### `update(data)` / `updateAll(data)`

1. **Runtime guard:** Throw if `state.filters` is empty.
2. Compile `state.filters` to a `MongoExpr` filter (reuse filter compilation from the read path).
3. Map update payload fields to storage field names.
4. Wrap in `$set`: `{ $set: { ...mappedData } }` as the `MongoUpdateDocument`.
5. For singular (`update`): Build `FindOneAndUpdateCommand(collection, filter, update, false)`. The driver returns the updated document directly.
6. For batch (`updateAll`): Build `UpdateManyCommand(collection, filter, update)`. After execution, issue a follow-up read (aggregate pipeline with the same filter) to return the updated documents.

### `delete()` / `deleteAll()`

1. **Runtime guard:** Throw if `state.filters` is empty.
2. Compile `state.filters` to a `MongoExpr` filter.
3. For singular (`delete`): Build `FindOneAndDeleteCommand(collection, filter)`. The driver returns the deleted document directly.
4. For batch (`deleteAll`): Issue an aggregate read first (to capture matching documents), then build `DeleteManyCommand(collection, filter)`. Return the pre-read documents.

### `upsert(input)`

1. Compile `state.filters` to a filter (if any `.where()` was chained), or use the create data's identity fields.
2. Map create and update payloads to storage field names.
3. Build `FindOneAndUpdateCommand(collection, filter, { $set: updateData, $setOnInsert: createOnlyData }, true)`.
4. The driver returns the document (either existing-updated or newly-inserted).

### `*Count` variants

These are simpler — execute the write command and return the count from the result, without returning documents:

- `createCount`: `InsertManyCommand` → return `insertedCount`
- `updateCount`: `UpdateManyCommand` → return `modifiedCount`
- `deleteCount`: `DeleteManyCommand` → return `deletedCount`

### Filter compilation for writes

The read path already compiles `state.filters` into `MongoMatchStage` (via `MongoAndExpr` when multiple). Write operations need the filter in a different form — as a plain `MongoExpr` (a `Record<string, MongoValue>` used by `UpdateOneCommand.filter`, `DeleteOneCommand.filter`), not wrapped in a pipeline stage.

The compilation should extract a shared `compileFilter(state.filters)` → `MongoFilterExpr` function, then:
- Reads: wrap in `MongoMatchStage`
- Writes: lower the `MongoFilterExpr` to `MongoExpr` for the command

This may require a thin `lowerFilterToExpr(filter: MongoFilterExpr)` utility that produces the `Record<string, MongoValue>` form expected by the command types. This is similar to what the adapter's `lowerCommand` does via `resolveDocument()`, but at the ORM compilation level.

## Milestones

### Milestone 1: Command types + driver + adapter

Add the new command types, wire commands, result types, adapter lowering, and driver execution methods. No ORM changes yet — just the infrastructure.

**Tasks:**

#### 1.1 New command classes in `mongo-core`

Add `InsertManyCommand`, `UpdateManyCommand`, `DeleteManyCommand`, `FindOneAndUpdateCommand`, `FindOneAndDeleteCommand`. Update `AnyMongoCommand` union.

#### 1.2 New wire command classes in `mongo-core`

Add `InsertManyWireCommand`, `UpdateManyWireCommand`, `DeleteManyWireCommand`, `FindOneAndUpdateWireCommand`, `FindOneAndDeleteWireCommand`. Update `AnyMongoWireCommand` union.

#### 1.3 New result types in `mongo-core`

Add `InsertManyResult`, `UpdateManyResult`, `DeleteManyResult`.

#### 1.4 Adapter lowering

Extend `MongoAdapterImpl.lowerCommand()` to handle the five new command kinds. Each translates to its wire command using `resolveDocument()` / `resolveValue()`.

#### 1.5 Driver execution

Extend `MongoDriverImpl.execute()` to handle the five new wire command kinds. Map each to the corresponding `mongodb` driver method.

#### 1.6 Tests

- Each new command class constructs and freezes correctly
- Each new wire command class constructs and freezes correctly
- Adapter lowers each new command to the correct wire command
- Driver executes each new wire command against `mongodb-memory-server`
- `findOneAndUpdate` returns the updated document
- `findOneAndDelete` returns the deleted document
- `insertMany` returns inserted IDs and count
- `updateMany` returns matched/modified counts
- `deleteMany` returns deleted count

### Milestone 2: ORM write methods on `MongoCollection`

Add `create`, `createAll`, `createCount`, `update`, `updateAll`, `updateCount`, `delete`, `deleteAll`, `deleteCount`, `upsert` to `MongoCollection`.

**Tasks:**

#### 2.1 Extend executor interface

Add `executeCommand<Row>(command: AnyMongoCommand, meta: PlanMeta): AsyncIterableResult<Row>` to `MongoQueryExecutor`.

#### 2.2 Type utilities

Define `CreateInput<TContract, ModelName>` and any supporting types for Mongo write inputs. Reuse `InferModelRow` / `InferRootRow` for the `Partial<...>` update input type.

#### 2.3 Model-to-storage field mapping

Implement (or reuse) `mapModelFieldsToStorageFields()` — maps model field names to their storage names using contract metadata. The SQL ORM has `mapModelDataToStorageRow` for this.

#### 2.4 Create methods

Implement `create(data)`, `createAll(data[])`, `createCount(data[])` on `MongoCollection`:

- Map model fields to storage fields
- Build `InsertOneCommand` / `InsertManyCommand`
- Execute via `executor.executeCommand()`
- Construct return rows from input + `insertedId(s)`

#### 2.5 Update methods

Implement `update(data)`, `updateAll(data)`, `updateCount(data)` on `MongoCollection`:

- Runtime guard: throw if no filters
- Compile filters to `MongoExpr`
- Map update data to storage fields, wrap in `$set`
- `update()`: `FindOneAndUpdateCommand` → return document
- `updateAll()`: `UpdateManyCommand` → re-read via aggregate
- `updateCount()`: `UpdateManyCommand` → return `modifiedCount`

#### 2.6 Delete methods

Implement `delete()`, `deleteAll()`, `deleteCount()` on `MongoCollection`:

- Runtime guard: throw if no filters
- Compile filters to `MongoExpr`
- `delete()`: `FindOneAndDeleteCommand` → return document
- `deleteAll()`: aggregate read → `DeleteManyCommand` → return pre-read docs
- `deleteCount()`: `DeleteManyCommand` → return `deletedCount`

#### 2.7 Upsert

Implement `upsert(input)` on `MongoCollection`:

- Build filter from input or chained `.where()`
- Build `FindOneAndUpdateCommand` with `upsert: true`
- Return document

#### 2.8 Tests

- `create()` returns the created row with `_id`
- `createAll()` returns all created rows with `_id`s
- `createCount()` returns the count
- `update()` with `.where()` returns updated row
- `update()` without `.where()` throws
- `updateAll()` returns all updated rows
- `updateCount()` returns count
- `delete()` with `.where()` returns deleted row
- `delete()` without `.where()` throws
- `deleteAll()` returns all deleted rows
- `deleteCount()` returns count
- `upsert()` creates when no match, updates when match exists
- Immutability: write methods don't mutate collection state

### Milestone 3: Demo + integration tests

Replace raw `MongoClient` seeding in the demo with ORM write calls. Full CRUD lifecycle integration tests.

**Tasks:**

#### 3.1 Update demo seeding

Replace `MongoClient`-based seeding in `examples/mongo-demo/` with ORM `create()` / `createAll()` calls.

#### 3.2 Integration tests — CRUD lifecycle

Full create → read → update → read → delete → read lifecycle against `mongodb-memory-server`:

- Create users via `db.users.create()`
- Read back via `db.users.all()` and verify
- Update via `db.users.where(...).update()`
- Read back and verify changes
- Delete via `db.users.where(...).delete()`
- Read back and verify deletion
- Batch create via `db.users.createAll()`
- Batch update via `db.users.where(...).updateAll()`
- Batch delete via `db.users.where(...).deleteAll()`
- Upsert: insert case and update case

#### 3.3 Verify existing tests

Ensure all existing Mongo tests pass with the new code.

## Test coverage

| Acceptance criterion | Test type | Milestone | Notes |
|---|---|---|---|
| New command classes construct and freeze | Unit | 1.6 | InsertMany, UpdateMany, DeleteMany, FindOneAndUpdate, FindOneAndDelete |
| Adapter lowers each new command kind | Unit | 1.6 | Wire command output verification |
| Driver executes each new wire command | Integration | 1.6 | Against mongodb-memory-server |
| `findOneAndUpdate` returns updated document | Integration | 1.6 | returnDocument: 'after' |
| `findOneAndDelete` returns deleted document | Integration | 1.6 | Pre-deletion document |
| `insertMany` returns IDs and count | Integration | 1.6 | Correct insertedIds array |
| `create()` returns row with _id | Unit + Integration | 2.8 | Constructed from input + insertedId |
| `createAll()` returns all rows | Unit + Integration | 2.8 | Multiple documents |
| `createCount()` returns count | Unit + Integration | 2.8 | Number only |
| `update()` requires `.where()` | Unit | 2.8 | Runtime throw |
| `update()` returns updated row | Unit + Integration | 2.8 | Via findOneAndUpdate |
| `updateAll()` returns all updated rows | Integration | 2.8 | Via updateMany + re-read |
| `updateCount()` returns count | Unit + Integration | 2.8 | Number only |
| `delete()` requires `.where()` | Unit | 2.8 | Runtime throw |
| `delete()` returns deleted row | Unit + Integration | 2.8 | Via findOneAndDelete |
| `deleteAll()` returns all deleted rows | Integration | 2.8 | Via pre-read + deleteMany |
| `deleteCount()` returns count | Unit + Integration | 2.8 | Number only |
| `upsert()` creates when no match | Integration | 2.8 | With upsert: true |
| `upsert()` updates when match exists | Integration | 2.8 | With upsert: true |
| Write methods don't mutate collection state | Unit | 2.8 | Immutability |
| CRUD lifecycle end-to-end | Integration | 3.2 | Create → read → update → delete |
| Demo seeds via ORM writes | Integration | 3.1 | No raw MongoClient in demo seeding |

## Follow-ups

### Dot-path field accessor mutations ([ADR 180](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md))

Phase 1.5 implements basic `$set`-based updates. [ADR 180](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md) defines a richer mutation API where field accessors support targeted operations:

```typescript
db.users.where({ id }).update(u => [
  u("homeAddress.city").set("LA"),
  u("stats.loginCount").inc(1),
  u("tags").push("premium"),
])
```

This maps to MongoDB's native update operators (`$set` with dot-notation, `$inc`, `$push`, etc.) and is a natural fit for the Mongo adapter. Implementation depends on value objects landing in the contract ([ADR 178](../../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)). The basic `$set` update from Phase 1.5 is the foundation; dot-path accessor mutations extend it.

### Nested create/update with relations

The SQL ORM supports nested mutations: `create({ data, relations: { posts: { create: [...] } } })`. This requires relation-aware mutation compilation and is deferred. Phase 1.5 covers flat (non-relational) creates and updates only.

### Type-level `hasWhere` state

Move the `.where()` requirement for `update`/`delete` from a runtime check to a compile-time type constraint via a state generic parameter. Deferred to Phase 2 when the shared `Collection` interface introduces the state pattern.

## Open items

1. **`CreateInput` type definition.** The SQL ORM distinguishes required vs optional create fields (fields with defaults are optional). How the Mongo contract expresses field defaults/optionality determines the `CreateInput` shape.

2. **`_id` generation.** MongoDB auto-generates `_id` if not provided. Should `CreateInput` include `_id` as optional? The SQL ORM includes PK fields in `CreateInput` for user-provided IDs but also supports auto-generated sequences.

3. **Filter lowering for writes.** The read path wraps filters in `MongoMatchStage` (pipeline stages). The write path needs filters as `MongoExpr` (`Record<string, MongoValue>`). Determine whether to add a `lowerFilterToExpr()` utility in the query AST package, or handle this in the ORM compilation layer.
