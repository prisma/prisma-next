# Tasks — Runtime DX: definition-only contract + runtime-real mappings (TML-1831)

Source:
- Spec: `agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/spec.md`
- Requirements: `agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/planning/requirements.md`
- Visuals: `agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/planning/visuals/` (README only, no design assets)

## 1) Contract type model cleanup (runtime-real mappings vs type-only maps)

### 1.1 Tests first: lock expected runtime/type split

- [x] Add/adjust unit + type tests to assert:
  - runtime contract values include only runtime-real mapping keys
  - lanes do not require runtime `contract.mappings.codecTypes` / `operationTypes`
  - `ExtractCodecTypes<TContract>` / `ExtractOperationTypes<TContract>` still work for lane inference
  - parameterized codec typing remains precise in type tests

### 1.2 Update SQL contract core types

- [x] Update `@prisma-next/sql-contract/types` so `SqlMappings` contains runtime-real structural mappings only.
- [x] Introduce/confirm a type-only channel for codec/operation typing (phantom/symbol strategy from spec).
- [x] Keep public `Contract` interface consumer-facing and implementation-agnostic.

### 1.3 Update extraction helpers and dependents

- [x] Ensure `ExtractCodecTypes<TContract>` and `ExtractOperationTypes<TContract>` read from the type-only channel (not runtime mapping keys).
- [x] Update any helper types in lanes/runtime clients that currently assume codec/op type maps live under runtime `mappings`.

## 2) Contract construction and validation flow

### 2.1 Tests first: validateContract + defineContract parity

- [x] Add tests asserting `defineContract()` and `validateContract<Contract>()` produce compatible runtime-real contract shapes.
- [x] Add tests that `_generated` is stripped/absent from returned runtime contract values where applicable.
- [x] Add regression tests for visualization/traversal use-cases against returned contract values.

### 2.2 Implement construction model (internal class + public factory)

- [x] Introduce/refactor to an internal class implementation that encapsulates:
  - construction invariants
  - mapping computation
- [x] Keep public construction API factory-first (`constructContract(...)` or equivalent entrypoint).
- [x] Ensure consumers bind to `Contract` interface rather than class type.

### 2.3 Keep contract definition-only

- [x] Confirm contract loading/validation does not require execution stack or runtime descriptor instantiation.
- [x] Ensure validator does not fabricate type-only maps as runtime properties.

## 3) Query lanes and context integration

### 3.1 Tests first: lane behavior with new type channel

- [x] Add/adjust lane tests to cover type inference without runtime codec/op maps on contract values.
- [x] Add/adjust parameterized codec tests (column-level `typeParams` / `typeRef`) to verify no regressions.

### 3.2 Update lane/runtime call sites

- [x] Remove runtime reads of `contract.mappings.codecTypes` / `contract.mappings.operationTypes` from lane code.
- [x] Ensure runtime behavior uses `ExecutionContext` registries (`codecs`, `operations`, `types`) only.
- [x] Keep generic extraction-based typing intact in convenience clients (e.g. `@prisma-next/postgres/runtime`).

## 4) TS authoring ergonomics: infer type maps from packs

### 4.1 Tests first: inference behavior

- [x] Add type tests demonstrating `.target(...)` + `.extensionPacks(...)` infers codec/op type maps.
- [x] Add regression tests for mixed target/extension pack composition and parameterized codecs.

### 4.2 Implement builder inference improvements

- [x] Refactor `defineContract()` builder typing to infer/accumulate type maps from selected packs.
- [x] Remove need for manual `type AllCodecTypes = ...` in demo/examples where inference can replace it.

## 5) Demo + docs alignment

### 5.1 Tests first: demo DX checks

- [x] Add/adjust demo integration checks for:
  - contract visualization rendering directly from runtime contract value
  - no HMR/type mismatch caused by runtime/type shape divergence

### 5.2 Update demo usage

- [x] Update no-emit and emitted demo contract wiring to match final type model.
- [x] Ensure convenience runtime configuration flow remains aligned (validate contract first, context from descriptors, runtime lazy instantiation as applicable).

### 5.3 Documentation updates

- [x] Keep ADR 159 synchronized with final implementation details.
- [x] Update package READMEs/docs that reference old runtime mapping assumptions.
- [x] Ensure references use `agent-os/specs/` for in-repo spec workflow.

## 6) Final verification

- [ ] Run targeted package tests covering:
  - SQL contract types/validation
  - relational core / sql-lane / orm-lane typing
  - postgres convenience client typing where relevant
- [ ] Run integration/e2e tests that exercise emitted and no-emit workflows.
- [ ] Confirm no remaining runtime reads of type-only mapping properties.
