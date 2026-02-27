# Summary

This project takes the existing Kysely integration work and turns it into something Prisma Next can actually “see” and reason about, then (in a follow-up phase) extracts it into a **real, build-only query lane** in the SQL domain.

Concretely:

- **Phase 1 (merge what we have):** keep the current runtime-attached integration, but make it *usable as Prisma Next* by producing **Prisma Next `QueryAst`** in query plans (not just SQL strings) so adapters/plugins/guardrails can inspect and enforce behavior.
- **Phase 2 (make it a lane):** move Kysely authoring + transform + guardrails into `packages/2-sql/4-lanes/` as `@prisma-next/sql-kysely-lane` (build-only; no runtime dependency).
- **Phase 3 (optional):** avoid compiling a SQL string that we discard (compile-free plan assembly), and reduce reliance on Kysely internals where it’s practical.

# Description

This is a **project-tracking spec** for a piece of work that has had multiple author handoffs and a shifting understanding of what “done” means. The goal is to make the intent legible to someone joining mid-stream and to keep Phase 1 “merge now” work from getting entangled with Phase 2 “fix the architecture” work.

## How we got here (context)

This effort started as a pragmatic integration: “let developers use Kysely’s fluent SQL builder, but execute via the Prisma Next runtime.” The initial version minimized stitching complexity by treating Kysely as a black box:

- Kysely query → **compile to SQL string** → attach SQL string to a plan → execute through runtime.

That approach created two foundational problems:

1. **Black-box plans**: Prisma Next runtime plugins and guardrails couldn’t understand the query because there was no Prisma Next AST on the plan—only SQL text.
2. **Wrong architectural shape**: this was not a lane. It was runtime-attached, so it couldn’t live alongside other build-only query lanes in the SQL domain.

`tml-1892-transform-kysely-ast-to-pn-ast` branch was an attempt to fix the most damaging consequence first: **ensure Kysely-authored queries produce Prisma Next-native plans with Prisma Next AST** so the system can reason about them.

## What each phase means (in concrete terms)

This project coordinates:

1. **Phase 1 (merge-ready, “make it usable”):**
   - Keep the Kysely integration attached to the runtime (no big package moves).
   - Ensure query plans carry **PN `QueryAst` + metadata**, and that execution uses Prisma Next’s lowering path (adapter), not Kysely’s compiled SQL string.
   - Result: the integration is still not a “lane,” but it becomes observable/enforceable inside Prisma Next and is safe to use.
2. **Phase 2 (architecture, “make it a lane”):**
   - Implement the intended design from `projects/kysely-lane-rollout/specs/02-kysely-lane-build-only.spec.md`.
   - Create `@prisma-next/sql-kysely-lane` in the SQL domain lanes layer, move transform/guardrails/build-only semantics there, and keep runtime attachment (if needed) in extensions.
3. **Phase 3 (optional, “avoid wasted compilation”):**
   - Avoid compiling SQL text purely to obtain `{ query, parameters }`.
   - Primary win: compile-free plan assembly that preserves param ordering/indexing invariants and existing transformer/guardrail behavior.
   - Secondary win: reduce reliance on Kysely internals when it doesn’t compromise the primary goal.

# Requirements

## Functional Requirements

- Phase 1 is mergeable with a bounded scope: fix correctness/merge blockers, do not extract/refactor the lane architecture.
- Supported Kysely-authored queries produce plans that include PN AST (`QueryAst`) and the plan metadata Prisma Next needs (params, descriptors, refs), not only SQL strings.
- Runtime plugins/guardrails can inspect Kysely-authored plans by relying on the AST-backed plan shape.
- Phase 2 produces a build-only lane package (`@prisma-next/sql-kysely-lane`) in `packages/2-sql/4-lanes/` and moves lane responsibilities there, keeping runtime attachment (dialect/driver/connection) separate.
- Postgres public surface exposes a build-only `db.kysely` authoring API (no runtime argument) per the Phase 2 spec.
- In Phase 2, unsupported Kysely kinds fail fast with a stable structured error in runtime attachment paths (no raw fallback).
- In Phase 2, no execution-capable public Kysely API is exposed from `@prisma-next/postgres`.

## Non-Functional Requirements

- **Change risk control:** Each phase must be shippable independently with test coverage for its acceptance criteria.
- **Architecture conformance:** Phase 2 must pass `pnpm lint:deps` with intended layer boundaries.
- **Regression safety:** Existing supported Kysely behavior in tests must remain stable through Phase 1 and Phase 2.
- **Scope clarity:** Phase boundaries must stay explicit to avoid “hidden refactor” creep.

## Non-goals

- Rewriting unrelated SQL/ORM components outside Kysely lane boundaries.
- Broad cleanup/refactoring in Phase 1 that is not tied to correctness or mergeability.
- Committing to Phase 3 unless it materially improves maintainability/perf/correctness versus Phase 2.
- Solving Kysely compile-free parameter extraction in this project unless it becomes necessary for Phase 2 completion.

# Acceptance Criteria

## Phase 1 (merge-ready)

- [ ] Phase 1 scope boundary is documented (what we will fix vs explicitly defer to Phase 2).
- [ ] Supported Kysely-authored queries produce Prisma Next plans that include **PN AST** (`QueryAst`) and lane metadata.
- [ ] Execution no longer treats Kysely as a SQL-string black box for supported queries (Prisma Next lowering/adapters/plugins can “see” the query).
- [ ] Tests demonstrate that runtime plugins/guardrails can inspect/enforce behavior based on the AST-backed plan.
- [ ] Phase 1 is merged without attempting the lane extraction refactor.

## Phase 2 (architectural lane extraction)

- [x] `@prisma-next/sql-kysely-lane` exists under `packages/2-sql/4-lanes/` and owns build-only Kysely authoring + transform + guardrails.
- [x] `@prisma-next/sql-kysely-lane` does **not** depend on `@prisma-next/sql-runtime` and passes `pnpm lint:deps`.
- [x] Any runtime-attached Kysely execution surface is clearly separated (kept in extensions) and delegates lane responsibilities to the lane package.
- [x] Public Postgres client surface provides a build-only `db.kysely` (no runtime argument) per the Phase 2 spec.

## Phase 3 (optional)

- [ ] A decision is recorded: implement compile-free plan assembly now, or explicitly defer with rationale + a tracked follow-up.

# Other Considerations

## Security

No new auth surface is expected. Guardrails that prevent unsafe query patterns (for example broad mutations/selects without predicates where policy requires them) must remain active and tested through refactors.

## Cost

Primary cost is engineering time and review cycles; infra/runtime cost impact should be negligible because changes are in planning/build behavior and package boundaries.

## Observability

Use test coverage and CI gates as the core observability mechanism for this project:

- lane/transform unit tests
- integration tests for parity behavior
- dependency-layer checks (`pnpm lint:deps`)

## Data Protection

No expected change to data retention or sensitive-data handling semantics. Ensure refactors do not weaken existing query guardrail behavior.

## Analytics

No product analytics changes required. Development analytics are commit/test/CI outcomes per phase.

# References

- Drive spec (Phase 1): `projects/kysely-lane-rollout/specs/01-kysely-integration-merge.spec.md`
- Drive plan (Phase 1): `projects/kysely-lane-rollout/plans/01-kysely-integration-merge.plan.md`
- Drive spec (Phase 2): `projects/kysely-lane-rollout/specs/02-kysely-lane-build-only.spec.md`
- Drive plan (Phase 2): `projects/kysely-lane-rollout/plans/02-kysely-lane-build-only.plan.md`
- Current working branch: `tml-1892-transform-kysely-ast-to-pn-ast` (intended Phase 1 merge branch)
- `projects/kysely-lane-rollout/plan.md` (execution breakdown for this project)

# Open Questions

1. For Phase 1, what’s the merge gate beyond “tests/typecheck/lint green” (if anything)?
2. What would trigger Phase 3 work now (vs later): compilation cost/p95 planning latency, Kysely internals churn, correctness gaps, or maintenance burden?

# Follow-ups (post-Phase-2)

- Standardize execution-plane structured runtime error envelopes (PLAN.* helpers) at a low layer, then migrate `integration-kysely` off ad-hoc envelope construction (start with `PLAN.UNSUPPORTED`).

# Decision Log

- Phase 2 unsupported-kinds behavior: **fail fast** with stable structured errors in runtime attachment paths.
- Phase 2 Postgres API shape: `db.kysely` is **build-only only**; no execution-capable public Kysely API.
- Phase 2 ORM interop behavior: `ToWhereExpr` payloads are consumed via strict index/alignment validation and literal normalization (`ParamRef -> LiteralExpr`) at ORM boundaries.
