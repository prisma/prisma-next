# feat(sql-orm-client): complete id-less ORM support — full PK-fallback resolution

> Follow-up to PR #440. Targets the same branch `feat/orm-requires-primary-key-gate`.
> Goal: turn #440's prototype gate into a complete landing of
> [`docs/architecture docs/subsystems/3. Query Lanes.md` § "Id-less tables and primary-key fallback"](../docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md).
> After this work, the doc section's "Future work" bullets are gone; the section
> describes a stable end state.

## Overview

PR #440 converted the silent `'id'` fallback in `resolvePrimaryKeyColumn` into a typed, operation-tagged error at five ORM call sites. That stops the silent failure mode but leaves three of those sites (`updateCount`, `deleteCount`, mutation reload) as dead-ends for id-less tables.

This plan refactors those three sites so id-less tables work end-to-end through the ORM. The two MTI polymorphism sites stay PK-required (PK is part of the MTI design, not a fallback). After this PR, predicate-based ORM, count helpers, and nested mutations with `.include()`/`.select()` all work on id-less SQL models.

## Problem Statement

`resolvePrimaryKeyColumn` is currently called from five sites; only two of those genuinely need a PK:

| Site | File:line | Needs PK? | Why |
|------|-----------|-----------|-----|
| `updateCount()` | `collection.ts:1119` | No | Selects PK column then runs UPDATE — uses PK only as "any non-null column to count rows by". |
| `deleteCount()` | `collection.ts:1180` | No | Same pattern as `updateCount`. |
| nested mutation reload | `mutation-executor.ts:115` | No | Builds a PK filter so a follow-up SELECT can apply user `.select()`/`.include()` to the just-mutated row. The row identity is already known via RETURNING. |
| MTI create context | `collection.ts:812` | **Yes** | Joins variant tables onto base PK column at write time. PK is part of the MTI design. |
| MTI base join | `query-plan-select.ts:390` | **Yes** | Same as above, at read time. |

The doc section was rewritten in #440 to enumerate these sites and list the fixes as "future work". This plan lands those fixes.

## Proposed Solution

Three milestones, in dependency order. Each is independently shippable and can be reviewed in isolation, but they should all land in the same PR (the existing PR #440) to keep the doc and code in lockstep.

### M1 — Counts via `UPDATE/DELETE … RETURNING` + stream length

**Today** (`collection.ts:1117–1145` for `updateCount`, mirror in `deleteCount`):
1. Build a `CollectionState` selecting `[primaryKeyColumn]` filtered by `this.state.filters`.
2. Compile + execute that as a SELECT, materialize all matching PK values to an array.
3. Run `compileUpdateCount` (UPDATE without RETURNING).
4. Return the SELECT-array length.

**Proposed**:
1. Run `compileUpdateReturning` / `compileDeleteReturning` against `this.state.filters` and a single trivial returning column (e.g., the first storage column — id-less compatible).
2. Stream rows; return the count.

**Why this shape**:
- One round-trip instead of two.
- No PK reference at all — works on id-less tables.
- Closes a pre-existing race window: today's SELECT-then-UPDATE could miscount under concurrent writes. UPDATE…RETURNING streams exactly the affected rows.
- Aligns with the dominant Postgres-first ORM pattern (Drizzle, Kysely; see References).

**Touches**:
- `packages/3-extensions/sql-orm-client/src/collection.ts:1113-1148` (updateCount)
- `packages/3-extensions/sql-orm-client/src/collection.ts:1185-1208` (deleteCount)
- Possibly drop `compileUpdateCount` / `compileDeleteCount` from `query-plan-mutations.ts` if no remaining callers (verify — may be used by raw paths).

**Risk**: requires the `returning` capability (already enforced for `update`/`delete`/`updateAll`/`deleteAll`). For any future adapter without RETURNING (e.g., MySQL — not in tree today), `updateCount`/`deleteCount` would need an `affected rows` driver path. Track as follow-up; not blocking.

### M2 — Mutation reload uses row identity instead of PK

**Today** (`mutation-executor.ts:109-131`): `buildPrimaryKeyFilterFromRow` reads `row[pkFieldName]` and returns a single-key WHERE. Used at:
- `mutation-executor.ts:252` — inner update reload
- `collection.ts:714, 1065` — nested `create()` / `update()` reload for hydration

The reload's purpose is to apply user `.select(...)` / `.include(...)` to the post-mutation row. The row's identity is already known (we just RETURNING'd it).

**Proposed**: rename to `buildRowIdentityCriterion(contract, modelName, row, originalFilters?)`, with two paths:

- **PK fast path** — when `storage.tables[t].primaryKey` exists, return `{ [pkField]: row[pkField] }`. Identical to today; preserves existing behavior on PK tables.
- **Id-less path** — when no PK:
  - If `originalFilters` was supplied (always true for `update()` / `updateAll()` / `delete()` paths since they require `hasWhere`), re-use the original filter expressions. They already targeted the row by definition.
  - Else, build a full-column AND predicate from the RETURNING row — every mapped column AND'd, NULLs handled with `IS NULL`. Combined with `LIMIT 1` for safety.

**Why this is safe**:
- Reload runs in the same transaction as the mutation (`withMutationScope`, `mutation-executor.ts:129`). The row exists at reload time by construction.
- The RETURNING row is the source of truth for column values, so the predicate built from it matches at least the just-mutated row.
- `LIMIT 1` plus the in-transaction guarantee prevents the "non-unique tuple" edge from selecting the wrong row.

**Touches**:
- `packages/3-extensions/sql-orm-client/src/mutation-executor.ts:109-131` (helper rename + body)
- `packages/3-extensions/sql-orm-client/src/mutation-executor.ts:252` (inner update path passes `filters`)
- `packages/3-extensions/sql-orm-client/src/collection.ts:714, 1065` (nested paths pass `filters` if available)
- Test: `packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts:133-167` (rename + add id-less case)

**SQLite caveat**: SQLite RETURNING does not reflect AFTER-trigger column rewrites; Postgres does. Today's behavior on SQLite is the same (re-SELECT after UPDATE returns AFTER-trigger state). For the id-less path, the predicate is built from RETURNING row state, which on SQLite is pre-AFTER-trigger. The reload SELECT itself still reads post-AFTER-trigger column values, so user-visible rows are correct — only the predicate could miss rows whose RETURNING-state values were rewritten by AFTER triggers and the predicate's columns include those. Unlikely in practice; document in JSDoc near `buildRowIdentityCriterion`.

### M3 — Doc rewrite

Rewrite [`docs/architecture docs/subsystems/3. Query Lanes.md` § "Id-less tables and primary-key fallback"](../docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md):

- Drop the "Future work" bullets (per-model capability flag, explicit-predicate APIs, `findUnique` analogues).
- Narrow the PK-fallback list to MTI polymorphism only, with a one-sentence rationale ("MTI joins variant tables onto the base PK column; without a stable identity column, the variant join cannot be expressed in one statement.").
- Add: count helpers and mutation reload work on id-less tables via `RETURNING`-based row identity.
- Cross-reference the relevant ADRs (003 — One Query One Statement; 015 — ORM as optional extension).

## Technical Considerations

- **Race window** (M1): switching to `UPDATE … RETURNING` removes the existing SELECT-then-UPDATE race in `updateCount`/`deleteCount`. Strict improvement.
- **`returning` capability gate** (M1): `assertReturningCapability` already exists. M1 makes `updateCount`/`deleteCount` formally require it. No in-tree adapter is affected (Postgres + SQLite both support it).
- **SQLite AFTER triggers** (M2): see § "M2" above. Documented as a known divergence, not blocking.
- **Layering**: all changes are inside `packages/3-extensions/sql-orm-client`. No `@prisma-next/sql-contract` schema changes. `pnpm lint:deps` should remain at zero violations.
- **Breaking change surface**: external. `resolvePrimaryKeyColumn` and `buildPrimaryKeyFilterFromRow` are not in `exports/` (verified — `sql-orm-client` has no `exports/` dir; only the package's own `src/` consumes them). Renames are internal-only.

## Acceptance Criteria

- [ ] **AC1**: `updateCount()` / `deleteCount()` execute as a single UPDATE/DELETE…RETURNING and return `affected.length`. No prior SELECT. Verified by inspecting the recorded `MockExecution`s in unit tests.
- [ ] **AC2**: AC1 works on a contract whose target table omits `primaryKey`. Verified by integration test using PGlite + an id-less PSL contract.
- [ ] **AC3**: Nested `create()` / `update()` with `.include(...)` and `.select(...)` hydrate relations on id-less tables without throwing. Verified by integration test.
- [ ] **AC4**: Nested `create()` / `update()` with `.include(...)` on PK tables produce identical SQL and identical results vs `main`. Regression guard via existing integration tests + a snapshot if practical.
- [ ] **AC5**: MTI polymorphism still throws the operation-tagged error from #440 when the base table has no PK. Intentional gate, retained.
- [ ] **AC6**: `docs/architecture docs/subsystems/3. Query Lanes.md` § "Id-less tables and primary-key fallback" describes the stable end state. No "Future work" bullets remain. MTI is the only PK-required site listed.
- [ ] **AC7**: `pnpm test:packages` 110/110 green; `pnpm test:integration` green; `pnpm lint:deps` 0 violations.

## Test Plan

### Unit

- `packages/3-extensions/sql-orm-client/test/collection-mutation-defaults.test.ts:241-262` — update assertions: expect a single UPDATE…RETURNING execution with the correct params (no prior SELECT). Comment fix: the assertion at line 248-249 currently reads `executions.length - 1` to get "the UPDATE", but post-M1 the UPDATE is the only execution.
- `packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts:133-167` — split into:
  - PK fast-path test (current behavior, renamed helper).
  - Id-less reload test using `originalFilters` re-use.
  - Id-less reload test falling back to full-column predicate (no `originalFilters`).
- `packages/3-extensions/sql-orm-client/test/collection-contract.test.ts` — already updated in #440. No further changes.

### Integration (new)

`packages/3-extensions/sql-orm-client/test/integration/idless.test.ts` — using `@prisma/dev` PGlite and a small PSL contract with one id-less model:

```psl
// pseudocode
model Tag {
  email String @unique
  token String
  // No @id, no @@id
}
```

Cases:
- `where(eq(tag.email, 'a@b')).updateCount({ token: 'new' })` → 1
- `where(eq(tag.email, 'a@b')).deleteCount()` → 1
- `tag.create({ data: { email: 'c@d', token: 't' } }).include(...)` → returns row with hydrated relations
- `where(eq(tag.email, 'a@b')).update({ token: 'x' }).include(...)` → returns row with hydrated relations
- (Sanity) MTI base table without PK → throws operation-tagged error from #440

### Validation

- `pnpm --filter @prisma-next/sql-orm-client test` — full suite green.
- `pnpm --filter @prisma-next/sql-orm-client typecheck` — clean.
- `pnpm test:packages` — 110 / 110.
- `pnpm test:integration` — green.
- `pnpm lint:deps` — 0 violations.
- Manual: re-read § "Id-less tables and primary-key fallback" after rewrite to confirm it stands alone without "future work" framing.

## Dependencies & Risks

- **Depends on**: PR #440 (typed-error gate + the doc section it rewrites).
- **Risk — `compileUpdateCount` / `compileDeleteCount` removal**: if M1 obsoletes them and nothing else calls them, drop them. Verify with grep before deleting; keep them if there are raw-SQL adjacent callers.
- **Risk — nested-mutation flow vs `dispatchMutationRows`**: the nested paths (`collection.ts:714, 1065`) bypass `dispatchMutationRows` and re-SELECT manually. M2 keeps them on the manual reload path; an alternative refactor would route them through `dispatchMutationRows` + `stitchIncludes` like the non-nested paths. **Out of scope** — would expand the diff substantially. Documented as a future consolidation opportunity.
- **Risk — SQLite AFTER-trigger divergence**: see § "M2". Mitigation: JSDoc.
- **Risk — full-column predicate matches >1 row**: `LIMIT 1` + in-transaction guarantee. Acceptable for the reload scope.

## Out of Scope (explicitly)

- **Per-model capability primitive** in the contract schema (`models.<X>.capabilities.pkRequired`). Not needed once all PK-fallbacks are resolved or design-required. Removing the placeholder from the doc.
- **`findUnique` analogues** keyed on non-PK uniques. Existing `where(uniqueShape).first()` already covers this. A dedicated API can come later if usage justifies; not before.
- **MySQL adapter changes**. No MySQL adapter in tree.
- **Compile-time TS gating** of MTI methods on id-less base tables. Runtime gate from #440 is sufficient; type-level gating would expand the diff and can be a follow-up.
- **Unifying nested-mutation reload with `dispatchMutationRows`**. Larger refactor; M2 handles the id-less concern within the existing manual-reload path.

## References

### Internal

- PR #440 — prototype gate (typed errors at PK-fallback sites): https://github.com/prisma/prisma-next/pull/440
- PR #424 — id-less SQL models (authoring + emission): https://github.com/prisma/prisma-next/pull/424
- Doc anchor: [`docs/architecture docs/subsystems/3. Query Lanes.md`](../docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md) § "Id-less tables and primary-key fallback"
- Code:
  - `packages/3-extensions/sql-orm-client/src/collection.ts:714` (nested create reload)
  - `packages/3-extensions/sql-orm-client/src/collection.ts:1065` (nested update reload)
  - `packages/3-extensions/sql-orm-client/src/collection.ts:1113` (updateCount)
  - `packages/3-extensions/sql-orm-client/src/collection.ts:1185` (deleteCount)
  - `packages/3-extensions/sql-orm-client/src/mutation-executor.ts:109` (PK reload helper)
  - `packages/3-extensions/sql-orm-client/src/query-plan-aggregate.ts:21` (existing aggregate infra — alternative considered, not chosen)
  - `packages/3-extensions/sql-orm-client/src/query-plan-mutations.ts:254` (`compileUpdateReturning` / `compileDeleteReturning`)
  - `packages/3-extensions/sql-orm-client/src/collection-contract.ts:321` (`resolvePrimaryKeyColumn`, post-#440)
- Tests:
  - `packages/3-extensions/sql-orm-client/test/collection-mutation-defaults.test.ts:241-262`
  - `packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts:133-167`
  - `packages/3-extensions/sql-orm-client/test/integration/update.test.ts`, `delete.test.ts` (existing PK-table integration)

### External

- Postgres `UPDATE … RETURNING`: https://www.postgresql.org/docs/current/sql-update.html — post-update column values, one row per affected row, post-BEFORE-trigger.
- SQLite RETURNING (≥ 3.35): https://www.sqlite.org/lang_returning.html — pre-AFTER-trigger values, arbitrary order.
- Drizzle update + returning: https://orm.drizzle.team/docs/update — Postgres-first ORMs use RETURNING directly; no re-SELECT pattern.
- Kysely UpdateQueryBuilder.returningAll: https://kysely-org.github.io/kysely-apidoc/classes/UpdateQueryBuilder.html — same idiom.
- Drizzle issue #2325 (relations in returning): https://github.com/drizzle-team/drizzle-orm/issues/2325 — confirms two-step pattern (mutate, then load relations) is industry standard; M2 keeps that pattern with a row-identity criterion replacing the PK key.
- SQLAlchemy `synchronize_session="fetch"`: https://docs.sqlalchemy.org/en/20/orm/queryguide/dml.html — uses RETURNING when available; otherwise pre-SELECT for PK identity. PR #440 + this plan moves us to the RETURNING-based shape.
- Diesel issue #1661 (tables without PK): https://github.com/diesel-rs/diesel/issues/1661 — context for industry stance on id-less ORM support.
