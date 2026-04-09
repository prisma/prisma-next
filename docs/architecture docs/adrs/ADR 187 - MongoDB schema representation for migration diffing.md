# ADR 187 — MongoDB schema representation for migration diffing

## Grounding example

A MongoDB database has a `users` collection with a unique ascending index on `email`:

```js
> db.users.getIndexes()
[
  { v: 2, key: { _id: 1 }, name: '_id_' },
  { v: 2, key: { email: 1 }, name: 'email_1', unique: true }
]
```

A new contract version adds a compound index on `{ lastName: 1, firstName: 1 }`. The migration planner needs to compare the current state (one index) against the desired state (two indexes) and produce a `createIndex` operation for the compound index.

To do that comparison, both states must be in the same representation. That representation is the `MongoSchemaIR`.

Here is the IR for the current state — one collection, one index:

```ts
const origin: MongoSchemaIR = {
  collections: {
    users: new MongoSchemaCollection({
      name: 'users',
      indexes: [
        new MongoSchemaIndex({
          keys: [{ field: 'email', direction: 1 }],
          unique: true,
        }),
      ],
    }),
  },
};
```

And here is the IR for the desired state — the same collection, two indexes:

```ts
const destination: MongoSchemaIR = {
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
  },
};
```

The planner diffs these two IRs and emits one operation: create the compound index.

## Decision

We represent MongoDB server-side state as `MongoSchemaIR` — an immutable, class-based AST. Each node represents one kind of server-side object (collection, index, validator, collection options). The IR follows the frozen-node pattern established by the Mongo query, pipeline, and filter expression ASTs elsewhere in the codebase.

## What the IR models

MongoDB has a small set of server-side objects that migrations need to manage. Each one maps to an IR node:

| IR node | MongoDB concept | Example |
|---|---|---|
| `MongoSchemaCollection` | A collection | `users` |
| `MongoSchemaIndex` | An index on a collection | `{ email: 1 }`, unique |
| `MongoSchemaValidator` | A `$jsonSchema` validator | `{ bsonType: 'object', required: ['email'] }` |
| `MongoSchemaCollectionOptions` | Capped, timeseries, collation, etc. | `{ capped: true, size: 1048576 }` |

M1 implements `MongoSchemaCollection` and `MongoSchemaIndex`. Validators and collection options are defined in the visitor interface (so adding them is a compile error in all consumers) but not yet implemented.

### Index

The most important node. An index is defined by its keys and options:

```ts
class MongoSchemaIndex extends MongoSchemaNode {
  readonly kind = 'index' as const;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;
}
```

`MongoIndexKey` is `{ field: string; direction: MongoIndexKeyDirection }`, where direction is `1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed'`. It is defined in `@prisma-next/mongo-contract` and shared between the contract types and the schema IR.

### Collection

Groups a collection's indexes (and, in future milestones, its validator and options):

```ts
class MongoSchemaCollection extends MongoSchemaNode {
  readonly kind = 'collection' as const;
  readonly name: string;
  readonly indexes: ReadonlyArray<MongoSchemaIndex>;
}
```

### Top-level container

The IR itself is a plain interface — a lookup from collection name to collection node:

```ts
interface MongoSchemaIR {
  readonly collections: Record<string, MongoSchemaCollection>;
}
```

An empty IR (for a new project with no prior contract) is `{ collections: {} }`.

## Where the IR sits in the pipeline

The IR has two producers and one consumer:

```
Contract (prior version)         Live MongoDB instance (future)
    │                                     │
    ▼                                     ▼
contractToSchema()               introspectSchema() (M4)
    │                                     │
    └──────────┐          ┌───────────────┘
               ▼          ▼
           MongoSchemaIR (origin)
               │
               ▼
    Planner diffs origin IR vs destination contract
               │
               ▼
    MongoMigrationPlanOperation[]
```

Today, `contractToSchema(contract)` reads `contract.storage.collections` and constructs a `MongoSchemaIR`. In M4, live introspection will query `listIndexes()` and `listCollections()` to build an IR from the actual database. Both producers emit the same type, so the planner doesn't know or care where the IR came from.

## Design properties

### Immutability

Every node calls `Object.freeze(this)` in its constructor. The IR is a snapshot — it must not change after construction. This matters because the planner traverses both origin and destination IRs during diffing. Accidental mutation would produce subtle, hard-to-diagnose comparison bugs.

### Class-based AST with visitor dispatch

Each node extends `MongoSchemaNode` and implements `accept<R>(visitor: MongoSchemaVisitor<R>): R`. The visitor interface has one method per node type:

```ts
interface MongoSchemaVisitor<R> {
  collection(node: MongoSchemaCollection): R;
  index(node: MongoSchemaIndex): R;
  validator(node: unknown): R;
  collectionOptions(node: unknown): R;
}
```

Adding a new node type (e.g., `MongoSchemaValidator` in M2) requires adding a method to the visitor interface. Every existing visitor implementation gets a compile error until it handles the new node. This is the same exhaustiveness guarantee used by the DDL command visitors and filter expression visitors.

### Structural identity for indexes

Two indexes are equivalent if and only if they have the same keys (fields, order, directions) and the same semantic options (unique, sparse, TTL, partial filter expression). **Name is not part of identity.** An index named `email_1` and an index named `idx_users_email` with identical keys and options are functionally the same index — the planner treats them as a no-op.

This follows [ADR 009 (Deterministic Naming Scheme)](ADR%20009%20-%20Deterministic%20Naming%20Scheme.md), which establishes that names are derived metadata, not identity. The planner's structural matching algorithm is detailed in [ADR 189](ADR%20189%20-%20Structural%20index%20matching%20for%20MongoDB%20migrations.md).

## Package placement

`@prisma-next/mongo-schema-ir` in `packages/2-mongo-family/3-tooling/mongo-schema-ir/`, the tooling layer on the migration plane. This mirrors `@prisma-next/sql-schema-ir` in the SQL domain.

## Alternatives considered

### Plain interfaces instead of classes

`SqlSchemaIR` uses plain TypeScript interfaces (`SqlTableIR`, `SqlColumnIR`). We considered the same approach. We chose classes because:

- **Runtime immutability.** `Object.freeze()` is enforced at runtime, not just via `readonly` annotations. The IR flows through diffing and serialization — runtime freezing catches mutation bugs that type-level `readonly` cannot.
- **Visitor dispatch.** `accept(visitor)` on each node is cleaner than a `switch (node.kind)` in every consumer. Adding a node type is a compile error in all visitors, not a silent fallthrough.
- **Consistency.** Every other AST in the Mongo family (queries, pipeline stages, filter expressions, DDL commands) uses this pattern. A developer working on Mongo migrations encounters the same idioms they already know.

The trade-off is that class-based AST nodes are heavier than plain objects. This is acceptable because schema IRs are small (tens of collections, hundreds of indexes at most) and short-lived (constructed for one planning operation, then discarded).

### A shared "document family" IR

We considered a generic `DocumentSchemaIR` shared across all document databases (Mongo, DynamoDB, etc.). We rejected this because MongoDB's server-side objects (validators, capped collections, timeseries, collation) are specific enough that a generic abstraction would either be too sparse to be useful or too leaky to be portable. Each document target provides its own IR, and the framework's `TargetMigrationsCapability.contractToSchema()` returns `unknown` — the planner knows the concrete type.

### Model only indexes (the M1 surface)

We considered defining nodes only for indexes and adding collection/validator/options nodes later. We chose to define the full visitor interface up front (with `unknown` parameter types for unimplemented nodes) so that M2 additions produce compile errors in existing code. The node classes themselves are added incrementally — only `MongoSchemaCollection` and `MongoSchemaIndex` exist today.
