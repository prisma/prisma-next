# Raw MongoDB Commands — Task Plan

**Milestone:** 1 (Raw pipeline API)
**Linear:** [TML-2208](https://linear.app/prisma-company/issue/TML-2208)
**Parent spec:** [projects/mongo-pipeline-builder/spec.md](../spec.md)
**Parent plan:** [projects/mongo-pipeline-builder/plan.md](../plan.md)

## Intent

Ship a raw MongoDB command lane — the Mongo equivalent of SQL's raw query lane. Users get a `mongoRaw()` entry point that returns a collection-scoped builder mirroring the native MongoDB driver's API (`aggregate`, `updateMany`, `deleteMany`, etc.). Each method produces a `MongoQueryPlan` that executes through the standard runtime pipeline, keeping instrumentation, plugins, and observability intact.

This is the immediate escape hatch: users can run any MongoDB command before the typed pipeline builder exists, using the same API they already know from the native driver.

## Context: the SQL precedent

In the SQL domain, the raw lane is a template literal (`raw\`SELECT ...\``) that produces an `ExecutionPlan` with `lane: 'raw'` and no AST. The user passes the plan to the runtime for execution. The raw lane is a peer of the ORM and SQL builder — a separate entry point, not bolted onto the ORM client.

For MongoDB, there is no string wire format to template. Instead, the native MongoDB driver exposes collection-scoped methods (`collection.aggregate(pipeline)`, `collection.updateMany(filter, update)`, etc.) that accept plain JavaScript objects. Our raw lane mirrors this API, but the terminal method is `.build()` → `MongoQueryPlan`, and execution is separate via the runtime.

## User-facing API

### Entry point

```typescript
const raw = mongoRaw({ contract });
```

`mongoRaw()` is a standalone factory, not part of `MongoOrmClient`. It accepts a contract for collection name validation. It returns an object with a `.collection()` method.

### Collection accessor

```typescript
const orders = raw.collection('orders');
```

The collection name is validated against the contract at the type level (`keyof TContract['roots'] & string`). Internally, the root name resolves to the storage collection name via the contract: root name → model name → `storage.collection` (falling back to model name).

### Command methods — mirror native MongoDB driver

Each method mirrors the native MongoDB driver's Collection API. Arguments are the same shapes — plain objects, no Prisma Next types. The terminal `.build()` produces a `MongoQueryPlan`:

```typescript
// Aggregation pipeline
const plan = raw.collection('orders').aggregate<{ _id: string; total: number }>([
  { $match: { status: 'completed' } },
  { $group: { _id: '$department', total: { $sum: '$amount' } } },
  { $sort: { total: -1 } },
]).build();

const results = await runtime.execute(plan).toArray();

// Update many
const updatePlan = raw.collection('users').updateMany(
  { status: 'inactive' },
  { $set: { archived: true }, $unset: { sessionToken: '' } },
).build();
await runtime.execute(updatePlan);

// Delete many
const deletePlan = raw.collection('sessions').deleteMany(
  { expiresAt: { $lt: new Date() } },
).build();
await runtime.execute(deletePlan);

// Find one and update
const upsertPlan = raw.collection('counters').findOneAndUpdate(
  { _id: 'pageViews' },
  { $inc: { count: 1 } },
  { upsert: true },
).build();
const counter = await runtime.execute(upsertPlan).first();

// Pipeline-style update (MongoDB 4.2+)
const computedPlan = raw.collection('users').updateMany(
  { firstName: { $exists: true } },
  [{ $set: { fullName: { $concat: ['$firstName', ' ', '$lastName'] } } }],
).build();
await runtime.execute(computedPlan);

// Insert one
const insertPlan = raw.collection('users').insertOne(
  { name: 'Alice', email: 'alice@example.com' },
).build();
await runtime.execute(insertPlan);

// Insert many
const batchPlan = raw.collection('users').insertMany([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
]).build();
await runtime.execute(batchPlan);

// Delete one
const deleteOnePlan = raw.collection('users').deleteOne(
  { email: 'alice@example.com' },
).build();
await runtime.execute(deleteOnePlan);

// Find one and delete
const findDeletePlan = raw.collection('users').findOneAndDelete(
  { email: 'alice@example.com' },
).build();
const deleted = await runtime.execute(findDeletePlan).first();
```

### Result typing

`aggregate` and `findOneAndUpdate`/`findOneAndDelete` accept an optional type parameter for the result row. All other commands return driver result types (`{ insertedId }`, `{ modifiedCount }`, `{ deletedCount }`, etc.). When the type parameter is omitted, `aggregate` defaults to `Record<string, unknown>`.

## AST: raw command nodes

### Design: one class per command, union type

Raw commands follow the same pattern as the existing typed commands in `@prisma-next/mongo-query-ast`: one class per operation extending `MongoAstNode`, with a discriminated `kind` field, forming a union.

Raw commands carry opaque `Record<string, unknown>` fields instead of typed AST nodes (`MongoFilterExpr`, `MongoReadStage`, etc.). This keeps `Record<string, unknown>` scoped to the raw command classes — it does not leak into the typed AST. The existing `AggregateCommand` pipeline type (`AggregatePipelineEntry`) is unaffected.

```typescript
class RawAggregateCommand extends MongoAstNode {
  readonly kind = 'rawAggregate' as const;
  readonly collection: string;
  readonly pipeline: ReadonlyArray<Record<string, unknown>>;
}

class RawInsertOneCommand extends MongoAstNode {
  readonly kind = 'rawInsertOne' as const;
  readonly collection: string;
  readonly document: Record<string, unknown>;
}

class RawInsertManyCommand extends MongoAstNode {
  readonly kind = 'rawInsertMany' as const;
  readonly collection: string;
  readonly documents: ReadonlyArray<Record<string, unknown>>;
}

class RawUpdateOneCommand extends MongoAstNode {
  readonly kind = 'rawUpdateOne' as const;
  readonly collection: string;
  readonly filter: Record<string, unknown>;
  readonly update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}

class RawUpdateManyCommand extends MongoAstNode {
  readonly kind = 'rawUpdateMany' as const;
  readonly collection: string;
  readonly filter: Record<string, unknown>;
  readonly update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
}

class RawDeleteOneCommand extends MongoAstNode {
  readonly kind = 'rawDeleteOne' as const;
  readonly collection: string;
  readonly filter: Record<string, unknown>;
}

class RawDeleteManyCommand extends MongoAstNode {
  readonly kind = 'rawDeleteMany' as const;
  readonly collection: string;
  readonly filter: Record<string, unknown>;
}

class RawFindOneAndUpdateCommand extends MongoAstNode {
  readonly kind = 'rawFindOneAndUpdate' as const;
  readonly collection: string;
  readonly filter: Record<string, unknown>;
  readonly update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
  readonly upsert: boolean;
}

class RawFindOneAndDeleteCommand extends MongoAstNode {
  readonly kind = 'rawFindOneAndDelete' as const;
  readonly collection: string;
  readonly filter: Record<string, unknown>;
}
```

Union:

```typescript
type RawMongoCommand =
  | RawAggregateCommand
  | RawInsertOneCommand
  | RawInsertManyCommand
  | RawUpdateOneCommand
  | RawUpdateManyCommand
  | RawDeleteOneCommand
  | RawDeleteManyCommand
  | RawFindOneAndUpdateCommand
  | RawFindOneAndDeleteCommand;
```

`AnyMongoCommand` widens to include `RawMongoCommand`:

```typescript
type AnyMongoCommand =
  | InsertOneCommand
  | InsertManyCommand
  | UpdateOneCommand
  | UpdateManyCommand
  | DeleteOneCommand
  | DeleteManyCommand
  | FindOneAndUpdateCommand
  | FindOneAndDeleteCommand
  | AggregateCommand
  | RawMongoCommand;
```

### Update commands accept pipeline-style updates

`RawUpdateOneCommand`, `RawUpdateManyCommand`, and `RawFindOneAndUpdateCommand` have `update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>`. When `update` is an array, it represents a MongoDB 4.2+ pipeline-style update. The adapter dispatches based on whether `update` is an array or object.

### Plan metadata

All raw commands use `lane: 'mongo-raw'` in `MongoQueryPlan.meta`, distinguishing them from ORM queries (`'mongo-orm'`) and future typed pipeline queries (`'mongo-pipeline'`).

## Adapter lowering

The adapter (`MongoAdapterImpl.lower()`) adds cases for each raw command kind. Since raw commands carry opaque documents, lowering is trivial — pass the fields directly to the corresponding wire command constructor:

```typescript
case 'rawAggregate':
  return new AggregateWireCommand(command.collection, command.pipeline);
case 'rawUpdateMany':
  return new UpdateManyWireCommand(command.collection, command.filter, command.update);
case 'rawDeleteMany':
  return new DeleteManyWireCommand(command.collection, command.filter);
// ... etc
```

No `resolveValue()` calls, no `lowerFilter()`, no `lowerPipeline()` — raw documents pass through unchanged.

## Execution path

```
raw.collection('orders').aggregate([...]).build()
  │
  ├─ resolve root name 'orders' → model 'Order' → storage collection 'orders'
  ├─ new RawAggregateCommand('orders', pipeline)
  └─ MongoQueryPlan { collection, command, meta: { lane: 'mongo-raw' } }

runtime.execute(plan)
  │
  ├─ adapter.lower(plan)
  │   ├─ command.kind === 'rawAggregate'
  │   └─ AggregateWireCommand(collection, pipeline)  ← pass through, no lowering
  │
  └─ driver.execute(wireCommand)
      └─ MongoDB native driver ← actual execution
```

## Package placement

### Raw command AST nodes

`packages/2-mongo-family/4-query/query-ast/src/raw-commands.ts`

New file in `@prisma-next/mongo-query-ast`. Exports the 9 raw command classes and the `RawMongoCommand` union. Update `AnyMongoCommand` in `commands.ts` to include `RawMongoCommand`.

### Raw collection builder

`packages/2-mongo-family/5-query-builders/src/raw-collection.ts`

New file in `@prisma-next/mongo-orm`. Contains the `RawMongoCollection` class with methods mirroring the native driver API. Each method returns a buildable object whose `.build()` produces a `MongoQueryPlan`.

### `mongoRaw()` factory

`packages/2-mongo-family/5-query-builders/src/mongo-raw.ts`

New file in `@prisma-next/mongo-orm`. The `mongoRaw({ contract })` factory function that returns `{ collection(name): RawMongoCollection }`.

### Adapter lowering

`packages/3-mongo-target/2-mongo-adapter/src/lowering.ts`

No new file. Add `case` branches for each `raw*` kind in the adapter's `lower()` method. Trivial — each case constructs the corresponding wire command from the raw command's opaque fields.

## Implementation tasks

### 1. Raw command AST nodes

Add the 9 raw command classes, `RawMongoCommand` union, and update `AnyMongoCommand` in `@prisma-next/mongo-query-ast`.

**Tests:** Unit tests for construction, freezing, and `kind` discriminant for each class.

### 2. Adapter lowering for raw commands

Add lowering cases for all 9 raw command kinds in the adapter. Update the exhaustive switch.

**Tests:** Unit tests verifying each raw command lowers to the correct wire command with fields passed through unchanged.

### 3. `mongoRaw()` factory and `RawMongoCollection`

Implement the user-facing API: `mongoRaw({ contract })` → `.collection(name)` → command methods → `.build()`.

**Tests:**
- **Unit tests:** Plan construction for each command method — verify correct `RawXCommand` is created with correct collection name (resolved from contract) and correct opaque arguments.
- **Type tests (`.test-d.ts`):** Valid root name compiles; invalid root name doesn't. `aggregate<Row>()` type parameter propagates. Default row type is `Record<string, unknown>`.

### 4. Integration tests

Execute raw commands against mongodb-memory-server via the full runtime pipeline.

**Test cases:**
- `aggregate`: `$group` + `$sort` pipeline, verify aggregated results
- `insertOne` + read-back via `aggregate` with `$match`
- `updateMany` + verify modified documents
- `deleteMany` + verify documents removed
- `findOneAndUpdate` with upsert
- Pipeline-style update (`updateMany` with array update)

### 5. Export wiring

Export `mongoRaw`, `RawMongoCollection` type, and raw command types from `@prisma-next/mongo-orm` and `@prisma-next/mongo-query-ast` exports.

## Sequencing

```
1. Raw command AST nodes + unit tests
2. Adapter lowering + unit tests
3. mongoRaw() factory + RawMongoCollection + unit tests + type tests
4. Integration tests
5. Export wiring
```

Steps 1 and 2 can proceed in parallel. Step 3 depends on step 1 (needs the command classes). Step 4 depends on steps 2 and 3.

## Validation

Complete when:

- [ ] `raw.collection('orders').aggregate<Row>([...]).build()` produces a valid `MongoQueryPlan` with `RawAggregateCommand` and `lane: 'mongo-raw'`
- [ ] All 9 command methods work: `aggregate`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `findOneAndUpdate`, `findOneAndDelete`
- [ ] Collection name validated against contract — unknown root name is a compile-time error
- [ ] Type parameter assertion works for `aggregate` — explicit `Row` type propagates to the plan
- [ ] Integration tests pass against mongodb-memory-server for aggregate, insert, update, delete, and pipeline-style update
- [ ] All existing ORM tests pass unchanged
- [ ] `Record<string, unknown>` does not appear in `AggregatePipelineEntry` or any typed command — scoped only to raw command classes

## Future considerations

### Parameterized query plans

Raw commands currently carry plain values in their opaque `Record<string, unknown>` fields. In the future, parameterized query plans (where values are bound at execution time rather than plan-build time) could be supported by allowing `MongoParamRef` instances within the opaque documents. The adapter would deep-walk the documents to resolve parameters during lowering. The raw command class signatures would not need to change — `Record<string, unknown>` already accommodates `MongoParamRef` values.

### Removing `Record<string, unknown>` from `AggregatePipelineEntry`

With raw aggregate pipelines handled by `RawAggregateCommand`, the `Record<string, unknown>` arm of `AggregatePipelineEntry` is only used by the existing `aggregate.test.ts` integration test. Once Milestone 3 introduces typed stage classes for `$group` etc., the test can be updated to use typed stages and the `Record<string, unknown>` arm can be removed. This is tracked in Milestone 5 task 5.4.

### Typed pipeline builder entry point

The typed `PipelineBuilder` (Milestone 4) will need its own entry point (`mongoPipeline({ context })` or similar). Whether it shares the `mongoRaw()` factory or has a separate one is a Milestone 4 decision. The raw lane's design does not constrain this.
