# Code Review (re-review after fixes, round 3)

**Branch:** `tml-2189-ws4-2-orm-consolidation-shared-collection-interface-with`
**Base:** `origin/main`
**Spec:** [projects/orm-consolidation/spec.md](../spec.md)

## Summary

Phase 1 of the ORM consolidation: replaces the Mongo ORM's options-bag API with a fluent chaining `MongoCollection` class, backed by a new typed query AST (`@prisma-next/mongo-query-ast`). All blocking issues have been resolved.

**All blocking issues resolved.**

## What looks solid

- **AST design quality.** Immutable frozen nodes, visitor/rewriter pattern, static factory methods, discriminated union exports with hidden abstract bases. Mirrors the SQL AST.
- **Immutable chaining.** Every chaining method creates a new instance. `#createSelf` preserves custom subclasses. Tested explicitly.
- **Type safety at the API boundary.** `all()`/`first()` return `InferRootRow<TContract, ModelName>`. `include()` constrains to `ReferenceRelationKeys`. `select()` and `orderBy()` constrain to model field keys. Type-level tests verify all constraints including chained method chains. `where()` input remains untyped (deferred to `MongoModelAccessor`).
- **Chained type tests.** Type tests now verify that row types survive through full chains: `where().select().all()`, `include().first()`, `where().orderBy().skip().take().all()`, and that constraints are preserved after chaining.
- **Test coverage.** Unit tests, type-level tests (including chained result types), compilation tests, lowering tests (including `$nor`, `isNull`/`isNotNull`), and 11 integration tests against `mongodb-memory-server`. Codec trait extraction tested via `codecs.test-d.ts`.
- **Clean layering.** Runtime dispatches through the adapter interface (`MongoAdapter.lowerReadPlan()` defined in `mongo-core`). Lowering functions (`lowerPipeline`, `lowerFilter`, `lowerStage`) live in the adapter, where they belong. `resolveValue` is a local utility in the adapter.
- **Legacy cleanup.** All dead code deleted. Runtime accepts `MongoReadPlan` directly.
- **ADR 183.** Clear, focused. Subsystem docs and planning docs updated.
- **Compilation stage ordering.** Correct and tested: `$match → $lookup/$unwind → $sort → $skip → $limit → $project`.
- **`resolveValue` local to adapter.** Moved from `mongo-core` shared export to adapter-internal utility, since only lowering uses it.
- **`select()` accumulates.** Multiple `.select()` calls accumulate fields, consistent with `.where()` and `.orderBy()`. Tested.
- **`storageHash` from contract.** `compileMongoQuery` receives the hash from the contract, not a hardcoded stub.
- **Phantom type uses branded symbol.** `MongoReadPlan` uses `declare const __mongoReadPlanRow: unique symbol` — no collision risk.
- **Shared typed contract fixture.** Unit tests import from `orm-contract.d.ts` / `orm-contract.json`, using the codebase's standard type parameter pattern.
- **Extensibility proof is real.** `mongoVectorCodec` has `traits: ['equality', 'vector']` in production. `mongoVectorNearOperation` is defined in production code (`operations.ts`), exported, and tests verify it registers and looks up correctly.
- **End-to-end type flow in demo.** `types.ts` deleted. `server.ts` exports query functions; response types derived via `ReturnType`. `App.tsx` imports these types directly — no manual type construction, no `as` casts. Types flow transparently from contract through ORM to React components.

---

## Resolved blocking issues

| Finding | Resolution |
|---|---|
| **F01** — `$not` lowering produces invalid MongoDB syntax | Fixed: lowers to `{ $nor: [...] }`. Unit + integration test. |
| **F05** — Codec trait type-level extraction untested | Fixed: `codecs.test-d.ts` added with tests for single, multi, and vector traits. |
| **F06** — `select()` silently drops previous selections | Fixed: `select()` now accumulates via spread. Unit test added. |
| **F07** — `stubMeta` hardcodes plan metadata | Fixed: `compileMongoQuery` takes `storageHash` from the contract. Compilation test verifies. |
| **F11** — `_row` phantom type collides with document fields | Fixed: uses `declare const __mongoReadPlanRow: unique symbol`. |
| **F13** — Dead legacy `MongoQueryPlan` / `FindCommand` | Fixed: all deleted. Runtime accepts `MongoReadPlan` directly. |
| **F14** — Runtime bypasses adapter for lowering | Fixed: `MongoAdapter` interface in `mongo-core` now has `lowerReadPlan()`. Runtime calls `this.#adapter.lowerReadPlan(plan)`. Adapter imports `lowerPipeline` from `mongo-query-ast`. |
| **F15** — Extensibility proof is fake | Fixed: `mongoVectorCodec` has `traits: ['equality', 'vector']` in production. `mongoVectorNearOperation` defined in production code and exported. Tests verify registration. |
| **F16** — Integration tests don't exercise negative paths | Fixed: tests for negation, ordering, pagination, selection. |
| **F17** — Type utilities disconnected from collection API | Fixed: `all()`/`first()` return `InferRootRow`, `include()` constrains to `ReferenceRelationKeys`, `select()`/`orderBy()` constrain to model field keys. |
| **F18** — `include()` crashes on embed relations | Fixed: runtime guard + compile-time constraint. Unit test. |
| **F19** — Lowering in wrong package per design doc | Resolved via F25: lowering functions moved to adapter. |
| **F21** — Demo types misleading | Fixed: `types.ts` deleted. `server.ts` exports query functions; response types derived via `ReturnType`. `App.tsx` uses them directly — no casts, no manual types. |
| **F22** — Unit test fixture erases type info | Fixed: shared typed contract fixture (`orm-contract.d.ts` + `orm-contract.json`) using the standard type parameter pattern. |
| **F23** — No type tests for chained result types | Fixed: 4 chaining type tests added — `where().select().all()`, `include().first()`, `where().orderBy().skip().take().all()`, and constraint preservation after chaining. |

---

## Blocking issues

None remaining.

---

## Acceptance-criteria traceability

### Phase 1 criteria from [spec.md](../spec.md)

| # | Acceptance criterion | Status | Implementation | Evidence |
|---|---|---|---|---|
| 1 | `MongoCollection` with fluent chaining | ✅ Met | [collection.ts](../../../packages/2-mongo-family/4-orm/src/collection.ts) | [collection.test.ts](../../../packages/2-mongo-family/4-orm/test/collection.test.ts) |
| 2 | Immutable chaining | ✅ Met | [collection.ts](../../../packages/2-mongo-family/4-orm/src/collection.ts) — `#clone()` pattern | [collection.test.ts](../../../packages/2-mongo-family/4-orm/test/collection.test.ts) — "does not mutate original instance" |
| 3 | `.where()` callback + shorthand | ⚠️ Partial | Callback overload removed (deferred to `MongoModelAccessor`). Object-literal shorthand not implemented. `where()` accepts `MongoFilterExpr` only. | Spec criterion partially deferred |
| 4 | `MongoModelAccessor` with comparison methods | ❌ Deferred | Not implemented — raw filter expressions used instead | Codec traits exist but accessor not built |
| 5 | `.select()` → `MongoProjectStage` | ✅ Met | [compile.ts](../../../packages/2-mongo-family/4-orm/src/compile.ts). Type-constrained. Accumulates across calls. | [compile.test.ts](../../../packages/2-mongo-family/4-orm/test/compile.test.ts), [orm-types.test-d.ts](../../../packages/2-mongo-family/4-orm/test/orm-types.test-d.ts) |
| 6 | `.orderBy()` → `MongoSortStage` | ✅ Met | [compile.ts](../../../packages/2-mongo-family/4-orm/src/compile.ts). Type-constrained. | [compile.test.ts](../../../packages/2-mongo-family/4-orm/test/compile.test.ts), [orm-types.test-d.ts](../../../packages/2-mongo-family/4-orm/test/orm-types.test-d.ts) |
| 7 | `.take()` → `MongoLimitStage`, `.skip()` → `MongoSkipStage` | ✅ Met | [compile.ts](../../../packages/2-mongo-family/4-orm/src/compile.ts) | [compile.test.ts](../../../packages/2-mongo-family/4-orm/test/compile.test.ts), [orm.test.ts](../../../test/integration/test/mongo/orm.test.ts) |
| 8 | All reads via `AggregateCommand` (ADR 183) | ✅ Met | [mongo-runtime.ts](../../../packages/2-mongo-family/5-runtime/src/mongo-runtime.ts) — dispatches through adapter | [orm.test.ts](../../../test/integration/test/mongo/orm.test.ts) — "full flow" test |
| 9 | `.include()` → `$lookup` + `$unwind` | ✅ Met | [compile.ts](../../../packages/2-mongo-family/4-orm/src/compile.ts) — `compileIncludes`. Type-constrained to `ReferenceRelationKeys`, runtime guard. | [compile.test.ts](../../../packages/2-mongo-family/4-orm/test/compile.test.ts), [collection.test.ts](../../../packages/2-mongo-family/4-orm/test/collection.test.ts), [orm.test.ts](../../../test/integration/test/mongo/orm.test.ts) |
| 10 | `.first()` returns `T \| null` | ✅ Met | Returns `Promise<InferRootRow<TContract, ModelName> \| null>` | [orm-types.test-d.ts](../../../packages/2-mongo-family/4-orm/test/orm-types.test-d.ts) |
| 11 | `mongoOrm()` returns `MongoCollection` instances | ✅ Met | [mongo-orm.ts](../../../packages/2-mongo-family/4-orm/src/mongo-orm.ts) | [orm-types.test-d.ts](../../../packages/2-mongo-family/4-orm/test/orm-types.test-d.ts) |
| 12 | Mongo demo uses chaining API | ✅ Met | [server.ts](../../../examples/mongo-demo/src/server.ts), [blog.test.ts](../../../examples/mongo-demo/test/blog.test.ts) | Demo tests pass |
| 13 | Unit tests for chaining, compilation, where DSL | ✅ Met | Unit tests, type-level tests (including chaining), compilation, lowering. | ~800+ lines of unit + type tests |
| 14 | Integration tests against mongodb-memory-server | ✅ Met | [orm.test.ts](../../../test/integration/test/mongo/orm.test.ts) — 11 integration tests | Tests pass against `mongodb-memory-server` |

**Overall:** 12/14 fully met, 1 partial (callback where deferred), 1 deferred (ModelAccessor).

---

## Resolved blocking issues (continued)

| Finding | Resolution |
|---|---|
| **F24** — Constructor leaks internal state into public API | Fixed: `MongoCollectionInit` removed. Constructor takes only `(contract, modelName, executor)`. State is fully private (`#state`). `#createSelf` sets state on new instances via private field access. `MongoCollectionState` and `emptyCollectionState` removed from public exports. |
| **F25** — Lowering functions must not live in the AST package | Fixed: `lowerPipeline`, `lowerFilter`, `lowerStage` moved from `mongo-query-ast` to `mongo-adapter`. `resolveValue` moved from `mongo-core` shared export to adapter-local utility. ORM tests updated to assert on AST stage types instead of lowered wire format. |
