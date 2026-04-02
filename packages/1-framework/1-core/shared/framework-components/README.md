# @prisma-next/framework-components

Framework component types, authoring logic, and control stack assembly for Prisma Next.

## What this package provides

- **Component types** (`./components`): Base descriptor and instance interfaces for framework components (family, target, adapter, driver, extension), pack refs, and type renderer system
- **Authoring types** (`./authoring`): Declarative authoring contribution types, template resolution, and validation for type constructors and field presets
- **Control stack** (`./control`): Assembly functions that combine component descriptors into a unified `ControlStack` with derived state (codec imports, renderers, authoring contributions)

## Subpath exports

```typescript
import { ComponentMetadata, FamilyDescriptor, normalizeRenderer } from '@prisma-next/framework-components/components';
import { AuthoringContributions, instantiateAuthoringTypeConstructor } from '@prisma-next/framework-components/authoring';
import { createControlStack, ControlStack } from '@prisma-next/framework-components/control';
```

## Relationship to other packages

This package is the canonical source for framework component types and assembly logic. The following packages re-export from here for backward compatibility:

- `@prisma-next/contract/framework-components` re-exports `./components` and `./authoring`
- `@prisma-next/contract/assembly` re-exports `./control` with old names (`assembleComponents` → `createControlStack`, `AssembledComponentState` → `ControlStack`)

New code should import directly from `@prisma-next/framework-components`.
