# WS3: Runtime Pipeline — April Status & May Handoff

**Context**: This document captures the end-of-April state of the Runtime pipeline workstream defined in [april-milestone.md § Workstream 3](./april-milestone.md). It is intended as input for May planning — specifically [WS2: Transactions + query surface](./may-milestone.md#ws2-transactions--query-surface), which is the direct continuation of this work.

**Linear project**: [WS3: Runtime pipeline](https://linear.app/prisma-company/project/ws3-runtime-pipeline-49d3eb5be604)

**Owner**: Alexey

---

## Status snapshot (as of 2026-04-28)

### Validation points

| VP | Title | Progress | Stop condition met? |
|---|---|---|---|
| VP1 | Transactions and SQL DSL as escape hatch | 100% | Yes |
| VP2 | Extension-contributed operations across both query surfaces | 100% (per Linear; see caveat) | Yes for ORM; SQL DSL covered indirectly |
| VP3 | RSC concurrency safety | 100% | Yes |
| VP4 | Middleware supports request rewriting | ~25% — in progress | No (intercept hook landed; caching middleware itself not yet wired end-to-end) |
| VP5 | Runtime interfaces accommodate streaming subscriptions | 0% | No — never started, no Linear ticket exists |
| Side quest | Comparative benchmarks | 0% | No — not started |
| — | Refactoring & clean up | 0% | N/A — bucket for follow-ups surfaced during VP1–VP3 |

### Per-ticket status

#### VP1: Transactions and SQL DSL as escape hatch — Done

| Ticket | Title | Status | Notes |
|---|---|---|---|
| [TML-1912](https://linear.app/prisma-company/issue/TML-1912) | ORM transaction support | Done | Callback-based `db.transaction(fn)` exposing `tx.sql` and `tx.orm` (`PostgresTransactionContext`), commit on success / rollback on error. PRs #345, #346, #347. |
| [TML-2160](https://linear.app/prisma-company/issue/TML-2160) | SQL DSL standalone query execution | Done | "Cross-author similarity" demo (PR #369). Surfaced [TML-2299](https://linear.app/prisma-company/issue/TML-2299). |
| [TML-2161](https://linear.app/prisma-company/issue/TML-2161) | ORM + SQL DSL transaction interop | Done | Both surfaces share the same connection in a tx (PR #346). |

Stop condition (a script that opens a transaction, does two ORM mutations, executes a SQL DSL query within the same transaction, and commits, plus a standalone SQL DSL query) is met. The transactional client (`PostgresTransactionContext`) deliberately does **not** expose a nested `transaction` method — pinned by `transaction.types.test-d.ts`.

#### VP2: Extension-contributed operations across both query surfaces — Done (with caveat)

| Ticket | Title | Status | Notes |
|---|---|---|---|
| [TML-2042](https://linear.app/prisma-company/issue/TML-2042) | Extension operations in `where`/`orderBy` (ORM) | Done | PR #277. pgvector `cosineDistance` works in ORM. |
| [TML-2174](https://linear.app/prisma-company/issue/TML-2174) | Bug: `cosineDistance` had wrong lowering | Done | PR #270. |
| [TML-2162](https://linear.app/prisma-company/issue/TML-2162) | SQL DSL extension-contributed operations | Cancelled (Duplicate) | Subsumed by extension authoring work in the SQL DSL — see "Caveats" below. |

**Caveat — VP2 is reported as 100% but the original VP2 task list included three items that are not fully reflected in shipped tickets:**

1. ORM extension-contributed operations — done via TML-2042. ✅
2. SQL DSL pack extensibility (extension ops surfacing in `db.sql.from(...).where(...)`) — TML-2162 was duplicated/cancelled and the trait gating on the SQL DSL has not been independently proved against a real (non-fixture) emitted contract. [TML-2299](https://linear.app/prisma-company/issue/TML-2299) is direct evidence of a real/fixture contract mismatch on a related capability (`sql.lateral`).
3. Shared operator-trait mapping moved from `sql-orm-client` to `relational-core` — [TML-2163](https://linear.app/prisma-company/issue/TML-2163) (To-do, **High**). This is the explicit follow-up from PR #247 and is still open.

Practically: VP2's *stop condition* (a pgvector op usable on both surfaces, trait gating works on both) is met, but **the architectural cleanup it depends on is still open** (TML-2163) and a real-contract regression test is missing.

#### VP3: RSC concurrency safety — Done

| Ticket | Title | Status | Notes |
|---|---|---|---|
| [TML-2164](https://linear.app/prisma-company/issue/TML-2164) | RSC concurrency safety PoC | Done | Next.js 16 PoC apps for both Postgres and Mongo, k6 stress scripts, integration tests pinning H2/H3 invariants. PR #370. Findings written up in `docs/reference/rsc-concurrency-findings.md`. |

The PoC ran 5 parallel Server Components plus a server action and `/diag`/`/stress` routes with k6. The PoC validated that runtime state, Collection caching, and connection pooling behave correctly under RSC concurrency, and identified one non-correctness finding (H2: cold-start marker-read storm) plus one shape-of-fix item (H3) — both pinned by integration tests.

#### VP4: Middleware supports request rewriting — In progress

| Ticket | Title | Status | Notes |
|---|---|---|---|
| [TML-2143](https://linear.app/prisma-company/issue/TML-2143) | Enhanced middleware API to replace runtime plugin system | In Progress | `intercept` hook landed in both SQL and Mongo runtimes (`runWithMiddleware`); `identityKey` on `RuntimeMiddlewareContext` landed; `canonicalStringify` utility landed; cross-package test demonstrates intercept works in both runtimes. The caching middleware itself — the user-story deliverable — is not yet wired/merged to demonstrate end-to-end short-circuiting against a real database. |

Stop condition (a repeated query is served from cache without hitting the database) is **not yet met**, but the underlying interface change (intercept + identity key) has landed. This is the single biggest April carry-over.

#### VP5: Runtime interfaces accommodate streaming subscriptions — Not started

No Linear tickets were created for VP5. Supabase adapter with streaming capability, runtime `subscribe()` operation, and cancellation/cleanup are all unstarted. This is a deliberate de-prioritization in favor of finishing VP4; it should be re-litigated for May (see "Open question" below).

#### Side quest: Comparative benchmarks — Not started

| Ticket | Title | Status | Notes |
|---|---|---|---|
| [TML-2165](https://linear.app/prisma-company/issue/TML-2165) | Comparative benchmark suite (PN ORM vs PN SQL DSL vs Prisma ORM vs raw pg) | To-do | High |
| [TML-2183](https://linear.app/prisma-company/issue/TML-2183) | Compare `sql-query-builder` to Drizzle in their own benchmark harness | To-do, assigned to Serhii | High |

The "publish as soon as the ORM has enough query support to run the suite" precondition is now realistic — VP1 and VP2 are done.

### Refactoring & clean-up bucket

Surfaced during April work; not on the VP path but flagged for May:

| Ticket | Title | Status | Priority | Notes |
|---|---|---|---|---|
| [TML-2163](https://linear.app/prisma-company/issue/TML-2163) | Shared operator-trait mapping across query surfaces | To-do | High | Direct VP2 follow-up — the architectural cleanup that VP2's stop condition didn't force. |
| [TML-2218](https://linear.app/prisma-company/issue/TML-2218) | Type-safe and ergonomic nullability in extension operations | To-do | High | Design research is **complete** in the ticket (Approaches 1/2/3 prototyped, Approach 2 recommended, Approach 3 validated as the future-proof option). Implementation only. |
| [TML-2299](https://linear.app/prisma-company/issue/TML-2299) | Bug: `sql.lateral` capability not emitted, making `lateralJoin` unusable on real contracts | To-do | Medium | Surfaced by TML-2160. Test fixture/emitted contract mismatch hides it from sql-builder unit tests. |
| [TML-2303](https://linear.app/prisma-company/issue/TML-2303) | Dedupe in-flight contract verification (RSC H2 fix) | Backlog | Medium | ~10-line behavior fix in `RuntimeCoreImpl.verifyPlanIfNeeded()`. Not a correctness bug — wasted marker reads on cold start. Tightens existing PoC integration test from `markerReads ∈ [1, K]` to `markerReads === 1`. |
| [TML-2197](https://linear.app/prisma-company/issue/TML-2197) | Consolidate `RuntimeError` creation into a canonical foundation package | Backlog | Medium | Five inconsistent error sites, none matching ADR 027. Prerequisite for opening the framework to external contributors per ADR 027. Filed by William. |

### Triage / non-VP backlog

| Ticket | Title | Status | Notes |
|---|---|---|---|
| [TML-2137](https://linear.app/prisma-company/issue/TML-2137) | Aggregation over extension expressions (e.g. `avg(cosineDistance(...))`) | Triage | Follow-up to TML-2042. |
| [TML-2138](https://linear.app/prisma-company/issue/TML-2138) | Extension operations in `groupBy()` / `having()` | Triage | Follow-up to TML-2042. |

---

## What April proved (and what it didn't)

**Proved:**

- The ORM and SQL DSL share a transaction context. The escape-hatch story works (VP1).
- Extension-contributed operations flow through the contract into the ORM client with codec-trait gating (VP2 ORM half).
- The runtime is RSC-safe: 5 parallel Server Components, k6 stress, and integration tests pinning the invariants (VP3). The two findings (H2 marker-read storm; H3) are non-blocking and have shipped fix shapes.
- The middleware interface can be extended to support interception — the runtime accepts an `intercept` chain, an `identityKey` is computed, and the SQL and Mongo runtimes both wire it (VP4 plumbing).

**Not proved:**

- That the middleware API supports the *full* short-circuit + result-injection story end-to-end via a working caching middleware (VP4 user story).
- That the runtime, middleware, and plugin interfaces can accommodate streaming subscriptions without architectural contortion (VP5 — entire VP). This is the single largest "we said we'd validate this and didn't" item from April.
- That the SQL DSL's extension operations and trait gating work against real emitted contracts in the sense of regression tests (caveat under VP2).
- That `sql-query-builder` performance is competitive with Drizzle (side quest).

---

## Recommended carry-over into May

May's [WS2: Transactions + query surface](./may-milestone.md#ws2-transactions--query-surface) is the natural home for the VP1/VP2/VP3 follow-ups; VP4/VP5 sit in a more cross-cutting spot that may need its own home. Suggested grouping:

### Must-do in May (blocks May goals or contributors)

1. **Finish VP4 — caching middleware end-to-end**: [TML-2143](https://linear.app/prisma-company/issue/TML-2143). The `intercept` hook, `identityKey`, and `canonicalStringify` plumbing have been authored on the `cache-middleware-intercept` / `cache-middleware-impl` branches but are not yet merged to `main`; the remaining work is to land them and prove the caching middleware end-to-end (short-circuit + result injection) against a real database, plus the spec/plan documents already in the branch. **Highest priority carry-over.**
2. **VP2 architectural cleanup**: [TML-2163](https://linear.app/prisma-company/issue/TML-2163) — shared operator-trait mapping. High priority, blocks consistent SQL DSL trait gating.
3. **Transactions hardening for May Milestone 1**: error envelope on rollback and multi-target validation (Postgres + SQLite + Mongo) per [WS2 Milestone 1](./may-milestone.md#milestone-1-transactions-end-to-end). April only proved Postgres.
4. **`sql.lateral` capability bug**: [TML-2299](https://linear.app/prisma-company/issue/TML-2299). Without this, `lateralJoin` is `never` on real contracts — directly blocks the SQL DSL escape-hatch promise.
5. **RSC H2 fix**: [TML-2303](https://linear.app/prisma-company/issue/TML-2303). Small, scoped, has a written-up fix shape and a test ready to be tightened.

### Should-do in May (high value, medium scope)

6. **Extension operation nullability**: [TML-2218](https://linear.app/prisma-company/issue/TML-2218). Design is complete; implementation should ship Approach 2 (overloads). Unblocks ergonomic pgvector-style ops and is referenced repeatedly in extension authoring.
7. **Comparative benchmark suite**: [TML-2165](https://linear.app/prisma-company/issue/TML-2165) and [TML-2183](https://linear.app/prisma-company/issue/TML-2183). Precondition (enough ORM/SQL DSL coverage) is now met. High-visibility content piece.
8. **Error consolidation**: [TML-2197](https://linear.app/prisma-company/issue/TML-2197). Maps cleanly to May [WS6 Milestone 1: Error envelope consistency](./may-milestone.md#milestone-1-error-envelope-consistency). Should likely move to WS6 in Linear.

### Open question for May planning — VP5 (streaming subscriptions)

VP5 was scoped in April (Supabase adapter + `subscribe()` runtime op + cancellation) and **was not started**. May milestone WS2 does not pick this up. Two options:

1. **Re-scope into May** as a runtime-interface validation milestone, owned by Alexey, on the same shape as the April plan (Supabase JS client adapter, `subscribe()` op, AbortSignal-based cleanup, one change event through the plugin pipeline). This keeps the architectural door open before stabilizing runtime/middleware/plugin interfaces for external contributors — which is the entire point of the April→May arc.
2. **Defer past May** and accept that runtime/middleware/plugin interfaces may need breaking changes when streaming lands. Higher risk to the contributor-stability promise.

The Mongo workstream tracks change streams as `FL-14 → "Future (WS3 VP5)"` in [mongo-target/next-steps.md](./mongo-target/next-steps.md), which assumes option 1. This should be confirmed in May planning.

### Ongoing triage

[TML-2137](https://linear.app/prisma-company/issue/TML-2137) and [TML-2138](https://linear.app/prisma-company/issue/TML-2138) (extension ops in `aggregate`/`groupBy`/`having`) remain in triage. Decide whether to pull them into the May SQL query builder maturity milestone or defer past May.

---

## Notes for the May planner

- VP1/VP2/VP3 stop conditions have all been met, but each left exactly one architectural follow-up open: TML-2163 (VP2), TML-2299 (VP2 real-contract regression coverage), and TML-2303 (VP3 H2 fix). May should not start new query-surface work without scheduling these — they are the part of the April work that was deliberately bounded by the stop condition.
- The middleware intercept plumbing has shipped; pulling the caching middleware over the finish line should be small but is non-trivial because it's the first user of the new hook against a real database.
- The benchmark side quest is now unblocked — it was waiting on enough ORM/SQL DSL coverage to run a representative suite. Worth scheduling as a parallel content track.
- VP5 is the only April commitment that was wholly unstarted. It should get an explicit go/no-go in May planning rather than silently slipping.