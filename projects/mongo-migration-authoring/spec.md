# Summary

Users can author Mongo migrations by hand in TypeScript. A migration file exports a class, runs as a standalone script, and produces `ops.json` that the existing runner consumes unchanged.

# Description

## What a migration file looks like

```typescript
import { Migration, createIndex, createCollection }
  from "@prisma-next/target-mongo/migration"

export default class extends Migration {
  plan() {
    return [
      createCollection("users", {
        validator: { $jsonSchema: { required: ["email"] } },
        validationLevel: "strict",
      }),
      createIndex("users", [{ field: "email", direction: 1 }], { unique: true }),
    ]
  }
}

Migration.run(import.meta)
```

`node migration.ts` produces `ops.json`. The existing `MongoMigrationRunner` consumes it unchanged. That's the entire authoring workflow.

## How it works

The file has two parts:

1. **The class** — exports a `Migration` subclass with a `plan()` method. `plan()` returns an array of `MongoMigrationPlanOperation` objects built by factory functions.
2. **The run line** — `Migration.run(import.meta)` makes the file self-executing. When run directly (`node migration.ts`), it calls `plan()`, serializes the result, and writes `ops.json`. When imported by the CLI or a test, it's a no-op.

## Operation factories

Each factory function produces a single `MongoMigrationPlanOperation` — a plain object containing the operation's identity, its DDL command, and its pre/postchecks:

- `createIndex(collection, keys, options?)` — adds an index with a precheck that it doesn't already exist
- `dropIndex(collection, keys)` — removes an index with a precheck that it exists
- `createCollection(collection, options?)` — creates a collection with optional validator, collation, capped settings, etc.
- `dropCollection(collection)` — drops a collection
- `collMod(collection, options)` — modifies collection options (validator, changeStreamPreAndPostImages, etc.)

The factories produce the same output as the existing `MongoMigrationPlanner`. The runner cannot distinguish between planner-generated and hand-authored operations.

## Composing operations into strategies

A strategy is a plain function that composes the atomic factories:

```typescript
function validatedCollection(
  name: string,
  schema: Record<string, unknown>,
  indexes: Array<{ keys: MongoIndexKey[]; unique?: boolean }>,
) {
  return [
    createCollection(name, {
      validator: { $jsonSchema: schema },
      validationLevel: "strict",
      validationAction: "error",
    }),
    ...indexes.map(idx => createIndex(name, idx.keys, { unique: idx.unique })),
  ]
}
```

Used in a migration:

```typescript
export default class extends Migration {
  plan() {
    return validatedCollection("users",
      { required: ["email", "name"] },
      [{ keys: [{ field: "email", direction: 1 }], unique: true }],
    )
  }
}
```

Strategies are regular functions. Users write their own the same way — compose factories, return operations. The planner could call the same functions to produce its output (though refactoring the planner is out of scope here).

## Serialization

The Mongo command classes (`CreateIndexCommand`, `DropIndexCommand`, etc.) store all data as public readonly properties. `JSON.stringify()` serializes them directly — the existing `serializeMongoOps` is literally `JSON.stringify(ops, null, 2)`. The factory functions produce the same command class instances the planner does, so serialization works identically.

## Why Mongo

Mongo is a good starting point for this pattern because:

- The operation set is small and well-defined (5 DDL commands)
- The command classes already serialize via `JSON.stringify`
- The planner already produces `MongoMigrationPlanOperation[]` directly — the architecture is already aligned
- It's a self-contained family, so this work doesn't touch other targets

The pattern is designed to generalize to SQL migrations, where factory functions like `addColumn`, `setNotNull`, etc. would produce `SqlMigrationPlanOperation` objects the same way. See [the design proposal](assets/migration-authoring-design.md) for the full cross-target vision.

# Requirements

## Functional Requirements

- Factory functions for each Mongo DDL operation (`createIndex`, `dropIndex`, `createCollection`, `dropCollection`, `collMod`) that produce `MongoMigrationPlanOperation` objects with correct prechecks, commands, and postchecks. Factory functions and planner are co-located in `packages/3-mongo-target/1-mongo-target`, exported from `@prisma-next/target-mongo/migration`.
- A `Migration` base class with:
  - An abstract `plan()` method returning `MongoMigrationPlanOperation[]`
  - A static `Migration.run(import.meta)` method that handles self-execution (entrypoint detection, serialization, file writing)
  - `--dry-run` flag support (print operations without writing)
  - `--help` flag support
- At least one compound strategy function demonstrating composition of multiple factories
- Factory output that serializes identically to planner output — the runner consumes both without distinction

## Non-Functional Requirements

- The `Migration` base class interface is target-agnostic (so the SQL target can provide its own version later). **Assumption:** a generic `Migration<TOperation>` base in the framework, with a Mongo-specific alias that fixes the type parameter.
- No changes to the existing `MongoMigrationPlanner` or `MongoMigrationRunner`

## Non-goals

- Rewriting the Mongo planner to use factory functions internally — the planner works; refactoring it is separate
- Data transform support for Mongo migrations
- CLI integration (`prisma migration new/plan/verify` for Mongo) — future work
- Scaffolding tooling (auto-generating `migration.ts` from planner output) — future work
- Transaction support for Mongo migrations

# Acceptance Criteria

## Authoring a migration

- [ ] A migration file with `export default class extends Migration` and factory function calls in `plan()` type-checks and runs with `node migration.ts`
- [ ] The file produces `ops.json` in its own directory
- [ ] Running with `--dry-run` prints operations to stdout without writing `ops.json`
- [ ] Running with `--help` prints usage information

## Importing a migration

- [ ] When imported (not run directly), `Migration.run(import.meta)` is a no-op
- [ ] The default export class can be instantiated and `plan()` called directly (for CLI and test use)

## Operation correctness

- [ ] Each factory (`createIndex`, `dropIndex`, `createCollection`, `dropCollection`, `collMod`) produces a `MongoMigrationPlanOperation` with the correct prechecks, commands, and postchecks
- [ ] Factory output serializes identically to planner output for the same operation (verified by test comparing JSON output)
- [ ] Round-trip works: factory → `JSON.stringify` → `deserializeMongoOps` → runner execution

## Composition

- [ ] At least one compound strategy function composes multiple factories and returns a flat operation list
- [ ] The strategy is a plain exported function — users compose operations the same way

# References

- [Migration Authoring Design Proposal](assets/migration-authoring-design.md)
- Existing Mongo migration system:
  - `packages/3-mongo-target/2-mongo-adapter/src/core/mongo-planner.ts` — planner
  - `packages/3-mongo-target/2-mongo-adapter/src/core/mongo-ops-serializer.ts` — serializer/deserializer
  - `packages/3-mongo-target/2-mongo-adapter/src/core/mongo-runner.ts` — runner
- Mongo query AST (command classes, filter expressions):
  - `packages/2-mongo-family/4-query/query-ast/src/ddl-commands.ts`
  - `packages/2-mongo-family/4-query/query-ast/src/inspection-commands.ts`
  - `packages/2-mongo-family/4-query/query-ast/src/filter-expressions.ts`
  - `packages/2-mongo-family/4-query/query-ast/src/migration-operation-types.ts`

# Decisions

1. **Factory functions and planner co-located in `packages/3-mongo-target/1-mongo-target`.** Exported from `@prisma-next/target-mongo/migration`. Users import everything from one place: `import { Migration, createIndex } from "@prisma-next/target-mongo/migration"`.

2. **Factory signatures are an implementation detail.** The only constraint is that the planner can depend on the factory functions it uses. Since both live in the same package, the signatures can evolve freely.
