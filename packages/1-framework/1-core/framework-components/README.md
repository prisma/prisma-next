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
import type { EmissionSpi } from '@prisma-next/framework-components/emission';
```

## Why SPI types live here (dependency inversion)

This package sits in the **core** layer — below the tooling layer where family-specific emitters and control implementations live. SPI interfaces like `EmissionSpi` define the contract between framework orchestration code (control-plane emission, CLI) and family-specific implementations (SQL emitter, Mongo emitter).

By placing these interfaces in the core layer rather than alongside their implementations:

- **Orchestration code** (control-plane, CLI) can depend on the SPI interfaces without pulling in family-specific packages.
- **Family implementations** (SQL emitter, Mongo emitter) implement these interfaces and depend on this package — the dependency arrow points inward toward the core.
- **The contract package** (`@prisma-next/contract`) remains a true leaf in the `foundation` layer with zero framework-domain dependencies.

This is the [dependency inversion principle](https://en.wikipedia.org/wiki/Dependency_inversion_principle) applied to package layering. The same pattern applies to component descriptors, control-plane types, and execution-plane types in this package.

See [ADR 185 — SPI types live at the lowest consuming layer](../../../../../docs/architecture%20docs/adrs/ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md).

## Relationship to other packages

This package is the canonical source for framework component types, assembly logic, and emission SPI types. New code should import directly from `@prisma-next/framework-components`.
