# Structural ParamRef

## Summary

Replace `ParamRef`'s implicit numeric-index linkage with structural value-carrying so parameter placeholders in the SQL AST carry their values directly. This eliminates silent off-by-one bugs, removes ~150 lines of fragile offset arithmetic and validation code, and decouples the target-agnostic AST from PostgreSQL's 1-based `$N` convention. Success means all existing query lanes produce correct queries with the same observable behavior, and the entire index-arithmetic / offset-rewriting / contiguity-validation code category is deleted.

**Spec:** [projects/structural-paramref/spec.md](spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | William Madden | Drives execution |

## Milestones

### Milestone 1: Core refactoring

Change `ParamRef` to carry values, migrate all producers and the adapter, simplify `BoundWhereExpr`, and delete the offset machinery. This is a single compile-breaking change that cascades across all call sites — they must move together.

Validated by: all existing test suites pass (with assertion updates for the new API surface, not behavior changes).

**Tasks:**

- [ ] **1.1 — Change `ParamRef` class in `relational-core/src/ast/types.ts`**
  Replace `index: number` with `value: unknown`; add optional `codecId` and `nativeType`; remove `withIndex()`; update `ParamRef.of()` signature from `(index, name?)` to `(value, options?)`. Update `ExpressionRewriter.paramRef` return type if needed. Keep `name` as optional metadata.

- [ ] **1.2 — Add `collectParamRefs()` to DML ASTs**
  `InsertAst`, `UpdateAst`, and `DeleteAst` extend `QueryAst` but lack `collectParamRefs()` (only `SelectAst` has it). Add the method to each, walking `rows`/`set`/`where`/`onConflict` to collect `ParamRef` nodes in deterministic order. Consider adding an abstract `collectParamRefs()` on `QueryAst` to enforce this.

- [ ] **1.3 — Update `operations-registry.ts` sentinel**
  The `ParamRef(0, arg.name)` sentinel for operation template args needs to change. Since this ticket non-goals unifying operation param handling, use a value sentinel (e.g., `ParamRef.of(undefined, { name: arg.name })`) that is distinguishable from bound params. Verify vector-op tests still pass.

- [ ] **1.4 — Migrate SQL lane `predicate-builder.ts`**
  Replace `values.push(value); ParamRef.of(index, paramName)` with `ParamRef.of(value, { name: paramName, codecId })`. Remove the `values` accumulator array and `descriptors` accumulator — values are now on the nodes. Update `buildWhereExpr` return type and callers.

- [ ] **1.5 — Migrate SQL lane `mutation-builder.ts`**
  Replace manual index counter (`let index = 1; ... ParamRef.of(index++, column)`) in `InsertBuilderImpl.build()`, `UpdateBuilderImpl.build()`, and `DeleteBuilderImpl.build()` with `ParamRef.of(value, { name, codecId })`. Remove `paramValues` accumulator arrays.

- [ ] **1.6 — Migrate SQL lane `select-builder.ts`**
  Update `build()` to no longer accumulate `paramValues`/`paramDescriptors` arrays. Where clauses, includes, and projections produce value-carrying `ParamRef` nodes in the AST; params and descriptors are derived from the AST at plan-build time.

- [ ] **1.7 — Simplify `BoundWhereExpr` and `where-interop.ts`**
  Remove `params` and `paramDescriptors` fields from `BoundWhereExpr` (or eliminate the type). Update `ToWhereExpr.toWhereExpr()` return type. Delete `assertBoundPayload` (~45 lines). Delete `assertBareWhereExprIsParamFree` and `whereExprContainsParamRef` helpers. Update `normalizeWhereArg` to return bare `WhereExpr`.

- [ ] **1.8 — Delete offset machinery in `where-utils.ts`**
  Remove `offsetWhereExprParams`, `offsetParamDescriptors`, `offsetBoundWhereExpr`. Simplify `combineWhereFilters` to combine `WhereExpr` nodes without index arithmetic (it becomes pure `AndExpr` combination).

- [ ] **1.9 — Migrate ORM `where-binding.ts`**
  Replace `createParamRef` that uses `params.push(value)` → index derivation with direct `ParamRef.of(value, { name, codecId })`. Remove the `params` accumulator state. Update `bindWhereExpr` signature and callers.

- [ ] **1.10 — Migrate ORM `query-plan-mutations.ts`**
  Replace manual 1-based index counter in `toParamAssignments` / `normalizeInsertRows` with `ParamRef.of(value, ...)`. Remove calls to `offsetBoundWhereExpr` for WHERE alignment.

- [ ] **1.11 — Migrate ORM `query-plan-select.ts`**
  Remove include param offset arithmetic (calls to `offsetBoundWhereExpr`, offset variable tracking). Include strategies produce value-carrying `ParamRef` nodes directly.

- [ ] **1.12 — Migrate ORM `query-plan-aggregate.ts`**
  Update `ParamRef` rejection logic in grouped HAVING (currently uses `instanceof ParamRef`; the check remains but the shape changes).

- [ ] **1.13 — Migrate Kysely lane transforms**
  In `transform-expr.ts`: replace `nextParamIndex(ctx); ctx.params.push(value); ParamRef.of(index)` with `ParamRef.of(value, ...)`. In `transform-dml.ts`: same for INSERT/UPDATE value construction. In `transform-context.ts`: remove `nextParamIndex` / param index counter. In `transform-select.ts`: update LIMIT param creation.

- [ ] **1.14 — Migrate Kysely `where-expr.ts`**
  Remove the index-remapping rewrite pass (collects distinct indices, builds dense map, rewrites via `withIndex`). The `buildKyselyWhereExpr` function returns a `WhereExpr` with value-carrying nodes; no index remapping needed.

- [ ] **1.15 — Migrate Kysely `build-plan.ts`**
  Remove `params.length === paramDescriptors.length` validation. Derive both `params` and `paramDescriptors` from `ast.collectParamRefs()` at plan-build time.

- [ ] **1.16 — Update Postgres adapter lowering**
  In `adapter.ts`: replace `$${ref.index}` rendering with adapter-time index assignment. The adapter calls `ast.collectParamRefs()` during lowering to build a `Map<ParamRef, number>` (identity-based, since nodes are frozen singletons). `renderParam` looks up the assigned index. `lowerSelect`/`lowerInsert`/`lowerUpdate`/`lowerDelete` each collect params and return `{ sql, params: collectedValues }`.

- [ ] **1.17 — Update runtime encoding path**
  In `packages/2-sql/5-runtime/src/codecs/encoding.ts`: `encodeParams` currently pairs `plan.params[i]` with `plan.meta.paramDescriptors[i]` by array position. Verify this still works after params and descriptors are derived from AST collection. The contract is unchanged (parallel arrays), but ensure the derivation produces the same ordering.

- [ ] **1.18 — Update all test suites**
  Migrate all test assertions from `ParamRef.of(index, name)` to `ParamRef.of(value, { name })`. Remove assertions on `.index`. Update test helpers in `relational-core/test/ast/test-helpers.ts`. Key test files: `common.test.ts`, `rich-ast.test.ts`, `mutation-builder.test.ts`, `sql-dml.test.ts`, `sql-comparison-operators.test.ts`, `rich-mutation.test.ts`, `sql-dml-vector-ops.test.ts`, `where-utils.test.ts`, `where-binding.test.ts`, `where-interop.test.ts`, `query-plan-select.test.ts`, `query-plan-mutations.test.ts`, `query-plan-aggregate.test.ts`, `rich-query-plans.test.ts`, `collection.state.test.ts`, `adapter.test.ts`, `rich-adapter.test.ts`, `operation-lowering.test.ts`, `where-expr.ast.test.ts`, `build-plan.collect-params.test.ts`, `lints.test.ts`.

### Milestone 2: Hardening and close-out

Add a deterministic-ordering test, update documentation, and clean up the transient project directory.

Validated by: new test passes, docs are current, `projects/structural-paramref/` is deleted.

**Tasks:**

- [ ] **2.1 — Add deterministic param collection order test**
  Write a test in `relational-core` that builds a complex AST (SELECT with joins, subqueries, WHERE, ORDER BY, HAVING) and asserts that `collectParamRefs()` returns params in a stable, documented order. This serves as the specification for the canonical ordering that adapters depend on.

- [ ] **2.2 — Add DML collectParamRefs ordering tests**
  Write tests for `InsertAst.collectParamRefs()`, `UpdateAst.collectParamRefs()`, and `DeleteAst.collectParamRefs()` covering rows, SET, WHERE, ON CONFLICT, and RETURNING clauses.

- [ ] **2.3 — Update package documentation**
  Update `relational-core/README.md` if it documents `ParamRef` API. Update any subsystem docs in `docs/architecture docs/subsystems/` that reference the old index-based model (subsystem 3: Query Lanes is most likely).

- [ ] **2.4 — Verify acceptance criteria**
  Run full test suite (`pnpm test:packages`), verify all acceptance criteria from the spec are met, check no `ParamRef.index` references remain in source code.

- [ ] **2.5 — Close out project**
  Migrate any durable documentation into `docs/`. Delete `projects/structural-paramref/`. Strip any repo-wide references to the project directory.

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| ParamRef carries `value`, `codecId`, `nativeType` | Unit | 1.1, 1.18 | Existing `common.test.ts` updated |
| `ParamRef.index` and `withIndex()` removed | Unit | 1.1, 1.18 | Compilation enforces; `common.test.ts` updated |
| `ParamRef.of` signature migrated | Unit | 1.18 | All test files updated to new signature |
| `BoundWhereExpr` simplified/removed | Unit | 1.7, 1.18 | `where-interop.test.ts`, `where-utils.test.ts` updated |
| `assertBoundPayload` removed | Unit | 1.7, 1.18 | `where-interop.test.ts` — validation tests removed |
| Offset machinery removed | Unit | 1.8, 1.18 | `where-utils.test.ts` — offset tests removed |
| Postgres adapter collects params from AST | Unit | 1.16, 1.18 | `adapter.test.ts`, `rich-adapter.test.ts` |
| Postgres adapter assigns `$1, $2, …` from collection order | Unit | 1.16, 1.18 | `adapter.test.ts` |
| ParamDescriptor derived from ParamRef metadata | Unit | 1.16, 1.17 | `encoding.ts` integration; adapter tests |
| LoweredStatement shape unchanged | Unit | 1.16 | Existing adapter tests verify `{ sql, params }` shape |
| SQL lane predicate builder — no index counter | Unit | 1.4, 1.18 | `predicate-builder.test.ts`, `sql-comparison-operators.test.ts` |
| SQL lane mutation builder — no index counter | Unit | 1.5, 1.18 | `mutation-builder.test.ts`, `rich-mutation.test.ts` |
| ORM where-binding — no push-derived index | Unit | 1.9, 1.18 | `where-binding.test.ts` |
| ORM includes — no offset arithmetic | Unit | 1.11, 1.18 | `query-plan-select.test.ts`, `rich-query-plans.test.ts` |
| ORM mutations — no manual counter | Unit | 1.10, 1.18 | `query-plan-mutations.test.ts` |
| Kysely transform — no nextParamIndex | Unit | 1.13, 1.18 | `build-plan.collect-params.test.ts`, `where-expr.ast.test.ts` |
| Deterministic collection order (complex AST) | Unit | 2.1 | New test |
| DML collectParamRefs ordering | Unit | 2.2 | New test |
| All existing tests pass | Suite | 1.18, 2.4 | `pnpm test:packages` |

## Open Items

- **`OperationExpr` param unification** (from spec OQ 1): Operation args that are `ParamRef` use a sentinel value (`index: 0` today, `value: undefined` after this change). A follow-up ticket should consider unifying operation param binding with the structural approach.

- **`BoundWhereExpr` elimination vs wrapper** (from spec OQ 2): Default assumption is to eliminate. If elimination causes excessive churn at the `ToWhereExpr` boundary, a thin `{ expr: WhereExpr }` wrapper can be kept. Decision finalizes during task 1.7.

- **Coordination with TML-2096** (instanceof elimination): If TML-2096 lands first or concurrently, the `ParamRef` class shape change here should adopt the structural brand pattern. If this lands first, TML-2096 can add brands to the already-modified `ParamRef`.
