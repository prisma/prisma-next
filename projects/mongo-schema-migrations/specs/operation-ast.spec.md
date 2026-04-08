# Operation AST + JSON Serialization Design

## Grounding example

You add a unique index on `users.email`. The planner diffs the origin schema IR against the destination contract and produces a `CreateIndexOp`:

```typescript
const op = new CreateIndexOp({
  collection: 'users',
  keys: [{ field: 'email', direction: 1 }],
  unique: true,
});
```

The framework serializes the operation array to `ops.json` via `JSON.stringify`. Because every property on the frozen AST node is plain JSON-serializable data, the output is:

```json
[
  {
    "kind": "createIndex",
    "id": "index.users.create(email:1)",
    "label": "Create index on users (email ascending)",
    "operationClass": "additive",
    "collection": "users",
    "keys": [{ "field": "email", "direction": 1 }],
    "unique": true
  }
]
```

At apply time, the runner loads `ops.json`, passes the plain JSON objects through a deserializer that reconstructs live AST nodes, and dispatches each one via visitor:

```typescript
op.accept(executor);
// executor.createIndex(op) calls:
//   db.users.createIndex({ email: 1 }, { unique: true })
```

That's the full lifecycle — planner produces AST nodes, they serialize naturally to JSON, the runner deserializes them back to AST nodes and dispatches via visitor. The rest of this doc explains the design decisions behind each step.

## Key decisions

1. **Class-per-operation.** Each MongoDB command gets its own class (`CreateIndexOp`, `DropIndexOp`, etc.) with typed fields specific to that command. This is unlike the SQL migration system, which uses generic step arrays of SQL strings.

2. **Visitor dispatch.** The runner calls `op.accept(executor)`, which dispatches to `executor.createIndex(this)` or `executor.dropIndex(this)` etc. This avoids `switch(op.kind)` in the runner and gives the type system exhaustiveness checking.

3. **Natural JSON serialization.** All operation properties are JSON-serializable primitives, arrays, or plain objects. No custom serializer is needed — `JSON.stringify` produces the persisted format directly, and a deserializer reconstructs class instances on the read path.

## Why class-per-operation

SQL migrations use a flat structure with step arrays:

```typescript
interface SqlMigrationPlanOperation {
  id: string;
  label: string;
  operationClass: MigrationOperationClass;
  target: PostgresPlanTargetDetails;
  precheck: SqlMigrationPlanOperationStep[];   // { description, sql }
  execute: SqlMigrationPlanOperationStep[];     // { description, sql }
  postcheck: SqlMigrationPlanOperationStep[];   // { description, sql }
}
```

This works because every SQL operation is fundamentally "execute this SQL string." The step is the unit of execution, and the operation is just an envelope.

MongoDB commands are structurally different from each other — `createIndex` takes keys, uniqueness flags, and TTL options; `collMod` takes a validator document and validation level; `createCollection` takes a name and options. A generic step array would lose that structure and push validation to the runner. The class-per-op design gives type safety at the runner boundary: each visitor method receives the correct concrete type with the right fields.

## Base class

```typescript
abstract class MongoMigrationOp {
  abstract readonly kind: string;

  readonly id: string;
  readonly label: string;
  readonly operationClass: MigrationOperationClass;

  abstract accept<R>(visitor: MongoMigrationOpVisitor<R>): R;

  protected freeze(): void {
    Object.freeze(this);
  }
}
```

The three envelope fields (`id`, `label`, `operationClass`) satisfy the framework's `MigrationPlanOperation` interface. This means every `MongoMigrationOp` is a valid `MigrationPlanOperation` — the framework-level CLI and migration-tools code can work with them without knowing they're Mongo-specific.

## Concrete operations

### M1: Index operations

These are fully specified — index management is the first milestone.

```typescript
class CreateIndexOp extends MongoMigrationOp {
  readonly kind = 'createIndex' as const;
  readonly collection: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;
  readonly indexName?: string;

  constructor(options: {
    collection: string;
    keys: ReadonlyArray<MongoIndexKey>;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
    partialFilterExpression?: Record<string, unknown>;
    indexName?: string;
  }) {
    super();
    this.id = buildIndexOpId('create', options.collection, options.keys);
    this.label = buildIndexOpLabel('Create', options);
    this.operationClass = 'additive';
    this.collection = options.collection;
    this.keys = options.keys;
    this.unique = options.unique ?? false;
    this.sparse = options.sparse;
    this.expireAfterSeconds = options.expireAfterSeconds;
    this.partialFilterExpression = options.partialFilterExpression;
    this.indexName = options.indexName;
    this.freeze();
  }

  accept<R>(visitor: MongoMigrationOpVisitor<R>): R {
    return visitor.createIndex(this);
  }
}

class DropIndexOp extends MongoMigrationOp {
  readonly kind = 'dropIndex' as const;
  readonly collection: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly indexName?: string;

  constructor(options: {
    collection: string;
    keys: ReadonlyArray<MongoIndexKey>;
    indexName?: string;
  }) {
    super();
    this.id = buildIndexOpId('drop', options.collection, options.keys);
    this.label = `Drop index on ${options.collection} (${formatKeys(options.keys)})`;
    this.operationClass = 'destructive';
    this.collection = options.collection;
    this.keys = options.keys;
    this.indexName = options.indexName;
    this.freeze();
  }

  accept<R>(visitor: MongoMigrationOpVisitor<R>): R {
    return visitor.dropIndex(this);
  }
}
```

### M2: Collection, validator, and options operations (sketched)

These will be fully specified when M2 begins. Shapes shown here to illustrate the pattern's extensibility.

```typescript
class CreateCollectionOp extends MongoMigrationOp {
  readonly kind = 'createCollection' as const;
  readonly collection: string;
  readonly validator?: { ... };
  readonly options?: { ... };
  // operationClass = 'additive'
}

class DropCollectionOp extends MongoMigrationOp {
  readonly kind = 'dropCollection' as const;
  readonly collection: string;
  // operationClass = 'destructive'
}

class UpdateValidatorOp extends MongoMigrationOp {
  readonly kind = 'updateValidator' as const;
  readonly collection: string;
  readonly jsonSchema: Record<string, unknown>;
  readonly validationLevel: 'strict' | 'moderate';
  readonly validationAction: 'error' | 'warn';
  // operationClass = 'widening' or 'destructive' (set by planner)
}

class UpdateCollectionOptionsOp extends MongoMigrationOp {
  readonly kind = 'updateCollectionOptions' as const;
  readonly collection: string;
  readonly changes: Record<string, unknown>;
  // operationClass depends on the change
}
```

## Union and visitor types

The discriminated union covers all operation kinds. The visitor interface has one method per kind — the type system enforces exhaustiveness at compile time.

```typescript
type AnyMongoMigrationOp =
  | CreateIndexOp
  | DropIndexOp
  | CreateCollectionOp
  | DropCollectionOp
  | UpdateValidatorOp
  | UpdateCollectionOptionsOp;

interface MongoMigrationOpVisitor<R> {
  createIndex(op: CreateIndexOp): R;
  dropIndex(op: DropIndexOp): R;
  createCollection(op: CreateCollectionOp): R;
  dropCollection(op: DropCollectionOp): R;
  updateValidator(op: UpdateValidatorOp): R;
  updateCollectionOptions(op: UpdateCollectionOptionsOp): R;
}
```

## Operation identity

Each operation has a deterministic `id` derived from its content, not from ordering or user input. For index operations:

```typescript
function buildIndexOpId(
  verb: 'create' | 'drop',
  collection: string,
  keys: ReadonlyArray<MongoIndexKey>,
): string {
  const keyStr = keys.map(k => `${k.field}:${k.direction}`).join(',');
  return `index.${collection}.${verb}(${keyStr})`;
}
```

Examples:
- `index.users.create(email:1)` — create ascending index on `users.email`
- `index.users.drop(email:1,name:-1)` — drop compound descending index
- `collection.orders.create` — create the `orders` collection
- `validator.users.update` — update the validator on `users`

## JSON serialization (ops.json)

### Write path

The framework writes `ops.json` via `JSON.stringify(ops, null, 2)`. Since `MongoMigrationOp` instances are frozen plain objects (no methods survive `JSON.stringify` — `freeze()` doesn't affect serialization), the JSON output contains all enumerable properties. The example from the grounding scenario above is the actual on-disk format.

The three envelope fields (`id`, `label`, `operationClass`) are validated by `@prisma-next/migration-tools` on read; the rest of the object is opaque to the framework. This is the existing design — no changes needed.

### Attestation

The `migrationId` hash is computed over the full canonicalized ops array (sorted keys recursively). All Mongo-specific fields are part of the content-addressed hash. This is the existing attestation behavior — no changes needed.

### Read path (deserialization)

When `migration apply` loads `ops.json`, it gets plain JSON objects, not class instances. The runner needs AST nodes (for `accept(visitor)` dispatch). A deserializer reconstructs class instances from JSON:

```typescript
function deserializeMongoOp(json: Record<string, unknown>): AnyMongoMigrationOp {
  switch (json.kind) {
    case 'createIndex':
      return new CreateIndexOp({
        collection: json.collection as string,
        keys: json.keys as ReadonlyArray<MongoIndexKey>,
        unique: json.unique as boolean | undefined,
        sparse: json.sparse as boolean | undefined,
        expireAfterSeconds: json.expireAfterSeconds as number | undefined,
        partialFilterExpression: json.partialFilterExpression as Record<string, unknown> | undefined,
        indexName: json.indexName as string | undefined,
      });
    case 'dropIndex':
      return new DropIndexOp({ ... });
    // ... other op kinds
    default:
      throw new Error(`Unknown Mongo migration op kind: ${json.kind}`);
  }
}
```

This lives in the target package (`@prisma-next/adapter-mongo` or the target package) since only the Mongo runner needs it.

**Validation**: The deserializer should validate the JSON shape before constructing the AST node. Use Arktype schemas per-op-kind to fail fast on corrupt or hand-edited `ops.json` files.

## Deterministic index naming

When creating an index, MongoDB auto-assigns a name if none is provided. For reproducibility and drop-by-name support, the planner assigns a deterministic name following the spirit of [ADR 009](../../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md):

```typescript
function defaultMongoIndexName(collection: string, keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map(k => `${k.field}_${k.direction}`).join('_');
}
```

This matches MongoDB's own default naming convention. The name is stored in `CreateIndexOp.indexName` and used by `DropIndexOp` when the runner needs to drop an index.

## Package placement

The operation AST classes and visitor interface live in the same package as the schema IR (`@prisma-next/mongo-schema-ir`) or a sibling package under `packages/2-mongo-family/` in the tooling layer, migration plane. The deserializer lives in the target package since it's runner-specific.

## Alternatives considered

### Why not step arrays like SQL?

SQL migrations model every operation as "execute this SQL string" — a flat list of steps works because the unit of execution is uniform. MongoDB commands are structurally diverse (`createIndex` vs `collMod` vs `createCollection`), and a generic step array would erase the typed structure that gives the runner compile-time safety. Class-per-op preserves the full shape of each command.

### Why not `switch(kind)` dispatch?

A `switch` statement on `op.kind` in the runner would work, but the type system can't enforce exhaustiveness across multiple consumers. The visitor pattern (`op.accept(executor)`) pushes exhaustiveness into the `MongoMigrationOpVisitor` interface — if a new op kind is added, every visitor implementation must handle it or the code won't compile.

### Why no rewriter?

Unlike query ASTs where expressions are rewritten during compilation, migration operations are produced once by the planner and consumed once by the runner. There is no rewriting step. The visitor is sufficient — the runner dispatches each op to its handler. If rewriting is needed later (e.g., for operation merging or optimization), `MongoMigrationOp` can gain `rewrite(rewriter)` following the same pattern as the query ASTs.
