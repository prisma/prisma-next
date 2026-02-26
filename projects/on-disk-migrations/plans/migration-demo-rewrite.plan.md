# Migration Demo → E2E Tests Rewrite Plan

## Why rewrite

The `migration-demo/` bash scripts are manual smoke tests that:
- Rely on the `prisma-orm-demo` example's contract and config
- Have no assertions (they print output and the human decides if it looks right)
- Are fragile (shell quoting, path assumptions, `node -e require(...)`)
- Don't run in CI
- Mix contract manipulation (writing TypeScript files) with CLI invocation

Rewriting as TypeScript e2e tests gives us: real assertions, CI integration, reliable cleanup, and the ability to use the programmatic `ControlClient` API directly where appropriate.

## Where the tests live

- **Planner-level tests** (contract diffing, no CLI/filesystem):
  `packages/3-targets/3-targets/postgres/test/migrations/planner.contract-to-schema-ir.test.ts`

- **CLI migration-tools tests** (IO, DAG, attestation):
  `packages/1-framework/3-tooling/cli/test/commands/migration-{plan,new,verify,e2e}.test.ts`

- **Full CLI command e2e tests** (config loading, emit, plan, real workflow):
  `test/integration/test/cli.migration-plan.e2e.test.ts`

## Summary

| Script | Scenario | E2E coverage | Where |
|---|---|---|---|
| 00 fresh-project | First plan from scratch | **Covered** | `cli.migration-plan.e2e.test.ts` — "creates a migration package with operations" |
| 01 no-op | Same hash → no-op | **Covered** | `cli.migration-plan.e2e.test.ts` — "reports no-op on second plan with same contract" |
| 02 add-column | Add column to existing table | **Covered** | `planner.contract-to-schema-ir.test.ts` — "detects added column on existing table"; `cli.migration-plan.e2e.test.ts` — "detects added column in second migration" |
| 03 add-table | Add a new table | **Covered** | `planner.contract-to-schema-ir.test.ts` — "detects added table" |
| 04 multiple-changes | Table + unique + index | **Covered** | `planner.contract-to-schema-ir.test.ts` — "detects multiple changes at once" |
| 05 column-removal | Column removal → conflict | **Covered** | `planner.contract-to-schema-ir.test.ts` — "rejects column removal with conflict"; `cli.migration-plan.e2e.test.ts` — "fails when a column is removed" |
| 06 type-change | Type change → conflict | **Covered** | `planner.contract-to-schema-ir.test.ts` — "rejects type change as non-additive conflict" |
| 07 nullability | Nullability tightening → conflict | **Covered** | `planner.contract-to-schema-ir.test.ts` — "rejects nullability tightening as non-additive conflict" |
| 08 custom-name | Custom `--name` slug | **Covered** | Implicitly via `migration-new.test.ts` + all e2e tests use `--name` |
| 09 json-output | JSON output mode | **Covered** | `cli.migration-plan.e2e.test.ts` — "outputs JSON envelope with --json" |
| 10 verify-attested | Verify passes for attested migration | **Covered** | `cli.migration-plan.e2e.test.ts` — "produces attested migration that passes verify" |
| 11 verify-tampered | Verify fails for tampered migration | **Covered** | `migration-verify.test.ts` — "detects tampered package" |
| 12 scaffold-draft | Scaffold empty draft | **Covered** | `migration-e2e.test.ts` — "scaffold draft → verify attests → verify again passes" |
| 13 plan-verify-plan | Full lifecycle | **Covered** | `cli.migration-plan.e2e.test.ts` — "plan then verify then plan again yields no-op" |
| 14 incremental-chain | Two sequential migrations | **Covered** | `cli.migration-plan.e2e.test.ts` — "detects added column in second migration" (asserts DAG chain) |

All 15 bash script scenarios now have TypeScript test coverage.

## Key findings from implementation

1. **Type changes ARE detected**: The existing `PostgresMigrationPlanner` (with `contractToSchemaIR` conversion) correctly reports type changes (e.g. `text` → `int4`) as non-additive conflicts. The old assumption that the planner "silently ignores" type mismatches was wrong.

2. **Nullability tightening IS detected**: Similarly, changing `nullable: true` → `nullable: false` is correctly rejected as a conflict by the existing planner. No additional detection logic was needed.

3. These findings mean `detectDestructiveChanges` does NOT need to be extended for type/nullability changes — the underlying planner already handles them when it compares the "to" contract against the synthesized "from" schemaIR.

## Next step

Delete `migration-demo/` — all scenarios have e2e coverage.
