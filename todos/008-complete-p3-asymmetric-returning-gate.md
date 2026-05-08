---
status: complete
priority: p3
issue_id: 8
tags: [code-review, consistency, sql, orm]
dependencies: []
---

# Asymmetric `returning` gate: `updateCount` vs FK-rewrite `executeUpdateCount`

## Problem Statement

After PR #440, `updateCount`/`deleteCount` formally require the `returning` capability via `assertReturningCapability` (`collection.ts:1115, 1177`). The FK-rewrite path inside nested-mutation cleanup (`mutation-executor.ts:707, calling compileUpdateCount`) does NOT require RETURNING. So a contract without `returning` errors from `updateCount()` but silently allows disconnect/setNull through `executeUpdateCount`. This is a quiet inconsistency.

## Findings

- **architecture-strategist**: medium.

Evidence:
- `packages/3-extensions/sql-orm-client/src/collection.ts:1115, 1177` (gated)
- `packages/3-extensions/sql-orm-client/src/mutation-executor.ts:495, 509, 528, 707` (ungated; uses `compileUpdateCount`)

## Proposed Solutions

### A. Gate `executeUpdateCount` with `assertReturningCapability` too
- **Pros**: Consistency.
- **Cons**: Forces FK-rewrite cleanup to require RETURNING — but this path doesn't need RETURNING semantically (no row data is read).
- **Effort**: Small but conceptually wrong.

### B. Document the asymmetry explicitly: FK-rewrite cleanup is the one ORM mutation path that does not require `returning`
- **Pros**: Surfaces the design choice.
- **Cons**: Doesn't enforce.
- **Recommended**.

## Recommended Action

(filled during triage)

## Acceptance Criteria

- [ ] Doc paragraph in Query Lanes.md or a comment in `mutation-executor.ts:707` explaining why FK rewrites use the un-RETURNING'd compiler.

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
