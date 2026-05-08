---
status: complete
priority: p2
issue_id: 5
tags: [code-review, testing, sql, orm, idless]
dependencies: []
---

# Integration test gap: id-less mutation reload code path

## Problem Statement

The integration suite at `test/integration/idless.test.ts` covers `updateCount` and `deleteCount`. Those operations were rewritten in commit `b6b7eba8e` to use `UPDATE/DELETE … RETURNING + count` and **no longer call `buildRowIdentityCriterion`**. The id-less reload code path that actually depends on the new `buildRowIdentityCriterion` id-less branch (`mutation-executor.ts:141-148`) is currently exercised only by unit tests on the criterion shape — not end-to-end against PGlite.

The plan's AC3 (`plans/feat-complete-idless-orm-support.md:107`) explicitly required an integration test for nested `create()`/`update()` with `.include(...)` / `.select(...)` on an id-less table. This was not delivered.

## Findings

- **kieran-typescript-reviewer**: high — coverage gap.
- **architecture-strategist**: medium — doc claims "stable end state" but unit-test-only proof.
- **data-integrity-guardian**: medium — id-less write-amplification risk (linked todo #001) cannot be observed in current fixture.

Evidence:
- `packages/3-extensions/sql-orm-client/test/integration/idless.test.ts` (3 tests, all on count helpers)
- `packages/3-extensions/sql-orm-client/src/mutation-executor.ts:141-148` (the actual id-less reload path)
- `plans/feat-complete-idless-orm-support.md:107` (AC3)

## Proposed Solutions

### A. Add `nested-create()` and `nested-update()` integration tests against an id-less Tags fixture
- Inject a related model with an FK so `.include(...)` has something to hydrate. Tag has no relations today; add a temporary related model in the test fixture.
- **Pros**: Closes the coverage gap. Locks AC3.
- **Cons**: Needs fixture work (related model + schema).
- **Effort**: Medium.

### B. Add `.select(...)` integration test only (no `.include(...)`)
- The `select`-projection path also goes through `#reloadMutationRowByCriterion`, so it exercises the full id-less reload code path without needing a related model.
- **Pros**: Smaller fixture change, still proves the path.
- **Cons**: Doesn't exercise relation hydration on id-less.
- **Effort**: Small.

### C. Defer to a follow-up PR
- Not recommended — the gap is already in-scope for the current PR per the plan.

## Recommended Action

(filled during triage — B is tight + immediate; A is the complete answer)

## Technical Details

- `createIdlessTagsCollection` already exists in `test/integration/helpers.ts`.
- `Tag` model has no relations in the fixture, so `.include()` requires fixture work.

## Acceptance Criteria

- [ ] Integration test calls `tag.create({...}).select({...})` (or `.include(...)`) against an id-less Tags collection.
- [ ] Test asserts the reloaded row matches the just-mutated row.
- [ ] Plan AC3 is checked off.

## Work Log

(pending)

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
- Plan: `plans/feat-complete-idless-orm-support.md`
