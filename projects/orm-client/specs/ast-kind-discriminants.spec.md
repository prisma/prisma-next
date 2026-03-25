# Summary

Replace all `instanceof`-based dispatch on SQL query AST node classes with structural `kind` discriminant tags, eliminating silent failures from duplicate package instances and enabling TypeScript exhaustiveness checking at dispatch sites.

# Description

The SQL query AST (`@prisma-next/sql-relational-core/ast`) uses a class hierarchy where `instanceof` is the sole dispatch mechanism for node type checking. PR #234 replaced the original interface-based AST (which used `kind` string discriminants) with an immutable class hierarchy and removed `kind` entirely.

`instanceof` fails silently when multiple copies of a package exist in `node_modules` — a common scenario in pnpm workspaces with hoisting edge cases, misaligned workspace versions, or bundler deduplication failures. A `ColumnRef` created by copy A will not pass `instanceof ColumnRef` from copy B. The check returns `false` and execution falls through to a catch-all `throw` with an opaque "Unsupported AST node" error.

This task restores structural dispatch by adding `readonly kind` discriminant tags to every concrete AST class and migrating all ~112 `instanceof` dispatch sites to `kind`-based switching.

**Linear issue:** [TML-2096](https://linear.app/prisma-company/issue/TML-2096/avoid-instanceof-in-sql-query-ast-methods)

# Requirements

## Functional Requirements

### FR-1: Add `kind` discriminant tags to all AST node classes

- **FR-1.1**: Add `abstract readonly kind: string` to the `AstNode` base class (or to each abstract subclass: `QueryAst`, `FromSource`, `Expression`, `WhereExpr`, `InsertOnConflictAction`).
- **FR-1.2**: Add `readonly kind = '<tag>' as const` to every concrete AST class. The full set of concrete classes requiring tags:

  | Class | Proposed `kind` |
  |---|---|
  | `SelectAst` | `'select'` |
  | `InsertAst` | `'insert'` |
  | `UpdateAst` | `'update'` |
  | `DeleteAst` | `'delete'` |
  | `TableSource` | `'table-source'` |
  | `DerivedTableSource` | `'derived-table-source'` |
  | `ColumnRef` | `'column-ref'` |
  | `ParamRef` | `'param-ref'` |
  | `DefaultValueExpr` | `'default-value'` |
  | `LiteralExpr` | `'literal'` |
  | `SubqueryExpr` | `'subquery'` |
  | `OperationExpr` | `'operation'` |
  | `AggregateExpr` | `'aggregate'` |
  | `JsonObjectExpr` | `'json-object'` |
  | `JsonArrayAggExpr` | `'json-array-agg'` |
  | `ListLiteralExpr` | `'list-literal'` |
  | `BinaryExpr` | `'binary'` |
  | `AndExpr` | `'and'` |
  | `OrExpr` | `'or'` |
  | `ExistsExpr` | `'exists'` |
  | `NullCheckExpr` | `'null-check'` |
  | `EqColJoinOn` | `'eq-col-join-on'` |
  | `JoinAst` | `'join'` |
  | `ProjectionItem` | `'projection-item'` |
  | `OrderByItem` | `'order-by-item'` |
  | `InsertOnConflict` | `'insert-on-conflict'` |
  | `DoNothingConflictAction` | `'do-nothing'` |
  | `DoUpdateSetConflictAction` | `'do-update-set'` |

- **FR-1.3**: Define discriminated union types for each abstract base, e.g.:
  ```typescript
  type AnyQueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst;
  type AnyFromSource = TableSource | DerivedTableSource;
  type AnyExpression = ColumnRef | SubqueryExpr | OperationExpr | AggregateExpr | JsonObjectExpr | JsonArrayAggExpr;
  type AnyWhereExpr = BinaryExpr | AndExpr | OrExpr | ExistsExpr | NullCheckExpr;
  ```

### FR-2: Migrate dispatch sites from `instanceof` to `kind`-based switching

All production `instanceof` checks on AST node classes must be replaced with `kind`-based dispatch. The dispatch sites span 13 files across 6 packages:

| File | `instanceof` count |
|---|---|
| `relational-core/src/ast/types.ts` | 25 |
| `postgres/src/core/adapter.ts` | 39 |
| `sql-runtime/src/plugins/lints.ts` | 6 |
| `sql-orm-client/src/where-binding.ts` | 12 |
| `sql-orm-client/src/query-plan-aggregate.ts` | 5 |
| `sql-orm-client/src/collection.ts` | 1 |
| `sql-orm-client/src/query-plan-meta.ts` | 1 |
| `kysely-lane/src/transform/transform.ts` | 10 |
| `kysely-lane/src/transform/transform-expr.ts` | 3 |
| `kysely-lane/src/transform/transform-dml.ts` | 1 |
| `kysely-lane/src/where-expr.ts` | 2 |
| `sql-lane/src/sql/predicate-builder.ts` | 5 |
| `relational-core/src/utils/guards.ts` | 1 |

- **FR-2.1**: Replace `instanceof` chains with `switch (node.kind)` statements where the dispatch covers multiple branches.
- **FR-2.2**: Replace single-branch `instanceof` guards (e.g. `if (x instanceof ParamRef)`) with `kind`-based checks (e.g. `if (x.kind === 'param-ref')`).
- **FR-2.3**: Use exhaustive `switch` with `never` default where all branches of a union are handled, so TypeScript catches missing cases when new node types are added.
- **FR-2.4**: Keep `instanceof` only where it is genuinely necessary — e.g., `WhereExprVisitor` interface methods that already receive narrowed types, or non-AST `instanceof` checks (error handling, etc.).

### FR-3: Remove the warning comment

- **FR-3.1**: Remove the `instanceof` warning comment on `AstNode` (currently at lines 197–200 of `types.ts`), since the structural dispatch makes it obsolete.

### FR-4: Update tests

- **FR-4.1**: Migrate test assertions that use `instanceof` to assert on `kind` instead (e.g. `expect(node.kind).toBe('select')` instead of `expect(node instanceof SelectAst).toBe(true)`).
- **FR-4.2**: Add test coverage verifying that `kind` discriminants are correctly set on all concrete AST classes.
- **FR-4.3**: Add a test verifying that structural dispatch works across module boundaries (simulating the duplicate-package scenario).

## Non-Functional Requirements

- **NFR-1**: Zero runtime cost — `kind` tags are readonly string literal properties, no runtime overhead beyond the property access already incurred by `instanceof` prototype chain walks.
- **NFR-2**: No API breaking changes — AST node constructors and the existing public API surface remain unchanged. The `kind` property is additive.
- **NFR-3**: Full exhaustiveness checking — all multi-branch dispatch sites must use exhaustive `switch` statements that produce compile-time errors when a new concrete node type is added without handling it.

## Non-goals

- Refactoring the AST class hierarchy itself (e.g., changing inheritance relationships, merging classes, or introducing a visitor pattern replacement). The hierarchy stays as-is; only dispatch mechanism changes.
- Adding `kind` tags to non-AST classes (e.g., `SqlCodec`, builder types, or error types). Those have different dispatch patterns and are out of scope.
- Removing the class hierarchy in favor of plain objects / tagged unions. The classes provide useful immutability and encapsulation; we are only adding structural dispatch alongside them.
- Addressing the `ParamRef` structural linkage issue (tracked separately as [TML-2103](https://linear.app/prisma-company/issue/TML-2103)).

# Acceptance Criteria

- [ ] Every concrete AST class in `types.ts` has a `readonly kind` property with a unique string literal type
- [ ] Abstract AST base classes declare `abstract readonly kind: string`
- [ ] Discriminated union types are exported for each abstract base class family
- [ ] All ~112 production `instanceof` checks on AST classes are replaced with `kind`-based dispatch
- [ ] No production code imports AST classes solely for `instanceof` — classes are imported for construction, `kind` values are used for dispatch
- [ ] Multi-branch dispatch sites use exhaustive `switch` with `never` default
- [ ] The `instanceof` warning comment on `AstNode` is removed
- [ ] All existing tests pass after the migration
- [ ] Test assertions using `instanceof` on AST nodes are migrated to `kind` checks
- [ ] `pnpm build` succeeds across all affected packages
- [ ] `pnpm test:packages` passes
- [ ] No new linter errors introduced

# Other Considerations

## Security

No security implications. This is a purely internal refactoring of dispatch mechanism within the query builder AST. No user-facing API changes, no data flow changes.

## Cost

No cost implications. Zero runtime overhead change — string property access replaces prototype chain walk.

## Observability

No observability changes needed. The primary observability improvement is better error messages: instead of opaque "Unsupported AST node" errors from failed `instanceof` chains, exhaustive `switch` statements will produce compile-time errors for unhandled cases and TypeScript `never` assertions for runtime safety.

## Data Protection

Not applicable. No data handling changes.

## Analytics

Not applicable.

# References

- [TML-2096](https://linear.app/prisma-company/issue/TML-2096/avoid-instanceof-in-sql-query-ast-methods) — Linear issue
- PR #234 code review finding NB-F02 — identified the `instanceof` risk
- PR #234 system design review section 7.1 — recommended structural dispatch
- `relational-core/src/ast/types.ts` lines 197–200 — existing warning comment
- [TML-2103](https://linear.app/prisma-company/issue/TML-2103) — related: restructure `ParamRef` to use structural linkage
- [TML-2099](https://linear.app/prisma-company/issue/TML-2099) — related: move budgets plugin from Framework domain to SQL domain

# Open Questions

1. **Tag naming convention**: The proposed `kind` values use kebab-case (e.g. `'column-ref'`, `'derived-table-source'`). An alternative is camelCase (`'columnRef'`, `'derivedTableSource'`). The original AST used short lowercase tags (`'col'`, `'select'`). **Assumption:** kebab-case aligns with the convention used in existing discriminants elsewhere in the codebase (e.g., `guards.ts` uses `'param-placeholder'`, `'column'`). Does that convention hold?

2. **Union type naming**: Should the discriminated union types be named `AnyQueryAst`, `AnyExpression`, etc., or follow a different convention (e.g. `QueryAstUnion`, `ExpressionNode`)? **Assumption:** `Any*` prefix is consistent with common TypeScript patterns and is clear.

3. **`kind` on non-leaf nodes**: Some `instanceof` checks target abstract classes like `Expression` (in `predicate-builder.ts`) and `WhereExpr` (in `collection.ts`). After adding `kind` tags, these checks can be replaced with discriminated union type guards. Should we also provide a `isExpression(node)` / `isWhereExpr(node)` type guard function for convenience, or is checking `node.kind` against the union sufficient? **Assumption:** simple `kind`-in-union checks are sufficient; type guard functions can be added later if ergonomics demand it.

4. **Scope of test migration**: Should test files that use `instanceof` for assertion purposes (e.g. `expect(node instanceof SelectAst).toBe(true)`) be migrated to `kind` checks, or is `instanceof` acceptable in tests since they always run within a single package version? **Assumption:** migrate tests too, for consistency and to validate the `kind` tags.
