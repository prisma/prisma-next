# Kysely integration merge (Phase 1)

## Summary

Ship the current runtime-attached Kysely integration in a mergeable, stable form by fixing correctness and observability issues (especially: **plans include PN `QueryAst`**, Prisma Next lowering path is used, and unsupported query kinds fail with a stable runtime error envelope). This phase does not attempt the architectural extraction into a build-only lane; that is Phase 2.

**Spec:** `projects/kysely-lane-rollout/specs/01-kysely-integration-merge.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will Madden | Drives Phase 1 merge |
| Reviewer | SQL/runtime maintainers (TBD) | Confirms AST plan shape + error envelope conventions |
| Collaborator | Demo/examples maintainers (TBD) | Ensures examples remain runnable |

## Milestones

### Milestone 1: Define Phase 1 support surface + merge gates

Deliverable: a clear “what’s supported” and “what happens when unsupported” contract for Phase 1.

**Tasks:**

- [ ] Document the Phase 1 merge gate (which `pnpm` scripts must be green).
- [ ] Enumerate supported Kysely query kinds for Phase 1 (by test coverage).
- [ ] Add/confirm policy: unsupported kinds fail with `PLAN.UNSUPPORTED` runtime error envelope, with structured `details` including `lane: 'kysely'` and `kyselyKind`.

### Milestone 2: Correctness + observability fixes (no refactors)

Deliverable: supported Kysely queries produce AST-backed plans and are enforceable by plugins/guardrails.

**Tasks:**

- [ ] Ensure supported Kysely execution path produces plans with `ast: QueryAst` populated and `params` aligned to `meta.paramDescriptors`.
- [ ] Ensure supported execution uses Prisma Next lowering/adapter pipeline (not Kysely-compiled SQL as the execution truth).
- [ ] Add/adjust tests proving runtime plugins/guardrails can inspect and enforce based on the AST-backed plan.
- [ ] Add a test for at least one unsupported query kind that asserts `PLAN.UNSUPPORTED` envelope shape and `details`.

### Milestone 3: Merge readiness

Deliverable: repo is green and Phase 1 is safe to merge.

**Tasks:**

- [ ] Run the Phase 1 merge gate scripts and fix any failures (tests, typecheck, lint).
- [ ] Add minimal docs updates so teammates can use the merged integration without reading history.
- [ ] Ensure Phase 1 docs explicitly link to Phase 2 extraction spec.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Plans include PN `QueryAst` | Integration | Milestone 2 | Assert `plan.ast` present for supported kinds |
| Lowering uses Prisma Next adapter path | Integration | Milestone 2 | Ensure execution does not treat SQL string as authoritative |
| Plugins/guardrails can enforce via AST-backed plan | Integration | Milestone 2 | Prefer a runtime plugin/lint test that inspects `ast` |
| Unsupported kinds fail with `PLAN.UNSUPPORTED` envelope | Unit/Integration | Milestone 2 | Assert `details.lane` and `details.kyselyKind` |
| Repo merge gate passes | CI / Manual | Milestone 3 | Record which scripts define the gate |

## Open Items

- Which unsupported Kysely kind do we use as the canonical test case?
- Confirm which `pnpm` scripts are the agreed Phase 1 merge gate.

