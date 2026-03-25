# Summary

Replace `ParamRef`'s implicit numeric-index linkage with structural value-carrying, so each parameter placeholder in the SQL AST is tied to its value at construction time. This eliminates an entire category of silent off-by-one and out-of-bounds bugs, removes ~150 lines of fragile offset arithmetic and validation code, and decouples the target-agnostic AST from PostgreSQL's 1-based `$N` convention.

# Description

`ParamRef` in the relational-core SQL AST currently uses a numeric `index` field to link parameter placeholders to their values in a parallel `params` array. The linkage is entirely implicit:

- `ParamRef.index` is 1-based (matching PostgreSQL's `$1, $2, …` convention)
- The corresponding value lives at `params[index - 1]`
- There is no structural guarantee that indices are correct, contiguous, or within bounds
- A Postgres implementation detail (1-based param indices) is baked into the target-agnostic relational-core AST

This creates three classes of problems:

1. **Silent binding errors**: If params are reordered, offset, or combined incorrectly, queries run with wrong parameter values with no error.
2. **Fragile index arithmetic**: At least 6 modules independently maintain the 1-based contiguous invariant via offset rewriting, manual counters, and validation (~150 lines of code that exists only because the data model is implicit).
3. **Target coupling**: The 1-based convention is PostgreSQL-specific. MySQL uses positional `?`, MSSQL uses `@p1`, SQLite supports multiple conventions. Adding a non-Postgres adapter requires compensating for this assumption throughout the AST.

The fix is to make each `ParamRef` carry its value and metadata directly, making invalid states unrepresentable. Adapters collect params from the AST during lowering and assign target-specific placeholder syntax at that point.

# Requirements

## Functional Requirements

1. **Value-carrying ParamRef**: `ParamRef` carries its bound value and optional metadata (`name`, `codecId`, `nativeType`) directly on the node, eliminating the need for a parallel params array during AST construction.
2. **Adapter-time index assignment**: Adapters (starting with Postgres) collect `ParamRef` nodes from the AST via the existing `collectParamRefs()` traversal and assign target-specific placeholder indices (`$1`, `$2`, …) during lowering. The AST itself contains no index.
3. **Deterministic collection order**: `collectParamRefs()` traversal order is deterministic (guaranteed by the immutable AST structure and existing traversal patterns) and becomes the canonical param ordering for the lowered statement.
4. **Simplified BoundWhereExpr**: `BoundWhereExpr` no longer carries separate `params` and `paramDescriptors` arrays — the values are embedded in the AST nodes. The type simplifies to `{ expr: WhereExpr }` (or is eliminated entirely in favor of bare `WhereExpr`).
5. **Deletion of offset machinery**: The `offsetWhereExprParams`, `offsetBoundWhereExpr`, `combineWhereFilters` offset arithmetic in `where-utils.ts` is removed. The 45-line `assertBoundPayload` validation in `where-interop.ts` is removed. These exist only to maintain the implicit index invariant.
6. **ParamDescriptor derivation**: `ParamDescriptor` information (for codec lookup during encoding) is derived from the `ParamRef` node's metadata during lowering, rather than maintained as a parallel array.
7. **All existing query lanes continue to work**: SQL lane (select, insert, update, delete), ORM lane (where filters, mutations, includes), Kysely lane, and raw lane produce correct queries with correct parameter binding.
8. **All existing tests pass** (with updates to reflect the new API surface, not new behavior).

## Non-Functional Requirements

- **No runtime performance regression**: The param collection during lowering adds a single AST traversal. This is negligible compared to the database round-trip. The offset rewriting traversals being removed are a net wash.
- **No breaking change to plan structure**: The lowered `LoweredStatement` (and `ExecutionPlan.params`) remain `readonly unknown[]` — only the internal AST representation changes. External consumers of plans see no difference.
- **Incremental migration**: The change can be landed in a single PR since all affected code is internal to the query lane and adapter packages.

**Assumption:** The `collectParamRefs()` traversal on the existing AST is deterministic and produces a stable ordering. This is true because the AST is immutable and frozen, and all traversal methods use fixed iteration order (projection → where → orderBy → joins, etc.).

## Non-goals

- **Adding MySQL/MSSQL/SQLite adapters**: This refactoring removes the barrier to non-Postgres adapters but does not implement them.
- **Eliminating `instanceof` dispatch in the AST**: TML-2096 tracks replacing `instanceof` with structural brands. These changes can be coordinated but are independent.
- **AST reuse with different values**: The value-carrying approach means a given AST tree is bound to specific values. This is safe because the reusable template in the current architecture is the *builder* (which holds `ParamPlaceholder` objects via `param('name')`), not the AST. Each `.build({ params: {...} })` call produces a fresh AST. If AST-level template reuse (e.g., prepared statements, plan caching by shape) is needed in the future, it can be supported via the existing `rewrite({ paramRef: ... })` mechanism or by introducing a separate plan-template concept.
- **Changing the `ExecutionPlan` / `LoweredStatement` public shape**: The output of lowering (`{ sql, params }`) does not change. Only the internal AST representation changes.
- **Refactoring `OperationExpr` param handling**: Currently, `OperationExpr` args that are `ParamRef` use `index: 0` as a placeholder and are not collected into `plan.params`. This ticket does not change that semantic — operation params remain bound through the operation resolution path. A follow-up may unify this.

# Acceptance Criteria

## Core AST changes

- `ParamRef` carries `value: unknown` and optional `codecId: string | undefined`, `nativeType: string | undefined`
- `ParamRef.index` and `ParamRef.withIndex()` are removed
- `ParamRef` constructor takes `(value, options?)` instead of `(index, name?)`
- All `ParamRef.of(index, name)` call sites are migrated to `ParamRef.of(value, { name, codecId })` (or equivalent)

## BoundWhereExpr simplification

- `BoundWhereExpr` no longer has `params` or `paramDescriptors` fields (or the type is removed)
- `ToWhereExpr.toWhereExpr()` returns a `WhereExpr` directly (or a simplified bound type without params)
- `assertBoundPayload` validation in `where-interop.ts` is removed
- `offsetWhereExprParams`, `offsetBoundWhereExpr`, `combineWhereFilters` in `where-utils.ts` are removed or simplified to not perform index arithmetic

## Adapter lowering

- Postgres adapter collects params from the AST via `collectParamRefs()` during lowering
- Postgres adapter assigns `$1, $2, …` indices based on collection order
- `ParamDescriptor` array for the plan is derived from collected `ParamRef` metadata
- Lowered `LoweredStatement` shape (`{ sql, params }`) is unchanged

## Lane integration

- SQL lane predicate builder creates `ParamRef` with values (no index counter)
- SQL lane mutation builder creates `ParamRef` with values (no manual index increment)
- ORM where-binding creates `ParamRef` with values (no `params.push` index derivation)
- ORM query-plan-select include strategies work without param offset arithmetic
- ORM query-plan-mutations `normalizeInsertRows` works without manual index counter
- Kysely lane transform creates `ParamRef` with values (no `nextParamIndex` counter)

## Test coverage

- Existing test suites pass (with API-surface updates, not behavior changes)
- No test asserts specific `ParamRef.index` values (these assertions are removed or changed to assert `ParamRef.value`)
- At least one test validates deterministic param collection order across a complex AST (joins, subqueries, where + orderBy)

# Other Considerations

## Security

No security implications. Parameter binding continues to use parameterized queries — values are never interpolated into SQL strings. The change is purely internal to how the AST links placeholders to values.

## Cost

No infrastructure cost. This is an internal refactoring with no new dependencies or services.

## Observability

Plan metadata (`paramDescriptors`, `annotations.codecs`) continues to be derived and attached to plans. The source of that metadata shifts from parallel arrays to AST node properties, but the output is identical.

## Data Protection

No change. Parameter values continue to flow through the same codec encoding pipeline and are never logged in production.

## Analytics

No change.

# References

- [TML-2103](https://linear.app/prisma-company/issue/TML-2103/restructure-paramref-to-use-structural-linkage-instead-of-implicit-1) — Linear ticket with full problem analysis and option exploration
- [TML-2096](https://linear.app/prisma-company/issue/TML-2096) — Related: avoid instanceof in AST (coordinate but independent)
- `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` — `ParamRef` class definition
- `packages/3-extensions/sql-orm-client/src/where-utils.ts` — Offset arithmetic to be removed
- `packages/3-extensions/sql-orm-client/src/where-interop.ts` — Validation code to be removed
- `packages/3-targets/6-adapters/postgres/src/core/adapter.ts` — Adapter lowering (primary change site)

# Open Questions

1. **Should `ParamRef` in `OperationExpr` args also carry values?** Currently these use `index: 0` as a sentinel and are resolved through a separate path. The ticket explicitly non-goals this, but if the operation resolution path already passes values through, unifying would be cleaner. **Default assumption:** Leave `OperationExpr` param handling unchanged in this ticket; address in a follow-up.

2. **Should `BoundWhereExpr` be eliminated entirely or kept as `{ expr: WhereExpr }`?** If it's kept as a wrapper, it provides a nominal type distinction. If eliminated, `WhereArg` simplifies to `WhereExpr | ToWhereExpr`. **Default assumption:** Eliminate `BoundWhereExpr` and use bare `WhereExpr` where possible, keeping `ToWhereExpr` as the external interop boundary that produces a `WhereExpr`.

# Resolved Questions

- **Does value-carrying `ParamRef` prevent query template reuse?** No. The reusable template in the current architecture is the builder (holding `ParamPlaceholder` via `param('name')`), not the AST. Each `.build()` produces a fresh AST. Value-carrying `ParamRef` is safe.

- **Does the Kysely lane need special handling?** No special handling — embed values in `ParamRef` during transform, derive `params` and `paramDescriptors` from the AST at plan-build time. The existing `build-plan` validation (`params.length === paramDescriptors.length`) is replaced by this derivation.

- **Should `ParamRef.name` be kept?** Yes, as an optional field. It remains useful for diagnostics, `ParamDescriptor.name`, and `annotations.codecs` lookup.

