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

- [ ] Produce a Phase 1 scope boundary doc (allowed vs deferred changes).
- [ ] Triage current branch deltas into: must-fix now, can-ship, defer-to-phase-2.
- [ ] Fix blockers (failing tests/type/lint, known correctness bugs).
- [ ] Run package/integration tests required for confidence.
- [ ] Merge Phase 1 PR with clear follow-up links to Phase 2.

### Milestone 2: Architectural extraction to SQL lane (Phase 2)

**Goal:** Move lane concerns to SQL layer and keep execution concerns in extensions.

**Tasks:**

- [ ] Create `@prisma-next/sql-kysely-lane` package in `packages/2-sql/4-lanes/`.
- [ ] Move transformer, guardrails, build-only lane assembly into lane package.
- [ ] Introduce/complete interop contract (`WhereArg`, `ToWhereExpr`) and ORM consumption path.
- [ ] Update `@prisma-next/postgres` surface to expose build-only `db.kysely` API.
- [ ] Re-scope `@prisma-next/integration-kysely` to runtime attachment responsibilities.
- [ ] Update READMEs and architecture docs for touched packages and decisions.
- [ ] Pass `pnpm lint:deps` and targeted test suites.

### Milestone 3: Direct PN AST construction (Phase 3, optional)

**Goal:** Decide and implement direct PN AST construction only if justified.

**Tasks:**

- [ ] Define go/no-go criteria for direct PN AST (maintainability/performance/correctness).
- [ ] If go: implement direct construction path and update tests/docs.
- [ ] If no-go: document deferral rationale and create a tracked follow-up item.

## Test Strategy by Milestone

- **M1:** regression and correctness tests for existing integration behavior.
- **M2:** lane package unit tests, integration parity tests, and layering validation.
- **M3 (if implemented):** parity + performance/correctness comparisons against previous flow.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/kysely-lane-rollout/spec.md`
- [ ] Migrate long-lived docs into `docs/`
- [ ] Delete `projects/kysely-lane-rollout/`
