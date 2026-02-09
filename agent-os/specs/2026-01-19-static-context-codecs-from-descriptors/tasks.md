# Tasks — Static context from descriptors + operations layering cleanup

Source:
- Spec: `agent-os/specs/2026-01-19-static-context-codecs-from-descriptors/spec.md`
- Requirements: `agent-os/specs/2026-01-19-static-context-codecs-from-descriptors/planning/requirements.md`
- Linear: `TML-1827`

## 1) Operations layering: strip manifest hangover from framework contract types ✅

### 1.1 Tests (type + integration safety net)

- [x] Add/adjust tests to cover:
  - operation registry assembly from SQL descriptors (not from framework metadata)
  - contract emission still works (contract.json + contract.d.ts)

### 1.2 Remove manifest types from `@prisma-next/contract`

- [x] Remove `OperationManifest` and `LoweringSpecManifest` from `packages/1-framework/1-core/shared/contract/src/types.ts`.
- [x] Remove any remaining “manifest” exports that only exist to support JSON descriptor attempts.
- [x] Update any docs/comments referencing “manifest-safe operations”.

### 1.3 Remove `ComponentMetadata.operations`

- [x] Remove `operations?: ReadonlyArray<...>` from `ComponentMetadata` in `packages/1-framework/1-core/shared/contract/src/framework-components.ts`.
- [x] Update all descriptor metadata objects that currently define `operations` to stop doing so.
- [x] Confirm `types.operationTypes` (type-only import specs) remain supported for `contract.d.ts` generation.

### 1.4 Move operation definitions to family-owned descriptor surfaces

- [x] Ensure SQL descriptor shapes (control + runtime plane as needed) expose:
  - `operationSignatures(): ReadonlyArray<SqlOperationSignature>`
- [x] Update SQL family tooling assembly (`packages/2-sql/3-tooling/family/src/core/assembly.ts`) to assemble `OperationRegistry` from `operationSignatures()` instead of `descriptor.operations`.
- [x] Delete `convertOperationManifest` and any `OperationManifest`-based conversion paths in SQL tooling (`control-instance.ts` and related exports).

## 2) Descriptor-level static contributions for SQL runtime context (required, consistent) ✅

### 2.1 Types: `SqlStaticContributions` and structural descriptor types

- [x] Define/verify `SqlStaticContributions` in `@prisma-next/sql-runtime`:
  - `codecs(): CodecRegistry`
  - `operationSignatures(): ReadonlyArray<SqlOperationSignature>`
  - `parameterizedCodecs(): ReadonlyArray<RuntimeParameterizedCodecDescriptor<any, any>>`
- [x] Define structural SQL runtime descriptor types requiring these methods:
  - `SqlRuntimeTargetDescriptor`
  - `SqlRuntimeAdapterDescriptor`
  - `SqlRuntimeExtensionDescriptor`
- [x] Do **not** modify core execution-plane descriptor interfaces to add SQL-specific return types.

### 2.2 Update concrete descriptors (duplicate empty methods locally)

Rules:
- All methods are **non-optional**.
- If a descriptor has no contributions, it returns empty registry/arrays in its module (no helper wrapper yet).

- [x] `@prisma-next/target-postgres/runtime`: return empty `codecs/operationSignatures/parameterizedCodecs`.
- [x] `@prisma-next/adapter-postgres/runtime`: return:
  - `codecs()` (real registry from adapter codec definitions)
  - empty `operationSignatures()` and `parameterizedCodecs()`
- [x] `@prisma-next/extension-pgvector/runtime`: move contributions to descriptor:
  - `codecs()` (real)
  - `operationSignatures()` (real)
  - `parameterizedCodecs()` (real)
  - keep instance minimal unless runtime hooks require it

## 3) Refactor SQL `createExecutionContext` to use descriptors-only stack ✅

### 3.1 API change

- [x] Change `createExecutionContext` signature to `{ contract, stack }` (descriptors-only stack).
- [x] Remove reliance on adapter instance `profile.codecs()` and extension instance hooks for context derivation.
- [x] Ensure `ExecutionContext` remains `{ contract, codecs, operations, types }` with `types` always present.

### 3.2 Deterministic merge + validation (no normalization inside sql-runtime)

- [x] Merge contributions in order:
  - `stack.target.*()`
  - `stack.adapter.*()`
  - `stack.extensionPacks[i].*()` in list order
- [x] Collect parameterized codec descriptors from the same sources and:
  - reject duplicates by `codecId`
  - validate `storage.types`
  - validate inline column `typeParams`
  - initialize `types`

### 3.3 Contract vs stack validation

- [x] Update contract/stack validation to work off the descriptors-only stack:
  - target match
  - extension pack ID coverage

## 4) Make `createRuntime` wafer-thin (caller provides instances/context/driver) ✅

- [x] Change `createRuntime` to accept:
  - `stackInstance`
  - `context`
  - `driver` (explicit, provided by caller)
  - `verify`, `plugins`, etc.
- [x] Remove:
  - `driverOptions` plumbing
  - offline driver defaulting
  - deriving context inside `createRuntime`
  - instantiation inside `createRuntime`
- [x] Do not attempt to add `driver` to `ExecutionStackInstance` (defer until after TML-1837).

## 5) Demo refactor: split static `context.ts` and dynamic `runtime.ts` ✅

### 5.1 Add `examples/prisma-next-demo/src/prisma/context.ts`

- [x] Validate/load the demo contract via `validateContract<Contract>(contractJson)`.
- [x] Define a descriptors-only execution stack configuration (target/adapter/driver descriptor/extensions).
- [x] Create `executionContext = createExecutionContext({ contract, stack })`.
- [x] Export query roots: `schema`, `tables`, `sql`, `orm`.
- [x] Export minimal runtime wiring inputs (e.g., `stack`, `executionContext`) without instantiating anything.

### 5.2 Update `examples/prisma-next-demo/src/prisma/runtime.ts`

- [x] Import static exports from `context.ts`.
- [x] Instantiate stack via `instantiateExecutionStack(stack)` (adapter/extensions).
- [x] Create `driver` via `stack.driver.create(driverOptions)` (or provide an explicit offline driver in tests).
- [x] Call wafer-thin `createRuntime({ stackInstance, context: executionContext, driver, ... })`.

### 5.3 Update demo entrypoints/tests

- [x] Update `examples/prisma-next-demo/src/main.ts` to use the new runtime wiring.
- [x] Add smoke coverage: importing query roots does not instantiate adapter/extensions.

## 6) Tests ✅

### 6.1 Unit: descriptor-based derivation + parity

- [x] Add unit test asserting descriptor-based context derivation includes expected codec IDs and operations.
- [x] Add unit test asserting adapter descriptor `codecs()` matches adapter instance `profile.codecs()` codec IDs (parity).

### 6.2 Unit: parameterized codec validation

- [x] Add unit test for validation against `storage.types`.
- [x] Add unit test for validation against inline column `typeParams`.

### 6.3 Unit: `types` is always present

- [x] Add unit test asserting `ExecutionContext.types` exists even when no parameterized codecs are registered.

### 6.4 Integration/demo smoke

- [x] Update/extend demo integration test(s) to:
  - import static `context.ts` without runtime instantiation side-effects
  - execute query successfully when `DATABASE_URL` is provided

## 7) Docs & ADR updates ✅

- [x] Update affected package READMEs (notably `@prisma-next/sql-runtime`) to match new APIs.
- [x] Update architecture docs and ADRs to reflect:
  - operations are family-owned when they include lowering
  - framework contract layer no longer defines operation manifests
  - descriptor-based static context derivation

