# @prisma-next/contract

Data contract type definitions and JSON schema for Prisma Next.

## Overview

This package provides TypeScript type definitions and JSON Schemas for Prisma Next data contracts. The data contract is the canonical description of an application's data model and storage layout, independent of any specific query language or database target.

The contract supports two target families:
- **SQL**: For relational databases (Postgres, MySQL, SQLite, etc.)
- **Document**: For document databases (MongoDB, Firestore, etc.)

## Package Contents

- **TypeScript Types**: Type definitions for `DataContract`, `SqlContract`, `DocumentContract`, and related types
- **JSON Schemas**: Schema definitions for validating `contract.json` files in IDEs and tooling
  - `data-contract-sql-v1.json` (SQL family)
  - `data-contract-document-v1.json` (Document family)

## Usage

### TypeScript Types

Import contract types in your TypeScript code:

```typescript
import type { DataContract, SqlContract, DocumentContract } from '@prisma-next/contract/types';
import { isSqlContract, isDocumentContract } from '@prisma-next/contract/types';

// Use type guards to narrow the contract type
function processContract(contract: DataContract) {
  if (isSqlContract(contract)) {
    // contract is SqlContract
    console.log(contract.storage.tables);
  } else if (isDocumentContract(contract)) {
    // contract is DocumentContract
    console.log(contract.storage.document.collections);
  }
}
```

### JSON Schema Validation

Reference the appropriate JSON schema in your `contract.json` files to enable IDE validation and autocomplete.

#### SQL Family

For SQL targets (Postgres, MySQL, SQLite, etc.):

```json
{
  "$schema": "node_modules/@prisma-next/contract/schemas/data-contract-sql-v1.json",
  "schemaVersion": "1",
  "target": "postgres",
  "targetFamily": "sql",
  "coreHash": "sha256:...",
  "storage": {
    "tables": {
      "user": {
        "columns": {
          "id": { "type": "int4", "nullable": false },
          "email": { "type": "text", "nullable": false }
        },
        "primaryKey": {
          "columns": ["id"],
          "name": "user_pkey"
        }
      }
    }
  }
}
```

#### Document Family

For Document targets (MongoDB, Firestore, etc.):

```json
{
  "$schema": "node_modules/@prisma-next/contract/schemas/data-contract-document-v1.json",
  "schemaVersion": "1",
  "target": "mongo",
  "targetFamily": "document",
  "coreHash": "sha256:...",
  "storage": {
    "document": {
      "collections": {
        "users": {
          "name": "users",
          "fields": {
            "id": { "type": "objectId", "nullable": false },
            "email": { "type": "string", "nullable": false },
            "profile": {
              "type": "object",
              "nullable": true,
              "properties": {
                "name": { "type": "string", "nullable": false },
                "age": { "type": "int32", "nullable": true }
              }
            }
          },
          "indexes": [
            {
              "name": "email_idx",
              "keys": { "email": "asc" },
              "unique": true
            }
          ]
        }
      }
    }
  }
}
```

After installing this package, IDEs like VS Code will automatically:
- Validate your contract structure
- Provide autocomplete for properties
- Show descriptions and constraints in tooltips
- Highlight errors for invalid configurations

## Schema Reference

### Common Header Fields

All contracts share these common fields:

- **`schemaVersion`** (required): Contract schema version (currently `"1"`)
- **`target`** (required): Database target identifier (e.g., `"postgres"`, `"mongo"`, `"firestore"`)
- **`targetFamily`** (required): Target family classification (`"sql"` or `"document"`)
- **`coreHash`** (required): SHA-256 hash of the core schema structure
- **`profileHash`** (optional): SHA-256 hash of the capability profile
- **`capabilities`** (optional): Capability flags declared by the contract
- **`extensions`** (optional): Extension packs and their configuration
- **`meta`** (optional): Non-semantic metadata (excluded from hashing)
- **`sources`** (optional): Read-only sources (views, etc.) available for querying

### SQL Family Structure

- **`storage.tables`**: Object mapping table names to table definitions
  - Each table includes:
    - **`columns`**: Column definitions with `type` and `nullable` properties
    - **`primaryKey`** (optional): Primary key constraint
    - **`uniques`** (optional): Array of unique constraints
    - **`indexes`** (optional): Array of index definitions
    - **`foreignKeys`** (optional): Array of foreign key constraints

### Document Family Structure

- **`storage.document.collections`**: Object mapping collection names to collection definitions
  - Each collection includes:
    - **`name`**: Logical collection name
    - **`id`** (optional): ID generation strategy (`auto`, `client`, `uuid`, `cuid`, `objectId`)
    - **`fields`**: Field definitions using `FieldType` (supports nested objects and arrays)
    - **`indexes`** (optional): Array of index definitions with keys and optional predicates
    - **`readOnly`** (optional): Whether mutations are disallowed

## Type System

### Union Type

`DataContract` is a union type that can be either `SqlContract` or `DocumentContract`:

```typescript
type DataContract = SqlContract | DocumentContract;
```

### Type Guards

Use type guards to narrow the contract type:

```typescript
import { isSqlContract, isDocumentContract } from '@prisma-next/contract/types';

if (isSqlContract(contract)) {
  // TypeScript knows contract is SqlContract
  const tables = contract.storage.tables;
}

if (isDocumentContract(contract)) {
  // TypeScript knows contract is DocumentContract
  const collections = contract.storage.document.collections;
}
```

## Exports

- `./types`: TypeScript type definitions and type guards
- `./schema-sql`: SQL family JSON Schema (`schemas/data-contract-sql-v1.json`)
- `./schema-document`: Document family JSON Schema (`schemas/data-contract-document-v1.json`)

## Related Packages

- `@prisma-next/sql`: SQL query builder and plan types
- `@prisma-next/runtime`: Runtime execution engine that consumes contracts
