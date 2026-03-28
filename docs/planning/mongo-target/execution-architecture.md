# Execution Architecture: SQL vs. Mongo

How query plans flow from the ORM client through the runtime to the database driver — and why this pipeline can't be generalized across families without losing type information.

## The SQL execution flow today

```
ORM client (Collection)
  → compiles state into SqlQueryPlan { sql, params, ast?, meta }
    → lower-sql-plan lowers to ExecutionPlan { sql, params, meta }
      → RuntimeCore.execute(plan)
        → plugin.beforeExecute(plan, ctx)
        → driver.execute({ sql: plan.sql, params: plan.params })
          → yields AsyncIterable<Row>
        → plugin.onRow(row, plan, ctx)
        → plugin.afterExecute(plan, { rowCount, latencyMs }, ctx)
```

### Key types

**`ExecutionPlan`** ([`packages/1-framework/1-core/shared/contract/src/types.ts`](../../../packages/1-framework/1-core/shared/contract/src/types.ts)):
```typescript
interface ExecutionPlan<Row = unknown, Ast = unknown> {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly ast?: Ast;
  readonly meta: PlanMeta;
  readonly _row?: Row;  // phantom for type extraction
}
```

**`PlanMeta`** — target, storageHash, lane, annotations (limit, codecs), refs (tables), projection, paramDescriptors.

**`Plugin`** ([`packages/1-framework/4-runtime-executor/src/plugins/types.ts`](../../../packages/1-framework/4-runtime-executor/src/plugins/types.ts)):
```typescript
interface Plugin<TContract, TAdapter, TDriver> {
  readonly name: string;
  beforeExecute?(plan: ExecutionPlan, ctx: PluginContext): Promise<void>;
  onRow?(row: Record<string, unknown>, plan: ExecutionPlan, ctx: PluginContext): Promise<void>;
  afterExecute?(plan: ExecutionPlan, result: AfterExecuteResult, ctx: PluginContext): Promise<void>;
}
```

**`RuntimeFamilyAdapter`** ([`packages/1-framework/4-runtime-executor/src/runtime-spi.ts`](../../../packages/1-framework/4-runtime-executor/src/runtime-spi.ts)):
```typescript
interface RuntimeFamilyAdapter<TContract> {
  readonly contract: TContract;
  readonly markerReader: MarkerReader;
  validatePlan(plan: ExecutionPlan, contract: TContract): void;
}
```

**`RuntimeCore.execute()`** ([`packages/1-framework/4-runtime-executor/src/runtime-core.ts`](../../../packages/1-framework/4-runtime-executor/src/runtime-core.ts)) — validates the plan, runs the plugin lifecycle, passes `{ sql, params }` to the driver's `execute()`, and wraps the result in `AsyncIterableResult<Row>`.

---

## The Mongo execution flow

### No AST needed — the query IS the data structure

In SQL, the ORM builds an intent (AST), serializes it to a string (`sql: string`), and the driver parses it back. There's a lossy serialization step.

In Mongo, queries are already structured objects. `{ collection: 'users', filter: { age: { $gt: 25 } }, options: { limit: 10 } }` is both the intent AND the command the driver consumes. There's no serialization/parsing round-trip.

### Query plan shape

```typescript
interface MongoCommand {
  readonly collection: string;
  readonly operation: 'find' | 'insertOne' | 'insertMany' | 'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany' | 'aggregate';
  readonly filter?: Document;
  readonly update?: Document;
  readonly document?: Document;
  readonly documents?: Document[];
  readonly pipeline?: Document[];
  readonly options?: {
    readonly projection?: Document;
    readonly sort?: Document;
    readonly limit?: number;
    readonly skip?: number;
  };
}

interface MongoQueryPlan<Row = unknown> {
  readonly command: MongoCommand;
  readonly meta: MongoPlanMeta;
  readonly _row?: Row;  // phantom for type extraction
}
```

`MongoPlanMeta` would carry the family-agnostic metadata (target, storageHash, lane, annotations) — similar to SQL's `PlanMeta` but without SQL-specific fields like `paramDescriptors` or `projection` (which map to SQL column aliases).

### Execution flow

```
Mongo ORM client
  → compiles state into MongoQueryPlan { command, meta }
    → MongoRuntimeCore.execute(plan)
      → plugin.beforeExecute(plan, ctx)
      → mongoDriver.execute(plan.command)
        → dispatches to mongodb driver: collection.find() / insertOne() / etc.
        → yields AsyncIterable<Document>
      → plugin.onRow(doc, plan, ctx)
      → plugin.afterExecute(plan, { rowCount, latencyMs }, ctx)
```

The driver dispatches based on `command.operation`:
```typescript
// Simplified driver dispatch
switch (command.operation) {
  case 'find':
    return collection.find(command.filter, command.options);
  case 'insertOne':
    return collection.insertOne(command.document);
  case 'aggregate':
    return collection.aggregate(command.pipeline);
  // ...
}
```

---

## Why `ExecutionPlan` can't be generalized

The obvious approach is to make `ExecutionPlan` generic: `ExecutionPlan<TQuery>` where SQL has `TQuery = { sql: string; params: unknown[] }` and Mongo has `TQuery = MongoCommand`. But this doesn't work because **plugins use SQL-specific fields directly**.

### Evidence: the budgets plugin

[`packages/2-sql/5-runtime/src/plugins/budgets.ts`](../../../packages/2-sql/5-runtime/src/plugins/budgets.ts):

- Reads `plan.sql` and `plan.params` to call `driver.explain({ sql: plan.sql, params: plan.params })` (line 35)
- Parses the SQL string: `plan.sql.trimStart().toUpperCase()` to detect `SELECT` statements (line 315)
- Inspects `plan.ast` for `SelectAst` instances to detect aggregate expressions and limits (line 256)
- Uses `plan.meta.annotations?.['limit']` and `plan.meta.refs?.tables` for heuristic estimation (lines 155-162)

### Evidence: the lints plugin

[`packages/2-sql/5-runtime/src/plugins/lints.ts`](../../../packages/2-sql/5-runtime/src/plugins/lints.ts):

- Checks `plan.ast instanceof QueryAst` — the SQL AST class hierarchy (line 15-17)
- Pattern-matches on SQL AST node types: `DeleteAst`, `UpdateAst`, `SelectAst` (lines 70-113)
- Falls back to raw SQL string parsing via `evaluateRawGuardrails(plan)` when no AST (line 188)

### The generalization trap

If you make `ExecutionPlan<TQuery>`, every plugin that touches the plan needs one of:

1. **Accept a union** (`SqlQuery | MongoCommand`) and branch — every SQL plugin gains Mongo awareness, every Mongo plugin gains SQL awareness. This couples the families.
2. **Accept only the base type** (just `meta`) — plugins can't inspect the query payload, making them useless for linting, budgets, explain, or anything beyond timing.
3. **Be generic** (`Plugin<TContract, TAdapter, TDriver, TQuery>`) — the plugin interface gains a fourth generic, and family-specific plugins need to constrain `TQuery` to their family's plan type. This is complexity for no practical benefit, since no plugin actually needs to work with both plan types.

---

## Plugins are family-specific

This is the key insight: **the useful work plugins do is inherently family-specific**.

### SQL plugins inspect SQL

- "DELETE without WHERE" → inspects SQL AST for `DeleteAst` with missing `where` clause
- "Unbounded SELECT" → inspects SQL AST for `SelectAst` with missing `limit`
- "Row budget with EXPLAIN" → calls Postgres's `EXPLAIN` with the SQL string
- "SELECT *" → inspects SQL AST for `selectAllIntent`

### Mongo plugins would inspect Mongo commands

- "Unbounded find" → checks `command.operation === 'find' && command.options?.limit === undefined`
- "Delete without filter" → checks `command.operation === 'deleteMany' && !command.filter`
- "Row budget with explain" → calls MongoDB's `collection.find(filter).explain()` — completely different API from SQL EXPLAIN
- "Missing index hint" → Mongo-specific concern

### What IS shared

Sharing happens along two dimensions — **across families** (SQL vs. Mongo) and **across operation types** (request vs. subscribe). See [Streaming subscriptions](#streaming-subscriptions-change-streams-realtime) below for the full analysis of operation types.

**Across families** (within the same operation type):

The request-response **lifecycle** is shared:
- `beforeExecute` — check the plan before sending to the database
- `onRow` — observe each row/document as it streams back
- `afterExecute` — observe timing and row counts after completion

The subscription **lifecycle** is also shared (but different from request-response):
- `onSubscribe` — observe a new subscription starting
- `onEvent` — observe each change event
- `onError` — handle errors / reconnection
- `onUnsubscribe` — observe a subscription ending

The **metadata** is shared across both families and both operation types:
- Operation name, model name, lane, target, storageHash
- Timing (`latencyMs`), row/event counts, completion status

The **query payload** is not shared — and plugins that don't inspect it are the only candidates for cross-family reuse.

### Cross-family plugin interface (to extract later)

After both runtimes exist, the common plugin interface would look something like:

```typescript
interface CrossFamilyPlugin {
  readonly name: string;

  // Request-response hooks
  beforeExecute?(meta: PlanMeta, ctx: MinimalPluginContext): Promise<void>;
  onRow?(row: Record<string, unknown>, meta: PlanMeta, ctx: MinimalPluginContext): Promise<void>;
  afterExecute?(meta: PlanMeta, result: AfterExecuteResult, ctx: MinimalPluginContext): Promise<void>;

  // Subscription hooks (future)
  onSubscribe?(meta: PlanMeta, ctx: MinimalPluginContext): Promise<void>;
  onEvent?(event: ChangeEvent<Record<string, unknown>>, meta: PlanMeta, ctx: MinimalPluginContext): Promise<void>;
  onUnsubscribe?(meta: PlanMeta, stats: SubscriptionStats, ctx: MinimalPluginContext): Promise<void>;
}
```

This would support plugins like:
- Latency logging (both operations)
- Row/event count telemetry (both operations)
- Rate limiting by model/lane (both operations)
- Generic caching by metadata key (requests only)
- Reconnection / resume token tracking (subscriptions only)

But this interface is discovered after the fact, not designed up front.

---

## Streaming subscriptions (change streams, realtime)

### The problem

The execution model above is **request-response**: send a query, get rows back, done. But both Mongo and SQL have streaming subscription models:

- **Mongo**: [change streams](https://www.mongodb.com/docs/manual/changeStreams/) — `collection.watch()` returns a resumable, ordered stream of change events (insert/update/delete). A core part of the Mongo-native experience.
- **SQL/Postgres**: [logical replication](https://supabase.com/docs/guides/realtime/architecture) (what Supabase Realtime uses), `LISTEN/NOTIFY` — WAL-based CDC that pushes row changes to subscribers.

The current plugin lifecycle (`beforeExecute → onRow → afterExecute`) assumes bounded execution — `afterExecute` fires when the query completes. Subscriptions don't complete. They run indefinitely until explicitly closed.

### Two axes of variation

The runtime has two independent dimensions:

|  | **Request** (bounded) | **Subscribe** (unbounded) |
|---|---|---|
| **SQL** | SQL query → rows | SQL query → change events |
| **Mongo** | Mongo query → documents | Mongo query → change events |

- **Family** (rows) determines the **query payload shape** — SQL filter vs. Mongo filter
- **Operation type** (columns) determines the **output shape + lifecycle** — snapshot vs. stream

### Shared input, different output

A query describes **what data you're interested in** — "users where age > 25, with their posts." That description is the same regardless of whether you want a snapshot or a stream:

```typescript
const query = db.users.where({ age: { gt: 25 } }).include({ posts: true });

// Request — current snapshot
const users = await query.findMany();

// Subscribe — stream of changes
const stream = query.watch();
for await (const event of stream) {
  // { type: 'insert' | 'update' | 'delete', document, previousDocument? }
}
```

The ORM client's query builder is reusable across both modes — only the terminal operation differs (`findMany()` vs. `watch()`).

The input is "the same concept + subscription-specific options" rather than strictly identical. Subscriptions carry extra configuration that requests don't: resume tokens (Mongo `resumeAfter`), event type filters (only inserts? only updates?), full-document options (`fullDocument: 'updateLookup'`). And Mongo change streams use aggregation pipeline syntax for filtering (`$match`), not the same filter syntax as `find()`. But the conceptual query — the data interest — is shared.

### Separate lifecycles

Each operation type has its own plugin lifecycle:

**Request lifecycle** (existing):
```
beforeExecute(plan) → onRow(row) → afterExecute(plan, { rowCount, latencyMs })
```

**Subscription lifecycle** (future):
```
onSubscribe(subscription) → onEvent(event) → onError(error) → onUnsubscribe(subscription, stats)
```

These don't cross over. A budget plugin that enforces row limits makes sense for requests but not subscriptions. A reconnection plugin that tracks resume tokens makes sense for subscriptions but not requests.

### Change events may standardize across families

Unlike query plans (which are deeply family-specific), the change event output may be standardizable. Every CDC system expresses the same thing: "entity X in collection/table Y was inserted/updated/deleted, here's the before/after state."

```typescript
interface ChangeEvent<Row> {
  readonly type: 'insert' | 'update' | 'delete';
  readonly collection: string;  // or table
  readonly document: Row;
  readonly previousDocument?: Row;  // for updates/deletes
  readonly metadata: {
    readonly resumeToken?: unknown;  // Mongo
    readonly lsn?: string;          // Postgres
    readonly timestamp: Date;
  };
}
```

This is speculative — the PoC doesn't implement subscriptions. But the structure is worth noting because it's a stronger candidate for cross-family sharing than query plans are.

### Architecture constraints

The PoC doesn't implement subscriptions, but must not prevent them:

- **Don't assume `execute()` is the only operation** on the runtime. Leave room for `subscribe()`.
- **Don't assume all `AsyncIterableResult` streams are finite.** The wrapper already supports unbounded iterables — don't add completion assumptions elsewhere.
- **Keep the query builder terminal-agnostic.** The ORM client's filter/projection/include state should compile to a query description that both `execute()` and `subscribe()` can consume.

---

## Implications for the PoC

1. **Build a `MongoRuntimeCore`** with its own `MongoPlugin` interface accepting `MongoQueryPlan`. Do not try to generalize `RuntimeCore`.

2. **Build a `MongoDriver`** with its own `execute(command: MongoCommand)` method. Do not try to generalize the `Queryable` interface (which has `execute({ sql, params })`).

3. **Build a `MongoFamilyAdapter`** with its own `validatePlan(plan: MongoQueryPlan, contract: MongoContract)`. The validation logic (target match, hash match) is the same as SQL, but the types are different.

4. **Reuse `PlanMeta`** (or a subset) for the metadata that plugins and telemetry need. This is the most likely candidate for cross-family sharing.

5. **Reuse `AsyncIterableResult<Row>`** for the return type. This is already family-agnostic — it wraps any `AsyncIterable`.

6. **After both runtimes work**, compare the two implementations and extract the shared lifecycle/metadata interface. The extraction will be straightforward because both runtimes follow the same `beforeExecute → yield rows → afterExecute` pattern — they just differ in what "plan" means.
