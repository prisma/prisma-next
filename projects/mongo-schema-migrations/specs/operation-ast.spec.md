# Operation Design: DDL Commands + Data-Driven Checks

## Problem

MongoDB migrations need to express three things for each schema change: what to check before mutating, what mutation to perform, and what to verify afterward. These operations must serialize to a self-describing JSON plan file (`ops.json`) that a generic runner can load and execute without any operation-specific dispatch logic.

This spec defines the AST node vocabulary for MongoDB DDL commands, inspection commands, and check assertions — and how they compose into migration operations.

## Grounding example

Consider adding a unique index on `users.email`. Conceptually, the operation has three phases:

1. **Precheck** — query the database to confirm the index doesn't already exist
2. **Execute** — run the `createIndex` DDL command
3. **Postcheck** — query the database to confirm the unique index now exists

Each phase is expressed as data: the checks combine an inspection command (what to query), a filter expression (what to match in the results), and an expectation (should a match exist or not). The execute step wraps a DDL command AST node.

In TypeScript:

```typescript
const op: MongoMigrationPlanOperation = {
  id: 'index.users.create(email:1)',
  label: 'Create index on users (email ascending)',
  operationClass: 'additive',
  precheck: [
    {
      description: 'index does not already exist',
      source: new ListIndexesCommand('users'),
      filter: MongoFieldFilter.eq('key', { email: 1 }),
      expect: 'notExists',
    },
  ],
  execute: [
    {
      description: 'create index',
      command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], { unique: true }),
    },
  ],
  postcheck: [
    {
      description: 'unique index exists',
      source: new ListIndexesCommand('users'),
      filter: MongoAndExpr.of([
        MongoFieldFilter.eq('key', { email: 1 }),
        MongoFieldFilter.eq('unique', true),
      ]),
      expect: 'exists',
    },
  ],
};
```

Every piece — the DDL command, the inspection commands, the filter expressions — is a frozen `MongoAstNode` with JSON-serializable properties. `JSON.stringify(ops, null, 2)` produces the persisted format directly:

```json
{
  "id": "index.users.create(email:1)",
  "label": "Create index on users (email ascending)",
  "operationClass": "additive",
  "precheck": [
    {
      "description": "index does not already exist",
      "source": { "kind": "listIndexes", "collection": "users" },
      "filter": { "kind": "field", "field": "key", "op": "$eq", "value": { "email": 1 } },
      "expect": "notExists"
    }
  ],
  "execute": [
    {
      "description": "create index",
      "command": {
        "kind": "createIndex",
        "collection": "users",
        "keys": [{ "field": "email", "direction": 1 }],
        "unique": true
      }
    }
  ],
  "postcheck": [
    {
      "description": "unique index exists",
      "source": { "kind": "listIndexes", "collection": "users" },
      "filter": {
        "kind": "and",
        "exprs": [
          { "kind": "field", "field": "key", "op": "$eq", "value": { "email": 1 } },
          { "kind": "field", "field": "unique", "op": "$eq", "value": true }
        ]
      },
      "expect": "exists"
    }
  ]
}
```

At apply time, the runner loads `ops.json`, deserializes the command AST nodes, and executes them generically — iterating the `precheck`, `execute`, and `postcheck` arrays through a command dispatcher. No visitor dispatch on the operation. The plan file is completely self-describing.

## Key decisions

1. **Symmetric with SQL.** MongoDB migration operations have the same shape as SQL operations: `precheck[]`, `execute[]`, `postcheck[]`. The runner executes the same three-phase loop. This makes the migration framework truly family-agnostic.

2. **DDL commands as AST nodes.** Each MongoDB DDL command (`createIndex`, `dropIndex`, `collMod`, etc.) is a class extending `MongoAstNode` — the same base class used by query commands (`InsertOneCommand`, `AggregateCommand`). The same patterns apply: `kind` discriminant, `freeze()`, typed fields, natural JSON serialization.

3. **Filter expressions for checks.** Pre/postchecks use the existing `MongoFilterExpr` AST — the same filter expressions used in query `$match` stages. A client-side evaluator interprets them against inspection command results. This reuses the full filter vocabulary (`$eq`, `$and`, `$or`, `$not`, `$exists`, `$gt`, `$in`, etc.) without inventing a new check DSL.

## Operation structure

The operation envelope is a plain data structure — no `kind` discriminant, no visitor, no class hierarchy. The semantic richness lives in the commands and filter expressions inside, not in the wrapper.

```typescript
interface MongoMigrationCheck {
  readonly description: string;
  readonly source: AnyMongoInspectionCommand;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
}

interface MongoMigrationStep {
  readonly description: string;
  readonly command: AnyMongoDdlCommand;
}

interface MongoMigrationPlanOperation extends MigrationPlanOperation {
  readonly precheck: readonly MongoMigrationCheck[];
  readonly execute: readonly MongoMigrationStep[];
  readonly postcheck: readonly MongoMigrationCheck[];
}
```

The three envelope fields (`id`, `label`, `operationClass`) satisfy the framework's `MigrationPlanOperation` interface, so the CLI and migration-tools code can work with these operations without knowing they're Mongo-specific.

## DDL commands

DDL commands are the mutation primitives — they go in the `execute` array. Each extends `MongoAstNode` (the same base class from `@prisma-next/mongo-query-ast`), making them frozen, immutable, JSON-serializable data structures with a `kind` discriminant.

Unlike DML commands (which don't have visitors), DDL commands implement `accept<R>(visitor: MongoDdlCommandVisitor<R>): R` for compile-time exhaustive dispatch. This serves both the command executor (runner maps commands to driver calls) and the command formatter (CLI renders commands as display strings). See [DDL command dispatch design](ddl-command-dispatch.spec.md).

### M1: Index commands

```typescript
class CreateIndexCommand extends MongoAstNode {
  readonly kind = 'createIndex' as const;
  readonly collection: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;
  readonly name?: string;

  constructor(
    collection: string,
    keys: ReadonlyArray<MongoIndexKey>,
    options?: {
      unique?: boolean;
      sparse?: boolean;
      expireAfterSeconds?: number;
      partialFilterExpression?: Record<string, unknown>;
      name?: string;
    },
  ) {
    super();
    this.collection = collection;
    this.keys = keys;
    this.unique = options?.unique;
    this.sparse = options?.sparse;
    this.expireAfterSeconds = options?.expireAfterSeconds;
    this.partialFilterExpression = options?.partialFilterExpression;
    this.name = options?.name;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.createIndex(this);
  }
}

class DropIndexCommand extends MongoAstNode {
  readonly kind = 'dropIndex' as const;
  readonly collection: string;
  readonly name: string;

  constructor(collection: string, name: string) {
    super();
    this.collection = collection;
    this.name = name;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.dropIndex(this);
  }
}
```

### DDL command visitor

```typescript
interface MongoDdlCommandVisitor<R> {
  createIndex(command: CreateIndexCommand): R;
  dropIndex(command: DropIndexCommand): R;
}
```

Adding a new DDL command kind (M2: `CreateCollectionCommand`, `CollModCommand`, etc.) forces implementation in every visitor — compile-time safety for the executor, formatter, and any future consumer. Follow-up [TML-2234](https://linear.app/prisma-company/issue/TML-2234) tracks adding the same pattern to DML commands.

### M2: Collection, validator, and option commands (sketched)

```typescript
class CreateCollectionCommand extends MongoAstNode {
  readonly kind = 'createCollection' as const;
  readonly collection: string;
  readonly validator?: Record<string, unknown>;
  readonly validationLevel?: 'strict' | 'moderate';
  readonly validationAction?: 'error' | 'warn';
  readonly capped?: boolean;
  readonly size?: number;
  readonly max?: number;
}

class DropCollectionCommand extends MongoAstNode {
  readonly kind = 'dropCollection' as const;
  readonly collection: string;
}

class CollModCommand extends MongoAstNode {
  readonly kind = 'collMod' as const;
  readonly collection: string;
  readonly validator?: Record<string, unknown>;
  readonly validationLevel?: 'strict' | 'moderate';
  readonly validationAction?: 'error' | 'warn';
}
```

### Union type

```typescript
type AnyMongoDdlCommand =
  | CreateIndexCommand
  | DropIndexCommand
  | CreateCollectionCommand
  | DropCollectionCommand
  | CollModCommand;
```

## Inspection commands

Inspection commands are read-only AST nodes that appear as the `source` in check assertions. They represent MongoDB introspection operations — the runner executes them to produce a result set that checks filter against. Like DDL commands, they implement `accept<R>(visitor: MongoInspectionCommandVisitor<R>): R` for visitor-based dispatch.

```typescript
class ListIndexesCommand extends MongoAstNode {
  readonly kind = 'listIndexes' as const;
  readonly collection: string;

  constructor(collection: string) {
    super();
    this.collection = collection;
    this.freeze();
  }

  accept<R>(visitor: MongoInspectionCommandVisitor<R>): R {
    return visitor.listIndexes(this);
  }
}

class ListCollectionsCommand extends MongoAstNode {
  readonly kind = 'listCollections' as const;

  constructor() {
    super();
    this.freeze();
  }

  accept<R>(visitor: MongoInspectionCommandVisitor<R>): R {
    return visitor.listCollections(this);
  }
}

type AnyMongoInspectionCommand =
  | ListIndexesCommand
  | ListCollectionsCommand;

interface MongoInspectionCommandVisitor<R> {
  listIndexes(command: ListIndexesCommand): R;
  listCollections(command: ListCollectionsCommand): R;
}
```

Each inspection command has a known result document shape, enabling typed filter expressions at authoring time. See the [Check Evaluator design](check-evaluator.spec.md) for details.

## Check assertions

Checks are the glue between inspection commands and expectations. Each check composes three pieces:

- **`source`**: which inspection command to run (e.g., `listIndexes('users')`)
- **`filter`**: a `MongoFilterExpr` applied to the results — reusing the existing AST from `@prisma-next/mongo-query-ast`
- **`expect`**: `'exists'` (at least one result matches) or `'notExists'` (no results match)

This reuses the full filter vocabulary (`$eq`, `$and`, `$or`, `$not`, `$exists`, `$gt`, `$in`, etc.) rather than inventing a purpose-built check DSL. The filter expressions are the same `MongoFieldFilter`, `MongoAndExpr`, `MongoExistsExpr` etc. from the query AST.

### Check examples by operation

| Operation | Phase | Filter | Expect |
|-----------|-------|--------|--------|
| `createIndex(email:1, unique)` | precheck | `{ key: { email: 1 } }` | `notExists` |
| `createIndex(email:1, unique)` | postcheck | `{ key: { email: 1 }, unique: true }` | `exists` |
| `dropIndex(email:1)` | precheck | `{ key: { email: 1 } }` | `exists` |
| `dropIndex(email:1)` | postcheck | `{ key: { email: 1 } }` | `notExists` |
| `createCollection(users)` | precheck | `{ name: 'users' }` | `notExists` |
| `createCollection(users)` | postcheck | `{ name: 'users' }` | `exists` |
| `collMod(users, validator)` | postcheck | `{ name: 'users', options.validator.$jsonSchema: ... }` | `exists` |

## Operation identity

Each operation needs a deterministic `id` so that the migration graph can track which operations have been applied. The ID is derived from the operation's content (its execute commands), not from ordering or user input:

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

The grounding example above shows the serialized format. Because all components — DDL commands, inspection commands, filter expressions — are frozen `MongoAstNode` instances with JSON-serializable properties, `JSON.stringify(ops, null, 2)` produces the persisted format directly. No custom serializer is needed.

The three envelope fields (`id`, `label`, `operationClass`) are validated by `@prisma-next/migration-tools` on read; the command and check content is opaque to the framework.

### Attestation

The `migrationId` hash is computed over the full canonicalized ops array (sorted keys recursively). All Mongo-specific fields — commands, filters, inspection commands — are part of the content-addressed hash. This is the existing attestation behavior — no changes needed.

### Read path (deserialization)

When `migration apply` loads `ops.json`, it gets plain JSON objects. The runner needs to reconstruct class instances from the `kind` discriminant in each node:

```typescript
function deserializeMongoOp(json: Record<string, unknown>): MongoMigrationPlanOperation {
  return {
    id: json.id as string,
    label: json.label as string,
    operationClass: json.operationClass as MigrationOperationClass,
    precheck: (json.precheck as Array<Record<string, unknown>>).map(deserializeCheck),
    execute: (json.execute as Array<Record<string, unknown>>).map(deserializeStep),
    postcheck: (json.postcheck as Array<Record<string, unknown>>).map(deserializeCheck),
  };
}

function deserializeStep(json: Record<string, unknown>): MongoMigrationStep {
  return {
    description: json.description as string,
    command: deserializeDdlCommand(json.command as Record<string, unknown>),
  };
}

function deserializeCheck(json: Record<string, unknown>): MongoMigrationCheck {
  return {
    description: json.description as string,
    source: deserializeInspectionCommand(json.source as Record<string, unknown>),
    filter: deserializeFilterExpr(json.filter as Record<string, unknown>),
    expect: json.expect as 'exists' | 'notExists',
  };
}
```

**Validation**: The deserializer validates the JSON shape before constructing AST nodes. Use Arktype schemas per command kind to fail fast on corrupt or hand-edited `ops.json` files.

## Deterministic index naming

MongoDB auto-assigns an index name if none is provided. For reproducibility and drop-by-name support, the planner assigns a deterministic name following the spirit of [ADR 009](../../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md):

```typescript
function defaultMongoIndexName(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map(k => `${k.field}_${k.direction}`).join('_');
}
```

This matches MongoDB's own default naming convention. The name is stored in `CreateIndexCommand.name` and used by `DropIndexCommand` to identify the index to drop.

## Package placement

DDL commands, inspection commands, and migration check types live in `@prisma-next/mongo-query-ast` alongside the existing DML commands. The package is split into two entrypoints:

- **`@prisma-next/mongo-query-ast/execution`** — DML commands (`InsertOneCommand`, `AggregateCommand`, etc.), pipeline stages, `MongoQueryPlan`. Used by the runtime plane.
- **`@prisma-next/mongo-query-ast/control`** — DDL commands (`CreateIndexCommand`, `DropIndexCommand`, `CollModCommand`, etc.), inspection commands (`ListIndexesCommand`, `ListCollectionsCommand`), `MongoMigrationCheck`, `MongoMigrationStep`, `MongoMigrationPlanOperation` types. Used by the migration/control plane.

Both entrypoints share the foundation: `MongoAstNode`, filter expressions (`MongoFilterExpr`), aggregation expressions. These are exported from the package root.

The command executor (which maps DDL command AST nodes to MongoDB driver calls) lives in the target package (`packages/3-mongo-target/`), since it depends on the Mongo driver.

The check evaluator (which evaluates `MongoFilterExpr` against in-memory documents) also lives in the target package. See [Check Evaluator design](check-evaluator.spec.md).

## Extensibility

Because operations are plain data envelopes containing typed commands and filter-expression checks, the system is extensible along several axes:

- **New DDL commands**: Add a new command class (e.g., `CreateSearchIndexCommand` for Atlas Search) → the command executor gains one new case → all existing operations continue to work.
- **User-authored operations**: Users can construct `MongoMigrationPlanOperation` directly with arbitrary commands and checks. No class hierarchy to extend.
- **Extension packs**: A future Atlas extension pack could contribute new command kinds and the runner would execute them — as long as the command executor knows how to handle them.
- **Data migrations**: Future data migration steps could use DML commands (`UpdateManyCommand`) in the `execute` array alongside DDL commands, with checks expressed through inspection commands and filter expressions.

## Alternatives considered

### Why not class-per-operation with visitor dispatch?

The earlier design had each migration operation as its own class (`CreateIndexOp`, `DropIndexOp`, etc.) with a visitor interface for runner dispatch. This made the operation the unit of semantic meaning — the runner would call `op.accept(executor)` and dispatch to `executor.createIndex(this)`.

We chose the symmetric data-driven design instead because:

1. **The commands ARE the semantic meaning.** A `CreateIndexCommand` AST node fully describes what to do. Wrapping it in a `CreateIndexOp` class duplicates the structure.
2. **Checks become data.** In the visitor design, pre/postchecks were runtime behavior in the runner — invisible in the plan file. The symmetric design makes them inspectable, serialized data.
3. **The runner becomes generic.** It runs the same three-phase loop (precheck → execute → postcheck) for every operation, regardless of what kind of DDL command is inside. No visitor, no per-operation dispatch in the runner.
4. **Extensibility.** Adding a new DDL command requires one new class and one new case in the command executor — not a new operation class, visitor method, union member, and deserializer case.

### Why not a new check DSL?

We could have invented a purpose-built vocabulary for checks: `{ kind: 'indexExists', collection: 'users', keys: { email: 1 } }` etc. We chose `MongoFilterExpr` instead because:

1. **Already exists.** The filter expression AST is fully defined, tested, and serializable.
2. **Users know it.** The same expressions appear in MongoDB queries (`$match`, `find()`).
3. **Expressive.** Supports `$eq`, `$gt`, `$in`, `$and`, `$or`, `$not`, `$exists` — far richer than any purpose-built check vocabulary.
4. **Typed.** Inspection commands have known result document shapes, so filter expressions can be type-checked at authoring time.

The trade-off is that we need a client-side evaluator for filter expressions. This is straightforward (see [Check Evaluator design](check-evaluator.spec.md)) and also useful for testing and dry-run simulation.

### Why keep DDL commands in `@prisma-next/mongo-query-ast`?

DDL commands could live in a separate package (e.g., `@prisma-next/mongo-schema-commands`). We chose to keep them alongside DML commands because:

1. **Same base class.** Both DML and DDL commands extend `MongoAstNode`, use `kind` discriminants, and follow the same `freeze()` pattern.
2. **Shared vocabulary.** Filter expressions are used by both query `$match` stages and migration checks.
3. **Split entrypoints.** The `/execution` and `/control` entrypoints provide clean separation without package proliferation. Import layering is enforced by the entrypoint boundary, not by package boundaries.
