# Unify Data Transforms with Regular Migration Operations

## Summary

Lower data-transform operations to the standard `{ precheck, execute, postcheck }` shape at factory time and delete the dedicated runner branch and helper that handle them today. Postgres-only, ~200 LOC net deletion. Authoring API unchanged. Side-effect: closes the `runner.ts:184–192` TODO by repairing self-edge no-op detection for free.

**Spec:** [`projects/unify-data-transforms/spec.md`](./spec.md)

## Collaborators

| Role         | Person/Team               | Context                                                           |
| ------------ | ------------------------- | ----------------------------------------------------------------- |
| Maker        | William Madden (TML team) | Drives execution                                                  |
| Reviewer     | TML team                  | Architectural review of runner change + fixture re-emission       |
| Collaborator | Migration system owners   | Visibility on the cleaned-up runner shape; touches `runner.ts`    |
| Dependency   | PR #404 (`invariant-routing-cli`) | Branch base. Provides `plan.providedInvariants`, self-edge no-op detection, and the TODO this project closes. |

## Shipping Strategy

Single PR, three sequenced commits, each safe to deploy independently. No feature flags. The commit boundary is the safety mechanism:

- **Commit 1 (`Step.params` plumbing).** Adds an optional field and threads `step.params ?? []` through `driver.query`. No call site changes behavior because no caller passes `params` yet. Pure plumbing.
- **Commit 2 (lower `createDataTransform`).** New DT ops emit `{ precheck, execute, postcheck }` and no longer carry `check`/`run` fields. The runner's existing `isDataTransformOperation` type guard explicitly checks `'check' in op && 'run' in op` (`runner.ts:54–55`), so the new shape fails the guard and dispatch *falls through to the regular op loop*. The runner's DT branch becomes dead but harmless code; both DDL and lowered DTs run through the unified loop. Production-safe.
- **Commit 3 (delete the runner branch).** Pure dead-code removal. No behavior change; commit 2 already moved every DT through the regular path.

The implicit gate is the type-guard structural check, not a flag. There is no in-flight state where some DTs use the new shape and some use the old: lowering is at factory time, fixtures are re-emitted in commit 2, and there is no on-disk persistence of the old shape outside fixtures.

## Test Design

Acceptance criteria in the spec drive test cases. Existing test surfaces cover most ACs; a small number of new assertions are added.

| AC   | TC    | Test Case                                                                                                      | Type            | Milestone | Expected Outcome                                                                                                                          |
| ---- | ----- | -------------------------------------------------------------------------------------------------------------- | --------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | TC-1  | Source check: `runner.ts` no longer references `executeDataTransform` or `isDataTransformOperation`            | Manual / source | M1        | Both symbols absent from the runner; no callers anywhere in `packages/3-targets/3-targets/postgres/`                                      |
| AC2  | TC-2  | Idempotent re-apply: apply a DT migration twice via the adapter integration harness                            | Integration     | M1        | Second apply records a `postcheck_pre_satisfied` skip record; execute steps not re-run; ledger row count stable                            |
| AC3  | TC-3  | Failing postcheck: DT whose `run` leaves violations in place                                                   | Integration     | M1        | `POSTCHECK_FAILED` returned; `meta.operationId === 'data_migration.<name>'`; `meta.stepDescription` names the DT                          |
| AC4  | TC-4  | Self-edge no-op DT (extends PR #404 idempotency suite)                                                         | Integration     | M1        | After apply, marker `updated_at` is byte-identical; ledger row count unchanged. Confirms `isSelfEdgeNoOp` fires correctly                  |
| AC5  | TC-5  | Policy gating: a `MigrationOperationPolicy` whose `allowedOperationClasses` omits `'data'`                     | Unit            | M1        | Plan with a DT op rejected with `POLICY_VIOLATION`; the enum still contains `'data'`                                                       |
| AC6  | TC-6  | Parameterised DT run: spy on `driver.query` for a DT whose run carries non-empty params                        | Integration     | M1        | `driver.query` invoked with `(sql, params)` where `params` is the lowered values; SQL text contains `$1`, `$2`, ... not literal values     |
| AC7  | TC-7  | Source check: `DataTransformOperation` is deleted outright (no transitional alias)                             | Manual / source | M1        | The `DataTransformOperation` symbol is not exported from `framework-components` or any downstream package; no runtime branch on `op.check === true \| false` survives anywhere |
| AC8  | TC-8  | Existing migration test surfaces pass: unit, adapter integration, e2e                                          | Pre-existing    | M1        | `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e` all green; `data-transform.e2e.test.ts` passes unchanged  |
| AC9  | TC-9  | Fixtures match new shape                                                                                       | Pre-existing    | M1        | `pnpm fixtures:check` passes; in-tree fixtures for DT-bearing migrations show the new precheck/execute/postcheck shape                     |

## Milestones

### Milestone 1: Unified data-transform execution

The whole project is one milestone delivered as one PR with three commits. Each commit is independently safe (see Shipping Strategy) but the value is the unified runner that lands at the end of commit 3.

**Tasks:**

- [ ] **1.1** _Add `Step.params` and thread through_ — extend `SqlMigrationPlanOperationStep` with optional `params?: readonly unknown[]`; update `runExpectationSteps`, `runExecuteSteps`, `expectationsAreSatisfied` to call `driver.query(step.sql, step.params ?? [])`. Run `pnpm typecheck` + `pnpm test:packages` to confirm no behavior change for existing callers. **Commit boundary 1.** _(satisfies: TC-6 plumbing)_
- [ ] **1.2** _Lower `createDataTransform` to unified shape_ — at the factory, take the user `check` plan and emit:
  - `precheck = [{ sql: \`SELECT EXISTS (${check.sql}) AS ok\`, params: check.params, description: \`Check ${name} has work to do\` }]`
  - `execute = run.map(plan => ({ sql: plan.sql, params: plan.params, description: \`Run ${name}\` }))`
  - `postcheck = [{ sql: \`SELECT NOT EXISTS (${check.sql}) AS ok\`, params: check.params, description: \`Verify ${name} resolved all violations\` }]`
  Change the factory's return type from `DataTransformOperation` to `SqlMigrationPlanOperation`. Update unit tests for `createDataTransform` to assert the new shape. _(satisfies: TC-2, TC-3, TC-6)_
- [ ] **1.3** _Re-emit all in-tree migration fixtures_ — run `pnpm fixtures:check` and commit every regenerated `ops.json` (DT-bearing and otherwise) alongside 1.2. Verify `data-transform.e2e.test.ts` and the adapter idempotency tests pass on the new fixtures. **Commit boundary 2.** _(satisfies: TC-9)_
- [ ] **1.4** _Delete the DT machinery_ — single-commit removal:
  - From `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`:
    - `isDataTransformOperation` type guard at `:47–57`
    - `operationClass === 'data'` dispatch block at `:239–249`
    - `executeDataTransform` helper at `:311–384`
    - The TODO comment at `:184–192`
  - From `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`:
    - `DataTransformOperation` interface — outright deletion, no transitional alias
  - Audit and update any remaining importers of `DataTransformOperation` in the same commit (most should already be unreachable after 1.2).
  - Drop the unused `DataTransformOperation` import from `runner.ts` and from `data-transform.ts` if still present.
  _(satisfies: TC-1, TC-7)_
- [ ] **1.5** _Confirm self-edge repair_ — verify the existing PR #404 self-edge no-op idempotency test (`packages/3-targets/6-adapters/postgres/test/migrations/runner.idempotency.integration.test.ts`) still passes and now exercises the natural code path (no DT-special workaround). If the test was previously passing only because of the TODO'd `operationsExecuted` over-counting masking, refine its assertion to pin the new behavior explicitly. **Commit boundary 3.** _(satisfies: TC-4)_
- [ ] **1.6** _Close-out_ — verify all ACs (above), update the Linear issue with the merged-PR link (the GitHub integration auto-transitions on merge as long as the branch name carries `tml-2292`), strip any references to `projects/unify-data-transforms/` from elsewhere in the repo (no long-lived docs are produced by this project — the spec is internal to the project workspace), and delete `projects/unify-data-transforms/` in the close-out commit (or PR if collected separately).

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm lint:deps`
- `pnpm fixtures:check`

All six commands must pass on the head commit before merging. The first three are essential; `lint:deps` guards layering across the type changes; `fixtures:check` guards the on-disk shape.

## Open Items

The two spec-level open questions are resolved (no `ops.json` schema-version field — re-emit all fixtures; `DataTransformOperation` deletes outright with no transitional alias). Remaining items are follow-ups, not blockers:

- **Follow-up** — diagnostic enrichment for postcheck failures (an optional `step.diagnostic` query) if users miss the today-only "remaining violations" count. Out of scope here; track as a separate ticket if it surfaces.
- **Follow-up** — DDL parameterisation: migrate `SetDefaultCall`, `AddCheckConstraintCall`, partial-index predicates, and other planner sites that currently inline user values onto `Step.params`. Out of scope here; this project only enables it.
- **Follow-up** — extend `pnpm fixtures:check` to cover `examples/*/migrations/` (in-tree migration package `ops.json` files). The harness today diffs only `contract.json`/`contract.d.ts` and a handful of generated fixture dirs; migration-package fixtures are validated indirectly via the migration-hash integrity check inside `readMigrationPackage` and via e2e tests. Surfaced during M1 R1 implementation when the demo's `ops.json` was re-emitted by hand and `migrationHash` recomputed manually rather than via the gate. Track as a separate ticket; would close the loop on AC9-style verification for any future migration-shape change.
