# @prisma-next/framework-components

> **Internal package.** This package is an implementation detail of [`prisma-next`](https://www.npmjs.com/package/prisma-next)
> and is published only to support its runtime. Its API is unstable and may change
> without notice. Do not depend on this package directly; install `prisma-next` instead.

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

## Higher-order codec primitives

`@prisma-next/framework-components/codec` is the home of two primitives that pack authors writing parameterized codecs (`vector(N)`, `char(N)`, `json(schema)`, `cipherStashText(params)`, …) build against:

- **`Ctx`** — the column context the framework supplies when it calls a curried higher-order codec factory:

  ```ts
  export interface Ctx {
    readonly name: string;                     // storage.types instance name
    readonly usedAt: ReadonlyArray<{
      readonly table: string;
      readonly column: string;
    }>;
  }
  ```

  Pack authors never construct it. The contract-authoring builder synthesizes it at column-evaluation time (`{ name: '<anon:Document.embedding>', usedAt: [{ table: 'Document', column: 'embedding' }] }`); the runtime synthesizes it again at contract-load time with `usedAt` aggregated across every column referencing the same `storage.types` instance.

- **`ParameterizedCodecDescriptor<P>`** — the framework-registration descriptor that pairs a curried factory with its JSON-boundary metadata:

  ```ts
  export interface ParameterizedCodecDescriptor<P = Record<string, unknown>> {
    readonly codecId: string;
    readonly paramsSchema: StandardSchemaV1<P>;
    readonly renderOutputType?: (params: P) => string;
    readonly factory: (params: P) => (ctx: Ctx) => Codec;
  }
  ```

  `paramsSchema` validates `typeParams` arriving from a serialized contract (PSL parse, `contract.json` load) before the framework hands them to the factory. `renderOutputType` is the emit-path hook: the emitter reads it to render the column's TypeScript type into `contract.d.ts`. Both are framework-facing metadata; the codec object itself stays free of parameterization slots.

The pack-author surface is one curried function plus one descriptor:

```ts
// User-facing: the column-author writes `field.column(vector(1536))`.
export function vector<N extends number>(
  length: N,
): (ctx: Ctx) => Codec<'pg/vector@1', readonly ['equality'], string, Vector<N>> { … }

// Framework-facing: registered through the `parameterizedCodecs` slot on
// the host package's control descriptor.
export const pgVectorCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: 'pg/vector@1',
  paramsSchema: type({ length: 'number > 0' }),
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: ({ length }) => vector(length),
};
```

The function's signature is what the no-emit `FieldOutputType` resolver reads (`vector(1536)` resolves to `Vector<1536>`); its body is what the runtime invokes per `storage.types` instance to materialize the codec. They're the same artifact.

The descriptor lookup is assembled by `extractParameterizedCodecLookup` from each component's `types.codecTypes.parameterizedCodecs` contribution; the runtime reads `descriptor.factory(params)(ctx)` once per instance and indexes the resulting `Codec`. See [ADR 205 — Higher-order codecs for parameterized types](../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) for the full design rationale.

### Multiple descriptors per `codecId`

For codecs whose authoring-time params (e.g. a live `StandardSchemaV1`) cannot
round-trip through `contract.json`, register a separate
`ParameterizedCodecDescriptor` per resolution surface (column-author / emit-
path / runtime). Each descriptor registers through a different framework slot,
so there is no dynamic dispatch — surface segregation, not selection. See the
JSON / JSONB descriptor block comment in
`@prisma-next/adapter-postgres/codecs/postgres-codec-descriptors.ts` for a
worked example, and [ADR 205 § Open questions](../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md#open-questions) for the unification roadmap.

### Inline `typeParams` vs `storage.types` `typeRef`

A parameterized column can be authored two ways:

- **Inline**: `field.column(vector(1536))` produces an *anonymous* `storage.types` instance (deterministic name `<anon:${table}.${column}>`); the runtime calls the factory once with `usedAt` listing the single column.
- **Shared**: declare a named `storage.types` entry (e.g. `Embedding1536: vector(1536)`) and reference it via `typeRef` from each column. The runtime aggregates every column that references the entry into a single `Ctx.usedAt` and calls the factory once for the whole set. Use this when a stateful codec (CipherStash, future per-instance encoders) needs a single per-instance state shared across multiple columns.
