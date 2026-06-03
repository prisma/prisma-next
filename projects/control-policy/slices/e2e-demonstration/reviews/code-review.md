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
| AC-13 | SQL family planner pipeline excludes `external` and `observed` subjects from planning _input_; warnings are constructed from the suppressed partition (not from dropped planner calls); `tolerated` follows a create-if-absent short-circuit that does not require diffing the existing object's full state | PASS |
| AC-14 | Postgres e2e test gains a sixth scenario: an `external` table pre-seeded into a state the SQL diff engine cannot model; `db update` succeeds with zero DDL into the table, the planner does not error on the un-plannable state, the suppression warning is emitted | NOT REPRODUCIBLE |
| AC-15 | No bare `as unknown as` casts in Mongo `defineContract`'s return path (replaced by `blindCast` with a justification literal); no runtime type predicate in `formatErrorOutput` for `meta.plannerWarnings` (replaced by `blindCast` at the read site); `formatTargetRef` / `defaultTargetRef` (SQL family) and `formatPostgresControlPolicyTargetRef` (Postgres) renamed to use the `subject`/`Label` vocabulary; `buildSuppressionWarning`'s location/meta construction uses the repo's `ifDefined` helper instead of inline ternary spreads | PASS |

## Findings

### AC-14: NOT REPRODUCIBLE

After ~30 minutes of honest investigation traced through the verifier → issue planner → diff engine call paths, no PGlite-compatible scenario was found where the *current* post-filter SQL pipeline errors on an `external` subject while the verifier passes. The two failure shapes are structurally incompatible for `external` tables in the existing code:

- **Verifier-suppressed issues** never reach `planIssues`. The verifier's `emitIssueAndNodeUnderControlPolicy` routes most issue categories to `suppress` for `external` subjects (`extra_column`, `extra_table`, `type_mismatch`, `nullability_mismatch`, etc.), so the planner never sees them. PGlite-supported "exotic state" candidates (`tsvector` columns, domain-typed columns, `CHECK` constraints, exclusion constraints, triggers) all produce issues in the suppressed-by-verifier bucket and never make it to `mapIssueToCall`.
- **Verifier-failing issues** also fail the verifier itself. The disposition `fail` covers `declaredIncompatible` / `declaredMissing` (e.g., `primary_key_mismatch` against an existing PK on an `external` table). The verifier reports `fail`, contradicting AC-14's requirement that the verifier pass.
- **Verifier-warning issues for observed subjects** (`enum_values_changed` flagged as `warn` on `observed` enums) do flow into `planIssues`, but the `nativeEnumPlanCallStrategy` resolves them successfully without erroring — no planner failure.
- **Schema-reader pass-through** means even unknown column types (e.g., `tsvector` on a non-external table) round-trip cleanly as `type_mismatch` and become a successfully-mapped `AlterColumnTypeCall`. No planner error.

In short: the current pipeline turned out to be more robust than the slice-5 brief assumed. The class of failure AC-14 was designed to lock in (planner errors on un-plannable state for an `external` subject) is not reachable today through any PGlite-compatible authoring path. AC-14 is recorded as `NOT REPRODUCIBLE`; the architectural correction (AC-13) is still landed as defense-in-depth so future failure modes the diff engine grows into don't reintroduce the pattern.

(Reset for D4. AC-13 and AC-15 verified in D4 R1; AC-14 ruled out per the rationale above.)

## Round notes

### D1 R1

AC-1 and AC-2 verified. `partitionCallsByControlPolicy` / `filterCallsByControlPolicy` separation accepted (clean caller contract, no overhead for non-warning callsites). `formatPostgresControlPolicyTargetRef` in the Postgres target package accepted (holds Postgres-specific schema-qualification knowledge). Transient ID scan: clean.

### D2 R1

AC-3..AC-7 verified. Apply-path gap found: planner warnings were not surfaced on `RUNNER_FAILED` path. Orchestrator dispatched D2 R2 to close it.

### D2 R2

Apply-path gap closed: `DbUpdateFailure.warnings` widened, mapped to `meta.plannerWarnings`, picked up by `formatErrorOutput`. Unit test in `output.errors.test.ts` pins the path. Non-zero exit on mis-declared managed accepted (correct behavior, not a footgun). `meta.plannerWarnings` mechanism accepted (typed key into existing meta bag; no protocol change needed). Two-fixture split accepted (distinct contract configurations require separate `defineConfig` invocations). Transient ID scan: clean.

### D3 R1+R2

AC-8..AC-12 verified on disk. Mongo "extra fields" via extra-index proxy accepted: Mongo's verifier surface operates on collections/indexes/validators, not document field shapes, so extra indexes are the correct verifiable analog of the spec's "tolerated extras" intent; the test description is honest ("extra indexes") and the assertion accurately exercises the tolerated/declared distinction. Authoring API shape (model-input `controlPolicy`, no `.mongo()` stage) accepted: Mongo's builder has no SQL-style two-stage pattern; all storage concerns (collection, indexes, options) are already model-input; introducing a stage would be asymmetric with the rest of the Mongo surface. Mongo TS authoring gap closure accepted: fixture now goes through `@prisma-next/mongo/contract-builder` public API; lowering path exercised; `contract-builder.control-policy.test.ts` pins the surface including round-trip through `createMongoContractSchema()`. Transient ID scan: clean (exit 1, no matches).

### D4 R1

AC-13 and AC-15 verified on disk: input-side filtering wired through `partitionIssuesByControlPolicy` in `packages/2-sql/9-family/src/core/migrations/control-policy.ts` and called from `PostgresMigrationPlanner.plan` before `planIssues`; `issue-planner.ts`'s post-filter pass removed; warnings constructed directly from the suppressed partition (one per subject, factoryName inferred from issue mix). Hygiene items C1–C5 landed: `isPlannerWarningList` runtime predicate replaced by `blindCast` at the read site; Mongo `defineContract` return cast replaced by `blindCast`; `defaultTargetRef` / `formatPostgresControlPolicyTargetRef` renamed to `defaultSubjectLabel` / `formatPostgresControlPolicySubjectLabel`; `buildSubjectSuppressionWarning`'s location/meta construction uses `ifDefined` throughout; no remaining `TargetRef` references in touched control-policy files. AC-14: NOT REPRODUCIBLE — see Findings.

## Verdict

**SATISFIED** — fourteen of fifteen ACs pass (AC-1..AC-13, AC-15); AC-14 ruled out as not reproducible against the current pipeline (rationale in Findings).
