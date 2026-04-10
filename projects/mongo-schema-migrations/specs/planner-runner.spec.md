# Planner + Runner Design

The **planner** compares desired state (a destination contract) against current state (a schema IR derived from the origin contract) and produces a list of migration operations — each containing DDL commands and pre/postchecks. The **runner** executes those operations against a live MongoDB database in a generic three-phase loop. This document covers both components.

## A migration, end to end

Before any abstractions, here's one concrete migration from start to finish.

**Starting state.** Contract v1 describes a `users` collection with no indexes. The database matches — `_prisma_migrations` has a marker whose `coreHash` equals v1's hash.

**Destination state.** Contract v2 adds a unique index on `email`.

**Planner.** The CLI calls `TargetMigrationsCapability.createPlanner()` and passes it:

- `schema` (origin): the schema IR derived from contract v1 — a `users` collection, no indexes.
- `contract` (destination): contract v2.

The planner converts the destination contract into a second schema IR, then diffs the two structurally:

- `users` exists in both IRs → not a new collection.
- Index `{ email: 1, unique: true }` exists in the destination but not the origin → emit a `createIndex` operation.

The planner returns a `MigrationPlan` containing one operation with a precheck (index does not already exist), an execute step (`CreateIndexCommand`), and a postcheck (unique index exists). See [Operation Design](operation-ast.spec.md) for the full operation structure, DDL command AST, and check assertion format.

**Runner.** The CLI calls `TargetMigrationsCapability.createRunner()` and passes the plan plus a Mongo driver instance. The runner:

1. Reads the marker from `_prisma_migrations` — the marker's `coreHash` matches the plan's origin hash. Proceed.
2. Deserializes the plan's operations from JSON (reconstructing DDL command and filter expression AST nodes).
3. For the single operation, runs the three-phase loop:
   - **Idempotency probe**: evaluates the postcheck filter against `listIndexes('users')` results. No matching index → not yet applied, proceed.
   - **Precheck**: evaluates the precheck filter. No matching index → precondition satisfied.
   - **Execute**: dispatches `CreateIndexCommand` → calls `db.collection('users').createIndex({ email: 1 }, { unique: true })`.
   - **Postcheck**: evaluates the postcheck filter. Index now exists with `unique: true` → postcondition satisfied.
4. Updates the marker via compare-and-swap: `findOneAndUpdate({ _id: 'marker', coreHash: v1Hash }, { $set: { coreHash: v2Hash } })`. The CAS succeeds.
5. Writes a ledger entry recording the edge from v1 → v2.

The database now has the index. The marker reflects v2. The ledger has a permanent record.

## Decisions

- **Structural index matching.** The planner compares indexes by keys and options, not by name. Two indexes are "the same" if they cover the same fields with the same direction and the same options (unique, sparse, TTL, partial filter). Names are ignored.
- **Generic three-phase runner.** The runner executes the same loop for every operation: evaluate prechecks → execute commands → evaluate postchecks. It does not dispatch by operation kind. This mirrors the SQL runner's loop exactly.
- **Filter-expression checks.** Pre/postchecks use `MongoFilterExpr` — the same filter expression AST from `@prisma-next/mongo-query-ast` — evaluated client-side against inspection command results. No purpose-built check vocabulary.
- **Compare-and-swap marker.** Concurrency safety comes from a CAS on the marker document — no advisory locks, no distributed locking. If two runners race, one wins and the other gets a hash mismatch.
- **Single `_prisma_migrations` collection.** Both the marker (singleton, `_id: 'marker'`) and the ledger (append-only entries) live in the same collection.

## Architecture overview

```
CLI (migration plan)                     CLI (migration apply)
       │                                        │
       ▼                                        ▼
TargetMigrationsCapability                TargetMigrationsCapability
  .createPlanner(family)                    .createRunner(family)
  .contractToSchema(from)                         │
       │                                          ▼
       ▼                                  MongoMigrationRunner
MongoMigrationPlanner                       .execute(plan, driver)
  .plan(contract, schema, policy)                 │
       │                                          ├─ read marker (CAS check)
       ▼                                          ├─ deserialize ops (JSON → AST)
       MigrationPlannerResult                     ├─ for each op: precheck → execute → postcheck
       (success → MigrationPlan)                  │     ├─ evaluate checks (filter expressions)
       (failure → conflicts[])                    │     └─ dispatch DDL commands
                                                  ├─ update marker (CAS)
                                                  └─ write ledger entry
```

## Planner

### Interface

```typescript
class MongoMigrationPlanner implements MigrationPlanner<'mongo', 'mongo'> {
  plan(options: {
    readonly contract: MongoContract;
    readonly schema: MongoSchemaIR;
    readonly policy: MigrationOperationPolicy;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
  }): MigrationPlannerResult;
}
```

- `contract` — the **destination** contract (desired state)
- `schema` — the **origin** schema IR (current state, from `contractToSchema(fromContract)`)
- `policy` — which operation classes are allowed (`additive`, `widening`, `destructive`)
- `frameworkComponents` — active components (target, adapter, extension packs)

### Diffing algorithm

The planner converts the destination contract into a schema IR, then diffs the two IRs collection by collection.

```
1. Build destination IR from contract.storage.collections
2. For each collection in destination IR:
   a. If collection not in origin → createCollection (additive)
   b. Diff indexes: origin vs destination
      - In destination but not in origin → createIndex (additive)
      - In origin but not in destination → dropIndex (destructive)
      - In both → no-op (identity match)
   c. Diff validator: origin vs destination
      - Changed → updateValidator (widening or destructive)
   d. Diff options: origin vs destination
      - Changed → updateCollectionOptions (varies)
3. For each collection in origin but not in destination:
   → dropCollection (destructive)
4. Policy gate: filter operations by allowed classes
   - If disallowed operations exist → return failure with conflicts
5. Return success with ordered operations
```

### Operation construction

The planner uses convenience functions that compose DDL commands and checks into `MongoMigrationPlanOperation` structures:

```typescript
function planCreateIndex(
  collection: string,
  keys: ReadonlyArray<MongoIndexKey>,
  options: { unique?: boolean; sparse?: boolean; expireAfterSeconds?: number; partialFilterExpression?: Record<string, unknown> },
): MongoMigrationPlanOperation {
  const name = defaultMongoIndexName(keys);
  const keyFilter = MongoFieldFilter.eq('key', keysToKeySpec(keys));
  const fullFilter = options.unique
    ? MongoAndExpr.of([keyFilter, MongoFieldFilter.eq('unique', true)])
    : keyFilter;

  return {
    id: buildIndexOpId('create', collection, keys),
    label: `Create index on ${collection} (${formatKeys(keys)})`,
    operationClass: 'additive',
    precheck: [{
      description: `index does not already exist on ${collection}`,
      source: new ListIndexesCommand(collection),
      filter: keyFilter,
      expect: 'notExists',
    }],
    execute: [{
      description: `create index on ${collection}`,
      command: new CreateIndexCommand(collection, keys, { ...options, name }),
    }],
    postcheck: [{
      description: `index exists on ${collection}`,
      source: new ListIndexesCommand(collection),
      filter: fullFilter,
      expect: 'exists',
    }],
  };
}

function planDropIndex(
  collection: string,
  keys: ReadonlyArray<MongoIndexKey>,
  indexName: string,
): MongoMigrationPlanOperation {
  const keyFilter = MongoFieldFilter.eq('key', keysToKeySpec(keys));

  return {
    id: buildIndexOpId('drop', collection, keys),
    label: `Drop index on ${collection} (${formatKeys(keys)})`,
    operationClass: 'destructive',
    precheck: [{
      description: `index exists on ${collection}`,
      source: new ListIndexesCommand(collection),
      filter: keyFilter,
      expect: 'exists',
    }],
    execute: [{
      description: `drop index on ${collection}`,
      command: new DropIndexCommand(collection, indexName),
    }],
    postcheck: [{
      description: `index no longer exists on ${collection}`,
      source: new ListIndexesCommand(collection),
      filter: keyFilter,
      expect: 'notExists',
    }],
  };
}
```

### Index diffing (detail)

Indexes are matched by structural equivalence (not by name). The planner builds lookup sets for O(1) comparison, following the SQL planner's `SchemaTableLookup` pattern:

```typescript
interface CollectionIndexLookup {
  readonly indexKeys: Set<string>;
}

function buildIndexLookupKey(index: MongoSchemaIndex): string {
  const keys = index.keys.map(k => `${k.field}:${k.direction}`).join(',');
  const opts = [
    index.unique ? 'unique' : '',
    index.sparse ? 'sparse' : '',
    index.expireAfterSeconds != null ? `ttl:${index.expireAfterSeconds}` : '',
    index.partialFilterExpression ? `pfe:${canonicalize(index.partialFilterExpression)}` : '',
  ].filter(Boolean).join(';');
  return opts ? `${keys}|${opts}` : keys;
}
```

Two indexes are equivalent if they produce the same lookup key. This captures all structurally significant properties while ignoring names.

### Operation ordering

Operations are emitted in a deterministic order:

1. **Collection creates** (additive) — new collections first, so indexes on them can be created
2. **Index drops** (destructive) — drop obsolete indexes before creating replacements
3. **Index creates** (additive) — new indexes
4. **Validator updates** — after structural changes
5. **Collection option updates** — after structural changes
6. **Collection drops** (destructive) — last, most destructive

Within each category, operations are ordered lexicographically by collection name, then by index key specification. This ensures deterministic plans.

### Conflict detection

The planner detects conflicts before producing operations:

- **Policy violation**: destructive operations when policy only allows additive → conflict
- **Unsupported transitions**: capped → non-capped collection (MongoDB doesn't support this via `collMod`) → conflict with guidance

Conflicts are returned as `MigrationPlannerConflict` with `kind`, `summary`, and optional `why` explaining the issue and suggesting a remedy.

### Validator diff classification

- **Relaxing** (widening): removing required fields, making strict → moderate, removing the validator entirely
- **Tightening** (destructive): adding required fields, adding type constraints, making moderate → strict
- **Policy change only** (widening): changing `validationAction` from `error` to `warn`

The planner classifies each validator change by comparing the old and new `$jsonSchema`. For M2, a conservative approach: any structural change to the `$jsonSchema` body is treated as destructive unless it's strictly a subset removal.

## Runner

### Interface

```typescript
class MongoMigrationRunner implements MigrationRunner<'mongo', 'mongo'> {
  async execute(options: {
    readonly plan: MigrationPlan;
    readonly driver: ControlDriverInstance<'mongo', 'mongo'>;
    readonly destinationContract: MongoContract;
    readonly policy: MigrationOperationPolicy;
    readonly callbacks?: {
      onOperationStart?(op: MigrationPlanOperation): void;
      onOperationComplete?(op: MigrationPlanOperation): void;
    };
    readonly executionChecks?: MigrationRunnerExecutionChecks;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
  }): Promise<MigrationRunnerResult>;
}
```

### Execution flow

```
1. Deserialize operations from plan (JSON → MongoMigrationPlanOperation[])
2. Read marker from _prisma_migrations collection
3. Validate marker matches plan.origin (if origin is set)
   - If mismatch → return failure (contract/hash-mismatch)
   - If origin is null (db update mode) → skip validation
4. For each operation:
   a. Notify callback: onOperationStart
   b. If executionChecks.postchecks && executionChecks.idempotencyChecks:
      - Evaluate all postcheck filters against inspection results
      - If ALL postchecks already satisfied → skip (already applied)
   c. If executionChecks.prechecks:
      - Evaluate all precheck filters against inspection results
      - If any fails → return failure (PRECHECK_FAILED)
   d. For each execute step:
      - Dispatch the DDL command to the command executor
   e. If executionChecks.postchecks:
      - Evaluate all postcheck filters against inspection results
      - If any fails → return failure (POSTCHECK_FAILED)
   f. Notify callback: onOperationComplete
5. Update marker via compare-and-swap
6. Write ledger entry
7. Return success with operation counts
```

This is structurally identical to the SQL runner's `applyPlan` loop. The only difference is the execution substrate: SQL runs SQL strings, Mongo dispatches DDL command AST nodes and evaluates filter expressions.

### Command executor

The command executor is a `MongoDdlCommandVisitor<Promise<void>>` that maps each DDL command AST node to a MongoDB driver call via visitor dispatch. The runner calls `command.accept(executor)` — no switch statement needed. DDL command kinds and visitor interface are defined in [Operation Design](operation-ast.spec.md) and [DDL command dispatch](ddl-command-dispatch.spec.md).

| Visitor method     | MongoDB driver call                                  |
|--------------------|------------------------------------------------------|
| `createIndex`      | `collection.createIndex(keySpec, options)`            |
| `dropIndex`        | `collection.dropIndex(name)`                         |
| `createCollection` | `db.createCollection(name, options)` (M2)            |
| `dropCollection`   | `collection.drop()` (M2)                             |
| `collMod`          | `db.command({ collMod: name, validator: ..., ... })` (M2) |

Adding a new DDL command kind forces a new visitor method — compile-time safety ensures the executor handles every command. The same visitor pattern is used for the CLI command formatter (see [CLI display design](cli-display.spec.md)).

### Inspection command executor

The inspection command executor is a `MongoInspectionCommandVisitor<Promise<Document[]>>` that runs inspection commands against the database and returns result documents. The runner calls `check.source.accept(inspectionExecutor)` to retrieve the result set for filter evaluation.

| Visitor method     | MongoDB driver call                                  |
|--------------------|------------------------------------------------------|
| `listIndexes`      | `collection.listIndexes().toArray()`                 |
| `listCollections`  | `db.listCollections().toArray()`                     |

### Check evaluation

The runner evaluates checks by running the inspection command (`listIndexes`, `listCollections`) against the database, then applying the check's `MongoFilterExpr` to each result document using a client-side filter evaluator. The expectation (`exists` = at least one match, `notExists` = no matches) determines whether the check passes.

The `FilterEvaluator` is a client-side `MongoFilterVisitor<boolean>` that evaluates filter expressions against in-memory JavaScript objects. It supports core comparison operators (`$eq`, `$ne`, `$gt`, `$lt`, `$in`), logical combinators (`$and`, `$or`, `$not`), field existence (`$exists`), dotted field paths, and recursive deep equality for embedded documents. See [Check Evaluator design](check-evaluator.spec.md) for the full evaluator implementation, operator semantics, and testing strategy.

### Idempotency

If all postchecks are already satisfied before execution, the operation is skipped. This means re-running `migration apply` after a partial failure is safe — already-applied operations are detected and skipped via their postchecks.

This is identical to the SQL runner's idempotency probe, which checks if all postcheck SQL already returns `true` before executing.

## Marker and ledger

The `_prisma_migrations` collection is the runner's durable state. It stores two kinds of documents: a single **marker** that records the current schema hash, and append-only **ledger** entries that record the history of applied migrations.

### Collection structure

```
_prisma_migrations
├── { _id: "marker", coreHash: "sha256:...", profileHash: "sha256:...", updatedAt: ISODate, meta: {} }
├── { _id: ObjectId, type: "ledger", edgeId: "...", from: "sha256:...", to: "sha256:...", appliedAt: ISODate }
├── { _id: ObjectId, type: "ledger", edgeId: "...", from: "sha256:...", to: "sha256:...", appliedAt: ISODate }
└── ...
```

### Read marker

```typescript
async function readMarker(db: Db): Promise<ContractMarkerRecord | null> {
  const doc = await db.collection('_prisma_migrations').findOne({ _id: 'marker' });
  if (!doc) return null;
  return { coreHash: doc.coreHash, profileHash: doc.profileHash, ... };
}
```

### Write marker (compare-and-swap)

```typescript
async function updateMarker(
  db: Db,
  expectedFrom: string,
  destination: { coreHash: string; profileHash: string },
): Promise<boolean> {
  const result = await db.collection('_prisma_migrations').findOneAndUpdate(
    { _id: 'marker', coreHash: expectedFrom },
    {
      $set: {
        coreHash: destination.coreHash,
        profileHash: destination.profileHash,
        updatedAt: new Date(),
      },
    },
    { upsert: false },
  );
  return result !== null;
}
```

If the `findOneAndUpdate` returns `null`, the marker was changed by another process (CAS failure). The runner reports `contract/hash-mismatch`.

### Initial marker (first migration)

```typescript
async function initMarker(
  db: Db,
  destination: { coreHash: string; profileHash: string },
): Promise<void> {
  await db.collection('_prisma_migrations').insertOne({
    _id: 'marker',
    coreHash: destination.coreHash,
    profileHash: destination.profileHash,
    updatedAt: new Date(),
    meta: {},
  });
}
```

### Ledger

```typescript
async function writeLedgerEntry(
  db: Db,
  entry: { edgeId: string; from: string; to: string },
): Promise<void> {
  await db.collection('_prisma_migrations').insertOne({
    type: 'ledger',
    edgeId: entry.edgeId,
    from: entry.from,
    to: entry.to,
    appliedAt: new Date(),
  });
}
```

The ledger is append-only. Each entry records a directed edge from one contract hash to another, forming a history of applied migrations.

### Why no advisory locks

MongoDB operations (`createIndex`, `collMod`, `createCollection`) have their own atomicity guarantees. The compare-and-swap on the marker document provides sufficient concurrency protection for the marker update. If two runners race, one will succeed and the other will get a CAS failure and report `contract/hash-mismatch`.

This is simpler than Postgres's advisory lock approach and sufficient for the migration use case where concurrent applies are rare and detectable.

## Wiring

The Mongo adapter descriptor gains a `migrations` property that plugs the planner and runner into the framework:

```typescript
const mongoTargetDescriptor: MongoControlTargetDescriptor = {
  ...mongoTargetDescriptorMeta,
  migrations: {
    createPlanner(_family: MongoControlFamilyInstance) {
      return new MongoMigrationPlanner() as MigrationPlanner<'mongo', 'mongo'>;
    },
    createRunner(_family: MongoControlFamilyInstance) {
      return new MongoMigrationRunner() as MigrationRunner<'mongo', 'mongo'>;
    },
    contractToSchema(contract, _frameworkComponents) {
      return contractToMongoSchemaIR(contract as MongoContract | null);
    },
  },
  create(): ControlTargetInstance<'mongo', 'mongo'> {
    return { familyId: 'mongo', targetId: 'mongo' };
  },
};
```

This is the same shape as `postgresTargetDescriptor.migrations` in `packages/3-targets/3-targets/postgres/src/exports/control.ts`.

### Package placement

- **Planner**: `packages/3-mongo-target/` (target-specific, implements the framework interface)
- **Runner**: `packages/3-mongo-target/` (target-specific, uses the Mongo driver)
- **Command executor**: `packages/3-mongo-target/` (maps DDL commands to driver calls)
- **Check evaluator**: `packages/3-mongo-target/` (evaluates filter expressions client-side)
- **Marker/ledger I/O**: `packages/3-mongo-target/` (part of the runner, uses the Mongo driver)
- **Op deserializer**: `packages/3-mongo-target/` (reconstructs AST nodes from JSON)

All concretions live in the target, consistent with how Postgres puts its planner and runner under `packages/3-targets/3-targets/postgres/src/core/migrations/`.

## Testing strategy

- **Planner**: unit tests with hand-crafted contracts and schema IRs. Cover add/drop/no-op/identity for indexes, validators, options. Cover policy gating and conflict detection. Verify that generated operations have correct precheck/execute/postcheck arrays.
- **Command executor**: unit tests verifying each DDL command kind maps to the correct MongoDB driver call.
- **Check evaluator**: unit tests with hand-crafted inspection results and filter expressions. See [Check Evaluator design](check-evaluator.spec.md).
- **Runner**: integration tests with `mongodb-memory-server`. Cover each operation kind, idempotency (re-apply), CAS on marker, ledger writes.
- **End-to-end**: integration tests through the CLI command surface. Hand-crafted contracts → `migration plan` → `migration apply` → verify MongoDB state.

## Alternatives considered

**CAS instead of advisory locks.** MongoDB has no native advisory lock primitive equivalent to Postgres's `pg_advisory_lock`. We could simulate one with a lock document and TTL, but that adds complexity (lock expiry, stale lock cleanup, retry loops) for a scenario — concurrent `migration apply` — that is rare in practice. CAS on the marker is simpler: the `findOneAndUpdate` with the expected `coreHash` in the filter atomically detects races. The losing runner gets a clean `contract/hash-mismatch` error and can retry.

**Single collection instead of separate marker + ledger collections.** The marker is one document; the ledger is a modest number of append-only documents. Splitting them into two collections would mean two collections to create, two to query, and two to reason about during setup and introspection — with no meaningful benefit. A single `_prisma_migrations` collection is simpler to provision, easier to inspect (`db._prisma_migrations.find()`), and mirrors the single-table pattern Postgres uses for its migration metadata.

**Structural index matching instead of name-based.** MongoDB auto-generates index names from keys (e.g. `email_1`), and users can override them. If we matched by name, renaming an index would appear as a drop + create, potentially causing downtime on a large collection. Structural matching — comparing keys, direction, and options — reflects the actual behavior of the index. Two indexes with different names but identical keys and options are functionally identical, and the planner correctly treats them as a no-op. The trade-off is that intentional name changes require a manual migration, but that's a rare operation and a reasonable cost.

**Visitor dispatch on operations instead of generic three-phase loop.** An earlier design had each migration operation as its own class with a visitor interface. The runner would call `op.accept(executor)` and dispatch to a per-operation handler. We chose the generic loop because it makes the runner structurally identical to the SQL runner, makes pre/postchecks data (not behavior), and means adding a new DDL command requires only a new case in the command executor — not a new operation class, visitor method, and deserializer branch.

**Purpose-built check DSL instead of filter expressions.** We could have defined check-specific types like `IndexExistsCheck`, `CollectionExistsCheck`. We chose `MongoFilterExpr` because the filter expression AST already exists, users know the syntax from MongoDB queries, and it's far more expressive than any purpose-built vocabulary. The trade-off is a client-side evaluator, which is straightforward and also useful for testing.
