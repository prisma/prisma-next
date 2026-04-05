# @prisma-next/contract

Core contract data types and JSON schemas for Prisma Next.

## Overview

This package provides the foundational type definitions for Prisma Next data contracts:

- **Contract data types**: The canonical description of an application's data model and storage layout (`ContractBase`, `DocumentContract`, `Source`, `FieldType`)
- **Plan types**: Target-family-agnostic execution plan types (`ExecutionPlan`, `PlanMeta`, `ParamDescriptor`)
- **Hash types**: Branded hash types for storage, execution, and profile hashing (`StorageHashBase`, `ExecutionHashBase`, `ProfileHashBase`)
- **JSON Schemas**: Validation schemas for contract files
- **Type guards**: Runtime type guards for narrowing contract types (`isDocumentContract`)

This package is a **foundation-layer leaf** — it has no framework-domain dependencies and is consumed by all layers above it.

## Usage

```typescript
import type {
  Contract,
  ContractMarkerRecord,
  DocumentContract,
  ExecutionPlan,
  PlanMeta,
} from '@prisma-next/contract/types';
import { isDocumentContract, coreHash, profileHash } from '@prisma-next/contract/types';

if (isDocumentContract(contract)) {
  const collections = contract.storage.document.collections;
}
```

### JSON Schema Validation

Reference the appropriate JSON schema in your `contract.json` files to enable IDE validation:

```json
{
  "$schema": "node_modules/@prisma-next/contract/schemas/data-contract-document-v1.json",
  "schemaVersion": "1",
  "target": "mongodb",
  "targetFamily": "document",
  "storageHash": "sha256:..."
}
```

For SQL contracts, use `@prisma-next/sql-contract-ts/schemas/data-contract-sql-v1.json` instead.

## Exports

- `./types`: Contract data types, hash types, plan types, type guards
- `./hashing`: Contract hashing utilities
- `./testing`: Test helpers for creating contract fixtures
- `./validate-contract`: Contract structure validation
- `./validate-domain`: Domain model validation

## Type System

### Plan Types

`ParamDescriptor` describes a single parameter in an execution plan:

- **`source`**: Origin of the parameter (`'dsl'`, `'raw'`, or `'lane'`)
- **`index`** (optional): 1-based position into `plan.params`
- **`name`** (optional): Parameter name for codec resolution
- **`codecId`**, **`nativeType`**, **`nullable`** (optional): Type metadata from contract
- **`refs`** (optional): `{ table, column }` when the param is used against a known column

### Column Defaults

- When adding column defaults, re-emit the contract and verify the emitted JSON includes the full default payload.
- Keep `nullable: false` explicit for columns with defaults in emitted contracts.
- Add the corresponding `defaults.*` capability when using function defaults like `autoincrement()` or `now()`.

## Dependencies

- **`@prisma-next/utils`**: Shared utility functions

## Related Subsystems

- [Data Contract](../../../../../docs/architecture%20docs/subsystems/1.%20Data%20Contract.md)
- [Contract Emitter & Types](../../../../../docs/architecture%20docs/subsystems/2.%20Contract%20Emitter%20&%20Types.md)

## Related ADRs

- [ADR 001 - Migrations as Edges](../../../../../docs/architecture%20docs/adrs/ADR%20001%20-%20Migrations%20as%20Edges.md)
- [ADR 004 - Storage Hash vs Profile Hash](../../../../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md)
- [ADR 010 - Canonicalization Rules](../../../../../docs/architecture%20docs/adrs/ADR%20010%20-%20Canonicalization%20Rules.md)
- [ADR 021 - Contract Marker Storage](../../../../../docs/architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md)
- [ADR 183 - SPI types live at the lowest consuming layer](../../../../../docs/architecture%20docs/adrs/ADR%20183%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md)
