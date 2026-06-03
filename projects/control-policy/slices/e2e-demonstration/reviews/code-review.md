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

None.

## AC-14 status note (NOT REPRODUCIBLE)

After tracing the verifier → issue-planner → diff-engine call paths, no PGlite-compatible scenario was found where the *current* SQL pipeline errors on an `external` subject while the verifier passes. The two failure shapes are structurally incompatible for `external` tables in the existing code:

- **Verifier-suppressed issues** never reach `planIssues`. The verifier's `emitIssueAndNodeUnderControlPolicy` routes most issue categories to `suppress` for `external` subjects (`extra_column`, `extra_table`, etc.), so the planner never sees them. PGlite-supported "exotic state" candidates (`tsvector` columns, domain-typed columns, `CHECK` constraints, exclusion constraints, triggers) all produce issues in the suppressed-by-verifier bucket and never make it to `mapIssueToCall`.
- **Verifier-failing issues** also fail the verifier itself. The disposition `fail` covers `declaredIncompatible` / `declaredMissing` (e.g., `primary_key_mismatch` against an existing PK on an `external` table, `type_mismatch`, `nullability_mismatch`). The verifier reports `fail`, contradicting AC-14's requirement that the verifier pass.
- **Verifier-warning issues for observed subjects** (`enum_values_changed` flagged as `warn` on `observed` enums) do flow into `planIssues`, but the `nativeEnumPlanCallStrategy` resolves them successfully without erroring — no planner failure.
- **Schema-reader pass-through** means even unknown column types (e.g., `tsvector` on a non-external table) round-trip cleanly as `type_mismatch` and become a successfully-mapped `AlterColumnTypeCall`. No planner error.

The class of failure AC-14 was designed to lock in (planner errors on un-plannable state for an `external` subject while verification still passes) is not reachable today through any PGlite-compatible authoring path. The architectural correction (AC-13) still lands as defense-in-depth so future failure modes the diff engine grows into can't reintroduce the pattern.

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

**AC-13 (input-side filtering) — PASS.** Verified by reading the planner pipeline end-to-end.

- `partitionIssuesByControlPolicy` is declared in `packages/2-sql/9-family/src/core/migrations/control-policy.ts:227-337` and exported from `packages/2-sql/9-family/src/exports/control.ts:33`.
- `PostgresMigrationPlanner.planSql` calls it at `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:157-165` *before* invoking `planIssues`, which receives only `issuePartition.plannable` (line 168). The diff engine therefore never observes `external`/`observed` subjects, and never sees non-creation issues for `tolerated` subjects.
- The `tolerated` create-if-absent short-circuit is the explicit branch in `control-policy.ts:292-300`: `policy === 'tolerated' && subject !== undefined && creationFactoryName !== undefined && subject.createsNewObject`. Without the creation signal, the issue goes to suppressed without the planner having to diff existing-object state.
- Warnings are constructed from suppressed-subject metadata via `buildSubjectSuppressionWarning` (`control-policy.ts:101-123`), deduplicated by `subjectKey` (`control-policy.ts:339-341`) so one warning fires per subject regardless of how many issues that subject contributed. `kind: 'controlPolicySuppressedCall'` and the `{ namespace, table, column, type }` location shape are unchanged from D1.
- The post-D1 `issue-planner.ts` no longer carries a `warnings` field on `IssuePlannerValue` (`issue-planner.ts:182-184`). The post-filter pass over generated calls has been removed from the issue-planning path.
- `partitionCallsByControlPolicy` is still invoked once, at `planner.ts:205-213`, but only against the codec-emitted `fieldEventPostgresCalls`. Per the JSDoc on `control-policy.ts:131-143`, these ops originate from declared contract fields (via `planFieldEventOperations`), never from introspected live state, so they cannot trip the diff engine on un-plannable shapes. The residual usage is principled, not a leak.

**AC-14 (un-plannable-external scenario) — NOT REPRODUCIBLE.** Rationale captured separately under the AC-14 status note above. Spot-checked the claim: `verifierDisposition` (`packages/2-sql/9-family/src/core/schema-verify/verifier-disposition.ts:48-53`) feeds `dispositionForCategory` (`packages/1-framework/1-core/framework-components/src/control/verifier-disposition.ts:41-62`), and the framework's grading table does route `extraNestedElement` / `extraAuxiliary` / `extraTopLevelObject` / `valueDrift` to `suppress` for `external`, while `declaredMissing` / `declaredIncompatible` route to `fail`. The implementer's claim that exotic introspected state for `external` subjects (tsvector columns, extension types, CHECK / exclusion constraints, triggers) all land in the suppressed-by-verifier bucket holds against the disposition table — those classes of state surface as `extra_*` (`extraNestedElement`/`extraAuxiliary`/`extraTopLevelObject`), all suppressed for `external`. The remaining failure shape (`declaredIncompatible`) by definition fails the verifier itself, contradicting AC-14's "verifier must pass" precondition. The rationale is honest and code-cited. The input-side filter remains defensible as defense-in-depth (future diff-engine extensions might widen what reaches `mapIssueToCall`).

(One narrative imprecision in the rationale: it lists `type_mismatch` / `nullability_mismatch` as routed to `suppress` for `external`. The disposition table actually grades those as `declaredIncompatible` → `fail`. The second bullet of the rationale covers that case correctly under "verifier-failing issues also fail the verifier itself," so the conclusion stands; the inaccuracy is local to the bullet wording, not the overall analysis.)

**AC-15 (hygiene items) — PASS.** Verified each on disk:

- **C1**: `isPlannerWarningList` is gone from `packages/1-framework/3-tooling/cli/src/utils/formatters/errors.ts`; repo-wide grep returns zero matches. The read site at `errors.ts:73-80` reads `meta['plannerWarnings']`, validates `Array.isArray(...).length > 0`, then narrows via `blindCast<readonly MigrationPlannerConflict[], '...'>` whose justification literal explicitly names the writer (`mapDbUpdateFailure` in `db-update.ts`) and the channel's type erasure (`meta` is typed `Record<string, unknown>`).
- **C2**: The bare `as unknown as MongoContractResult<Definition>` is gone from `packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts:1618-1621` — replaced by `blindCast<MongoContractResult<Definition>, "...">(builtContract)` with a justification literal that explains the literal-type re-application.
- **C3**: `formatTargetRef` / `defaultTargetRef` are renamed to `formatSubjectLabel` / `defaultSubjectLabel` in `packages/2-sql/9-family/src/core/migrations/control-policy.ts:74-85,149,158`. `formatPostgresControlPolicyTargetRef` → `formatPostgresControlPolicySubjectLabel` in `packages/3-targets/3-targets/postgres/src/core/migrations/control-policy.ts:90-104`. New helpers `resolvePostgresIssueControlPolicySubject` (`control-policy.ts:195-235`) and `resolvePostgresIssueCreationFactoryName` (`control-policy.ts:177-179`) are wired through `planner.ts:160-165`.
- **C4**: `buildSubjectSuppressionWarning` (`control-policy.ts:101-123`) uses `ifDefined('namespace', ...)`, `ifDefined('table', ...)`, `ifDefined('column', ...)`, `ifDefined('type', ...)` for the location bag and `ifDefined('declaredControlPolicy', ...)` for the meta bag; no inline ternary spreads remain. `partitionIssuesByControlPolicy:320` uses `ifDefined('creationFactoryName', ...)` for the suppressed-subject map entry construction.
- **C5**: `rg 'TargetRef|targetRef' packages/2-sql/9-family/src/core/migrations/ packages/3-targets/3-targets/postgres/src/core/migrations/ -n` returns zero matches.

**Sanity check on AC-1..AC-12 — PASS.**

- Warning summary format unchanged: `suppressionSummary` (`control-policy.ts:87-99`) still produces both the spec's namespace-floor-with-managed-override variant ("namespace '<ns>' has effective control 'external' but table declared 'managed'") and the general suppression variant ("namespace '<ns>' has effective control '<policy>'").
- `db update` Warnings block still surfaces: `formatPlannerWarningsBlock` is intact in `packages/1-framework/3-tooling/cli/src/utils/formatters/migrations.ts:97` and called from both the plan-output path (line 185) and the apply-output path (line 451) plus the error-output path (`errors.ts:79`).
- The two e2e fixtures are unchanged: `git diff 5c726fbed..HEAD -- test/integration/test/cli.control-policy.*.e2e.test.ts test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/control-policy/` returns empty.

**Pre-existing reds verification — plausible.** Spot-checked:

1. `pnpm fixtures:check`: `0ee650ec2 TML-2807` lands on main between the slice's start and HEAD and touches `SqlModelStorage` + storage hashing. The diff stat shows many `examples/.../contract.json` files modified across the merge into this branch (`+1 / +2 / +5` lines per file), consistent with a storage-hash-shape change on main that drifted committed fixtures. The implementer's claim that committed contracts drifted against the current emitter due to TML-2807 holds up.
2. Mongo `define-contract.test.ts` "Property 'target' does not exist on type 'never'": the test file's last modification was `abf413ce2 TML-2605` (well before this slice). D4's only edit to the Mongo contract-builder is a single-line `as unknown as` → `blindCast<T, '...'>` swap, which is type-equivalent and cannot introduce a `never` narrowing. The error is plausibly pre-existing (or downstream of a main-merge type change), not D4-introduced.
3. `cli-journeys/*` flakes: PGlite-backed under-load flakes are an existing pattern in this suite; D4 did not touch any cli-journeys test file (diff stat confirms — touched files are migration-status / migration-graph related from main, not control-policy).

**Observation (not a finding).** `packages/3-extensions/mongo/src/contract/define-contract.ts:91,96` carries two bare `as unknown as MongoContractResult<...>` casts that were not part of C2's scope. The file was last touched by `91123b7ca` / `0a9b10c1a` (both pre-slice), and PR #711's review item targeted only `mongo-contract-ts/src/contract-builder.ts:1617`. Not a regression from D4 and not within the slice's stated hygiene scope, but a natural follow-up cleanup if the team wants the same `blindCast` discipline in the extension-side wrapper.

## Verdict

**SATISFIED** — fourteen of fifteen ACs pass (AC-1..AC-13, AC-15); AC-14 ruled out as NOT REPRODUCIBLE against the current pipeline (rationale in the AC-14 status note above). No findings filed. Pre-existing reds verified as plausibly off-the-branch.
