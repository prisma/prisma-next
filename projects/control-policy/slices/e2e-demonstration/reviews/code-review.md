# Code Review — `control-policy / e2e-demonstration`

## AC scoreboard

| AC | Description | Status |
|----|-------------|--------|
| AC-1 | `MigrationPlannerSuccessResult` carries optional `warnings`; absent when empty | PASS |
| AC-2 | `db update` prints `Warnings:` block (apply + dry-run); omits when empty | PASS |
| AC-3 | Postgres `managed` table created on first init; verifier fails after out-of-band drop | PASS |
| AC-4 | Postgres `tolerated` table created-if-missing; extra columns preserved; verifier passes on extras, fails on declared-column drop | PASS |
| AC-5 | Postgres `external` table receives zero DDL; verifier passes on shape match; fails on declared drift; passes on extra columns | PASS |
| AC-6 | Postgres `observed` table receives zero DDL; verifier emits warning-only with exit code 0 | PASS |
| AC-7 | `defaultControlPolicy: 'external'` namespace + per-object `managed` override → zero DDL; suppression warning in `db update` apply + dry-run | PASS |
| AC-8 | Mongo `managed` collection materialised on first run; verifier fails after out-of-band drop | PASS |
| AC-9 | Mongo `tolerated` collection created-if-missing; extras don't cause drift; declared-index drops fail verification | PASS |
| AC-10 | Mongo `external` collection receives no schema-management actions; verifier passes on extras/match, fails on declared drift | PASS |
| AC-11 | Mongo `observed` collection receives no schema-management actions; verifier warns with exit code 0 on mismatch | PASS |
| AC-12 | `pnpm fixtures:check` zero churn; `pnpm lint:deps` passes; both e2e tests pinned by Integration Tests CI gate | PASS |

## Findings

None.

## Round notes

### D1 R1

AC-1 and AC-2 verified. `partitionCallsByControlPolicy` / `filterCallsByControlPolicy` separation accepted (clean caller contract, no overhead for non-warning callsites). `formatPostgresControlPolicyTargetRef` in the Postgres target package accepted (holds Postgres-specific schema-qualification knowledge). Transient ID scan: clean.

### D2 R1

AC-3..AC-7 verified. Apply-path gap found: planner warnings were not surfaced on `RUNNER_FAILED` path. Orchestrator dispatched D2 R2 to close it.

### D2 R2

Apply-path gap closed: `DbUpdateFailure.warnings` widened, mapped to `meta.plannerWarnings`, picked up by `formatErrorOutput`. Unit test in `output.errors.test.ts` pins the path. Non-zero exit on mis-declared managed accepted (correct behavior, not a footgun). `meta.plannerWarnings` mechanism accepted (typed key into existing meta bag; no protocol change needed). Two-fixture split accepted (distinct contract configurations require separate `defineConfig` invocations). Transient ID scan: clean.

### D3 R1+R2

AC-8..AC-12 verified on disk. Mongo "extra fields" via extra-index proxy accepted: Mongo's verifier surface operates on collections/indexes/validators, not document field shapes, so extra indexes are the correct verifiable analog of the spec's "tolerated extras" intent; the test description is honest ("extra indexes") and the assertion accurately exercises the tolerated/declared distinction. Authoring API shape (model-input `controlPolicy`, no `.mongo()` stage) accepted: Mongo's builder has no SQL-style two-stage pattern; all storage concerns (collection, indexes, options) are already model-input; introducing a stage would be asymmetric with the rest of the Mongo surface. Mongo TS authoring gap closure accepted: fixture now goes through `@prisma-next/mongo/contract-builder` public API; lowering path exercised; `contract-builder.control-policy.test.ts` pins the surface including round-trip through `createMongoContractSchema()`. Transient ID scan: clean (exit 1, no matches).

## Verdict

**SATISFIED** — all twelve ACs pass, zero findings filed, all flagged decisions accepted.
