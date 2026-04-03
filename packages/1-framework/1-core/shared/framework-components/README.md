# @prisma-next/framework-components

Framework component types, authoring logic, control stack assembly, and emission SPI for Prisma Next.

## What this package provides

- **Component types** (`./components`): Base descriptor and instance interfaces for framework components (family, target, adapter, driver, extension), pack refs, and type renderer system
- **Authoring types** (`./authoring`): Declarative authoring contribution types, template resolution, and validation for type constructors and field presets
- **Control stack** (`./control`): Assembly functions that combine component descriptors into a unified `ControlStack` with derived state (codec imports, renderers, authoring contributions)
- **Emission SPI** (`./emission`): Types for the emission pipeline — `TargetFamilyHook`, `ValidationContext`, `GenerateContractTypesOptions`, `TypeRenderEntry`, `TypeRenderer`, `ParameterizedCodecDescriptor`, and related types
- **Execution types** (`./execution`): Execution-plane stack and instance interfaces

## Subpath exports

```typescript
import { ComponentMetadata, FamilyDescriptor, normalizeRenderer } from '@prisma-next/framework-components/components';
import { AuthoringContributions, instantiateAuthoringTypeConstructor } from '@prisma-next/framework-components/authoring';
import { createControlStack, ControlStack } from '@prisma-next/framework-components/control';
import type { TargetFamilyHook, ValidationContext } from '@prisma-next/framework-components/emission';
```

## Relationship to other packages

This package is the canonical source for framework component types, assembly logic, and emission SPI types. New code should import directly from `@prisma-next/framework-components`.
