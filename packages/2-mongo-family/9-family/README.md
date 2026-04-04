# @prisma-next/family-mongo

Mongo family descriptor for Prisma Next.

## Purpose

Provides the Mongo family descriptor (`ControlFamilyDescriptor`) that includes:
- The Mongo target family hook (`mongoTargetFamilyHook`)
- Factory method (`create()`) to create family instances
- The Mongo target descriptor with codec type imports

## Responsibilities

- **Family Descriptor Export**: Exports the Mongo `ControlFamilyDescriptor` for use in CLI configuration files and the Mongo demo
- **Family Instance Creation**: Creates `MongoControlFamilyInstance` objects that implement control-plane domain actions (`validateContract`, `emitContract`)
- **Family Hook Integration**: Integrates the Mongo target family hook (`mongoTargetFamilyHook`) from `@prisma-next/mongo-emitter`
- **Target Descriptor Export**: Exports a pre-built `mongoTargetDescriptor` with codec type imports pointing to `@prisma-next/mongo-core/codec-types`
- **Contract Validation**: Validates Mongo contract JSON via `validateMongoContract()` from `@prisma-next/mongo-core`
- **Contract Emission**: Emits `contract.json` and `contract.d.ts` for the Mongo family using the shared `emit()` pipeline

## Usage

```typescript
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';
import { createControlStack } from '@prisma-next/framework-components/control';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
});

const familyInstance = mongoFamilyDescriptor.create(stack);

const contract = familyInstance.validateContract(contractJson);
const result = await familyInstance.emitContract({ contract });
```

## Package Structure

- **`src/core/control-descriptor.ts`**: `MongoFamilyDescriptor` class implementing `ControlFamilyDescriptor` (pure data + factory)
- **`src/core/control-instance.ts`**: `createMongoFamilyInstance()` factory and `MongoControlFamilyInstance` interface with domain action methods (`validateContract`, `emitContract`)
- **`src/core/mongo-target-descriptor.ts`**: Pre-built `mongoTargetDescriptor` with codec type import metadata
- **`src/exports/control.ts`**: Control plane entry point

## Entrypoints

- **`./control`**: Control plane entry point — exports `mongoFamilyDescriptor`, `mongoTargetDescriptor`, `createMongoFamilyInstance`, and `MongoControlFamilyInstance`

## Dependencies

- **`@prisma-next/framework-components`**: `ControlStack`, `ControlFamilyDescriptor`, component types
- **`@prisma-next/core-control-plane`**: `emit()` function, control-plane types (re-exported from `framework-components`)
- **`@prisma-next/contract`**: `Contract`, `ContractMarkerRecord`
- **`@prisma-next/mongo-core`**: `MongoContract`, `validateMongoContract()`
- **`@prisma-next/mongo-emitter`**: `mongoTargetFamilyHook`
- **`@prisma-next/target-mongo`**: Target descriptor metadata

**Dependents:**
- `examples/mongo-demo/` imports this package to wire the Mongo control plane
