# @prisma-next/sql-tooling-assembly

SQL family assembly helpers for extension pack manifests.

## Purpose

Provides functions to assemble operation registries and extract type imports from extension pack descriptors. Used by the SQL family CLI entry point to process adapter, target, and extension descriptors.

## Responsibilities

- **Operation Registry Assembly**: Converts operation manifests from descriptors to SQL operation signatures and registers them
- **Type Import Extraction**: Extracts codec and operation type imports from descriptor manifests
- **Extension ID Extraction**: Extracts extension IDs in deterministic order (adapter → target → extensions)

## Usage

```typescript
import {
  assembleOperationRegistryFromDescriptors,
  extractCodecTypeImportsFromDescriptors,
  extractOperationTypeImportsFromDescriptors,
  extractExtensionIdsFromDescriptors,
} from '@prisma-next/sql-tooling-assembly';

const registry = assembleOperationRegistryFromDescriptors([adapter, target, ...extensions]);
const codecImports = extractCodecTypeImportsFromDescriptors([adapter, target, ...extensions]);
const operationImports = extractOperationTypeImportsFromDescriptors([adapter, target, ...extensions]);
const extensionIds = extractExtensionIdsFromDescriptors(adapter, target, extensions);
```

