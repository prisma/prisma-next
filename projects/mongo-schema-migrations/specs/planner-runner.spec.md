# Planner + Runner Design

## A migration, end to end

Before any abstractions, here's one concrete migration from start to finish.

**Starting state.** Contract v1 describes a `users` collection with no indexes. The database matches — `_prisma_migrations` has a marker whose `coreHash` equals v1's hash.

**Destination state.** Contract v2 adds a unique index on `email`.

**Planner.** The CLI calls `TargetMigrationsCapability.createPlanner()` and passes it:

- `schema` (origin): the schema IR derived from contract v1 — a `users` collection, no indexes.
- `contract` (destination): contract v2.

The planner converts the destination contract into a second schema IR, then diffs the two structurally:

- `users` exists in both IRs → not a new collection.
- Index `{ email: 1, unique: true }` exists in the destination but not the origin → emit `CreateIndexOp`.

The planner returns a `MigrationPlan` containing one operation:

```typescript
[
  CreateIndexOp({
    collection: 'users',
    keys: [{ field: 'email', direction: 1 }],
    unique: true,
  }),
]
```

**Runner.** The CLI calls `TargetMigrationsCapability.createRunner()` and passes the plan plus a Mongo driver instance. The runner:

1. Reads the marker from `_prisma_migrations` — the marker's `coreHash` matches the plan's origin hash. Proceed.
2. Deserializes the plan's operations into AST nodes.
3. Dispatches `CreateIndexOp` through the visitor. The visitor calls `db.collection('users').createIndex({ email: 1 }, { unique: true })`.
4. Updates the marker via compare-and-swap: `findOneAndUpdate({ _id: 'marker', coreHash: v1Hash }, { $set: { coreHash: v2Hash } })`. The CAS succeeds (no other runner changed it).
5. Writes a ledger entry recording the edge from v1 → v2.

The database now has the index. The marker reflects v2. The ledger has a permanent record of what happened.

## Decisions

These are the key design choices. Each is elaborated in the sections below and justified in "Alternatives considered" at the end.

- **Structural index matching.** The planner compares indexes by keys and options, not by name. Two indexes are "the same" if they cover the same fields with the same direction and the same options (unique, sparse, TTL, partial filter). Names are ignored.
- **Visitor dispatch.** The runner dispatches operations through a typed visitor (`MongoMigrationOpVisitor`), not a switch statement. Each operation kind maps to exactly one visitor method.
- **Compare-and-swap marker.** Concurrency safety comes from a CAS on the marker document — no advisory locks, no distributed locking. If two runners race, one wins and the other gets a hash mismatch.
- **Single `_prisma_migrations` collection.** Both the marker (singleton, `_id: 'marker'`) and the ledger (append-only entries) live in the same collection. Fewer moving parts.

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
       ▼                                          ├─ deserialize ops → AST
       MigrationPlannerResult                     ├─ dispatch via visitor
       (success → MigrationPlan)                  ├─ execute MongoDB commands
       (failure → conflicts[])                    ├─ update marker (CAS)
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
1. Deserialize operations from plan (JSON → AST nodes)
2. Read marker from _prisma_migrations collection
3. Validate marker matches plan.origin (if origin is set)
   - If mismatch → return failure (contract/hash-mismatch)
   - If origin is null (db update mode) → skip validation
4. For each operation:
   a. Notify callback: onOperationStart
   b. If executionChecks.prechecks:
      - Run precheck (e.g., does index already exist?)
   c. If executionChecks.idempotencyChecks:
      - Run postcheck — if already satisfied, skip execution
   d. Execute the MongoDB command
   e. If executionChecks.postchecks:
      - Run postcheck (e.g., does index now exist?)
      - If failed → return failure (postcondition/failed)
   f. Notify callback: onOperationComplete
5. Update marker via compare-and-swap
6. Write ledger entry
7. Return success with operation counts
```

### Operation dispatch (visitor)

The runner implements `MongoMigrationOpVisitor<Promise<void>>`:

```typescript
class MongoOpExecutor implements MongoMigrationOpVisitor<Promise<void>> {
  constructor(private readonly db: Db) {}

  async createIndex(op: CreateIndexOp): Promise<void> {
    const keySpec: Record<string, number | string> = {};
    for (const key of op.keys) {
      keySpec[key.field] = key.direction;
    }
    const options: CreateIndexesOptions = {};
    if (op.unique) options.unique = true;
    if (op.sparse) options.sparse = true;
    if (op.expireAfterSeconds != null) options.expireAfterSeconds = op.expireAfterSeconds;
    if (op.partialFilterExpression) options.partialFilterExpression = op.partialFilterExpression;
    if (op.indexName) options.name = op.indexName;

    await this.db.collection(op.collection).createIndex(keySpec, options);
  }

  async dropIndex(op: DropIndexOp): Promise<void> {
    const name = op.indexName ?? defaultMongoIndexName(op.collection, op.keys);
    await this.db.collection(op.collection).dropIndex(name);
  }

  async createCollection(op: CreateCollectionOp): Promise<void> { ... }
  async dropCollection(op: DropCollectionOp): Promise<void> { ... }
  async updateValidator(op: UpdateValidatorOp): Promise<void> { ... }
  async updateCollectionOptions(op: UpdateCollectionOptionsOp): Promise<void> { ... }
}
```

### Pre/post checks (idempotency)

Each operation kind has its own pre and post checks:

| Operation | Precheck | Postcheck |
|-----------|----------|-----------|
| `createIndex` | Index does not exist | Index exists |
| `dropIndex` | Index exists | Index does not exist |
| `createCollection` | Collection does not exist | Collection exists |
| `dropCollection` | Collection exists | Collection does not exist |
| `updateValidator` | — | Validator matches expected |
| `updateCollectionOptions` | — | Options match expected |

"Index exists" is checked via `collection.listIndexes()` and structural comparison (same keys + options). "Collection exists" is checked via `db.listCollections({ name })`.

**Idempotency**: if the postcheck is already satisfied before execution, the operation is skipped. This means re-running `migration apply` after a partial failure is safe — already-applied operations are detected and skipped.

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
- **Marker/ledger I/O**: `packages/3-mongo-target/` (part of the runner, uses the Mongo driver)
- **Op deserializer**: `packages/3-mongo-target/` (runner-specific)

All concretions live in the target, consistent with how Postgres puts its planner and runner under `packages/3-targets/3-targets/postgres/src/core/migrations/`.

## Testing strategy

- **Planner**: unit tests with hand-crafted contracts and schema IRs. Cover add/drop/no-op/identity for indexes, validators, options. Cover policy gating and conflict detection.
- **Runner**: integration tests with `mongodb-memory-server`. Cover each operation kind, idempotency (re-apply), CAS on marker, ledger writes.
- **End-to-end**: integration tests through the CLI command surface. Hand-crafted contracts → `migration plan` → `migration apply` → verify MongoDB state.

## Alternatives considered

**CAS instead of advisory locks.** MongoDB has no native advisory lock primitive equivalent to Postgres's `pg_advisory_lock`. We could simulate one with a lock document and TTL, but that adds complexity (lock expiry, stale lock cleanup, retry loops) for a scenario — concurrent `migration apply` — that is rare in practice. CAS on the marker is simpler: the `findOneAndUpdate` with the expected `coreHash` in the filter atomically detects races. The losing runner gets a clean `contract/hash-mismatch` error and can retry.

**Single collection instead of separate marker + ledger collections.** The marker is one document; the ledger is a modest number of append-only documents. Splitting them into two collections would mean two collections to create, two to query, and two to reason about during setup and introspection — with no meaningful benefit. A single `_prisma_migrations` collection is simpler to provision, easier to inspect (`db._prisma_migrations.find()`), and mirrors the single-table pattern Postgres uses for its migration metadata.

**Structural index matching instead of name-based.** MongoDB auto-generates index names from keys (e.g. `email_1`), and users can override them. If we matched by name, renaming an index would appear as a drop + create, potentially causing downtime on a large collection. Structural matching — comparing keys, direction, and options — reflects the actual behavior of the index. Two indexes with different names but identical keys and options are functionally identical, and the planner correctly treats them as a no-op. The trade-off is that intentional name changes require a manual migration, but that's a rare operation and a reasonable cost.
