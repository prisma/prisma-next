# PSL Config + CLI Source Plan

> ⚠️ **Superseded / replaced**
>
> This plan describes the **enumerated source kind** approach (`contract.source = { kind: 'psl', schemaPath }`).
> The project has since moved to **provider-based contract sources** (pluggable providers returning `ContractIR` via `Result<>`).
>
> - **Replacement spec**: `projects/psl-contract-authoring/specs/pluggable-contract-sources.spec.md`
> - **Current project plan**: `projects/psl-contract-authoring/plans/plan.md` (Milestone 1)
>
> Keep this file only as historical context for what was implemented earlier on the branch; do not extend it going forward.

## Summary

Implement PSL-first source selection in `prisma-next.config.ts` and wire `prisma-next contract emit` to resolve PSL input without breaking TS-first behavior. Success means users can configure `contract.source = { kind: 'psl', schemaPath: string }`, get clear config errors when invalid, and run emit through the existing offline pipeline.

**Spec:** `projects/psl-contract-authoring/specs/psl-config-and-cli-source.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | William Madden | Owns implementation and rollout |
| Reviewer | Framework/tooling reviewer (TBD) | Reviews config typing/validation and CLI wiring |
| Collaborator | Terminal team | Consumes issue tracking and milestone progress |

## Milestones

### Milestone 1: PSL source config and emit wiring

Deliver the end-to-end config + CLI source path for PSL-first projects while preserving existing TS-first functionality.

**Tasks:**

- [x] Extend `PrismaNextConfig.contract.source` to accept `{ kind: 'psl', schemaPath: string }` with explicit `schemaPath`.
- [x] Add config validation for missing/invalid `schemaPath` with actionable error messages.
- [x] Keep existing TS-first source shapes valid (value and loader function).
- [x] Wire `prisma-next contract emit` to resolve PSL-first source into the emit operation flow (offline, no DB connection).
- [x] Add/update unit tests for config type normalization and validation behavior.
- [x] Add/update CLI integration tests covering PSL-first success path and TS-first regression protection.
- [x] Update CLI/config docs for PSL-first source selection and expected error behavior.

### Milestone 2: Feature verification and handoff

Validate all acceptance criteria for this feature spec and sync references for project-level execution tracking.

**Tasks:**

- [x] Verify each acceptance criterion in the feature spec with linked tests/checks.
- [ ] Ensure this feature plan and the corresponding Linear issue reflect final scope and outcomes.
- [x] Record any follow-up items discovered during verification in the parent project plan/specs.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| PSL-first config shape is accepted | Unit + Integration | Milestone 1 | Config parser + CLI fixture |
| Missing/invalid `schemaPath` errors are actionable | Unit | Milestone 1 | Assert error message includes failing field |
| TS-first config patterns continue working | Integration | Milestone 1 | Regression test fixture |
| `contract emit` routes PSL-first source without DB connection | Integration/E2E | Milestone 1 | Offline execution path |
| PSL-first and TS-first path coverage exists in CLI tests | Integration | Milestone 1 | Shared command coverage |

## Open Items

- None.
