# Summary

Lower data-transform operations to the standard `{ precheck, execute, postcheck }` shape at factory time and delete the dedicated runner branch that handles them today. Postgres-only, ~200 LOC net deletion. The user-facing `ctx.dataTransform({ name, check, run })` API does not change.

# Context

## At a glance

The Postgres migration runner has two execution paths today: a regular op loop that runs `precheck → execute → postcheck`, and a parallel branch for data transforms that hand-rolls a `check → (skip or run) → check` lifecycle in a 70-line helper. The two paths converge on the same idea — "if state is already correct, skip; otherwise run; afterwards verify" — but expose it through different op shapes and different code.

This project collapses the parallel path. `createDataTransform` lowers a user-authored `check`/`run` pair into the standard precheck/execute/postcheck shape at factory time, and the runner's data-transform dispatch and helper delete. A single op loop handles every operation.

The lowering reuses the same source query in both checks, with opposite truth values:

```ts
// Authored
ctx.dataTransform({
  name: 'backfill_users_email',
  check: () => db.users.find({ where: { email: { isNull: true } } }),
  run:   () => db.users.update({ where: { email: { isNull: true } }, data: { email: 'n/a' } }),
});

// Lowered into ops.json
{
  id: 'data_migration.backfill_users_email',
  label: 'Data transform: backfill_users_email',
  operationClass: 'data',
  precheck:  [{ sql: 'SELECT EXISTS (SELECT 1 FROM users WHERE email IS NULL) AS ok',     params: [],      description: 'Check backfill_users_email has work to do' }],
  execute:   [{ sql: 'UPDATE users SET email = $1 WHERE email IS NULL',                    params: ['n/a'], description: 'Run backfill_users_email' }],
  postcheck: [{ sql: 'SELECT NOT EXISTS (SELECT 1 FROM users WHERE email IS NULL) AS ok', params: [],      description: 'Verify backfill_users_email resolved all violations' }],
}
```

The runner now treats this op identically to a DDL op. Idempotent re-apply works through the runner's existing pre-satisfied-skip path (`runner.ts:217–226`), which queries postcheck steps and skips the whole op when they're already satisfied.

## Problem

The dual lifecycle exists because today's `DataTransformOperation` carries `check`/`run` instead of `precheck`/`execute`/`postcheck`. The factory at `data-transform.ts` emits the DT-specific shape; the runner type-guards on it (`isDataTransformOperation` at `runner.ts:47–57`), dispatches into `executeDataTransform` (`runner.ts:311–384`), and re-implements every concern the regular loop already handles: idempotency-skip, post-execute validation, error mapping, ledger appending. The two paths drift in subtle ways. For example:

- `executeDataTransform` always increments `operationsExecuted` even when its early-skip fires (`runner.ts:246–247`), where the regular loop's pre-satisfied-skip pushes a synthetic record but does not increment. This under-fires the self-edge no-op detection (`isSelfEdgeNoOp` at `runner.ts:184–199`), and `runner.ts:184–192` carries an explicit TODO for the fix.
- `DataTransformOperation` extends `MigrationPlanOperation` with five DT-specific fields (`name`, `source`, `invariantId`, `check`, `run`). Most have either drifted into uselessness (`source` is the hardcoded string `'migration.ts'`) or duplicate state already carried elsewhere (`name` is encoded in `id` and `label`).
- `DataTransformOperation.check` is typed `SerializedQueryPlan | boolean | null`, but the factory only ever produces `SerializedQueryPlan | null`. The `boolean` branches in the runner are dead.

The runner's existing op loop already supplies what data transforms need; the dedicated branch only exists because the data-transform op shape doesn't *look* like a regular op. Once the lowering produces a unified shape, the branch has no reason to exist.

## Approach

Three changes, each tightly scoped:

**1. Add `params` to the SQL step type.** `SqlMigrationPlanOperationStep` currently carries `{ sql, description, meta? }` and the runner calls `driver.query(step.sql)` with no parameters. Data transforms produce queries with interpolated values from the query builder (where clauses, update sets, defaults), and reusing the driver's parameter binder is strictly safer than rolling a per-driver literal serializer for every type the builder produces. Extend the step type with optional `params?: readonly unknown[]` and thread it through `runExpectationSteps`, `runExecuteSteps`, and `expectationsAreSatisfied`. Pure plumbing, no behavior change for existing call sites.

**2. Lower `createDataTransform` to the unified shape.** At factory time, take the user's check query plan and emit two wrappings: `SELECT EXISTS (<check.sql>) AS ok` for precheck (asserts "work to do"), `SELECT NOT EXISTS (<check.sql>) AS ok` for postcheck (asserts "work done"). The run query plans become execute steps, each with their `params` threaded through. The factory's return type changes from `DataTransformOperation` to `SqlMigrationPlanOperation` — the user-facing parameter API is unchanged, only the produced op shape moves.

**3. Delete the runner branch and `DataTransformOperation`.** Remove `isDataTransformOperation`, the `operationClass === 'data'` dispatch at `runner.ts:239–249`, and the `executeDataTransform` helper at `runner.ts:311–384`. Delete the `DataTransformOperation` interface outright — no transitional alias. The dispatch becomes dead code as soon as step 2 lands (the type guard explicitly checks for `'check' in op && 'run' in op`, which the new lowered shape doesn't satisfy), so step 3 is pure dead-code removal.

`operationClass: 'data'` stays in `MigrationOperationClass`. It's the policy/CI/audit discriminator that gates whether destructive data work is allowed in a given run, and the spec's original "make backfills carry the surrounding DDL class" idea was unmotivated outside of class-flow IR concerns. `DataTransformOperation` itself has nothing left to carry — every field on the unified op shape is already on the base `SqlMigrationPlanOperation`, with `invariantId` already moving onto base ops post-#404 (manifest-emit reads it; the runner reads `plan.providedInvariants` independently).

A side-effect of the unification: the `runner.ts:184–192` TODO closes for free. After the dispatch deletes, a self-edge data transform whose effect is already in place trips the regular loop's pre-satisfied-skip, which does not increment `operationsExecuted`. `isSelfEdgeNoOp` then fires correctly and the marker + ledger writes are skipped, where today they get written even though nothing observable happened.

# Requirements

## Functional Requirements

- **FR1.** `SqlMigrationPlanOperationStep` carries an optional `params?: readonly unknown[]` field. All three runner call sites (`runExpectationSteps`, `runExecuteSteps`, `expectationsAreSatisfied`) pass `step.params ?? []` through to `driver.query`.
- **FR2.** `createDataTransform` produces operations in the unified shape. Given a user-authored `check` query plan and `run` query plans, the emitted op carries:
  - `precheck` = `[{ sql: 'SELECT EXISTS (<check.sql>) AS ok', params: <check.params>, description }]`
  - `execute` = `<run plans>` mapped to steps, `params` preserved
  - `postcheck` = `[{ sql: 'SELECT NOT EXISTS (<check.sql>) AS ok', params: <check.params>, description }]`
- **FR3.** The Postgres runner has a single execution loop. `isDataTransformOperation`, the `operationClass === 'data'` dispatch at `runner.ts:239–249`, and `executeDataTransform` (`runner.ts:311–384`) are deleted.
- **FR4.** `operationClass: 'data'` remains in `MigrationOperationClass`. Policy gating, CI checks, and the marker/ledger paths that read it continue to work unchanged.
- **FR5.** `DataTransformOperation` deletes outright — no transitional alias. `createDataTransform` returns `SqlMigrationPlanOperation`. `invariantId` lives on the SQL op the same way it did before (the manifest emitter reads it for `plan.providedInvariants`). Identity for diagnostics flows through `id` (`data_migration.<name>`) and `label`. The dead `=== true` and `=== false` branches in the runner go with the rest of `executeDataTransform`.
- **FR6.** All in-tree migration fixtures (DT-bearing and otherwise) are re-emitted by the unified pipeline. No `ops.json` schema-version field is introduced; fixture re-emission is the migration strategy. Old `ops.json` files do not need a migration adapter.

## Non-Functional Requirements

- **NFR1.** Existing Postgres data-transform behavior is preserved end-to-end: idempotent re-apply (`db update` against an already-applied DT) skips the op via the runner's pre-satisfied-skip path; a DT whose run fails to resolve violations produces a `POSTCHECK_FAILED` failure carrying `meta.operationId`; a DT with no violations on first apply skips cleanly.
- **NFR2.** Self-edge data-transform no-op detection (`isSelfEdgeNoOp` at `runner.ts:198–199`) fires correctly. The marker and ledger are not written for a self-edge whose only DT pre-satisfied-skips, closing the `runner.ts:184–192` TODO without further code.
- **NFR3.** Net LOC change: ≥150 LOC deleted in `packages/3-targets/3-targets/postgres/` (runner branch, helper, type guard, dead boolean branches), partially offset by lowering changes in `data-transform.ts`. Final diff is net-deletion.
- **NFR4.** Data-transform error diagnostics carry `meta.operationId` (= `data_migration.<name>`) and the relevant `step.description`. The today-only "Data transform 'X' did not resolve all violations (N remaining)" framing is deliberately dropped; failures read as generic operation-postcheck failures.

## Non-goals

- **Mongo data transforms.** The Mongo runner has the same dispatch shape but its "query" is a command document, not parameterized SQL — `Step.params` does not translate. Mongo unification is a parallel project.
- **DDL parameterization.** Today's planner inlines user-provided values (column defaults, CHECK expressions, partial-index predicates, enum labels) via per-call-site escape helpers. The `Step.params` infrastructure introduced here makes parameterizing those sites possible, but doing so is a separate, larger project filed as a follow-up.
- **Authoring API changes.** `ctx.dataTransform({ name, check, run, invariantId? })` stays exactly as-is.
- **`migration.json` (attestation) format changes.** Only `ops.json` is touched.
- **Step-ordering changes.** Data transforms run in the same position within an edge as they do today.
- **Query-builder changes.** The query builder already produces `SerializedQueryPlan`; only `createDataTransform` (the consumer) changes.

# Acceptance Criteria

- [ ] **AC1.** _The Postgres runner has a single execution loop._ Reading `runner.ts`, `isDataTransformOperation`, the `operationClass === 'data'` dispatch block, and `executeDataTransform` are gone. Covers FR3.
- [ ] **AC2.** _Idempotent re-apply of a data transform skips its op via the unified pre-satisfied-skip path._ Apply a migration with a DT against a DB where the DT's effect is already in place; the runner records a `postcheck_pre_satisfied` skip record without re-running the execute step. Covers NFR1.
- [ ] **AC3.** _A failing data transform produces a postcheck failure with operation context._ Apply a DT whose `run` does not resolve the violation the `check` describes; the runner returns `POSTCHECK_FAILED` with `meta.operationId === 'data_migration.<name>'` and a step description naming the DT. Covers NFR1, NFR4.
- [ ] **AC4.** _Self-edge data-transform no-op detection works._ Apply a self-edge migration whose only operation is a DT whose effect is already in place; the marker `updated_at` is byte-identical and the ledger row count is unchanged. Closes the `runner.ts:184–192` TODO. Covers NFR2.
- [ ] **AC5.** _`operationClass: 'data'` is preserved._ The enum still includes `'data'`; a policy that omits `'data'` still rejects DT-bearing plans. Covers FR4.
- [ ] **AC6.** _`Step.params` threaded through driver execution._ A DT whose run carries parameter values executes with those values bound through `driver.query(sql, params)`, not inlined into SQL text. Covers FR1.
- [ ] **AC7.** _`DataTransformOperation` is gone._ The interface is not exported from `@prisma-next/framework-components` or any downstream package; no runtime branch on `op.check === true` or `op.check === false` remains. Covers FR5.
- [ ] **AC8.** _Existing Postgres migration test surfaces pass._ Unit tests under `packages/3-targets/3-targets/postgres/test/migrations/`, integration tests under `packages/3-targets/6-adapters/postgres/test/migrations/`, and `test/integration/test/cli-journeys/data-transform.e2e.test.ts` all pass. Covers FR2, FR5.
- [ ] **AC9.** _All in-tree fixtures are re-emitted to the new shape._ Running `pnpm fixtures:check` after the change passes; every DT-bearing migration fixture in the tree carries the unified precheck/execute/postcheck shape. Covers FR6.

# Other Considerations

## Security

N/A. Internal refactor of an internal execution path; no auth surface, no data sensitivity changes. The `Step.params` plumbing actively *strengthens* the safety posture by routing user-provided values through the driver's parameter binder rather than inlining them as literals.

## Cost

N/A. No infrastructure or runtime cost changes.

## Observability

The today-only "Data transform 'X' did not resolve all violations (N remaining)" failure message is deliberately dropped; postcheck failures from DTs surface as generic operation-postcheck failures keyed on `meta.operationId` and `step.description`. The op id (`data_migration.<name>`) and the step description preserve enough context to identify which DT failed and why. The remaining-violations count is not preserved — it baked the assumption that postchecks are violation queries, which doesn't generalize. If users miss the count, a generic diagnostic-on-failure mechanism (an optional `step.diagnostic` query that runs to enrich the error) could be filed as a follow-up.

## Data Protection

N/A.

## Analytics

N/A.

# References

- Linear: [TML-2292](https://linear.app/prisma-company/issue/TML-2292/unify-data-transforms-with-regular-migration-operations)
- Branch base: PR #404 (`invariant-routing-cli`). This project rebases onto #404 because the marker/invariant story changed there: `plan.providedInvariants` is now the canonical invariant set, the runner reads it directly (`runner.ts:193`), and self-edge no-op detection (`runner.ts:184–209`) is the consumer that this project's unification incidentally repairs.
- Runner branch and helper: [`packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts) — `isDataTransformOperation` at `:47–57`, dispatch at `:239–249`, `executeDataTransform` at `:311–384`, TODO at `:184–192`.
- Type definitions: [`packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`](../../packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts) — `MigrationOperationClass` at `:28`, `DataTransformOperation` at `:54–85`, `MigrationPlanOperation` at `:102–109`.
- Data-transform factory: [`packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts).
- Class-flow IR precedent: [`packages/3-targets/3-targets/postgres/test/migrations/op-factory-call.test.ts:74–82`](../../packages/3-targets/3-targets/postgres/test/migrations/op-factory-call.test.ts).
- Origin context: this project emerged from the design discussion summarised in branch `tml-2292-unify-data-transforms-with-regular-migration-operations`. The Linear ticket carries an earlier draft of the design that this spec materially supersedes (notably: the original draft proposed dropping `'data'` from `MigrationOperationClass` and elevating `name`/`source` to the base op; this spec keeps `'data'` and drops both).

# Open Questions

None. All decisions are pinned above.

Two items were resolved before drafting:

1. **`ops.json` schema versioning** → no schema-version field; re-emit all in-tree migration fixtures. Captured in FR6 / AC9.
2. **`DataTransformOperation` deletion** → outright, no transitional alias. Any downstream consumer that imports the type updates in the same commit. Captured in FR5 / AC7.
