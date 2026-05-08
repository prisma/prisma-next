---
status: pending
priority: p3
issue_id: 11
tags: [code-review, testing, simplicity]
dependencies: []
---

# Cut redundant "updateCount returns zero" id-less test

## Problem Statement

`test/integration/idless.test.ts` has three tests: updateCount happy, deleteCount happy, and "updateCount returns zero when no rows match." The third doesn't exercise id-less specifics — the zero-match path is the same on PK and id-less tables, and is already covered by the unit test for `updateCount` on the PK contract.

## Findings

- **code-simplicity-reviewer**: cut test 3.

Evidence:
- `packages/3-extensions/sql-orm-client/test/integration/idless.test.ts:53-71`

## Proposed Solutions

### A. Drop the third test
- **Pros**: Tighter integration suite (PGlite spin-up time matters).
- **Cons**: Slightly less paranoia.
- **Effort**: Trivial.

### B. Keep it
- The cost is one PGlite startup; could be paranoia justified.

## Recommended Action

A — but only if/when integration runtime becomes a concern.

## Acceptance Criteria

- [ ] Decision recorded (keep or cut).

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
