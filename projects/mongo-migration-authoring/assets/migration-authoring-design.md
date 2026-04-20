# Migration Authoring — Design Proposal

## Overview

Migrations are authored as TypeScript files. Each migration file exports a class that extends `Migration` and defines a `plan()` method returning a list of operations. The file is self-contained — run it directly with `node migration.ts` to produce `ops.json`, or let the CLI import it.

This is similar in spirit to Active Record Migrations, where a migration is a Ruby file that subclasses `ActiveRecord::Migration` and expresses schema changes as method calls (`add_column`, `remove_column`, etc.). Our equivalent is a `Migration` subclass whose `plan()` method composes TypeScript factory functions that produce serializable operation objects.

The design has three layers:

1. **Operation factories** — atomic primitives (`addColumn`, `setNotNull`, etc.), each producing a single operation
2. **Strategies** — plain functions that compose the primitives into correct multi-step sequences
3. **Migration class** — the file's export, providing the operation list and a self-executing entrypoint

Everything downstream — the runner, attestation, the migration graph — consumes the same `ops.json` format.

---

## Migration files

A migration file exports a class and makes itself runnable:

```typescript
import { Migration, addColumn } from "@prisma-next/target-postgres/migration"

export default class extends Migration {
  plan() {
    return [
      addColumn("users", "display_name", { type: "varchar", nullable: true }),
    ]
  }
}

Migration.run(import.meta)
```

`node migration.ts` calls `plan()`, serializes the result, and writes `ops.json`. `node migration.ts --dry-run` prints the operations without writing. The CLI can also import the file, get the class, and call `plan()` directly — `Migration.run()` detects that it's not the entrypoint and is a no-op.

The `Migration` base class owns the lifecycle: argument parsing, serialization, output. The author's only job is to return operations from `plan()`.

## Operation factories

Each factory function produces a single `SqlMigrationPlanOperation` — a plain object with `id`, `label`, `operationClass`, and `precheck`/`execute`/`postcheck` arrays containing `{ description, sql }` steps.

```typescript
export default class extends Migration {
  plan() {
    return [
      addColumn("users", "display_name", { type: "varchar", nullable: true }),
      setNotNull("users", "display_name"),
    ]
  }
}
```

The library provides factories for common DDL: `addColumn`, `dropColumn`, `renameColumn`, `addTable`, `dropTable`, `setNotNull`, `dropNotNull`, `setDefault`, `dropDefault`, `addIndex`, `dropIndex`, `addUnique`, `addForeignKey`, `createEnumType`, and so on.

Each factory returns a plain object. `JSON.stringify()` is the serializer.

## Strategies are functions

Some schema changes require multiple operations in a specific order. A strategy is a regular TypeScript function that composes the atomic factories:

```typescript
function nonNullBackfill(table: string, column: string, backfillExpr: string) {
  return [
    addColumn(table, column, { nullable: true }),
    dataTransform(`backfill-${table}-${column}`, {
      check: (db) => /* ... */,
      run: (db) => /* ... */,
    }),
    setNotNull(table, column),
  ]
}
```

It takes parameters, calls the primitives, returns `SqlMigrationPlanOperation[]`. The ordering is correct by construction.

A user writes a migration with it:

```typescript
export default class extends Migration {
  plan() {
    return nonNullBackfill("users", "displayName", "'unnamed'")
  }
}

Migration.run(import.meta)
```

A `renameColumnSafe` strategy does expand-and-contract:

```typescript
export default class extends Migration {
  plan() {
    return renameColumnSafe("users", "name", "full_name")
    // Internally produces: addColumn("full_name") → copyData → dropColumn("name")
  }
}

Migration.run(import.meta)
```

Users write their own strategies the same way — compose the atomic primitives, return the same operation type. A `columnSplit` strategy, a `typeChange` strategy, a `tableExtraction` strategy — each one encapsulates the correct operation sequence for its scenario and asks the user only for the information gap (how to derive the new values from the old).

## Data transforms

A data transform is an operation that modifies data rather than schema. It has a name (its invariant identity for ledger recording and routing), plus a check/run pair:

```typescript
export default class extends Migration {
  plan() {
    return [
      addColumn("users", "first_name", { type: "varchar", nullable: true }),
      addColumn("users", "last_name", { type: "varchar", nullable: true }),
      dataTransform("split-user-name", {
        check: (db) => db.query("SELECT 1 FROM users WHERE first_name IS NULL LIMIT 1"),
        run: (db) => db.query(
          "UPDATE users SET first_name = split_part(name, ' ', 1), " +
          "last_name = split_part(name, ' ', 2) WHERE first_name IS NULL"
        ),
      }),
      setNotNull("users", "first_name"),
      setNotNull("users", "last_name"),
      dropColumn("users", "name"),
    ]
  }
}

Migration.run(import.meta)
```

The name (`"split-user-name"`) is the invariant. The ledger records it on successful completion; routing can require it via environment refs. Check runs before run (retry safety) and after run (validation). Data transforms serialize to JSON ASTs and appear in the operation chain wherever they need to.

### A strategy for column splits

The manual composition above is verbose. A `columnSplit` strategy encapsulates the pattern:

```typescript
export default class extends Migration {
  plan() {
    return columnSplit("users", "name", ["first_name", "last_name"], (db) =>
      db.users.update({
        firstName: expr("split_part(name, ' ', 1)"),
        lastName: expr("split_part(name, ' ', 2)"),
      })
    )
  }
}

Migration.run(import.meta)
```

`columnSplit` internally produces the same six operations — add columns, backfill via the user's expression, tighten constraints, drop the old column. The ordering is correct by construction. The user provides only the derivation logic.

## The planner

The planner's job is scenario detection and strategy selection:

1. Detect which scenario applies (column added as NOT NULL without default, non-widening type change, etc.)
2. Pick the strategy function
3. Call it with the right arguments

The planner calls the exact same functions that users call when authoring migrations by hand. It can either call the strategy directly to produce operations, or scaffold a `migration.ts` that calls it — the result is the same.

Each strategy handles its own ordering internally. Adding support for a new scenario means writing a new strategy function.

## Typed query builder access mid-chain

If a data transform appears partway through an operation chain, the user may want typed query builder access against the schema state at that point. This is a hard problem in general — it would require manipulating TypeScript types through an arbitrary preceding operation sequence.

The practical answer for v1: the user provides an intermediate contract definition. The tools for this already exist — copy the contract authoring surface (PSL or TS builders) into the migration directory, modify it to describe the schema at the point you care about, and emit it:

```
migrations/0003-split-name/
├── migration.ts          # the migration itself
├── intermediate.psl      # schema at the mid-point (after additive ops)
├── intermediate.json     # emitted contract
└── intermediate.d.ts     # emitted types
```

Then import it:

```typescript
import type { Contract } from "./intermediate.d"
import intermediateJson from "./intermediate.json"

export default class extends Migration {
  plan() {
    return [
      addColumn("users", "first_name", { type: "varchar", nullable: true }),
      addColumn("users", "last_name", { type: "varchar", nullable: true }),
      dataTransform<Contract>({
        contract: intermediateJson,
        check: (db) => db.users.findFirst({ where: { firstName: null } }),
        run: (db) => db.users.update({
          firstName: expr("split_part(name, ' ', 1)"),
          lastName: expr("split_part(name, ' ', 2)"),
        }),
      }),
      setNotNull("users", "first_name"),
      setNotNull("users", "last_name"),
      dropColumn("users", "name"),
    ]
  }
}

Migration.run(import.meta)
```

Multiple intermediate contracts are supported — one per data transform if a complex migration needs them.

## Transactions

The operation chain can carry transaction annotations. A `transaction()` wrapper tells the runner to execute a sequence of operations atomically:

```typescript
export default class extends Migration {
  plan() {
    return transaction([
      addColumn("users", "first_name", { type: "varchar", nullable: true }),
      addColumn("users", "last_name", { type: "varchar", nullable: true }),
      dataTransform({ /* ... */ }),
      setNotNull("users", "first_name"),
      setNotNull("users", "last_name"),
      dropColumn("users", "name"),
    ])
  }
}

Migration.run(import.meta)
```

Transaction boundaries are the user's decision — they know whether the table is small enough for a single transaction or whether they need to break it up.

## Multi-migration deployments

In production, you'll often want to deploy application updates between migration steps. A column split is conceptually one change, but in a blue-green / rolling deployment it happens over days:

1. **Deploy migration 1** — add nullable columns
2. **Deploy app** — application dual-writes to old and new columns
3. **Deploy migration 2** — backfill existing rows, tighten constraints, drop old column
4. **Deploy app** — application reads from new columns

Each step is a separate migration file, a separate edge in the graph, applied at the user's pace. The intermediate state (nullable columns exist, not yet backfilled) is a real deployment state — the application may run against it for hours.

```typescript
// Migration 1 (deploy first)
export default class extends Migration {
  plan() {
    return [
      addColumn("users", "first_name", { type: "varchar", nullable: true }),
      addColumn("users", "last_name", { type: "varchar", nullable: true }),
    ]
  }
}

Migration.run(import.meta)
```

```typescript
// Migration 2 (deploy after app update)
export default class extends Migration {
  plan() {
    return [
      dataTransform("split-user-name", {
        check: (db) => db.query("SELECT 1 FROM users WHERE first_name IS NULL LIMIT 1"),
        run: (db) => db.query(
          "UPDATE users SET first_name = split_part(name, ' ', 1), " +
          "last_name = split_part(name, ' ', 2) WHERE first_name IS NULL"
        ),
      }),
      setNotNull("users", "first_name"),
      setNotNull("users", "last_name"),
      dropColumn("users", "name"),
    ]
  }
}

Migration.run(import.meta)
```

The user knows their deployment process; they decide the granularity.

## Serialization model

Operations are plain objects. `SqlMigrationPlanOperation` is an interface with `id`, `label`, `operationClass`, plus `precheck`/`execute`/`postcheck` arrays containing `{ description, sql }` steps. Factory functions return these directly. `JSON.stringify(operations)` is the serializer.

The Mongo migration system already follows this pattern — command classes (`CreateIndexCommand`, `DropIndexCommand`, etc.) store everything as public readonly properties, and `JSON.stringify()` produces the on-disk format directly:

```typescript
function serializeMongoOps(ops) {
  return JSON.stringify(ops, null, 2);
}
```

The SQL case is the same principle with even simpler data — plain interfaces rather than class instances.

## Self-contained files

The migration file is self-contained. Two things happen in every file:

1. **Declare** — export a `Migration` subclass with a `plan()` method that returns operations
2. **Run** — `Migration.run(import.meta)` makes the file directly executable

`node migration.ts` produces `ops.json`. The CLI can also import the file, get the class, and call `plan()` — `Migration.run()` detects it's not the entrypoint and is a no-op. The `Migration` base class handles argument parsing (`--dry-run`, `--help`), serialization, and output.

The file is a pure declaration of what the migration produces, plus one line that makes it runnable. The framework owns everything else.

---

## Summary

1. **Migration class** — each file exports a `Migration` subclass with a `plan()` method. `Migration.run(import.meta)` makes it directly executable.
2. **Operation factories** — atomic primitives (`addColumn`, `dropColumn`, etc.) that each produce a single `SqlMigrationPlanOperation`
3. **Strategies as functions** — regular TypeScript functions that compose the primitives into correct operation sequences (`nonNullBackfill`, `columnSplit`, `typeChange`). Users write their own the same way. The planner calls the same functions.
4. **Data transforms** — operations in the chain with check/run semantics and an invariant name for ledger/routing
5. **Direct serialization** — operations are plain objects that serialize to JSON via `JSON.stringify`
6. **Intermediate contracts** provided by the user when typed query builder access is needed mid-chain
7. **Transaction annotations** as a composable primitive
8. **Multi-migration deployments** when the user needs app updates between steps

The planner detects scenarios and calls strategy functions. The strategy encapsulates ordering. The runner consumes `ops.json`. Everything composes through plain functions and plain JSON.

## Open questions

1. **What's the minimal strategy set for VP1?** Probably just the manual composition path (raw operations) to prove the model, plus one strategy (`columnSplit` or `nonNullBackfill`) to demonstrate the pattern.
2. **Should the planner ever produce multi-migration sequences automatically?** Or is splitting into multiple migrations always a manual decision? Leaning toward manual — the planner scaffolds a single migration, the user splits when their deployment process requires it.
