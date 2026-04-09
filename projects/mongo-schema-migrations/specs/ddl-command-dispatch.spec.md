# DDL Command Dispatch via Visitor

## Context

The mongo-query-ast package contains DML commands (`InsertOneCommand`, `AggregateCommand`, etc.) that extend `MongoAstNode` with `kind` + `freeze()` but no `accept(visitor)`. Consumers dispatch on `kind` via switch statements. The filter expression and pipeline stage ASTs, by contrast, use the visitor pattern (`accept<R>(visitor): R`) for compile-time exhaustive dispatch.

M1 introduces DDL commands (`CreateIndexCommand`, `DropIndexCommand`) and inspection commands (`ListIndexesCommand`, `ListCollectionsCommand`) for migration operations. These commands need dispatch in two independent contexts:
1. **Command execution** — the runner maps each command to a MongoDB driver call
2. **Display formatting** — the CLI renders each command as a human-readable string

A switch statement would work, but a visitor gives compile-time exhaustiveness: adding a new command kind forces implementation in every consumer. This is the same benefit that filter/stage/agg expression visitors provide.

## Decision

DDL commands and inspection commands implement `accept<R>(visitor): R`. DML commands keep the current switch-based dispatch for now (follow-up: [TML-2234](https://linear.app/prisma-company/issue/TML-2234)).

## DDL command visitor

```typescript
interface MongoDdlCommandVisitor<R> {
  createIndex(command: CreateIndexCommand): R;
  dropIndex(command: DropIndexCommand): R;
  // M2 additions:
  // createCollection(command: CreateCollectionCommand): R;
  // dropCollection(command: DropCollectionCommand): R;
  // collMod(command: CollModCommand): R;
}
```

Each DDL command class implements:

```typescript
class CreateIndexCommand extends MongoAstNode {
  readonly kind = 'createIndex' as const;
  // ... fields ...

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.createIndex(this);
  }
}
```

### Consumers

**Command executor** (in `packages/3-mongo-target/`):

```typescript
class MongoCommandExecutor implements MongoDdlCommandVisitor<Promise<void>> {
  constructor(private db: Db) {}

  async createIndex(cmd: CreateIndexCommand): Promise<void> {
    const keySpec = keysToDriverSpec(cmd.keys);
    await this.db.collection(cmd.collection).createIndex(keySpec, {
      unique: cmd.unique,
      sparse: cmd.sparse,
      expireAfterSeconds: cmd.expireAfterSeconds,
      partialFilterExpression: cmd.partialFilterExpression,
      name: cmd.name,
    });
  }

  async dropIndex(cmd: DropIndexCommand): Promise<void> {
    await this.db.collection(cmd.collection).dropIndex(cmd.name);
  }
}
```

**Command formatter** (for CLI display):

```typescript
class MongoDdlCommandFormatter implements MongoDdlCommandVisitor<string> {
  createIndex(cmd: CreateIndexCommand): string {
    const keySpec = formatKeySpec(cmd.keys);
    const opts = formatIndexOptions(cmd);
    return `db.${cmd.collection}.createIndex(${keySpec}${opts ? `, ${opts}` : ''})`;
  }

  dropIndex(cmd: DropIndexCommand): string {
    return `db.${cmd.collection}.dropIndex("${cmd.name}")`;
  }
}
```

## Inspection command visitor

```typescript
interface MongoInspectionCommandVisitor<R> {
  listIndexes(command: ListIndexesCommand): R;
  listCollections(command: ListCollectionsCommand): R;
}
```

The runner's check evaluation phase dispatches inspection commands through this visitor to retrieve result documents from the database.

## Union types

```typescript
type AnyMongoDdlCommand = CreateIndexCommand | DropIndexCommand;
type AnyMongoInspectionCommand = ListIndexesCommand | ListCollectionsCommand;
```

These are exported from `@prisma-next/mongo-query-ast/control` alongside the visitor interfaces.

## Package placement

DDL commands, inspection commands, and their visitors live in `@prisma-next/mongo-query-ast` under the `/control` entrypoint. The executor and formatter implementations live in `packages/3-mongo-target/` since they depend on the MongoDB driver and CLI presentation concerns.

## Why not visitors on DML commands?

DML commands (`InsertOneCommand`, etc.) are dispatched through the query plan execution pipeline, which already has its own dispatch mechanism. Adding visitors to them is a separate improvement tracked in [TML-2234](https://linear.app/prisma-company/issue/TML-2234).
