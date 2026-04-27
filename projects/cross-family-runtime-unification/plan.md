# Cross-Family Runtime Unification — Plan

## Summary

Five milestones, each landing as one or more PRs. The shape is:

1. **M1 — Plan-marker hierarchy.** Add framework `QueryPlan`/`ExecutionPlan` markers and atomically relocate the SQL-shaped `ExecutionPlan` into the SQL domain. Introduce `MongoExecutionPlan`. Pure type-level work; no runtime behavior change.
2. **M2 — Abstract base + helper.** Add `RuntimeCore` and `runWithMiddleware` to framework-components. Cover them with unit tests using a mock-family subclass. No production runtime adopts them yet.
3. **M3 — SQL migration.** `SqlRuntime` extends `RuntimeCore`; outer-layer `RuntimeCoreImpl` is deleted; SQL-specific responsibilities (codec, marker verification, telemetry fingerprint, beforeCompile chain) move onto `SqlRuntime`.
4. **M4 — Mongo migration.** `MongoRuntime` extends `RuntimeCore`; the inline middleware loop is deleted.
5. **M5 — ORM consolidation.** SQL ORM's `RuntimeQueryable` reconciles with `RuntimeExecutor<SqlExecutionPlan>`.

**Spec:** `projects/cross-family-runtime-unification/spec.md`

## Sequencing rationale

- **Why combine markers and `ExecutionPlan` relocation in one milestone (M1)?** Framework adds a marker `ExecutionPlan` while SQL still has a concrete `ExecutionPlan` of the same name. Splitting these creates a transient phase where both types are importable and ambiguous. Atomic move avoids that. The work also fits naturally as one type-only PR.
- **Why introduce M2 (base + helper) without adopting it?** It de-risks. M2's correctness can be proven in isolation against a mock family before either real runtime depends on it. M3 and M4 then become near-mechanical migrations.
- **Why SQL before Mongo (M3 → M4)?** SQL is the harder migration: it has the codec wrapping, marker verification, telemetry fingerprint, and `beforeCompile` chain to relocate. Mongo's migration is mostly "delete the inline loop and override two methods." Doing the harder one first surfaces unknown unknowns.
- **Why ORM consolidation last (M5)?** It depends on `SqlExecutionPlan` existing (M1) and on the canonical `RuntimeExecutor<SqlExecutionPlan>` shape being settled (M3+M4). No reason to do it earlier.

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution. |
| Reviewer | Senior peer (TBD) | Architectural review of the abstract base + plan-marker hierarchy. |
| Coordinator | Alexey (WS3) | Owns runtime pipeline / VP4 (interception, transactions). This project explicitly leaves connections, transactions, and `wrap()` capabilities untouched; coordinate so the abstract-base shape doesn't constrain VP4. |
| Stakeholder | ORM consolidation owner | Depends on `RuntimeQueryable` reconciliation in M5. |

## Branching strategy

This project is rooted on **PR [#373](https://github.com/prisma/prisma-next/pull/373)**'s branch (`origin/writeable-middleware`), not on `main`. Rationale:

- M3 *lifts* the SQL `beforeCompile` chain (introduced by #373) into `SqlRuntime.runBeforeCompile`. Branching off #373 means M3 moves an existing chain rather than reinventing one, and the same code that #373 introduces is what we relocate.
- M1 retypes `RuntimeMiddleware<TPlan>` while #373 adds `beforeCompile?` to the middleware interface. With #373 already in our base, the retype lands cleanly with the new hook surface visible.

**PR base.** Each PR for this project targets `writeable-middleware` until #373 merges, then re-targets to `main`. After #373 merges, `git rebase origin/main` collapses the #373 commits in our base (they're now upstream), leaving only this project's diff.

**Escape hatch if #373 stalls.** M1 and M2 don't strictly depend on #373's contents — they're pure type relocation and a new abstract base with identity-default `runBeforeCompile`. If #373's review drags, we can split off M1+M2 as PRs against `main` directly. M3 stays on the project branch off `writeable-middleware`. M4 and M5 follow on top of M3 once #373 + M3 land.

## Pre-flight

- [ ] **Project branch rebased onto `origin/writeable-middleware`.** (Done — branch is currently at `b8cde9ebb`.)
- [ ] **Coordinate with Alexey on VP4 timing.** Confirm that the connection/transaction refactor and any planned interception capability won't land mid-flight in a way that conflicts with M3 or M4.
- [ ] **Watch for #373 movement.** Rebase the project branch onto fresh `origin/writeable-middleware` whenever #373 picks up review changes. When #373 merges, rebase onto `origin/main` and re-target open PRs.

## Milestones

### Milestone 1 — Plan-marker hierarchy

**Deliverable.** Framework exports `QueryPlan<Row>` and `ExecutionPlan<Row>` markers. The SQL-shaped `ExecutionPlan` previously in `@prisma-next/contract/types` is gone; `SqlExecutionPlan` exists in the SQL domain. `MongoExecutionPlan` exists in the Mongo domain. Family plan types extend the framework markers.

**Done when.** `pnpm build`, `pnpm test:packages`, `pnpm test:integration`, and `pnpm lint:deps` all pass. `rg "ExecutionPlan" packages/1-framework` returns only references to the framework marker (no SQL-shaped fields).

**Decisions to make in this milestone.**
- Home for `SqlExecutionPlan`: default to `@prisma-next/sql-runtime`. If downstream packages would gain unwanted dependencies, consider a thinner `@prisma-next/sql-execution-plan` package.
- Home for `MongoExecutionPlan`: default to `@prisma-next/mongo-family-runtime` alongside `MongoMiddleware`. Alternative: `@prisma-next/mongo-query-ast`.
- Home for `ResultType<P>` (today co-located with `ExecutionPlan` in `@prisma-next/contract/types`, coupled to both `ExecutionPlan<infer R>` and `SqlQueryPlan._Row`): pick (a) framework alongside `QueryPlan` (working off `_row`), or (b) SQL domain alongside `SqlExecutionPlan`. Choose whichever yields the smaller import-graph diff.

**Tasks.**

- [ ] **1.1** Add `QueryPlan<Row>` and `ExecutionPlan<Row>` to `@prisma-next/framework-components/runtime`. `QueryPlan<Row>` carries `{ readonly meta: PlanMeta; readonly _row?: Row }`. `ExecutionPlan<Row> extends QueryPlan<Row>` with no extra fields.
- [ ] **1.2** Type tests: today's `SqlQueryPlan`, today's SQL `ExecutionPlan`, and today's `MongoQueryPlan` are all assignable to `QueryPlan<Row>`. Negative test: `{}` is not.
- [ ] **1.3** Tighten `RuntimeExecutor<TPlan extends QueryPlan>` and `RuntimeMiddleware<TPlan extends QueryPlan>` to use the new constraint. Update narrowing types (`SqlMiddleware`, `MongoMiddleware`) accordingly.
- [ ] **1.4** Reconcile the legacy `Middleware<TContract>` in `@prisma-next/runtime-executor` with `RuntimeMiddleware<TPlan>`: confirm one of (a) `Middleware<TContract>` is structurally `RuntimeMiddleware` already, (b) it should be replaced by `RuntimeMiddleware`, or (c) both will continue to coexist with explicit narrowing. Document the choice; this is the input for M2 (`RuntimeCore`'s `TMiddleware` constraint).
- [ ] **1.5** Introduce `SqlExecutionPlan<Row>` in the SQL domain. Shape: `{ sql: string; params: readonly unknown[]; ast?: AnyQueryAst; meta: PlanMeta; _row?: Row }`. Extends framework `ExecutionPlan<Row>`. Add type tests.
- [ ] **1.6** Atomically: (a) remove `ExecutionPlan` export from `@prisma-next/contract/types`, (b) migrate every in-repo reference to import `SqlExecutionPlan` from its new home. Identify call sites with `rg "ExecutionPlan" -t ts` filtered to non-test code first; tests update next. Update `lowerSqlPlan` return type. Update `ResultType<P>` location and imports.
- [ ] **1.7** Update `SqlQueryPlan` (in `@prisma-next/sql-relational-core`) to `extends QueryPlan<Row>` rather than `Pick<ExecutionPlan<...>, ...>`. Keep `params`, `ast`, and the `_Row` phantom.
- [ ] **1.8** Introduce `MongoExecutionPlan<Row>` in the Mongo domain. Wraps the current inline wire-command shape. Extends framework `ExecutionPlan<Row>`. Add type tests. **Note**: `MongoRuntime` is not yet adopting it as the public input — that's M4. M1 just establishes the type and ensures it covers the inline shape.
- [ ] **1.9** Update `MongoQueryPlan` to `extends QueryPlan<Row>` (already structurally compatible — make it nominal).
- [ ] **1.10** Run `pnpm build`, `pnpm test:packages`, `pnpm test:integration`, `pnpm lint:deps`. All green.

### Milestone 2 — Abstract base + middleware orchestrator helper

**Deliverable.** `@prisma-next/framework-components/runtime` exports `runWithMiddleware()` and the abstract `RuntimeCore<TPlan, TExec, TMiddleware>` class. Both are covered by unit tests using a tiny in-test subclass. No production code adopts them yet.

**Done when.** Unit tests for `runWithMiddleware` cover the cases listed in spec AC; type tests for `RuntimeCore` typecheck a minimal subclass.

**Tasks.**

- [ ] **2.1** Add `runWithMiddleware()` helper. Signature: `<TExec extends ExecutionPlan, Row>(exec, middleware, ctx, runDriver: () => AsyncIterable<Row>) => AsyncIterableResult<Row>`. Lifecycle and error path lifted verbatim from today's `RuntimeCoreImpl.#executeWith`.
- [ ] **2.2** Unit tests for `runWithMiddleware`. Cover: zero middleware (passthrough), single middleware (hooks called in order), multiple middleware (registration order), error path (`afterExecute(..., completed: false)` then rethrow), error inside `afterExecute` during error path is swallowed.
- [ ] **2.3** Add abstract `RuntimeCore<TPlan extends QueryPlan, TExec extends ExecutionPlan, TMiddleware extends RuntimeMiddleware<TPlan>>`. Implements `RuntimeExecutor<TPlan>`. Concrete `execute(plan)` template: `runBeforeCompile → lower → runWithMiddleware(exec, middleware, ctx, () => runDriver(exec))`. Abstract: `lower`, `runDriver`, `close`. Concrete identity default for `runBeforeCompile`. Constructor accepts `{ middleware, ctx }`.
- [ ] **2.4** Type tests for `RuntimeCore`. A minimal subclass with concrete `lower`, `runDriver`, `close` typechecks. The `TPlan` constraint flows correctly into `execute(plan)`.
- [ ] **2.5** Behavioral test for `RuntimeCore` with a mock-family subclass. Verifies the lifecycle order: `runBeforeCompile → lower → middleware.beforeExecute → runDriver → middleware.onRow → middleware.afterExecute`.
- [ ] **2.6** Adapt the existing mock-family test from `cross-family-middleware-spi` (`packages/1-framework/4-runtime/runtime-executor/test/mock-family.test.ts` or equivalent) to extend the new abstract base. Family-agnostic middleware semantics still hold.

### Milestone 3 — SQL family migration

**Deliverable.** `SqlRuntime` extends `RuntimeCore<SqlQueryPlan, SqlExecutionPlan, SqlMiddleware>`. The framework-located concrete `RuntimeCoreImpl` is deleted. SQL-specific responsibilities (codec encode/decode, marker verification, telemetry fingerprint, `beforeCompile` chain) move onto `SqlRuntime`. The two-layer composition collapses to one class.

**Done when.** All SQL package tests, integration tests on Postgres, lint:deps, telemetry tests, marker-verification tests, and `beforeCompile`-chain tests pass without modification (other than imports). No file in the repo other than `runWithMiddleware` iterates middleware around a driver loop. `RuntimeCoreImpl` symbol no longer exists.

**Decisions to make in this milestone.**
- Fate of `@prisma-next/runtime-executor` as a package once `RuntimeCoreImpl` is gone (keep / fold into `framework-components` / migrate remaining contents into the SQL domain).
- Home of `RuntimeFamilyAdapter` (today framework-located, only SQL uses it for `markerReader` and `validatePlan`). Likely moves into the SQL domain.
- Insertion point for SQL marker verification within the new `execute()` template (today: pre-middleware-orchestration; needs an explicit hook in the new template — likely as the first step inside the SQL override of `runBeforeCompile`, or as a SQL-side wrapper around `super.execute(plan)`).

**Tasks.**

- [ ] **3.1** Sketch the responsibility map. For each piece of behavior in today's `RuntimeCoreImpl`, document where it lands post-migration: marker verification → SQL-side; SQL fingerprint → SQL-side; `RuntimeFamilyAdapter.validatePlan` → SQL-side; codec validation → already SQL-side, stays; middleware orchestration → `runWithMiddleware`; driver invocation → `SqlRuntime.runDriver`. Capture this map in the M3 PR description for reviewer sanity-check.
- [ ] **3.2** Convert `SqlRuntimeImpl` to extend `RuntimeCore<SqlQueryPlan, SqlExecutionPlan, SqlMiddleware>`. Constructor builds the middleware context, calls `super({ middleware, ctx })`. Override `lower(plan)` (calls `lowerSqlPlan(adapter, contract, plan)`, handling raw-SQL bypass). Override `runDriver(exec)` (calls `Queryable.execute({ sql, params })`). Wrap codec encode/decode around the inherited `execute()` (codec decode runs *after* base yields rows — likely a thin `decodeRows` wrapper around the iterator).
- [ ] **3.3** Override `runBeforeCompile` with the existing `beforeCompile` chain. Lift the `beforeCompile-chain` invocation into `SqlRuntime.runBeforeCompile(plan)`. Existing semantics (rewrite trail logging via `middleware.rewrite`, error propagation) preserved.
- [ ] **3.4** Move SQL marker verification onto `SqlRuntime`. Today this lives in `RuntimeCoreImpl.verifyPlanIfNeeded`; relocate. Insert at the determined point in the SQL execute path (per the M3 decision above) so existing `verify` mode tests pass with no behavior change.
- [ ] **3.5** Move SQL telemetry fingerprint onto `SqlRuntime`. Today `recordTelemetry` uses `plan.sql`; relocate so existing telemetry tests pass.
- [ ] **3.6** Delete `RuntimeCoreImpl` and `createRuntimeCore` from `@prisma-next/runtime-executor`. Update package exports. Apply the M3 decision on the `runtime-executor` package's fate.
- [ ] **3.7** Apply the M3 decision on `RuntimeFamilyAdapter` location. If moving into SQL: update imports across SQL packages; ensure no framework package imports it post-move.
- [ ] **3.8** Run full SQL test suite: `pnpm test:packages` (filtered to SQL packages), `pnpm test:integration` (Postgres). Lints, budgets, telemetry, `beforeCompile`-chain tests, `verify`-mode tests all pass.

### Milestone 4 — Mongo family migration

**Deliverable.** `MongoRuntime` extends `RuntimeCore<MongoQueryPlan, MongoExecutionPlan, MongoMiddleware>`. The inline middleware loop in `MongoRuntimeImpl.execute` is deleted; the lifecycle is inherited from the base via `runWithMiddleware`.

**Done when.** All Mongo package tests pass. The cross-family middleware integration test from `cross-family-middleware-spi` (one generic telemetry middleware on both runtimes) continues to observe equivalent results. `MongoRuntimeImpl` no longer contains a `for ... of middleware` loop around a driver iteration.

**Tasks.**

- [ ] **4.1** Convert `MongoRuntimeImpl` to extend `RuntimeCore<MongoQueryPlan, MongoExecutionPlan, MongoMiddleware>`. Constructor calls `super({ middleware, ctx })` after compatibility validation. Override `lower(plan)` (wraps `adapter.lower(plan)` into a `MongoExecutionPlan`). Override `runDriver(exec)` (calls `driver.execute(exec.wireCommand)`). Override `close()`.
- [ ] **4.2** Delete the inline middleware loop. The base's `execute` template + `runWithMiddleware` cover the same lifecycle. Verify behavior parity through existing Mongo runtime tests.
- [ ] **4.3** Run full Mongo test suite plus the cross-family proof. Generic telemetry middleware produces equivalent observations to today.

### Milestone 5 — SQL ORM `RuntimeQueryable` reconciliation

**Deliverable.** SQL ORM client uses `RuntimeExecutor<SqlExecutionPlan>` (directly or via alias). The duplicate hierarchy is gone.

**Done when.** All SQL ORM tests pass. No second executor interface with its own method shapes survives in `@prisma-next/sql-orm-client`.

**Tasks.**

- [ ] **5.1** Audit `@prisma-next/sql-orm-client` `RuntimeQueryable` usage. List every callsite and the methods used.
- [ ] **5.2** Choose the consolidation strategy: (a) replace `RuntimeQueryable` with direct `RuntimeExecutor<SqlExecutionPlan>` imports, or (b) keep `RuntimeQueryable` as a SQL-domain alias `type RuntimeQueryable = RuntimeExecutor<SqlExecutionPlan>`. Pick the smaller diff.
- [ ] **5.3** Apply the consolidation. Update SQL ORM client and downstream call sites.
- [ ] **5.4** Run `pnpm test:packages` filtered to ORM client + adapters.

### Close-out

- [ ] **C.1** Verify all acceptance criteria in `projects/cross-family-runtime-unification/spec.md`. Tick each criterion against its evidence (test or code reference).
- [ ] **C.2** Update `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`. Document: framework `QueryPlan`/`ExecutionPlan` markers, abstract `RuntimeCore` lifecycle template, family inheritance pattern, `runWithMiddleware` helper, new home of `SqlExecutionPlan`/`MongoExecutionPlan`. Update any `ExecutionPlan` references.
- [ ] **C.3** Update related docs. `docs/Architecture Overview.md` if it references the framework `ExecutionPlan`. ADR 011 references if appropriate. Package READMEs that mention the relocated types. **Includes deferred follow-ups recorded in `reviews/code-review.md § Project follow-ups` — PF-1 (durable docs structural rewrite: `docs/reference/Package Naming Conventions.md`, `docs/architecture docs/Package-Layering.md`, plus scattered `runtime-executor` references in `docs/Architecture Overview.md`, `docs/Error Handling.md`, `docs/architecture docs/adrs/ADR 140 …`; consider a follow-up ADR for the single-tier runtime model collapse rather than in-place ADR 140 edits), PF-2 (Plugin → Middleware terminology drift in `packages/2-sql/5-runtime/README.md` lines 71, 122–128, 146), and PF-3 (collapse the parallel `RuntimeQueryable` declaration in `packages/2-sql/5-runtime/src/sql-runtime.ts` lines 116–120 by promoting `RuntimeScope` to a shared SQL-types declaration — likely `@prisma-next/sql-relational-core` — and importing from both `sql-runtime` and `sql-orm-client`; update the cross-package type test to assert import-path identity rather than just structural compatibility).**
- [ ] **C.4** Update Linear (TML-2242). Mark milestones complete; close the ticket.
- [ ] **C.5** Strip repo-wide references to `projects/cross-family-runtime-unification/**`. Replace with canonical `docs/` links or remove.
- [ ] **C.6** Delete `projects/cross-family-runtime-unification/`.

## Test coverage

Behavioral tests mapped to acceptance criteria. Type-tests support the relocations but are not the primary evidence — behavior-preservation is.

| Acceptance criterion | Test type | Milestone | Notes |
|---|---|---|---|
| Existing SQL/Mongo/integration suites pass unchanged (other than imports) | Regression | M1, M3, M4 | The headline acceptance check. |
| Cross-family middleware integration test still observes identical results on both runtimes | Integration | M4 | Inherited from `cross-family-middleware-spi`. |
| `runWithMiddleware` lifecycle, error path, swallowed `afterExecute` errors | Unit | M2 | Lifted verbatim from `RuntimeCoreImpl.#executeWith`. |
| Mock-family subclass exhibits correct lifecycle order | Behavioral | M2 | `runBeforeCompile → lower → beforeExecute → runDriver → onRow → afterExecute`. |
| No `for ... of middleware` driver loop outside `runWithMiddleware` | Source-grep | M3, M4 | Mechanical assertion. |
| `@prisma-next/contract/types` no longer exports `ExecutionPlan` | Build / type | M1 | `.d.mts` lacks the symbol. |
| `SqlExecutionPlan`, `MongoExecutionPlan` exist in their respective domains | Type test | M1 | Shape and assignability. |
| Framework `QueryPlan` / `ExecutionPlan` markers exist; family plans extend them | Type test | M1 | Positive + negative. |
| `RuntimeExecutor` and `RuntimeMiddleware` parameterized over `TPlan extends QueryPlan` | Type test | M1 | Existing call sites unaffected. |
| Minimal `RuntimeCore` subclass typechecks | Type test | M2 | Constraint flow. |
| `SqlRuntime extends RuntimeCore<...>`, `MongoRuntime extends RuntimeCore<...>` | Type + regression | M3, M4 | Inheritance witnessed by tests passing. |
| SQL marker-verification, telemetry fingerprint, `beforeCompile`-chain tests pass | Regression | M3 | Behavior preserved. |
| `RuntimeCoreImpl` symbol deleted; no callers | Build | M3 | `runtime-executor` builds without it. |
| SQL ORM `RuntimeQueryable` reconciled with `RuntimeExecutor<SqlExecutionPlan>` | Type + regression | M5 | One canonical executor interface. |
| `pnpm lint:deps` passes | Lint | every M | Run before merging each PR. |
| Subsystem doc reflects new architecture | Manual | C.2 | Reviewer sign-off. |

## Open items (kept current as we execute)

- **`SqlExecutionPlan` package home.** Decide during M1.
- **`MongoExecutionPlan` package home.** Decide during M1.
- **`ResultType<P>` relocation.** Decide during M1.
- **`Middleware<TContract>` vs `RuntimeMiddleware<TPlan>` reconciliation.** Decide during M1; outcome feeds M2's `TMiddleware` constraint.
- **Fate of `@prisma-next/runtime-executor` as a package.** Decide during M3.
- **`RuntimeFamilyAdapter` post-refactor location.** Decide during M3.
- **Insertion point for SQL marker verification in the new `execute()` template.** Decide during M3.
- **`RuntimeQueryable` aliasing vs replacement.** Decide during M5.
- **VP4 / connections-and-transactions coordination.** Standing item; revisit at every milestone gate.
