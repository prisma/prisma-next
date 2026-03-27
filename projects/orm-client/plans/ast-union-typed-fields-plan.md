# AST Union-Typed Fields Plan

## Summary

Replace abstract AST base class types (`Expression`, `WhereExpr`, `FromSource`, `QueryAst`) with discriminated union equivalents (`AnyExpression`, `AnyWhereExpr`, `AnyFromSource`, `AnyQueryAst`) in all field declarations, parameter types, composite type aliases, method return types, and rewriter interfaces. Then un-export the abstract base classes, making them internal implementation details. This eliminates the `as AnyFoo` cast pattern required by PR #253 and lets TypeScript narrow AST node types directly via `switch (node.kind)`.

**Spec:** [projects/orm-client/specs/ast-union-typed-fields.spec.md](../specs/ast-union-typed-fields.spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Agent | Drives execution |
| Reviewer | @aqrln | Requested this change in PR #253 review |

## Milestones

### Milestone 1: Replace all abstract class type references with union types

Change field types, composite aliases, rewriter interfaces, abstract method return types, and external consumer imports to use discriminated union types. Fix all resulting compilation errors.

**Tasks:**

- [ ] **M1-T1**: Update composite type aliases in `types.ts` (FR-2). Change `ProjectionExpr`, `SqlComparable`, `JoinOnExpr`, `WhereArg` to reference union types. Remove `SqlComparable` and rename `AnySqlComparable` to replace it.
- [ ] **M1-T2**: Update `ExpressionRewriter` and `AstRewriter` interfaces in `types.ts` (FR-4). Change callback return types from abstract class to union types.
- [ ] **M1-T3**: Update abstract method return types in `types.ts` (FR-4.1). Change `Expression.rewrite()`, `WhereExpr.rewrite()`, `WhereExpr.not()`, `FromSource.rewrite()` and all concrete overrides to return union types.
- [ ] **M1-T4**: Update field declarations on concrete AST classes in `types.ts` (FR-1). Change all ~15 field types listed in the spec from abstract class references to union types. Update constructor parameter types to match.
- [ ] **M1-T5**: Update external consumer type annotations (FR-3). Change ~10 files that import abstract base classes for type annotations to import union types instead.
- [ ] **M1-T6**: Fix compilation errors. Run `pnpm typecheck` and fix all errors that arise from the type changes. This includes updating method signatures, fixing type mismatches in callers, and adjusting test files.
- [ ] **M1-T7**: Run `pnpm test:packages` and fix any test failures.

### Milestone 2: Un-export abstract classes, remove casts, verify

With all public-facing types using unions, un-export the abstract base classes and clean up the codebase.

**Tasks:**

- [ ] **M2-T1**: Un-export all 6 abstract base classes in `types.ts` (FR-5): `AstNode`, `QueryAst`, `FromSource`, `Expression`, `WhereExpr`, `InsertOnConflictAction`.
- [ ] **M2-T2**: Fix compilation errors from un-exporting. Any remaining external references to abstract classes need to be replaced with union types or removed.
- [ ] **M2-T3**: Remove `as AnyExpression` / `as AnyWhereExpr` / `as AnyQueryAst` / `as AnyFromSource` casts that are no longer needed (NFR-3). Use the compiler as the arbiter — remove casts and see what compiles.
- [ ] **M2-T4**: Make switch statements exhaustive (FR-6). Where fields are now union-typed, remove `default` branches and replace with `never` exhaustiveness checks (if not already done in the previous PR).
- [ ] **M2-T5**: Run `pnpm build`, `pnpm typecheck`, `npx biome check`, and `pnpm test:packages`. Fix any failures.
- [ ] **M2-T6**: Verify all acceptance criteria are met.

### Milestone 3: Close-out

- [ ] **M3-T1**: Delete `projects/orm-client/specs/ast-union-typed-fields.spec.md` and `projects/orm-client/plans/ast-union-typed-fields-plan.md` (transient project artifacts).
- [ ] **M3-T2**: If `projects/orm-client/` is now empty of active work, delete the directory.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| All field declarations use union types | Compiler | M1-T6 | `pnpm typecheck` enforces type correctness |
| Composite type aliases reference union types | Compiler | M1-T1, M1-T6 | Direct code change + typecheck |
| External consumers import union types | Compiler | M1-T5, M1-T6 | Import changes + typecheck |
| Rewriter/visitor return types use union types | Compiler | M1-T2, M1-T6 | Interface change + typecheck |
| Abstract method return types use union types | Compiler | M1-T3, M1-T6 | Signature change + typecheck |
| All 6 abstract classes un-exported | Compiler | M2-T1, M2-T2 | Removing export + fixing errors proves no external usage |
| Unnecessary `as Any*` casts removed | Compiler | M2-T3 | Remove casts; compiler confirms they were redundant |
| Exhaustive `never` checks on union-typed fields | Compiler | M2-T4 | `never` default branches enforce exhaustiveness |
| `pnpm build` succeeds | Build | M2-T5 | Full workspace build |
| `pnpm test:packages` passes | Unit/Integration | M1-T7, M2-T5 | All package tests |
| No new linter errors | Lint | M2-T5 | `biome check` |

## Open Items

1. **Downstream `as` cast removal scope** (from spec): Some casts like `expr as OperationExpr` after `expr.kind === 'operation'` exist because TypeScript doesn't narrow class instances through discriminant checks. With fields now typed as union types, many of these will become unnecessary. The compiler is the arbiter — remove casts it no longer requires, keep ones still needed.
2. **`SqlComparable` removal**: FR-2 specifies removing `SqlComparable` since it becomes identical to `AnySqlComparable`. All existing `SqlComparable` references across the codebase must be updated. The `AnySqlComparable` type defined in PR #253's exhaustive switch commit already covers this exact shape.
