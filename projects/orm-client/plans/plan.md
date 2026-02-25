# ORM Client — Phase 2 Plan

## Summary

Transition the `@prisma-next/sql-orm-client` from "feature-complete prototype" to "production-ready flagship API." This involves a systematic code review, fixing the critical limitation that `combine()` only works with multi-query strategy, hardening include strategy coverage across all three strategies, improving IDE autocompletion by making the API contextual, adding filter interop helpers (Kysely bridge, raw SQL), implementing `db.$transaction()`, conducting an exhaustive Prisma ORM feature parity audit, writing comprehensive documentation, and exploring repository/model patterns.

**Spec:** `projects/orm-client/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Alexey Orlenko | Project lead, drives execution |
| Reviewer | Terminal team | Architectural review |

## Progress Log (2026-02-25)

### Latest status

- ✅ Review sweep across `sql-orm-client/src/**` and `sql-orm-client/test/**` completed.
- ✅ Review artifact created: `projects/orm-client/assets/code-review-notes.md`.
- ✅ User decisions captured:
  - `upsert({ update: {} })` must fail at both type-level and runtime.
  - Nested `connect` should match Prisma strictness: throw when any criterion misses.
- 🚧 Fix execution started with one-issue-per-commit policy and validation gates.

### Active implementation sequence (commit-scoped)

1. **Fix-01:** `upsert({ update: {} })` guardrails
   - Type-level: make empty `update` invalid in `Collection.upsert()` input type.
   - Runtime: reject empty mapped update payload before compilation.
   - Tests:
     - Runtime/unit: `test/sql-compilation/upsert.test.ts`
     - Type-level: `test/generated-contract-types.test-d.ts`
2. **Fix-02:** nested `connect` strictness
   - Child-owned `connect`: throw when any criterion has no matching row.
   - Parent-owned `connect/create`: enforce single-target cardinality and throw on ambiguous arrays.
   - Tests:
     - Integration: `test/integration/nested-mutations.test.ts`
     - Unit where applicable.
3. **Fix-03:** empty list predicate handling
   - `in([])` and `notIn([])` must not compile to invalid SQL.
   - Tests:
     - SQL compilation: `test/sql-compilation/**`
     - Unit: `test/model-accessor.test.ts` / `test/filters.test.ts` if needed.
4. **Fix-04:** close loop on docs/plan traceability
   - Update this plan with completed items, file references, and carry-forward backlog.

### Validation gate (required per commit)

```bash
pnpm --filter @prisma-next/sql-orm-client test
pnpm --filter @prisma-next/sql-orm-client lint
pnpm --filter @prisma-next/sql-orm-client typecheck
```

### Carry-forward backlog (not in current fix batch)

- `combine()` support for lateral/correlated single-query strategies (Tasks 1.2–1.5).
- `db.$transaction()` API on orm client (Task 3.9).
- Include strategy integration capability toggling matrix (Task 2.1 and dependent tests).

## Milestones

### Milestone 1: Code Review, Prisma Audit & Critical Fixes

Systematic review of the entire `sql-orm-client` codebase, fix the critical `combine()` strategy limitation, clean up dead code, and produce an exhaustive Prisma ORM feature audit that informs all subsequent work.

**Validates:** Code review complete, combine() works with all three strategies, Prisma audit document exists.

**Tasks:**

- [x] **1.1** Review all source files in `src/` for correctness, consistency, and adherence to project patterns (FR-1.1 through FR-1.5). Document all issues found in a review notes file at `projects/orm-client/assets/code-review-notes.md`
- [ ] **1.2** Fix `combine()` to work with lateral join include strategy — currently `combine()` only works with multi-query; implement lateral join compilation for combine branches where each branch becomes a separate LATERAL subquery with its own filters/ordering/aggregation (FR-7.3, Resolved Q4)
- [ ] **1.3** Fix `combine()` to work with correlated subquery include strategy — implement correlated subquery compilation for combine branches (FR-7.3, Resolved Q4)
- [ ] **1.4** Add SQL compilation tests for `combine()` with lateral and correlated strategies — verify correct SQL output for combine branches with mixed row and scalar selectors under each strategy
- [ ] **1.5** Add integration tests for `combine()` with all three strategies — test against real PostgreSQL with capability toggling, verifying row branches, scalar branches, and mixed branches produce correct results
- [ ] **1.6** Remove dead code, unused types, and leftover prototype artifacts identified during review (FR-1.6)
- [ ] **1.7** Fix all issues identified during code review (FR-1.1 through FR-1.5) — mutation edge cases, nested mutation transaction boundaries, include stitching edge cases, compiler correctness, type-state gating
- [ ] **1.8** Conduct exhaustive Prisma ORM feature audit — document every Prisma Client method and feature with a keep/skip/defer decision and rationale. Output: `projects/orm-client/assets/prisma-parity-audit.md` (FR-5.5)

### Milestone 2: Include Strategy Hardening & Test Suite Quality

Ensure all three include strategies (lateral, correlated, multi-query) have comprehensive integration coverage with real PostgreSQL, and bring the overall test suite to production quality.

**Validates:** Full include strategy test matrix passes, every terminal method has integration coverage, type-level tests are comprehensive.

**Tasks:**

- [ ] **2.1** Add capability toggling to integration test infrastructure — extend `test/integration/helpers.ts` to support creating collections with different capability sets (lateral+jsonAgg, jsonAgg-only, neither) so all three strategies can be tested against real PostgreSQL (FR-7.4)
- [ ] **2.2** Add integration tests for lateral join strategy — test simple include, include with where, include with orderBy + take, nested include (2+ levels), to-one include, to-many include, include with select on parent, include with select on child (FR-7.1)
- [ ] **2.3** Add integration tests for correlated subquery strategy — same test matrix as lateral (FR-7.1)
- [ ] **2.4** Verify multi-query strategy integration tests cover the full matrix — add any missing scenarios (FR-7.1)
- [ ] **2.5** Add integration tests for include scalar aggregations (count, sum, avg, min, max) with each applicable strategy (FR-7.2)
- [ ] **2.6** Ensure integration tests cover every terminal method: `all()`, `find()`, `create()`, `createAll()`, `createCount()`, `update()`, `updateAll()`, `updateCount()`, `delete()`, `deleteAll()`, `deleteCount()`, `upsert()`, `aggregate()`, `groupBy().aggregate()` — add any missing coverage (FR-8.2)
- [ ] **2.7** Add error-path tests: invalid model names in `orm()`, invalid field names in `where()`/`select()`/`orderBy()`, empty result handling for `find()`, `update()`, `delete()` (FR-8.3)
- [ ] **2.8** Expand type-level tests (`*.test-d.ts`) to cover: select narrowing, include type augmentation (to-one vs to-many), type-state transitions (where → hasWhere, orderBy → hasOrderBy), CreateInput required/optional derivation, mutation return types, combine result types (FR-8.6)
- [ ] **2.9** Review test organization and refactor where needed — group tests by feature area, verify all descriptions omit "should" (FR-8.4, FR-8.5)
- [ ] **2.10** Ensure every public API method has at least one unit test and one SQL compilation test — audit exports against test coverage and fill gaps (FR-8.1)

### Milestone 3: API Ergonomics, Filter Interop & New Capabilities

Make the API surface contextual for better autocompletion, add filter interop helpers, implement new terminal methods, and resolve all open design questions from the previous spec.

**Validates:** IDE autocompletion is contextual, filter helpers work and compose with `and()`/`or()`/`not()`, new terminals exist, design questions are resolved with working examples.

**Tasks:**

- [ ] **3.1** Redesign Collection type-state to hide methods from autocompletion — currently methods use conditional parameter types (`never`) but still appear in IDE suggestions. Use conditional types on the type-state generic to actually exclude method signatures when preconditions aren't met. Start with conditional types; fall back to interface splitting if needed. Verify with manual IDE testing (FR-3.1, FR-3.3, FR-3.4)
- [ ] **3.2** Separate include refinement surface from top-level collection — ensure `count()`, `sum()`, `avg()`, `min()`, `max()`, `combine()` do not appear on top-level collections, and terminal methods (`all()`, `find()`, mutations) do not appear in include refinement context. The existing `IncludeRefinementCollection` type using `Omit<>` may already achieve this for types; verify autocompletion behavior (FR-3.2, FR-3.1)
- [ ] **3.3** Separate column accessor contexts — model accessor currently exposes both filter methods (eq, gt, like, etc.) and order methods (asc, desc) on the same proxy. Make the accessor context-aware: `where()` callbacks should only show filter methods, `orderBy()` callbacks should only show ordering methods (FR-3.1 — column accessors)
- [ ] **3.4** Implement `count()` shorthand terminal — `db.users.where(...).count()` returning `Promise<number>`. Sugar for `.aggregate(a => ({ count: a.count() })).then(r => r.count)` (FR-5.1)
- [ ] **3.5** Implement `exists()` terminal — `db.users.where(...).exists()` returning `Promise<boolean>`. Compile to `SELECT EXISTS(SELECT 1 FROM ... WHERE ...)` (FR-5.2)
- [ ] **3.6** Implement Kysely filter bridge — a helper function that takes a Kysely `ExpressionBuilder` callback, compiles it to SQL + params, and wraps the result in a `WhereExpr` AST node (a new `RawExpr` kind or similar). Must produce `WhereExpr` nodes, not opaque wrappers (FR-6.1, Resolved Q2)
- [ ] **3.7** Implement raw SQL filter helper — `rawFilter(sql, ...params)` or tagged template that produces a `WhereExpr` wrapping a raw SQL fragment. Include type-safe column name access for the model (FR-6.2)
- [ ] **3.8** Add tests for filter interop helpers — verify both Kysely bridge and raw SQL filter compose with `and()`, `or()`, `not()`, work in `where()` callbacks, and produce correct SQL (FR-6.3)
- [ ] **3.9** Implement `db.$transaction()` — wraps `RuntimeQueryable.transaction()` to create a scoped ORM client where all operations use the same transaction connection. The callback receives a transactional ORM client instance (FR-5.4, Resolved Q3)
- [ ] **3.10** Design and implement conditional method application — an ergonomic, type-safe pattern for conditionally applying query methods (e.g., `.if(cursor, q => q.cursor(cursor))` or a pipe/pipeline pattern). Document with examples (FR-4.4)
- [ ] **3.11** Design and document generic reusable filter pattern — how to build filters that work on any model with a given field (e.g., any model with an `email` field). Prototype at least one working example (FR-4.1)
- [ ] **3.12** Design and document extension operator approach — how extensions (ParadeDB, pgvector) can add custom `WhereExpr` operators. This builds on the raw SQL filter (FR-6.2) and the `RawExpr` WhereExpr kind (FR-4.2)
- [ ] **3.13** Evaluate and implement `omit()` — decide between `select(schema.users.fields.omit('password'))` vs a dedicated `omit(...fields)` method. Implement the chosen approach or document deferral rationale (FR-4.3)
- [ ] **3.14** Update all existing tests and demo app for any breaking API changes introduced in this milestone (NFR-5)

### Milestone 4: Documentation & Exploration

Write comprehensive documentation positioning the ORM client as the flagship API, add JSDoc to all exports, and explore repository/model patterns.

**Validates:** README is comprehensive, root README showcases ORM client, all exports have JSDoc, exploration documents exist.

**Tasks:**

- [ ] **4.1** Write comprehensive package README — cover setup, basic queries (all/find), filtering (where callback, shorthand, and/or/not), includes (simple, refined, nested, combine), select/omit, ordering and pagination, mutations (create, update, delete, upsert, nested), aggregations (aggregate, groupBy, having), custom collections, streaming, filter interop, transactions, conditional application, and advanced patterns (FR-2.1)
- [ ] **4.2** Update root README to showcase ORM client as flagship API — add prominent code examples demonstrating: (1) basic CRUD with type safety, (2) composable custom collections, (3) streaming large result sets, and highlight key value propositions vs Prisma ORM (FR-2.2)
- [ ] **4.3** Add JSDoc comments to all public API exports — Collection methods, `orm()`, `and()`, `or()`, `not()`, `all()`, `GroupedCollection`, `AggregateBuilder`, type exports (`CreateInput`, `CollectionTypeState`, `ModelAccessor`, etc.) (FR-2.3)
- [ ] **4.4** Explore custom repository pattern — prototype a Repository subclass of Collection that owns transaction scoping, validation, or business logic. Evaluate ergonomics and document findings in `projects/orm-client/assets/repository-exploration.md` (FR-9.1)
- [ ] **4.5** Explore typed model instances — investigate what query results as class instances (with methods, immutability, change tracking, lazy relations) would look like. Document trade-offs and recommendation in `projects/orm-client/assets/model-instances-exploration.md` (FR-9.2, FR-4.5)
- [ ] **4.6** Document recommended patterns for repository/active-record abstractions built on top of the collection API (FR-9.3)
- [ ] **4.7** Final verification — run `pnpm test`, `pnpm typecheck`, `pnpm lint:deps` to confirm everything passes cleanly (NFR-1, NFR-2, NFR-3)

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| All source files reviewed and issues fixed | Manual review | 1.1, 1.7 | Review notes document as evidence |
| No dead code or unused types | Manual review + grep | 1.6 | Part of code review |
| pnpm test/typecheck/lint:deps pass | CI / Manual | 4.7 | Final verification gate |
| Package README comprehensive | Manual review | 4.1 | Check all feature areas covered |
| Root README showcases ORM client | Manual review | 4.2 | At least 3 code examples |
| All public exports have JSDoc | Grep/manual | 4.3 | Audit exports vs JSDoc |
| Autocompletion: fresh collection hides mutations | Manual IDE test | 3.1 | Test in VS Code / WebStorm |
| Autocompletion: where() enables mutations | Manual IDE test | 3.1 | Test in VS Code / WebStorm |
| Column accessors context-aware | Manual IDE test | 3.3 | where() vs orderBy() callbacks |
| Include refinement methods hidden on top-level | Manual IDE test | 3.2 | Verify with TS language server |
| Terminal methods hidden in include context | Manual IDE test | 3.2 | Verify with TS language server |
| cursor()/distinctOn() hidden without orderBy() | Manual IDE test | 3.1 | Verify with TS language server |
| Generic reusable filter pattern documented | Manual review | 3.11 | Working example included |
| Extension operator approach documented | Manual review | 3.12 | Design document |
| omit decision made and implemented/deferred | Manual review | 3.13 | Code or rationale document |
| Conditional method application designed | Manual review + Unit | 3.10 | Working examples + tests |
| Model instances exploration documented | Manual review | 4.5 | Trade-off analysis |
| count() shorthand implemented | Unit + Integration | 3.4 | Test returns Promise\<number\> |
| exists() terminal implemented | Unit + Integration | 3.5 | Test returns Promise\<boolean\> |
| Transaction API documented/implemented | Unit + Integration | 3.9 | Test multi-operation tx |
| Prisma ORM audit documented | Manual review | 1.8 | Every feature has keep/skip/defer |
| Kysely bridge helper tested | Unit + SQL compilation | 3.6, 3.8 | Produces WhereExpr, composes |
| Raw SQL filter helper tested | Unit + SQL compilation | 3.7, 3.8 | Produces WhereExpr, composes |
| Both filter helpers compose with and/or/not | Unit | 3.8 | Composition tests |
| Lateral strategy: full include test matrix | Integration | 2.2 | 8 scenarios against real PG |
| Correlated strategy: full include test matrix | Integration | 2.3 | 8 scenarios against real PG |
| Multi-query strategy: full include test matrix | Integration | 2.4 | Verify existing + fill gaps |
| Include scalar aggregations tested per strategy | Integration | 2.5 | count/sum/avg/min/max |
| combine() works with all three strategies | SQL compilation + Integration | 1.2-1.5 | Critical fix + tests |
| Every public API method has unit + SQL test | Unit + SQL compilation | 2.10 | Audit exports vs tests |
| Every terminal method has integration test | Integration | 2.6 | 14 terminal methods |
| Error-path tests exist | Unit + Integration | 2.7 | Invalid inputs, empty results |
| All test descriptions omit "should" | Grep | 2.9 | `grep -r "should"` on test files |
| Type-level tests comprehensive | Type test (.test-d.ts) | 2.8 | 6 scenarios minimum |
| Repository pattern prototype | Manual review | 4.4 | Evaluation document |
| Model instance exploration | Manual review | 4.5 | Trade-off document |

## Open Items

- **Autocompletion verification requires manual IDE testing** — no automated way to verify that TypeScript language server hides specific methods from completion lists. Consider adding screenshot evidence or a verification checklist.
- **Lateral/correlated strategy integration tests require PostgreSQL** — these tests can only run in environments with a PostgreSQL instance available. Ensure CI has this configured.
- **combine() strategy expansion complexity** — implementing combine() for lateral/correlated may require significant compiler changes. If the lateral implementation proves too complex, the correlated fallback must still work. Both must be implemented per Resolved Q4.
- **Prisma feature audit is extensive** — the exhaustive audit (FR-5.5) covers every documented Prisma Client feature. This research task may surface additional FR items that should be tracked as follow-up work rather than scope-creeping this phase.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/orm-client/spec.md`
- [ ] Migrate long-lived docs (Prisma audit, exploration docs, any ADRs) into `docs/`
- [ ] Delete `projects/orm-client/`
