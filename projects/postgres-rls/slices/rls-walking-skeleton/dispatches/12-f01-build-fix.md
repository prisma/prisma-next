# Dispatch D12 — F01 build fix (slice `select-policies-dependable`)

Slice 1 (re-cut), TML-2868, PR #771. Implementer tier: sonnet. Fixes review finding **F01** (the merge blocker) + threads the field through combination (the structural half of F02). Source of truth: `projects/postgres-rls/slices/rls-walking-skeleton/reviews/pr-771/code-review.md` §F01/§F02.

## Task

1. The branch fails workspace `tsc`: `extensionIssues` was added as a **required** field on `VerifyDatabaseSchemaResult.schema` (`framework-components/src/control/control-result-types.ts` ~140) but three constructors weren't updated. Fix by **keeping the field required** (option b in the review — clearer contract) and updating:
   - `packages/2-mongo-family/9-family/src/core/schema-verify/verify-mongo-schema.ts` ~60 → `extensionIssues: []`
   - `packages/1-framework/3-tooling/cli/src/control-api/operations/db-verify.ts` ~273 → `extensionIssues: []` (or propagate from the inner result if one is in scope — check)
   - `packages/1-framework/3-tooling/cli/src/utils/combine-schema-results.ts` ~66 → **concatenate** members' `extensionIssues` (not `[]`) — combining must preserve the channel.
2. **Do NOT change the verify verdict** (`ok`/counts) — that's the next dispatch. This one only makes the build green and the field flow losslessly.
3. Add a test for `combineSchemaResults` concatenation (members with extensionIssues → combined carries all).

## Gates (run once, foreground)

`pnpm build` then **workspace `pnpm typecheck` — must be fully green** (this is the gate F01 proved we were missing); the new combine test; `pnpm lint:deps`; mongo suite green.

## Constraints

Explicit-staging commit, `tml-2868:` prefix, no amend, no push. No `any`/bare casts. Heartbeats to `wip/heartbeats/implementer.txt`. Commit your own work; if low on budget, commit what compiles + report.
