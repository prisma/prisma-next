# @prisma-next/contract

Data contract type definitions and JSON schema for Prisma Next.

## Overview

This package provides TypeScript type definitions and a JSON Schema for Prisma Next data contracts. The data contract is the canonical description of an application's data model and storage layout, independent of any specific query language or database target.

## Package Contents

- **TypeScript Types**: Type definitions for `DataContract`, `ContractStorage`, `StorageTable`, and `StorageColumn`
- **JSON Schema**: Schema definition for validating `contract.json` files in IDEs and tooling

## Usage

### TypeScript Types

Import contract types in your TypeScript code:

```typescript
import type { DataContract, ContractStorage } from '@prisma-next/contract/types';
```

### JSON Schema Validation

Reference the JSON schema in your `contract.json` files to enable IDE validation and autocomplete:

```json
{
  "$schema": "node_modules/@prisma-next/contract/schemas/data-contract-v1.json",
  "target": "postgres",
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

After installing this package, IDEs like VS Code will automatically:
- Validate your contract structure
- Provide autocomplete for properties
- Show descriptions and constraints in tooltips
- Highlight errors for invalid configurations

### Schema Reference

The JSON schema validates the following structure:

- **`target`** (required): Database target identifier (e.g., `"postgres"`, `"mysql"`)
- **`targetFamily`** (optional): Target family classification (currently `"sql"`)
- **`coreHash`** (required): SHA-256 hash of the core schema structure
- **`profileHash`** (optional): SHA-256 hash of the capability profile
- **`storage`** (required): Storage layout definition
  - **`tables`**: Object mapping table names to table definitions
    - Each table includes:
      - **`columns`**: Column definitions with `type` and `nullable` properties
      - **`primaryKey`** (optional): Primary key constraint
      - **`uniques`** (optional): Array of unique constraints
      - **`indexes`** (optional): Array of index definitions
      - **`foreignKeys`** (optional): Array of foreign key constraints

## Exports

- `./types`: TypeScript type definitions
- `./schema`: JSON Schema file (`schemas/data-contract-v1.json`)

## Related Packages

- `@prisma-next/sql`: SQL query builder and plan types (re-exports contract types for backward compatibility)
- `@prisma-next/runtime`: Runtime execution engine that consumes contracts

