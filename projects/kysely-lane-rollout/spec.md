# Summary

This project takes the existing Kysely integration work and turns it into something Prisma Next can actually “see” and reason about, then (in a follow-up phase) extracts it into a **real, build-only query lane** in the SQL domain.

Concretely:

- **Phase 1 (merge what we have):** keep the current runtime-attached integration, but make it *usable as Prisma Next* by producing **Prisma Next `QueryAst`** in query plans (not just SQL strings) so adapters/plugins/guardrails can inspect and enforce behavior.
- **Phase 2 (make it a lane):** move Kysely authoring + transform + guardrails into `packages/2-sql/4-lanes/` as `@prisma-next/sql-kysely-lane` (build-only; no runtime dependency).
- **Phase 3 (optional):** reduce/remove reliance on Kysely compilation/AST by constructing PN AST directly where it’s beneficial.

# Description

This is a **project-tracking spec** for a piece of work that has had multiple author handoffs and a shifting understanding of what “done” means. The goal is to make the intent legible to someone joining mid-stream and to keep Phase 1 “merge now” work from getting entangled with Phase 2 “fix the architecture” work.

## How we got here (context)

This effort started as a pragmatic integration: “let developers use Kysely’s fluent SQL builder, but execute via the Prisma Next runtime.” The initial version minimized stitching complexity by treating Kysely as a black box:

- Kysely query → **compile to SQL string** → attach SQL string to a plan → execute through runtime.

That approach created two foundational problems:

1. **Black-box plans**: Prisma Next runtime plugins and guardrails couldn’t understand the query because there was no Prisma Next AST on the plan—only SQL text.
2. **Wrong architectural shape**: this was not a lane. It was runtime-attached, so it couldn’t live alongside other build-only query lanes in the SQL domain.

The branch we’re currently on (`tml-1892-transform-kysely-ast-to-pn-ast`) is an attempt to fix the most damaging consequence first: **ensure Kysely-authored queries produce Prisma Next-native plans with Prisma Next AST** so the system can reason about them.

## What each phase means (in concrete terms)

This project coordinates:

1. **Phase 1 (merge-ready, “make it usable”):**
   - Keep the Kysely integration attached to the runtime (no big package moves).
   - Ensure query plans carry **PN `QueryAst` + metadata**, and that execution uses Prisma Next’s lowering path (adapter), not Kysely’s compiled SQL string.
   - Result: the integration is still not a “lane,” but it becomes observable/enforceable inside Prisma Next and is safe to use.
2. **Phase 2 (architecture, “make it a lane”):**
   - Implement the intended design from `agent-os/specs/2026-02-19-kysely-query-lane-build-only/spec.md`.
   - Create `@prisma-next/sql-kysely-lane` in the SQL domain lanes layer, move transform/guardrails/build-only semantics there, and keep runtime attachment (if needed) in extensions.
3. **Phase 3 (optional, “make it simpler/stronger”):**
   - Where useful, bypass Kysely AST/compile dependencies and construct PN AST directly (or narrow the reliance on Kysely internals).

# Requirements

## Functional Requirements

- As a maintainer, I can merge Phase 1 with a bounded scope (“fix problems, don’t refactor architecture”).
- As a runtime/plugin author, I can inspect Kysely-authored plans because they include PN AST, not only SQL strings.
- As a platform owner, I can complete Phase 2 by moving Kysely lane responsibilities into the SQL lanes layer (`@prisma-next/sql-kysely-lane`) and keeping runtime attachment separate.
- As a teammate joining later, I can read this spec and immediately understand:
  - what the original approach was,
  - why it failed (black-box plans + wrong layering),
  - what Phase 1 ships,
  - what Phase 2 fixes,
  - what Phase 3 optionally improves.

## Non-Functional Requirements

- **Change risk control:** Each phase must be shippable independently with test coverage for its acceptance criteria.
- **Architecture conformance:** Phase 2 must pass `pnpm lint:deps` with intended layer boundaries.
- **Regression safety:** Existing supported Kysely behavior in tests must remain stable through Phase 1 and Phase 2.
- **Developer clarity:** Project artifacts must make scope boundaries explicit to avoid “hidden refactor” creep.
- **Assumption:** No immediate external API freeze requires bundling all 3 phases into one release.

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

- [ ] `@prisma-next/sql-kysely-lane` exists under `packages/2-sql/4-lanes/` and owns build-only Kysely authoring + transform + guardrails.
- [ ] `@prisma-next/sql-kysely-lane` does **not** depend on `@prisma-next/sql-runtime` and passes `pnpm lint:deps`.
- [ ] Any runtime-attached Kysely execution surface is clearly separated (kept in extensions) and delegates lane responsibilities to the lane package.
- [ ] Public Postgres client surface provides a build-only `db.kysely` (no runtime argument) per the Phase 2 spec.

## Phase 3 (optional)

- [ ] A decision is recorded: implement direct PN AST construction now, or explicitly defer with rationale + a tracked follow-up.

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

- `agent-os/specs/2026-02-19-kysely-query-lane-build-only/spec.md` (intended Phase 2 spec)
- Current working branch: `tml-1892-transform-kysely-ast-to-pn-ast` (intended Phase 1 merge branch)
- `projects/kysely-lane-rollout/plans/plan.md` (execution breakdown for this project)

# Open Questions

1. For Phase 1, what’s the merge gate?
   - Only “tests green + typecheck + lint”?
   - Also “docs updated for new behavior”?
2. In Phase 1, what is the exact definition of “supported Kysely queries” we promise not to regress?
3. In Phase 2, for unsupported Kysely node kinds in runtime attachment: keep raw fallback, or fail fast with a stable error?
4. PR slicing: one PR per phase, or Phase 2 split into multiple PRs (lane package + ORM interop + Postgres surface + integration rescope)?
5. What would force Phase 3 now (vs later): performance ceiling, correctness gap, Kysely API instability, or maintenance burden?
