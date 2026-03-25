# AST Kind Discriminants — Execution Plan

## Summary

Add structural `kind` discriminant tags to every concrete SQL query AST class and migrate all ~112 `instanceof` dispatch sites across 13 files in 6 packages to `kind`-based switching. This eliminates silent failures from duplicate package instances and enables TypeScript exhaustiveness checking at every dispatch site.

**Spec:** [projects/orm-client/specs/ast-kind-discriminants.spec.md](../specs/ast-kind-discriminants.spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | William Madden | Drives execution |
| Reviewer | — | Architectural review of AST changes |

## Milestones

### Milestone 1: Add `kind` tags, union types, and foundation tests

Purely additive: every concrete AST class gets a `readonly kind` tag, abstract bases get `abstract readonly kind: string`, and discriminated union types are exported. No dispatch sites change yet — existing `instanceof` code continues to work. Validated by: all existing tests pass, new tests verify every class has the correct `kind` value.

**Tasks:**

- [ ] **1.1** Add `abstract readonly kind: string` to abstract base classes (`AstNode`, or individually to `QueryAst`, `FromSource`, `Expression`, `WhereExpr`, `InsertOnConflictAction`) in `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`
- [ ] **1.2** Add `readonly kind = '<tag>' as const` to all 28 concrete AST classes in `types.ts` (see FR-1.2 table in spec for tag values)
- [ ] **1.3** Define and export discriminated union types (`AnyQueryAst`, `AnyFromSource`, `AnyExpression`, `AnyWhereExpr`, `AnyInsertOnConflictAction`, and a top-level `AnyComparable` for `ParamRef | LiteralExpr | ListLiteralExpr | DefaultValueExpr | Expression`) in `types.ts`
- [ ] **1.4** Write tests: instantiate every concrete AST class and assert its `kind` value matches the expected tag
- [ ] **1.5** Verify `pnpm build` succeeds for `@prisma-next/sql-relational-core` and downstream packages

### Milestone 2: Migrate all dispatch sites to `kind`-based switching

Replace every production `instanceof` check on AST classes with `kind`-based dispatch. Migrate file-by-file, running tests after each file to catch regressions early. Use exhaustive `switch` with `never` default where a union is fully dispatched.

**Tasks:**

#### AST internals (`relational-core`) — 26 checks

- [ ] **2.1** Migrate `rewriteComparable` and `foldComparable` helpers (dispatch on `ParamRef`, `LiteralExpr`, `ListLiteralExpr` vs `Expression` subclasses) in `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`
- [ ] **2.2** Migrate class methods: `JsonObjectExpr.rewrite`, `JsonObjectExpr.fold`, `ListLiteralExpr.rewrite`, `ListLiteralExpr.fold` in `types.ts`
- [ ] **2.3** Migrate class methods: `JoinAst.rewrite`, `SelectAst.rewrite`, `SelectAst.collectColumnRefs`, `SelectAst.collectParamRefs`, `SelectAst.collectRefs` in `types.ts`
- [ ] **2.4** Migrate `InsertAst.collectRefs` (including `addValue` / on-conflict helpers) and `UpdateAst.collectRefs` in `types.ts`
- [ ] **2.5** Migrate `getColumnInfo` in `packages/2-sql/4-lanes/relational-core/src/utils/guards.ts` (1 check: `OperationExpr`)
- [ ] **2.6** Run `@prisma-next/sql-relational-core` tests to verify

#### Postgres adapter — 40 checks

- [ ] **2.7** Migrate `PostgresAdapterImpl.lower` (top-level dispatch: `SelectAst` / `InsertAst` / `UpdateAst` / `DeleteAst`) in `packages/3-targets/6-adapters/postgres/src/core/adapter.ts`
- [ ] **2.8** Migrate `renderExpr`, `renderOperation`, `renderBinary`, `renderNullCheck`, `renderListLiteral`, `renderJsonObjectExpr` in `adapter.ts`
- [ ] **2.9** Migrate `renderSource`, `renderJoinOn`, `renderProjection` in `adapter.ts`
- [ ] **2.10** Migrate `renderInsertValue`, `renderInsert` (on-conflict block), `renderUpdate` in `adapter.ts`
- [ ] **2.11** Run postgres adapter tests to verify

#### SQL runtime lints — 6 checks

- [ ] **2.12** Migrate `isSqlQueryAst`, `getFromSourceTableDetail`, and `evaluateAstLints` in `packages/2-sql/5-runtime/src/plugins/lints.ts`
- [ ] **2.13** Run sql-runtime tests to verify

#### ORM client — 19 checks

- [ ] **2.14** Migrate `bindWhereExprNode`, `bindComparable`, `bindProjectionExpr`, `bindJoin`, `bindFromSource` in `packages/3-extensions/sql-orm-client/src/where-binding.ts` (12 checks)
- [ ] **2.15** Migrate `validateGroupedComparable`, `validateGroupedMetricExpr` in `packages/3-extensions/sql-orm-client/src/query-plan-aggregate.ts` (5 checks)
- [ ] **2.16** Migrate `isWhereExprInput` in `packages/3-extensions/sql-orm-client/src/collection.ts` (1 check)
- [ ] **2.17** Migrate `buildOrmQueryPlan` in `packages/3-extensions/sql-orm-client/src/query-plan-meta.ts` (1 check)
- [ ] **2.18** Run sql-orm-client tests to verify

#### Kysely lane — 17 checks

- [ ] **2.19** Migrate `transformKyselyToPnAst` / `transformKyselyToPnAstCollectingParams` in `packages/2-sql/4-lanes/kysely-lane/src/transform/transform.ts` (10 checks)
- [ ] **2.20** Migrate `transformJoinOn` in `packages/2-sql/4-lanes/kysely-lane/src/transform/transform-expr.ts` (4 checks)
- [ ] **2.21** Migrate `assertParamRef` in `packages/2-sql/4-lanes/kysely-lane/src/transform/transform-dml.ts` (1 check)
- [ ] **2.22** Migrate `buildKyselyWhereExpr` and `remapParamIndexes` in `packages/2-sql/4-lanes/kysely-lane/src/where-expr.ts` (2 checks)
- [ ] **2.23** Run kysely-lane tests to verify

#### SQL lane — 5 checks

- [ ] **2.24** Migrate `buildNullCheckExpr` and `buildWhereExpr` in `packages/2-sql/4-lanes/sql-lane/src/sql/predicate-builder.ts` (5 checks)
- [ ] **2.25** Run sql-lane tests to verify

### Milestone 3: Test migration, cleanup, and verification

Migrate test assertions from `instanceof` to `kind`, remove the obsolete warning comment, and run the full build + test suite.

**Tasks:**

- [ ] **3.1** Migrate `instanceof` assertions in `packages/3-extensions/sql-orm-client/test/rich-filters-and-where.test.ts`
- [ ] **3.2** Migrate `instanceof` assertions in `packages/3-extensions/sql-orm-client/test/integration/upsert.test.ts`
- [ ] **3.3** Migrate `instanceof` assertions in `packages/3-extensions/sql-orm-client/test/integration/include.test.ts`
- [ ] **3.4** Migrate `instanceof` assertions in `packages/3-extensions/sql-orm-client/test/integration/create.test.ts`
- [ ] **3.5** Migrate `instanceof` assertions in `packages/3-extensions/sql-orm-client/test/grouped-collection.test.ts`
- [ ] **3.6** Migrate `instanceof` assertions in `packages/2-sql/4-lanes/sql-lane/test/sql-includes.builder.basic.test.ts`
- [ ] **3.7** Add a test verifying structural dispatch works across module boundaries (simulating duplicate-package scenario) — FR-4.3
- [ ] **3.8** Remove the `instanceof` warning comment on `AstNode` (lines 197–200 of `types.ts`) — FR-3.1
- [ ] **3.9** Grep the codebase to confirm zero remaining `instanceof` on AST classes in production code (test files excluded from this check only if we decide to keep `instanceof` in tests)
- [ ] **3.10** Run `pnpm build` across all affected packages
- [ ] **3.11** Run `pnpm test:packages` — full suite pass
- [ ] **3.12** Run `pnpm lint:deps` — no layering violations

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| Every concrete AST class has `readonly kind` with unique literal type | Unit | 1.4 | Instantiate each class, assert `kind` |
| Abstract bases declare `abstract readonly kind: string` | Compile-time | 1.2 | Omitting `kind` from a concrete class is a TS error |
| Discriminated union types exported | Compile-time | 1.3 | Type-level: switch on union is exhaustive |
| All ~112 production `instanceof` replaced | Grep check | 3.9 | Automated grep for `instanceof <AstClass>` in `src/` |
| No production imports solely for `instanceof` | Manual / grep | 3.9 | Verify import usage post-migration |
| Multi-branch dispatch uses exhaustive `switch` | Compile-time + review | 2.1–2.25 | `never` default enforces exhaustiveness |
| Warning comment removed | Grep check | 3.8 | Verify lines 197–200 removed |
| All existing tests pass | CI | 3.11 | `pnpm test:packages` |
| Test assertions migrated to `kind` checks | Unit | 3.1–3.6 | Each test file updated |
| `pnpm build` succeeds | CI | 3.10 | Full build |
| `pnpm test:packages` passes | CI | 3.11 | Full test suite |
| No new linter errors | CI | 3.12 | `pnpm lint:deps` |
| Structural dispatch works across module boundaries | Unit | 3.7 | Simulates duplicate-package scenario |

## Open Items

Carried forward from spec:

1. **Tag naming convention** — Spec assumes kebab-case (`'column-ref'`, `'derived-table-source'`) to match existing discriminants in `guards.ts`. Confirm before starting Milestone 1.
2. **Union type naming** — Spec assumes `Any*` prefix (`AnyQueryAst`, `AnyExpression`). Confirm before starting Milestone 1.
3. **Type guard functions for abstract bases** — Some dispatch sites check `instanceof Expression` or `instanceof WhereExpr`. Spec assumes `kind`-in-union checks are sufficient without dedicated type guard functions. Revisit during Milestone 2 if ergonomics demand it.
4. **Test migration scope** — Spec assumes migrating test assertions too. Confirm before starting Milestone 3.
