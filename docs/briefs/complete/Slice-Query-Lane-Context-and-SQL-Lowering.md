## Slice — QueryLaneContext and SQL Lowering

### Objective

Remove the remaining dependency-cruiser exceptions by:

- Decoupling SQL query lanes from the SQL runtime package, so `sql/lanes` no longer depend on `sql/runtime`.
- Moving SQL lowering (`QueryAst` → SQL string + params) out of lanes into the runtime executor, in line with the architecture docs.
- Introducing a shared `QueryLaneContext` surface that concrete lanes depend on instead of `RuntimeContext`.

This slice focuses on the **SQL lanes ↔ SQL runtime** relationship. A follow-up effort will clean up the remaining `compat-prisma` exception once this layering is correct.

### Design References

- Architecture overview: `docs/Architecture Overview.md`
- Package layering: `docs/architecture docs/Package-Layering.md`
- Contract / lanes / runtime separation: `docs/briefs/complete/Slice-Contract-SoC-Types-Lanes-Runtime.md`
- Codecs registry & plan types: `docs/briefs/complete/Slice-Codecs-Registry-and-Plan-Types.md`
- Query lanes subsystem: `docs/architecture docs/subsystems/3. Query Lanes.md`
- Package layering config: `architecture.config.json`
- Dependency rules implementation: `dependency-cruiser.config.mjs`

### Current State

#### Layering & dep-cruiser

- `architecture.config.json` defines:
  - `packages/sql/lanes/**` → domain `sql`, layer `lanes`, plane `runtime`.
  - `packages/sql/sql-runtime/**` → domain `sql`, layer `runtime`, plane `runtime`.
  - Layer order for SQL: `["core", "authoring", "tooling", "lanes", "runtime", "adapters", "drivers"]`.
- `dependency-cruiser.config.mjs` encodes **upward** layering rules and currently has an explicit exception:

  - `isSqlLanesToRuntime` skips adding `upward` rules from `sql/lanes` → `sql/runtime`, so lanes are currently allowed to import runtime.

- Plane rules (`planeRules.runtime`) also allow `runtime` → `runtime` imports, so combined with the layer exception, `sql/lanes` → `sql-runtime` is permitted today.

#### SQL lanes depending on runtime

Across the SQL family, lanes import both **types** and **test helpers** from `@prisma-next/sql-runtime`:

- Production code:
  - `packages/sql/lanes/relational-core/src/schema.ts`
    - Imports `RuntimeContext` from `@prisma-next/sql-runtime`.
    - Uses `context.contract`, `context.operations`, and `contract.capabilities` to attach operation builders to columns.
  - `packages/sql/lanes/sql-lane/src/sql/context.ts`
    - Defines `SqlContext` as a thin wrapper around `RuntimeContext` and exposes `contract` and `adapter`.
  - `packages/sql/lanes/orm-lane/src/orm/context.ts`
    - Defines `OrmContext` similarly, wrapping `RuntimeContext` and exposing `contract` and `adapter`.
  - `packages/sql/lanes/sql-lane/src/sql/select-builder.ts`
    - Accepts a `RuntimeContext` via options.
    - Uses `context.contract` for typing and capability checks.
    - Critically, calls `context.adapter.lower(ast, { contract, params })` to produce a fully-lowered `Plan` with `sql` and `params`.

- Tests:
  - `packages/sql/lanes/**/test/**` import `createTestContext` and `createStubAdapter` from `@prisma-next/sql-runtime/test/utils`.
  - Dep-cruiser explicitly excludes `test/**`, so test-only coupling is acceptable for now.

#### Runtime context shape

In `packages/sql/sql-runtime/src/sql-context.ts`:

- `RuntimeContext<TContract>` currently contains:
  - `contract: TContract` (a `SqlContract<SqlStorage>`).
  - `adapter: Adapter<QueryAst, TContract | SqlContract<SqlStorage>, LoweredStatement>`.
  - `operations: OperationRegistry`.
  - `codecs: CodecRegistry`.
- `createRuntimeContext` composes:
  - A `CodecRegistry` from the adapter profile plus any extensions.
  - An `OperationRegistry` from SQL operations plus any extensions.
  - The resulting `RuntimeContext` is passed directly into lanes today.

### Problems

1. **Layering violation: lanes depend on runtime**
   - According to `Package-Layering.md`:
     - Lanes are a separate layer that **must not depend upwards on runtime**.
     - Dependencies should flow `core → authoring → targets → lanes → runtime → adapters`.
   - The explicit upward exception in `dependency-cruiser.config.mjs` is a hard-coded allowance that contradicts this model.

2. **Responsibility leak: lanes are performing SQL lowering**
   - The architecture docs state that:
     - **Lanes** build family-specific ASTs and attach metadata; they are **plan producers**.
     - The **runtime executor** composes adapters, codecs, and capabilities and is responsible for lowering plans to executable statements.
   - In `sql-lane`, `SelectBuilderImpl.build()` calls `adapter.lower(ast, ...)` and returns a fully-lowered `Plan<Row>` including:
     - `sql` (text).
     - `params` (encoded parameter values).
     - `meta` (target-agnostic metadata).
   - This couples lanes to:
     - The adapter interface.
     - The specific lowering strategy.
     - The runtime plane, via `RuntimeContext`.

3. **Context surface mismatch**
   - Conceptually, lanes only need:
     - `contract` (schema, storage, mappings, capabilities).
     - `operations` (operation signatures and capability metadata).
     - `codecs` (for type-level mapping; at runtime, they are used to validate that plan metadata is consistent, but lanes should not be responsible for registry composition).
   - Today, lanes take a `RuntimeContext` that exposes:
     - `adapter` (runtime responsibility).
     - A runtime-composed `CodecRegistry` and `OperationRegistry`.
   - This makes it difficult to:
     - Reuse lanes in other contexts (e.g., alternative runtimes).
     - Enforce clear plane/ layer boundaries in tooling and documentation.

4. **Dep-cruiser exceptions mask real violations**
   - The `isSqlLanesToRuntime` special case in `dependency-cruiser.config.mjs` means:
     - Refactors can accidentally introduce additional runtime coupling in lanes without being caught.
   - Our long-term goal is to have:
     - No hard-coded exceptions for domain/layer combinations.
     - Only narrowly scoped plane-based exceptions when absolutely necessary (e.g., compat layers).

### Design: QueryLaneContext

We introduce a **minimal, lane-focused context** type owned by `@prisma-next/sql-relational-core`, called `QueryLaneContext`. This type is deliberately a **subset** of `RuntimeContext`:

- **Location**
  - `packages/sql/lanes/relational-core/src/query-lane-context.ts` (or similar).
  - Exported from `@prisma-next/sql-relational-core` as a public type.

- **Shape**

  ```ts
  import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
  import type { OperationRegistry } from '@prisma-next/operations';
  import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';

  export interface QueryLaneContext<
    TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  > {
    readonly contract: TContract;
    readonly operations: OperationRegistry;
    readonly codecs: CodecRegistry;
  }
  ```

- **RuntimeContext relationship**

  In `packages/sql/sql-runtime/src/sql-context.ts`, change `RuntimeContext` to extend `QueryLaneContext`:

  ```ts
  export interface RuntimeContext<
    TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  > extends QueryLaneContext<TContract> {
    readonly adapter:
      | Adapter<QueryAst, TContract, LoweredStatement>
      | Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
  }
  ```

  - `createRuntimeContext` continues to:
    - Compose `operations` and `codecs`.
    - Return an object compatible with both `RuntimeContext<TContract>` and `QueryLaneContext<TContract>`.
  - Because `RuntimeContext` **extends** `QueryLaneContext`, any function that accepts `QueryLaneContext` can still be called with a `RuntimeContext`.

- **Responsibilities of QueryLaneContext**
  - Provide **only** what lanes need to:
    - Build typed ASTs.
    - Attach operation builders and capability-gated operations to columns.
    - Compute projection metadata and param codecs (at the metadata level).
  - Explicitly **exclude**:
    - `adapter`.
    - Connection management, transaction state, telemetry, plugin lifecycle, or any runtime-only concerns.

### Design: Lanes consume QueryLaneContext (not RuntimeContext)

All concrete lane entrypoints will be updated to accept `QueryLaneContext` instead of `RuntimeContext`. This includes:

1. `@prisma-next/sql-relational-core`

   - `schema<Contract>(context: RuntimeContext<Contract>): SchemaReturnType<Contract>` becomes:

   ```ts
   export function schema<Contract extends SqlContract<SqlStorage>>(
     context: QueryLaneContext<Contract>,
   ): SchemaReturnType<Contract> { /* ... */ }
   ```

   - Internally, `schema`:
     - Uses `context.contract` to read storage and capabilities.
     - Uses `context.operations` to attach operations via `attachOperationsToColumnBuilder`.
     - May use `context.codecs` if needed for type- or metadata-level decisions.
   - `RuntimeContext` remains valid input because it extends `QueryLaneContext`.

2. `@prisma-next/sql-lane`

   - `SqlContext` in `src/sql/context.ts` will no longer wrap `RuntimeContext`. Instead:

   ```ts
   import type { QueryLaneContext } from '@prisma-next/sql-relational-core/query-lane-context';

   export type SqlContext<TContract extends SqlContract<SqlStorage>> = QueryLaneContext<TContract>;

   export function createSqlContext<TContract extends SqlContract<SqlStorage>>(
     context: QueryLaneContext<TContract>,
   ): SqlContext<TContract> {
     return context;
   }
   ```

   - Call sites that currently pass `RuntimeContext` will continue to compile because `RuntimeContext` is assignable to `QueryLaneContext`.

3. `@prisma-next/sql-orm-lane`

   - `OrmContext` in `src/orm/context.ts` will be redefined similarly:

   ```ts
   import type { QueryLaneContext } from '@prisma-next/sql-relational-core/query-lane-context';

   export type OrmContext<TContract extends SqlContract<SqlStorage>> = QueryLaneContext<TContract>;

   export function createOrmContext<TContract extends SqlContract<SqlStorage>>(
     context: QueryLaneContext<TContract>,
   ): OrmContext<TContract> {
     return context;
   }
   ```

   - If ORM-specific context fields are ever needed, they should be added as **extensions** around `QueryLaneContext`, not by reintroducing `RuntimeContext` into the lane layer.

### Design: Move SQL lowering to runtime executor

To resolve the responsibility leak, we split **plan construction** from **SQL lowering**.

#### New SQL plan type for lanes

Define a SQL-family-specific plan type that lanes produce, which is still **target-family specific** but not yet lowered:

- **Location**
  - Likely in `@prisma-next/sql-relational-core` (e.g. `src/plan.ts`), to keep it reusable across lanes.

- **Shape (illustrative)**

  ```ts
  import type { PlanMeta } from '@prisma-next/contract/types';
  import type { QueryAst } from '@prisma-next/sql-relational-core/ast';

  export interface SqlQueryPlan<Row = unknown> {
    readonly ast: QueryAst;
    readonly params: readonly unknown[];
    readonly meta: PlanMeta;
  }
  ```

  - Differences from `Plan<Row>`:
    - `sql` is **absent**.
    - `params` are **logical** params shaped for the adapter, not yet encoded for the driver.
    - `ast` is a concrete `QueryAst`.

#### Lanes return SqlQueryPlan instead of Plan

Update the `sql-lane` API to produce `SqlQueryPlan`:

- In `SelectBuilderImpl.build()`:
  - Remove direct calls to `adapter.lower(...)`.
  - Construct and return an `SqlQueryPlan<Row>`:

  ```ts
  build(options?: BuildOptions): SqlQueryPlan<Row> {
    // ... build ast, params, param descriptors, meta ...
    return Object.freeze({ ast, params: paramValues, meta });
  }
  ```

- Any other lane APIs that currently return `Plan<Row>` should be updated analogously.

#### Runtime executor performs lowering

The runtime executor (and/or `@prisma-next/sql-runtime`) becomes responsible for converting `SqlQueryPlan` into a fully executable `Plan<Row>`:

- Introduce a helper in `@prisma-next/sql-runtime`, e.g.:

  ```ts
  import type { Plan } from '@prisma-next/contract/types';
  import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';

  export function lowerSqlPlan<Row>(
    context: RuntimeContext,
    queryPlan: SqlQueryPlan<Row>,
  ): Plan<Row> {
    const lowered = context.adapter.lower(queryPlan.ast, {
      contract: context.contract,
      params: queryPlan.params,
    });

    const body = lowered.body;

    return Object.freeze({
      sql: body.sql,
      params: body.params ?? queryPlan.params,
      ast: queryPlan.ast,
      meta: queryPlan.meta,
    });
  }
  ```

- The runtime executor uses this helper as part of its broader execution pipeline:
  - Compose `RuntimeContext` (adapter + registries) for the target.
  - Request an `SqlQueryPlan` from the lane.
  - Lower it via `lowerSqlPlan`.
  - Apply runtime plugins, budgets, telemetry, and driver execution.

This aligns with the architecture docs: **lanes build plans; runtime executes them.**

### Dep-cruiser and layering changes

Once lanes no longer import `@prisma-next/sql-runtime` in production code:

1. **Remove the sql/lanes → sql/runtime upward exception**

   - In `dependency-cruiser.config.mjs`, delete or simplify:

   ```ts
   const isSqlLanesToRuntime = (sourceGroup, targetGroup) =>
     sourceGroup.domain === 'sql' &&
     sourceGroup.layer === 'lanes' &&
     sourceGroup.plane === 'runtime' &&
     targetGroup.layer === 'runtime' &&
     targetGroup.plane === 'runtime';

   // and the `if (isSqlLanesToRuntime(...)) continue;` in `createUpwardRules`
   ```

   - After this, standard upward rules enforce:
     - `sql/lanes` cannot import from `sql/runtime`.

2. **Keep test-only imports as-is**

   - Dep-cruiser’s `includeOnly` and `exclude` options already ignore `test/**`.
   - `packages/sql/lanes/**/test/**` can continue using `@prisma-next/sql-runtime/test/utils` without affecting layering guarantees.

3. **Future: compat-prisma exception**

   - The remaining plane exception in `architecture.config.json` and `dependency-cruiser.config.mjs` allows:
     - `packages/extensions/compat-prisma/**` (domain `extensions`, layer `compat`) to import from `packages/sql/**` (domain `sql`).
   - This is expected because `compat-prisma` is a **compatibility layer** that must bridge Prisma ORM semantics onto SQL lanes.
   - Once the SQL lane/runtimes boundaries are clean, we can re-evaluate whether:
     - `compat-prisma` should move into the `sql` domain (with its own layer), or
     - The exception remains but is explicitly documented in an ADR with clear rationale and scope.

### API and migration notes

- This slice is intentionally **breaking** for lane consumers:
  - Public entrypoints that previously accepted `RuntimeContext` will now accept `QueryLaneContext`.
  - Return types for `sql-lane` builders will change from `Plan<Row>` to `SqlQueryPlan<Row>`.
  - There is **no transitional overload/shim**; call sites must be updated.
- However, within this repo:
  - Most lane call sites already operate via `RuntimeContext` built in `@prisma-next/sql-runtime`.
  - Because `RuntimeContext` extends `QueryLaneContext`, many internal changes will be local to lane package boundaries.

### Tasks (Agent Checklist)

1. **Introduce QueryLaneContext**
   - Add `QueryLaneContext` interface to `@prisma-next/sql-relational-core`.
   - Export it publicly.
   - Update `RuntimeContext` in `@prisma-next/sql-runtime` to extend `QueryLaneContext`.

2. **Refactor lane APIs to consume QueryLaneContext**
   - Update `schema` in `@prisma-next/sql-relational-core` to accept `QueryLaneContext`.
   - Update `SqlContext` and `createSqlContext` in `@prisma-next/sql-lane` to be aliases/wrappers around `QueryLaneContext`.
   - Update `OrmContext` and `createOrmContext` in `@prisma-next/sql-orm-lane` similarly.
   - Remove direct imports of `RuntimeContext` from lane packages’ production code.

3. **Introduce SqlQueryPlan and move lowering to runtime**
   - Define `SqlQueryPlan<Row>` in `@prisma-next/sql-relational-core`.
   - Change `sql-lane` builders (e.g. `SelectBuilderImpl.build`) to return `SqlQueryPlan<Row>` instead of `Plan<Row>`.
   - Add `lowerSqlPlan` (or equivalent) helper to `@prisma-next/sql-runtime` that:
     - Accepts `RuntimeContext` and `SqlQueryPlan<Row>`.
     - Uses `adapter.lower` to produce a `Plan<Row>`.
   - Integrate this into the runtime executor pipeline so that:
     - Lanes are never responsible for calling `adapter.lower` directly.

4. **Tighten dep-cruiser rules**
   - Remove the `sql/lanes → sql/runtime` upward exception from `dependency-cruiser.config.mjs`.
   - Run `pnpm lint:deps` and ensure:
     - No remaining lane → runtime imports in production code.
     - Tests remain unaffected.

5. **Document and validate**
   - Ensure this slice is linked from:
     - `docs/architecture docs/ADR-INDEX.md` (if we decide to promote it to a formal ADR later).
     - Any relevant onboarding docs that describe SQL lanes and runtime.
   - Add focused tests:
     - Lane unit tests that operate against a `QueryLaneContext`-shaped fixture (no runtime dependency).
     - Runtime tests that validate `lowerSqlPlan` and the end-to-end execution path.

Once this slice is complete, the SQL family will respect the intended layering and plane separation:

- Lanes depend only on `QueryLaneContext` and produce `SqlQueryPlan`.
- Runtime composes `RuntimeContext`, performs lowering, and executes plans.
- Dep-cruiser no longer needs a special-case exception for `sql/lanes` → `sql/runtime`.

