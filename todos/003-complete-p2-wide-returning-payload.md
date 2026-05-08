---
status: complete
priority: p2
issue_id: 3
tags: [code-review, performance, sql, orm]
dependencies: []
---

# Wide RETURNING payload in updateCount/deleteCount

## Problem Statement

`updateCount` and `deleteCount` (`collection.ts:1126, 1182`) call `compileUpdateReturning` / `compileDeleteReturning` with `returningColumns = undefined`, which `query-plan-mutations.ts:19-33` (`buildReturningColumns`) expands to **every column** of the table. The old SELECT-then-mutate path read only `[primaryKeyColumn]`. For a 50-column table updating 100k rows, the new path ships ~50× the bytes the count path actually needs.

The round-trip win (1 RTT vs 2) usually dominates, but for wide tables × large affected-row counts the wire payload regression is real.

## Findings

- **performance-oracle**: important — net win on small/medium workloads; regression at scale.

Evidence:
- `packages/3-extensions/sql-orm-client/src/collection.ts:1122-1132, 1177-1186`
- `packages/3-extensions/sql-orm-client/src/query-plan-mutations.ts:19-33`

## Proposed Solutions

### A. Pass an explicit single column (e.g. PK or first storage column)
```ts
const trivialReturning = primaryKeyColumns[0] ?? Object.keys(table.columns)[0];
compileUpdateReturning(contract, tableName, mappedData, filters, [trivialReturning]);
```
- **Pros**: Minimal diff; works on PK and id-less tables.
- **Cons**: Still ships one column per row (could be 1 byte or 256 bytes).
- **Effort**: Small.

### B. Add a dedicated `compileUpdateCountReturning` that emits `RETURNING 1`
- **Pros**: Cheapest possible payload — no real column reference.
- **Cons**: New compiler. Needs adapter support for `RETURNING <expr>` (constants); confirm Postgres/SQLite both accept.
- **Effort**: Medium.

## Recommended Action

(filled during triage — A is the immediate win)

## Technical Details

- `query-plan-mutations.ts:19-33` already supports `returningColumns: readonly string[] | undefined`. Just pass a 1-element array.

## Acceptance Criteria

- [ ] `updateCount` passes a single-column returning list.
- [ ] `deleteCount` does the same.
- [ ] Existing tests still pass (the count semantic is unchanged).

## Work Log

(pending)

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
