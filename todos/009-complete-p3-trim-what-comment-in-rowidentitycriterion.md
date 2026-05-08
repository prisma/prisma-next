---
status: complete
priority: p3
issue_id: 9
tags: [code-review, comments, simplicity]
dependencies: []
---

# Trim WHAT-restating comment in `buildRowIdentityCriterion`

## Problem Statement

The 9-line comment block in `mutation-executor.ts:132-140` mixes WHAT (lines 132-133, "Id-less path: build a criterion from the row's mapped non-null column values") with WHY (the RETURNING-by-construction invariant + duplicate-tuple caveat + SQLite AFTER-trigger caveat). CLAUDE.md: "Don't add comments if avoidable, prefer code which expresses its intent." The first sentence restates the code below.

## Findings

- **kieran-typescript-reviewer**: medium.
- **code-simplicity-reviewer**: keep only the WHY half.

Evidence:
- `packages/3-extensions/sql-orm-client/src/mutation-executor.ts:132-140`

## Proposed Solutions

### A. Drop the first sentence; keep duplicate-tuple + SQLite AFTER-trigger caveats
- **Pros**: Minimal diff. Comment now explains genuine non-obvious WHY.
- **Cons**: None.
- **Effort**: Trivial.

### B. Move the entire block to JSDoc on the function
- **Pros**: Easier to find via tooling.
- **Cons**: Other helpers in the file have no JSDoc; inconsistent.

## Recommended Action

A.

## Acceptance Criteria

- [ ] Comment block trimmed to ≤5 lines, all WHY.

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
- CLAUDE.md golden rule on comments
