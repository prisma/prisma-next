# Remediation Matrix: `projects/on-disk-migrations/reviews/pr-184/code-review.md`

Date: 2026-02-27  
Scope: Findings and user suggestions recorded in `projects/on-disk-migrations/reviews/pr-184/code-review.md`

| ID | Finding | Priority | Current Status | Evidence |
|---|---|---|---|---|
| PR184-01 | Mask DB credentials in `migration apply` header output | Blocking | Implemented | `packages/1-framework/3-tooling/cli/src/commands/migration-apply.ts` now masks connection URL via `maskDatabaseUrl()` |
| PR184-02 | Fail closed when graph has no leaf (`findLeaf` no-leaf path) | Blocking | Implemented | `packages/1-framework/3-tooling/migration/src/dag.ts` throws `errorNoLeaf(...)`; `packages/1-framework/3-tooling/migration/src/errors.ts` adds `MIGRATION.NO_LEAF` |
| PR184-03 | Do not suppress migration directory integrity errors in `migration new` | Blocking | Implemented | `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts` maps `MigrationToolsError`/unexpected errors instead of silent fallback |
| PR184-04 | Replace repeated `packages.find(...)` with lookup map in apply path | Non-blocking | Implemented | `packages/1-framework/3-tooling/cli/src/commands/migration-apply.ts` now builds `packageByDir` map |
| PR184-05 | Add e2e that proves partial-failure resume semantics | Non-blocking | Implemented | `test/integration/test/cli.migration-apply.e2e.test.ts` resume test now forces failure at migration N, verifies marker at N-1, then re-runs successfully |
| PR184-06 | Clarify user-facing docs for verify mismatch behavior | Follow-up | Implemented | `packages/1-framework/3-tooling/cli/README.md` now states mismatch exits non-zero |

## Notes

- The earlier reconciliation pass referenced `projects/on-disk-migrations/code-review.md`; that scope was superseded by this matrix after user correction.
- This file is the canonical remediation tracker for PR #184 review follow-ups.
