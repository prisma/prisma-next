# Tasks — Runtime DX: definition-only Contract + separate TypeMaps (TML-1831)

Source:
- Spec: `agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/spec.md`
- Requirements: `agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/planning/requirements.md`
- ADR: `docs/architecture docs/adrs/ADR 159 - Definition-only contracts and type-only codec-operation maps.md`
- Visuals: `agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/planning/visuals/` (README only, no design assets)

## 1) Contract and type surface split (`Contract` vs `TypeMaps`)

### 1.1 Tests first: lock `Contract` and `TypeMaps` contract.d.ts shape

- [x] Add/adjust 2-8 focused unit/type tests to assert:
  - emitted `contract.d.ts` exports both `Contract` and `TypeMaps`
  - `TypeMaps` has the locked shape `{ codecTypes, operationTypes }`
  - runtime `Contract['mappings']` includes only runtime-real structural keys
  - no runtime-facing `mappings.codecTypes` / `mappings.operationTypes` contract shape claims remain

### 1.2 Update SQL contract core types

- [x] Keep `SqlMappings` runtime-real only.
- [x] Remove/replace extract-from-contract typing assumptions (`ExtractCodecTypes<TContract>` / `ExtractOperationTypes<TContract>`) in favor of explicit `TypeMaps`.
- [x] Introduce shared type utilities for explicit map threading (for example `CodecTypesOf<TTypeMaps>`, `OperationTypesOf<TTypeMaps>`).
- [x] Keep `Contract` definition-only and implementation-agnostic.

### 1.3 Update emitter outputs and generated type model

- [x] Update `@prisma-next/sql-contract-emitter` to emit `TypeMaps` as a separate export in generated `contract.d.ts`.
- [x] Ensure generated `Contract` type does not rely on phantom extract-from-contract keys for codec/op maps.
- [x] Keep emitted runtime mappings aligned with construction/validation output.

## 2) Contract construction and validation flow

### 2.1 Tests first: define/validate parity with split types

- [x] Add/adjust 2-8 focused tests asserting `defineContract()` and `validateContract<Contract>()` produce compatible runtime `Contract` values under the new split model.
- [x] Add tests that `_generated` is stripped/absent from returned runtime contract values.
- [x] Add regression tests for visualization/traversal use-cases against returned runtime contracts.

### 2.2 Keep construction model intact

- [x] Preserve internal class + public factory construction model (`constructContract(...)` or equivalent entrypoint).
- [x] Ensure construction computes runtime-real mappings only.
- [x] Ensure consumers bind to `Contract` interface instead of class type.

### 2.3 Keep contract definition-only

- [x] Confirm contract loading/validation does not require execution stack or runtime descriptor instantiation.
- [x] Ensure validator does not fabricate `TypeMaps` as runtime properties.

## 3) Lane/context typing model: thread `(Contract, TypeMaps)` explicitly

### 3.1 Tests first: lane inference with explicit `TypeMaps`

- [x] Add/adjust 2-8 focused lane/type tests to cover inference using `(TContract, TTypeMaps)` instead of extracting maps from `TContract`.
- [x] Add/adjust parameterized codec tests (`typeParams` / `typeRef`) to verify precision remains intact.
- [x] Add tests that lane runtime behavior still reads registries from `ExecutionContext` only.

### 3.2 Refactor lane/core generics and helpers

- [x] Update lane, relational-core, orm-lane, query-builder, and integration helpers to accept explicit `TypeMaps` generics where needed.
- [x] Remove runtime/type assumptions that codec/op maps are available on contract mappings.
- [x] Keep typing surfaces readable and minimize generic churn at call sites.

### 3.3 Update convenience clients and context APIs

- [x] Update convenience clients (for example `@prisma-next/postgres/runtime`) to support emitted usage with explicit generics (`<Contract, TypeMaps>`).
- [x] Ensure runtime execution behavior still depends on `ExecutionContext.codecs`, `ExecutionContext.operations`, and `ExecutionContext.types`.
- [x] Keep no-emit ergonomics via inferred typing paths (see task group 4).

## 4) TS authoring ergonomics and no-emit inference

### 4.1 Tests first: pack-driven `TypeMaps` inference

- [x] Add 2-8 focused type tests demonstrating `.target(...)` + `.extensionPacks(...)` infer `TypeMaps` correctly.
- [x] Add regression tests for mixed target/extension pack composition and parameterized codecs.
- [x] Add tests for `ContractWithTypeMaps` no-emit inference in convenience helpers.

### 4.2 Implement builder inference model

- [x] Refactor `defineContract()` builder typing so no-emit authoring infers/accumulates type maps from selected packs.
- [x] Ensure no-emit workflow can carry `ContractWithTypeMaps<Contract, TypeMaps>` for helper inference without adding runtime keys.
- [x] Remove remaining manual `AllCodecTypes`/manual map composition where inference can replace it.

## 5) Re-emit generated contracts and fixture alignment

### 5.1 Tests/checks first: lock generated artifact expectations

- [x] Add/adjust 2-8 focused emit checks ensuring generated `contract.d.ts` files include separate `TypeMaps` export and do not declare legacy `mappings.codecTypes` / `mappings.operationTypes`.
- [x] Cover generated artifacts in:
  - `examples/prisma-next-demo/src/prisma/`
  - `examples/prisma-orm-demo/src/prisma-next/`
  - `packages/3-extensions/integration-kysely/test/fixtures/generated/`
  - `test/e2e/framework/test/fixtures/generated/`

### 5.2 Re-emit all generated contracts

- [x] Re-run contract emission for all generated contract fixtures/examples.
- [x] Update generation inputs where necessary so emitted artifacts converge on the new type model.
- [x] Ensure generated `contract.json`/`contract.d.ts` pairs are consistent and deterministic.

### 5.3 Remove legacy generated shape

- [x] Confirm no remaining generated `contract.d.ts` includes `mappings.codecTypes` / `mappings.operationTypes`.
- [x] Resolve any holdout fixture/config path still emitting legacy shape.

## 6) Demo and docs alignment

### 6.1 Tests first: demo DX with split type exports

- [x] Add/adjust 2-8 focused demo integration checks for:
  - visualization rendering directly from runtime `Contract` value
  - emitted workflow typing with `Contract` + `TypeMaps`
  - no HMR/type mismatch from runtime/type shape divergence

### 6.2 Update demo/runtime usage

- [x] Update no-emit and emitted demo wiring to the final split model (`Contract` and `TypeMaps` where applicable).
- [x] Ensure convenience runtime flow remains aligned (validate contract first, context from descriptors, runtime lazy instantiation as applicable).

### 6.3 Documentation updates

- [x] Keep ADR 159 synchronized with final implementation details.
- [x] Update package READMEs/docs that reference extraction-from-contract or legacy runtime mapping assumptions.
- [x] Ensure references use `agent-os/specs/` for in-repo spec workflow.

## 7) Final verification

- [x] Run targeted package tests/typechecks covering:
  - SQL contract types/validation
  - emitter generated type shape (`Contract` + `TypeMaps`)
  - relational core / sql-lane / orm-lane typing with explicit type maps
  - postgres convenience client typing (emitted + no-emit paths)
- [x] Run integration/e2e tests that exercise emitted and no-emit workflows.
- [x] Confirm no remaining runtime reads of type-only mapping properties.
- [x] Confirm no remaining generated `contract.d.ts` uses legacy `mappings.codecTypes` / `mappings.operationTypes`.
