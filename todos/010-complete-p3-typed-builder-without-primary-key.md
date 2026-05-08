---
status: complete
priority: p3
issue_id: 10
tags: [code-review, testing, simplicity]
dependencies: []
---

# Typed builder `withoutPrimaryKey` to eliminate `as unknown as TestContract` casts

## Problem Statement

The new `createIdlessTagsCollection` helper at `test/integration/helpers.ts:53-74` uses `as unknown as TestContract` to widen `tags.primaryKey` from the literal-pinned `{ columns: ['id'] }` to `undefined`. The cast is justified inline but pre-existing test code uses the same idiom in 5+ places (`mutation-executor.test.ts:138, 175, 200`, etc.). A typed builder `withoutPrimaryKey<T extends string>(contract, table: T)` mirrored on `withCapabilities` (`test/helpers.ts:40-45`) would eliminate the cast everywhere.

## Findings

- **kieran-typescript-reviewer**: medium — cast is the right escape hatch, but the comment justifies it weakly given a typed builder is feasible.
- **code-simplicity-reviewer**: same — `withoutPrimaryKey` would erase the cast in test code permanently.

Evidence:
- `packages/3-extensions/sql-orm-client/test/integration/helpers.ts:53-74`
- `packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts:138, 175, 200`
- Existing pattern: `packages/3-extensions/sql-orm-client/test/helpers.ts:40-45` (`withCapabilities`)

## Proposed Solutions

### A. Add `withoutPrimaryKey<TTable extends keyof TestContract['storage']['tables']>(contract, table: TTable)` to `test/helpers.ts`
- Returns `Omit<TestContract, 'storage'> & { storage: { ...; tables: { ...; [TTable]: { ...; primaryKey: undefined } } } }`.
- **Pros**: Eliminates casts; reusable across unit + integration tests.
- **Cons**: A few lines of mapped-type machinery.
- **Effort**: Small.

### B. Leave casts in place; the `as unknown as` form is documented and scoped
- **Pros**: No diff.
- **Cons**: Recurring pattern that drifts with each new id-less test.

## Recommended Action

A — but defer until at least one more id-less test wants the same shape.

## Acceptance Criteria

- [ ] `withoutPrimaryKey` helper exists in `test/helpers.ts`.
- [ ] At least 2 callers migrate from `as unknown as TestContract` to the helper.

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
