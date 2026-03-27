# Code Review — Structural ParamRef (TML-2103)

**Spec**: [projects/structural-paramref/spec.md](../spec.md)
**Branch**: `tml-2103-restructure-paramref-to-use-structural-linkage-instead-of-implicit-1`
**Review range**: `origin/main...HEAD` (11 commits, 63+ files changed)
**Review round**: 2 (re-review after feedback addressed)

## Summary

This branch replaces `ParamRef`'s implicit numeric-index linkage with structural value-carrying across the entire SQL AST pipeline. The implementation follows the spec closely: `ParamRef` now carries `value`, `codecId`, `nativeType`; the Postgres adapter assigns `$N` indices at lowering time via `collectParamRefs()`; and ~150 lines of offset arithmetic / validation code are deleted. All original review findings (F01–F07) have been addressed or explicitly deferred with comments.

## What looks solid

- **Clean commit history**: 11 focused commits that follow a logical sequence — spec/plan docs, core AST change, lane-by-lane migration, adapter, tests, feedback fixes.
- **Consistent migration pattern**: Every producer site follows the same `ParamRef.of(value, { name, codecId, nativeType })` pattern. No stragglers using the old API.
- **Thorough test migration**: 30+ test files updated to the new API surface. Tests assert on `ParamRef.value` instead of `ParamRef.index`. New `collectParamRefs()` tests added for all DML AST types, including deterministic ordering tests.
- **Complete offset machinery deletion**: `offsetWhereExprParams`, `offsetBoundWhereExpr`, `offsetParamDescriptors`, `assertBoundPayload`, `assertBareWhereExprIsParamFree`, `whereExprContainsParamRef`, `collectParamRefIndexes`, the entire Kysely `remapParamIndexes` / `collectParamIndexes` system — all cleanly removed.
- **Adapter `renderParamRef` is simple and correct**: identity-based lookup in `ParamIndexMap`, throws on missing ref, uses `ref.codecId` for typed casts.
- **Encoding path cleaned up**: `refs`-based JSON validation removed from `encodeParam`, dead `createColumnParamDescriptor` and `param-descriptors.ts` deleted, error labels use positional index.

---

## Blocking issues

### F08 — `types.ts` is 1,600 lines and should be split

**Location**: [packages/2-sql/4-lanes/relational-core/src/ast/types.ts](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — 1,602 lines, 50+ exports

**Issue**: A single `types.ts` file with 50+ exports spanning base AST nodes, source nodes, value/param nodes, expression nodes, where expressions, joins, SELECT, INSERT/UPDATE/DELETE, and interop types. This is an anti-pattern — `types.ts` conveys nothing about the file's contents. Types should be organized into modules by functionality just like any other code.

Since this branch already touches the entire AST surface, this is the natural time to split. Suggested modules:
- `base.ts` — `AstNode`, `QueryAst`, `FromSource`, `Expression`, `WhereExpr`, visitor/rewriter/folder interfaces
- `sources.ts` — `TableSource`, `TableRef`, `DerivedTableSource`
- `values.ts` — `ParamRef`, `DefaultValueExpr`, `LiteralExpr`, `ListLiteralExpr`
- `expressions.ts` — `ColumnRef`, `SubqueryExpr`, `OperationExpr`, `AggregateExpr`, `JsonObjectExpr`, `JsonArrayAggExpr`, `OrderByItem`, `ProjectionItem`
- `where.ts` — `BinaryExpr`, `AndExpr`, `OrExpr`, `ExistsExpr`, `NullCheckExpr`, `EqColJoinOn`
- `select.ts` — `JoinAst`, `SelectAst`, `SelectAstOptions`
- `dml.ts` — `InsertAst`, `InsertOnConflict`, conflict actions, `UpdateAst`, `DeleteAst`

The existing `exports/ast.ts` barrel re-export ensures downstream consumers don't break.

### F09 — Eliminate `BoundWhereExpr` (now meaningless)

**Location**: [packages/2-sql/4-lanes/relational-core/src/ast/types.ts](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — lines 1589–1591

**Issue**: After this refactoring, `BoundWhereExpr` is `{ readonly expr: WhereExpr }` — a wrapper that adds nothing. It existed to carry `params` and `paramDescriptors` alongside the expression, but those fields are gone. All code now wraps a `WhereExpr` in `{ expr }` only to unwrap it with `.expr` downstream.

This also renders the utilities in [packages/3-extensions/sql-orm-client/src/where-utils.ts](packages/3-extensions/sql-orm-client/src/where-utils.ts) meaningless:
- `createBoundWhereExpr(expr)` — returns `{ expr }` (no-op)
- `isBoundWhereExpr(value)` — uses a fragile negative duck-type check (F04)
- `ensureBoundWhereExpr(value)` — wraps into `{ expr }` if not already

Elimination:
1. Delete `BoundWhereExpr` interface
2. Change `ToWhereExpr.toWhereExpr()` to return `WhereExpr` directly
3. Change `filters: readonly BoundWhereExpr[]` → `filters: readonly WhereExpr[]` everywhere
4. Delete `createBoundWhereExpr`, `isBoundWhereExpr`, `ensureBoundWhereExpr`
5. Simplify `combineWhereFilters` to accept/return `WhereExpr[]` / `WhereExpr | undefined`
6. Update `normalizeWhereArg` to return `WhereExpr | undefined`
7. Update consumers (~20 call sites in `mutation-executor.ts`, `collection.ts`, `grouped-collection.ts`, `query-plan-*.ts`)

### F10 — Remove `nativeType` from `ParamRef`

**Location**: [packages/2-sql/4-lanes/relational-core/src/ast/types.ts](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — lines 345–377

**Issue**: `ParamRef.nativeType` is not consumed by any runtime code path. The adapter doesn't read it. The encoding path doesn't read it. It's only forwarded into `ParamDescriptor.nativeType`, where it is also not consumed. It's dead weight carried over from the old `ParamDescriptor` shape.

Remove `nativeType` from `ParamRef` constructor options and all `ParamRef.of(...)` call sites that set it.

### F11 — `ParamRef.codecId` should be required (not optional)

**Location**: [packages/2-sql/4-lanes/relational-core/src/ast/types.ts](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — lines 345–377

**Issue**: Every `StorageColumn` in the contract has a required `codecId` (per the JSON schema at `data-contract-sql-v1.json`: `"required": ["nativeType", "codecId", "nullable"]`). A `ParamRef` always corresponds to a column binding. If the column exists in the contract, `codecId` is required. The only call site that creates a `ParamRef` without `codecId` is the `OperationExpr` sentinel in `createOperationExprBuilder` (`ParamRef.of(undefined, { name: arg.name })` — [operations-registry.ts L82](packages/2-sql/4-lanes/relational-core/src/operations-registry.ts)).

**Decision**: Address in this PR. The sentinel is already broken: it creates a `ParamRef` with `value: undefined` and no `codecId`, yet `OperationExpr.fold` causes it to be collected by `collectParamRefs()`, producing `undefined` values in `plan.params`. The ORM client never hits this path (zero `ParamPlaceholder` usage), and the SQL lane (the only consumer) is being removed.

**Fix**: Change `createOperationExprBuilder` to accept raw values for `param`-kind operation args instead of requiring `ParamPlaceholder`. Create a proper `ParamRef.of(arg, { name, codecId: columnMeta.codecId })` — the column's `codecId` is the correct codec since param-kind args are the same type as the column (e.g. a vector arg for `cosineDistance` on a vector column). Then make `codecId` required on `ParamRef`, removing the conditional spreading pattern from every `deriveParamsFromAst` site.

### F12 — Encoding path uses `paramDescriptor.name` for structural codec lookup (code smell)

**Location**: [packages/2-sql/5-runtime/src/codecs/encoding.ts](packages/2-sql/5-runtime/src/codecs/encoding.ts) — lines 9–16

**Issue**: `resolveParamCodec` looks up `paramDescriptor.name` in `plan.meta.annotations.codecs` to resolve a codec. But `annotations.codecs` is populated from **projection types** (mapping projection aliases → codecId for result decoding). This is a coincidence-based lookup — a param named `email` would match a projected column `email` only if they happen to share a name. Worse, this lookup takes priority over `paramDescriptor.codecId` (lines 19–24), so it can override the correct codec with a wrong one.

With `codecId` now reliably set on every `ParamRef` (and therefore on every `ParamDescriptor`), this `annotations.codecs` lookup for params is redundant and should be removed. The `annotations.codecs` lookup is correct for **decoding** (in `decoding.ts`, where it resolves by projection alias), but wrong for **encoding** (where it's matching on param name, a different namespace).

---

## Non-blocking concerns

All original findings addressed. Residual items are documented with comments or are by-design decisions:

### F01 — Duplicate `deriveParamsFromAst` helper — **Resolved**

ORM package duplicates consolidated into shared `deriveParamsFromAst` in [query-plan-meta.ts](packages/3-extensions/sql-orm-client/src/query-plan-meta.ts) — lines 6–20. SQL lane retains local copies in `mutation-builder.ts` and `select-builder.ts`, which is correct since the sql-lane package cannot import from sql-orm-client (layering constraint).

### F02 — `ParamDescriptor` field cleanup — **Resolved**

Dead `param-descriptors.ts` deleted. Encoding path cleaned up: `encodeParam` no longer references `refs` for JSON validation, uses positional `paramIndex` for error labels. No remaining consumers of `refs`, `nullable`, or `index`.

### F03 — Empty `TransformResultWithParams` — **Resolved**

Interface removed. `transformKyselyToPnAstCollectingParams` now returns `TransformResult` directly.

### F04 — `isBoundWhereExpr` type guard fragility — **Subsumed by F09**

Subsumed by blocking F09 (eliminate `BoundWhereExpr`). When `BoundWhereExpr` is removed, `isBoundWhereExpr` goes with it.

### F05 — Repeated param-descriptor derivation pattern — **Resolved**

ORM package consolidated via shared `deriveParamsFromAst` in `query-plan-meta.ts`. SQL lane uses file-local helpers (layering constraint). All inline expansions removed.

### F06 — `nextParamIndex()` naming — **Resolved**

Renamed to `advanceParamCursor()` in [transform-context.ts](packages/2-sql/4-lanes/kysely-lane/src/transform/transform-context.ts) — line 41. All call sites updated.

### F07 — Deterministic ordering tests — **Resolved**

- SelectAst: `'collectParamRefs traverses in deterministic clause order: from, where, having, joins'` in [select.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/select.test.ts) — lines 130–157. Tests a complex AST with derived source, where, having, groupBy, and join with derived source.
- InsertAst: `'collectParamRefs preserves row-major order across multiple rows'` in [insert.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/insert.test.ts) — lines 108–118.

---

## Nits

### N01 — Removed comments in `predicate-builder.ts`

Several JSDoc comments and inline comments were removed. Per repo conventions, this is fine — prefer self-documenting code.

### N02 — `// TypeScript can't narrow ColumnBuilder properly` comments removed

Informational comments about a TypeScript limitation. Their removal is fine.

### N03 — Unused `VECTOR_CODEC_ID` reference removed from adapter

Vector params now use `renderParamRef` which applies the `codecId`-based cast generically. Correct simplification.

### N04 — Removed redundant `if` block in adapter `renderOperation`

The `if (expr.lowering.strategy === 'function') { return result; }` block was a no-op. Correct removal.

---

## Acceptance-criteria traceability

| Acceptance Criterion | Implementation | Evidence (Tests) |
|---|---|---|
| `ParamRef` carries `value`, `codecId`, `nativeType` | [relational-core/src/ast/types.ts](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — lines 345–377 | [common.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/common.test.ts) — lines 26–45 |
| `ParamRef.index` and `withIndex()` removed | [relational-core/src/ast/types.ts](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — compilation enforces | [common.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/common.test.ts) — no `.index` assertions remain |
| `BoundWhereExpr` simplified (no `params`/`paramDescriptors`) | [relational-core/src/ast/types.ts](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) — lines 1588–1590 | [where-binding.test.ts](packages/3-extensions/sql-orm-client/test/where-binding.test.ts), [where-utils.test.ts](packages/3-extensions/sql-orm-client/test/where-utils.test.ts) |
| `assertBoundPayload` removed | [where-interop.ts](packages/3-extensions/sql-orm-client/src/where-interop.ts) — function deleted | [where-interop.test.ts](packages/3-extensions/sql-orm-client/test/where-interop.test.ts) — validation tests removed |
| Offset machinery removed | [where-utils.ts](packages/3-extensions/sql-orm-client/src/where-utils.ts) — functions deleted | [where-utils.test.ts](packages/3-extensions/sql-orm-client/test/where-utils.test.ts) — offset tests removed |
| Postgres adapter collects params from AST | [adapter.ts](packages/3-targets/6-adapters/postgres/src/core/adapter.ts) — lines 123–131 | [adapter.test.ts](packages/3-targets/6-adapters/postgres/test/adapter.test.ts) |
| Postgres adapter assigns `$1, $2, …` from collection order | [adapter.ts](packages/3-targets/6-adapters/postgres/src/core/adapter.ts) — lines 123–131 | [adapter.test.ts](packages/3-targets/6-adapters/postgres/test/adapter.test.ts) — SQL assertions verify `$1`, `$2` placeholders |
| `LoweredStatement` shape unchanged | [adapter.ts](packages/3-targets/6-adapters/postgres/src/core/adapter.ts) — lines 147–151 | [adapter.test.ts](packages/3-targets/6-adapters/postgres/test/adapter.test.ts) — `body.sql` + `body.params` assertions |
| SQL lane predicate builder — no index counter | [predicate-builder.ts](packages/2-sql/4-lanes/sql-lane/src/sql/predicate-builder.ts) | [predicate-builder.test.ts](packages/2-sql/4-lanes/sql-lane/test/predicate-builder.test.ts), [sql-comparison-operators.test.ts](packages/2-sql/4-lanes/sql-lane/test/sql-comparison-operators.test.ts) |
| SQL lane mutation builder — no index counter | [mutation-builder.ts](packages/2-sql/4-lanes/sql-lane/src/sql/mutation-builder.ts) | [mutation-builder.test.ts](packages/2-sql/4-lanes/sql-lane/test/mutation-builder.test.ts), [rich-mutation.test.ts](packages/2-sql/4-lanes/sql-lane/test/rich-mutation.test.ts) |
| ORM where-binding — no push-derived index | [where-binding.ts](packages/3-extensions/sql-orm-client/src/where-binding.ts) | [where-binding.test.ts](packages/3-extensions/sql-orm-client/test/where-binding.test.ts) |
| ORM includes — no offset arithmetic | [query-plan-select.ts](packages/3-extensions/sql-orm-client/src/query-plan-select.ts) | [query-plan-select.test.ts](packages/3-extensions/sql-orm-client/test/query-plan-select.test.ts), [rich-query-plans.test.ts](packages/3-extensions/sql-orm-client/test/rich-query-plans.test.ts) |
| ORM mutations — no manual counter | [query-plan-mutations.ts](packages/3-extensions/sql-orm-client/src/query-plan-mutations.ts) | [query-plan-mutations.test.ts](packages/3-extensions/sql-orm-client/test/query-plan-mutations.test.ts) |
| Kysely transform — no `advanceParamCursor` for ParamRef | [transform-expr.ts](packages/2-sql/4-lanes/kysely-lane/src/transform/transform-expr.ts) | [build-plan.collect-params.test.ts](packages/2-sql/4-lanes/kysely-lane/test/build-plan.collect-params.test.ts), [where-expr.ast.test.ts](packages/2-sql/4-lanes/kysely-lane/src/where-expr.ast.test.ts) |
| Deterministic collection order (complex AST) | [select.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/select.test.ts) — lines 130–157 | Complex AST with derived source, where, having, joins — ordering verified |
| DML collectParamRefs ordering | [insert.test.ts](packages/2-sql/4-lanes/relational-core/test/ast/insert.test.ts) — lines 108–118 | Multi-row insert ordering verified |
| All existing tests pass | — | Full suite run needed (`pnpm test:packages`) |
