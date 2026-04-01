# Contract Domain-Storage Separation — Execution Plan

## Summary

Restructure the emitted SQL contract to implement ADR 172's domain-storage separation: extract a shared domain-level representation into `ContractBase`, update the SQL emitter to produce the new JSON layout, and bridge `validateContract()` so no consumer code changes until M2. Build a Mongo emitter hook (M3) that forces out shared domain-level generation utilities, then migrate the SQL hook onto those utilities (M6). This is the foundational step toward cross-family consumer code (ORM, validation, tooling). Success means the contract carries a self-describing domain level (`roots`, `models` with typed fields and relations) distinct from family-specific storage, with all existing consumers continuing to work via a compatibility bridge.

**Spec:** [projects/contract-domain-extraction/spec.md](spec.md)

**Linear:** [WS4: MongoDB & Cross-Family Architecture](https://linear.app/prisma-company/project/ws4-mongodb-and-cross-family-architecture-89d4dcdbcd9a) — milestones M1–M6. Tickets: [TML-2172](https://linear.app/prisma-company/issue/TML-2172) (M1), [TML-2175](https://linear.app/prisma-company/issue/TML-2175) (M2), [TML-2176](https://linear.app/prisma-company/issue/TML-2176) (M3)

## Collaborators


| Role         | Person/Team | Context                                                            |
| ------------ | ----------- | ------------------------------------------------------------------ |
| Maker        | Will        | Drives execution                                                   |
| Collaborator | Alexey      | ORM client — Phase 2 migration must coordinate with his workstream |
| Collaborator | Alberto     | DSL/authoring — M5 IR alignment benefits his workstream            |


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
- **2.7** ~~Migrate `paradedb` extension~~: N/A — `paradedb` defines extension-pack descriptors and index types; it does not consume `mappings` or top-level `relations`.
- **2.8** Verify: no consumer imports or reads from `mappings`, no consumer reads top-level `relations`.

### Milestone 3: Mongo emitter hook (with shared domain-level generation)

Builds a `mongoTargetFamilyHook` that implements `generateContractTypes()` for the Mongo family. The domain-level generation (roots type, model domain fields, relations, imports, hashes, `.d.ts` skeleton) is factored into shared utility functions in the framework from the start — the Mongo hook only writes storage-specific parts (collection mappings, embedded document types). These shared utilities become the proven API that M6 migrates the SQL hook onto.

This milestone is the forcing function that defines the shared generation API. It can run in parallel with M2 (consumer migration) since it doesn't touch the SQL emitter.

**Tasks:**

- **3.1** Extract domain-level `.d.ts` generation from `sqlTargetFamilyHook` into shared utility functions in the framework emitter package: `generateRootsType()`, model domain field type generation, model relation type generation, import deduplication, hash type aliases, codec/operation type intersections, `.d.ts` template skeleton.
- **3.2** Implement `mongoTargetFamilyHook.generateContractTypes()` using the shared utilities for domain-level generation. The Mongo hook provides: `generateStorageType()` (collection mappings), `generateModelStorageType()` (embedded document storage, `storage.relations` mapping), and Mongo-specific validation.
- **3.3** Implement `mongoTargetFamilyHook.validateStructure()` for Mongo-specific contract validation (collection names, embedded document constraints, owner/`storage.relations` consistency).
- **3.4** Write emitter tests for the Mongo hook: verify generated `contract.json` and `contract.d.ts` match the ADR 172/177 Mongo contract structure (as shown in ADR 177's examples).
- **3.5** Verify SQL emitter output is unchanged — the shared utilities are used by Mongo but the SQL hook still uses its own `generateContractTypes()` (migrated in M6).
- **3.6** Set up a minimal Mongo demo/fixture contract to exercise the Mongo emitter end-to-end.

### Milestone 4: Remove old type fields

Removes the backward-compatibility shim from `validateContract()` and old fields from `SqlContract`. Only possible after all consumers are migrated (Milestone 2 complete).

**Tasks:**

- **4.1** Remove `mappings` from `SqlContract` type and `validateContract()` derivation logic.
- **4.2** Remove top-level `relations` from `SqlContract` type and `validateContract()` derivation logic.
- **4.3** Remove old model field shape (`{ column: string }` without `nullable`/`codecId`) from the type.
- **4.4** Update `contract.d.ts` emission to reflect the final shape (no old fields).
- **4.5** Remove old-format JSON support from `normalizeContract()` (if dual-format was added in 1.3.1).
- **4.6** Remove the generic `TModels` parameter from `ContractBase`. Once consumers read from domain-level fields and `SqlContract` no longer carries query-builder-specific model types via `M`, simplify `ContractBase` back to a concrete `models: Record<string, DomainModel>`. The generic was introduced to avoid `noPropertyAccessFromIndexSignature` index-signature leakage while `SqlContract`'s `M` still overrides the base `models` type.
- **4.6.1** Remove repeated `as Record<string, ...>` casts on `contract.models` in ORM-client helpers. Once `ContractBase.models` is concretely typed (4.6), the casts added during M2 become unnecessary — remove them and verify the typed access compiles without casts.
- **4.7** Update all remaining test fixtures and type tests to reflect the clean types.
- **4.8** Run full test suite and typecheck.

### Milestone 5: Contract IR alignment

Aligns the internal `ContractIR` representation with the emitted contract JSON structure. Reduces impedance mismatch for the DSL authoring layer. Coordinate timing with Alberto.

**Tasks:**

- **5.1** Audit current `ContractIR` structure vs the emitted JSON. Document the structural gaps (e.g., IR has top-level `relations` and `mappings`; emitted JSON does not).
- **5.2** Update `ContractIR` to mirror the ADR 172 structure: domain-level `models` with `fields`/`relations`/`storage`, `roots`, no top-level `relations` or `mappings`.
- **5.3** Update the emitter (`emit.ts`) to read from the new IR structure (remove translation logic that was bridging old IR → new JSON).
- **5.4** Update all IR construction sites: PSL interpreter, TypeScript contract builders (`contract-ts`), and any tooling that produces `ContractIR`.
- **5.5** Update IR-level tests and validation.
- **5.6** Run full test suite and typecheck.

### Milestone 6: SQL emitter migration to shared generation

Migrates the SQL emitter hook onto the shared domain-level generation utilities established in M3 (Mongo emitter hook). The `TargetFamilyHook` interface narrows: `generateContractTypes()` is removed, and hooks provide only storage-specific type blocks. The shared utilities are already proven by the Mongo hook — this milestone is a migration, not a design exercise.

**Tasks:**

#### 6.1 Migrate SQL hook to shared utilities

- **6.1.1** Replace SQL hook's `generateRootsType()`, model domain field generation, model relation generation, import deduplication, hash aliases, and `.d.ts` skeleton with calls to the shared framework utilities (established in M3 task 3.1).
- **6.1.2** Implement `generateStorageType(storage)` on the SQL hook (extract from current `generateStorageType` — already a separate method, just needs to conform to the shared interface).
- **6.1.3** Implement `generateModelStorageType(model, storage)` on the SQL hook (field-to-column mapping type generation, extracted from `generateModelsType`).
- **6.1.4** Remove `generateContractTypes()`, `generateModelsType()`, `generateRootsType()`, `generateRelationsType()`, `generateMappingsType()` from the SQL hook (now framework-owned or obsolete after M4).
- **6.1.5** Update `serializeValue()` / `serializeObjectKey()` — decide whether these are shared utilities (framework) or hook-specific. Likely framework.

#### 6.2 Narrow the hook interface

- **6.2.1** Update the `TargetFamilyHook` interface: remove `generateContractTypes()`, require `generateStorageType(storage)`, `generateModelStorageType(model, storage)`, and any other family-specific type generation callbacks. Keep `validateTypes()` and `validateStructure()` on the hook.
- **6.2.2** Verify both SQL and Mongo hooks conform to the narrowed interface.

#### 6.3 Regression verification

- **6.3.1** Verify generated `contract.d.ts` is byte-identical (modulo formatting) before and after the refactor, using the demo contract and all 12 parity fixtures.
- **6.3.2** Run full test suite and typecheck.
- **6.3.3** Update emitter hook tests to test the new interface methods individually.

### Close-out

- **C.1** Verify all acceptance criteria from the spec are met (cross-reference each criterion with its test evidence).
- **C.2** Finalize ADR 172 (mark as "implemented" if applicable) and update the Data Contract subsystem doc to reflect the new structure.
- **C.3** Migrate any long-lived documentation from `projects/contract-domain-extraction/` into `docs/`.
- **C.4** Strip repo-wide references to `projects/contract-domain-extraction/`** (replace with canonical `docs/` links or remove).
- **C.5** Delete `projects/contract-domain-extraction/`.

## Test Coverage


| Acceptance Criterion                                                                                                  | Test Type          | Task/Milestone | Notes                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------- | ------------------------------------------------------ |
| SQL emitter produces ADR 172 JSON: `roots`, `models` with `{ nullable, codecId }`, `model.relations`, `model.storage` | Unit + Integration | 1.4.4, 1.5.7   | Emitter tests + integration artifact shape test        |
| Demo and test fixture `contract.json` files reflect new structure                                                     | Integration        | 1.5.1–1.5.7    | All existing tests pass with updated fixtures          |
| `ContractBase` has typed `roots`, `models` (with domain fields)                                                       | Type test          | 1.1.4          | `test-d.ts` assertions                                 |
| `SqlContract extends ContractBase` with SQL storage + retains old fields                                              | Type test          | 1.1.4          | `test-d.ts` assertions                                 |
| Emitted `contract.d.ts` includes both old and new field shapes                                                        | Unit               | 1.4.4          | Emitter generation tests                               |
| `validateContract()` parses new JSON and returns widened type with old fields                                         | Unit               | 1.3.5          | Bridge round-trip tests                                |
| Shared domain validation runs as part of SQL `validateContract()`                                                     | Unit               | 1.3.2, 1.2.2   | Domain validation tests ported from mongo              |
| ORM client, query builder, authoring surfaces not modified in M1                                                      | Manual/CI          | 1.6.3          | Git diff verification — no changes to consumer `src/`  |
| All existing tests pass without modification (M1)                                                                     | CI                 | 1.5.7, 1.6.2   | Full test suite                                        |
| ORM client reads from domain fields (M2)                                                                              | Unit + Integration | 2.1–2.4        | ORM client test suite                                  |
| No consumer reads `mappings` or top-level `relations` (M2)                                                            | Manual + grep      | 2.8            | Code search verification                               |
| Mongo emitter produces ADR 172/177 contract JSON and `.d.ts` (M3)                                                     | Unit               | 3.4            | Mongo emitter tests                                    |
| Shared domain-level generation utilities used by Mongo hook (M3)                                                      | Unit + Regression  | 3.5            | SQL output unchanged after shared extraction           |
| `mappings` removed from `SqlContract` (M4)                                                                            | Type test + CI     | 4.1, 4.7       | Compile-time verification                              |
| Top-level `relations` removed (M4)                                                                                    | Type test + CI     | 4.2, 4.7       | Compile-time verification                              |
| Old field shape removed (M4)                                                                                          | Type test + CI     | 4.3, 4.7       | Compile-time verification                              |
| `contract.d.ts` reflects final shape (M4)                                                                             | Unit               | 4.4            | Emitter generation tests                               |
| `ContractIR` mirrors emitted JSON (M5)                                                                                | Unit + Integration | 5.5            | IR tests                                               |
| SQL hook uses shared domain-level generation (M6)                                                                     | Unit + Regression  | 6.3.1–6.3.3    | Byte-identical `.d.ts` output; updated hook unit tests |
| `TargetFamilyHook` interface narrowed (M6)                                                                            | Interface test     | 6.2.1–6.2.2    | Both hooks conform to narrowed interface               |


## Open Items

1. **Dual-format `normalizeContract()`.** Task 1.3.1 adds detection of old vs new JSON format in `normalizeContract()` to enable incremental fixture migration. This adds temporary complexity but significantly reduces risk — fixtures can be migrated across multiple PRs rather than atomically. The old-format path is removed in task 4.5.
2. ~~**Spec open questions.**~~ **All resolved** (see spec § Open Questions):
  - `model.storage.fields` shape: `{ column: string }` only. Top-level `storage.tables` is the single source of truth for column metadata.
  - Relation join naming: `localFields`/`targetFields` (not `childCols`/`parentCols`).
  - `roots` derivation: emitter derives for now; IR supplies in M5.
  - `model.relations` shape: per [ADR 177](../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md), plain graph edges — no `strategy`. Owned models declare `"owner"` on the model itself.
3. **M2 coordination with Alexey.** The ORM client migration (tasks 2.1–2.5) touches core ORM internals. This must be sequenced to avoid conflicts with Alexey's active ORM development. The widened types from M1 allow him to migrate incrementally.
4. **`paradedb` extension (`packages/3-extensions/paradedb/`).** Task 2.7 covers BM25 index column resolution. Confirm this extension is actively maintained and whether its owner needs notification.
5. **M3 sequencing.** The Mongo emitter hook (M3) can run in parallel with M2 since it doesn't touch the SQL emitter. It establishes the shared domain-level generation API that M6 later migrates the SQL hook onto.

