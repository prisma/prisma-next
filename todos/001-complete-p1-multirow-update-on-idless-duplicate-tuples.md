---
status: complete
priority: p1
issue_id: 1
tags: [code-review, correctness, sql, orm, idless]
dependencies: []
---

# Silent multi-row UPDATE on id-less duplicate-tuple tables

## Problem Statement

`updateFirstGraph` (mutation-executor.ts:289) compiles a plain `UPDATE … WHERE rowWhere RETURNING …` with no row cap. On id-less tables that also lack unique constraints, the row-identity criterion built from a RETURNING-row's non-null tuple can match multiple rows. A caller invoking the single-row API `db.where(...).update({...})` would silently mutate every duplicate row — strictly worse than the prior PK-only behavior on PK tables.

The reload SELECT side caps via `limit: 1` at `collection.ts:1232`, but the UPDATE side has no equivalent. The SQLite `LIMIT` on UPDATE is dialect-specific; Postgres requires a `WHERE ctid IN (… LIMIT 1)` subquery. The doc warns about duplicate-tuple ambiguity on the read path (`Query Lanes.md:351`) but does NOT call out the write-amplification case.

## Findings

- **data-integrity-guardian**: H1 — high severity. UPDATE-side row cap missing.
- **architecture-strategist**: medium — duplicate-tuple footgun is a documented "stable end state" but not enforced or tested.
- **kieran-typescript-reviewer**: implicitly via "coverage gap on full-tuple reload path".

Evidence:
- `packages/3-extensions/sql-orm-client/src/mutation-executor.ts:279-299`
- `packages/3-extensions/sql-orm-client/src/query-plan-mutations.ts:235-252` (`compileUpdateReturning` — no row cap)
- `packages/3-extensions/sql-orm-client/src/collection.ts:1232` (SELECT-side limit:1, but UPDATE has no equivalent)
- `docs/architecture docs/subsystems/3. Query Lanes.md:351` (warning text, no enforcement)

## Proposed Solutions

### A. Runtime guard — require at least one unique constraint for id-less single-row mutation
- **Pros**: Catches the footgun at authoring time. Aligns with "for single-row identity, declare a unique constraint" doc text.
- **Cons**: Tightens id-less surface; a user with a single-PK-equivalent unique constraint already declared is unaffected.
- **Effort**: Small. Check `storage.tables[t].uniques.length > 0` in `updateFirstGraph` when `primaryKey` is absent; throw operation-tagged error if neither exists.
- **Risk**: Low.

### B. Use a row-cap subquery on the UPDATE
- **Pros**: Keeps the API working without an authoring-time gate.
- **Cons**: Dialect-specific (Postgres ctid subquery vs SQLite LIMIT). Cross-cuts dialect lowering.
- **Effort**: Medium-Large.
- **Risk**: Medium — changes the UPDATE plan AST shape.

### C. Document and accept; add an integration fixture without uniques to prove behavior is intentional
- **Pros**: Smallest diff. Makes behavior explicit via test.
- **Cons**: Still a footgun for users who don't read the docs.
- **Effort**: Small.
- **Risk**: Low (in code), high (in DX surprise).

## Recommended Action

**A** — runtime guard in `updateFirstGraph` rejecting nested-mutation update on id-less + no-uniques tables. Implemented in `mutation-executor.ts:269-283`.

## Technical Details

- Affected files: `packages/3-extensions/sql-orm-client/src/mutation-executor.ts`, `packages/3-extensions/sql-orm-client/test/integration/idless.test.ts`
- Components: nested-mutation reload path

## Acceptance Criteria

- [ ] An id-less table with NO unique constraints either: (a) errors at mutation time, or (b) is documented + tested to broaden writes intentionally.
- [ ] Integration test exercises a duplicate-tuple scenario (requires fixture without a `UNIQUE (name)` constraint — current `tags` PG schema has one).
- [ ] Test asserts the chosen behavior (error or broadening), not silent multi-row mutation under the single-row API.

## Work Log

- **2026-05-08** — Implemented guard in `updateFirstGraph` (`mutation-executor.ts:269-283`): when the table has neither a primary key nor any unique constraint, the function throws `update() of model "X" requires table "T" to declare a primary key or at least one unique constraint when nested mutations are used. ...`. Added unit test in `mutation-executor.test.ts` covering the throw path with an id-less + no-uniques User contract. Updated `Query Lanes.md` § "Id-less tables" to document the requirement.

## Resources

- PR: https://github.com/prisma/prisma-next/pull/440
- Doc: `docs/architecture docs/subsystems/3. Query Lanes.md` § "Id-less tables"
- ADR 003: One Query One Statement
