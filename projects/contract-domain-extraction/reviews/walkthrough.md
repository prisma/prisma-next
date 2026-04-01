closes [TML-2175](https://linear.app/prisma-company/issue/TML-2175/migrate-consumers-to-new-domain-level-type-fields-m2)

## Before / After (intention in code)

```ts
// BEFORE — consumer reads SQL-specific mappings and top-level relations
const column = contract.mappings.fieldToColumn[modelName][fieldName];
const table = contract.mappings.modelToTable[modelName];
const rel = contract.relations[tableName][relationName];
const codecId = storage.tables[table].columns[col].codecId;
```

```ts
// AFTER — consumer reads domain-level fields on the model
const column = resolveFieldToColumn(contract, modelName, fieldName);
const table = resolveModelTableName(contract, modelName);
const rel = resolveIncludeRelation(contract, modelName, relationName);
const codecId = contract.models[modelName].fields[fieldName].codecId;
// ↑ backed by model.storage.fields, model.storage.table, model.relations
```

## Intent

Migrate all ORM client and relational-core consumer code from reading old SQL-specific contract paths (`mappings.*`, top-level `relations`, storage-layer `codecId`) to the new domain-level fields (`model.storage.*`, `model.relations`, `model.fields[f].codecId`) introduced by ADR 172 in Milestone 1. This unblocks Milestone 3 (removing the old fields entirely from `SqlContract` and `validateContract()`).

## Change map

- **Centralized resolution helpers** (new internal API):
  - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — `resolveFieldToColumn`, `getFieldToColumnMap`, `getColumnToFieldMap`, `findModelNameForTable`, `resolveModelTableName`, `resolveIncludeRelation` with WeakMap memoization
- **ORM client runtime migration** (10 source files):
  - [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — reads `model.relations` and `model.fields[f].codecId`
  - [packages/3-extensions/sql-orm-client/src/filters.ts](packages/3-extensions/sql-orm-client/src/filters.ts) — reads `model.fields[f].codecId` for trait gating
  - [packages/3-extensions/sql-orm-client/src/mutation-executor.ts](packages/3-extensions/sql-orm-client/src/mutation-executor.ts) — reads `model.relations`
  - [packages/3-extensions/sql-orm-client/src/collection-column-mapping.ts](packages/3-extensions/sql-orm-client/src/collection-column-mapping.ts), [collection-runtime.ts](packages/3-extensions/sql-orm-client/src/collection-runtime.ts), [collection.ts](packages/3-extensions/sql-orm-client/src/collection.ts), [collection-dispatch.ts](packages/3-extensions/sql-orm-client/src/collection-dispatch.ts), [query-plan-select.ts](packages/3-extensions/sql-orm-client/src/query-plan-select.ts), [aggregate-builder.ts](packages/3-extensions/sql-orm-client/src/aggregate-builder.ts), [grouped-collection.ts](packages/3-extensions/sql-orm-client/src/grouped-collection.ts)
- **Type-level generics migration**:
  - [packages/3-extensions/sql-orm-client/src/types.ts](packages/3-extensions/sql-orm-client/src/types.ts) — `ModelTableName`, `FieldColumnName`, `RelationsOf`, `ChildForeignKeyFieldNames` derive from domain-level fields
  - [packages/2-sql/4-lanes/relational-core/src/types.ts](packages/2-sql/4-lanes/relational-core/src/types.ts) — `ExtractTableToModel`, `ExtractColumnToField`, `ExtractColumnJsTypeFromModels`
- **Tests (evidence)**:
  - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts)
  - [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts)
  - [packages/3-extensions/sql-orm-client/test/filters.test.ts](packages/3-extensions/sql-orm-client/test/filters.test.ts)
  - [packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts](packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts)
  - [packages/3-extensions/sql-orm-client/test/collection-column-mapping.test.ts](packages/3-extensions/sql-orm-client/test/collection-column-mapping.test.ts)
  - [packages/3-extensions/sql-orm-client/test/collection.state.test.ts](packages/3-extensions/sql-orm-client/test/collection.state.test.ts)
  - [packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts](packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts)
  - [packages/2-sql/4-lanes/relational-core/test/schema.types.test-d.ts](packages/2-sql/4-lanes/relational-core/test/schema.types.test-d.ts)

## The story

1. **Centralize contract field resolution behind helper functions.** `collection-contract.ts` gains resolution helpers (`resolveFieldToColumn`, `getFieldToColumnMap`, `getColumnToFieldMap`, `findModelNameForTable`, `resolveModelTableName`) that read from `model.storage.fields` and `model.storage.table` instead of `mappings.*`. All helpers use WeakMap-backed memoization keyed by contract + model/table name. `resolveModelTableName` throws if `storage.table` is missing — a validated contract must always provide it.

2. **Migrate ORM client runtime code to domain-level reads.** Every file in `sql-orm-client/src/` that previously accessed `contract.mappings.*` or `contract.relations[tableName]` is updated to use the new helpers or read `model.relations` / `model.fields` directly. Relation metadata uses `{ to, cardinality, on: { localFields, targetFields } }` uniformly — the legacy `{ model, foreignKey }` fallback path is removed. Include-relation naming is aligned with ADR 172 vocabulary: `localColumn`/`targetColumn` replaces the old `fkColumn`/`parentPkColumn`. The `mapFieldToColumn` delegation wrapper is removed; callers use `resolveFieldToColumn` directly.

3. **Migrate type-level generics.** Conditional types in `types.ts` that extracted table names, column names, relations, and FK fields from `TContract['mappings']` and `TContract['relations']` are rewritten to derive from `model.storage`, `model.relations`, and `model.fields`. Several intermediate types are eliminated (`ModelTableFromMappings`, `ContractRelations`, `ChildRelationColumnsForModel`).

4. **Migrate relational-core type utilities.** `ExtractTableToModel` and `ExtractColumnToField` in `relational-core/src/types.ts` are rewritten to structurally search `contract.models` rather than looking up `contract.mappings.tableToModel` / `contract.mappings.columnToField`. `ExtractColumnJsTypeFromModels` is simplified — it no longer needs the `{ column: string }` marker-object filtering heuristic because model fields now carry concrete JS types directly.

5. **Update test fixtures.** ORM client test fixtures (`contract.json`, `contract.d.ts`) and e2e framework `contract.d.ts` are updated to include `model.storage.fields`, `model.relations`, and `roots`. Test assertions are updated for the new relation naming and strict `resolveModelTableName` behavior.

## Behavior changes & evidence

- **Field-to-column resolution reads from `model.storage.fields` instead of `mappings.fieldToColumn`**: Before — `contract.mappings.fieldToColumn[model][field]`. After — `modelsOf(contract)[model].storage.fields[field].column`, with memoized map lookups. No externally observable behavior change; consumers get the same column names.
  - **Why**: Required by ADR 172. `mappings` will be removed in M3.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 16–47
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts)
    - [packages/3-extensions/sql-orm-client/test/collection-column-mapping.test.ts](packages/3-extensions/sql-orm-client/test/collection-column-mapping.test.ts)

- **`resolveModelTableName` throws on missing `storage.table`**: Before — fell back to `modelName.toLowerCase()`. After — throws `Model "X" is missing storage.table in the contract`. A validated contract always provides `storage.table`.
  - **Why**: Strict enforcement — silent string fallbacks mask contract validation errors.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 199–209
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts)

- **Relation resolution reads from `model.relations` instead of top-level `contract.relations`**: Before — `contract.relations[tableName][relationName]` with `{ parentCols, childCols }`. After — `contract.models[modelName].relations[relationName]` with `{ localFields, targetFields }`. The legacy `{ model, foreignKey }` fallback is removed.
  - **Why**: Relations are domain-level concepts that belong on the model, not keyed by table name.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 100–131
    - [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts)
    - [packages/3-extensions/sql-orm-client/src/mutation-executor.ts](packages/3-extensions/sql-orm-client/src/mutation-executor.ts) — lines 670–720
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts)
    - [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts)
    - [packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts](packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts)

- **Include-relation naming aligned with ADR 172**: Before — `fkColumn`/`parentPkColumn`. After — `targetColumn`/`localColumn` throughout `IncludeExpr`, `ResolvedIncludeRelation`, and all consumers, matching the `localFields`/`targetFields` vocabulary.
  - **Why**: Consistent naming with the contract's relation model.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/types.ts](packages/3-extensions/sql-orm-client/src/types.ts) — lines 61–71
    - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 100–131
    - [packages/3-extensions/sql-orm-client/src/collection-dispatch.ts](packages/3-extensions/sql-orm-client/src/collection-dispatch.ts)
    - [packages/3-extensions/sql-orm-client/src/query-plan-select.ts](packages/3-extensions/sql-orm-client/src/query-plan-select.ts) — lines 240–241, 400–410
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts)
    - [packages/3-extensions/sql-orm-client/test/collection.state.test.ts](packages/3-extensions/sql-orm-client/test/collection.state.test.ts)

- **Codec trait resolution reads from `model.fields[f].codecId`**: Before — navigated to storage column. After — reads `model.fields[fieldName].codecId` directly.
  - **Why**: Codec identity is a domain-level concept.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — lines 68–81
    - [packages/3-extensions/sql-orm-client/src/filters.ts](packages/3-extensions/sql-orm-client/src/filters.ts) — lines 68–83
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts)
    - [packages/3-extensions/sql-orm-client/test/filters.test.ts](packages/3-extensions/sql-orm-client/test/filters.test.ts)

- **Type-level generics derive from domain-level fields (no runtime behavior change)**: Compile-time only — `TContract['mappings']` and `TContract['relations']` replaced with `model.storage`, `model.relations`, `model.fields`.
  - **Why**: Types must match runtime code paths.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/types.ts](packages/3-extensions/sql-orm-client/src/types.ts) — lines 391–961
    - [packages/2-sql/4-lanes/relational-core/src/types.ts](packages/2-sql/4-lanes/relational-core/src/types.ts) — lines 265–343
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts](packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts)
    - [packages/2-sql/4-lanes/relational-core/test/schema.types.test-d.ts](packages/2-sql/4-lanes/relational-core/test/schema.types.test-d.ts)

## Compatibility / migration / risk

- **No breaking changes for external consumers.** The contract object returned by `validateContract()` still carries both old and new fields (M1 bridge). Only internal consumer code paths changed.
- **Legacy relation format removed.** The `{ model, foreignKey }` relation fallback is gone. Any code relying on that format would break. This is intentional — M1 already moved relations to `{ to, cardinality, on }`.
- **`resolveModelTableName` is strict.** It throws on missing `storage.table`. A validated contract always provides it.
- **`as Record<string, ...>` casts on `contract.models`.** Several ORM-client files cast `contract.models` to local shape types. Tracked for removal in M3 (plan task 3.6.1) once `ContractBase.models` is concretely typed.

## Follow-ups / open questions

- **M3: Remove old type fields.** No consumer source references `mappings` or top-level `relations`. M3 can proceed to remove them from `SqlContract` and `validateContract()`.
- **M3 task 3.6.1: Remove `as Record<string, ...>` casts.** Once `ContractBase.models` is concretely typed (3.6), the casts become unnecessary.

## Non-goals / intentionally out of scope

- Removing old fields from `SqlContract` or `validateContract()` (M3 scope)
- Contract IR alignment (M4 scope)
- Emitter generalization (M5 scope)
