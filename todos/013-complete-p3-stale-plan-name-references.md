---
status: complete
priority: p3
issue_id: 13
tags: [code-review, docs]
dependencies: []
---

# Stale references to `buildPrimaryKeyFilterFromRow` in plan doc

## Problem Statement

The plan at `plans/feat-complete-idless-orm-support.md` still references the old function name `buildPrimaryKeyFilterFromRow` at lines 60 and 101. M2 renamed it to `buildRowIdentityCriterion` in commit `f977896b7`.

## Findings

- **code-simplicity-reviewer**: nit — plan doc, not code.

Evidence:
- `plans/feat-complete-idless-orm-support.md:60, 101`

## Proposed Solutions

### A. Update plan to reference the new name
- **Pros**: Plan stays internally consistent.
- **Cons**: None.
- **Effort**: Trivial.

### B. Leave as historical record
- The plan was written before the rename. Some teams keep plans frozen.

## Recommended Action

A.

## Acceptance Criteria

- [ ] Plan references the new name `buildRowIdentityCriterion`.

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
