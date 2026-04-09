# @prisma-next/mongo-schema-ir

MongoDB Schema Intermediate Representation (IR) for migration diffing.

## Overview

This package defines the in-memory representation of MongoDB collection schemas used by the migration planner to diff desired vs. actual state. It provides an immutable AST of collections, indexes, validators, and collection options, plus comparison utilities for index equivalence.

## Responsibilities

- **Schema AST nodes**: `MongoSchemaCollection`, `MongoSchemaIndex`, `MongoSchemaValidator`, `MongoSchemaCollectionOptions` — frozen, visitable AST nodes representing MongoDB schema elements.
- **Index equivalence**: `indexesEquivalent()` compares two `MongoSchemaIndex` nodes field-by-field (keys, direction, unique, sparse, TTL, partial filter). Used by the planner to decide create/drop operations.
- **Deep equality**: `deepEqual()` provides order-sensitive structural comparison for MongoDB values (objects compare key order, matching BSON semantics).
- **Visitor pattern**: `MongoSchemaVisitor<R>` enables extensible traversal without modifying AST nodes.

## Dependencies

- **`@prisma-next/mongo-contract`**: `MongoIndexKey` type for index key definitions.

**Dependents:**

- `@prisma-next/adapter-mongo` — uses the schema IR for contract-to-schema conversion, migration planning, and filter evaluation.
- `@prisma-next/mongo-emitter` — produces schema IR during contract emission.

## Usage

```typescript
import {
  MongoSchemaCollection,
  MongoSchemaIndex,
  indexesEquivalent,
} from '@prisma-next/mongo-schema-ir';

const index = new MongoSchemaIndex({
  keys: [{ field: 'email', direction: 1 }],
  unique: true,
});

const collection = new MongoSchemaCollection({
  name: 'users',
  indexes: [index],
});

// Compare indexes for equivalence
const other = new MongoSchemaIndex({
  keys: [{ field: 'email', direction: 1 }],
  unique: true,
});
indexesEquivalent(index, other); // true
```

## Architecture

- **Domain**: `mongo`
- **Layer**: `tooling`
- **Plane**: `shared` (migration-plane)
