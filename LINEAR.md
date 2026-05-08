# Linear ticket — PR #440

> Source content for the Linear ticket that PR #440 should be associated to.
> Once the ticket is created, replace this file with the Linear URL or delete it.

## Title

sql-orm-client: complete id-less ORM mutation paths

## Suggested project / parent

Follow-up to TML-2380 (PR #424 — *sql: add support for id-less models*). Same project; new ticket since this is a separate shipping unit on top of the authoring/emission support TML-2380 introduced.

## Suggested labels

- area/sql
- area/orm
- type/improvement

## Description

PR #424 (TML-2380) added authoring and emission support for SQL PSL models without `@id`/`@@id`. Tables emitted by the new path could be queried via the SQL DSL, but the ORM lane silently fell through to a literal `'id'` column at five call sites — count helpers, mutation reload, and MTI polymorphism — producing opaque database errors at execution time.

This ticket completes id-less support in the ORM lane. After PR #440 ships, the doc section *Id-less tables* in `docs/architecture docs/subsystems/3. Query Lanes.md` describes a stable end state with no "future work" bullets: predicate-based ORM, count helpers, and nested mutations with `.select()` / `.include()` all work on id-less tables. MTI polymorphism stays PK-required by design.

## Scope

- Convert the silent `'id'` fallback in `resolvePrimaryKeyColumn` to operation-tagged errors at every PK-required call site.
- `updateCount()` / `deleteCount()` execute a single `UPDATE/DELETE … RETURNING` and count streamed rows. No PK lookup; one round-trip; closes the previous SELECT-then-UPDATE race window.
- Mutation reload after nested `create()` / `update()` uses a row-identity criterion. PK fast path on PK tables (composite-PK aware — fixes a latent bug). Non-null tuple predicate on id-less tables.
- Runtime guard: nested-mutation update on id-less tables that also lack any unique constraint throws a clear error rather than silently broadening to all duplicate-tuple rows.
- Doc rewrite of `docs/architecture docs/subsystems/3. Query Lanes.md` § *Id-less tables*.
- Multi-agent code review (kieran-ts, architecture-strategist, code-simplicity, pattern-recognition, performance-oracle, data-integrity-guardian) with all P1/P2/P3 findings resolved.

## Out of scope (deferred or replaced)

- Per-model capability primitive in the contract schema. Capabilities are namespaced per target today; adding a per-model primitive would be a non-trivial schema change. The runtime gate plus typed error makes the constraint visible without it.
- `findUnique`-style APIs keyed on a unique constraint other than the primary key. Predicate-based `where(uniqueShape).first()` already covers this; a dedicated API can come later if usage justifies.
- MySQL adapter changes (no MySQL adapter in tree).
- Compile-time TS gating of MTI methods on id-less base tables (runtime gate is sufficient).
- SQLite RETURNING + AFTER-trigger divergence: documented as a JSDoc caveat. Decision recorded in todo #007 to revisit when the SQLite adapter actually exercises id-less + AFTER triggers.

## Acceptance criteria

- [ ] All five PK-required call sites in the ORM lane fail with operation-tagged errors on id-less tables — no silent `'id'` fallback remains.
- [ ] `updateCount()` / `deleteCount()` execute one statement (UPDATE/DELETE … RETURNING) and work on id-less tables.
- [ ] Nested `create()` / `update()` with `.select()` / `.include()` reload correctly on PK tables (regression guard) and on id-less tables that have at least one unique constraint.
- [ ] Nested update on id-less tables with no PK and no unique constraint throws an actionable error.
- [ ] Composite primary keys are honored in the row-identity criterion (every PK column is included).
- [ ] Doc section `docs/architecture docs/subsystems/3. Query Lanes.md` § *Id-less tables* describes the live end state with no "future work" framing.
- [ ] `pnpm --filter @prisma-next/sql-orm-client test` green; `pnpm test:packages` 110/110; `pnpm lint:deps` 0 violations.

## References

- PR: https://github.com/prisma/prisma-next/pull/440
- Parent PR: #424 (TML-2380)
- Doc: `docs/architecture docs/subsystems/3. Query Lanes.md` § *Id-less tables*
- Code review todos: `todos/001-014` (1 P1 + 5 P2 + 8 P3, all resolved)
- Stacked on: `feat/idless-models`
