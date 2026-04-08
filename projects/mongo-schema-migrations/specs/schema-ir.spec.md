# MongoSchemaIR Design

## What we're modeling

A MongoDB `users` collection has a unique ascending index on `email` and a compound index on `{ lastName: 1, firstName: 1 }`. The `orders` collection has a TTL index that expires documents after 24 hours. We need a representation of this server-side state that the planner can diff.

Here is the concrete IR for that scenario:

```typescript
const ir: MongoSchemaIR = {
  collections: {
    users: new MongoSchemaCollection({
      name: 'users',
      indexes: [
        new MongoSchemaIndex({
          keys: [{ field: 'email', direction: 1 }],
          unique: true,
        }),
        new MongoSchemaIndex({
          keys: [
            { field: 'lastName', direction: 1 },
            { field: 'firstName', direction: 1 },
          ],
        }),
      ],
    }),
    orders: new MongoSchemaCollection({
      name: 'orders',
      indexes: [
        new MongoSchemaIndex({
          keys: [{ field: 'createdAt', direction: 1 }],
          expireAfterSeconds: 86400,
        }),
      ],
    }),
  },
};
```

## Decision

We represent MongoDB server-side state as an immutable class-based AST — the `MongoSchemaIR`. This follows the pattern used by the SQL query AST, Mongo pipeline AST, and Mongo expression AST in this codebase.

## MongoDB server-side state

MongoDB has a small set of server-side objects that a migration system needs to manage. The IR models each of them:

| MongoSchemaIR node | MongoDB server concept | How to read (future introspection) | How to write (runner) |
|---|---|---|---|
| `MongoSchemaCollection` | A collection | `db.listCollections()` | `db.createCollection()` |
| `MongoSchemaIndex` | An index on a collection | `collection.listIndexes()` | `collection.createIndex()` / `dropIndex()` |
| `MongoSchemaValidator` | `$jsonSchema` validator | `listCollections()` returns `options.validator` | `db.runCommand({ collMod, validator })` |
| `MongoSchemaCollectionOptions` | Capped, timeseries, collation, etc. | `listCollections()` returns `options` | `db.createCollection(opts)` / `collMod` |

## Role in the migration pipeline

```
Contract (desired state)
    ↓ contractToSchema()
MongoSchemaIR (origin state)  ←  also buildable from live introspection (future)
    ↓
Planner diffs origin IR vs destination contract
    ↓
MongoMigrationPlanOperation[] (operations to transform origin → destination)
```

The IR serves two producers:
- **`contractToSchema(contract)`** — offline, from a prior contract (the "from" state in `migration plan`)
- **Live introspection** (future) — from a running MongoDB instance via `listIndexes()`, `listCollections()`, etc.

Both produce the same `MongoSchemaIR`, so the planner doesn't know or care where the IR came from.

## Contract types vs Schema IR

The contract type `MongoStorageCollection` (in `@prisma-next/mongo-contract`) describes the **desired** state — what the user declared. The schema IR describes the **current** state — what exists (or should exist) on the server. They carry similar information but serve different purposes:

- **Contract**: canonical, hash-stable, part of `contract.json`. Contains indexes, validator, options as declared by the user.
- **Schema IR**: ephemeral, constructed for diffing. Contains the same structural information but in an AST form optimized for comparison.

`contractToSchema()` bridges the two — it reads the contract's `storage.collections` and constructs a `MongoSchemaIR`. The planner then diffs this against the destination contract's schema IR.

## Design pattern

Follows the class-based AST pattern proven in the SQL query AST (`AstNode`), Mongo pipeline AST (`MongoStageNode`), and Mongo expression AST (`MongoAggExprNode`):

- **Base class** `MongoSchemaNode` — abstract `kind` discriminant, `freeze()` for immutability, `accept(visitor)` for double dispatch
- **Concrete frozen classes** — one per node type, `readonly kind = '...' as const`, constructor calls `freeze()`
- **Union types** — `type AnyMongoSchemaNode = MongoSchemaCollection | MongoSchemaIndex | ...`
- **Visitor interface** — `MongoSchemaVisitor<R>` with one method per concrete node type

## Node types

### `MongoIndexKey`

The smallest building block — a single field in an index key specification:

```typescript
interface MongoIndexKey {
  readonly field: string;
  readonly direction: MongoIndexKeyDirection;
}

type MongoIndexKeyDirection = 1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed';
```

The `field` can be a dot-path (e.g. `"address.city"`) for indexes on nested document fields, or `"$**"` for wildcard indexes.

### `MongoSchemaNode` (abstract base)

```typescript
abstract class MongoSchemaNode {
  abstract readonly kind: string;

  abstract accept<R>(visitor: MongoSchemaVisitor<R>): R;

  protected freeze(): void {
    Object.freeze(this);
  }
}
```

### `MongoSchemaIndex`

Represents a single index on a collection.

```typescript
class MongoSchemaIndex extends MongoSchemaNode {
  readonly kind = 'index' as const;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;

  constructor(options: {
    keys: ReadonlyArray<MongoIndexKey>;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
    partialFilterExpression?: Record<string, unknown>;
  }) {
    super();
    this.keys = options.keys;
    this.unique = options.unique ?? false;
    this.sparse = options.sparse;
    this.expireAfterSeconds = options.expireAfterSeconds;
    this.partialFilterExpression = options.partialFilterExpression;
    this.freeze();
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.index(this);
  }
}
```

### `MongoSchemaValidator`

Represents a `$jsonSchema` validator on a collection (M2).

```typescript
class MongoSchemaValidator extends MongoSchemaNode {
  readonly kind = 'validator' as const;
  readonly jsonSchema: Record<string, unknown>;
  readonly validationLevel: 'strict' | 'moderate';
  readonly validationAction: 'error' | 'warn';

  constructor(options: {
    jsonSchema: Record<string, unknown>;
    validationLevel: 'strict' | 'moderate';
    validationAction: 'error' | 'warn';
  }) {
    super();
    this.jsonSchema = options.jsonSchema;
    this.validationLevel = options.validationLevel;
    this.validationAction = options.validationAction;
    this.freeze();
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.validator(this);
  }
}
```

### `MongoSchemaCollectionOptions`

Represents collection-level configuration (M2).

```typescript
class MongoSchemaCollectionOptions extends MongoSchemaNode {
  readonly kind = 'collectionOptions' as const;
  readonly capped?: { size: number; max?: number };
  readonly timeseries?: {
    timeField: string;
    metaField?: string;
    granularity?: 'seconds' | 'minutes' | 'hours';
  };
  readonly collation?: Record<string, unknown>;
  readonly changeStreamPreAndPostImages?: { enabled: boolean };

  // constructor + accept follow the same pattern
}
```

### `MongoSchemaCollection`

Represents a collection with all its server-side configuration — the "table" equivalent.

```typescript
class MongoSchemaCollection extends MongoSchemaNode {
  readonly kind = 'collection' as const;
  readonly name: string;
  readonly indexes: ReadonlyArray<MongoSchemaIndex>;
  readonly validator?: MongoSchemaValidator;
  readonly options?: MongoSchemaCollectionOptions;

  constructor(options: {
    name: string;
    indexes?: ReadonlyArray<MongoSchemaIndex>;
    validator?: MongoSchemaValidator;
    options?: MongoSchemaCollectionOptions;
  }) {
    super();
    this.name = options.name;
    this.indexes = options.indexes ?? [];
    this.validator = options.validator;
    this.options = options.options;
    this.freeze();
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.collection(this);
  }
}
```

### Top-level `MongoSchemaIR`

The top-level container. Not a node itself (same as `SqlSchemaIR` being a plain type) — it's the entry point, not something you visit.

```typescript
interface MongoSchemaIR {
  readonly collections: Record<string, MongoSchemaCollection>;
}
```

An empty IR (for new projects) is `{ collections: {} }`.

### Union and visitor types

```typescript
type AnyMongoSchemaNode =
  | MongoSchemaCollection
  | MongoSchemaIndex
  | MongoSchemaValidator
  | MongoSchemaCollectionOptions;

interface MongoSchemaVisitor<R> {
  collection(node: MongoSchemaCollection): R;
  index(node: MongoSchemaIndex): R;
  validator(node: MongoSchemaValidator): R;
  collectionOptions(node: MongoSchemaCollectionOptions): R;
}
```

## Index identity

Two indexes are structurally equivalent if and only if they have the same:

1. **Keys** — same fields in the same order with the same directions
2. **Semantic options** — `unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression`

**Name is not part of identity.** Two indexes with identical keys and options but different names are the same index — either one achieves the required purpose. This follows the SQL approach documented in the Data Contract subsystem doc ("names are metadata") and [ADR 009](../../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md).

**Key order matters.** `{ a: 1, b: 1 }` and `{ b: 1, a: 1 }` are different compound indexes with different query optimization characteristics.

**Direction matters.** `{ a: 1 }` and `{ a: -1 }` are different indexes.

```typescript
function indexesEquivalent(a: MongoSchemaIndex, b: MongoSchemaIndex): boolean {
  if (a.keys.length !== b.keys.length) return false;
  for (let i = 0; i < a.keys.length; i++) {
    if (a.keys[i].field !== b.keys[i].field) return false;
    if (a.keys[i].direction !== b.keys[i].direction) return false;
  }
  if (a.unique !== b.unique) return false;
  if (a.sparse !== b.sparse) return false;
  if (a.expireAfterSeconds !== b.expireAfterSeconds) return false;
  return deepEqual(a.partialFilterExpression, b.partialFilterExpression);
}
```

## Package placement

New package: `@prisma-next/mongo-schema-ir` under `packages/2-mongo-family/` in the tooling layer, migration plane. This mirrors `@prisma-next/sql-schema-ir` in the SQL domain.

The package exports:
- All node classes (`MongoSchemaCollection`, `MongoSchemaIndex`, etc.)
- The `MongoSchemaIR` interface
- The `MongoSchemaVisitor` interface
- The `AnyMongoSchemaNode` union type
- The `MongoIndexKey` type and `MongoIndexKeyDirection` type
- The `indexesEquivalent` helper

## Alternatives considered

### Plain types (like `SqlSchemaIR`)

`SqlSchemaIR` uses plain TypeScript types (`SqlTableIR`, `SqlColumnIR`, etc.). We considered the same approach for Mongo but chose classes because:

1. **Immutability guarantee.** `freeze()` is runtime-enforced, not just `readonly` annotations. This matters because schema IRs flow through diffing, planning, and serialization — accidental mutation during diffing would produce subtle bugs.
2. **Visitor dispatch.** The planner diffs the IR structurally. Visitor dispatch via `accept()` is cleaner and more extensible than `switch (node.kind)` — adding a new node type is a compile error in every visitor, not a silent fallthrough.
3. **Consistency.** Every other AST in the Mongo family uses this pattern. Developers working on the Mongo migration system encounter the same idioms they use for queries and expressions.

## M1 scope

Only `MongoSchemaCollection` and `MongoSchemaIndex` are implemented. The visitor interface includes all methods from the start (returning `never` or throwing for unimplemented nodes) to ensure compile-time safety when M2 adds validators and options.
