---
status: complete
priority: p3
issue_id: 14
tags: [code-review, errors, simplicity]
dependencies: []
---

# Trim verbose error message in `resolvePrimaryKeyColumn`

## Problem Statement

`resolvePrimaryKeyColumn` (`collection-contract.ts:329-332`) throws a 3-sentence error spread across 4 lines via string concatenation, mixing API guidance ("e.g. `where(...).updateAll()`, `where(...).deleteAll()`") with the actual diagnostic. Existing peers in the same file (`assertReturningCapability` at line 343) use a one-line message. The API-guidance prose duplicates content already in `Query Lanes.md`.

## Findings

- **kieran-typescript-reviewer**: medium — inconsistent verbosity.

Evidence:
- `packages/3-extensions/sql-orm-client/src/collection-contract.ts:329-332`
- `packages/3-extensions/sql-orm-client/src/collection-contract.ts:343` (peer pattern)
- `docs/architecture docs/subsystems/3. Query Lanes.md` § "Id-less tables"

## Proposed Solutions

### A. One-sentence error + link to the doc
```ts
throw new Error(
  `${operation} requires table "${tableName}" to declare a primary key. ` +
    `See docs/architecture docs/subsystems/3. Query Lanes.md § "Id-less tables".`,
);
```
- **Pros**: Concise, consistent with peer patterns. Doc carries API guidance.
- **Cons**: Doc reference in an error string is mildly unusual.
- **Effort**: Trivial.

### B. Keep current verbose form
- **Pros**: Self-contained guidance.
- **Cons**: Drifts as docs evolve.

## Recommended Action

A.

## Acceptance Criteria

- [ ] Error message is one sentence + (optional) doc reference.

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
