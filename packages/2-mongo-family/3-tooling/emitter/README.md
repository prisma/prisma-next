# @prisma-next/mongo-emitter

Mongo target-family emitter hook for Prisma Next contract emission.

## What it does

Implements the `TargetFamilyHook` interface for Mongo contracts, generating `contract.d.ts` type definitions that follow [ADR 172](../../../../docs/architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md) (domain-storage separation) and [ADR 177](../../../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) (ownership replaces relation strategy).

## When to use it

Pass `mongoTargetFamilyHook` to the `emit()` function when generating contracts for a Mongo target:

```typescript
import { emit } from '@prisma-next/emitter';
import { mongoTargetFamilyHook } from '@prisma-next/mongo-emitter';

const result = emit(contractIR, mongoTargetFamilyHook, options);
```

## What it provides

- **`validateTypes(ir, ctx)`** — validates Mongo codec ID format (`ns/name@version`)
- **`validateStructure(ir)`** — validates Mongo-specific contract structure:
  - `targetFamily === 'mongo'`
  - `storage.collections` exists and is consistent with model storage
  - Owner/embedded model constraints (owned models have no collection)
  - Polymorphic variant/base collection sharing
  - `storage.relations` consistency with owned models
- **`generateContractTypes(ir, ...)`** — generates the `contract.d.ts` content using:
  - Shared domain-level utilities from `@prisma-next/emitter` (roots, model fields, relations, imports, hashes)
  - Mongo-specific storage type generation (collections, embedded document storage, `storage.relations`)

## Architecture

- **Domain**: `mongo`
- **Layer**: `tooling`
- **Plane**: `migration`

Uses shared domain-level generation utilities from `@prisma-next/emitter/domain-type-generation`. The SQL emitter will be migrated to these same utilities in M6.
