# ADR 185 — SPI types live at the lowest consuming layer

## At a glance

During emission, the framework orchestrates and family-specific packages
customize. The interface between them — `TargetFamilyHook` — is an SPI
(Service Provider Interface): defined once, consumed by the orchestration
layer, implemented by each family.

```text
  @prisma-next/core-control-plane (core layer — calls the hook)
        ↓ imports
  @prisma-next/framework-components/emission (core layer — defines the SPI)
        ↑ imports                    ↑ imports
  @prisma-next/sql-contract-emitter   @prisma-next/mongo-emitter
  (tooling layer — implements)        (tooling layer — implements)
```

Both the caller and the implementers depend on the abstraction. The
abstraction lives in the lowest layer that can host it — **core**, not
foundation (where `@prisma-next/contract` lives), because the SPI types
reference `OperationRegistry` and other core-layer types.

## Context

Prisma Next's packages are organized into layers with a strict import rule:
a package may only import from its own layer or lower layers.

```text
foundation → core → authoring → tooling → runtime
```

An SPI (Service Provider Interface) is an interface that lower-layer code
*calls* and higher-layer code *implements*. This is the inverse of a normal
API, where the definer also calls it. SPIs arise when framework orchestration
needs to delegate family-specific behavior — the orchestration lives in a
lower layer, but each family's implementation lives in a higher layer.

The emission pipeline is the primary example: the control-plane's `emit()`
function (core layer) calls `targetFamily.validateTypes()` and
`targetFamily.generateContractTypes()`. Each family provides its own hook
implementation — `sqlTargetFamilyHook` (SQL emitter, tooling layer),
`mongoTargetFamilyHook` (Mongo emitter, tooling layer).

## Decision

**SPI interfaces live in the lowest layer whose types they depend on.**

The emission SPI types live in `@prisma-next/framework-components` (core
layer), exported via the `./emission` subpath:

- `TargetFamilyHook` — the interface family emitters implement to customize
  validation and type generation during emission
- `ValidationContext` — context passed to family hooks during validation
  (carries `OperationRegistry`, codec imports, extension IDs)
- `GenerateContractTypesOptions` — options for contract `.d.ts` generation
  (parameterized renderers, query operation imports)
- `TypeRenderEntry`, `TypeRenderer`, `ParameterizedCodecDescriptor` —
  supporting types for parameterized codec rendering

Orchestration code imports from this subpath:

```ts
// core layer — control-plane emission (caller)
import type {
  TargetFamilyHook,
  ValidationContext,
} from '@prisma-next/framework-components/emission';

export async function emit(
  contract: Contract,
  stack: EmitStackInput,
  targetFamily: TargetFamilyHook,
): Promise<EmitResult> { ... }
```

Family emitters implement the interface:

```ts
// tooling layer — SQL emitter (implementer)
import type { TargetFamilyHook } from '@prisma-next/framework-components/emission';

export const sqlTargetFamilyHook: TargetFamilyHook = {
  id: 'sql',
  validateTypes(contract, ctx) { ... },
  validateStructure(contract) { ... },
  generateContractTypes(contract, codecTypeImports, operationTypeImports, hashes, options) { ... },
};
```

This is the dependency inversion principle applied at package boundaries:
both the caller and the implementer depend on the abstraction, and the
abstraction lives at its own natural layer — determined by its type
dependencies, not by who implements it.

The same pattern applies to other SPI types already in
`@prisma-next/framework-components`: component descriptors
(`./components`), control-plane types (`./control`), and execution-plane
types (`./execution`).

## Why not the alternatives?

**Colocate with implementations (tooling layer)?** The control-plane (core
layer) needs to import `TargetFamilyHook` as a parameter type. Core cannot
import from tooling — layer violation.

**Place in `@prisma-next/contract` (foundation layer)?**
`TargetFamilyHook` references `ValidationContext`, which references
`OperationRegistry` from `@prisma-next/operations` (core layer). This
would force the contract package to depend on a core-layer package, turning
a leaf foundation package into one with framework-domain coupling.

## Consequences

- **Contract is a true leaf**: `@prisma-next/contract` depends only on
  `@prisma-next/utils` and `arktype` — no framework-domain packages.
- **No upward imports**: Orchestration code imports SPI types from core,
  never from tooling.
- **Single canonical source**: Each SPI type has one definition; no
  duplicates across packages.
- **Counter-intuitive placement**: Contributors may instinctively move SPI
  types "closer" to their implementations. The
  `@prisma-next/framework-components` README documents this rationale to
  prevent drift.

## Status

Accepted.

## Related

- [ADR 151 — Control Plane Descriptors and Instances](ADR%20151%20-%20Control%20Plane%20Descriptors%20and%20Instances.md)
  — defines the descriptor/instance pattern that these SPI types support
- [ADR 150 — Family-Agnostic CLI and Pack Entry Points](ADR%20150%20-%20Family-Agnostic%20CLI%20and%20Pack%20Entry%20Points.md)
  — establishes the family-agnostic orchestration that consumes these SPIs
- [`@prisma-next/framework-components` README](../../../packages/1-framework/1-core/shared/framework-components/README.md)
  — documents the SPI placement rationale for contributors
