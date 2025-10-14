# @prisma/relational-ir

Intermediate Representation (IR) for relational data contracts with utilities for schema analysis and relation graph building.

## Goals

- Define the canonical data contract IR format
- Provide utilities for working with relational schemas
- Enable relation graph building from foreign key constraints
- Support schema validation and analysis
- Serve as the foundation for query building and migration planning

## Architecture

The package consists of several key components:

- **Schema Types**: Core IR type definitions with arktype validation
- **Relation Graph**: Builds directed graphs from foreign key relationships
- **Schema Utilities**: Functions for analyzing constraints, indexes, and relationships
- **IR Parser**: Utilities for working with serialized IR data

## Installation

```bash
# In a workspace environment
pnpm add @prisma/relational-ir
```

## Exports

### Main Export

- Schema types and validation (via arktype)
- `buildRelationGraph(ir: Schema): RelationGraph` - Builds relation edges from foreign keys
- `resolveUnique(ir, table, columns)` - Resolves unique constraints
- `hasIndexForEquality(ir, table, column)` - Checks for equality query indexes
- IR parsing utilities

### Sub-exports

- `@prisma/relational-ir/schema` - Core schema type definitions

## Usage Examples

### Working with Schema IR

```typescript
import { Schema } from '@prisma/relational-ir';

const contractIR: Schema = {
  version: 3,
  target: 'postgres',
  contractHash: 'sha256:abc123...',
  tables: {
    user: {
      columns: {
        id: { type: 'int4', pk: true },
        email: { type: 'text', unique: true }
      },
      foreignKeys: [{
        columns: ['profileId'],
        references: { table: 'profile', columns: ['id'] }
      }]
    }
  }
};
```

### Building Relation Graphs

```typescript
import { buildRelationGraph } from '@prisma/relational-ir';

const relationGraph = buildRelationGraph(contractIR);

// Get all relations from a table
const userRelations = relationGraph.edges.get('user') || [];
console.log(userRelations); // [{ from: { table: 'user', columns: ['profileId'] }, to: { table: 'profile', columns: ['id'] }, cardinality: 'N:1', name: 'profile' }]

// Get reverse relations (1:N)
const profileRelations = relationGraph.reverseEdges.get('profile') || [];
console.log(profileRelations); // [{ from: { table: 'user', columns: ['profileId'] }, to: { table: 'profile', columns: ['id'] }, cardinality: '1:N', name: 'user' }]
```

### Schema Analysis

```typescript
import { resolveUnique, hasIndexForEquality } from '@prisma/relational-ir';

// Check if columns form a unique constraint
const uniqueConstraint = resolveUnique(contractIR, 'user', ['email']);
if (uniqueConstraint) {
  console.log(`Found ${uniqueConstraint.kind}: ${uniqueConstraint.columns.join(', ')}`);
}

// Check if a column has an index for equality queries
const hasIndex = hasIndexForEquality(contractIR, 'user', 'email');
console.log(`Email column has index: ${hasIndex}`);
```

### IR Parsing

```typescript
import { parseIR } from '@prisma/relational-ir';

// Parse IR from JSON string
const irString = JSON.stringify(contractIR);
const parsedIR = parseIR(irString);
```

## Related Packages

- **Dependencies**:
  - `arktype` - Runtime type validation
- **Used by**:
  - `@prisma/schema-emitter` - Validates emitted IR
  - `@prisma/sql` - Provides schema context for queries
  - `@prisma/runtime` - Contract verification
  - `@prisma/migrate` - Migration planning
  - `@prisma/orm` - Relation navigation

## Design Principles

- **Contract-First**: IR represents a verifiable data contract, not just a schema
- **Composable Primitives**: Each utility function has a single responsibility
- **Type Safety**: Full TypeScript support with runtime validation via arktype
- **AI-Friendly**: Machine-readable format enables agent-based development
- **Deterministic**: IR format is stable and hashable for verification
