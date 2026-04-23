# Middleware Rewriteable AST — Plan

## Summary

Add a SQL-family `beforeCompile` hook that lets middlewares rewrite the query AST between lane `.build()` and `adapter.lower()`. Chain runs in registration order inside `SqlRuntimeImpl.toExecutionPlan()`; lowering happens exactly once after the chain; each rewrite is logged by middleware `name`. Ships the first capability of Linear TML-2143 ahead of the caching milestone.

**Spec:** `projects/middleware-rewriteable-ast/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Serhii Tatarintsev | Drives design + execution |
| Stakeholder | Alexey Orlenko | Author of TML-2143; caching milestone downstream depends on this |
| Team | Terminal (Linear team) | Owner of WS3: Runtime pipeline |

## Milestones

### Milestone 1: Working pipeline end-to-end

Deliver the hook, the runtime chain, and rewrite logging such that a hand-written middleware can rewrite a `SelectAst` and see the change reflected in the final SQL. Validated by a single soft-delete integration test that exercises the full path.

**Tasks:**

- [ ] Verify `AnyQueryAst` is already exported from `@prisma-next/sql-relational-core/ast` public entry; if not, expose it.
- [ ] Define `DraftPlan` type in `packages/2-sql/5-runtime/src/middleware/` — `{ readonly ast: AnyQueryAst; readonly meta: PlanMeta }`. Export from the SQL runtime package's public entry.
- [ ] Add optional `beforeCompile?(draft: DraftPlan, ctx: SqlMiddlewareContext): Promise<DraftPlan | void>` to `SqlMiddleware` in `packages/2-sql/5-runtime/src/middleware/sql-middleware.ts`.
- [ ] Locate the lowering call site in `packages/2-sql/5-runtime/src/sql-runtime.ts` (around line 147). Insert a `runBeforeCompileChain(middlewares, draft, ctx)` helper call on the pre-lowering `SqlQueryPlan` before `lowerSqlPlan()`.
- [ ] Add optional `debug?(event: unknown): void` method to `RuntimeLog` in `packages/1-framework/1-core/framework-components/src/runtime-middleware.ts`. Additive; existing implementations remain compatible.
- [ ] Implement the chain iterator: sequential `await mw.beforeCompile?.(draft, ctx)`; if return is not `undefined` and `next.ast !== draft.ast`, replace `draft` with `next` and emit `ctx.log.debug?.({ event: 'middleware.rewrite', middleware: mw.name, lane: draft.meta.lane })`; otherwise continue.
- [ ] Surface errors thrown inside `beforeCompile` through the existing `runtimeError` envelope path (no try/catch in the chain; let them propagate to the caller).
- [ ] Write a soft-delete demonstration middleware under `packages/2-sql/5-runtime/test/` that injects `WHERE deleted_at IS NULL` into a `SelectAst` via `AstRewriter` / `SelectAst.withWhere()` + `BinaryExpr.eq(ColumnRef.of('deleted_at'), Literal.null_())`.
- [ ] End-to-end integration test: register the soft-delete middleware on a `SqlRuntimeImpl`, build a `SELECT * FROM users`, execute, assert lowered SQL contains `deleted_at IS NULL`, assert contract verification passed on post-rewrite plan.

### Milestone 2: Test coverage, docs, close-out

Complete coverage for every acceptance criterion, publish the middleware-authoring guide update, and close out the project workspace.

**Tasks:**

- [ ] Unit test: two middlewares chained; both rewrites appear in final SQL; order matches registration.
- [ ] Unit test: middleware returns `void` → draft reaches lowering unchanged; no log event emitted.
- [ ] Unit test: middleware returns `{ ...draft }` with unchanged `ast` ref → treated as passthrough; no log event emitted.
- [ ] Unit test: raw-SQL plan (no AST) bypasses `beforeCompile`; hook is not invoked; no log event emitted.
- [ ] Unit test: log fidelity — each rewrite produces exactly one event with correct `middleware` name and `lane`.
- [ ] Unit test: error propagation — throwing `runtimeError('...')` inside `beforeCompile` surfaces to the caller with the same envelope shape; no silent swallow; no intermediate draft leakage.
- [ ] Unit test: `adapter.lower()` invoked exactly once per execute regardless of chain length (spy on the adapter).
- [ ] Integration test: final lowered plan's `meta.refs` reflects post-rewrite AST (e.g. middleware adds a join to a new table; refs includes that table).
- [ ] Integration test: middleware produces an AST referencing a table not in the contract → contract verification during lowering rejects with standard `runtimeError`; confirm no special middleware-pointing diagnostic is required.
- [ ] Compile-time check: verify existing `SqlMiddleware` implementations (`lints`, `budgets`, `createTelemetryMiddleware`) compile unchanged with the new optional hook.
- [ ] Compile-time check: verify `RuntimeMiddleware` (in `framework-components`) and `RuntimeCoreImpl` source files are untouched by the diff.
- [ ] Docs: update `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md` — add a "Rewriting ASTs" subsection covering `beforeCompile` signature, passthrough semantics, chain ordering, `AstRewriter` + `SelectAst.with*` example pattern, soft-delete worked example, and an explicit SQL-injection warning about `Literal(userInput)`.
- [ ] Docs: add TSDoc to `beforeCompile` signature in `sql-middleware.ts` — brief summary + link to the subsystem doc section; include the SQL-injection warning as an admonition.
- [ ] Close-out: verify every acceptance criterion ticks (use the Test Coverage table below).
- [ ] Close-out: grep repo for `projects/middleware-rewriteable-ast` references; replace with canonical `docs/` links or remove.
- [ ] Close-out: delete `projects/middleware-rewriteable-ast/` in a final PR.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| `beforeCompile` declared on `SqlMiddleware` | Compile-time | M1 (hook addition) | Type test + existing test suite compiles |
| `DraftPlan` exported with `ast: AnyQueryAst`, `meta: PlanMeta` | Compile-time | M1 (type def) | Verified via public export test |
| No modifications to `RuntimeMiddleware` | Compile-time / review | M2 (source check) | Git diff check in PR |
| No modifications to `RuntimeCoreImpl` | Compile-time / review | M2 (source check) | Git diff check in PR |
| Existing `SqlMiddleware` impls compile unchanged | Unit / CI | M2 | Existing `lints`, `budgets` tests pass |
| Chain iteration runs inside `SqlRuntimeImpl` before `lowerSqlPlan()` | Unit | M2 (adapter-spy) | Spy on lowerer; assert chain completed before |
| Middlewares called in registration order | Unit | M2 (chaining test) | Two-middleware chain, assert both rewrites + order |
| `void` leaves draft unchanged, emits no log | Unit | M2 (passthrough void) | Log spy asserts zero events |
| Same-`ast` ref return treated as passthrough | Unit | M2 (passthrough same-ref) | Log spy asserts zero events |
| New `ast` ref replaces current draft | Unit | M1 (soft-delete e2e) + M2 (chaining) | Rewritten SQL reflects change |
| `adapter.lower()` invoked exactly once per query | Unit | M2 (lowerer spy) | Works for 0-rewrite and N-rewrite chains |
| Final lowered plan's `meta.refs` reflects post-rewrite AST | Integration | M2 (refs test) | Middleware adds new table ref; assert on final plan |
| Contract verification runs on final lowered plan | Integration | M2 (invalid-ast test) | Middleware references unknown table; expect contract-verification error |
| Each rewrite emits `{ event: 'middleware.rewrite', middleware, lane }` | Unit | M2 (log fidelity) | Log spy |
| Log level is `debug` | Unit | M2 (log fidelity) | `RuntimeLog.debug` added in M1 |
| No log event for passthrough | Unit | M2 (passthrough tests) | Log spy asserts zero events |
| Soft-delete rewrite reflected in final SQL | Integration | M1 (e2e) | Deliverable proof for M1 |
| Two chained middlewares both appear in final SQL | Unit/Integration | M2 (chaining test) | |
| Raw-SQL plans bypass `beforeCompile` | Unit | M2 (raw-sql bypass) | Hook not invoked |
| Log event per rewrite with correct name + lane | Unit | M2 (log fidelity) | Covered above |
| Error propagation via `runtimeError` envelope | Unit | M2 (error-propagation) | Throwing middleware |

## Open Items

1. **Spec NFR1 reconciliation (FYI).** Spec NFR1 says "no change to `RuntimeMiddleware`, `RuntimeCoreImpl`, or generic middleware plumbing." This plan adds `debug?` to `RuntimeLog` (in `framework-components`) — strictly an additive SPI extension, and it leaves the `RuntimeMiddleware` interface itself untouched (AC row in Test Coverage still holds). Worth tightening spec NFR1 in a follow-up to say "no modifications to `RuntimeMiddleware` interface; additive `RuntimeLog` extensions permitted" — but it's a wording cleanup, not a blocker.

2. **Mongo parity signal.** Mongo-family middleware uses the same `RuntimeMiddleware` SPI. With `RuntimeLog.debug` added, Mongo-family implementations get the method available for free. Not a blocker; flag to Mongo owners when the change lands.
