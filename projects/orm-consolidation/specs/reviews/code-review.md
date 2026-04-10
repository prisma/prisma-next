# Code Review — SQL ORM Polymorphism Runtime (STI + MTI)

**Branch:** `tml-2227-sql-orm-polymorphism-runtime-sti-mti`
**Base:** `origin/main`
**Spec:** [sql-orm-polymorphism-runtime.spec.md](../sql-orm-polymorphism-runtime.spec.md)
**Linear:** [TML-2227](https://linear.app/prisma-company/issue/TML-2227)
**Diff range:** `origin/main...HEAD` (17 commits, 20 files, +1818 / −444)

## Summary

The implementation delivers the full STI + MTI read and write runtime for the SQL ORM as specified. All previously raised findings (F01–F08) have been addressed. One minor cleanup item remains: dead `tableName` in mutation dispatch interfaces (F09). All 395 tests pass, including 14 type tests.

## What looks solid

- **`resolvePolymorphismInfo`** derives strategy from storage comparison, caches via WeakMap, and cleanly separates by-name and by-value lookups.
- **Model-first refactor is complete.** `findModelNameForTable` is removed. `mapStorageRowToModelFields`, `stripHiddenMappedFields`, `createRowEnvelope` require `modelName`. No fallback paths.
- **`mapPolymorphicRow`** handles unknown discriminator values gracefully (base-only fallback). Merged column→field maps are cached and correctly use table-qualified keys (`${table}__${col}`) for MTI variant columns.
- **MTI column aliasing.** `buildMtiJoins` projects variant columns with `${variant.table}__${col}` aliases. `getMergedColumnToFieldMap` builds the merged map with matching prefixed keys for MTI variants. `#executeMtiCreate` prefixes the variant row before passing to `mapPolymorphicRow`. This prevents column name collisions across MTI variant tables.
- **Type-level write gating** via `ResolvedCreateInput` — `never` for polymorphic bases without a variant, `VariantCreateInput` with a variant.
- **MTI create** correctly orchestrates two INSERTs with PK propagation and calls `applyCreateDefaults` for both base and variant tables.
- **MTI mutation guards** via `#assertNotMtiVariant` for `createCount` and `upsert`.
- **Shared test helpers.** `buildMixedPolyContract()` and `buildStiPolyContract()` extracted to `test/helpers.ts`, eliminating duplication across four test files.
- **Test coverage** is thorough: 395 tests pass including strategy resolution (7), polymorphic mapping (5), MTI JOIN compilation (5), pipeline tests, write tests, mutation guard tests (2), and type tests (14).

## Findings

### F09 — Dead `tableName` in mutation dispatch interfaces

**Location:** [packages/3-extensions/sql-orm-client/src/collection-mutation-dispatch.ts (L20)](packages/3-extensions/sql-orm-client/src/collection-mutation-dispatch.ts) and [L75](packages/3-extensions/sql-orm-client/src/collection-mutation-dispatch.ts)

**Issue:** `DispatchMutationRowsOptions` and `ExecuteSingleMutationOptions` still declare `readonly tableName: string`, but `tableName` is no longer destructured or used in either function after the model-first refactor. Callers still pass it.

**Suggestion:** Remove `tableName` from both interfaces and from all call sites.

## PR review comments (@aqrln)

### R01 — Missing Postgres integration tests

**Comment:** [aqrln on plan L112](https://github.com/prisma/prisma-next/pull/321#discussion_r3056923234): "Where are those integration tests? It seems that there are only unit tests in the PR."

**Triage:** Accept. The plan calls for integration tests (tasks 2.5, 3.6, 4.7). Add integration tests in this PR.

### R02 — MTI writes need transaction wrapping via `withMutationScope`

**Comment:** [aqrln on plan L127](https://github.com/prisma/prisma-next/pull/321#discussion_r3056930622): "Why defer it? We already use transactions for nested inserts, it should be easy to wrap MTI writes with `withMutationScope` too."

**Triage:** Accept. `withMutationScope` already exists in `mutation-executor.ts` (L129) and handles `runtime.transaction()` → commit/rollback. Wrap the two-INSERT MTI create in `withMutationScope`.

### R03 — MTI JOIN tests: assert on full AST shape

**Comment:** [aqrln on query-plan-select.test.ts L387](https://github.com/prisma/prisma-next/pull/321#discussion_r3056970455): "I'd prefer asserting on the whole AST using `expect(plan.ast).toEqual(SelectAst.from(...).withJoins(...))`. That's generally easier to read and understand when the AST is small even in the tests like those above, but the tests that check the absence of a property (like this one and the one below) are especially brittle."

**Triage:** Accept. Rewrite the MTI JOIN tests to assert on the full AST shape instead of checking individual properties.

## Deferred (out of scope)

### D01 — No transaction wrapping for MTI writes

Promoted to R02 (addressing in this PR).

### D04 — Promoted to F05 (addressed in `17765bc38`)

## Already addressed

| Finding | Description | Commit |
|---|---|---|
| F01 | `createCount` skips the MTI two-INSERT path | `13b264f33` |
| F02 | Redundant variable alias in `mapPolymorphicRow` | `1fb288bad` |
| F03 | `upsert` not guarded for MTI variants | `13b264f33` |
| F04 | `compileSelectWithIncludeStrategy` does not add MTI JOINs | `464d50c95` |
| F05 | `findModelNameForTable` retained as fallback instead of removed | `17765bc38` |
| F06 | Duplicated `buildPolyContract()` test helpers | `00c1a5330` |
| F07 | MTI projection does not alias variant columns | `28001b18c` |
| F08 | `applyCreateDefaults` not called for variant table in MTI create | `c73c769d5` |

## Acceptance-criteria traceability

| Acceptance Criterion | Implementation | Evidence |
|---|---|---|
| `PolymorphismInfo` classifies Bug as STI, Feature as MTI | [collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — `resolvePolymorphismInfo` | [collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts) — 7 tests |
| `PolymorphismInfo` cached per (contract, modelName) | [collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — WeakMap cache | [collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts) — "caches results" test |
| Non-polymorphic models: no PolymorphismInfo | [collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — early return | [collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts) — "returns undefined" test |
| STI base query includes variant columns in SELECT | Implicit — `resolveTableColumns` returns all physical columns | [collection-variant.test.ts](packages/3-extensions/sql-orm-client/test/collection-variant.test.ts) — "base query maps mixed-variant rows" |
| `.variant('Bug').all()` adds WHERE on discriminator | Pre-existing from TML-2205 | [collection-variant.test.ts](packages/3-extensions/sql-orm-client/test/collection-variant.test.ts) — existing variant WHERE tests |
| Result mapping inspects discriminator value | [collection-runtime.ts](packages/3-extensions/sql-orm-client/src/collection-runtime.ts) — `mapPolymorphicRow` | [collection-runtime.test.ts](packages/3-extensions/sql-orm-client/test/collection-runtime.test.ts) — 5 tests |
| Variant-specific columns stripped from non-matching variants | [collection-runtime.ts](packages/3-extensions/sql-orm-client/src/collection-runtime.ts) — merged map filtering | [collection-runtime.test.ts](packages/3-extensions/sql-orm-client/test/collection-runtime.test.ts) — "strips non-matching variant columns" |
| Base query LEFT JOINs MTI variant tables | [query-plan-select.ts](packages/3-extensions/sql-orm-client/src/query-plan-select.ts) — `buildMtiJoins` | [query-plan-select.test.ts](packages/3-extensions/sql-orm-client/test/query-plan-select.test.ts) — "base query LEFT JOINs" |
| MTI variant query uses INNER JOIN | [query-plan-select.ts](packages/3-extensions/sql-orm-client/src/query-plan-select.ts) — `buildMtiJoins` | [query-plan-select.test.ts](packages/3-extensions/sql-orm-client/test/query-plan-select.test.ts) — "variant query INNER JOINs" |
| MTI columns projected with table-qualified aliases | [query-plan-select.ts](packages/3-extensions/sql-orm-client/src/query-plan-select.ts) — `${variant.table}__${col}` | [query-plan-select.test.ts](packages/3-extensions/sql-orm-client/test/query-plan-select.test.ts) — expects `features__priority` |
| `modelName` flows without `findModelNameForTable` | `findModelNameForTable` removed. `modelName` required in all mapping functions. | [collection-runtime.test.ts](packages/3-extensions/sql-orm-client/test/collection-runtime.test.ts) — pass `modelName` directly |
| STI create auto-injects discriminator | [collection.ts](packages/3-extensions/sql-orm-client/src/collection.ts) — `#mapCreateRows` | [collection-variant.test.ts](packages/3-extensions/sql-orm-client/test/collection-variant.test.ts) — "injects discriminator" |
| MTI create produces two INSERTs | [collection.ts](packages/3-extensions/sql-orm-client/src/collection.ts) — `#executeMtiCreate` | [collection-variant.test.ts](packages/3-extensions/sql-orm-client/test/collection-variant.test.ts) — "executes two INSERTs" |
| MTI create applies defaults to both tables | [collection.ts](packages/3-extensions/sql-orm-client/src/collection.ts) — two `applyCreateDefaults` calls | [collection-variant.test.ts](packages/3-extensions/sql-orm-client/test/collection-variant.test.ts) — MTI create tests |
| Base INSERT RETURNING feeds variant INSERT PK | [collection.ts](packages/3-extensions/sql-orm-client/src/collection.ts) — PK propagation | [collection-variant.test.ts](packages/3-extensions/sql-orm-client/test/collection-variant.test.ts) — PK verification |
| `create()` on polymorphic base is type error | [types.ts](packages/3-extensions/sql-orm-client/src/types.ts) — `ResolvedCreateInput` → `never` | [polymorphism.test-d.ts](packages/3-extensions/sql-orm-client/test/polymorphism.test-d.ts) — "is never" test |
| `.variant()` narrows CreateInput, excluding discriminator | [types.ts](packages/3-extensions/sql-orm-client/src/types.ts) — `VariantCreateInput` | [polymorphism.test-d.ts](packages/3-extensions/sql-orm-client/test/polymorphism.test-d.ts) — "includes base + variant fields minus discriminator" |
| `createCount` and `upsert` guarded for MTI | [collection.ts](packages/3-extensions/sql-orm-client/src/collection.ts) — `#assertNotMtiVariant` | [collection-variant.test.ts](packages/3-extensions/sql-orm-client/test/collection-variant.test.ts) — 2 guard tests |
| Shared test helpers (no duplication) | [test/helpers.ts](packages/3-extensions/sql-orm-client/test/helpers.ts) — `buildMixedPolyContract`, `buildStiPolyContract` | 4 test files import from shared helpers |
| All existing non-polymorphic tests pass | Regression | 395 tests pass |
| Integration tests against Postgres | **Not present** | Plan tasks 2.5, 3.6, 4.7 — not yet implemented |
