# Data Transform Check Unification

## Context

The data migrations branch introduces `MongoDataTransformOperation` with a `check` field that uses a different structure from the DDL operation's `precheck`/`postcheck` checks (`MongoMigrationCheck`). After review, both represent the same concept — "run a query, check the result against an expectation" — and should share a consistent interface.

This document specifies the unified check model and the changes needed to get there. It also specifies removing the `MongoDbDmlExecutor` in favor of the existing `MongoAdapter` + `MongoDriver` transport abstractions.

## Problem

### Two inconsistent check mechanisms

Today the codebase has two check structures that serve the same purpose:

**DDL checks** (`MongoMigrationCheck` in `migration-operation-types.ts`):

```typescript
interface MongoMigrationCheck {
  readonly description: string;
  readonly source: AnyMongoInspectionCommand;  // ListCollections or ListIndexes
  readonly filter: MongoFilterExpr;             // client-side filter applied to results
  readonly expect: 'exists' | 'notExists';      // expectation about filtered result
}
```

Used in DDL operations like `createIndex`:

```typescript
precheck: [{
  description: 'index does not already exist on users',
  source: new ListIndexesCommand('users'),
  filter: MongoFieldFilter.eq('key', { email: 1 }),
  expect: 'notExists',
}]
```

The runner evaluates these in `evaluateChecks()`:
1. Run `source.accept(inspectionExecutor)` → get documents
2. Apply `filter` client-side via `FilterEvaluator` → find matches
3. Compare against `expect` — `'exists'` means "at least one match required", `'notExists'` means "no matches allowed"

**Data transform checks** (current implementation in `MongoDataTransformOperation`):

```typescript
interface MongoDataTransformOperation extends MigrationPlanOperation {
  readonly operationClass: 'data';
  readonly name: string;
  readonly check: MongoQueryPlan | boolean;  // bare query plan or boolean
  readonly run: readonly MongoQueryPlan[];
}
```

The runner evaluates these in `executeDataTransform()`:
1. Run `dmlExecutor.execute(check)` → get documents
2. **No client-side filter** — the pipeline itself filters
3. Implicit expectation: empty result = done (skip), non-empty = violations remain (run)

### Both are: query + expectation

Both mechanisms do the same thing:
1. Execute a query against the database
2. Inspect the result set
3. Make a decision based on whether matching documents exist

The differences — inspection commands vs query plans, client-side filter vs pipeline filter, explicit vs implicit expectation — are accidental complexity, not essential differences. Users will see DDL operations and data transforms side by side in the same migration file. Their check interfaces should be consistent.

### Redundant DML executor

The `MongoDbDmlExecutor` class in `adapter-mongo` reimplements the command dispatch logic from `MongoDriverImpl`, calling `db.collection(...)` directly. The codebase already has `MongoAdapter.lower()` → `MongoDriver.execute()` as the canonical query execution path. The executor should be deleted; the runner should use the existing transport abstractions.

## Design

### Unified check type

Two concrete check types share a common shape but specialize the source query type.

```typescript
// DDL check — source is an inspection command (ListCollections, ListIndexes)
interface MongoMigrationCheck {
  readonly description: string;
  readonly source: AnyMongoInspectionCommand;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
}

// Data transform check — source is a query plan (aggregate, raw query)
interface MongoDataTransformCheck {
  readonly description: string;
  readonly source: MongoQueryPlan;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
}
```

Both have the same four fields with the same names and the same semantics:
- `description` — human-readable label for diagnostics
- `source` — the query to execute (specialised per check kind)
- `filter` — client-side `MongoFilterExpr` applied to query results via `FilterEvaluator`
- `expect` — `'exists'` (at least one match required) or `'notExists'` (no matches allowed)

#### Why two types instead of a generic?

The source types (`AnyMongoInspectionCommand` vs `MongoQueryPlan`) need different executors — DDL checks go through `MongoInspectionCommandVisitor`, data transform checks go through `MongoAdapter.lower()` → `MongoDriver.execute()`. A generic `MigrationCheck<TSource>` would need the consumer to know how to execute the source, which pushes dispatch logic to call sites. Two concrete types with a shared shape lets the runner dispatch internally based on which operation type it's processing, while keeping the external API consistent.

A private abstract base (or simply enforcing the shared shape via tests) keeps the two types in sync without exposing the abstraction to consumers.

#### Client-side filter on data transform checks

Even though data transform checks can embed filtering in the pipeline (`$match`), providing the `filter` field has several benefits:
- **Consistency** — same evaluation model as DDL checks; same `FilterEvaluator` path
- **Separation of concerns** — the source query fetches candidates, the filter narrows
- **Diagnostic clarity** — the runner can report which filter condition failed, not just "query returned results"

Users can put all filtering in the pipeline for performance and use `filter: MongoFieldFilter.eq('_exists', true)` (a trivial pass-through) or similar. But the field is always present for structural consistency.

### Updated `MongoDataTransformOperation`

```typescript
interface MongoDataTransformOperation extends MigrationPlanOperation {
  readonly operationClass: 'data';
  readonly name: string;
  readonly precheck: readonly MongoDataTransformCheck[];
  readonly run: readonly MongoQueryPlan[];
  readonly postcheck: readonly MongoDataTransformCheck[];
}
```

Changes from the current implementation:
- `check: MongoQueryPlan | boolean` → `precheck: readonly MongoDataTransformCheck[]` and `postcheck: readonly MongoDataTransformCheck[]`
- Boolean `check: false` (always run) → empty `precheck` array (same semantics — no idempotency check means always run)
- Boolean `check: true` (always skip) → removed entirely (if you always skip, don't include the operation)
- The same check used to serve as both pre-check (should we run?) and post-check (did it work?). Now they are separate arrays, consistent with DDL's `precheck`/`postcheck`. This allows different check logic before and after execution if needed.

The `precheck` and `postcheck` field names match the DDL operation's existing field names, reinforcing the visual and conceptual consistency.

### Updated runner evaluation

The runner already has `evaluateChecks()` for DDL checks:

```typescript
// Existing DDL check evaluation (unchanged)
private async evaluateChecks(
  checks: readonly MongoMigrationCheck[],
  inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>,
  filterEvaluator: FilterEvaluator,
): Promise<boolean> {
  for (const check of checks) {
    const documents = await check.source.accept(inspectionExecutor);
    const matchFound = documents.some((doc) =>
      filterEvaluator.evaluate(check.filter, doc),
    );
    const passed = check.expect === 'exists' ? matchFound : !matchFound;
    if (!passed) return false;
  }
  return true;
}
```

A parallel method handles data transform checks using adapter + driver:

```typescript
// New data transform check evaluation
private async evaluateDataTransformChecks(
  checks: readonly MongoDataTransformCheck[],
  adapter: MongoAdapter,
  driver: MongoDriver,
  filterEvaluator: FilterEvaluator,
): Promise<boolean> {
  for (const check of checks) {
    const wireCommand = adapter.lower(check.source);
    const documents: Record<string, unknown>[] = [];
    for await (const row of driver.execute<Record<string, unknown>>(wireCommand)) {
      documents.push(row);
    }
    const matchFound = documents.some((doc) =>
      filterEvaluator.evaluate(check.filter, doc),
    );
    const passed = check.expect === 'exists' ? matchFound : !matchFound;
    if (!passed) return false;
  }
  return true;
}
```

The evaluation logic is identical — run query, apply filter, check expectation. Only the query execution mechanism differs. The `executeDataTransform` method uses this:

```typescript
private async executeDataTransform(
  op: MongoDataTransformOperation,
  adapter: MongoAdapter,
  driver: MongoDriver,
  filterEvaluator: FilterEvaluator,
  runIdempotency: boolean,
  runPrechecks: boolean,
  runPostchecks: boolean,
): Promise<MigrationRunnerResult | undefined> {
  // Idempotency: if all postchecks pass, skip
  if (runPostchecks && runIdempotency) {
    const allSatisfied = await this.evaluateDataTransformChecks(
      op.postcheck, adapter, driver, filterEvaluator,
    );
    if (allSatisfied) return undefined; // already done, skip
  }

  // Prechecks
  if (runPrechecks && op.precheck.length > 0) {
    const passed = await this.evaluateDataTransformChecks(
      op.precheck, adapter, driver, filterEvaluator,
    );
    if (!passed) {
      return runnerFailure('PRECHECK_FAILED', ...);
    }
  }

  // Execute
  for (const plan of op.run) {
    const wireCommand = adapter.lower(plan);
    for await (const _ of driver.execute(wireCommand)) { /* consume */ }
  }

  // Postchecks
  if (runPostchecks && op.postcheck.length > 0) {
    const passed = await this.evaluateDataTransformChecks(
      op.postcheck, adapter, driver, filterEvaluator,
    );
    if (!passed) {
      return runnerFailure('POSTCHECK_FAILED', ...);
    }
  }

  return undefined;
}
```

This mirrors the DDL operation's execution flow exactly: idempotency check (postchecks) → precheck → execute → postcheck.

### DML execution via adapter + driver

The runner's `MongoRunnerDependencies` drops `dmlExecutor` and adds `adapter` + `driver`:

```typescript
interface MongoRunnerDependencies {
  readonly commandExecutor: MongoDdlCommandVisitor<Promise<void>>;
  readonly inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>;
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
  readonly markerOps: MarkerOperations;
}
```

Both `check` evaluation and `run` execution go through `adapter.lower(plan)` → `driver.execute(wireCommand)`.

The `MongoDmlExecutor` interface and `MongoDbDmlExecutor` class are deleted entirely.

#### Adapter extension for raw commands

The `MongoAdapter` currently lowers `MongoQueryPlan` to `AnyMongoWireCommand`. The data transform introduces raw command kinds (`rawUpdateMany`, `rawInsertOne`, etc.) that don't exist in the current adapter lowering path. The adapter needs to handle these — mapping `rawUpdateMany` AST → `updateMany` wire command, etc. This is a straightforward extension: each raw command kind maps 1:1 to a wire command kind.

### Updated `dataTransform` factory

The factory's signature changes to produce the new structure:

```typescript
function dataTransform(
  name: string,
  options: {
    check: {
      source: (() => MongoQueryPlan | Buildable | TodoMarker);
      filter?: MongoFilterExpr;
      expect?: 'exists' | 'notExists';
      description?: string;
    };
    run: (() => MongoQueryPlan | Buildable | TodoMarker) | MongoQueryPlan | Buildable;
  },
): MongoDataTransformOperation
```

- `check.source` — closure returning the query plan (same as current `check`)
- `check.filter` — optional client-side filter (defaults to a match-all if omitted)
- `check.expect` — defaults to `'exists'` (meaning "if matching documents exist, violations remain — run the transform")
- `check.description` — optional human-readable label
- The factory populates both `precheck` and `postcheck` from the same `check` config, since the typical pattern is "the same check serves as both idempotency check and success verification"
- Omitting `check` entirely produces empty `precheck`/`postcheck` arrays (always run, no idempotency — equivalent to old `check: false`)

### Serialization

`MongoDataTransformCheck` serializes and deserializes using the existing patterns:

- `source` serializes as a `MongoQueryPlan` JSON (already handled by `deserializeMongoQueryPlan`)
- `filter` serializes as a `MongoFilterExpr` JSON (already handled by `deserializeFilterExpr`)
- `expect` serializes as a string literal
- `description` serializes as a string

The `DataTransformOperationJson` arktype schema changes to:

```typescript
const DataTransformCheckJson = type({
  description: 'string',
  source: 'Record<string, unknown>',  // MongoQueryPlan JSON
  filter: 'Record<string, unknown>',  // MongoFilterExpr JSON
  expect: '"exists" | "notExists"',
});

const DataTransformOperationJson = type({
  id: 'string',
  label: 'string',
  operationClass: '"data"',
  name: 'string',
  precheck: 'Record<string, unknown>[]',
  run: 'Record<string, unknown>[]',
  postcheck: 'Record<string, unknown>[]',
});
```

### Updated spec example

The migration authoring example becomes:

```typescript
dataTransform("backfill-status", {
  check: {
    source: () => agg.from('users')
      .match((f) => f.status.exists(false))
      .limit(1),
    expect: 'exists',  // "if violations exist, run the transform"
  },
  run: () => raw.collection('users')
    .updateMany({ status: { $exists: false } }, { $set: { status: "active" } }),
})
```

For an always-run transform (no idempotency check), omit `check`:

```typescript
dataTransform("seed-defaults", {
  run: () => raw.collection('config')
    .insertOne({ key: 'version', value: '1.0' }),
})
```

## Summary of changes

| What | Before | After |
|---|---|---|
| Data transform check type | `MongoQueryPlan \| boolean` | `MongoDataTransformCheck` (structured, mirrors `MongoMigrationCheck`) |
| Check fields | `check` (single) | `precheck` + `postcheck` (arrays, matching DDL) |
| Check evaluation | Implicit "empty = done" | Explicit `expect: 'exists' \| 'notExists'` |
| Client-side filter | None | `filter: MongoFilterExpr` (same as DDL) |
| Boolean shortcuts | `check: true/false` | Removed — empty arrays = always run; always-skip = don't include the op |
| DML execution | `MongoDmlExecutor` (bespoke) | `MongoAdapter.lower()` → `MongoDriver.execute()` |
| Runner dependencies | `dmlExecutor: MongoDmlExecutor` | `adapter: MongoAdapter` + `driver: MongoDriver` |
| `MongoDbDmlExecutor` | New class in adapter-mongo | Deleted |
| `MongoDmlExecutor` interface | New interface in target-mongo | Deleted |

## Files affected

| File | Change |
|---|---|
| `packages/2-mongo-family/4-query/query-ast/src/migration-operation-types.ts` | Add `MongoDataTransformCheck`; update `MongoDataTransformOperation` to use `precheck`/`postcheck` |
| `packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts` | Update `dataTransform` factory signature and output |
| `packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts` | Remove `MongoDmlExecutor`; add `evaluateDataTransformChecks`; update `executeDataTransform`; update `MongoRunnerDependencies` |
| `packages/3-mongo-target/1-mongo-target/src/core/mongo-ops-serializer.ts` | Update data transform (de)serialization for new check structure |
| `packages/3-mongo-target/1-mongo-target/src/exports/control.ts` | Remove `MongoDmlExecutor` export; add `MongoDataTransformCheck` export |
| `packages/3-mongo-target/2-mongo-adapter/src/core/dml-executor.ts` | Delete entirely |
| `packages/3-mongo-target/2-mongo-adapter/src/core/runner-deps.ts` | Wire `MongoAdapter` + `MongoDriver` instead of `MongoDbDmlExecutor` |
| `packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts` | Remove `MongoDbDmlExecutor` export |
| `packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts` | Extend `MongoAdapter` to handle raw command lowering (or add lowering in the existing adapter impl) |
| Tests: `data-transform.test.ts`, `mongo-ops-serializer.dml.test.ts`, `mongo-runner.test.ts`, `migration-e2e.test.ts` | Update for new check structure and adapter+driver execution |
