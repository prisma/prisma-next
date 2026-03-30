# Walkthrough — Structural ParamRef (TML-2103)

## Key snippet — Before / After

### Before
```typescript
// ParamRef held a numeric index into a parallel params[] array
const ref = ParamRef.of(1, 'userId');  // index=1, name='userId'
// The value lived in a separate array: params[0] = 42
// Combining queries required offset arithmetic:
const shifted = ref.withIndex(ref.index + offset);
```

### After
```typescript
// ParamRef carries its value and codec metadata directly
// codecId is required — every param must be serializable
const ref = ParamRef.of(42, { name: 'userId', codecId: 'pg/int4@1' });
// ref.value === 42, ref.codecId === 'pg/int4@1'
// No offset arithmetic needed — values travel with the AST nodes
```

## Sources
- Linear: [TML-2103](https://linear.app/prisma-company/issue/TML-2103/restructure-paramref-to-use-structural-linkage-instead-of-implicit-1)
- Spec: [projects/structural-paramref/spec.md](../spec.md)
- Commit range: `origin/main...HEAD` (8 commits)

## Intent

Make each SQL AST parameter placeholder carry its bound value and codec metadata directly, so there is no implicit numeric index linking a `ParamRef` to a parallel `params[]` array. This eliminates a category of silent off-by-one bugs, removes ~150 lines of fragile offset arithmetic, and decouples the target-agnostic AST from PostgreSQL's 1-based `$N` convention.

## Change map

- **Implementation**:
  - [packages/2-sql/4-lanes/relational-core/src/ast/types.ts (L345–L377)](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — `ParamRef` class
  - [packages/2-sql/4-lanes/relational-core/src/ast/types.ts (L207–L209)](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — `QueryAst.collectParamRefs()` abstract
  - [packages/3-targets/6-adapters/postgres/src/core/adapter.ts (L123–L151)](packages/3-targets/6-adapters/postgres/src/core/adapter.ts) — adapter lowering
  - [packages/3-extensions/sql-orm-client/src/where-utils.ts](packages/3-extensions/sql-orm-client/src/where-utils.ts) — offset machinery deletion
  - [packages/3-extensions/sql-orm-client/src/where-interop.ts](packages/3-extensions/sql-orm-client/src/where-interop.ts) — validation deletion
  - [packages/3-extensions/sql-orm-client/src/where-binding.ts](packages/3-extensions/sql-orm-client/src/where-binding.ts) — stateless binding
  - [packages/2-sql/4-lanes/sql-lane/src/sql/mutation-builder.ts](packages/2-sql/4-lanes/sql-lane/src/sql/mutation-builder.ts) — SQL lane builders
  - [packages/2-sql/4-lanes/sql-lane/src/sql/predicate-builder.ts](packages/2-sql/4-lanes/sql-lane/src/sql/predicate-builder.ts) — predicate builder
  - [packages/2-sql/4-lanes/kysely-lane/src/transform/transform-expr.ts](packages/2-sql/4-lanes/kysely-lane/src/transform/transform-expr.ts) — Kysely transforms
  - [packages/2-sql/4-lanes/kysely-lane/src/where-expr.ts](packages/2-sql/4-lanes/kysely-lane/src/where-expr.ts) — index remap deletion
- **Tests (evidence)**:
  - [packages/2-sql/4-lanes/relational-core/test/ast/common.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/common.test.ts)
  - [packages/2-sql/4-lanes/relational-core/test/ast/insert.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/insert.test.ts)
  - [packages/2-sql/4-lanes/relational-core/test/ast/update.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/update.test.ts)
  - [packages/2-sql/4-lanes/relational-core/test/ast/delete.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/delete.test.ts)
  - [packages/2-sql/4-lanes/relational-core/test/ast/select.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/select.test.ts)
  - [packages/3-targets/6-adapters/postgres/test/adapter.test.ts](packages/3-targets/6-adapters/postgres/test/adapter.test.ts)
  - [packages/3-extensions/sql-orm-client/test/where-binding.test.ts](packages/3-extensions/sql-orm-client/test/where-binding.test.ts)
  - [packages/3-extensions/sql-orm-client/test/where-interop.test.ts](packages/3-extensions/sql-orm-client/test/where-interop.test.ts)

## The story

1. **Make `ParamRef` value-carrying**: Replace `index: number` with `value: unknown` and add `codecId` metadata. Remove `withIndex()`. This is the foundational data model change — every other change cascades from it.

2. **Add `collectParamRefs()` to all AST types**: Make it abstract on `QueryAst` (forcing implementation on `SelectAst`, `InsertAst`, `UpdateAst`, `DeleteAst`). `SelectAst` already had this method; the DML types gain it. This establishes a deterministic param-collection contract that the adapter depends on.

3. **Migrate all producers to embed values directly**: SQL lane builders, ORM where-binding, Kysely transforms — all stop maintaining parallel `values[]` / `paramDescriptors[]` accumulators and instead create `ParamRef.of(value, { name, codecId })`. The `BindState` mutable pattern in `where-binding.ts` is eliminated.

4. **Derive plan params from the AST**: Instead of accumulating params during construction, call `ast.collectParamRefs()` after the AST is fully built to derive `params` and `paramDescriptors` arrays. This centralizes the source of truth.

5. **Delete the offset machinery**: `offsetWhereExprParams`, `offsetBoundWhereExpr`, `combineWhereFilters` offset logic, `assertBoundPayload` validation, the Kysely where-expr index remapping pass — all existed solely to maintain the implicit index invariant. With values on the nodes, these are unnecessary.

6. **Assign target-specific indices at adapter lowering time**: The Postgres adapter calls `ast.collectParamRefs()` once to build an identity-based `Map<ParamRef, number>`, then passes this map through all render functions. `renderParamRef` looks up the assigned index and uses `ref.codecId` for typed casts.

7. **Eliminate `BoundWhereExpr`**: The wrapper was `{ expr, params, paramDescriptors }` pre-refactoring, reduced to `{ expr }` in step 5, and now eliminated entirely. `ToWhereExpr.toWhereExpr()` returns `WhereExpr` directly. All `createBoundWhereExpr`, `isBoundWhereExpr`, `ensureBoundWhereExpr` helpers are deleted.

8. **Make `codecId` required on `ParamRef`**: With `nativeType` removed and the `OperationExpr` sentinel fixed (see step 9), every `ParamRef` has a legitimate `codecId`. Making it required provides compile-time safety and removes conditional spreading patterns from every `deriveParamsFromAst` site.

9. **Fix `OperationExpr` param handling**: The `createOperationExprBuilder` sentinel (`ParamRef.of(undefined, { name })`) was already broken — `value: undefined`, no `codecId`, yet collected by `collectParamRefs()`. Changed to accept raw values and derive `codecId` from `columnMeta.codecId`.

10. **Remove `annotations.codecs` lookup from encoding**: The `resolveParamCodec` function incorrectly used projection-alias-to-codec mappings (`annotations.codecs`) for parameter encoding. With `codecId` now reliably set on every `ParamDescriptor`, this coincidence-based lookup is redundant and removed.

## Behavior changes & evidence

- **`ParamRef` data model**: Before — `ParamRef(index: number, name?: string)` with `withIndex()`. After — `ParamRef(value: unknown, { name?: string, codecId: string })` with no index or `withIndex()`. `codecId` is required; `nativeType` is removed (dead weight — never consumed by any runtime path).
  - **Why**: Makes invalid states (mismatched index/value, missing codec) unrepresentable. Decouples from PostgreSQL's 1-based convention.
  - **Implementation**:
    - [packages/2-sql/4-lanes/relational-core/src/ast/types.ts (L345–L377)](packages/2-sql/4-lanes/relational-core/src/ast/types.ts)
  - **Tests**:
    - [packages/2-sql/4-lanes/relational-core/test/ast/common.test.ts (L26–L45)](packages/2-sql/4-lanes/relational-core/test/ast/common.test.ts)

- **Adapter-time index assignment**: Before — `ParamRef.index` was pre-assigned; adapter rendered `$${ref.index}` directly. After — adapter builds a `ParamIndexMap` via `collectParamRefs()` and assigns indices during rendering.
  - **Why**: Centralizes index assignment at the point where it's target-specific. Opens the door for non-Postgres adapters with different placeholder conventions.
  - **Implementation**:
    - [packages/3-targets/6-adapters/postgres/src/core/adapter.ts (L123–L151)](packages/3-targets/6-adapters/postgres/src/core/adapter.ts)
  - **Tests**:
    - [packages/3-targets/6-adapters/postgres/test/adapter.test.ts](packages/3-targets/6-adapters/postgres/test/adapter.test.ts)
    - [packages/3-targets/6-adapters/postgres/test/rich-adapter.test.ts](packages/3-targets/6-adapters/postgres/test/rich-adapter.test.ts)

- **`BoundWhereExpr` eliminated**: Before — `{ expr, params, paramDescriptors }`. Intermediate — `{ expr }`. After — eliminated entirely; consumers accept `WhereExpr` directly. `ToWhereExpr.toWhereExpr()` returns `WhereExpr`. All `createBoundWhereExpr` / `isBoundWhereExpr` / `ensureBoundWhereExpr` helpers deleted.
  - **Why**: The wrapper existed to carry parallel param arrays. With values on the AST nodes, those arrays are gone, making the wrapper a no-op indirection.
  - **Implementation**:
    - [packages/2-sql/4-lanes/relational-core/src/ast/types.ts](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — `BoundWhereExpr` interface deleted, `ToWhereExpr` returns `WhereExpr`
    - [packages/3-extensions/sql-orm-client/src/where-utils.ts](packages/3-extensions/sql-orm-client/src/where-utils.ts) — `createBoundWhereExpr`, `isBoundWhereExpr`, `ensureBoundWhereExpr`, `combineWhereFilters` deleted
    - [packages/3-extensions/sql-orm-client/src/where-interop.ts](packages/3-extensions/sql-orm-client/src/where-interop.ts) — updated to return `WhereExpr`
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/where-binding.test.ts](packages/3-extensions/sql-orm-client/test/where-binding.test.ts)
    - [packages/3-extensions/sql-orm-client/test/where-utils.test.ts](packages/3-extensions/sql-orm-client/test/where-utils.test.ts)
    - [packages/3-extensions/sql-orm-client/test/where-interop.test.ts](packages/3-extensions/sql-orm-client/test/where-interop.test.ts)

- **Offset arithmetic deleted**: ~150 lines of code removed. No behavior change — these functions existed only to maintain the implicit index invariant.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/where-utils.ts](packages/3-extensions/sql-orm-client/src/where-utils.ts) — `offsetWhereExprParams`, `offsetBoundWhereExpr`, `offsetParamDescriptors` deleted
    - [packages/3-extensions/sql-orm-client/src/where-interop.ts](packages/3-extensions/sql-orm-client/src/where-interop.ts) — `assertBoundPayload`, `assertBareWhereExprIsParamFree`, `whereExprContainsParamRef`, `collectParamRefIndexes` deleted
    - [packages/2-sql/4-lanes/kysely-lane/src/where-expr.ts](packages/2-sql/4-lanes/kysely-lane/src/where-expr.ts) — `remapParamIndexes`, `collectParamIndexes`, `findDescriptorByIndex` deleted (~80 lines)

- **Bare `WhereExpr` with `ParamRef` now accepted**: Before — `normalizeWhereArg` threw on bare `WhereExpr` containing `ParamRef`. After — accepted, since `ParamRef` carries its value.
  - **Why**: The old guard existed because bare `WhereExpr` had no way to carry values. With value-carrying `ParamRef`, this restriction is unnecessary.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/where-interop.ts (L37–L44)](packages/3-extensions/sql-orm-client/src/where-interop.ts)
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/where-interop.test.ts](packages/3-extensions/sql-orm-client/test/where-interop.test.ts) — `'accepts bare WhereExpr with ParamRef when no contract is provided'`

- **Codec resolution moved to AST-construction time**: Before — the adapter looked up `codecId` from the contract during rendering (via table/column metadata). After — `codecId` is set on `ParamRef` at construction, and the adapter uses `ref.codecId` directly.
  - **Why**: Simpler render functions; codec metadata travels with the data.
  - **Implementation**:
    - [packages/3-targets/6-adapters/postgres/src/core/adapter.ts](packages/3-targets/6-adapters/postgres/src/core/adapter.ts) — `renderParamRef` uses `ref.codecId`
    - [packages/2-sql/4-lanes/sql-lane/src/sql/predicate-builder.ts](packages/2-sql/4-lanes/sql-lane/src/sql/predicate-builder.ts) — sets `codecId` on `ParamRef`
    - [packages/3-extensions/sql-orm-client/src/where-binding.ts](packages/3-extensions/sql-orm-client/src/where-binding.ts) — `createParamRef` sets `codecId`

## Compatibility / migration / risk

- **No breaking change to public API surface**: `LoweredStatement` shape (`{ sql, params }`) is unchanged. `ExecutionPlan` / plan metadata structure is unchanged. External consumers of plans see no difference.
- **Internal API change**: `ParamRef.of()` signature changed (index → value). All internal call sites migrated in this branch.
- **`BoundWhereExpr` shape change**: Any code implementing `ToWhereExpr` that returned `{ expr, params, paramDescriptors }` must be updated to return `{ expr }` only. The `params` and `paramDescriptors` fields are removed from the interface.
- **`ParamDescriptor` metadata loss**: `refs`, `nullable`, `index` fields are no longer populated in param descriptors derived from the AST. If downstream tooling relied on these, it will see missing fields.

## Follow-ups / open questions

- **`types.ts` split (F08)**: Deferred to [TML-2173](https://linear.app/prisma-company/issue/TML-2173). The 1,600-line `types.ts` should be split into focused modules, but this is orthogonal to the structural paramref change.
- **`deriveParamsFromAst` deduplication**: Identical helper duplicated across `query-plan-mutations.ts` and `query-plan-select.ts` (SQL lane local copies are correct due to layering constraint).

## Non-goals / intentionally out of scope

- Adding MySQL/MSSQL/SQLite adapters (barrier removed, not implemented)
- Eliminating `instanceof` dispatch in the AST (TML-2096, independent)
- AST-level template reuse / prepared statement caching
- Changing `ExecutionPlan` / `LoweredStatement` public shape
