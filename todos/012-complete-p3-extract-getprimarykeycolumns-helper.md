---
status: complete
priority: p3
issue_id: 12
tags: [code-review, architecture, sql, orm]
dependencies: []
---

# Extract `getPrimaryKeyColumns` helper into `collection-contract.ts`

## Problem Statement

`buildRowIdentityCriterion` at `mutation-executor.ts:115` reads `contract.storage.tables[t]?.primaryKey?.columns` directly. The same shape is also accessed by `resolvePrimaryKeyColumn` at `collection-contract.ts:326`. Two files now know about the same storage-tree path. A small accessor in `collection-contract.ts` (e.g. `getPrimaryKeyColumns(contract, tableName): readonly string[]`) keeps storage-shape access in one module.

## Findings

- **architecture-strategist**: low layering smell — replicated raw-storage access.

Evidence:
- `packages/3-extensions/sql-orm-client/src/mutation-executor.ts:115`
- `packages/3-extensions/sql-orm-client/src/collection-contract.ts:326`

## Proposed Solutions

### A. Add `getPrimaryKeyColumns(contract, tableName): readonly string[]` to `collection-contract.ts`
- Use it in both `resolvePrimaryKeyColumn` (which throws on empty) and `buildRowIdentityCriterion`.
- **Pros**: One place owns the storage-shape access.
- **Cons**: Trivial duplication today; helper is one line.
- **Effort**: Small.

## Recommended Action

A.

## Acceptance Criteria

- [ ] Helper exists in `collection-contract.ts`.
- [ ] Both callers use it.
- [ ] No direct `storage.tables[…].primaryKey?.columns` access in `mutation-executor.ts`.

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
