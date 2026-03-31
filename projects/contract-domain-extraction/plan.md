# Contract Domain-Storage Separation — Execution Plan

## Summary

Restructure the emitted SQL contract to implement ADR 172's domain-storage separation: extract a shared domain-level representation into `ContractBase`, update the SQL emitter to produce the new JSON layout, and bridge `validateContract()` so no consumer code changes until Phase 2. This is the foundational step toward cross-family consumer code (ORM, validation, tooling). Success means the contract carries a self-describing domain level (`roots`, `models` with typed fields and relations) distinct from SQL-specific storage, with all existing consumers continuing to work via a compatibility bridge.

**Spec:** [projects/contract-domain-extraction/spec.md](spec.md)

**Linear:** [TML-2172](https://linear.app/prisma-company/issue/TML-2172) under [WS4: MongoDB & Cross-Family Architecture](https://linear.app/prisma-company/project/ws4-mongodb-and-cross-family-architecture-89d4dcdbcd9a) → milestone "P1: Contract extraction"

## Collaborators


| Role         | Person/Team | Context                                                            |
| ------------ | ----------- | ------------------------------------------------------------------ |
| Maker        | Will        | Drives execution                                                   |
| Collaborator | Alexey      | ORM client — Phase 2 migration must coordinate with his workstream |
| Collaborator | Alberto     | DSL/authoring — Phase 4 IR alignment benefits his workstream       |


## Milestones

### Milestone 1: New contract structure (no consumer changes)

Delivers the ADR 172 contract JSON structure, widened TypeScript types, and `validateContract()` bridging — all without modifying consumer code (ORM, query builder, authoring surfaces). All existing tests pass.

**Tasks:**

#### 1.1 Type foundation

- **1.1.1** Add domain types to framework contract package: `DomainField` (`{ nullable: boolean; codecId: string }`), `DomainRelation` (`{ to: string; cardinality: string; on?: { localFields: string[]; targetFields: string[] } }` — no `strategy`, per [ADR 177](../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)), `DomainModel` (with `fields`, `relations`, optional `discriminator`/`variants`/`base`/`owner`, and generic `storage` extension point). Define in `packages/1-framework/1-core/shared/contract/src/`.
- **1.1.2** Widen `ContractBase` to include `roots: Record<string, string>` and `models: Record<string, DomainModel>`. Existing type parameters unchanged; new fields added alongside existing ones.
- **1.1.3** Widen `SqlContract` to include new domain fields from `ContractBase` alongside existing `mappings`, top-level `relations`, and current `model.fields` shape. The intersection type carries both old and new fields — consumers can read from either.
- **1.1.4** Write type tests verifying: (a) `SqlContract extends ContractBase`, (b) new domain fields are accessible on `SqlContract`, (c) old consumer-facing fields (`mappings`, `relations`, `model.fields.*.column`) remain accessible.

#### 1.2 Domain validation extraction

- **1.2.1** Extract `validateContractDomain()` from `packages/2-mongo-family/1-core/src/validate-domain.ts` into `packages/1-framework/1-core/shared/contract/src/validate-domain.ts`. Move the `DomainContractShape`, `DomainModelShape`, and `DomainValidationResult` types alongside it.
- **1.2.2** Port the existing tests from `packages/2-mongo-family/1-core/test/validate-domain.test.ts` to the framework package. Verify all validation rules: root→model references, variant↔base symmetry, relation target existence, discriminator field existence, single-level polymorphism, ownership validation (owner references valid model, no self-ownership, owned models not in roots), orphaned model warnings.
- **1.2.3** Update Mongo's `validate-domain.ts` to re-import from the framework package instead of defining its own copy. Verify Mongo tests still pass.

#### 1.3 Validation bridge (`validateContract`)

- **1.3.1** Update `normalizeContract()` in `packages/2-sql/1-core/contract/src/validate.ts` to detect and handle both old (current) and new (ADR 172) JSON formats. This enables incremental fixture migration.
- **1.3.2** Update `validateContract()` to call `validateContractDomain()` (from 1.2.1) as a first pass before SQL-specific storage validation.
- **1.3.3** Add bridging logic: derive old consumer-facing fields from the new structure — `mappings` from `model.storage.fields` + `model.storage.table`, top-level `relations` from `model.relations`, `model.fields[f].column` from `model.storage.fields[f].column`.
- **1.3.4** Update `constructContract()` to populate both old and new fields on the returned object.
- **1.3.5** Write tests verifying the bridge: pass ADR 172 JSON to `validateContract()`, assert the returned object has both old fields (identical to current behavior) and new domain fields.
- **1.3.6** Write tests verifying backward compatibility: pass current-format JSON to `validateContract()`, assert the returned object is identical to current behavior (plus new domain fields populated from the old structure).

#### 1.4 SQL emitter update

- **1.4.1** Update the SQL emitter hook (`packages/2-sql/3-tooling/emitter/src/index.ts`) to produce ADR 172 JSON: `roots` (derived from models with `storage.table`), `models` with `{ nullable, codecId }` fields, `model.relations` (model-keyed, with `on: { localFields, targetFields }` — no `strategy`, per [ADR 177](../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)), `model.storage` (with `table` and `fields` field-to-column mappings). Remove top-level `relations` and `mappings` from the emitted JSON.
- **1.4.2** Update the emitter's `validateStructure()` to validate the new JSON shape (e.g., every model has `fields`, `relations`, `storage`; every `model.storage.table` exists in `storage.tables`).
- **1.4.3** Update `generateContractTypes()` to emit `contract.d.ts` with both old and new type fields. The `Contract` type must include `roots`, `models` with domain fields, plus `mappings`, top-level `relations`, and old `model.fields` shape for backward compatibility.
- **1.4.4** Update emitter tests (`packages/2-sql/3-tooling/emitter/test/`) to assert the new JSON structure and new `.d.ts` content.

#### 1.5 Fixture migration

- **1.5.1** Update the demo contract: `examples/prisma-next-demo/src/prisma/contract.json` and `contract.d.ts` to the new structure. Regenerate by running the emitter (or update manually if the emitter isn't wired to the demo yet).
- **1.5.2** Update integration test fixtures: `test/integration/test/fixtures/contract.json`, the 12 authoring parity expected contracts under `test/integration/test/authoring/parity/`, and `test/integration/test/fixtures/contract.d.ts`.
- **1.5.3** Update package test fixture JSON files: `sql-lane` (3 files), `contract-ts` (2 files), `relational-core`, `sql-orm-client`, e2e framework, and `eslint`.
- **1.5.4** Update inline test contract objects in `*.test.ts` files. Prioritize by package: (a) `sql-contract` validate/construct tests (~~20 files), (b) `relational-core` operations-registry (~~26 inline contracts), (c) postgres planner/migration tests, (d) ORM client test helpers, (e) integration tests.
- **1.5.5** Update migration fixtures: the ~105 `migration.json` files under `examples/prisma-next-demo/migration-fixtures/`. The `storageHash` is based on the contract IR (not JSON bytes), so the structural JSON change should not alter hashes. With dual-format `normalizeContract()` (task 1.3.1), these can be migrated incrementally.
- **1.5.6** Update the JSON Schema (`packages/2-sql/2-authoring/contract-ts/schemas/data-contract-sql-v1.json`) to reflect the new structure.
- **1.5.7** Run full test suite (`pnpm test:all`) and verify zero failures. Fix any remaining fixture mismatches.

#### 1.6 Verification

- **1.6.1** Run `pnpm lint:deps` to verify no layering violations from the domain validation extraction.
- **1.6.2** Run `pnpm typecheck` across all packages.
- **1.6.3** Verify no changes to ORM client source (`packages/3-extensions/sql-orm-client/src/`), query builder source, or contract authoring source — only test fixtures updated.

### Milestone 2: Migrate consumers to new type fields

Migrates consumer code to read from the new domain-level TypeScript fields instead of the old SQL-specific ones. Coordinated with Alexey's ORM workstream. The JSON is already in ADR 172 format (Milestone 1). This phase is consumer-by-consumer, not atomic.

**Tasks:**

- **2.1** Migrate `sql-orm-client` field↔column resolution: replace `mappings.fieldToColumn[model][field]` reads with `contract.models[model].storage.fields[field].column` in `collection-column-mapping.ts`, `filters.ts`, `collection-contract.ts`, `collection-runtime.ts`, `collection.ts`, `model-accessor.ts`, `aggregate-builder.ts`, `grouped-collection.ts`, `mutation-executor.ts`.
- **2.2** Migrate `sql-orm-client` model→table resolution: replace `mappings.modelToTable[model]` reads with `contract.models[model].storage.table` in `collection-contract.ts`, `filters.ts`, `model-accessor.ts`.
- **2.3** Migrate `sql-orm-client` relations: replace `contract.relations[tableName]` reads with `contract.models[modelName].relations` in `collection-contract.ts`, `mutation-executor.ts`, `model-accessor.ts`.
- **2.4** Migrate `sql-orm-client` field type reads: replace storage-layer codec/nullable reads with `model.fields[f].codecId` and `model.fields[f].nullable`.
- **2.5** Update `sql-orm-client` type-level generics: update `types.ts` conditional types from `TContract['mappings']['fieldToColumn']` to domain-level access patterns.
- **2.6** Update `relational-core` types: update `ExtractTableToModel`/`ExtractColumnToField` in `packages/2-sql/4-lanes/relational-core/src/types.ts` to use new domain fields.
- **2.7** Migrate `paradedb` extension: update BM25 index field column resolution in `packages/3-extensions/paradedb/src/types/index-types.ts`.
- **2.8** Verify: no consumer imports or reads from `mappings`, no consumer reads top-level `relations`.

### Milestone 3: Remove old type fields

Removes the backward-compatibility shim from `validateContract()` and old fields from `SqlContract`. Only possible after all consumers are migrated (Milestone 2 complete).

**Tasks:**

- **3.1** Remove `mappings` from `SqlContract` type and `validateContract()` derivation logic.
- **3.2** Remove top-level `relations` from `SqlContract` type and `validateContract()` derivation logic.
- **3.3** Remove old model field shape (`{ column: string }` without `nullable`/`codecId`) from the type.
- **3.4** Update `contract.d.ts` emission to reflect the final shape (no old fields).
- **3.5** Remove old-format JSON support from `normalizeContract()` (if dual-format was added in 1.3.1).
- **3.6** Remove the generic `TModels` parameter from `ContractBase`. Once consumers read from domain-level fields and `SqlContract` no longer carries query-builder-specific model types via `M`, simplify `ContractBase` back to a concrete `models: Record<string, DomainModel>`. The generic was introduced to avoid `noPropertyAccessFromIndexSignature` index-signature leakage while `SqlContract`'s `M` still overrides the base `models` type.
- **3.7** Update all remaining test fixtures and type tests to reflect the clean types.
- **3.8** Run full test suite and typecheck.

### Milestone 4: Contract IR alignment

Aligns the internal `ContractIR` representation with the emitted contract JSON structure. Reduces impedance mismatch for the DSL authoring layer. Coordinate timing with Alberto.

**Tasks:**

- **4.1** Audit current `ContractIR` structure vs the emitted JSON. Document the structural gaps (e.g., IR has top-level `relations` and `mappings`; emitted JSON does not).
- **4.2** Update `ContractIR` to mirror the ADR 172 structure: domain-level `models` with `fields`/`relations`/`storage`, `roots`, no top-level `relations` or `mappings`.
- **4.3** Update the emitter (`emit.ts`) to read from the new IR structure (remove translation logic that was bridging old IR → new JSON).
- **4.4** Update all IR construction sites: PSL interpreter, TypeScript contract builders (`contract-ts`), and any tooling that produces `ContractIR`.
- **4.5** Update IR-level tests and validation.
- **4.6** Run full test suite and typecheck.

### Milestone 5: Emitter generalization

Refactors the `TargetFamilyHook` interface so the framework `emit()` generates domain-level `.d.ts` content and the family hook provides only storage-specific type blocks. Today `sqlTargetFamilyHook.generateContractTypes()` owns the entire `.d.ts` — ~60–70% of which (roots, model domain fields, model relations, imports, hashes, codec types, the template skeleton) is family-agnostic. This means any new family emitter would duplicate all of it. After this milestone, a new family hook only needs to provide storage-specific type generation.

Independent of Milestone 4 (IR alignment) — can be done before or after.

**Tasks:**

#### 5.1 Design the narrower hook interface

- **5.1.1** Audit `sqlTargetFamilyHook` methods and classify each as domain-level (framework) or storage-level (family). Document the split in a short design note.
- **5.1.2** Design the new `TargetFamilyHook` interface: remove `generateContractTypes()`, add `generateStorageType(storage)`, `generateModelStorageType(model, storage)`, and any other family-specific type generation callbacks needed. Keep `validateTypes()` and `validateStructure()` on the hook.

#### 5.2 Extract domain-level type generation to the framework

- **5.2.1** Move `generateRootsType()` to the framework emitter.
- **5.2.2** Move model domain field type generation (`generateColumnType()`, the codec → TypeScript type logic, parameterized renderer dispatch) to the framework emitter.
- **5.2.3** Move model relation type generation (ADR 172 `to`/`cardinality`/`on` serialization) to the framework emitter.
- **5.2.4** Move import deduplication, hash type aliases, codec/operation type intersections, `DefaultLiteralValue`, `TypeMaps`, and the `.d.ts` template skeleton to the framework emitter.
- **5.2.5** The framework emitter calls the hook's storage-specific methods to fill in the storage sections, then assembles the complete `.d.ts`.

#### 5.3 Update SQL hook to the narrower interface

- **5.3.1** Implement `generateStorageType(storage)` on the SQL hook (extract from current `generateStorageType` — already a separate method, just needs to conform to the new interface).
- **5.3.2** Implement `generateModelStorageType(model, storage)` on the SQL hook (field-to-column mapping type generation, extracted from `generateModelsType`).
- **5.3.3** Remove `generateContractTypes()`, `generateModelsType()`, `generateRootsType()`, `generateRelationsType()`, `generateMappingsType()` from the SQL hook (now framework-owned or obsolete after M3).
- **5.3.4** Update `serializeValue()` / `serializeObjectKey()` — decide whether these are shared utilities (framework) or hook-specific. Likely framework.

#### 5.4 Regression verification

- **5.4.1** Verify generated `contract.d.ts` is byte-identical (modulo formatting) before and after the refactor, using the demo contract and all 12 parity fixtures.
- **5.4.2** Run full test suite and typecheck.
- **5.4.3** Update emitter hook tests to test the new interface methods individually.

### Close-out

- **C.1** Verify all acceptance criteria from the spec are met (cross-reference each criterion with its test evidence).
- **C.2** Finalize ADR 172 (mark as "implemented" if applicable) and update the Data Contract subsystem doc to reflect the new structure.
- **C.3** Migrate any long-lived documentation from `projects/contract-domain-extraction/` into `docs/`.
- **C.4** Strip repo-wide references to `projects/contract-domain-extraction/`** (replace with canonical `docs/` links or remove).
- **C.5** Delete `projects/contract-domain-extraction/`.

## Test Coverage


| Acceptance Criterion                                                                                                  | Test Type          | Task/Milestone | Notes                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------- | ----------------------------------------------------- |
| SQL emitter produces ADR 172 JSON: `roots`, `models` with `{ nullable, codecId }`, `model.relations`, `model.storage` | Unit + Integration | 1.4.4, 1.5.7   | Emitter tests + integration artifact shape test       |
| Demo and test fixture `contract.json` files reflect new structure                                                     | Integration        | 1.5.1–1.5.7    | All existing tests pass with updated fixtures         |
| `ContractBase` has typed `roots`, `models` (with domain fields)                                                       | Type test          | 1.1.4          | `test-d.ts` assertions                                |
| `SqlContract extends ContractBase` with SQL storage + retains old fields                                              | Type test          | 1.1.4          | `test-d.ts` assertions                                |
| Emitted `contract.d.ts` includes both old and new field shapes                                                        | Unit               | 1.4.4          | Emitter generation tests                              |
| `validateContract()` parses new JSON and returns widened type with old fields                                         | Unit               | 1.3.5          | Bridge round-trip tests                               |
| Shared domain validation runs as part of SQL `validateContract()`                                                     | Unit               | 1.3.2, 1.2.2   | Domain validation tests ported from mongo             |
| ORM client, query builder, authoring surfaces not modified in Phase 1                                                 | Manual/CI          | 1.6.3          | Git diff verification — no changes to consumer `src/` |
| All existing tests pass without modification (Phase 1)                                                                | CI                 | 1.5.7, 1.6.2   | Full test suite                                       |
| ORM client reads from domain fields (Phase 2)                                                                         | Unit + Integration | 2.1–2.4        | ORM client test suite                                 |
| No consumer reads `mappings` or top-level `relations` (Phase 2)                                                       | Manual + grep      | 2.8            | Code search verification                              |
| `mappings` removed from `SqlContract` (Phase 3)                                                                       | Type test + CI     | 3.1, 3.7       | Compile-time verification                             |
| Top-level `relations` removed (Phase 3)                                                                               | Type test + CI     | 3.2, 3.7       | Compile-time verification                             |
| Old field shape removed (Phase 3)                                                                                     | Type test + CI     | 3.3, 3.7       | Compile-time verification                             |
| `contract.d.ts` reflects final shape (Phase 3)                                                                        | Unit               | 3.4            | Emitter generation tests                              |
| `ContractIR` mirrors emitted JSON (Phase 4)                                                                           | Unit + Integration | 4.5            | IR tests                                              |
| `TargetFamilyHook` no longer owns domain-level type generation (Phase 5)                                              | Unit + Regression  | 5.4.1–5.4.3    | Byte-identical `.d.ts` output; updated hook unit tests |
| New family hook only needs storage-specific methods (Phase 5)                                                          | Interface test     | 5.1.2, 5.3     | Hook interface conformance                            |


## Open Items

1. **Dual-format `normalizeContract()`.** Task 1.3.1 adds detection of old vs new JSON format in `normalizeContract()` to enable incremental fixture migration. This adds temporary complexity but significantly reduces risk — fixtures can be migrated across multiple PRs rather than atomically. The old-format path is removed in task 3.5.
2. **Spec open questions (with default assumptions from spec):**
  - `model.storage.fields` shape: just `{ column: string }` (minimal). Top-level `storage.tables` is source of truth for column metadata.
  - Relation join naming: use ADR 172 naming (`localFields`/`targetFields`), not old naming (`childCols`/`parentCols`).
  - `roots` derivation: emitter derives from existing model/table mapping. Explicit authoring-level roots is Phase 4 / DSL concern.
  - ~~`strategy` on relations~~: **Resolved.** Per [ADR 177](../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md), relations are plain graph edges — no `strategy` field. Owned models declare `"owner"` on the model itself.
3. **Phase 2 coordination with Alexey.** The ORM client migration (tasks 2.1–2.5) touches core ORM internals. This must be sequenced to avoid conflicts with Alexey's active ORM development. The widened types from Phase 1 allow him to migrate incrementally.
4. `**paradedb` extension (`packages/3-extensions/paradedb/`).** Task 2.7 covers BM25 index column resolution. Confirm this extension is actively maintained and whether its owner needs notification.
5. **Unresolved spec open questions** carried forward from spec (see spec § Open Questions for full context).

