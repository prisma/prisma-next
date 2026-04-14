# Summary

Extract family-agnostic runtime and middleware SPIs at the framework level. The runtime SPI defines what a family runtime looks like to consumers (execute a plan, get rows back). The middleware SPI defines the query execution lifecycle hooks that middlewares observe. Family-specific interfaces extend both SPIs with narrowed types. Wire the middleware lifecycle into `MongoRuntime` and prove it works with a single generic middleware running in both SQL and Mongo runtimes.

# Description

The April milestone's WS4 stop condition requires: "A middleware operates across both families without family-specific code." Today this cannot be true — the Mongo runtime completely bypasses the shared middleware pipeline, and the two runtimes have no common interface.

**Two SPIs need extraction:**

**1. Runtime executor SPI.** The SQL runtime (`RuntimeCore` / `RuntimeQueryable`) and the Mongo runtime (`MongoRuntime`) both have the same fundamental shape: accept a plan, execute it, return `AsyncIterableResult<Row>`. But today they have no shared interface — `RuntimeQueryable.execute` takes `ExecutionPlan` (which has `sql: string`), while `MongoRuntime.execute` takes `MongoQueryPlan` (which has `collection` and `command`). A framework-level runtime executor interface, parameterized on the plan type, lets consumers and infrastructure interact with any family's runtime without knowing which family it is. Both `ExecutionPlan` and `MongoQueryPlan` already share `meta: PlanMeta`.

**2. Middleware SPI.** The current middleware system (called "plugins" in the codebase) is defined in `@prisma-next/runtime-executor` and wired only through the SQL runtime path. The `Plugin` interface receives `ExecutionPlan` (which has `sql: string`), and `RuntimeCoreImpl` orchestrates the lifecycle (`beforeExecute` → `onRow` → `afterExecute`). The Mongo runtime has no middleware support — it passes plans directly from adapter to driver with no hooks.

**Design approach — SPI over concretions:**

The solution follows the same pattern used for other framework components (adapters, drivers, extensions): define framework-level interfaces with family/target binding metadata, then let each family implement them. The framework does not provide shared concrete orchestrators or base classes — it provides the interface contracts that both runtimes satisfy. Each family's runtime owns its execution, connection management, marker verification, and middleware orchestration.

**Middleware layers:**

1. **Framework-level `RuntimeMiddleware` SPI** — the interface the framework sees. The plan is opaque (using the existing `ExecutionPlan` base interface, which both SQL and Mongo plans satisfy via `meta: PlanMeta`). The framework passes plans through without inspecting their contents. Generic middlewares (telemetry, rate limiting, caching) are written against this interface.

2. **Family-specific middleware interfaces** — `SqlMiddleware` extends `RuntimeMiddleware` with narrowed types: `ExecutionPlan` with `sql: string` and SQL AST, SQL-specific context. `MongoMiddleware` extends it with `MongoQueryPlan` and Mongo-specific context. These are what family-specific middleware authors use (e.g. SQL `lints` and `budgets`).

3. **Compatibility validation** — when constructing a runtime, validate that provided middlewares are compatible with the runtime's `familyId`/`targetId`. A generic middleware (no `familyId`) works everywhere. A SQL middleware (`familyId: 'sql'`) fails with a clear error if provided to a Mongo runtime. This follows the `TargetBoundComponentDescriptor` / `checkContractComponentRequirements` pattern.

# Requirements

## Functional Requirements

### Framework-level runtime executor SPI

1. **Define a framework-level `RuntimeExecutor` interface.** The common shape that all family runtimes satisfy:
   - `execute<Row>(plan: TPlan): AsyncIterableResult<Row>` — execute a query plan and return results
   - `close(): Promise<void>` — release resources

   The interface is parameterized on the plan type (`TPlan`). At the framework level, the plan type constraint is `{ readonly meta: PlanMeta }` — the minimum both `ExecutionPlan` and `MongoQueryPlan` satisfy. Family-specific runtime interfaces narrow `TPlan` to their concrete plan type.

   This interface lives in `@prisma-next/runtime-executor` alongside the existing `RuntimeCore`.

2. **Define family-specific runtime interfaces that extend `RuntimeExecutor`.** Each family narrows the plan type:
   - SQL: `RuntimeCore` (existing) extends `RuntimeExecutor<ExecutionPlan>`, adding `connection()`, `transaction()`, `telemetry()`
   - Mongo: `MongoRuntime` (existing) extends `RuntimeExecutor<MongoQueryPlan>`

   Family-specific methods (`connection()`, `transaction()`, etc.) remain on the family interface — they are not part of the framework SPI. The framework SPI is the common denominator: execute a plan, get rows.

### Framework-level middleware SPI

3. **Define `RuntimeMiddleware` interface at the framework level.** The interface carries:
   - `name: string` — middleware identifier
   - `familyId?: string` — if set, restricts to a specific family (e.g. `'sql'`, `'mongo'`). If unset, the middleware is family-agnostic.
   - `targetId?: string` — if set, restricts to a specific target (e.g. `'postgres'`). Requires `familyId` to also be set.
   - `beforeExecute?(plan, ctx): Promise<void>` — called before execution
   - `onRow?(row, plan, ctx): Promise<void>` — called per result row
   - `afterExecute?(plan, result, ctx): Promise<void>` — called after execution completes (success or failure)

   The `plan` parameter type uses the existing `ExecutionPlan` interface from `@prisma-next/contract/types`. Both SQL's `ExecutionPlan` and Mongo's `MongoQueryPlan` already satisfy this structurally via `meta: PlanMeta`. The `ctx` parameter provides family-agnostic context (contract metadata, mode, logging). The `result` parameter uses the existing `AfterExecuteResult` shape (`rowCount`, `latencyMs`, `completed`).

4. **Define `RuntimeMiddlewareContext` at the framework level.** The context available to all middlewares regardless of family:
   - `contract: unknown` — the contract (opaque at framework level; narrowed by family interfaces)
   - `mode: 'strict' | 'permissive'`
   - `log: Log`
   - `now: () => number`

### Family-specific middleware interfaces

5. **Define `SqlMiddleware` in `@prisma-next/sql-runtime`.** Extends `RuntimeMiddleware` with:
   - `familyId: 'sql'`
   - Narrowed plan type: `ExecutionPlan` with `sql: string`, `params`, and optional SQL AST
   - Narrowed context type: SQL-specific adapter and driver types

6. **Define `MongoMiddleware` in `@prisma-next/mongo-runtime` (or `@prisma-next/mongo-family-runtime`).** Extends `RuntimeMiddleware` with:
   - `familyId: 'mongo'`
   - Narrowed plan type: `MongoQueryPlan` with `collection`, `command`, `meta`
   - Narrowed context type: Mongo-specific adapter and driver types

### Compatibility validation

7. **Validate middleware compatibility at runtime construction.** When a runtime is constructed with a list of middlewares, check each middleware's `familyId` and `targetId` against the runtime's family and target:
   - No `familyId` → compatible with any family
   - `familyId` matches → compatible
   - `familyId` mismatches → error: "Middleware '{name}' requires family '{middlewareFamilyId}' but the runtime is configured for family '{runtimeFamilyId}'"
   - `targetId` set but `familyId` unset → error (invalid middleware definition)
   - `targetId` set and matches → compatible
   - `targetId` set and mismatches → error with similar message

   This validation follows the same pattern as `checkContractComponentRequirements` in `framework-components.ts`.

### Mongo runtime middleware lifecycle

8. **Add middleware lifecycle to `MongoRuntime`.** `MongoRuntimeOptions` gains an optional `middlewares` parameter. The middleware lifecycle wraps the existing execution path (`adapter.lower(plan)` → `driver.execute(wireCommand)`):
   - Call `beforeExecute` on each middleware before lowering
   - Call `onRow` on each middleware per result row
   - Call `afterExecute` on each middleware after execution completes
   - On error: call `afterExecute` with `completed: false`, then rethrow

   This mirrors the lifecycle already implemented in `RuntimeCoreImpl.#executeWith`.

### Migrate existing SQL middleware to new SPI

9. **Rename `Plugin` to `RuntimeMiddleware` across the codebase.** The existing `Plugin` interface in `@prisma-next/runtime-executor` is renamed to `RuntimeMiddleware`. The existing `PluginContext` is renamed to `RuntimeMiddlewareContext`. All production code references (`plugins` options, type annotations, imports) are updated to the new names. This includes the framework layer, SQL runtime, Mongo runtime, and facade packages.

10. **Migrate existing SQL middlewares.** The existing `budgets` and `lints` middlewares in `@prisma-next/sql-runtime` are updated to implement `SqlMiddleware`. They already use SQL-specific plan fields (`plan.sql`, `plan.ast`), so they naturally belong to the `SqlMiddleware` type with `familyId: 'sql'`.

11. **Migrate `RuntimeCoreImpl` to accept `RuntimeMiddleware[]`.** The existing `RuntimeCoreImpl` continues to orchestrate the middleware lifecycle, but now accepts `RuntimeMiddleware[]` and validates compatibility (all provided middlewares must be family-agnostic or have `familyId: 'sql'`).

### Cross-family proof

12. **Implement one generic middleware that works across both families.** A simple telemetry or logging middleware, written against the `RuntimeMiddleware` interface (no `familyId`), that:
    - Logs plan metadata (`meta.lane`, `meta.target`, `meta.storageHash`) before execution
    - Records row count and latency after execution
    - Is registered in both SQL and Mongo runtimes
    - Operates identically without family-specific code

13. **Integration test: same middleware, both runtimes.** A test that:
    - Creates a SQL runtime and a Mongo runtime, each with the same generic middleware
    - Executes a query through each
    - Verifies the middleware was called in both cases with correct plan metadata

## Non-Functional Requirements

- **No breaking changes to existing SQL middleware consumer APIs.** The `budgets()` and `lints()` factory functions continue to work with the same API. Type names change (`Plugin` → `RuntimeMiddleware`), but the shapes are compatible.
- **No changes to marker verification, connection management, or transaction management.** These remain family-owned. The middleware SPI is strictly about the query execution lifecycle hooks.
- **The framework `RuntimeMiddleware` interface does not inspect plan contents.** The plan is opaque at the framework level. Only family-specific middleware interfaces narrow the plan type.
- **Follow existing component descriptor patterns.** The `familyId`/`targetId` binding and compatibility validation follow the established patterns in `framework-components.ts` (`TargetBoundComponentDescriptor`, `checkContractComponentRequirements`).

## Non-goals

- **Shared concrete middleware orchestrator.** Each family runtime implements its own middleware lifecycle. The framework provides the interface, not a shared base class or orchestrator. (The orchestration logic is trivial — the value is in the interface contract.)
- **Middleware interception / short-circuiting / result injection.** This is WS3 VP4 (Alexey's workstream). This project normalizes the SPI so that whatever interception model VP4 establishes can be adopted by both families. We do not implement interception ourselves.
- **Middleware for connections or transactions.** The middleware lifecycle wraps individual query executions. Connection-level and transaction-level hooks are deferred.
- **Middleware ordering or composition model.** Middlewares execute in registration order. Advanced composition (priority, dependency resolution) is deferred.
- **Renaming "plugin" in all existing non-test code.** Rename `Plugin` → `RuntimeMiddleware`, `PluginContext` → `RuntimeMiddlewareContext`, and `plugins` → `middlewares` across the codebase (framework, SQL runtime, Mongo runtime, facade packages). Test files may retain the old naming if updating them is purely mechanical noise, but production code should use the canonical "middleware" terminology.

# Acceptance Criteria

### Runtime executor SPI
- [ ] `RuntimeExecutor<TPlan>` interface exists at the framework level with `execute` and `close`
- [ ] `TPlan` constraint is `{ readonly meta: PlanMeta }` — the minimum both `ExecutionPlan` and `MongoQueryPlan` satisfy
- [ ] `RuntimeCore` (SQL) extends `RuntimeExecutor<ExecutionPlan>`
- [ ] `MongoRuntime` extends `RuntimeExecutor<MongoQueryPlan>`
- [ ] Both return `AsyncIterableResult<Row>` from `execute`

### Middleware SPI
- [ ] `RuntimeMiddleware` interface exists at the framework level (`@prisma-next/runtime-executor` or `@prisma-next/framework-components`)
- [ ] `RuntimeMiddlewareContext` interface exists at the framework level
- [ ] `RuntimeMiddleware` uses the same plan base type as `RuntimeExecutor` (`{ readonly meta: PlanMeta }`)
- [ ] `RuntimeMiddleware` carries optional `familyId` and `targetId` for binding

### Family-specific interfaces
- [ ] `SqlMiddleware` interface extends `RuntimeMiddleware` with `familyId: 'sql'` and SQL-specific plan/context types
- [ ] `MongoMiddleware` interface extends `RuntimeMiddleware` with `familyId: 'mongo'` and Mongo-specific plan/context types

### Compatibility validation
- [ ] Runtime construction validates middleware `familyId`/`targetId` compatibility
- [ ] Mismatched `familyId` produces a clear error message naming the middleware and the mismatch
- [ ] Generic middlewares (no `familyId`) pass validation for any runtime

### Mongo middleware lifecycle
- [ ] `MongoRuntime` accepts an optional `middlewares` parameter
- [ ] `MongoRuntime` calls `beforeExecute`, `onRow`, `afterExecute` around query execution
- [ ] Middleware lifecycle in Mongo handles errors (calls `afterExecute` with `completed: false`, then rethrows)

### Rename and migration
- [ ] `Plugin` renamed to `RuntimeMiddleware` across all production code
- [ ] `PluginContext` renamed to `RuntimeMiddlewareContext` across all production code
- [ ] `plugins` option renamed to `middlewares` across all production code
- [ ] Existing `budgets` and `lints` middlewares work without API changes to their consumers

### Cross-family proof
- [ ] A generic middleware (no `familyId`) runs in both SQL and Mongo runtimes
- [ ] Integration test verifies the same middleware instance observes queries from both families
- [ ] The generic middleware uses only `PlanMeta` and `AfterExecuteResult` — no family-specific plan fields

# Other Considerations

## Coordination

- **Alexey (WS3, Runtime pipeline):** VP4 (middleware supports request rewriting) is adding interception and short-circuiting to the middleware interface. This project normalizes the SPI so VP4's additions can propagate to both families. Coordinate on the `RuntimeMiddleware` interface shape — VP4's interception model should extend `RuntimeMiddleware`, not bypass it. Whatever changes VP4 makes to `ExecutionPlan` or the middleware hooks will naturally propagate through the family-specific interfaces.
- **Saevar (WS1, Migration system):** No coordination needed. This project does not touch the migration system.

## Risk

- **VP4 may change the middleware interface shape.** If Alexey adds interception/short-circuiting before this project completes, the `RuntimeMiddleware` interface may need to accommodate those hooks. Mitigated by: (a) this project defines the SPI shape, VP4 extends it; (b) the interfaces are cheap to update; (c) coordination with Alexey on timing.
- **`ExecutionPlan` may not be the right long-term plan base type.** The `sql: string` field is SQL-specific. For now, Mongo's `MongoQueryPlan` satisfies the structural constraint via `meta: PlanMeta`. If `ExecutionPlan` evolves to become truly family-agnostic (removing the `sql` requirement or making it optional), this project benefits. If not, a separate `RuntimePlan` base interface may be needed later. Low risk: the middleware SPI cares about `meta`, not `sql`.

# References

- [April milestone plan](../../docs/planning/april-milestone.md) § WS4 (cross-family validation) and § WS3 VP4 (middleware supports request rewriting)
- [May milestone plan](../../docs/planning/may-milestone.md) § WS4 (multi-target test harness assumes cross-family middleware is validated)
- Framework component descriptors: `packages/1-framework/1-core/framework-components/src/framework-components.ts` — `TargetBoundComponentDescriptor`, `checkContractComponentRequirements`
- Execution stack: `packages/1-framework/1-core/framework-components/src/execution-stack.ts` — `ExecutionStackInstance`
- Current middleware interface: `packages/1-framework/4-runtime/runtime-executor/src/plugins/types.ts` — `Plugin`, `PluginContext`, `AfterExecuteResult`
- Current middleware orchestration: `packages/1-framework/4-runtime/runtime-executor/src/runtime-core.ts` — `RuntimeCoreImpl`
- Current runtime SPI: `packages/1-framework/4-runtime/runtime-executor/src/runtime-spi.ts` — `RuntimeFamilyAdapter`
- Current `RuntimeCore`/`RuntimeQueryable` interfaces: `packages/1-framework/4-runtime/runtime-executor/src/runtime-core.ts`
- `AsyncIterableResult`: `packages/1-framework/4-runtime/runtime-executor/src/async-iterable-result.ts`
- SQL runtime: `packages/2-sql/5-runtime/src/sql-runtime.ts` — `createRuntime`, middleware wiring
- SQL middlewares: `packages/2-sql/5-runtime/src/plugins/budgets.ts`, `packages/2-sql/5-runtime/src/plugins/lints.ts`
- Mongo runtime: `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts` — `MongoRuntime`, no middleware support
- Mongo query plan: `packages/2-mongo-family/4-query/query-ast/src/query-plan.ts` — `MongoQueryPlan`
- Mongo executor: `packages/2-mongo-family/5-query-builders/orm/src/executor.ts` — `MongoQueryExecutor`
- `ExecutionPlan`: `packages/1-framework/0-foundation/contract/src/types.ts`
- `PlanMeta`: `packages/1-framework/0-foundation/contract/src/types.ts`
- Mock family test: `packages/1-framework/4-runtime/runtime-executor/test/mock-family.test.ts` — existing family-agnostic middleware test
- Linear project: [WS4: MongoDB & Cross-Family Architecture](https://linear.app/prisma-company/project/ws4-mongodb-and-cross-family-architecture-89d4dcdbcd9a)

# Open Questions

None — all design decisions were resolved during shaping conversation. Key decisions:

- **SPI over concretions:** The framework defines interfaces, not shared base classes. Each family runtime implements the middleware lifecycle independently.
- **Existing `ExecutionPlan` as plan base type:** Both family plan types satisfy `{ meta: PlanMeta }` structurally. Future improvements to `ExecutionPlan` by the runtime workstream will propagate naturally.
- **"Middleware" naming:** "Middleware" is the canonical term. All production code is renamed from `Plugin`/`PluginContext`/`plugins` to `RuntimeMiddleware`/`RuntimeMiddlewareContext`/`middlewares`.
- **Scope excludes interception:** Middleware interception/short-circuiting is WS3 VP4's responsibility. This project normalizes the SPI so VP4's model can be adopted by both families.
