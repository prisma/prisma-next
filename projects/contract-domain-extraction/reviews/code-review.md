# Code Review — Milestone 2: Migrate Consumers to Domain-Level Type Fields

**Spec:** [projects/contract-domain-extraction/spec.md](../spec.md)
**Plan:** [projects/contract-domain-extraction/plan.md](../plan.md)
**Linear:** [TML-2175](https://linear.app/prisma-company/issue/TML-2175/migrate-consumers-to-new-domain-level-type-fields-m2)
**Branch:** `tml-2175-migrate-consumers-to-new-domain-level-type-fields-m2`
**Review range:** `f133394ea...HEAD` (6 commits, 22 files, +811 / −837)

## Summary

Migrates the `sql-orm-client` and `relational-core` consumer code from reading old contract paths (`mappings.*`, top-level `relations`, storage-layer `codecId`) to new domain-level paths (`model.storage.*`, `model.relations`, `model.fields[f].codecId`). The migration is thorough, well-structured, and introduces centralized resolution helpers with WeakMap-based memoization. Test fixtures and expectations are updated to match.

## What Looks Solid

- **Consistent migration pattern.** Every call site that previously read `contract.mappings.fieldToColumn[model][field]` now calls `resolveFieldToColumn(contract, model, field)` or `getFieldToColumnMap(contract, model)`. Zero references to old patterns remain in either source or test code.
- **Centralized resolution in `collection-contract.ts`.** The helper functions (`resolveFieldToColumn`, `getFieldToColumnMap`, `getColumnToFieldMap`, `findModelNameForTable`, `resolveModelTableName`) provide a clean internal API with WeakMap-backed memoization, so repeated queries against the same contract don't rebuild maps.
- **Removal of legacy `model`/`foreignKey` relation format.** The old `resolveLegacyModelRelation` fallback and `resolveRelatedModelName` (which checked both `to` and `model`) are removed. Relations now uniformly use `{ to, cardinality, on: { localFields, targetFields } }`.
- **Consistent ADR 172 vocabulary.** Include-relation naming uses `localColumn`/`targetColumn` throughout `IncludeExpr`, `ResolvedIncludeRelation`, and all consumers — matching the `localFields`/`targetFields` vocabulary from ADR 172.
- **Strict contract enforcement.** `resolveModelTableName` throws when `storage.table` is missing instead of silently falling back to a string transformation. A validated contract is expected to always provide `storage.table`.
- **No delegation wrappers.** `mapFieldToColumn` was removed; all callers use `resolveFieldToColumn` directly.
- **Type-level generics migrated cleanly.** `ModelTableName`, `FieldColumnName`, `RelationsOf`, `ChildForeignKeyFieldNames`, `ExtractTableToModel`, and `ExtractColumnToField` all derive from domain-level fields now. The old `ModelTableFromMappings` / `ContractRelations` indirection layers are removed.
- **Test fixtures updated to ADR 172 format.** The `contract.json` and `contract.d.ts` fixtures include `model.storage.fields`, `model.relations`, `roots`, and domain-level `model.fields`.
- **Net negative diff.** The migration reduces code volume despite adding the resolution helper module and memoization.

## Blocking Issues

None identified. The migration is functionally complete for the ORM client and relational-core scope.

## Non-blocking Concerns

### NB-F01: Repeated `as Record<string, ...>` casts in runtime code

Several files cast `contract.models` to local shape types:

- [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — line 13: `contract.models as ModelsMap`
- [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — lines 47, 74: `contract.models as Record<string, { relations?: ... }>` and `contract.models as Record<string, { fields?: ... }>`
- [packages/3-extensions/sql-orm-client/src/filters.ts](packages/3-extensions/sql-orm-client/src/filters.ts) — lines 73–76: same pattern
- [packages/3-extensions/sql-orm-client/src/mutation-executor.ts](packages/3-extensions/sql-orm-client/src/mutation-executor.ts) — line 674: `contract.models as Record<string, { relations?: ... }>`

**Status:** Deferred to M3. Plan task 3.6.1 tracks removing these casts once `ContractBase.models` is concretely typed (3.6).

### NB-F05: `collection-contract.ts` has grown into a large utility module

- [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — 264 lines

**Issue:** This file includes: field↔column resolution (with memoization caches), model↔table resolution, relation resolution, upsert conflict column resolution, primary key resolution, capability checking, and cardinality helpers.

**Suggestion:** If more consumers need these utilities (e.g., other extensions), consider extracting the general helpers to a shared package. Not urgent for M2 scope.

## Acceptance-Criteria Traceability

### Phase 2 Acceptance Criteria


| Criterion                                                                  | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORM client reads field types from `model.fields[f].codecId` and `nullable` | [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — lines 68–81; [packages/3-extensions/sql-orm-client/src/filters.ts](packages/3-extensions/sql-orm-client/src/filters.ts) — lines 68–83                                                                                                                                                                           | [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts); [packages/3-extensions/sql-orm-client/test/filters.test.ts](packages/3-extensions/sql-orm-client/test/filters.test.ts)                     |
| ORM client reads field-to-column from `model.storage.fields`               | [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 20–47; callers in `aggregate-builder.ts`, `collection.ts`, `grouped-collection.ts`, `model-accessor.ts`, `filters.ts`                                                                                                                                                                           | [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts); [packages/3-extensions/sql-orm-client/test/collection-column-mapping.test.ts](packages/3-extensions/sql-orm-client/test/collection-column-mapping.test.ts) |
| ORM client reads relations from `model.relations`                          | [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — lines 46–48; [packages/3-extensions/sql-orm-client/src/mutation-executor.ts](packages/3-extensions/sql-orm-client/src/mutation-executor.ts) — lines 670–675; [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 108–131 | [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts); [packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts](packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts) |
| No consumer imports or reads from `mappings`                               | Grep verified: zero `contract.mappings`, `TContract['mappings']`, or `['mappings']` references in `sql-orm-client/src/` or `relational-core/src/`                                                                                                                                                                                                                                                                                          | Manual grep verification (confirmed clean)                                                                                                                                                                                                                                       |
| No consumer reads top-level `relations`                                    | Grep verified: zero `contract.relations` references in `sql-orm-client/src/`                                                                                                                                                                                                                                                                                                                                                               | Manual grep verification (confirmed clean)                                                                                                                                                                                                                                       |


### Additional M2 tasks from plan


| Task                        | Status     | Notes                                                                                                                      |
| --------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2.1 field↔column resolution | ✅ Done     | `aggregate-builder.ts`, `collection.ts`, `grouped-collection.ts`, `collection-contract.ts`                                 |
| 2.2 model→table resolution  | ✅ Done     | `resolveModelTableName()` centralized in `collection-contract.ts`                                                          |
| 2.3 relations migration     | ✅ Done     | `model-accessor.ts`, `mutation-executor.ts`, `collection-contract.ts`                                                      |
| 2.4 field type reads        | ✅ Done     | `resolveFieldTraits()`, `assertFieldHasEqualityTrait()` read from `model.fields`                                           |
| 2.5 type-level generics     | ✅ Done     | `types.ts` fully migrated                                                                                                  |
| 2.6 relational-core types   | ✅ Done     | `ExtractTableToModel`, `ExtractColumnToField`, `ExtractColumnJsTypeFromModels`                                             |
| 2.7 paradedb extension      | N/A        | `paradedb` does not consume `mappings` or top-level `relations`                                                            |
| 2.8 verification            | ✅ Done     | Confirmed via grep — zero old-pattern references in source or test code                                                    |
