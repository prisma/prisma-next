# CLI Operation Display Generalization

## Context

The CLI uses `extractSqlDdl(operations)` to extract DDL statements from migration operations for display in `migration plan`, `migration show`, and `db update`. This function peeks into `execute[].sql` — tightly coupled to the SQL operation shape. For Mongo operations, there are no SQL strings; the execute steps contain DDL command AST nodes.

Three CLI code paths reference `extractSqlDdl`:
- `migration-plan.ts` — after planning, includes `sql: extractSqlDdl(plan.operations)` in the result
- `migration-show.ts` — reads persisted ops and extracts SQL for display
- `db-update.ts` — guarded by `familyInstance.familyId === 'sql'`, includes SQL in plan mode output

## Decision

For M1, introduce a family-provided formatter alongside the existing `extractSqlDdl`. The CLI branches on family: SQL uses the existing path, Mongo uses a formatter provided by the target's migration capability.

The formatter lives in the target package (`packages/3-mongo-target/`) and uses the `MongoDdlCommandVisitor<string>` pattern from the [DDL command dispatch spec](ddl-command-dispatch.spec.md).

## M1 design

### Formatter function

```typescript
function formatMongoOperations(operations: readonly MigrationPlanOperation[]): string[] {
  const formatter = new MongoDdlCommandFormatter();
  const statements: string[] = [];

  for (const operation of operations) {
    const mongoOp = operation as MongoMigrationPlanOperation;
    for (const step of mongoOp.execute) {
      statements.push(step.command.accept(formatter));
    }
  }

  return statements;
}
```

The `MongoDdlCommandFormatter` is a `MongoDdlCommandVisitor<string>`:

```typescript
class MongoDdlCommandFormatter implements MongoDdlCommandVisitor<string> {
  createIndex(cmd: CreateIndexCommand): string {
    const keySpec = cmd.keys.map(k => `${k.field}: ${k.direction}`).join(', ');
    const opts = this.formatOptions(cmd);
    return `db.${cmd.collection}.createIndex({ ${keySpec} }${opts})`;
  }

  dropIndex(cmd: DropIndexCommand): string {
    return `db.${cmd.collection}.dropIndex("${cmd.name}")`;
  }

  private formatOptions(cmd: CreateIndexCommand): string {
    const parts: string[] = [];
    if (cmd.unique) parts.push('unique: true');
    if (cmd.sparse) parts.push('sparse: true');
    if (cmd.expireAfterSeconds != null) parts.push(`expireAfterSeconds: ${cmd.expireAfterSeconds}`);
    if (cmd.name) parts.push(`name: "${cmd.name}"`);
    return parts.length ? `, { ${parts.join(', ')} }` : '';
  }
}
```

### CLI integration

The CLI gains a generic path:

```typescript
function extractOperationStatements(
  familyId: string,
  operations: readonly MigrationPlanOperation[],
): string[] {
  switch (familyId) {
    case 'sql':
      return extractSqlDdl(operations);
    case 'mongo':
      return formatMongoOperations(operations);
    default:
      return [];
  }
}
```

This is pragmatic for M1. The future framework SPI approach (see [operation envelope spec](operation-envelope.spec.md)) would replace this switch with a family-provided formatter function on the `TargetMigrationsCapability` interface.

### Display examples

For `migration plan` output:

```
Migration plan (1 operation):

  [additive] Create index on users (email ascending)
    db.users.createIndex({ email: 1 }, { unique: true, name: "email_1" })
```

For `migration show`:

```
Operations:
  db.users.createIndex({ email: 1 }, { unique: true, name: "email_1" })
```

## Future: framework SPI

When the `Operation<Statement>` generic is extracted, the CLI display would use a family-provided formatter:

```typescript
interface TargetMigrationsCapability<...> {
  // ... existing methods ...
  formatOperationStatements?(operations: readonly MigrationPlanOperation[]): string[];
}
```

The CLI would call `targetDescriptor.migrations.formatOperationStatements(ops)` when available, falling back to `extractSqlDdl` for backward compatibility.

## Package placement

- `MongoDdlCommandFormatter` — `packages/3-mongo-target/` (target-specific, presentation concern)
- `formatMongoOperations` — `packages/3-mongo-target/` (exported for CLI use)
- `extractOperationStatements` — `packages/1-framework/3-tooling/cli/` (CLI dispatch)
