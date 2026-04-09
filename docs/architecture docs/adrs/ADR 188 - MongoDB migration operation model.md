# ADR 188 — MongoDB migration operation model: data-driven commands and checks

## At a glance

Migration operations are composed from serializable AST primitives — DDL commands, inspection commands, and filter expressions. The planner assembles them into three-phase envelopes (precheck, execute, postcheck) that serialize to `ops.json` via `JSON.stringify`. When the runner loads a plan, it **rehydrates** the JSON back into live AST objects that dispatch directly to visitors — the command executor, the CLI formatter, or any future consumer. The framework never interprets the operation content; it just persists and restores it.

```
Planner                                              Runner
   │                                                    │
   ▼                                                    ▼
Operation (live AST objects)                      Load ops.json
   │                                                    │
   ▼                                                    ▼
JSON.stringify ──────▶ ops.json ──────▶ deserialize (rehydrate)
                                                        │
                                                        ▼
                                              Operation (live AST objects)
                                                        │
                                              ┌─────────┼──────────┐
                                              ▼         ▼          ▼
                                          precheck   execute   postcheck
```

## Context

A migration step for MongoDB needs to express three things: what to check before mutating, what mutation to perform, and what to verify afterward. These must persist to a JSON plan file (`ops.json`) that a generic runner can load and execute without operation-specific dispatch logic. The runner should run the same three-phase loop for every operation — it should not know whether the operation creates an index, modifies a validator, or drops a collection.

## Decision

Each migration operation is a **data envelope** with three phases — `precheck[]`, `execute[]`, `postcheck[]` — rather than a behavioral class. The phases contain AST primitives that serialize naturally to JSON and rehydrate into live objects on deserialization.

Here is the complete operation for "add a unique ascending index on `users.email`":

```ts
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
      command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
        unique: true,
        name: 'email_1',
      }),
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

Every piece — `CreateIndexCommand`, `ListIndexesCommand`, `MongoFieldFilter`, `MongoAndExpr` — is a frozen `MongoAstNode` with plain-property fields. `JSON.stringify(op, null, 2)` produces the persisted format:

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
        "unique": true,
        "name": "email_1"
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

The JSON and the TypeScript carry the same structure. The runner doesn't need to know what kind of operation this is — it evaluates checks, dispatches commands, and moves on.

## The operation envelope

The envelope is a plain interface — no `kind` discriminant, no visitor, no class hierarchy. The semantic richness lives in the commands and expressions inside, not in the wrapper:

```ts
interface MongoMigrationPlanOperation extends MigrationPlanOperation {
  readonly precheck: readonly MongoMigrationCheck[];
  readonly execute: readonly MongoMigrationStep[];
  readonly postcheck: readonly MongoMigrationCheck[];
}
```

The three base fields (`id`, `label`, `operationClass`) satisfy the framework's `MigrationPlanOperation` interface, so the CLI and migration tooling can work with these operations without knowing they're Mongo-specific.

### Execute steps

Each step wraps a DDL command AST node:

```ts
interface MongoMigrationStep {
  readonly description: string;
  readonly command: AnyMongoDdlCommand;
}
```

The M1 command vocabulary is `CreateIndexCommand` and `DropIndexCommand`. M2 adds `CreateCollectionCommand`, `DropCollectionCommand`, and `CollModCommand`. All follow the same `MongoAstNode` pattern: frozen, `kind`-discriminated, `accept(visitor)` for dispatch.

### Checks

Each check composes three pieces:

```ts
interface MongoMigrationCheck {
  readonly description: string;
  readonly source: AnyMongoInspectionCommand;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
}
```

- **`source`** — an inspection command (`ListIndexesCommand`, `ListCollectionsCommand`) that queries the database and returns result documents.
- **`filter`** — a `MongoFilterExpr` applied client-side to the results. This reuses the existing filter expression AST from `@prisma-next/mongo-query-ast` — the same `$eq`, `$and`, `$or`, `$not`, `$exists`, `$gt`, `$in` vocabulary used in query `$match` stages.
- **`expect`** — `'exists'` means at least one result matches; `'notExists'` means none match.

## Rehydration

The operation round-trips through JSON. Serialization is trivial — `JSON.stringify` — because all AST nodes are frozen plain-property objects. Deserialization is the interesting part: the deserializer walks the JSON, matches `kind` discriminants, validates structure with Arktype schemas, and reconstructs live class instances.

For example, the DDL command deserializer:

```ts
function deserializeDdlCommand(json: unknown): AnyMongoDdlCommand {
  const record = json as Record<string, unknown>;
  const kind = record['kind'] as string;
  switch (kind) {
    case 'createIndex': {
      const data = validate(CreateIndexJson, json, 'createIndex command');
      return new CreateIndexCommand(data.collection, data.keys, {
        unique: data.unique,
        sparse: data.sparse,
        expireAfterSeconds: data.expireAfterSeconds,
        partialFilterExpression: data.partialFilterExpression,
        name: data.name,
      });
    }
    case 'dropIndex': {
      const data = validate(DropIndexJson, json, 'dropIndex command');
      return new DropIndexCommand(data.collection, data.name);
    }
    default:
      throw new Error(`Unknown DDL command kind: ${kind}`);
  }
}
```

`CreateIndexJson` and `DropIndexJson` are Arktype schemas that validate the JSON structure before construction. A malformed or hand-edited `ops.json` fails with a clear error at deserialization, not at runtime.

The rehydrated objects are indistinguishable from the originals. A `CreateIndexCommand` deserialized from JSON has the same `accept(visitor)` method, the same frozen properties, and can be dispatched directly to the command executor or CLI formatter. The runner doesn't need to know the command was ever serialized.

The same rehydration applies to inspection commands and filter expressions — every `kind`-discriminated node in the JSON tree is reconstructed into its corresponding AST class.

## Composability

Because operations are composed from a small set of serializable primitives (DDL commands, inspection commands, filter expressions), anything that can assemble these primitives can produce a valid operation. The planner does this automatically by diffing contracts. But the same primitives are available to:

- **Hand-authored migrations** — a user runs `migration new` and assembles an operation from the same building blocks the planner uses. The framework serializes it to `ops.json` and the runner executes it, without any special handling.
- **Data migrations** — future data migration steps could place DML commands (e.g., `UpdateManyCommand`) in the execute array alongside DDL commands, with filter-expression checks verifying the outcome.
- **Extension packs** — an Atlas extension pack could contribute new command kinds (e.g., `CreateSearchIndexCommand`). As long as the command executor and deserializer handle the new `kind`, existing operations continue to work.

The framework, target, and family don't need to know anything about what's inside an operation — they just persist and restore the primitives.

## Alternatives considered

### Behavioral operation classes

An earlier design had each migration operation as its own class (`CreateIndexOp`, `DropIndexOp`) with a visitor interface. The runner would call `op.accept(executor)` and dispatch to a per-operation handler. We chose the data-driven envelope instead because:

- **The commands already carry the semantics.** A `CreateIndexCommand` fully describes what to do. Wrapping it in a `CreateIndexOp` duplicates the structure.
- **Checks become inspectable data.** In the behavioral design, pre/postchecks were runtime logic inside the visitor — invisible in the plan file and untestable in isolation. The data-driven design makes them part of the serialized plan.
- **The runner stays generic.** It runs the same three-phase loop for every operation. No visitor, no per-operation dispatch.
- **Adding a new DDL command is cheap.** One new class and one new case in the command executor — not a new operation class, visitor method, union member, and deserializer branch.

### Purpose-built check vocabulary

We could have invented check-specific types: `{ kind: 'indexExists', collection: 'users', keys: { email: 1 } }`. We chose `MongoFilterExpr` instead because:

- **Already exists.** The filter expression AST is fully defined, tested, and serializable.
- **Familiar.** The same expressions appear in MongoDB queries (`$match`, `find()`).
- **Expressive.** `$eq`, `$gt`, `$in`, `$and`, `$or`, `$not`, `$exists` — far richer than any purpose-built vocabulary we would realistically build.

The trade-off is a client-side filter evaluator, which is straightforward and also useful for testing and dry-run simulation. See the [Check Evaluator](../subsystems/7%20-%20Migration%20System.md) section of the Migration System subsystem doc.

### Embedding display strings in the plan

We could add a `displayCommands: string[]` field to each operation, populated by the planner. This would couple plan data to CLI presentation and bloat the persisted format. Instead, the CLI uses a visitor-based formatter that produces display strings from the live DDL command objects after rehydration.
