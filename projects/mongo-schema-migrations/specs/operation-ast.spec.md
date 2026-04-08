# Operation AST + JSON Serialization Design

Migration operations are the output of the planner and the input of the runner. Each operation describes a single MongoDB command to execute. This doc covers the AST design, the JSON serialization format (how ops land in `ops.json`), and how the runner reconstructs live AST nodes from persisted JSON.

## Role in the migration pipeline

```
Planner diffs origin IR vs destination contract
    ↓
MongoMigrationPlanOperation[] (AST nodes)
    ↓ serialize to ops.json (JSON.stringify)
ops.json on disk (plain JSON array)
    ↓ deserialize (reconstruct AST nodes)
MongoMigrationPlanOperation[] (AST nodes)
    ↓ runner.execute() dispatches via visitor
MongoDB commands executed
```

## Design pattern

Same class-based AST pattern as the schema IR and query ASTs.

### Base class

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

### Concrete operations

#### M1: Index operations

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

#### M2: Collection, validator, and options operations

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

### Union and visitor types

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

The framework writes `ops.json` via `JSON.stringify(ops, null, 2)`. Since `MongoMigrationOp` instances are frozen plain objects (no methods survive `JSON.stringify` — `freeze()` doesn't affect serialization), the JSON output contains all enumerable properties:

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

The three envelope fields (`id`, `label`, `operationClass`) are validated by `@prisma-next/migration-tools` on read; the rest of the object is opaque to the framework. This is the existing design — no changes needed.

### Attestation

The `migrationId` hash is computed over the full canonicalized ops array (sorted keys recursively). All Mongo-specific fields are part of the content-addressed hash. This is the existing attestation behavior — no changes needed.

### Read path (deserialization)

When `migration apply` loads `ops.json`, it gets plain JSON objects, not class instances. The runner needs AST nodes (for `accept(visitor)` dispatch). A **deserializer** reconstructs class instances from JSON:

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

### Why not a rewriter on ops?

Unlike query ASTs where expressions are rewritten during compilation, migration operations are produced once by the planner and consumed once by the runner. There is no rewriting step. The visitor is sufficient — the runner dispatches each op to its handler. If rewriting is needed later (e.g., for operation merging or optimization), `MongoMigrationOp` can gain `rewrite(rewriter)` following the same pattern as the query ASTs.

## Relationship to `SqlMigrationPlanOperation`

SQL uses a flat structure with step arrays:

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

Mongo uses discrete classes per operation kind instead of generic "step" arrays. This is because MongoDB commands are structurally different from each other (`createIndex` vs `collMod` vs `createCollection`), while SQL operations are all "execute this SQL string." The class-per-op design gives type safety at the runner — each visitor method receives the correct concrete type with the right fields.

## `indexName` — deterministic naming

When creating an index, MongoDB auto-assigns a name if none is provided. For reproducibility and drop-by-name support, the planner assigns a deterministic name following the spirit of [ADR 009](../../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md):

```typescript
function defaultMongoIndexName(collection: string, keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map(k => `${k.field}_${k.direction}`).join('_');
}
```

This matches MongoDB's own default naming convention. The name is stored in `CreateIndexOp.indexName` and used by `DropIndexOp` when the runner needs to drop an index.

## Package placement

The operation AST classes and visitor interface live in the same package as the schema IR (`@prisma-next/mongo-schema-ir`) or a sibling package under `packages/2-mongo-family/` in the tooling layer, migration plane. The deserializer lives in the target package since it's runner-specific.
