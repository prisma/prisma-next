# Static context from descriptors (codecs/ops/types) + demo `context.ts` / `runtime.ts` split

Date: 2026-01-19  
Status: Draft (updated)

## Summary

Enable a **static SQL ExecutionContext** (contract + codec/operation registries + type helpers) to be created from **descriptors only** (no instantiation). This unblocks a demo/app structure where importing query roots has no runtime instantiation side-effects:

- `examples/prisma-next-demo/src/prisma/context.ts`: static setup + query roots
- `examples/prisma-next-demo/src/prisma/runtime.ts`: dynamic wiring (instantiate stack + driver, then create runtime)

This spec also removes an obsolete “manifest” hangover for operations (SQL-lowering data inside framework contract types).

## Background

Today, SQL context derivation depends on instances:

- adapter instance provides baseline codecs via `adapter.profile.codecs()`
- extension instances provide codecs/operations/parameterized codec descriptors

That forces stack instantiation just to build query roots (`sql`, `schema`, `orm`) and build plans offline.

Separately, the framework contract layer defines `OperationManifest` with SQL-only `lowering`, and descriptors expose `ComponentMetadata.operations`. This mixes family-specific lowering into framework types and duplicates operation representations.

## Goals

- **Static context from descriptors**: `createExecutionContext` must not call `create()` on targets/adapters/extensions.
- **Consistent static contributions surface**: target/adapter/extension runtime-plane descriptors all expose:
  - `codecs(): CodecRegistry`
  - `operationSignatures(): ReadonlyArray<SqlOperationSignature>`
  - `parameterizedCodecs(): ReadonlyArray<RuntimeParameterizedCodecDescriptor<any, any>>`
  These are **non-optional**; empty contributions are returned by each descriptor directly.
- **No normalization in `@prisma-next/sql-runtime`**: do not use optional chaining or “empty defaults” inside `createExecutionContext`.
- **Wafer-thin runtime factory**: `createRuntime` takes `ExecutionStackInstance`, `ExecutionContext`, and a `SqlDriver` from the caller. It does not instantiate, derive context, or construct drivers from options.
- **Remove manifest hangover for operations**: strip `OperationManifest` and `ComponentMetadata.operations` from framework contract types; operation definitions with lowering are family-owned.
- **Defer driver-in-stack-instance changes** until after TML-1837.
- **No backwards compatibility**: update call sites.

## Non-goals

- Driver instantiation ergonomics (TML-1837).
- Repo-wide renames between `Runtime*` and `Execution*`.
- Seed story refactor.

## Design

### 1) Operations representation (framework vs family)

#### Framework: keep only generic building blocks

Keep `@prisma-next/operations` as the framework operation substrate:

- `OperationSignature` (family-agnostic; no lowering)
- `OperationRegistry` keyed by `forTypeId`

#### SQL family: own lowering-carrying operation definitions

Keep `@prisma-next/sql-operations` as the canonical home for SQL operations:

- `SqlOperationSignature extends OperationSignature` and adds `lowering`

#### Contract/framework types: remove SQL-lowered operation manifests

Remove:

- `OperationManifest` / `LoweringSpecManifest` from `@prisma-next/contract/*`
- `ComponentMetadata.operations` from `@prisma-next/contract/framework-components`

Keep:

- `ComponentMetadata.types.operationTypes` import specs (type emission needs these)

Assembly rules:

- Any place that needs an operation registry (emitter validation, lane helpers, runtime context creation) assembles it from **family-owned operation signatures**, not framework metadata.

### 2) Descriptor-level static contributions (required, consistent)

We do not add SQL-specific return types (like `CodecRegistry`) onto core execution-plane descriptor interfaces. Instead, SQL defines structural descriptor types that extend the core shapes and require contributions methods.

```ts
export interface SqlStaticContributions {
  readonly codecs: () => CodecRegistry;
  readonly operationSignatures: () => ReadonlyArray<SqlOperationSignature>;
  // biome-ignore lint/suspicious/noExplicitAny: covariance with concrete descriptor types
  readonly parameterizedCodecs: () => ReadonlyArray<RuntimeParameterizedCodecDescriptor<any, any>>;
}
```

Rules:

- target/adapter/extension **runtime-plane** descriptors implement these methods.
- descriptors with no contributions return empty values (duplicated in each descriptor module; no helper wrapper yet).

### 3) `createExecutionContext` from descriptors-only stack

Signature (conceptual):

```ts
createExecutionContext({ contract, stack })
```

Derivation algorithm:

- create empty codec + operation registries
- merge contributions in deterministic order:
  - `stack.target`
  - `stack.adapter`
  - `stack.extensionPacks` (in list order)
- collect parameterized codec descriptors from the same sources and:
  - reject duplicates by `codecId`
  - validate `contract.storage.types`
  - validate inline column `typeParams`
  - initialize `types` (always present)
- validate contract requirements against stack descriptors:
  - target match
  - extension pack IDs coverage

### 4) `createRuntime` wafer-thin

`createRuntime` does not build stacks/contexts or drivers. Caller provides everything:

```ts
createRuntime({ stackInstance, context, driver, verify, plugins })
```

Note: `ExecutionStackInstance` does not include driver today; changing that is deferred until after TML-1837.

### 5) Demo refactor

#### `context.ts` (static)

- validate/load contract
- create descriptors-only stack
- build `executionContext = createExecutionContext({ contract, stack })`
- export query roots and any wiring inputs needed by `runtime.ts`

#### `runtime.ts` (dynamic)

- instantiate stack via `instantiateExecutionStack(stack)` (adapter/extensions)
- create a `SqlDriver` instance explicitly
- call wafer-thin `createRuntime(...)`

## Testing plan

- **Unit**:
  - context derivation uses descriptor contributions and yields expected codec IDs and operations
  - adapter descriptor `codecs()` matches adapter instance `profile.codecs()` codec IDs (parity check)
  - parameterized codec validation runs for `storage.types` and inline column `typeParams`
  - `types` is always present
- **Integration/demo**:
  - importing query roots does not instantiate adapter/extensions
  - runtime execution works when `DATABASE_URL` is provided (driver constructed in `runtime.ts`)

## Documentation updates (part of this spec)

- Update relevant architecture docs and ADRs to reflect:
  - operations are family-owned when they include lowering
  - framework contract layer no longer defines operation manifests
  - descriptor-based static context derivation


