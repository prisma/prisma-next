# ADR 204 — Single-tier runtime: collapse `runtime-executor` into `framework-components`

## Supersedes

- [ADR 140 — Package Layering & Target-Family Namespacing](ADR%20140%20-%20Package%20Layering%20&%20Target-Family%20Namespacing.md), specifically the "Runtime Separation" section that introduced a two-tier runtime model (a target-agnostic `runtime-executor` package implementing the runtime SPI, and family runtimes composing it). The rest of ADR 140's package-layering, plane-boundary, and naming guidance is unchanged.

## Context

ADR 140 established a two-tier runtime model:

- A target-agnostic kernel at `packages/1-framework/4-runtime/runtime-executor/` (`@prisma-next/runtime-executor`) owned plan verification, the middleware lifecycle, and the runtime SPI.
- Family runtimes (`@prisma-next/sql-runtime`, `@prisma-next/mongo-runtime`) implemented the SPI by **composing** an inner `runtime-executor` instance with family-specific lowering and driver code.

In practice the two tiers carried close to no independent value:

- The inner `runtime-executor` was always wrapped 1-to-1 by exactly one family runtime — there were no consumers of the SPI other than `*Runtime` classes that delegated to it.
- The family runtime had to forward every public surface (`execute`, `close`, `connection`, `transaction`) to the inner instance, duplicating signatures and creating two places where lifecycle bugs could land.
- The middleware orchestration loop existed in two parallel implementations: one in `runtime-executor` for the cross-family path, and one in each family runtime for SQL's `beforeCompile` chain. Drift between them was a recurring review concern.
- The two-tier shape complicated cross-family work: any time we wanted a generic middleware to observe both SQL and Mongo queries, we had to plumb the same middleware-context shape through both tiers.

The cross-family runtime unification project (TML-2242) reworked the runtime around three primitives that live entirely at the core layer:

- `QueryPlan<Row>` and `ExecutionPlan<Row>` markers (pre- and post-lowering).
- An abstract `RuntimeCore<TPlan, TExec, TMiddleware>` class whose concrete `execute()` defines the lifecycle template `runBeforeCompile → lower → runWithMiddleware(beforeExecute → driver loop → onRow → afterExecute)`.
- A canonical `runWithMiddleware` orchestrator helper used by every family.

With those in place, the inner `runtime-executor` package had no responsibilities left that could not be handed to the abstract base class, and the composition tier became pure forwarding.

## Decision

Collapse the two-tier runtime model into a single tier:

- Move the runtime SPI (`RuntimeExecutor`, `RuntimeMiddleware`, `RuntimeMiddlewareContext`, `AfterExecuteResult`), the abstract `RuntimeCore` base class, the canonical `runWithMiddleware` helper, and the `QueryPlan`/`ExecutionPlan` markers into [`@prisma-next/framework-components`](../../../packages/1-framework/1-core/framework-components/) (core layer).
- Delete the `@prisma-next/runtime-executor` package and the `packages/1-framework/4-runtime/` directory entirely.
- Each family runtime is a single class that **extends** `RuntimeCore`, binds the three generics to its concrete family types, and overrides the family-specific hooks (`lower`, `runDriver`, `close`; optionally `runBeforeCompile`).

Concretely:

- `SqlRuntimeImpl extends RuntimeCore<SqlQueryPlan, SqlExecutionPlan, SqlMiddleware>` overrides `runBeforeCompile` (to run the SQL `beforeCompile` middleware chain), `lower` (`lowerSqlPlan` + parameter encoding), `runDriver`, and `close`.
- `MongoRuntimeImpl extends RuntimeCore<MongoQueryPlan, MongoExecutionPlan, MongoMiddleware>` overrides `lower` (adapter-driven), `runDriver`, and `close`. Mongo does not override `runBeforeCompile`; the base's identity default is sufficient.

The runtime SPI now lives at the lowest consuming layer — the core layer of the framework domain — consistent with [ADR 185 — SPI types live at the lowest consuming layer](ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md).

## Affected packages and dependency direction

| Before | After |
|--------|-------|
| `@prisma-next/runtime-executor` (framework, runtime layer) — owned SPI + plugin lifecycle | **Deleted.** Contents folded into `@prisma-next/framework-components`. |
| `@prisma-next/framework-components` (framework, core layer) — component descriptors, control/execution/emission types | Adds the `runtime` entrypoint with `QueryPlan`, `ExecutionPlan`, `RuntimeMiddleware`, `RuntimeExecutor`, abstract `RuntimeCore`, and `runWithMiddleware`. |
| `@prisma-next/sql-runtime` (SQL, runtime layer) — composed `runtime-executor` | Extends `RuntimeCore` directly via `SqlRuntimeImpl`. Imports the runtime SPI from `@prisma-next/framework-components/runtime`. |
| `@prisma-next/mongo-runtime` (Mongo, runtime layer) — composed `runtime-executor` | Extends `RuntimeCore` directly via `MongoRuntimeImpl`. Imports the runtime SPI from `@prisma-next/framework-components/runtime`. |

The dependency direction is unchanged in spirit but simpler in shape: family runtimes import the SPI from the core layer of the framework domain, the same way they already import other cross-family abstractions (`Contract`, `ExecutionContext`, `AsyncIterableResult`). There is no longer an intermediate `runtime-executor` package between the core layer and the family runtimes.

The enforcement chain in `architecture.config.json` and the layering docs collapses from `core → authoring → tooling → lanes → runtime-executor → family-runtime → adapters` to `core → authoring → tooling → lanes → runtime → adapters`.

## Rationale

1. **Single canonical lifecycle template.** Every family runtime sees the same `runBeforeCompile → lower → runWithMiddleware(beforeExecute → driver loop → onRow → afterExecute)` sequence because there is exactly one place that defines it: `RuntimeCore.execute`. Family runtimes pick which steps to override; they cannot accidentally diverge from the framework lifecycle.
2. **Single canonical middleware orchestrator.** `runWithMiddleware` is the only place that iterates middleware around a driver loop. Error-path swallowing semantics (telemetry middleware seeing `completed: false` for failed executions even when an `afterExecute` hook itself throws) live in one file with one set of tests; we never need to keep two implementations in sync.
3. **Family-agnostic middleware via shared abstract base.** A middleware typed against `RuntimeMiddleware<QueryPlan>` is observable from both SQL and Mongo runtimes by construction, with no plumbing required at the family boundary. The cross-family middleware SPI work that motivated TML-2242 is structurally enforced rather than maintained by convention.
4. **No "wrap-and-forward" tier.** Every public method on a family runtime is either inherited from `RuntimeCore` (e.g., `execute`) or a family-specific override (`lower`, `runDriver`, `close`). There is no longer a forwarding layer between the SPI and the concrete family.
5. **Lower onboarding cost for new families.** Adding a Document or Cassandra family runtime is one constructor and at most three method overrides — it does not require a new "wrap the executor" package.

## Affected source

- Removed: `packages/1-framework/4-runtime/runtime-executor/**` (entire directory; package gone from the workspace).
- Added in [`@prisma-next/framework-components`](../../../packages/1-framework/1-core/framework-components/src/):
  - [`query-plan.ts`](../../../packages/1-framework/1-core/framework-components/src/query-plan.ts) — `QueryPlan`, `ExecutionPlan`.
  - [`runtime-middleware.ts`](../../../packages/1-framework/1-core/framework-components/src/runtime-middleware.ts) — `RuntimeMiddleware`, `RuntimeMiddlewareContext`, `RuntimeExecutor`, `AfterExecuteResult`.
  - [`runtime-core.ts`](../../../packages/1-framework/1-core/framework-components/src/runtime-core.ts) — `RuntimeCore`.
  - [`run-with-middleware.ts`](../../../packages/1-framework/1-core/framework-components/src/run-with-middleware.ts) — `runWithMiddleware`.
  - [`exports/runtime.ts`](../../../packages/1-framework/1-core/framework-components/src/exports/runtime.ts) — public surface.
- Updated:
  - [`@prisma-next/sql-runtime`](../../../packages/2-sql/5-runtime/src/sql-runtime.ts) — `SqlRuntimeImpl extends RuntimeCore`.
  - [`@prisma-next/mongo-runtime`](../../../packages/2-mongo-family/7-runtime/src/mongo-runtime.ts) — `MongoRuntimeImpl extends RuntimeCore`.

## Consequences

### Positive

- Single source of truth for the runtime lifecycle and middleware orchestration. Hooks added to `RuntimeCore` or `runWithMiddleware` reach every family at once.
- Cross-family middleware is observable from any family runtime by construction, not by convention.
- Removing one package (and one whole layer of the framework domain's directory tree) reduces both the cognitive surface and the dependency graph.
- The abstract base + helper pattern is now the canonical extension point for new families.

### Trade-offs

- The "runtime SPI" is no longer in a layer named `runtime`. Readers used to ADR 140's two-tier model may look for it there first; the durable architecture docs now point to the core layer instead.
- Family runtimes that want to override or wrap pre-/post-execution behavior do so by subclassing `RuntimeCore` rather than by composing an instance of it. The previous model permitted "wrap-and-forward" patterns that subclassing makes harder; in exchange, the lifecycle template is enforced rather than reimplemented.

## Alternatives considered

### Keep `runtime-executor` as a thin facade over `RuntimeCore`

Leave the `@prisma-next/runtime-executor` package in place but reduce it to a re-export of `RuntimeCore`, `runWithMiddleware`, and the SPI types from `@prisma-next/framework-components`.

This would have preserved the "runtime SPI lives in a runtime-named package" mental model but at the cost of an extra package, an extra tsconfig project, and an extra import path that consumers had to remember (was it `@prisma-next/runtime-executor` or `@prisma-next/framework-components/runtime`?). With every consumer already crossing into `framework-components` for adjacent SPIs (`Contract`, `ExecutionContext`, codecs), the facade added no clarity and one more thing to maintain. Rejected.

### Keep two-tier composition but unify the orchestrator

Leave the composition tier in place but require both tiers to delegate middleware orchestration to a shared `runWithMiddleware` helper.

This would have addressed the orchestrator-drift issue without addressing the wrap-and-forward problem or the cognitive cost of two runtime packages. It also leaves the family runtime owning its own `execute` method, which means the lifecycle template still has to be reimplemented per family. Rejected.

### Move the runtime SPI to its own core-layer package

Introduce a new `@prisma-next/runtime-spi` package at the core layer dedicated to the runtime SPI, separate from `framework-components`.

This keeps the SPI isolated but creates yet another core-layer package with a thin surface. The SPI naturally co-locates with the other framework primitives (`Contract`, `ExecutionContext`, `AsyncIterableResult`) that family runtimes already import from `framework-components`. Splitting it out adds a package without adding a boundary anyone needs. Rejected.

## Decision record

Adopt a single-tier runtime model. The runtime SPI, abstract `RuntimeCore`, and canonical `runWithMiddleware` helper live in `@prisma-next/framework-components` (core layer). Family runtimes (`@prisma-next/sql-runtime`, `@prisma-next/mongo-runtime`) extend `RuntimeCore` directly. The `@prisma-next/runtime-executor` package and the `packages/1-framework/4-runtime/` directory are removed. The dependency-direction enforcement chain collapses from `core → authoring → tooling → lanes → runtime-executor → family-runtime → adapters` to `core → authoring → tooling → lanes → runtime → adapters`. Supersedes the "Runtime Separation" section of ADR 140.
