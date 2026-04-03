# System Design Review — PR #261

**PR**: [feat(contract-ts): [DRAFT] design new contract.ts](https://github.com/prisma/prisma-next/pull/261)
**Spec**: [projects/ts-contract-authoring-redesign/spec.md](projects/ts-contract-authoring-redesign/spec.md)
**Branch**: `feat/contract-ts-revamp` → `main`
**Review range**: `origin/main...HEAD`

---

## Problem Statement

The existing TS contract authoring surface requires authors to separately define tables and models, repeat field-to-column declarations, restate relation coordinates from raw strings, and choreograph low-level storage details for common patterns. The redesign introduces a staged DSL that lets authors describe the model graph semantically first, attach shared constraints, and fall back to SQL-only detail only when necessary — while still lowering to the same canonical `contract.json` and `contract.d.ts`.

## New Guarantees and Invariants

1. **Staged authoring pipeline**: `fields → relations → .attributes(...) → .sql(...)` establishes a clear staging order. Semantic intent (identity, uniqueness) is separated from SQL-only detail (indexes, FK names, `using`/`config`).

2. **Pack-driven vocabulary**: The `field.*` and `type.*` helpers are derived from shared `AuthoringFieldPresetDescriptor` and `AuthoringTypeConstructorDescriptor` registries in packs, not hardcoded in the TS surface. PSL and TS consume the same descriptors.

3. **Typed model tokens**: `model('User', {...})` returns a `StagedModelBuilder` whose `.refs` property provides typed cross-model references (`User.refs.id`), replacing stringly-typed `constraints.ref('User', 'id')`.

4. **Semantic intermediate representation**: A new `SqlSemanticContractDefinition` (in `semantic-contract.ts`) acts as a target-agnostic intermediate form between the staged DSL and the existing `SqlContractBuilder`. This decouples authoring from the lower-level builder mechanics.

5. **TS ↔ PSL parity proof**: A real fixture in `ts-psl-parity.test.ts` lowers equivalent TS and PSL contracts and asserts `toEqual` on the output, establishing a machine-verifiable symmetry guarantee.

## Subsystem Fit

### Contract Authoring (Layer 2 — Authoring)

The new staged DSL lives entirely within `packages/2-sql/2-authoring/contract-ts/`. It introduces:

- `staged-contract-dsl.ts` — Public DSL types, builders (`ScalarFieldBuilder`, `RelationBuilder`, `StagedModelBuilder`), the `field`/`rel`/`model` exports, and naming utilities.
- `staged-contract-lowering.ts` — The runtime lowering pipeline from `StagedContractInput` → `SqlSemanticContractDefinition`.
- `semantic-contract.ts` — The intermediate representation interfaces.
- `staged-contract-warnings.ts` — Diagnostics for string-based fallback refs.
- `authoring-type-utils.ts` — Shared authoring type utilities (`FieldBuilderFromPresetDescriptor`, helper function types).
- `authoring-helper-runtime.ts` — Runtime field preset instantiation from descriptors.
- `composed-authoring-helpers.ts` — Pack-driven composition of field and type namespaces.
- `contract-builder.ts` — Extended `defineContract()` overloads that detect staged input and route through the new pipeline; `SqlContractResult` type computation.

This layering is correct: the staged surface remains in the authoring layer and does not leak into runtime, adapters, or tooling.

### Shared Composition (Layer 1 — Core)

The portable field presets moved into `packages/2-sql/1-core/contract/src/authoring.ts` (the `portableSqlAuthoringFieldPresets` registry). The Postgres pack re-exports these and adds target-specific types in `packages/3-targets/3-targets/postgres/src/core/authoring.ts`. This correctly uses the layering: core defines the portable vocabulary, targets extend it.

The `composed-authoring-helpers.ts` module composes field and type namespaces from target + extension packs at contract definition time. This is the composition seam described in the spec.

### Contract Emitter & CLI (Layer 3 — Tooling)

The CLI's `load-ts-contract.ts` now handles both old-style `defineContract()` (returning `SqlContractBuilder`) and new-style (returning `SqlContractResult`). The `isStagedContractInput` guard (internal to the package) determines which path to take. The `contract-enrichment.ts` module was updated to handle extension metadata from the new pack structure.

### PSL Interpreter

The PSL interpreter in `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` was updated to preserve the same semantic information that the staged TS surface lowers (constraint names, pack-provided metadata, named type refs). This is necessary for the parity proof to hold.

## Boundary Correctness

### Domain/Layer/Plane Imports

The staged DSL correctly imports only from:
- `@prisma-next/contract/framework-components` (Layer 1 — Core, Framework domain)
- `@prisma-next/contract/types` (Layer 1 — Core, Framework domain)
- `@prisma-next/contract-authoring` (Layer 2 — Authoring, Framework domain)
- `@prisma-next/sql-contract/authoring` (Layer 1 — Core, SQL domain)
- `@prisma-next/sql-contract/types` (Layer 1 — Core, SQL domain)

No upward imports (runtime, adapters, targets) are present in the DSL or lowering modules. The dependency direction respects the layering invariant.

### Deterministic Artifacts

The lowering pipeline produces output through the existing `SqlContractBuilder.build()` which normalizes the contract IR deterministically. The staged path does not introduce new non-deterministic ordering — model iteration uses `Object.entries()` on the user-provided `models` record, which preserves insertion order.

## ADRs and Design Decisions

The spec references ADR 170 (Pack-provided type constructors and field presets) and ADR 096 (TS-authored contract parity & purity rules). The branch does not add new ADRs. Given the scale of this change — introducing a new semantic intermediate representation, a new authoring surface, and a pack-driven composition model — it would be reasonable to capture the staged DSL design and the semantic contract IR as an ADR for long-term architectural reference.

**Recommendation**: Consider authoring an ADR documenting the staged contract DSL architecture, the `SqlSemanticContractDefinition` IR, and the lowering pipeline as a durable design record.

## Test Strategy Assessment

### What Must Be Proven

1. **Staged DSL lowering correctness**: That the staged surface lowers to the same contract IR as the equivalent explicit builder calls.
2. **TS ↔ PSL parity**: That equivalent contracts authored in TS and PSL produce identical output.
3. **Composition correctness**: That pack-driven field/type helpers compose correctly and produce the expected descriptors.
4. **Validation and error handling**: That invalid inputs (duplicate names, missing refs, bad constraint combinations) fail fast with clear errors.
5. **Warning system**: That fallback diagnostics fire when typed alternatives are available.

### Where Tests Exist

- **Staged DSL unit tests**: `contract-builder.staged-contract-dsl.test.ts`, `contract-builder.staged-contract-dsl.helpers.test.ts`, `staged-contract-dsl.runtime.test.ts`
- **Lowering tests**: `staged-contract-lowering.runtime.test.ts`
- **Parity tests**: `contract-builder.staged-contract-dsl.parity.test.ts` (TS side), `ts-psl-parity.test.ts` (cross-surface)
- **Portability tests**: `contract-builder.staged-contract-dsl.portability.test.ts`
- **Helper runtime tests**: `authoring-helper-runtime.test.ts`
- **Warning tests**: `staged-contract-warnings.test.ts`
- **Semantic contract tests**: `contract-builder.semantic-contract.test.ts`
- **Integration tests**: `test/integration/test/contract-builder.test.ts`, `test/integration/test/contract-builder.types.test-d.ts`
- **Constraint tests**: `contract-builder.constraints.test.ts`

### Assessment

The test coverage is thorough for a first implementation slice. The parity test is a strong design proof. The type-level tests (`*.test-d.ts`) validate compile-time inference, which is critical for the no-emit use case.

**Gap**: There is no explicit test for the `defineContract(scaffold, factory)` two-argument form that exercises the `createComposedAuthoringHelpers` path end-to-end with extension packs contributing field helpers. The parity test uses this form, but it would be valuable to have a focused test that asserts composed helpers from multiple packs merge correctly at the integration level.

**Improvement since initial review**: Self-referential and circular relation tests have been added, `applyNaming` edge cases are now covered, and the emitter deterministically sorts output entries.

## Architectural Strengths

1. **Clean intermediate representation**: `SqlSemanticContractDefinition` is a well-defined interface boundary between authoring and the existing builder. This makes the staged surface testable in isolation and opens the door for other authoring surfaces (e.g., a future JSON-based or programmatic surface) to target the same IR.

2. **Composition-driven vocabulary**: The field/type helper surface is genuinely derived from pack descriptors, not hand-maintained. This means adding a new target or extension automatically extends the authoring vocabulary.

3. **Backward-compatible integration**: The staged surface coexists with the existing chain builder via overloaded `defineContract()`. Existing contracts continue to work unchanged.

4. **Fallback diagnostics**: The warning system for string-based refs is a good UX touch — it guides authors toward typed tokens without breaking existing patterns.

## Architectural Concerns

### 1. Two Separate Lowering Paths (Moderate)

`SqlSemanticContractDefinition` is exported from the package and is a well-defined IR. However, PSL currently lowers directly to the existing builder rather than targeting this IR. If the intent is for PSL and TS to share a common lowering target, the PSL interpreter could eventually lower to `SqlSemanticContractDefinition` and then use `buildSqlContractFromSemanticDefinition`. This would unify the two lowering paths and make the parity proof structural rather than fixture-based.

### 2. Builder Type Erasure Pattern (Low)

`buildSqlContractFromSemanticDefinition` uses a `SemanticContractBuilder` protocol type to erase the generics of `SqlContractBuilder` during imperative construction. This works but couples the staged path to the existing builder's runtime behavior while discarding its type-level guarantees. The cast chain (`as unknown as SemanticContractBuilder`) is documented but fragile — if the builder's runtime behavior changes, the semantic path may silently break.

### 3. Warning Emission via `process.emitWarning` (Low)

Warnings are emitted via Node.js `process.emitWarning`, which is appropriate for CLI/build-time usage but may not be ideal for all environments (e.g., browser-based authoring or test runners where warning noise is distracting). The batching threshold (`WARNING_BATCH_THRESHOLD = 5`) is a good mitigation.

### 4. Scale of the `contract-builder.ts` Module (Moderate)

At ~1,890 lines, `contract-builder.ts` is responsible for both the old chain builder, the new staged builder, the `SqlContractResult` type computation, and the `defineContract` overloads. Some extractions have occurred (type utilities to `authoring-type-utils.ts`, lowering to `staged-contract-lowering.ts`, warnings to `staged-contract-warnings.ts`), but the type-level machinery for computing storage tables, mappings, and column types from the staged definition remains in this module. Consider whether the staged type computation could be extracted into a dedicated module (e.g., `staged-contract-types.ts`) to improve navigability.

## Capability Gating

The staged surface correctly passes through `capabilities` from the contract definition to the built contract. Extension packs are validated (family and target checks) in the `extensionPacks()` method. The `foreignKeyDefaults` config is forwarded to the builder's `applyFkDefaults` during lowering.

## Summary

The staged contract DSL is architecturally sound. It introduces a clean semantic layer, respects existing boundaries, and is well-proven by tests. The main architectural considerations for follow-up are: (1) promoting the semantic IR to a shared contract between authoring surfaces, (2) eventually splitting the large `contract-builder.ts` module, and (3) capturing the design in an ADR for durability.
