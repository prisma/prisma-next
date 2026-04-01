# System Design Review — Milestone 2: Migrate Consumers to Domain-Level Type Fields

**Spec:** [projects/contract-domain-extraction/spec.md](../spec.md)
**Plan:** [projects/contract-domain-extraction/plan.md](../plan.md)
**Linear:** [TML-2175](https://linear.app/prisma-company/issue/TML-2175/migrate-consumers-to-new-domain-level-type-fields-m2)
**Branch:** `tml-2175-migrate-consumers-to-new-domain-level-type-fields-m2`
**Review range:** `f133394ea...HEAD` (4 commits, M2-specific)

## Problem Being Solved

Milestone 1 delivered the ADR 172 contract JSON structure and the `validateContract()` bridge that populates both old fields (e.g., `mappings`, top-level `relations`) and new domain-level fields on the returned contract object. Consumers continued reading from old paths.

Milestone 2 migrates consumer code to read from the new domain-level TypeScript fields (`model.storage.fields`, `model.storage.table`, `model.relations`, `model.fields[f].codecId`) instead of the old SQL-specific ones (`mappings.fieldToColumn`, `mappings.modelToTable`, `contract.relations[tableName]`, `storage.tables[t].columns[c].codecId`). This is required before M3 can remove the old fields.

## New Guarantees / Invariants

1. **All ORM client runtime reads use domain-level contract paths.** No ORM source file references `contract.mappings.*` or `contract.relations[tableName]`.
2. **All ORM client type-level generics derive from domain-level fields.** `ModelTableName`, `FieldColumnName`, `RelationsOf`, and `ChildForeignKeyFieldNames` read from `model.storage`, `model.relations`, and `model.fields` — not from `TContract['mappings']` or `TContract['relations']`.
3. **`relational-core` type utilities (`ExtractTableToModel`, `ExtractColumnToField`) derive from `model.storage`** instead of `contract.mappings`.
4. **Codec/trait resolution reads from `model.fields[f].codecId`** at runtime, not from `storage.tables[t].columns[c].codecId`.

## Subsystem Fit

### Contract data flow

The change is well-aligned with ADR 172's layered design:

```
ContractBase (domain: roots, models.fields, models.relations)
  └── SqlContract (storage: model.storage.table, model.storage.fields, storage.tables)
        └── validateContract() populates both old and new fields (M1 bridge)
              └── Consumers now read new fields ← THIS MILESTONE
                    └── M3 removes old fields and bridge
```

The consumer migration is scoped to two packages:
- **`sql-orm-client`** (10 source files) — the primary consumer of mappings and relations at runtime and type level
- **`relational-core`** (1 source file, `types.ts`) — type-level utilities used by the SQL query infrastructure

### Boundary correctness

- **Domain/layer/plane imports:** No new cross-layer imports introduced. The `collection-contract.ts` module in `sql-orm-client` serves as the internal abstraction layer for contract field access.
- **No target-specific branching:** The migration reads from `model.storage` and `model.fields`, which are target-agnostic domain paths. Storage-specific details (column metadata, PKs, FKs) are still read from `storage.tables` where appropriate.
- **Package layering:** `sql-orm-client` (layer 3-extensions) reads from `sql-contract` types (layer 2-sql/1-core) — correct import direction.

### Centralized resolution helpers

The migration introduces a well-structured set of resolution functions in `collection-contract.ts`:

| Function | Replaces | Notes |
|---|---|---|
| `resolveFieldToColumn()` | `mappings.fieldToColumn[model][field]` | Single field lookup |
| `getFieldToColumnMap()` | `mappings.fieldToColumn[model]` | Full map for model |
| `getColumnToFieldMap()` | `mappings.columnToField[table]` | Reverse mapping |
| `findModelNameForTable()` | `mappings.tableToModel[table]` | Table → model lookup |
| `resolveModelTableName()` | `mappings.modelToTable[model]` | Model → table (was duplicated) |

This is a good pattern: runtime resolution is centralized behind functions that know how to navigate the domain structure, rather than each call site understanding the contract layout.

### Type-level migration

The type utilities now derive their relationships structurally:
- `ModelTableName<C, M>` reads `model.storage.table` directly
- `FieldColumnName<C, M, F>` reads from `model.storage.fields`
- `RelationsOf<C, M>` reads from `model.relations`
- `ChildForeignKeyFieldNames<C, M>` scans all model relation entries for `targetFields`
- `ExtractTableToModel<C, T>` iterates models to find the matching `storage.table`
- `ExtractColumnToField<C, T, Col>` finds the field in `model.storage.fields` with matching `column`

The structural derivation (`ExtractTableToModel`) is O(models) at the type level, versus the previous O(1) lookup from `mappings.tableToModel`. This is acceptable because model counts are small and the type-level computation only runs at compile time.

## Test Strategy

The test strategy is adequate for the scope:

- **Existing ORM client tests** serve as regression tests — they exercise the runtime code paths that were migrated, and updated test fixtures use the new contract structure.
- **Test fixtures updated** to include `model.storage.fields`, `model.relations`, and `model.fields` with `codecId` — ensuring the runtime resolution helpers actually exercise the new paths.
- **Legacy fallback tests removed** — tests for `resolveLegacyModelRelation()` (the `model`/`foreignKey` format) were correctly removed since that code path no longer exists.
- **Type tests updated** (`generated-contract-types.test-d.ts`) to include `storage.fields` and `relations` on model definitions.

### Gap: No negative test for old-path access

There is no automated verification that consumer source files don't reference `contract.mappings` or `contract.relations` — this is checked manually via grep (task 2.8). This is acceptable for M2 since M3 will remove the old types and the compiler will catch any remaining references.

## Risks

- **Runtime field resolution overhead.** `getFieldToColumnMap()`, `getColumnToFieldMap()`, and `findModelNameForTable()` iterate over model entries on each call. In hot paths (e.g., per-row `mapStorageRowToModelFields`), this could add measurable overhead compared to the previous direct `mappings` lookup. The current call pattern is per-query, not per-row, so this is low risk — but worth noting for future optimization if profiling shows issues.
- **paradedb task (2.7) appears skipped.** The plan includes task 2.7 for migrating paradedb's BM25 index field column resolution. No changes to `packages/3-extensions/paradedb/src/` are in this diff. Since paradedb's source doesn't reference `mappings` today, this may have been a preemptive concern that resolved itself. Should be confirmed.

## Verdict

The system design is sound. The migration follows a consistent pattern, centralizes contract field resolution, and maintains correct package boundaries. The approach of migrating runtime code first (commit 1), then type-level generics (commit 2), then upstream utilities (commit 3), then fixture fixups (commit 4) is a clean decomposition.
