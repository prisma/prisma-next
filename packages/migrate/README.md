# @prisma/migrate

State-based migration planner and runner. Compares two contract IRs and generates migration programs with safety checks.

## Goals

- Plan migrations by comparing contract states (not migration history)
- Generate safe migration programs with DDL operations
- Support additive changes in MVP (tables, columns, constraints, indexes)
- Provide deterministic migration artifacts
- Enable migration execution with rollback capabilities

## Architecture

The package consists of several key components:

- **Migration Planner**: Compares contracts and generates operation sets
- **Admin Connection**: Database admin operations for DDL execution
- **Script AST**: Type-safe representation of DDL operations
- **Lowering**: Converts IR operations to SQL DDL
- **Migration Runner**: Executes migration programs safely

## Installation

```bash
# In a workspace environment
pnpm add @prisma/migrate
```

## Exports

### Main Export

- `planMigration(contractA, contractB)` - Migration planner
- `AdminConnection` - Database admin operations
- `executeMigrationProgram()` - Migration runner
- Script AST types (DDL operations)
- Lowering utilities (IR → SQL DDL) for Postgres

## Usage Examples

### Planning a Migration

```typescript
import { planMigration } from '@prisma/migrate';
import contractA from './contract-v1.json';
import contractB from './contract-v2.json';

// Plan migration from contract A to contract B
const migration = await planMigration(contractA, contractB, {
  id: 'add-user-profile',
  rulesVersion: '1'
});

console.log('Migration artifacts:', migration);
// {
//   opset: [...], // Array of DDL operations
//   opSetHash: 'sha256:...', // Deterministic hash
//   meta: { ... }, // Migration metadata
//   diff: { ... }, // Human-readable diff
//   notes: '...' // Markdown summary
// }
```

### Migration Program Structure

```typescript
import { MigrationProgram, DDLOperation } from '@prisma/migrate';

// Migration program contains:
interface MigrationProgram {
  opset: DDLOperation[]; // Array of DDL operations
  opSetHash: string; // Deterministic hash
  meta: {
    id: string;
    fromHash: string;
    toHash: string;
    createdAt: string;
    rulesVersion: string;
  };
  diff: {
    summary: string;
    changes: ChangeDetail[];
  };
  notes: string; // Markdown documentation
}

// DDL operations are type-safe
type DDLOperation =
  | { kind: 'create_table'; table: string; columns: ColumnDef[] }
  | { kind: 'add_column'; table: string; column: ColumnDef }
  | { kind: 'add_unique'; table: string; columns: string[] }
  | { kind: 'add_index'; table: string; columns: string[]; unique?: boolean }
  | { kind: 'add_foreign_key'; table: string; fk: ForeignKeyDef };
```

### Executing Migrations

```typescript
import { AdminConnection, executeMigrationProgram } from '@prisma/migrate';

const admin = new AdminConnection({
  connectionString: process.env.DATABASE_URL
});

// Execute migration program
const result = await executeMigrationProgram(migration, admin);

console.log('Migration result:', result);
// {
//   success: true,
//   operationsExecuted: 3,
//   durationMs: 150,
//   rollbackOperations: [...] // For potential rollback
// }
```

### Admin Connection Operations

```typescript
import { AdminConnection } from '@prisma/migrate';

const admin = new AdminConnection({
  connectionString: process.env.DATABASE_URL
});

// Check if table exists
const tableExists = await admin.tableExists('users');
console.log('Table exists:', tableExists);

// Get table schema
const tableSchema = await admin.getTableSchema('users');
console.log('Table schema:', tableSchema);

// Execute DDL directly
await admin.executeDDL('CREATE TABLE test (id SERIAL PRIMARY KEY)');

// Check database capabilities
const capabilities = await admin.getCapabilities();
console.log('Database capabilities:', capabilities);
```

### Migration Safety Checks

```typescript
import { planMigration } from '@prisma/migrate';

try {
  const migration = await planMigration(contractA, contractB);
  console.log('Migration planned successfully');
} catch (error) {
  if (error.message.includes('unsupported change')) {
    console.error('Migration contains unsupported changes:', error.message);
    // Handle unsupported changes (renames, drops, etc.)
  }
}
```

### Supported Operations (MVP)

The migration planner currently supports these additive operations:

```typescript
// ✅ Supported operations
const supportedOps = [
  'create_table',      // Create new tables
  'add_column',        // Add columns to existing tables
  'add_unique',        // Add unique constraints
  'add_index',         // Add indexes
  'add_foreign_key'    // Add foreign key constraints
];

// ❌ Not supported in MVP
const unsupportedOps = [
  'drop_table',        // Table drops
  'drop_column',       // Column drops
  'rename_table',      // Table renames
  'rename_column',     // Column renames
  'alter_column_type', // Type changes
  'drop_constraint'    // Constraint drops
];
```

### Migration Artifacts

Each migration generates several artifacts:

```typescript
// meta.json - Migration metadata
{
  "id": "add-user-profile",
  "fromHash": "sha256:abc123...",
  "toHash": "sha256:def456...",
  "createdAt": "2024-01-15T10:30:00Z",
  "rulesVersion": "1"
}

// opset.json - DDL operations
[
  {
    "kind": "add_column",
    "table": "user",
    "column": {
      "name": "profileId",
      "type": "int4",
      "nullable": true
    }
  },
  {
    "kind": "add_foreign_key",
    "table": "user",
    "fk": {
      "columns": ["profileId"],
      "references": { "table": "profile", "columns": ["id"] }
    }
  }
]

// diff.json - Machine-readable diff
{
  "summary": "Added profile relation to user table",
  "changes": [
    {
      "type": "add_column",
      "table": "user",
      "column": "profileId",
      "details": "Added nullable int4 column"
    }
  ]
}

// notes.md - Human-readable summary
# Migration: add-user-profile

## Summary
Added profile relation to user table.

## Changes
- Added `profileId` column to `user` table
- Added foreign key constraint linking to `profile.id`
```

### Custom Migration Rules

```typescript
import { planMigration, PlannerOptions } from '@prisma/migrate';

const options: PlannerOptions = {
  id: 'custom-migration',
  rulesVersion: '2', // Use different rule set
  // Future: custom rules configuration
};

const migration = await planMigration(contractA, contractB, options);
```

## Related Packages

- **Dependencies**:
  - `@prisma/relational-ir` - Contract IR types and validation
  - `@prisma/sql` - Query building for admin operations
  - `@prisma/schema-emitter` - Contract comparison utilities
- **Used by**:
  - CLI tools for migration management
  - CI/CD pipelines for database deployments
  - Development workflows

## Design Principles

- **State-Based**: Migrations planned by comparing contract states, not migration history
- **Additive-First**: MVP focuses on safe additive changes
- **Deterministic**: Same contract comparison always produces same migration
- **Type Safety**: DDL operations are type-safe and validated
- **Composable Primitives**: Each operation is a composable building block
- **AI-Friendly**: Machine-readable artifacts enable agent-based migration management
- **Safety**: Built-in checks prevent dangerous operations
