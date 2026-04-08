# SQL ORM Polymorphism Runtime (STI + MTI) — Execution Plan

## Summary

Implement SQL ORM runtime support for polymorphic queries and writes: STI and MTI query compilation, discriminator-aware result mapping, variant-aware writes, and the refactoring from table-first to model-first row mapping. Corresponds to milestones M3 and M4 from the [parent plan](phase-1.75b-polymorphism-plan.md).

**Spec:** [sql-orm-polymorphism-runtime.spec.md](../specs/sql-orm-polymorphism-runtime.spec.md)
**Design:** [ADR 173 — Polymorphism via discriminator and variants](../../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
**Linear:** [TML-2227](https://linear.app/prisma-company/issue/TML-2227)

## Collaborators

| Role         | Person | Context                                                             |
| ------------ | ------ | ------------------------------------------------------------------- |
| Maker        | Will   | Drives execution                                                    |
| Collaborator | Alexey | SQL ORM owner — query compilation and result mapping changes        |

## Key files

| File | What changes |
|------|-------------|
| `sql-orm-client/src/collection-contract.ts` | New `resolvePolymorphismInfo()`, `findModelNameForTable` audit |
| `sql-orm-client/src/query-plan-select.ts` | STI projection, MTI JOIN compilation in `buildSelectAst` |
| `sql-orm-client/src/query-plan-meta.ts` | Add `modelName` to plan metadata |
| `sql-orm-client/src/collection-runtime.ts` | Polymorphism-aware row mapping, model-first refactor |
| `sql-orm-client/src/collection-dispatch.ts` | Thread `modelName` through dispatch, remove `findModelNameForTable` usage |
| `sql-orm-client/src/collection.ts` | Variant-aware `create()`, enforce `.variant()` for polymorphic writes |
| `sql-orm-client/src/types.ts` | `VariantCreateInput`, gated `CreateInput` for polymorphic bases |
| `sql-orm-client/src/query-plan-mutations.ts` | MTI two-INSERT write path |
| `sql-orm-client/src/mutation-executor.ts` | MTI sequential INSERT orchestration |

## Milestones

### Milestone 1: PolymorphismInfo and model-first mapping refactor

Introduce the `PolymorphismInfo` structure that classifies each variant as STI or MTI from storage mappings. Refactor the dispatch/mapping path to be model-first (thread `modelName` through, bypass `findModelNameForTable`).

This is foundational infrastructure that M2–M4 build on. It can be validated independently: existing non-polymorphic tests must continue to pass after the refactor.

**Tasks:**

- [ ] **1.1 Test: `resolvePolymorphismInfo` classifies STI vs MTI** — Write unit tests: given a contract with Bug (same table as Task) and Feature (different table), `resolvePolymorphismInfo(contract, 'Task')` returns info with Bug as STI and Feature as MTI; includes discriminator field/column mapping; includes variant→value map. Non-polymorphic model returns `undefined`.
- [ ] **1.2 Implement: `resolvePolymorphismInfo`** — Add to `collection-contract.ts`. Reads `model.discriminator`, `model.variants`, and each variant's `storage.table`. Compares to base's `storage.table` to classify STI vs MTI. Cached per (contract, modelName) via WeakMap. Returns `PolymorphismInfo` with: `baseTable`, `discriminatorField`, `discriminatorColumn`, `variants` (Map keyed by model name), `variantsByValue` (Map keyed by discriminator value), `mtiVariants` (filtered list).
- [ ] **1.3 Refactor: add `modelName` to query plan meta** — Extend `buildOrmQueryPlan` and `buildOrmPlanMeta` in `query-plan-meta.ts` to accept and include `modelName` in the plan metadata. Update all `compileSelect` / `compileRelationSelect` / `compileInsertReturning` callers to pass `modelName`.
- [ ] **1.4 Refactor: thread `modelName` through dispatch/mapping** — In `dispatchCollectionRows` and `dispatchWithIncludeStrategy`: accept `modelName` as a parameter (or read from plan meta). Pass to `mapStorageRowToModelFields` instead of `tableName`. Update `mapStorageRowToModelFields` to accept `modelName` directly (keep `tableName` for storage lookup, but use `modelName` for column→field mapping). Remove `findModelNameForTable` calls from the polymorphic mapping path.
- [ ] **1.5 Verify: all existing tests pass** — Run the full `sql-orm-client` test suite. No behavior changes for non-polymorphic models — the refactor only changes how `modelName` is threaded, not what mapping it produces.

### Milestone 2: STI query compilation and result mapping

Implement STI reads: variant-specific columns in projection and discriminator-aware result mapping. After this milestone, querying a polymorphic base that has STI variants returns correctly shaped rows with variant-specific fields.

**Tasks:**

- [ ] **2.1 Test: STI projection includes variant columns** — Write unit tests for `buildSelectAst`: given a polymorphic base with STI variants, the SELECT projection includes columns from all STI variants (not just the base model's fields). When `.variant('Bug')` is set, projection still includes all shared-table columns (simpler; mapping strips irrelevant ones).
- [ ] **2.2 Implement: STI projection** — In `query-plan-select.ts`: when building projection for a model that has `PolymorphismInfo`, iterate STI variants and add their storage columns to the projection. Use `resolvePolymorphismInfo` to find which variants share the table. Project all columns from the shared table (equivalent to today's `resolveTableColumns` for the base table — STI variant columns are already physically on that table).
- [ ] **2.3 Test: STI result mapping by discriminator value** — Write unit tests: given a raw row with `type = 'bug'`, the mapper produces `{ id, title, type: 'bug', severity }` (includes Bug's field, excludes Feature's). Given `type = 'feature'`, produces `{ id, title, type: 'feature', priority }` (excludes Bug's). Column→field name mapping uses the resolved variant's `storage.fields`.
- [ ] **2.4 Implement: STI result mapping** — Add a polymorphism-aware mapping function (e.g. `mapPolymorphicRow`) in `collection-runtime.ts`. For each row: read `discriminatorColumn` value → look up variant in `PolymorphismInfo.variantsByValue` → merge base column→field map with variant column→field map → iterate row columns, map to field names, skip columns not in the merged map (strips other variants' NULL columns). Used by `dispatchCollectionRows` when `PolymorphismInfo` is present.
- [ ] **2.5 STI integration test** — Integration test against Postgres: create `tasks` table with all STI columns; seed Bug and Feature rows (Feature as STI for this test, same table); query base → verify discriminated union shape; query `.variant('Bug')` → verify narrowed shape; verify TypeScript narrowing works at runtime.

### Milestone 3: MTI query compilation and result mapping

Implement MTI reads: LEFT JOIN / INNER JOIN for variant tables, cross-table projection, and result mapping for JOINed rows.

**Tasks:**

- [ ] **3.1 Test: MTI base query produces LEFT JOIN** — Write unit tests for `buildSelectAst`: given a polymorphic base with an MTI variant (Feature on `features` table), the base query includes `LEFT JOIN features ON features.id = tasks.id`. The projection includes `features.priority` (non-PK columns from the variant table).
- [ ] **3.2 Test: MTI variant query produces INNER JOIN** — `.variant('Feature')` produces `INNER JOIN features ON features.id = tasks.id` with `WHERE tasks.type = 'feature'`.
- [ ] **3.3 Implement: MTI JOIN compilation** — In `query-plan-select.ts` / `buildSelectAst`: when `PolymorphismInfo` has `mtiVariants`, add JOIN AST nodes. For base queries: LEFT JOIN each MTI variant table on the shared PK column. For variant queries where the variant is MTI: INNER JOIN. Add variant table's non-PK columns to the projection.
- [ ] **3.4 Implement: MTI result mapping** — Extend `mapPolymorphicRow` from M2.4: for MTI rows, the variant's columns come from the JOINed table. The column→field map for the variant model maps variant column names to field names. Since we project non-PK variant columns without aliasing, the column names in the result set are the variant table's column names — the mapper uses the variant's `storage.fields` to map them to field names.
- [ ] **3.5 Test: mixed STI + MTI base query** — Integration test with the canonical ADR 173 schema: Bug (STI) + Feature (MTI). Base query LEFT JOINs `features`. Rows with `type = 'bug'` get Bug shape (from shared table columns). Rows with `type = 'feature'` get Feature shape (from JOINed columns). Both present in the same result set as a discriminated union.
- [ ] **3.6 MTI integration test** — Integration test against Postgres: create `tasks` + `features` tables; seed via raw SQL; query base → LEFT JOIN, discriminated union; query `.variant('Feature')` → INNER JOIN, narrowed type; verify column values from both tables are correct.

### Milestone 4: Variant-aware writes

Implement `create()` through variant collections: STI single-INSERT with auto-injected discriminator, MTI sequential two-INSERT, and type-level enforcement requiring `.variant()` before writes on polymorphic models.

**Tasks:**

- [ ] **4.1 Test: STI variant create auto-injects discriminator** — Write unit tests: `.variant('Bug').create({ title: 'Crash', severity: 'critical' })` compiles to `INSERT INTO tasks (title, type, severity) VALUES ('Crash', 'bug', 'critical')`. The discriminator column + value is injected; the user input does not include it.
- [ ] **4.2 Implement: STI variant write** — In the `create()` / `createAll()` path on `Collection`: when `state.variantName` is set and the variant is STI, look up the discriminator column and value from `PolymorphismInfo`. Inject the discriminator column/value into the mapped storage row before compiling the INSERT. The INSERT targets the shared table (already the case — `this.tableName` is the base table).
- [ ] **4.3 Test: MTI variant create produces two INSERTs** — Write unit tests: `.variant('Feature').create({ title: 'Dark mode', priority: 1 })` produces: (1) INSERT into `tasks` with base fields + discriminator, RETURNING id; (2) INSERT into `features` with variant fields + shared PK. Verify the two statements and their column sets.
- [ ] **4.4 Implement: MTI variant write** — In the mutation path: when `state.variantName` is set and the variant is MTI, split input data into base fields and variant fields (using `PolymorphismInfo` to know which fields belong where). Execute base INSERT with RETURNING → extract PK → execute variant INSERT with PK + variant fields. Use existing `withMutationScope` for connection management (no explicit transaction initially).
- [ ] **4.5 Test: `CreateInput` type enforcement** — Write type tests (`.test-d.ts`): `create()` on a polymorphic base collection (no `.variant()`) is a type error. `.variant('Bug').create(...)` accepts `{ title, severity }` (base + variant fields, minus discriminator). `.variant('Bug').create({ title, severity, type: 'bug' })` — discriminator field is excluded from input type.
- [ ] **4.6 Implement: type-level write gating** — In `types.ts`: define `VariantCreateInput<TContract, ModelName, VariantName>` that includes base + variant required/optional fields, excluding the discriminator field. On `Collection`, gate `create()` / `createAll()` to only be available when `CollectionState` carries a variant name (for polymorphic models). For non-polymorphic models, `create()` remains unchanged.
- [ ] **4.7 Write integration tests** — Integration tests against Postgres: create Bug via `.variant('Bug').create(...)` → query back → verify discriminator value and variant fields. Create Feature via `.variant('Feature').create(...)` → verify two rows (base + variant table) with correct PK linkage. Round-trip: create then query via both base and variant paths.

### Milestone 5: Close-out

Verify all acceptance criteria, update docs, clean up.

**Tasks:**

- [ ] **5.1 Run full test suite** — `pnpm test:packages` passes. No regressions in non-polymorphic paths.
- [ ] **5.2 Update package docs** — Update `sql-orm-client` README/DEVELOPING if polymorphism changes the package's public API or internal architecture.
- [ ] **5.3 Update parent plan** — Mark M3 and M4 as complete in [phase-1.75b-polymorphism-plan.md](phase-1.75b-polymorphism-plan.md).

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| `PolymorphismInfo` classifies STI vs MTI | Unit | 1.1 | |
| `PolymorphismInfo` cached | Unit | 1.1 | |
| Non-polymorphic model: no polymorphism info | Unit | 1.1 | |
| STI: variant columns in SELECT projection | Unit | 2.1 | |
| STI: WHERE on discriminator via `.variant()` | Unit | (already implemented by TML-2205) | Regression |
| STI: result mapping by discriminator value | Unit | 2.3 | |
| STI: strips non-matching variant columns | Unit | 2.3 | |
| MTI: LEFT JOIN on base query | Unit | 3.1 | |
| MTI: non-PK variant columns projected | Unit | 3.1 | |
| MTI: INNER JOIN on variant query | Unit | 3.2 | |
| MTI: result mapping merges base + variant fields | Unit | 3.4 | |
| Mixed STI + MTI in same base query | Integration | 3.5 | |
| STI: create auto-injects discriminator | Unit | 4.1 | |
| MTI: create produces two INSERTs | Unit | 4.3 | |
| MTI: base INSERT RETURNING feeds variant INSERT PK | Unit | 4.3 | |
| `create()` on polymorphic base is type error | Type test | 4.5 | |
| `VariantCreateInput` excludes discriminator | Type test | 4.5 | |
| STI round-trip (create + query) | Integration | 2.5, 4.7 | |
| MTI round-trip (create + query) | Integration | 3.6, 4.7 | |
| `modelName` flows without `findModelNameForTable` | Unit | 1.4, 1.5 | Refactor correctness |
| All existing non-polymorphic tests pass | Regression | 1.5, 5.1 | |

## Open Items

- **`findModelNameForTable` in include/stitch paths**: The include strategies (`dispatchWithSingleQueryIncludes`, `stitchIncludes`, etc.) also use `mapStorageRowToModelFields` with `tableName` for child relations. These paths use `include.relatedModelName` which is already resolved — the refactor should thread that through to mapping. Audit during M1.4.
- **Coordination with Alexey**: Changes touch core query compilation and result mapping. Coordinate timing to avoid conflicts with other SQL ORM work.
- **Transaction hardening for MTI writes**: Deferred. Sequential INSERTs without a transaction mean a failed variant INSERT leaves an orphan base row. Add transaction wrapping as a follow-up.
