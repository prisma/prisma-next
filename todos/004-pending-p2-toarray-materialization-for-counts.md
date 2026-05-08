---
status: pending
priority: p2
issue_id: 4
tags: [code-review, performance, sql, orm]
dependencies: [3]
---

# `.toArray()` materialization in count helpers

## Problem Statement

`updateCount` (`collection.ts:1129-1132`) and `deleteCount` (`:1184-1187`) buffer the entire RETURNING result via `.toArray()` only to read `.length`. For large affected-row counts this is O(N×W) memory (W = column count). Combined with finding #003 (wide RETURNING payload), this is a non-trivial regression at scale.

## Findings

- **performance-oracle**: important.

Evidence:
- `packages/3-extensions/sql-orm-client/src/collection.ts:1129-1132, 1184-1187`

## Proposed Solutions

### A. Stream the iterable, increment a counter
```ts
let count = 0;
for await (const _ of executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled)) {
  count++;
}
return count;
```
- **Pros**: O(1) memory regardless of N.
- **Cons**: Slightly less idiomatic than `.toArray().length`.
- **Effort**: Small.

### B. Combine with #003: use streaming + single-column RETURNING for compounding effect
- **Recommended**.

## Recommended Action

(filled during triage)

## Technical Details

- Verify `executeQueryPlan` returns an iterable that can be consumed without `.toArray()`. Confirmed safe per `framework-components/runtime/async-iterable-result.ts`.

## Acceptance Criteria

- [ ] Both count helpers iterate without `.toArray()`.
- [ ] Tests still pass (semantics unchanged).

## Work Log

(pending)

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
- Related: todo #003
