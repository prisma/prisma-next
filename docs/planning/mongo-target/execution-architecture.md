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

The plugin **lifecycle** is shared:
- `beforeExecute` — check the plan before sending to the database
- `onRow` — observe each row/document as it streams back
- `afterExecute` — observe timing and row counts after completion

The **metadata** is shared:
- Operation name, model name, lane, target, storageHash
- Timing (`latencyMs`), row counts, completion status

The **query payload** is not shared — and plugins that don't need it are the only candidates for cross-family reuse.

### Cross-family plugin interface (to extract later)

After both runtimes exist, the common plugin interface would look something like:

```typescript
interface CrossFamilyPlugin {
  readonly name: string;
  beforeExecute?(meta: PlanMeta, ctx: MinimalPluginContext): Promise<void>;
  onRow?(row: Record<string, unknown>, meta: PlanMeta, ctx: MinimalPluginContext): Promise<void>;
  afterExecute?(meta: PlanMeta, result: AfterExecuteResult, ctx: MinimalPluginContext): Promise<void>;
}
```

This would support plugins like:
- Latency logging
- Row count telemetry
- Rate limiting (by model/lane)
- Generic caching (by metadata key, not by query content)

But this interface is discovered after the fact, not designed up front.

---

## Implications for the PoC

1. **Build a `MongoRuntimeCore`** with its own `MongoPlugin` interface accepting `MongoQueryPlan`. Do not try to generalize `RuntimeCore`.

2. **Build a `MongoDriver`** with its own `execute(command: MongoCommand)` method. Do not try to generalize the `Queryable` interface (which has `execute({ sql, params })`).

3. **Build a `MongoFamilyAdapter`** with its own `validatePlan(plan: MongoQueryPlan, contract: MongoContract)`. The validation logic (target match, hash match) is the same as SQL, but the types are different.

4. **Reuse `PlanMeta`** (or a subset) for the metadata that plugins and telemetry need. This is the most likely candidate for cross-family sharing.

5. **Reuse `AsyncIterableResult<Row>`** for the return type. This is already family-agnostic — it wraps any `AsyncIterable`.

6. **After both runtimes work**, compare the two implementations and extract the shared lifecycle/metadata interface. The extraction will be straightforward because both runtimes follow the same `beforeExecute → yield rows → afterExecute` pattern — they just differ in what "plan" means.
