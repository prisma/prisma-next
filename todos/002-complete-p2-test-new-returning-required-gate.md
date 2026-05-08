---
status: complete
priority: p2
issue_id: 2
tags: [code-review, testing, behavior-change, sql, orm]
dependencies: []
---

# Missing test for new `returning`-capability requirement on count helpers

## Problem Statement

PR #440 adds `assertReturningCapability(this.contract, 'updateCount()')` and `'deleteCount()'` at `collection.ts:1115` and `:1177`. This is a real behavior change — these methods previously worked on contracts without the `returning` capability (because the prior implementation used a SELECT-then-UPDATE-without-RETURNING pattern). No test asserts the new error path. A consumer with capabilities stripped (the existing `createUsersCollectionWithoutReturning` helper at `test/integration/helpers.ts:18` is a known fixture pattern) will see a runtime throw on count helpers that did not throw before.

## Findings

- **kieran-typescript-reviewer**: high severity — public API tightens silently with no contract test.
- **architecture-strategist**: low — gate shape is consistent, behavior change is real but in-tree adapters (Postgres, SQLite) both expose `returning: true`.

Evidence:
- `packages/3-extensions/sql-orm-client/src/collection.ts:1115, 1177`
- `packages/3-extensions/sql-orm-client/test/integration/helpers.ts:18-22` (precedent for capability-stripped fixtures)

## Proposed Solutions

### A. Unit test asserting the throw path
- Build a contract via `withCapabilities(getTestContract(), {})` (capabilities stripped) and invoke `updateCount`/`deleteCount`; expect the operation-tagged error.
- **Pros**: Locks the new behavior. Trivial.
- **Cons**: None.
- **Effort**: Small.

### B. Document the breaking change in the PR / changelog
- **Pros**: Surfaces the change to downstream consumers.
- **Cons**: Doesn't catch regressions.
- **Effort**: Small.

### C. Both A + B
- **Recommended**.

## Recommended Action

(filled during triage)

## Technical Details

- Affected files: `packages/3-extensions/sql-orm-client/test/collection-mutation-defaults.test.ts` or a sibling unit test file.
- The unit test should mirror the existing `assertReturningCapability` failure tests (search for `returning` in existing test files).

## Acceptance Criteria

- [ ] Unit test: `updateCount` on a contract without `returning` throws `updateCount() requires contract capability "returning"`.
- [ ] Same for `deleteCount`.

## Work Log

(pending)

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
