# Summary

Add a `beforeCompile` hook to `SqlMiddleware` that receives the lane's `SqlQueryPlan` as a typed draft and may return a rewritten AST. The runtime chains middlewares in registration order, lowers once after the chain completes, and logs each rewrite by middleware name. This is the first deliverable of Linear TML-2143; caching / short-circuit / annotation DSL follow in later milestones.

# Description

The current middleware system is observation-only. `beforeExecute`, `onRow`, and `afterExecute` all return `Promise<void>`; plans are immutable (ADR 002); the `ast` field on `ExecutionPlan` is typed `unknown` on the middleware surface. Users who need cross-cutting query rewrites — soft-delete filters, tenant isolation, audit-row scoping — have no supported path today.

This spec adds query rewriting as a first-class capability on the SQL family runtime. It does so without changing cross-family primitives (`RuntimeMiddleware`, `RuntimeCoreImpl`) or lane authoring APIs (DSL / ORM `.build()` stay as-is). The design leans on two existing structural properties: lane `.build()` already returns a pre-lowering `SqlQueryPlan` (per ADR 016), and the SQL relational-core already ships a writable AST rewriter (`AstRewriter`, `SelectAst.with*`, etc.).

Note: ADR 014 ("Runtime Hook API") sketched a `HookResult { plan?, violations?, ... }` envelope but is **stale and superseded**. TML-2143 is the live umbrella initiative. Formal deprecation of ADR 014 is out of scope for this spec.

# Requirements

## Functional Requirements

- **FR1.** A new `beforeCompile(draft, ctx)` hook on `SqlMiddleware`, returning `Promise<DraftPlan | void>`.
- **FR2.** `DraftPlan = { readonly ast: AnyQueryAst; readonly meta: PlanMeta }`. No `sql` or `params` fields — those are produced by `adapter.lower()` after the chain.
- **FR3.** Middlewares compose in registration order; each sees the output of the previous one.
- **FR4.** Returning `void` or a draft whose `ast` reference equals the input's `ast` means passthrough — the chain continues with the same draft, no log, no state change.
- **FR5.** Returning a draft with a new `ast` reference means rewrite — the new draft replaces the current one in the chain.
- **FR6.** `adapter.lower()` is invoked exactly once per query, after the chain completes, on the final draft. Lowering cost is unchanged from today's single call; the chain sits between `.build()` and lowering.
- **FR7.** Each rewrite emits a structured log event via `ctx.log` naming the middleware (`name` is already required on `RuntimeMiddleware`) and the lane.
- **FR8.** Raw-SQL plans (no AST) skip `beforeCompile` naturally — they never reach the pre-lowering branch in `SqlRuntimeImpl`.
- **FR9.** `DraftPlan.ast` is typed as `AnyQueryAst` (from `@prisma-next/sql-relational-core/ast`), not `unknown`.
- **FR10.** The chain runs inside `SqlRuntimeImpl.toExecutionPlan()` before the lowered plan is handed to `RuntimeCoreImpl.execute()`. Contract verification therefore runs on the post-rewrite, post-lowering plan. A single `planId` is assigned after lowering; intermediate drafts have no identity.
- **FR11.** No pre-lowering validation of middleware output. Invalid ASTs (e.g. references to tables not in the contract) surface via the standard `runtimeError` envelope from the lowerer or contract verification. Middleware authors are responsible for producing structurally and semantically valid AST.

## Non-Functional Requirements

- **NFR1.** No change to `RuntimeMiddleware`, `RuntimeCoreImpl`, or generic middleware plumbing. The hook is SQL-family-scoped.
- **NFR2.** No change to lane `.build()` semantics or return type. Existing DSL / ORM code is untouched.
- **NFR3.** Lowering runs exactly once per query, regardless of chain length or number of rewrites. No baseline-plus-penalty cost model.
- **NFR4.** Type safety: no `any`, no `@ts-expect-error`, no `@ts-nocheck`. `AnyQueryAst` is publicly exposed on the middleware surface so users can narrow by `kind` without internal imports.
- **NFR5.** Observability: every rewrite is traceable to its authoring middleware via structured log event. No silent mutations.
- **NFR6.** Backward compatibility: existing `SqlMiddleware` implementations (lints, budgets, telemetry) continue to work unchanged — `beforeCompile` is optional.

## Non-goals

- Caching middleware / short-circuiting execution with static results (return `AsyncIterable<Row>` from a hook). Follow-up milestone in TML-2143.
- User-defined query annotations DSL (`cacheAnnotation`, `.annotate(...)` on builders). Follow-up milestone.
- Mongo family rewriteable-AST — Mongo uses the same `RuntimeMiddleware` SPI but needs its own AST surface. Separate design.
- Middleware ordering metadata (`dependsOn`, `conflictsWith`, priority). Correct ordering is the registering user's responsibility; registration-array order is the sole source of truth.
- Formal deprecation / replacement of ADR 014. Separate cleanup PR.
- Retyping `ExecutionPlan.ast` on existing hooks (`beforeExecute`, `onRow`, `afterExecute`). Transitional state: `beforeCompile` is the typed surface; older hooks stay `unknown` for now.

# Acceptance Criteria

## API surface

- [ ] `beforeCompile(draft, ctx): Promise<DraftPlan | void>` declared on `SqlMiddleware`.
- [ ] `DraftPlan` exported from the SQL runtime package with `ast: AnyQueryAst` and `meta: PlanMeta`.
- [ ] No modifications to `RuntimeMiddleware` in `framework-components`.
- [ ] No modifications to `RuntimeCoreImpl`.
- [ ] Existing `SqlMiddleware` implementations (`lints`, `budgets`) compile without change.

## Runtime behavior

- [ ] Chain iteration runs inside `SqlRuntimeImpl` before `lowerSqlPlan()` is invoked.
- [ ] Middlewares called in registration order.
- [ ] Returning `void` leaves the draft unchanged and emits no log.
- [ ] Returning a draft with the same `ast` reference is treated as passthrough.
- [ ] Returning a draft with a new `ast` reference replaces the current draft.
- [ ] `adapter.lower()` is invoked exactly once per query, after the chain completes.
- [ ] Final lowered plan's `meta.refs` reflects the post-rewrite AST.
- [ ] Contract verification runs on the final lowered plan (post-rewrite).

## Logging

- [ ] Each rewrite emits a structured event: `{ event: 'middleware.rewrite', middleware: <name>, lane: <lane> }`.
- [ ] Log level is `debug`.
- [ ] No log event is emitted for passthrough (void / same-ref return).

## Tests

- [ ] Soft-delete-style middleware: injects `WHERE deleted_at IS NULL` into a `SelectAst` via `AstRewriter` / `.withWhere()`; final SQL reflects the rewrite.
- [ ] Chaining: two middlewares both rewrite the same query; final SQL contains both rewrites; registration order is reflected.
- [ ] Passthrough: middleware returns `void`; draft reaches lowering unchanged; no log emitted.
- [ ] Same-ref passthrough: middleware returns `{ ...draft }` without touching `ast`; no log emitted.
- [ ] Raw-SQL bypass: plan with no AST skips `beforeCompile`; middleware hook is not invoked.
- [ ] Log fidelity: each rewrite produces exactly one log event with correct middleware name and lane.
- [ ] Error propagation: throwing inside `beforeCompile` surfaces via the `runtimeError` envelope, no silent swallow.

# Other Considerations

## Security

AST-constructed predicates are parameterized by default: middleware authors use `BinaryExpr.eq`, `Literal.*`, and `ColumnRef.of` from `sql-relational-core/ast`, all of which produce structured nodes that the lowerer binds as parameters. There is no new SQL-injection surface introduced by the hook.

The one authoring risk worth documenting: a middleware that constructs `Literal(userInput)` from untrusted input. This is the same risk as any code constructing literals; document in the middleware authoring guide with an explicit warning.

## Cost

Negligible. In-process function calls; no I/O. Lowering cost is unchanged — it was already a single call per query. The incremental cost is O(n) for n middlewares, all of which return within microseconds for typical rewrites.

## Observability

- One structured log event per rewrite (see Acceptance Criteria).
- No new metrics for v1.
- Error path: throwing inside `beforeCompile` uses the existing `runtimeError` envelope path already used by lints / budgets when they throw in `beforeExecute`.
- Telemetry middleware (`@prisma-next/middleware-telemetry`) continues to see the final lowered plan in `beforeExecute` / `afterExecute`; no change needed there.

## Data Protection

No new data is stored. Middleware-rewritten ASTs flow through the same contract verification and lowering path as lane-authored ASTs. No PII surface change.

## Analytics

Not applicable — this is an internal runtime primitive, not a user-observable product surface.

# References

- **Linear TML-2143** — Enhanced middleware API to replace runtime plugin system (umbrella initiative)
- **ADR 002** — Plans are Immutable
- **ADR 013** — Lane-Agnostic Plan Identity
- **ADR 016** — Adapter SPI for Lowering
- **ADR 027** — Error Envelope Stable Codes
- ~~ADR 014~~ — **stale/superseded**; do not use as current reference
- `packages/1-framework/1-core/framework-components/src/runtime-middleware.ts` — `RuntimeMiddleware` SPI
- `packages/2-sql/5-runtime/src/middleware/sql-middleware.ts` — `SqlMiddleware` narrowing
- `packages/2-sql/5-runtime/src/sql-runtime.ts:147` — current lowering invocation site
- `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` — `AstRewriter`, `AnyQueryAst`, `SelectAst.with*` builders

# Open Questions

None — all initial questions resolved during spec review (2026-04-23). Remaining decisions surface at implementation time.
