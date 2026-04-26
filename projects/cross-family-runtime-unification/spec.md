# Summary

Introduce a single abstract `RuntimeCore` base class in the framework that owns the entire middleware lifecycle. `SqlRuntime` and `MongoRuntime` become subclasses with two family-specific overrides each (`lower`, `runDriver`); the duplicated middleware orchestrator collapses into one helper. The SQL-shaped `ExecutionPlan` leaves the framework domain and is replaced there by a content-free marker; SQL and Mongo each gain their own typed lowered-plan type in their respective domains.

# The design

## Components

After this change, the runtime stack looks like this:

**`@prisma-next/framework-components/runtime`** (framework — cross-family):

- `interface QueryPlan<Row = unknown>` — nominal marker for *any* plan; carries `{ readonly meta: PlanMeta; readonly _row?: Row }` and nothing else. Family plan types extend it.
- `interface ExecutionPlan<Row = unknown> extends QueryPlan<Row>` — nominal marker for the *post-lowering* phase. Carries no fields beyond `meta + _row` at this layer; the family-specific payload (SQL text, Mongo wire command) lives in the family-specific subtype.
- `abstract class RuntimeCore<TPlan extends QueryPlan, TExec extends ExecutionPlan, TMiddleware extends RuntimeMiddleware<TPlan>>` — the only place where the runtime lifecycle is defined.
- `function runWithMiddleware<TExec extends ExecutionPlan, Row>(...)` — the only place where middleware orchestration around a driver loop is implemented.
- `interface RuntimeExecutor<TPlan extends QueryPlan>` and `interface RuntimeMiddleware<TPlan extends QueryPlan>` — existing SPIs, retyped to use the new `QueryPlan` constraint.

**`@prisma-next/sql-runtime`** (SQL family):

- `interface SqlExecutionPlan<Row> extends ExecutionPlan<Row>` — `{ sql, params, ast?, meta, _row? }`. New home for the type currently exported as `ExecutionPlan` from `@prisma-next/contract/types`.
- `class SqlRuntime extends RuntimeCore<SqlQueryPlan, SqlExecutionPlan, SqlMiddleware>` — replaces today's two-layer `SqlRuntime → RuntimeCore` composition with single-class inheritance. Implements `lower`, `runDriver`, `runBeforeCompile`, `close`. Owns codec encode/decode, marker verification, telemetry fingerprint, `connection()`, `transaction()`.

**`@prisma-next/mongo-family-runtime`** (Mongo family):

- `interface MongoExecutionPlan<Row> extends ExecutionPlan<Row>` — wraps the wire command currently materialized inline inside `MongoRuntime.execute`.
- `class MongoRuntime extends RuntimeCore<MongoQueryPlan, MongoExecutionPlan, MongoMiddleware>`. Implements `lower`, `runDriver`, `close`. Inherits the middleware lifecycle from the base; the inline orchestration loop is deleted.

**`@prisma-next/contract/types`** (framework — agnostic):

- No longer exports `ExecutionPlan`. The contract package contains nothing SQL-shaped.

## Lifecycle

The abstract base's `execute(plan)` template:

1. **`runBeforeCompile(plan: TPlan): TPlan`** — concrete; defaults to identity. SQL overrides this to run its existing `beforeCompile` middleware-hook chain (the AST rewrite path delivered in [PR #373](https://github.com/prisma/prisma-next/pull/373)). Mongo does not override it (no typed draft yet).
2. **`lower(plan: TPlan): TExec`** — abstract. Each family produces its `*ExecutionPlan` (SQL via `lowerSqlPlan`, Mongo via `adapter.lower`). Raw-SQL plans (already lowered) bypass via the existing branch in `SqlRuntime.toExecutionPlan`.
3. **`runWithMiddleware(exec, middleware, ctx, () => runDriver(exec))`** — concrete; lives in the helper:
   - For each middleware in registration order: `beforeExecute(exec, ctx)`.
   - `for await (row of runDriver()) { for each middleware: onRow(row, exec, ctx); yield row; }`
   - For each middleware in registration order: `afterExecute(exec, { rowCount, latencyMs, completed }, ctx)`.
   - **Error path**: on throw, call each `afterExecute` with `completed: false` (errors thrown by `afterExecute` are swallowed during the error path), then rethrow. This matches today's `RuntimeCoreImpl.#executeWith` behavior verbatim.
4. **`close(): Promise<void>`** — abstract.

> *Terminology note*: `runBeforeCompile` is the **runtime-level stage** (a method on the abstract base). `beforeCompile` is the **middleware hook** (a method on `Middleware`/`SqlMiddleware`). SQL's override of `runBeforeCompile` is the chain that invokes `beforeCompile` on each middleware in order.

## Diagram

```
                        ┌─────────────────────────────────────────────────┐
                        │  framework-components/runtime                   │
                        │                                                 │
                        │  QueryPlan<Row>          (marker)               │
                        │     ▲                                           │
                        │     │ extends                                   │
                        │     │                                           │
                        │  ExecutionPlan<Row>      (marker)               │
                        │                                                 │
                        │  RuntimeMiddleware<TPlan>                       │
                        │  RuntimeExecutor<TPlan>                         │
                        │                                                 │
                        │  abstract RuntimeCore<TPlan, TExec, TMW>        │
                        │    └─ execute(plan):                            │
                        │       runBeforeCompile → lower →                │
                        │       runWithMiddleware(exec, mw, ctx,          │
                        │                        () => runDriver(exec))  │
                        │                                                 │
                        │  function runWithMiddleware(...)                │
                        └────────────▲──────────────────▲─────────────────┘
                                     │ extends          │ extends
                                     │                  │
            ┌────────────────────────┴──────┐  ┌────────┴───────────────────┐
            │  sql-runtime                  │  │  mongo-family-runtime      │
            │                               │  │                            │
            │  SqlExecutionPlan<Row>        │  │  MongoExecutionPlan<Row>   │
            │   ─ sql, params, ast?, meta   │  │   ─ wireCommand, meta      │
            │                               │  │                            │
            │  class SqlRuntime             │  │  class MongoRuntime        │
            │   ─ override lower            │  │   ─ override lower         │
            │   ─ override runDriver        │  │   ─ override runDriver     │
            │   ─ override runBeforeCompile │  │                            │
            │   ─ codec encode/decode       │  │                            │
            │   ─ marker verification       │  │                            │
            │   ─ telemetry fingerprint     │  │                            │
            │   ─ connection(), transaction│  │                            │
            └───────────────────────────────┘  └────────────────────────────┘
```

# Behavior

This is a refactor. No new public API, no new middleware capability, no new lifecycle hooks. After the change:

- Telemetry middleware records identical observations on both runtimes.
- The SQL `beforeCompile` rewrite chain operates identically (same hook signature, same chaining semantics, same `middleware.rewrite` debug events).
- SQL middleware continues to see pre-decode rows in `onRow`; Mongo middleware continues to see driver-yielded rows. (Codec decoding stays SQL-side, wrapping the inherited `execute` rather than living inside the base.)
- SQL marker verification runs at the same logical point in execution as today.
- Lints, budgets, and the cross-family middleware integration test from `cross-family-middleware-spi` continue to pass without modification.
- Connection and transaction surfaces (`connection()`, `transaction()`) are unchanged.

# Requirements

Properties the design above must guarantee. Each requirement names the design choice that satisfies it.

| ID | Property | Satisfied by |
|---|---|---|
| R1 | The middleware lifecycle (beforeExecute / onRow / afterExecute, including error path) is defined in exactly one place, regardless of family. | `runWithMiddleware` helper in framework-components; both family runtimes call it via the abstract base. |
| R2 | The full runtime execution template (beforeCompile-stage → lower → middleware orchestration → driver) is defined in exactly one place. | Concrete `RuntimeCore.execute()` method on the abstract base. |
| R3 | The framework domain owns no SQL-shaped or Mongo-shaped concrete plan types. | `ExecutionPlan` removed from `@prisma-next/contract/types`. Framework `QueryPlan`/`ExecutionPlan` are content-free markers. Family-specific lowered plans (`SqlExecutionPlan`, `MongoExecutionPlan`) live in family domains. |
| R4 | A new family runtime can be added by extending `RuntimeCore` with one constructor and three method overrides, and nothing else. | Abstract base exposes `lower`, `runDriver` as the only required overrides; `runBeforeCompile` is optional. |
| R5 | Each family's runtime sees its own narrowed plan / execution-plan / middleware types internally — no `unknown`/`any` widening at the family-runtime API surface. | `RuntimeCore<TPlan, TExec, TMiddleware>` is generic over all three; subclasses bind concrete family types. |
| R6 | Observable behavior — telemetry, lints, budgets, beforeCompile rewrites, error envelope, marker verification — is bit-for-bit identical to today. | Refactor-only; lifecycle order preserved; SQL-side responsibilities preserved on `SqlRuntime`; helper lifted verbatim from existing implementations. |
| R7 | The runtime stack has at most one runtime-layer class per family (no two-layer composition). | `SqlRuntime` extends the base directly; today's outer-vs-inner split collapses. |
| R8 | Layering rules are preserved: framework packages do not import family packages. | All cross-family abstractions live in `framework-components`; family-specific types live in family domains. Verified by `pnpm lint:deps`. |
| R9 | The SQL ORM client uses the canonical executor interface, not a parallel duplicate. | `RuntimeQueryable` in `@prisma-next/sql-orm-client` is reconciled with `RuntimeExecutor<SqlExecutionPlan>` (replaced or aliased). |

# Acceptance criteria

Behavioral checks an implementer / reviewer can run. Each maps to one or more requirements above.

### Lifecycle parity (R1, R2, R6)
- [ ] All existing tests in `packages/2-sql/5-runtime/test/`, `packages/2-mongo-family/7-runtime/test/`, and `test/integration/test/` pass without modification (other than import-path updates from type relocation).
- [ ] The cross-family middleware integration test from `cross-family-middleware-spi` (one generic telemetry middleware running on both runtimes) continues to observe identical plan metadata and `{ rowCount, latencyMs, completed }` summaries on both families.
- [ ] A new dedicated unit test for `runWithMiddleware` covers: registration order, error path (`completed: false` + rethrow), error inside `afterExecute` during error path is swallowed, zero-middleware passthrough.

### Lifecycle uniqueness (R1, R2)
- [ ] No file in the repo other than `runWithMiddleware` iterates middleware around a driver loop. Verified by source-level grep against the post-change tree (no `for ... of middleware` patterns inside execute methods).
- [ ] Deleting `runWithMiddleware` causes both `SqlRuntime` and `MongoRuntime` test suites to fail.

### Type relocation (R3)
- [ ] `@prisma-next/contract/types` no longer exports `ExecutionPlan`. The `.d.mts` for the package contains no `ExecutionPlan` symbol.
- [ ] `SqlExecutionPlan` is exported from the SQL domain and is the only place in the repo with `sql: string + params: readonly unknown[]` on a plan-shaped type.
- [ ] `MongoExecutionPlan` is exported from the Mongo domain and wraps the wire command produced by `MongoAdapter.lower`.

### Inheritance (R4, R5, R7)
- [ ] Type test: a minimal subclass of `RuntimeCore` declaring concrete `lower`, `runDriver`, `close` (and nothing else) typechecks and is constructible.
- [ ] Type test: `SqlRuntime` and `MongoRuntime` both nominally extend `RuntimeCore`.
- [ ] No file in the repo defines a `*Runtime` class that wraps another runtime by composition (no `core: RuntimeCore` field pattern).

### Layering (R8)
- [ ] `pnpm lint:deps` passes on `main` after the change. No new violations.
- [ ] Spot-grep: no imports from `@prisma-next/sql-*` or `@prisma-next/mongo-*` exist within `packages/1-framework/**`.

### ORM consolidation (R9)
- [ ] All callers of `RuntimeQueryable` in `@prisma-next/sql-orm-client` either use `RuntimeExecutor<SqlExecutionPlan>` directly or use `RuntimeQueryable` aliased to it. No second hierarchy with its own method shapes survives.

### Documentation
- [ ] `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md` is updated to describe the abstract base, lifecycle template, and family inheritance pattern.

# Non-goals

- **New middleware capabilities.** No `wrap()`, no interception, no short-circuiting, no result injection. WS3 VP4 (Alexey) owns that.
- **Mongo's typed `beforeCompile` rewrite chain.** Out of scope; tracked as a follow-up to PR #373. The base's `runBeforeCompile` defaults to identity for Mongo.
- **Connections / transactions changes.** `connection()` and `transaction()` remain SQL-only on `SqlRuntime`. Alexey is actively refactoring this surface.
- **Symmetrizing the lowering boundary** beyond what falls out of inheritance. We do not coerce `SqlExecutionPlan` and `MongoExecutionPlan` into a common payload shape.
- **Codec / decode middleware visibility changes.** SQL middleware continues to see pre-decode rows; Mongo continues to see driver-yielded rows.
- **Renaming.** `RuntimeCore` keeps its name (it's now genuinely cross-family). `SqlRuntime` and `MongoRuntime` keep theirs.
- **Adding cross-family integration tests beyond what already exists.** The existing proof from `cross-family-middleware-spi` continues to hold; no new ones added.

# Risks

- **Concurrent VP4 work.** Alexey's interception/short-circuiting may touch `RuntimeMiddleware`. Mitigation: this project explicitly excludes the `wrap()` capability and is structured so that an additive `wrap` capability later extends `RuntimeMiddleware`, not the abstract base.
- **Concurrent connection/transaction work.** Alexey is actively in `RuntimeConnection`/`RuntimeTransaction`. We touch `connection()`/`transaction()` only by relocating them from outer wrapper to the unified `SqlRuntime` class — same shapes. Expected to merge cleanly.
- **`Middleware<TContract>` vs `RuntimeMiddleware<TPlan>` divergence.** The repo currently has both: `RuntimeMiddleware<TPlan>` in `framework-components` (the canonical SPI from `cross-family-middleware-spi`) and `Middleware<TContract>` in `runtime-executor` (legacy, used by `RuntimeCoreImpl` and SQL-side middleware authoring). The abstract base's `TMiddleware` constraint must be `RuntimeMiddleware<TPlan>`; the implementer must reconcile any references to `Middleware<TContract>` during the migration. Mitigation: this reconciliation is explicit in the plan's first milestone.
- **Runtime stack regression undetected by existing tests.** Test suite is comprehensive but not exhaustive. Mitigation: integration tests on real Postgres + real Mongo; manual smoke run of the demo app post-migration.

# References

- **Linear ticket:** [TML-2242 — Unified runtime executor and query plan interfaces across SQL and Mongo](https://linear.app/prisma-company/issue/TML-2242/unified-runtime-executor-and-query-plan-interfaces-across-sql-and).
- **Predecessor project:** `projects/cross-family-middleware-spi/` — landed framework SPIs and the `Plugin → RuntimeMiddleware` rename. This project builds directly on its surface.
- **Pre-flight dependency:** [PR #373 — `feat(sql-runtime): add beforeCompile middleware hook`](https://github.com/prisma/prisma-next/pull/373) — adds the SQL pre-lowering rewrite chain that this project lifts into the abstract base lifecycle as `runBeforeCompile`.
- **Related project:** `projects/orm-consolidation/` — depends on the `RuntimeQueryable` reconciliation delivered here.
- **Architecture overview:** `docs/Architecture Overview.md` — thin-core / fat-targets philosophy.
- **Subsystem doc to update:** `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`.
- **ADR 011 — Unified Plan model across lanes**, **ADR 014 — Runtime hook API** (formally stale; superseded by middleware SPI), **ADR 016 — Adapter SPI for lowering relational AST**.

### Key files (current state)

- `packages/1-framework/0-foundation/contract/src/types.ts` — current `ExecutionPlan` (relocated to SQL).
- `packages/1-framework/1-core/framework-components/src/runtime-middleware.ts` — current SPIs; gains `QueryPlan`/`ExecutionPlan` markers and the abstract `RuntimeCore`.
- `packages/1-framework/4-runtime/runtime-executor/src/runtime-core.ts` — current `RuntimeCoreImpl` (deleted; responsibilities split).
- `packages/2-sql/4-lanes/relational-core/src/plan.ts` — `SqlQueryPlan` (re-bases onto `QueryPlan`).
- `packages/2-sql/5-runtime/src/sql-runtime.ts` — `SqlRuntimeImpl` (becomes single-class subclass).
- `packages/2-sql/5-runtime/src/lower-sql-plan.ts` — `lowerSqlPlan` (called from `SqlRuntime.lower`).
- `packages/2-sql/5-runtime/src/middleware/before-compile-chain.ts` — chain (called from `SqlRuntime.runBeforeCompile`).
- `packages/2-mongo-family/4-query/query-ast/src/query-plan.ts` — `MongoQueryPlan` (re-bases onto `QueryPlan`).
- `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts` — `MongoRuntimeImpl` (becomes single-class subclass).
- `packages/3-extensions/sql-orm-client/src/types.ts` — `RuntimeQueryable` (reconciled).

# Alternatives considered

### A1. Higher-order factory `createRuntimeCore({ lower, runDriver, runBeforeCompile? })` instead of an abstract class

A factory would let us avoid classes/inheritance and stay closer to the repo's interface+factory convention. Rejected because:
- The polymorphism here is genuine: every runtime has the same lifecycle, exactly two abstract steps differ. An abstract base captures that constraint *structurally* — a factory shifts the constraint to documentation.
- Subclasses also legitimately add family-specific public methods (e.g., `connection()`, `transaction()` on `SqlRuntime`); a factory return value would have to widen its return type or use composition, regaining the two-layer awkwardness we're removing.
- AGENTS.md's preference is a guideline; the rule explicitly allows abstract bases when polymorphism is real.

### A2. Move `RuntimeCore` into the SQL domain (rename it `SqlRuntimeCore`)

This was an early idea once we noticed today's `RuntimeCore` is SQL-shaped. Rejected because the right move is to *fix* the SQL coupling (lift `ExecutionPlan` out, generalize `RuntimeCore`), not to admit it. After the fix, `RuntimeCore` is genuinely cross-family.

### A3. Symmetrize the lowering boundary across SQL and Mongo

SQL's user-facing runtime accepts a `SqlQueryPlan` (AST) *or* a pre-lowered `SqlExecutionPlan` (raw-SQL lane); Mongo accepts only `MongoQueryPlan`. We could push SQL's raw-SQL path through `SqlQueryPlan` too, or push Mongo's lowering outside the runtime. Rejected as out of scope: the inheritance model accommodates the asymmetry (`lower` handles raw-SQL bypass internally), and harmonizing the boundary is a separate architectural decision worth its own ticket.

### A4. Run middleware on `TPlan` (pre-lowering) instead of `TExec` (post-lowering)

This would preserve today's Mongo behavior (Mongo middleware sees `MongoQueryPlan`, not the wire command) but break today's SQL behavior (telemetry's `computeSqlFingerprint(plan.sql)` requires the lowered form). PR #373 already split the question by introducing `beforeCompile` (pre-lowering) alongside `beforeExecute` (post-lowering); the abstract base inherits that split. Rejected as a unification axis — both phases exist now, families opt into either.

### A5. Add a `wrap(executor)` middleware capability now to dedupe orchestration via composition

We considered making `RuntimeMiddleware` gain a `wrap()` capability so the orchestrator becomes a fold over middleware. Rejected: introduces *new behavior* (interception, short-circuiting) that's WS3 VP4's domain. The simpler dedup goal (extract orchestration into one helper) is achieved without a new capability.

### A6. Combine the framework `ExecutionPlan` marker with the SQL concrete `ExecutionPlan` (no rename, just generalize fields to optional)

Rejected: the framework would still own a SQL-shaped concept (`sql?: string`) and the type would lose precision. Worse for both layering and type strength.

# Open questions

- **`SqlExecutionPlan` home.** `@prisma-next/sql-runtime` is the natural fit. If downstream packages (e.g., `sql-orm-client`) need the type without a runtime-package dependency, a thinner `@prisma-next/sql-execution-plan` package may be warranted. To resolve during M1.
- **`@prisma-next/runtime-executor` package fate.** Once `RuntimeCoreImpl` is gone, the package may have very little left. Decide during M3 whether to keep, fold into `framework-components`, or migrate remaining contents to the SQL domain.
- **`RuntimeFamilyAdapter` post-refactor.** Today framework-located but only SQL uses it (for `markerReader` and `validatePlan`). Likely moves to the SQL domain alongside `SqlRuntime`. To resolve during M3.
- **`RuntimeQueryable` aliasing vs replacement.** Smaller diff wins; decision during M5.
