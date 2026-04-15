# Cross-Family Runtime & Middleware SPI

## Summary

Extract family-agnostic runtime executor and middleware SPIs from the two concrete runtimes (SQL and Mongo), rename "plugin" to "middleware" across production code, wire middleware lifecycle into `MongoRuntime`, and prove the architecture with a single generic middleware running in both families. This satisfies the April milestone WS4 stop condition: "A middleware operates across both families without family-specific code."

**Spec:** `projects/cross-family-middleware-spi/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution |
| Collaborator | Alexey (WS3) | Runtime pipeline owner; VP4 middleware interception work must align with the SPI shape |

## Milestones

### Milestone 1: Framework SPIs + rename

Defines the framework-level interfaces (`RuntimeExecutor`, `RuntimeMiddleware`, `RuntimeMiddlewareContext`) and renames all existing `Plugin`/`PluginContext`/`plugins` references to the new names. After this milestone, the framework has the canonical SPI types and all existing production code uses the "middleware" terminology.

**Tasks:**

- [x] **1.1 Define `RuntimeExecutor<TPlan>` interface.** Add to `@prisma-next/framework-components`. Parameterized on `TPlan extends { readonly meta: PlanMeta }`. Methods: `execute<Row>(plan: TPlan): AsyncIterableResult<Row>`, `close(): Promise<void>`. Write type tests verifying both `ExecutionPlan` and `MongoQueryPlan` satisfy the constraint.
- [x] **1.2 Define `RuntimeMiddleware` and `RuntimeMiddlewareContext` interfaces.** Add to `@prisma-next/framework-components`. `RuntimeMiddleware` carries `name`, optional `familyId`/`targetId`, and lifecycle hooks (`beforeExecute`, `onRow`, `afterExecute`) with the plan typed as `{ readonly meta: PlanMeta }`. `RuntimeMiddlewareContext` carries `contract: unknown`, `mode`, `log`, `now` (no adapter/driver — those are family-specific). Write type tests.
- [x] **1.3 Define `checkMiddlewareCompatibility` validation function.** Add to `@prisma-next/framework-components`. Validates a middleware's `familyId`/`targetId` against a runtime's family/target. Throws on incompatibility with a clear error message naming the middleware and the mismatch. Simple function — does not use the `TargetBoundComponentDescriptor` pattern. Write unit tests: generic middleware passes all runtimes, family-matched passes, family-mismatched fails with clear message, `targetId` without `familyId` fails.
- [x] **1.4 Rename `Plugin` → `RuntimeMiddleware` in framework layer.** Rename in `plugins/types.ts` (or move to new file), update `runtime-core.ts` (`RuntimeCoreOptions.plugins` → `.middleware`, internal references), update `exports/index.ts`. Rename `PluginContext` → `RuntimeMiddlewareContext`. Update `mock-family.test.ts` to use new names. Verify all existing tests pass.
- [x] **1.5 Rename `Plugin` → `RuntimeMiddleware` in SQL runtime.** Update `sql-runtime.ts` (`RuntimeOptions.plugins` → `.middleware`, `CreateRuntimeOptions.plugins` → `.middleware`), update `budgets.ts` and `lints.ts` imports and return types, update `exports/index.ts`. Update `lints.test.ts` and `budgets.test.ts` to use new names. Verify all existing tests pass.
- [x] **1.6 Rename `plugins` → `middleware` in facade packages.** Update `packages/3-extensions/postgres/src/runtime/postgres.ts` and `packages/3-extensions/sqlite/src/runtime/sqlite.ts`. Verify all existing tests pass.
- [x] **1.7 Make `RuntimeCore` extend `RuntimeExecutor<ExecutionPlan>`.** Update the `RuntimeCore` interface in `runtime-core.ts` to extend `RuntimeExecutor<ExecutionPlan>`. Verify structural compatibility (existing `execute` and `close` methods already satisfy it). Verify all existing tests pass.

### Milestone 2: Family-specific interfaces + Mongo middleware lifecycle

Defines `SqlMiddleware` and `MongoMiddleware`, wires middleware lifecycle into `MongoRuntime`, migrates existing SQL middleware to use `SqlMiddleware`, and makes `MongoRuntime` extend `RuntimeExecutor`.

**Tasks:**

- [x] **2.1 Define `SqlMiddleware` interface.** Add to `@prisma-next/sql-runtime`. Extends `RuntimeMiddleware` with `familyId: 'sql'`, narrowed plan type (`ExecutionPlan`), narrowed context type (SQL adapter/driver via `SqlMiddlewareContext`). Write type tests.
- [x] **2.2 Migrate `budgets` and `lints` to `SqlMiddleware`.** Update both middleware to implement `SqlMiddleware` (add `familyId: 'sql'`). Verify existing consumer APIs (`budgets()`, `lints()`) continue to work. Verify all existing tests pass (tests already renamed in 1.5).
- [x] **2.3 Add compatibility validation to SQL runtime construction.** Call `checkMiddlewareCompatibility` in `createRuntime` / `SqlRuntimeImpl` constructor for each provided middleware against `familyId: 'sql'` and the target's `targetId`. Write tests: generic middleware accepted, `SqlMiddleware` accepted, `MongoMiddleware` rejected with clear error.
- [x] **2.4 Define `MongoMiddleware` interface.** Add to `@prisma-next/mongo-family-runtime` (or the appropriate Mongo runtime package). Extends `RuntimeMiddleware` with `familyId: 'mongo'`, narrowed plan type (`MongoQueryPlan`), narrowed context type (Mongo adapter/driver via `MongoMiddlewareContext`). Write type tests.
- [x] **2.5 Add middleware lifecycle to `MongoRuntime`.** Update `MongoRuntimeOptions` to accept optional `middleware: readonly RuntimeMiddleware[]`. Wrap execution in `execute()` with `beforeExecute` → `onRow` → `afterExecute` lifecycle, mirroring `RuntimeCoreImpl.#executeWith`. Handle errors (call `afterExecute` with `completed: false`, rethrow). Write unit tests: middleware hooks called in correct order, error handling works, no middleware = no-op.
- [x] **2.6 Add compatibility validation to Mongo runtime construction.** Call `checkMiddlewareCompatibility` in `createMongoRuntime` for each provided middleware against `familyId: 'mongo'`. Write tests: generic middleware accepted, `MongoMiddleware` accepted, `SqlMiddleware` rejected with clear error.
- [x] **2.7 Make `MongoRuntime` extend `RuntimeExecutor<MongoQueryPlan>`.** Update the `MongoRuntime` interface to extend `RuntimeExecutor<MongoQueryPlan>`. Verify structural compatibility. Verify all existing tests pass.

### Milestone 3: Cross-family proof

Proves the architecture with a generic middleware running across both families, satisfying the April milestone stop condition.

**Tasks:**

- [x] **3.1 Implement a generic telemetry/logging middleware.** Written against `RuntimeMiddleware` (no `familyId`). Records `meta.lane`, `meta.target`, `meta.storageHash` from `beforeExecute`, and `rowCount`/`latencyMs` from `afterExecute`. Lives in `@prisma-next/runtime-executor` (or a test utility).
- [x] **3.2 Integration test: same middleware, both runtimes.** Create a test that instantiates both a SQL runtime (mock or real) and a Mongo runtime (mock or real) with the same generic middleware instance. Execute a query through each. Verify the middleware was called in both cases with correct plan metadata. Verify no family-specific plan fields are accessed.
- [x] **3.3 Update mock-family test.** Update the existing `mock-family.test.ts` to use `RuntimeMiddleware` and `middleware` naming. Verify it continues to demonstrate family-agnostic middleware operation.

### Close-out

- [x] **C.1 Verify all acceptance criteria in `projects/cross-family-middleware-spi/spec.md`.**
- [x] **C.2 Update Runtime & Plugin Framework subsystem doc** (`docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`): rename "plugin" to "middleware" throughout, document the `RuntimeExecutor` SPI, document `RuntimeMiddleware`/`SqlMiddleware`/`MongoMiddleware` hierarchy, document compatibility validation.
- [ ] **C.3 Strip repo-wide references to `projects/cross-family-middleware-spi/**`.** Replace with canonical `docs/` links or remove. *(Close-out happens after merge.)*
- [ ] **C.4 Delete `projects/cross-family-middleware-spi/`.** *(Close-out happens after merge.)*

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| `RuntimeExecutor<TPlan>` interface exists with `execute` and `close` | Type test | 1.1 | Verify both plan types satisfy constraint |
| `TPlan` constraint is `{ readonly meta: PlanMeta }` | Type test | 1.1 | Negative test: type without `meta` fails |
| `RuntimeCore` extends `RuntimeExecutor<ExecutionPlan>` | Type test + regression | 1.7 | Existing tests pass |
| `MongoRuntime` extends `RuntimeExecutor<MongoQueryPlan>` | Type test + regression | 2.7 | Existing tests pass |
| Both return `AsyncIterableResult<Row>` from `execute` | Type test | 1.1, 1.7, 2.7 | Structural compatibility |
| `RuntimeMiddleware` interface exists at framework level | Type test | 1.2 | Interface shape tests |
| `RuntimeMiddlewareContext` interface exists at framework level | Type test | 1.2 | Interface shape tests |
| `RuntimeMiddleware` uses plan base type with `meta: PlanMeta` | Type test | 1.2 | Both plan types assignable |
| `RuntimeMiddleware` carries optional `familyId`/`targetId` | Type test | 1.2 | Binding metadata present |
| `SqlMiddleware` extends `RuntimeMiddleware` with `familyId: 'sql'` | Type test | 2.1 | Narrowed plan/context types |
| `MongoMiddleware` extends `RuntimeMiddleware` with `familyId: 'mongo'` | Type test | 2.4 | Narrowed plan/context types |
| Runtime construction validates middleware compatibility | Unit test | 1.3, 2.3, 2.6 | Match, mismatch, generic cases |
| Mismatched `familyId` produces clear error | Unit test | 1.3, 2.3, 2.6 | Error message includes names |
| Generic middleware pass validation for any runtime | Unit test | 1.3, 2.3, 2.6 | No `familyId` = compatible |
| `MongoRuntime` accepts optional `middleware` | Unit test | 2.5 | Construction with/without |
| `MongoRuntime` calls `beforeExecute`, `onRow`, `afterExecute` | Unit test | 2.5 | Lifecycle order verification |
| Mongo middleware handles errors correctly | Unit test | 2.5 | `completed: false`, rethrow |
| `Plugin` renamed to `RuntimeMiddleware` in all code (prod + tests) | Regression | 1.4, 1.5, 1.6 | All existing tests pass |
| `PluginContext` renamed to `RuntimeMiddlewareContext` in all code | Regression | 1.4, 1.5 | All existing tests pass |
| `plugins` option renamed to `middleware` in all code | Regression | 1.4, 1.5, 1.6 | All existing tests pass |
| Existing `budgets`/`lints` work without consumer API changes | Regression | 2.2 | Factory API unchanged |
| Generic middleware runs in both runtimes | Integration | 3.2 | Same instance, both families |
| Integration test verifies middleware observes both families | Integration | 3.2 | Correct plan metadata |
| Generic middleware uses only `PlanMeta`/`AfterExecuteResult` | Integration | 3.2 | No family-specific fields |

## Open Items

- **Coordination with Alexey on VP4 timing.** If VP4 (middleware interception) lands before or during this project, the `RuntimeMiddleware` interface may need additional hooks (e.g. `intercept`, `injectResult`). The SPI is cheap to extend, but the timing should be communicated.
- **`ExecutionPlan.sql` is SQL-specific.** The framework-level plan constraint is `{ readonly meta: PlanMeta }`, which sidesteps this. If `ExecutionPlan` evolves to be truly family-agnostic, the constraint can be tightened. Low risk.
