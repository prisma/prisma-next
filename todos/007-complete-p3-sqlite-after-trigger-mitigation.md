---
status: complete
priority: p3
issue_id: 7
tags: [code-review, correctness, sqlite, sql, orm]
dependencies: []
---

# SQLite RETURNING + AFTER-trigger mitigation only via JSDoc

## Problem Statement

SQLite RETURNING does not reflect AFTER-trigger column rewrites (Postgres does). For id-less `buildRowIdentityCriterion`, this means a criterion built from RETURNING-row values may fail to match the persisted row if AFTER triggers rewrote columns present in the criterion. Mitigation today is JSDoc on `mutation-executor.ts:132-140` plus a paragraph in `Query Lanes.md:356`. No runtime guard.

## Findings

- **architecture-strategist**: medium — relies on docstring; below the bar set by `assertReturningCapability` for an analogous concern.
- **data-integrity-guardian**: low — acceptable as documented behavior since the SQLite adapter is downstream.

Evidence:
- `packages/3-extensions/sql-orm-client/src/mutation-executor.ts:132-140`
- `docs/architecture docs/subsystems/3. Query Lanes.md:356`

## Proposed Solutions

### A. Capability flag (`storage.afterTriggerSafeReturning`) gating id-less reload on SQLite
- **Pros**: Surfaces the divergence to consumers at authoring time.
- **Cons**: Adds a new capability primitive; needs adapter cooperation.
- **Effort**: Medium.

### B. Runtime warning when an id-less SQLite contract is constructed
- **Pros**: No new capability primitive; visible at startup.
- **Cons**: Warnings are easy to miss.
- **Effort**: Small.

### C. Accept JSDoc; surface in ADR
- **Pros**: Smallest diff.
- **Cons**: Hidden from code-aware consumers.
- **Recommended**: defer until the SQLite adapter actually exercises id-less + AFTER triggers.

## Recommended Action

**C** — accept JSDoc in `mutation-executor.ts:132-137` and the doc paragraph in `Query Lanes.md` § "Id-less tables". Decision is documented; no runtime guard is added until the SQLite adapter actually exercises id-less + AFTER-trigger contracts. Revisit then.

## Acceptance Criteria

- [x] Decision recorded (C).
- [x] Runtime implementation and tests intentionally deferred because A/B were not selected.
- [x] Doc paragraph states the explicit decision.

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
- SQLite RETURNING docs: https://www.sqlite.org/lang_returning.html
