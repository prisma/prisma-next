# Walkthrough — Milestone 2: Migrate Consumers to Domain-Level Type Fields

## Sources

- Linear: [TML-2175](https://linear.app/prisma-company/issue/TML-2175/migrate-consumers-to-new-domain-level-type-fields-m2)
- Spec: [projects/contract-domain-extraction/spec.md](../spec.md)
- Commit range: `f133394ea...HEAD`

## Intent

Migrate all ORM client and relational-core consumer code from reading old SQL-specific contract paths (`mappings.*`, top-level `relations`, storage-layer `codecId`) to the new domain-level fields (`model.storage.*`, `model.relations`, `model.fields[f].codecId`) introduced by ADR 172 in Milestone 1. This unblocks Milestone 3 (removing the old fields entirely).

## Key snippet

### Before / After (field-to-column resolution)

```ts
// BEFORE — direct mappings lookup
const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};
```

```ts
// AFTER — centralized helper reading from model.storage.fields
export function getFieldToColumnMap(
  contract: SqlContract<SqlStorage>,
  modelName: string,
): Record<string, string> {
  const storageFields = modelsOf(contract)[modelName]?.storage?.fields ?? {};
  const result: Record<string, string> = {};
  for (const [f, s] of Object.entries(storageFields)) {
    if (s?.column) result[f] = s.column;
  }
  return result;
}
```

## Change map

- **Implementation (sql-orm-client source — 10 files)**:
  - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — new resolution helpers; relation resolution rewritten
  - [packages/3-extensions/sql-orm-client/src/collection-column-mapping.ts](packages/3-extensions/sql-orm-client/src/collection-column-mapping.ts) — delegates to `resolveFieldToColumn`/`getFieldToColumnMap`
  - [packages/3-extensions/sql-orm-client/src/collection-runtime.ts](packages/3-extensions/sql-orm-client/src/collection-runtime.ts) — `findModelNameForTable` + `getColumnToFieldMap`
  - [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — reads `model.relations` and `model.fields[f].codecId` for traits
  - [packages/3-extensions/sql-orm-client/src/mutation-executor.ts](packages/3-extensions/sql-orm-client/src/mutation-executor.ts) — reads `model.relations` for relation definitions
  - [packages/3-extensions/sql-orm-client/src/filters.ts](packages/3-extensions/sql-orm-client/src/filters.ts) — reads `model.fields[f].codecId` for trait gating
  - [packages/3-extensions/sql-orm-client/src/aggregate-builder.ts](packages/3-extensions/sql-orm-client/src/aggregate-builder.ts) — `getFieldToColumnMap`
  - [packages/3-extensions/sql-orm-client/src/collection.ts](packages/3-extensions/sql-orm-client/src/collection.ts) — `getColumnToFieldMap`
  - [packages/3-extensions/sql-orm-client/src/grouped-collection.ts](packages/3-extensions/sql-orm-client/src/grouped-collection.ts) — `getFieldToColumnMap`
  - [packages/3-extensions/sql-orm-client/src/types.ts](packages/3-extensions/sql-orm-client/src/types.ts) — type-level generics migrated
- **Implementation (relational-core — 1 file)**:
  - [packages/2-sql/4-lanes/relational-core/src/types.ts](packages/2-sql/4-lanes/relational-core/src/types.ts) — `ExtractTableToModel`, `ExtractColumnToField`, `ExtractColumnJsTypeFromModels`
- **Tests (evidence)**:
  - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts)
  - [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts)
  - [packages/3-extensions/sql-orm-client/test/filters.test.ts](packages/3-extensions/sql-orm-client/test/filters.test.ts)
  - [packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts](packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts)
  - [packages/3-extensions/sql-orm-client/test/grouped-collection.test.ts](packages/3-extensions/sql-orm-client/test/grouped-collection.test.ts)
  - [packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts](packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts)
  - [packages/3-extensions/sql-orm-client/test/fixtures/generated/contract.json](packages/3-extensions/sql-orm-client/test/fixtures/generated/contract.json)
  - [packages/3-extensions/sql-orm-client/test/fixtures/generated/contract.d.ts](packages/3-extensions/sql-orm-client/test/fixtures/generated/contract.d.ts)
  - [test/e2e/framework/test/fixtures/generated/contract.d.ts](test/e2e/framework/test/fixtures/generated/contract.d.ts)

## The story

1. **Centralize contract field resolution behind helper functions.** `collection-contract.ts` gains five new helpers (`resolveFieldToColumn`, `getFieldToColumnMap`, `getColumnToFieldMap`, `findModelNameForTable`, plus the existing `resolveModelTableName` rewritten). These read from `model.storage.fields` and `model.storage.table` instead of `mappings.*`. This is the foundation all other call sites migrate to.

2. **Migrate ORM client runtime code to domain-level reads.** Every file in `sql-orm-client/src/` that previously accessed `contract.mappings.*` or `contract.relations[tableName]` is updated to use the new helpers or read `model.relations` / `model.fields` directly. Relation metadata uses `{ to, cardinality, on: { localFields, targetFields } }` uniformly — the legacy `{ model, foreignKey }` fallback path is removed.

3. **Migrate ORM client type-level generics.** The conditional types in `types.ts` that extracted table names, column names, relations, and FK fields from `TContract['mappings']` and `TContract['relations']` are rewritten to read from `model.storage`, `model.relations`, and `model.fields`. Several intermediate types are eliminated (`ModelTableFromMappings`, `ContractRelations`, `ChildRelationColumnsForModel`).

4. **Migrate relational-core type utilities.** `ExtractTableToModel` and `ExtractColumnToField` in `relational-core/src/types.ts` are rewritten to structurally search through `contract.models` rather than looking up `contract.mappings.tableToModel` / `contract.mappings.columnToField`. `ExtractColumnJsTypeFromModels` is simplified — it no longer needs the `{ column: string }` marker-object filtering heuristic because model fields now carry concrete JS types directly.

5. **Update test fixtures and e2e contract type.** ORM client test fixtures (`contract.json`, `contract.d.ts`) are updated to include `model.storage.fields`, `model.relations`, and `roots`. The e2e framework `contract.d.ts` gains the same additions. Test assertions are updated for the new relation naming (`localFields`/`targetFields` vs `parentCols`/`childCols`).

## Behavior changes & evidence

- **Field-to-column resolution reads from `model.storage.fields` instead of `mappings.fieldToColumn`**: Before — `contract.mappings.fieldToColumn[model][field]`. After — `modelsOf(contract)[model].storage.fields[field].column`. No externally observable behavior change; consumers get the same column names.
  - **Why**: Required by ADR 172's domain-storage separation. `mappings` will be removed in M3.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 16–34
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts)

- **Model-to-table resolution reads from `model.storage.table` instead of `mappings.modelToTable`**: Before — `contract.mappings.modelToTable[model]`. After — `modelsOf(contract)[model].storage.table`. Falls back to `modelName.toLowerCase()` (previously `modelName` without lowering in one code path).
  - **Why**: Eliminates dependency on `mappings`.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 168–178
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts) — lines 151–180

- **Relation resolution reads from `model.relations` instead of top-level `contract.relations[tableName]`**: Before — `contract.relations[tableName][relationName]` with `{ parentCols, childCols }`. After — `contract.models[modelName].relations[relationName]` with `{ localFields, targetFields }`. The legacy `{ model, foreignKey }` fallback is removed.
  - **Why**: Relations are domain-level concepts that belong on the model, not keyed by table name.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — lines 77–147
    - [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — lines 39–65
    - [packages/3-extensions/sql-orm-client/src/mutation-executor.ts](packages/3-extensions/sql-orm-client/src/mutation-executor.ts) — lines 670–720
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts) — lines 58–100
    - [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts)
    - [packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts](packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts) — lines 391–403

- **Codec trait resolution reads from `model.fields[f].codecId` instead of `storage.tables[t].columns[c].codecId`**: Before — navigated to the storage column to find codecId. After — reads `model.fields[fieldName].codecId` directly. The field's codecId is the same value; the path is shorter.
  - **Why**: Codec identity is a domain-level concept. Consumers shouldn't need to navigate through model→table→column to find it.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — lines 68–81
    - [packages/3-extensions/sql-orm-client/src/filters.ts](packages/3-extensions/sql-orm-client/src/filters.ts) — lines 68–83
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts)
    - [packages/3-extensions/sql-orm-client/test/filters.test.ts](packages/3-extensions/sql-orm-client/test/filters.test.ts)

- **Type-level generics derive from domain-level fields (no behavior change)**: Before — `TContract['mappings']['fieldToColumn']`, `TContract['mappings']['modelToTable']`, `TContract['relations']`. After — `model.storage.fields`, `model.storage.table`, `model.relations`. Compile-time only.
  - **Why**: Types must match the runtime code paths. Once runtime uses domain fields, types must too.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/types.ts](packages/3-extensions/sql-orm-client/src/types.ts) — lines 391–961
    - [packages/2-sql/4-lanes/relational-core/src/types.ts](packages/2-sql/4-lanes/relational-core/src/types.ts) — lines 265–343
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts](packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts)
    - [packages/2-sql/4-lanes/relational-core/test/schema.types.test-d.ts](packages/2-sql/4-lanes/relational-core/test/schema.types.test-d.ts)

## Compatibility / migration / risk

- **No breaking changes for external consumers.** The contract object returned by `validateContract()` still carries both old and new fields (M1 bridge). Only internal consumer code paths changed.
- **Subtle fallback change in `resolveModelTableName`.** The `model-accessor.ts` previously had its own `resolveModelTableName` that fell back to `modelName` (PascalCase). The centralized version falls back to `modelName.toLowerCase()`. Tests confirm the new behavior. This is arguably more correct (tables are lowercase by convention) but is a behavior change.
- **Legacy relation format removed.** The `{ model, foreignKey }` relation fallback is gone. Any code or fixture relying on that format would break. This is intentional — M1 already moved relations to `{ to, cardinality, on }`.

## Follow-ups / open questions

- **Task 2.7 (paradedb).** Not in this diff. Verify whether it's needed and update the plan accordingly.
- **Resolution helper caching.** If profiling shows `getFieldToColumnMap` / `findModelNameForTable` as hot paths, add memoization (NB-F02, NB-F03 in code review).
- **M3 readiness.** After this milestone, no consumer source references `mappings` or top-level `relations`. M3 can proceed to remove these from the type system and `validateContract()` bridge.

## Non-goals / intentionally out of scope

- Removing old fields from `SqlContract` or `validateContract()` (M3 scope)
- Contract IR alignment (M4 scope)
- Emitter generalization (M5 scope)
- paradedb migration (assessed as N/A — no `mappings` references found)
