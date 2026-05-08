---
status: pending
priority: p2
issue_id: 6
tags: [code-review, cleanup, sql, orm]
dependencies: []
---

# Dead code: `compileDeleteCount`

## Problem Statement

After M1 (`b6b7eba8e`), `compileDeleteCount` at `query-plan-mutations.ts:287-299` has no callers. It is also re-exported from `query-plan.ts:6`. CLAUDE.md golden rule: "Don't add exports for backwards compatibility unless requested". `compileUpdateCount` is still used by `executeUpdateCount` (`mutation-executor.ts:707`) for relation FK rewrites, so it stays — but `compileDeleteCount` is unreferenced surface area.

## Findings

- **kieran-typescript-reviewer**: high.
- **architecture-strategist**: medium — also notes the asymmetry between `updateCount` (returning-gated) and FK-rewrite `executeUpdateCount` (ungated). See related todo #009.

Evidence:
- `packages/3-extensions/sql-orm-client/src/query-plan-mutations.ts:287-299`
- `packages/3-extensions/sql-orm-client/src/query-plan.ts:6` (re-export)
- `grep -rn "compileDeleteCount" packages/` after the PR — only the function definition + the one re-export.

## Proposed Solutions

### A. Remove `compileDeleteCount` and its export
- **Pros**: Strict cleanup. Aligns with CLAUDE.md.
- **Cons**: None.
- **Effort**: Small.

### B. Keep it for symmetry with `compileUpdateCount`
- Rationale: a future MySQL-style adapter without `RETURNING` would want this lane.
- **Pros**: Optionality.
- **Cons**: Premature abstraction. CLAUDE.md disallows.
- **Recommended**: A.

## Recommended Action

(filled during triage)

## Technical Details

- Files: `packages/3-extensions/sql-orm-client/src/query-plan-mutations.ts`, `packages/3-extensions/sql-orm-client/src/query-plan.ts`
- Confirm by `grep`: no callers outside the function definition.

## Acceptance Criteria

- [ ] `compileDeleteCount` removed.
- [ ] Re-export from `query-plan.ts` removed.
- [ ] All tests still pass.

## Work Log

(pending)

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
- CLAUDE.md golden rules
