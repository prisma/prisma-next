# Summary

Replace abstract AST base class types (`Expression`, `WhereExpr`, `FromSource`, `QueryAst`) with their discriminated union equivalents (`AnyExpression`, `AnyWhereExpr`, `AnyFromSource`, `AnyQueryAst`) everywhere — field declarations, parameter types, composite type aliases, method return types, and rewriter interface callbacks — so that consumers can narrow via `switch (node.kind)` without casting. Un-export all abstract base classes, making them internal implementation details for method inheritance only.

# Description

PR #253 ([TML-2096](https://linear.app/prisma-company/issue/TML-2096/avoid-instanceof-in-sql-query-ast-methods)) added `kind` discriminant tags to all AST classes and migrated all `instanceof` dispatch to `kind`-based switching. However, the AST's own field and parameter types still use the abstract base classes (`Expression`, `WhereExpr`, etc.). This means TypeScript cannot narrow these types via `kind` checks — consumers must cast to the corresponding union type (e.g., `ast as AnyQueryAst`) before switching.

For example, `BinaryExpr.left` is typed as `Expression`. When code receives `binary.left` and wants to dispatch on `kind`, it must write `const expr = binary.left as AnyExpression` because TypeScript only narrows discriminated unions, not abstract class hierarchies. This cast pattern appears throughout the codebase and was flagged by the reviewer ([PR #253 discussion](https://github.com/prisma/prisma-next/pull/253#discussion_r2996241898)) as a design gap: the base abstract classes should be implementation details, not public-facing types.

The abstract classes become fully internal. Method return types (`rewrite()`, `not()`) and rewriter interface callbacks (`ExpressionRewriter.columnRef`) also switch to union types. A rewriter can transform a `ColumnRef` into a `SubqueryExpr`, so returning `AnyExpression` is semantically correct — "one of the known expression types, I don't know which." TypeScript handles the forward reference from the abstract class to `AnyExpression` (defined later in the same file) via lazy type alias resolution.

**Linear issue:** [TML-2096](https://linear.app/prisma-company/issue/TML-2096/avoid-instanceof-in-sql-query-ast-methods) (same parent issue)

**Prerequisite:** [ast-kind-discriminants.spec.md](ast-kind-discriminants.spec.md) (PR #253)

# Requirements

## Functional Requirements

### FR-1: Use union types in AST field declarations

All `readonly` field declarations on concrete AST classes that currently reference an abstract base class must be changed to reference the corresponding discriminated union type.

Affected fields (all in `relational-core/src/ast/types.ts`):

| Field | Current type | Target type |
|---|---|---|
| `OperationExpr.self` | `Expression` | `AnyExpression` |
| `OperationExpr` constructor `self` param | `Expression` | `AnyExpression` |
| `OperationExpr` constructor `args` param entries | `Expression \| ParamRef \| LiteralExpr` | `AnyOperationArg` |
| `AggregateExpr.expr` | `Expression \| undefined` | `AnyExpression \| undefined` |
| `JsonArrayAggExpr.expr` | `Expression` | `AnyExpression` |
| `OrderByItem.expr` | `Expression` | `AnyExpression` |
| `BinaryExpr.left` | `Expression` | `AnyExpression` |
| `NullCheckExpr.expr` | `Expression` | `AnyExpression` |
| `JoinAst.source` | `FromSource` | `AnyFromSource` |
| `SelectAst.from` | `FromSource` | `AnyFromSource` |
| `SelectAst.where` | `WhereExpr \| undefined` | `AnyWhereExpr \| undefined` |
| `SelectAst.having` | `WhereExpr \| undefined` | `AnyWhereExpr \| undefined` |
| `UpdateAst.where` | `WhereExpr \| undefined` | `AnyWhereExpr \| undefined` |
| `DeleteAst.where` | `WhereExpr \| undefined` | `AnyWhereExpr \| undefined` |
| `BoundWhereExpr.expr` | `WhereExpr` | `AnyWhereExpr` |
| `SqlQueryPlan.ast` | `QueryAst` | `AnyQueryAst` |

Constructor parameter types must change to match the field types.

### FR-2: Use union types in composite type aliases

The composite type aliases that reference abstract base classes must be updated:

| Alias | Current definition | Target definition |
|---|---|---|
| `ProjectionExpr` | `Expression \| LiteralExpr` | `AnyExpression \| LiteralExpr` |
| `SqlComparable` | `Expression \| ParamRef \| LiteralExpr \| ListLiteralExpr` | `AnyExpression \| ParamRef \| LiteralExpr \| ListLiteralExpr` |
| `JoinOnExpr` | `EqColJoinOn \| WhereExpr` | `EqColJoinOn \| AnyWhereExpr` |
| `WhereArg` | `WhereExpr \| ToWhereExpr` | `AnyWhereExpr \| ToWhereExpr` |

After this change, `SqlComparable` becomes identical to `AnySqlComparable`. Remove `SqlComparable` and use `AnySqlComparable` everywhere, consistent with the `Any`-prefix convention used by all other union types (`AnyQueryAst`, `AnyExpression`, etc.).

### FR-3: Use union types in external consumer type annotations

Files outside `types.ts` that import abstract base classes for use as type annotations must switch to the corresponding union types:

| File | Current import | Target import |
|---|---|---|
| `relational-core/src/plan.ts` | `QueryAst` | `AnyQueryAst` |
| `sql-runtime/src/lower-sql-plan.ts` | `QueryAst` | `AnyQueryAst` |
| `kysely-lane/src/transform/transform-context.ts` | `QueryAst` | `AnyQueryAst` |
| `sql-orm-client/src/query-plan-meta.ts` | `QueryAst` | `AnyQueryAst` |
| `postgres/src/exports/runtime.ts` | `QueryAst` | `AnyQueryAst` |
| `sql-orm-client/src/types.ts` | `WhereExpr` | `AnyWhereExpr` |
| `sql-orm-client/src/collection-internal-types.ts` | `WhereExpr` | `AnyWhereExpr` |
| `sql-orm-client/src/mutation-executor.ts` | `WhereExpr` | `AnyWhereExpr` |
| `sql-lane/src/sql/plan.ts` | `Expression` | `AnyExpression` |
| `relational-core/src/ast/join.ts` | `FromSource` | `AnyFromSource` |

### FR-4: Use union types in rewriter/visitor interface return types

The exported interfaces that reference abstract base classes in their callback signatures must be updated to use union types:

```typescript
// BEFORE
export interface ExpressionRewriter {
  columnRef?(expr: ColumnRef): Expression;
  // ...
}
export interface AstRewriter extends ExpressionRewriter {
  tableSource?(source: TableSource): TableSource;
  eqColJoinOn?(on: EqColJoinOn): EqColJoinOn | WhereExpr;
}

// AFTER
export interface ExpressionRewriter {
  columnRef?(expr: ColumnRef): AnyExpression;
  // ...
}
export interface AstRewriter extends ExpressionRewriter {
  tableSource?(source: TableSource): TableSource;
  eqColJoinOn?(on: EqColJoinOn): EqColJoinOn | AnyWhereExpr;
}
```

The `WhereExprVisitor` and `ExpressionFolder` interfaces are already generic over their return type (`<R>` and `<T>`) and do not reference abstract base classes in return position, so they are unaffected.

### FR-4.1: Use union types in abstract method return types

The abstract method signatures on the (now-internal) abstract classes should also use union types:

- `Expression.rewrite(rewriter): AnyExpression`
- `WhereExpr.rewrite(rewriter): AnyWhereExpr`
- `WhereExpr.not(): AnyWhereExpr`
- `FromSource.rewrite(rewriter): AnyFromSource`

The concrete class overrides must update their return types to match. TypeScript handles the forward reference to `AnyExpression` etc. — the union types are defined after the concrete classes in the same file, and TypeScript resolves type aliases lazily.

**Note:** `Expression.fold<T>()`, `WhereExpr.accept<R>()`, and `WhereExpr.fold<T>()` are already generic and do not reference abstract base classes in return position.

### FR-5: Un-export all abstract base classes

Remove the `export` keyword from all abstract class declarations:

- `AstNode`
- `QueryAst`
- `FromSource`
- `Expression`
- `WhereExpr`
- `InsertOnConflictAction`

These classes remain in the file as internal implementation details (providing shared methods to concrete subclasses) but are no longer part of the public API surface. Since all exported interfaces (FR-4), field types (FR-1), and composite type aliases (FR-2) now use union types instead of abstract classes, no external consumer needs to reference them.

### FR-6: Make non-exhaustive switches exhaustive where possible

With fields typed as union types instead of abstract classes, `switch` statements that previously required `default` branches can become exhaustive. Any `switch` on a field that is now a union type should use `never` exhaustiveness checks where all variants are handled.

**Assumption:** This applies to newly-enabled sites only. Existing exhaustive switches from PR #253 are already correct.

## Non-Functional Requirements

- **NFR-1**: Zero runtime cost — all changes are type-level. No runtime behavior changes.
- **NFR-2**: No API breaking changes for external consumers — fields gain more precise types (narrower unions instead of broad abstract class), which is a compatible change. Code that was already using the abstract class type will still compile since the union members are all subclasses of the abstract class.
- **NFR-3**: All `as AnyExpression` / `as AnyWhereExpr` / `as AnyQueryAst` / `as AnyFromSource` casts that exist solely to enable `kind`-based narrowing should be removed. The compiler should flag any that become unnecessary.
- **NFR-4**: Build and test pass — `pnpm build` and `pnpm test:packages` succeed with no new errors.

## Non-goals

- Removing the class hierarchy itself. Classes are preserved for method inheritance, immutability (freeze), and factory methods.
- Adding generics (CRTP / F-bounded polymorphism) to the abstract classes. This was evaluated and rejected: `rewrite()` is not a self-type-preserving operation, and heterogeneous containers need existential types that TypeScript doesn't support.

# Acceptance Criteria

- [ ] All field declarations on concrete AST classes use union types (`AnyExpression`, `AnyWhereExpr`, `AnyFromSource`, `AnyQueryAst`) instead of abstract base classes
- [ ] Composite type aliases (`ProjectionExpr`, `SqlComparable`, `JoinOnExpr`, `WhereArg`) reference union types instead of abstract base classes
- [ ] External consumers import union types instead of abstract base classes for type annotations
- [ ] `ExpressionRewriter` and `AstRewriter` callback return types use union types instead of abstract base classes
- [ ] Abstract method return types (`rewrite()`, `not()`) use union types instead of abstract base classes
- [ ] All 6 abstract base classes (`AstNode`, `QueryAst`, `FromSource`, `Expression`, `WhereExpr`, `InsertOnConflictAction`) are un-exported
- [ ] All `as AnyExpression` / `as AnyWhereExpr` / `as AnyQueryAst` / `as AnyFromSource` casts that existed solely for `kind`-narrowing are removed
- [ ] `switch` statements on fields that are now union-typed use `never` exhaustiveness checks where all variants are handled
- [ ] `pnpm build` succeeds across all affected packages
- [ ] `pnpm test:packages` passes
- [ ] No new linter errors introduced

# Other Considerations

## Security

No security implications. Pure type-level refactoring with no runtime behavior changes.

## Cost

No cost implications. Zero runtime overhead change.

## Observability

No observability changes needed. Error messages from exhaustive switch defaults are unchanged.

## Data Protection

Not applicable. No data handling changes.

## Analytics

Not applicable.

# References

- [TML-2096](https://linear.app/prisma-company/issue/TML-2096/avoid-instanceof-in-sql-query-ast-methods) — parent issue (kind discriminants migration)
- [PR #253](https://github.com/prisma/prisma-next/pull/253) — kind discriminants implementation
- [PR #253 discussion r2996241898](https://github.com/prisma/prisma-next/pull/253#discussion_r2996241898) — reviewer feedback: "base abstract classes should be implementation details, use union types everywhere"
- [ast-kind-discriminants.spec.md](ast-kind-discriminants.spec.md) — prerequisite spec
- `relational-core/src/ast/types.ts` — central file containing all AST class definitions

# Open Questions

1. **Downstream `as` cast removal scope**: Some casts (e.g., `expr as OperationExpr` after `expr.kind === 'operation'`) exist because TypeScript doesn't narrow class instances through discriminant checks — only plain discriminated unions narrow. With fields typed as union types, some of these casts will become unnecessary (TypeScript will narrow the union). Others may persist where the value comes from a method return. **Assumption:** Remove casts that the compiler no longer requires; keep casts that are still needed. The compiler is the arbiter.
