# Code Review — Milestone 2: Migrate Consumers to Domain-Level Type Fields

**Spec:** [projects/contract-domain-extraction/spec.md](../spec.md)
**Plan:** [projects/contract-domain-extraction/plan.md](../plan.md)
**Linear:** [TML-2175](https://linear.app/prisma-company/issue/TML-2175/migrate-consumers-to-new-domain-level-type-fields-m2)
**Branch:** `tml-2175-migrate-consumers-to-new-domain-level-type-fields-m2`
**Review range:** `f133394ea...HEAD` (4 commits, 20 files, +715 / −757)

## Summary

Migrates the `sql-orm-client` and `relational-core` consumer code from reading old contract paths (`mappings.`*, top-level `relations`, storage-layer `codecId`) to new domain-level paths (`model.storage.*`, `model.relations`, `model.fields[f].codecId`). The migration is thorough, well-structured, and introduces useful centralized resolution helpers. Test fixtures are updated to match.

## What Looks Solid

- **Consistent migration pattern.** Every call site that previously read `contract.mappings.fieldToColumn[model][field]` now calls `resolveFieldToColumn(contract, model, field)` or `getFieldToColumnMap(contract, model)`. No half-measures.
- **Centralized resolution in `collection-contract.ts`.** The new helper functions (`resolveFieldToColumn`, `getFieldToColumnMap`, `getColumnToFieldMap`, `findModelNameForTable`, `resolveModelTableName`) provide a clean internal API with WeakMap-based memoization. Callers no longer need to know the contract layout.
- **Removal of legacy `model`/`foreignKey` relation format.** The old `resolveLegacyModelRelation` fallback and `resolveRelatedModelName` (which checked both `to` and `model`) are removed. Relations now uniformly use `{ to, cardinality, on: { localFields, targetFields } }`.
- **Type-level generics migrated cleanly.** `ModelTableName`, `FieldColumnName`, `RelationsOf`, `ChildForeignKeyFieldNames`, `ExtractTableToModel`, and `ExtractColumnToField` all derive from domain-level fields now. The old `ModelTableFromMappings` / `ContractRelations` indirection layers are removed.
- **Test fixtures updated to ADR 172 format.** The `contract.json` and `contract.d.ts` fixtures now include `model.storage.fields`, `model.relations`, `roots`, and domain-level `model.fields`.
- **Net negative diff.** +715 / −757 lines — the migration slightly reduces code volume despite adding the resolution helper module.

## Blocking Issues

None identified. The migration is functionally complete for the ORM client and relational-core scope.

## Non-blocking Concerns

### NB-F05: `collection-contract.ts` has grown into a large utility module

- [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — 233 lines

**Issue:** This file started as a focused contract-access module and has grown to include: field↔column resolution, model↔table resolution, relation resolution, upsert conflict column resolution, primary key resolution, capability checking, and cardinality helpers. Many of these are general-purpose contract utilities.

**Suggestion:** If more consumers need these utilities (e.g., other extensions), consider extracting the general helpers (`resolveFieldToColumn`, `getFieldToColumnMap`, `findModelNameForTable`, `resolveModelTableName`) to a shared package. Not urgent for M2 scope.

## Resolved Findings

| Finding | Resolution |
| --- | --- |
| **NB-F01**: Repeated `as Record<string, ...>` casts on `contract.models` | Deferred to M3 — added plan task 3.6.1 (casts become unnecessary once `ContractBase.models` is concretely typed in 3.6) |
| **NB-F02**: `getFieldToColumnMap()` / `getColumnToFieldMap()` called per-query without caching | Fixed — added `WeakMap`-based memoization keyed by contract + model name |
| **NB-F03**: `findModelNameForTable()` is O(n) over models | Fixed — added `WeakMap`-based memoization keyed by contract + table name |
| **NB-F04**: `mapFieldToColumn()` is a pure delegation to `resolveFieldToColumn()` | Fixed — removed `mapFieldToColumn()`, replaced all call sites with `resolveFieldToColumn()` |
| **NB-F06**: Plan task 2.7 (paradedb migration) not addressed | Confirmed N/A — `paradedb` defines extension-pack descriptors and index types; it does not consume `mappings` or top-level `relations`. Plan updated. |
| **NIT-F07**: Inconsistent lowering fallback in `resolveModelTableName` | Fixed — `resolveModelTableName` now throws when `storage.table` is missing instead of using a string manipulation fallback. A validated contract must always provide `storage.table`. |
| **NIT-F08**: `fkColumn` / `parentPkColumn` naming | Fixed — renamed to `targetColumn` / `localColumn` throughout `IncludeExpr`, `ResolvedIncludeRelation`, and all consumers to align with ADR 172 `localFields`/`targetFields` vocabulary |

## Acceptance-Criteria Traceability

### Phase 2 Acceptance Criteria


| Criterion                                                                  | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORM client reads field types from `model.fields[f].codecId` and `nullable` | [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — lines 68–81; [packages/3-extensions/sql-orm-client/src/filters.ts](packages/3-extensions/sql-orm-client/src/filters.ts) — lines 68–83                                                                                                                                                                           | [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts); [packages/3-extensions/sql-orm-client/test/filters.test.ts](packages/3-extensions/sql-orm-client/test/filters.test.ts)                     |
| ORM client reads field-to-column from `model.storage.fields`               | [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 16–34; callers in `aggregate-builder.ts`, `collection.ts`, `grouped-collection.ts`, `model-accessor.ts`, `filters.ts`                                                                                                                                                                           | [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts)                                                                                                                                   |
| ORM client reads relations from `model.relations`                          | [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — lines 46–48; [packages/3-extensions/sql-orm-client/src/mutation-executor.ts](packages/3-extensions/sql-orm-client/src/mutation-executor.ts) — lines 670–675; [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 102–139 | [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts); [packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts](packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts) |
| No consumer imports or reads from `mappings`                               | Grep verified: zero `contract.mappings`, `TContract['mappings']`, or `['mappings']` references in `sql-orm-client/src/` or `relational-core/src/`                                                                                                                                                                                                                                                                                          | Manual grep verification                                                                                                                                                                                                                                                         |
| No consumer reads top-level `relations`                                    | Grep verified: zero `contract.relations` references in `sql-orm-client/src/`                                                                                                                                                                                                                                                                                                                                                               | Manual grep verification                                                                                                                                                                                                                                                         |


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
| 2.8 verification            | ✅ Done     | Confirmed via grep                                                                                                         |
