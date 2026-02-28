# Kysely lane rollout plan

## Summary

Deliver Kysely-lane work in three stages so we can ship immediate value, then restore architecture, then optionally improve internals.

**Spec:** `projects/kysely-lane-rollout/spec.md`

## Phase artifacts

- Phase 1 spec: `projects/kysely-lane-rollout/specs/01-kysely-integration-merge.spec.md`
- Phase 1 plan: `projects/kysely-lane-rollout/plans/01-kysely-integration-merge.plan.md`
- Phase 2 spec: `projects/kysely-lane-rollout/specs/02-kysely-lane-build-only.spec.md`
- Phase 2 plan: `projects/kysely-lane-rollout/plans/02-kysely-lane-build-only.plan.md`

## Milestones

### Milestone 1: Merge-ready stabilization (Phase 1)

**Goal:** Merge current branch value with minimal scope: fix problems only, defer structural refactors.

**Tasks:**

- [x] Produce a Phase 1 scope boundary doc (allowed vs deferred changes).
- [x] Triage current branch deltas into: must-fix now, can-ship, defer-to-phase-2.
- [x] Fix blockers (failing tests/type/lint, known correctness bugs).
- [x] Run package/integration tests required for confidence.
- [x] Merge Phase 1 PR with clear follow-up links to Phase 2.

### Milestone 2: Architectural extraction to SQL lane (Phase 2)

**Goal:** Move lane concerns to SQL layer and keep execution concerns in extensions.

**Tasks:**

- [x] Create `@prisma-next/sql-kysely-lane` package in `packages/2-sql/4-lanes/`.
- [x] Move transformer, guardrails, build-only lane assembly into lane package.
- [x] Introduce/complete interop contract (`WhereArg`, `ToWhereExpr`) and ORM consumption path.
- [x] Update `@prisma-next/postgres` surface to expose build-only `db.kysely` API.
- [x] Re-scope `@prisma-next/integration-kysely` to runtime attachment responsibilities.
- [x] Enforce fail-fast behavior for unsupported Kysely kinds in runtime attachment paths (no raw fallback).
- [x] Keep Postgres public Kysely API build-only for this phase (no execution-capable public Kysely API).
- [x] Update READMEs and architecture docs for touched packages and decisions.
- [x] Pass `pnpm lint:deps` and targeted test suites.

### Milestone 3: Post-Phase-2 follow-ups (tracked, separate ticket)

**Goal:** Capture and complete follow-up work that’s explicitly **out of Phase 2 scope**, but discovered during Phase 2 review/hardening.

**Tasks:**

- [ ] Follow-up (separate Linear ticket): standardize execution-plane structured runtime error envelopes (PLAN.* helpers) at a low layer, then migrate `integration-kysely` off ad-hoc envelope construction.
  - Ticket: `TML-XXXX` (create)
  - Draft title: `Execution-plane structured runtime error envelopes (PLAN.* helpers)`
  - Draft description:
    - Context: runtime-side PLAN.UNSUPPORTED envelopes are currently constructed ad-hoc in extensions (e.g. `integration-kysely` mutates an Error with `code/category/severity/details`).
    - Goal: define a single source of truth for runtime error envelopes on the execution plane (likely in a low SQL family/shared layer), starting with `PLAN.UNSUPPORTED`.
    - Acceptance criteria:
      - [ ] Canonical helper exists for PLAN.UNSUPPORTED (and any related PLAN errors as needed).
      - [ ] `integration-kysely` uses the helper (no hand-rolled envelope).
      - [ ] Tests cover the helper + at least one migrated call site.

### Milestone 4: Prevent SQL compilation (Phase 3, optional)

**Goal:** Avoid compiling a SQL string that we immediately discard, while keeping the Phase 2 “AST-first plan” shape and reducing reliance on Kysely internals where feasible.

**Tasks:**

- [ ] Define go/no-go criteria for compile-free plan assembly (performance wins vs maintenance/coupling costs).
- [ ] Investigate/implement a compile-free extraction path for:
  - `compiled.query` (Kysely op tree root)
  - `compiled.parameters` (ordering + values) without building `compiled.sql`
- [ ] Preserve Phase 2 invariants:
  - stable param ordering/indexing and descriptor alignment
  - deterministic `meta.refs`
  - guardrails run on supported query shapes
- [ ] Add tests asserting compile-free path equivalence (same `QueryAst` + params ordering as the current compiled path for representative shapes).
- [ ] (Optional) Reduce reliance on Kysely internal node shapes where it’s practical (but only if it doesn’t jeopardize the primary goal above).

## Test Strategy by Milestone

- **M1:** regression and correctness tests for existing integration behavior.
- **M2:** lane package unit tests, integration parity tests, and layering validation.
- **M4 (if implemented):** parity + performance/correctness comparisons against the compiled flow (and confirm SQL string construction is avoided).

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/kysely-lane-rollout/spec.md`
- [ ] Migrate long-lived docs into `docs/`
- [ ] Delete `projects/kysely-lane-rollout/`
