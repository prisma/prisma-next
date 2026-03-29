# Code Review — Mongo Execution PoC (Milestone 1)

**Branch:** `mongo-planning`
**Base:** `origin/main`
**Scope:** Milestone 1 — execution pipeline implementation
**Spec:** [projects/mongo-execution-poc/spec.md](../spec.md)

---

## Summary

Milestone 1 introduces the Mongo execution pipeline across four packages under `packages/2-mongo/`. The implementation follows established repo conventions and achieves its goal of proving the pipeline works end-to-end. All review feedback has been addressed. No blocking issues remain.

## What looks solid

- **`kind` discriminants and exhaustive `switch` dispatch.** Both command hierarchies use `readonly kind = '...' as const` discriminants, abstract base classes are module-private, union types (`AnyMongoCommand`, `AnyMongoWireCommand`) are exported. Dispatch in adapter and driver uses exhaustive `switch` with `never` checks.
- **Explicit mutation result types.** `InsertOneResult`, `UpdateOneResult`, `DeleteOneResult` defined in `results.ts` and used by the driver's per-operation execute functions.
- **Dependency inversion.** `MongoAdapter` and `MongoDriver` interfaces live in `1-core`. `5-runtime` depends only on `1-core` at the production level; adapter and driver are `devDependencies` for tests.
- **`exports/` convention.** All four packages curate public API through `exports/index.ts` with tsdown entry points matching. No redundant `src/index.ts` barrel files.
- **Class-based implementations.** `MongoAdapterImpl`, `MongoDriverImpl`, `MongoRuntimeImpl` with private fields. All utility functions are `#private` methods on their owning class.
- **Scoped test helper.** `withMongod()` replaces module-scoped setup; tests explicitly opt in with a clean context object.
- **Driver unit tests added.** `7-driver/test/mongo-driver.test.ts` covers all five operation types + close, with real thresholds (90/85/100/90).
- **Coverage thresholds.** `6-adapter`: 90/90/100/90. `5-runtime`: 100/100/100/100. `7-driver`: 90/85/100/90. `1-core`: 0 (types-only, appropriate).
- **Generic `spinUpDbServer` timeout.** Shared test-utils now has a database-agnostic timeout used by both Mongo packages.
- **Adapter tests use `kind`-based narrowing.** `narrowWire()` helper asserts `kind` and narrows the union type — no more `instanceof` in test assertions.
- **Immutability via `Object.freeze()`.** All commands freeze in constructor.
- **`RawPipeline` and `MongoUpdateDocument` type aliases.** Named types signal intent.
- **Value types cleanly separated.** `values.ts` has the Mongo value system; `param-ref.ts` has only `MongoParamRef`.

---

## Blocking issues

None.

---

## Non-blocking concerns

### F01 — `as Row` casts remain for mutation results in driver dispatch

**Location:** [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — lines 73–77

**Issue:** The per-operation execute functions return typed results, but `execute()` casts mutation iterables back to `AsyncIterable<Row>` because the interface returns `AsyncIterable<Row>` for all command types. The cast is isolated and the underlying functions are correctly typed.

**Suggestion:** Acceptable for M1. Revisit when the driver interface is refined (e.g. discriminated return type or overloads that split read vs. write results).

### F02 — `sort` type cast in driver

**Location:** [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — line 17

**Issue:** `cmd.sort as Sort` — papers over a minor type mismatch between `Document` and the `mongodb` driver's `Sort`. Unlikely to cause issues.

### F03 — Driver doesn't handle connection failure gracefully

**Location:** [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — lines 92–96

**Issue:** Connection errors propagate as unstructured rejections. Defer to when Mongo error codes are defined.

### F04 — Driver test uses module-scoped `beforeAll`/`afterAll` for `mongodb-memory-server`

**Location:** [packages/2-mongo/7-driver/test/mongo-driver.test.ts](packages/2-mongo/7-driver/test/mongo-driver.test.ts) — lines 13–30

**Issue:** The driver tests use module-scoped `beforeAll`/`afterAll` for the replica set lifecycle, while the runtime tests use the scoped `withMongod()` pattern. This inconsistency is understandable — the driver tests create individual driver instances per test (with `try/finally` for cleanup), so a shared replica set avoids starting/stopping `mongod` for each test. But it doesn't follow the `withMongod()` pattern established for the runtime tests.

**Suggestion:** Low priority. The per-test `try/finally` pattern with a shared `mongod` is reasonable for driver-level tests. Consider extracting a shared `withReplSet()` helper if more test files adopt this pattern.

---

## Nits

None.

---

## Acceptance-criteria traceability

### Execution pipeline

| Acceptance criterion | Implementation | Evidence |
|---|---|---|
| `find` executes and returns correct rows | [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — `executeFindCommand()` | [packages/2-mongo/5-runtime/test/find.test.ts](packages/2-mongo/5-runtime/test/find.test.ts) — 4 integration tests; [packages/2-mongo/7-driver/test/mongo-driver.test.ts](packages/2-mongo/7-driver/test/mongo-driver.test.ts) — 2 driver unit tests |
| `insertOne` executes and returns inserted ID | [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — `executeInsertOneCommand()` | [packages/2-mongo/5-runtime/test/insert.test.ts](packages/2-mongo/5-runtime/test/insert.test.ts); [packages/2-mongo/7-driver/test/mongo-driver.test.ts](packages/2-mongo/7-driver/test/mongo-driver.test.ts) |
| `updateOne` executes and returns matched/modified counts | [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — `executeUpdateOneCommand()` | [packages/2-mongo/5-runtime/test/update.test.ts](packages/2-mongo/5-runtime/test/update.test.ts); [packages/2-mongo/7-driver/test/mongo-driver.test.ts](packages/2-mongo/7-driver/test/mongo-driver.test.ts) |
| `deleteOne` executes and returns deleted count | [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — `executeDeleteOneCommand()` | [packages/2-mongo/5-runtime/test/delete.test.ts](packages/2-mongo/5-runtime/test/delete.test.ts); [packages/2-mongo/7-driver/test/mongo-driver.test.ts](packages/2-mongo/7-driver/test/mongo-driver.test.ts) |
| `aggregate` executes and returns results | [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — `executeAggregateCommand()` | [packages/2-mongo/5-runtime/test/aggregate.test.ts](packages/2-mongo/5-runtime/test/aggregate.test.ts); [packages/2-mongo/7-driver/test/mongo-driver.test.ts](packages/2-mongo/7-driver/test/mongo-driver.test.ts) |
| Driver dispatches to correct method per operation | [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — `execute()` switch | All driver unit tests + integration tests |

### Architecture

| Acceptance criterion | Implementation | Evidence |
|---|---|---|
| No imports from `2-sql/*` or `3-extensions/*` | [architecture.config.json](architecture.config.json) — `mongo.mayImportFrom: ["framework"]` | Needs `pnpm lint:deps` verification |
| `PlanMeta` is reused | [packages/2-mongo/1-core/src/plan.ts](packages/2-mongo/1-core/src/plan.ts) — imports `PlanMeta` from `@prisma-next/contract/types` | Compile-time + runtime test stubs |
| Dependency direction is correct | [packages/2-mongo/5-runtime/package.json](packages/2-mongo/5-runtime/package.json) — production deps: `mongo-core`, `contract`, `runtime-executor` only | Interfaces in `1-core`; concretions are `devDependencies` |
