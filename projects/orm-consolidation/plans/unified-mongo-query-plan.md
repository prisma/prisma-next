# Design: Unified Mongo Query Plan

## Problem

The Mongo execution pipeline is bifurcated. Reads and writes flow through different interfaces at every layer:

| Layer | Read path | Write path |
|---|---|---|
| ORM → Executor | `execute(plan: MongoReadPlan)` | `executeCommand(command: AnyMongoCommand, meta: PlanMeta)` |
| Runtime | `execute(plan: MongoReadPlanLike)` | `executeCommand(command: MongoCommandLike, meta: PlanMeta)` |
| Adapter | `lowerReadPlan(plan): AggregateWireCommand` | `lowerCommand(command, context): AnyMongoWireCommand` |
| Core types | `MongoReadPlanLike` | `MongoCommandLike` |

The driver has a single `execute(wireCommand)` — the split collapses there, proving it's unnecessary above.

This violates the pattern established by the SQL domain, where all queries (reads and writes) produce the same plan type (`SqlQueryPlan`), flow through a single `execute(plan)` on the runtime, and are lowered by a single `lower(ast)` on the adapter. The adapter/driver internally dispatch based on the AST variant, but this is invisible to every layer above.

### How it happened

Phase 1 (read-only) introduced `MongoReadPlan` and `execute()` for reads. The runtime already had `executeCommand()` for pre-existing one-off write commands (`InsertOneCommand`, etc.) from before the ORM existed. Phase 1.5 propagated `executeCommand` to the ORM executor interface rather than unifying the plan type.

### Why it matters

1. **Every consumer must know about the split.** The ORM collection has two code paths: `#execute()` for reads and `#executeCommand()` for writes. The executor interface has two methods. The runtime has two methods. This is accidental complexity.
2. **Phase 2 shared interface extraction is harder.** The shared `Collection` base needs a single execution interface. If the Mongo executor has two methods, the shared interface must accommodate both, leaking the Mongo-specific split into the framework layer.
3. **`mongo-core` accumulates grab-bag types.** `MongoCommandLike` and `MongoReadPlanLike` are two parallel structural interfaces for the same purpose (describing something the adapter should lower). They exist because there's no unified plan type.

## Reference: SQL domain pattern

The SQL domain demonstrates the correct pattern:

```
Lane / ORM
  ↓ produces SqlQueryPlan (AST + params + meta)
  ↓ — same type for SELECT, INSERT, UPDATE, DELETE, UPSERT
Runtime.execute(plan: SqlQueryPlan)
  ↓ calls adapter.lower(ast) → LoweredStatement (sql + params)
  ↓ constructs ExecutionPlan
Driver.query(sql, params)
  ↓ returns rows
```

Key properties:
- `SqlQueryPlan` is the single plan type for all query kinds
- SQL mutations (`compileInsertReturning`, `compileUpsertReturning`, etc.) produce `SqlQueryPlan` — not a separate "command" type
- The runtime has a single `execute()` method
- The adapter has a single `lower()` method
- The AST is a discriminated union (`AnyQueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst | ...`)
- The driver dispatches on the lowered SQL string — it doesn't know or care what kind of query it is

## Target design

### Unified `MongoQueryPlan`

Introduce a single plan type that encompasses both reads and writes:

```typescript
// In mongo-query-ast (the plan is pre-lowering, contains typed AST)
export interface MongoQueryPlan<Row = unknown> {
  readonly collection: string;
  readonly command: AnyMongoCommand;  // discriminated union of all command kinds
  readonly meta: PlanMeta;
  readonly [__mongoQueryPlanRow]?: Row;
}
```

`AnyMongoCommand` already includes `AggregateCommand` (reads) alongside write commands (`InsertOneCommand`, `FindOneAndUpdateCommand`, etc.). The existing discriminated union is the AST — the plan wraps it with metadata, just like `SqlQueryPlan` wraps `AnyQueryAst`.

`MongoReadPlan` becomes a convenience for the ORM's read compilation but the executor/runtime only sees `MongoQueryPlan`.

### Single adapter method

```typescript
// In mongo-core (adapter-types.ts)
export interface MongoAdapter {
  lower(plan: MongoQueryPlan): AnyMongoWireCommand;
}
```

The adapter internally dispatches: `AggregateCommand` → pipeline lowering via `lowerPipeline()`; write commands → `lowerFilter()` + `resolveDocument()`. This is an adapter implementation detail.

### Single executor / runtime method

```typescript
// In mongo-orm (executor.ts)
export interface MongoQueryExecutor {
  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
}

// In mongo-runtime
export interface MongoRuntime {
  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
  close(): Promise<void>;
}
```

### Collapse `MongoCommandLike` and `MongoReadPlanLike`

Both structural interfaces are replaced by `MongoQueryPlan`. If the adapter needs a structural interface (to avoid importing the concrete type from `mongo-query-ast`), it's a single `MongoQueryPlanLike`:

```typescript
export interface MongoQueryPlanLike {
  readonly collection: string;
  readonly command: { readonly kind: string };
  readonly meta: PlanMeta;
}
```

### What about `MongoExecutionPlan`?

`mongo-core/plan.ts` already defines `MongoExecutionPlan` (`wireCommand + meta`). This is the post-lowering plan — the Mongo equivalent of SQL's `ExecutionPlan`. It can serve as the output of `adapter.lower()` if we want to preserve the pre/post-lowering distinction:

```typescript
export interface MongoAdapter {
  lower(plan: MongoQueryPlanLike): MongoExecutionPlan;
}
```

The runtime then passes `executionPlan.wireCommand` to the driver.

## ORM compilation changes

Currently the ORM has two compilation paths:

- **Reads:** `#compile()` → `MongoReadPlan` → `executor.execute(plan)`
- **Writes:** build bare command → `executor.executeCommand(command, meta)`

After unification:

- **Reads:** `#compile()` → `MongoQueryPlan` (wraps `AggregateCommand` + meta) → `executor.execute(plan)`
- **Writes:** build command → wrap in `MongoQueryPlan` (command + meta) → `executor.execute(plan)`

The compilation helper that currently produces `MongoReadPlan` would produce `MongoQueryPlan` instead (or `MongoReadPlan` gets a thin conversion to `MongoQueryPlan`). Write methods wrap their command in a `MongoQueryPlan` with `#planMeta()` — the same metadata construction they do today, just packaged into the plan.

## Migration

### Step 1: Introduce `MongoQueryPlan` in `mongo-query-ast`

Add the unified plan type alongside `MongoReadPlan`. `MongoReadPlan` can remain temporarily as a narrower type for read-path compilation.

### Step 2: Add `MongoQueryPlanLike` in `mongo-core`, replacing both structural interfaces

Replace `MongoCommandLike` and `MongoReadPlanLike` with `MongoQueryPlanLike`. Update `MongoAdapter` to have a single `lower(plan)` method.

### Step 3: Update adapter implementation

Collapse `lowerCommand` and `lowerReadPlan` into a single `lower()` method that switches on `plan.command.kind`. The `aggregate` case calls `lowerPipeline()`; write cases call `lowerFilter()` + `resolveDocument()`.

### Step 4: Update runtime

Collapse `execute` and `executeCommand` into a single `execute(plan)` method.

### Step 5: Update ORM executor and collection

Remove `executeCommand` from `MongoQueryExecutor`. Write methods wrap commands in `MongoQueryPlan` and call `executor.execute()`.

### Step 6: Clean up

Remove `MongoCommandLike`, `MongoReadPlanLike`, and the dead `MongoExecutionPlan` (or repurpose it as the post-lowering type). Remove the now-unused dual methods from all layers.

## Sequencing

This can be done as a refactor within Phase 1.5 (before the branch ships) or as a prerequisite task at the start of Phase 2. Doing it now is cleaner — the dual interface hasn't proliferated beyond this branch yet.
