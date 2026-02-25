# ORM Client — Phase 2 Plan

## Summary

Transition the `@prisma-next/sql-orm-client` closer to being the production-ready flagship API. Focus areas in priority order: fix DX bugs (types, autocompletion, result inference), integrate the ORM client into the `postgres()` one-liner with custom collections support, ensure queries flow through the Kysely lane so plugins work correctly, establish benchmarks, harden query correctness across all patterns, and improve API ergonomics with contextual method autocompletion.

**Spec:** `projects/orm-client/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Alexey Orlenko | Project lead, drives execution |
| Reviewer | Terminal team | Architectural review |

## Milestones

### Milestone 1: DX — Fix Types, Autocompletion, and Result Inference

Fix all bugs and correctness issues with TypeScript types, autocompletion, and result type inference in the ORM client.

**Validates:** All type-level tests pass, result types are correct for all query patterns, relationship traversal works in where() callbacks.

**Tasks:**

- [ ] **1.1** Fix broken `select` types in nested includes — `db.users.include('posts', p => p.select('title')).select('email').find()` currently infers included posts with all fields instead of only the selected `title`. Fix the type propagation and add vitest `expectTypeOf` tests (FR-1.1)
- [ ] **1.2** Audit result type inference for all query patterns — write type tests using vitest `expectTypeOf` covering: plain `all()`, `select()` narrowing, `include()` augmentation (to-one vs to-many), `select()` + `include()`, `combine()` result types, `aggregate()` return type, `groupBy().aggregate()` return type. Fix any incorrect types discovered (FR-1.2)
- [ ] **1.3** Expand result types via mapped type — replace opaque `DefaultModelRow<Contract, "User">` in IDE tooltips with an eagerly-evaluated mapped type that shows actual field names and types when hovered (FR-1.3)
- [ ] **1.4** Audit and fix `CreateInput` type derivation — verify required vs optional fields based on defaults, nullability, auto-increment, and generated columns. Add type tests using vitest `expectTypeOf` (FR-1.4)
- [ ] **1.5** Audit and fix relationship traversal autocompletion in `where()` callbacks — verify that `user.posts.some(post => post.title.eq(...))` provides correct autocompletion for nested model fields, including multi-level nesting. Add type tests using vitest `expectTypeOf` (FR-1.5)
- [ ] **1.6** Audit and fix type-state gating — verify `cursor()` requires `orderBy()`, `distinctOn()` requires `orderBy()`, mutations require `where()` (except create). Add type tests for both positive (compiles) and negative (`@ts-expect-error`) cases using vitest `expectTypeOf` (FR-1.6)
- [ ] **1.7** Settle on single model accessor name — currently the ORM client exposes all three forms (`Post`, `post`, `posts`) in autocompletion. Pick one canonical form and remove the other aliases from the type surface (FR-1.7)
- [ ] **1.8** Remove `LegacyModelRelations` — delete the legacy type and update any code that references it (FR-1.8)
- [ ] **1.9** Fix silent type breakage with `skipLibCheck: true` — currently emitting the contract to json + `.d.ts` fails silently if the user doesn't install `@prisma-next/contract` and `@prisma-next/sql-contract`. Evaluate generating normal `.ts` files instead of `.d.ts` to avoid this pitfall (FR-1.9)
- [ ] **1.10** Audit all publicly exported types — ensure they are correct, usable in downstream code (custom collections, generic utilities), and don't leak internal types (FR-1.10)
- [ ] **1.11** **(High priority)** Make `orderBy()` extensible — currently limited to built-in `column.asc()` / `column.desc()`. Design and implement an extensibility mechanism so that extensions like pgvector can inject custom ordering expressions (e.g., `p.embedding.cosineDistance(searchEmbedding)` producing `ORDER BY embedding <=> $1`) without the ORM client having first-party knowledge of the extension or its operators (FR-1B.1)
- [ ] **1.12** Audit other query methods for extensibility — check `select`, `groupBy`, `having`, `distinctOn`, and any other method that accepts column-based expressions. Ensure they can also accept extension-provided expressions where applicable (FR-1B.2)
- [ ] **1.13** Ensure extension operations are type-safe — extension-provided methods (e.g., pgvector distance operators) should only appear on columns of compatible types (vector columns), not on all columns (FR-1B.3)
- [ ] **1.14** Validate extensibility end-to-end with pgvector — demonstrate `db.posts.orderBy(p => p.embedding.cosineDistance(searchEmbedding)).take(10).all()` (or equivalent) working with the pgvector extension providing the operator, no orm-client changes required (FR-1B.4)

### Milestone 2: Example App Integration — `postgres()` One-Liner

Make the ORM client a first-class citizen of the `postgres()` function with support for custom collections. Ensure the ORM client builds queries via the Kysely lane so the Kysely AST is transformed to PN AST.

**Validates:** `db.orm.users` returns the custom collection type, example app works with `db.orm` from `postgres()`, ORM queries flow through the Kysely lane.

**Tasks:**

- [ ] **2.1** Add `collections` option to `PostgresOptions` — accept a map of model name aliases to `Collection` subclasses. Ensure the type parameter flows through to `PostgresClient<TContract>` so `db.orm.users` returns the custom collection type, not just a generic `Collection` (FR-2.1)
- [ ] **2.2** Update the `postgres()` factory to pass `collections` to the internal `orm()` call — ensure `db.orm` created by the one-liner has the same capabilities as a manually created `orm()` client (FR-2.2)
- [ ] **2.3** Add tests for `postgres()` with custom collections — verify type inference, custom collection method availability, and runtime behavior (FR-2.1, FR-2.2)
- [ ] **2.4** Update the example app to use `db.orm` from `postgres()` — replace the separate `createOrmClient()` pattern with `db.orm` from the one-liner. Pass custom `UserCollection` and `PostCollection` to the `postgres()` options (FR-2.3)
- [ ] **2.5** Verify that the manual `orm()` factory continues to work independently for advanced use cases (FR-2.4)

### Milestone 3: Plugin Correctness on ORM and Kysely Queries

Ensure ORM client queries flow through the Kysely lane so that plugins receive proper PN AST and operate correctly.

**Validates:** `ExecutionPlan.ast` is populated for ORM queries, `budgets` and `lints` plugins work correctly on ORM and Kysely-lane queries.

**Tasks:**

- [ ] **3.1** Audit the current ORM query compilation path — map how ORM queries currently produce SQL, whether they go through the Kysely lane, and whether `ExecutionPlan.ast` is populated. Document the current flow (FR-3.1)
- [ ] **3.2** Ensure ORM queries produce valid PN AST — if the ORM client compiles queries in a way that bypasses the Kysely lane transformation (`transformKyselyToPnAst()`), refactor so the `ExecutionPlan` contains a valid `plan.ast`. The ORM client should not compile Kysely queries to SQL itself (FR-3.1)
- [ ] **3.3** Add integration tests verifying `budgets` plugin works on ORM queries — test that unbounded SELECTs are blocked, row limits are enforced, and latency checks work when queries are built via the ORM client (FR-3.2)
- [ ] **3.4** Add integration tests verifying `lints` plugin works on ORM queries — test that `DELETE_WITHOUT_WHERE`, `UPDATE_WITHOUT_WHERE`, `NO_LIMIT`, and `SELECT_STAR` lint rules fire correctly on ORM-built queries (FR-3.3)
- [ ] **3.5** Verify the same plugin correctness for Kysely lane queries (`db.kysely`) — ensure plugins also work on queries built directly via the Kysely lane (FR-3.4)

### Milestone 4: Benchmarks

Establish baseline performance benchmarks for ORM query compilation and the Kysely lane transformation.

**Validates:** Benchmark suite exists, results are documented.

**Tasks:**

- [ ] **4.1** Create a benchmark harness for ORM query compilation — measure time from DSL method calls to final SQL + params for common query patterns (simple select, where + orderBy + take, include, nested include, aggregate, mutation) (FR-4.1)
- [ ] **4.2** Benchmark the Kysely lane transformation overhead — measure `transformKyselyToPnAst()` time for typical query complexity levels (FR-4.2)
- [ ] **4.3** Compare ORM query compilation to direct sql-lane usage — measure the overhead of going through the ORM layer vs building queries directly with `db.sql` (FR-4.3)
- [ ] **4.4** Document benchmark results and identify any performance hotspots

### Milestone 5: Query Correctness

Ensure all query types produce correct results across include strategies, mutations, aggregations, and edge cases.

**Validates:** Full include strategy test matrix passes, mutations handle edge cases, combine() works with all strategies, every terminal method produces correct results.

**Tasks:**

- [ ] **5.1** Add capability toggling to integration test infrastructure — support creating collections with different capability sets (lateral+jsonAgg, jsonAgg-only, neither) so all three include strategies can be tested against real PostgreSQL (FR-5.1)
- [ ] **5.2** Add/verify integration tests for all three include strategies — test simple include, include with where, include with orderBy + take, nested include (2+ levels), to-one, to-many, include with select on parent/child for each strategy (FR-5.1)
- [ ] **5.3** Fix `combine()` to work with lateral join and correlated subquery include strategies — currently only works with multi-query. Add SQL compilation tests and integration tests for all three strategies (FR-5.2)
- [ ] **5.4** Add integration tests for mutation edge cases — empty input arrays, null values in optional fields, missing defaults, nested mutation transaction boundaries, FK propagation, rollback on failure (FR-5.3, FR-5.4)
- [ ] **5.5** Add integration tests for include stitching edge cases — empty parent results, empty child results, null for to-one relations with no match, mixed cardinalities (FR-5.5)
- [ ] **5.6** Ensure integration tests cover every terminal method: `all()`, `find()`, `create()`, `createAll()`, `createCount()`, `update()`, `updateAll()`, `updateCount()`, `delete()`, `deleteAll()`, `deleteCount()`, `upsert()`, `aggregate()`, `groupBy().aggregate()` — add any missing coverage (FR-5.6)
- [ ] **5.7** Add error-path tests: invalid model names, invalid field names, empty result handling (FR-5.6)
- [ ] **5.8** Verify all test descriptions omit "should" per project convention

### Milestone 6: Contextual Method Autocompletion

Split column accessor interfaces to provide context-aware autocompletion — filter methods in `where()`, ordering methods in `orderBy()`.

**Validates:** `where()` callbacks only show filter methods, `orderBy()` callbacks only show ordering methods, verified manually in IDE.

**Tasks:**

- [ ] **6.1** Split `ComparisonMethods<T>` into separate interfaces — create `FilterMethods<T>` (eq, neq, gt, lt, gte, lte, like, ilike, in, notIn, isNull, isNotNull) and `OrderMethods` (asc, desc) in `types.ts` (FR-6.3)
- [ ] **6.2** Parameterize `ModelAccessor` proxy — make the proxy context-aware so that when accessed from `where()`, fields return `FilterMethods<T>`, and from `orderBy()`, fields return `OrderMethods`. Update `createModelAccessor()` / `createScalarFieldAccessor()` in `model-accessor.ts` (FR-6.4)
- [ ] **6.3** Update `Collection.where()` and `Collection.orderBy()` callback types — use the new split interfaces in the callback parameter types (FR-6.1, FR-6.2)
- [ ] **6.4** Add type tests using vitest `expectTypeOf` — verify `where()` callback field type has filter methods but not `asc`/`desc`, and `orderBy()` callback field type has ordering methods but not `eq`/`gt`/etc. (FR-6.1, FR-6.2)
- [ ] **6.5** Verify autocompletion manually in VS Code — confirm that filter methods don't appear in `orderBy()` and vice versa
- [ ] **6.6** Update existing tests and example app for any API changes (NFR-5)

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| select in nested includes correctly narrowed | vitest expectTypeOf | 1.1 | include + select type propagation |
| Result types correct for all query patterns | vitest expectTypeOf | 1.2 | All major patterns covered |
| Result types expanded in IDE tooltips | vitest expectTypeOf | 1.3 | No opaque DefaultModelRow |
| CreateInput derives correct required/optional | vitest expectTypeOf | 1.4 | Based on defaults, nullability |
| Relationship traversal works in where() | vitest expectTypeOf + Unit | 1.5 | Nested model fields |
| Type-state gating works | vitest expectTypeOf | 1.6 | Positive + negative cases |
| Single canonical model accessor name | Manual review | 1.7 | No Post/post/posts triplication |
| LegacyModelRelations removed | Manual review | 1.8 | Legacy type deleted |
| No silent breakage with skipLibCheck | Manual review | 1.9 | .ts instead of .d.ts |
| orderBy() accepts extension expressions | Unit + Integration | 1.11 | pgvector cosine distance |
| Other methods extensible | Unit | 1.12 | select, groupBy, etc. |
| Extension ops type-safe on compatible cols | vitest expectTypeOf | 1.13 | Vector ops only on vector cols |
| pgvector end-to-end ordering | Integration | 1.14 | No orm-client changes needed |
| postgres() accepts collections option | Unit + vitest expectTypeOf | 2.1, 2.3 | Type flow verified |
| db.orm functional from one-liner | Integration | 2.3 | Custom collections work |
| Example app uses db.orm | Manual review | 2.4 | No separate orm() call |
| ORM queries have plan.ast | Integration | 3.2-3.4 | PN AST populated |
| budgets plugin works on ORM queries | Integration | 3.3 | Row limits enforced |
| lints plugin works on ORM queries | Integration | 3.4 | Lint rules fire |
| Benchmark suite exists | Benchmark | 4.1-4.3 | Results documented |
| All include strategies correct | Integration | 5.2 | Full test matrix |
| combine() works with all strategies | SQL compilation + Integration | 5.3 | Critical fix |
| Mutation edge cases handled | Integration | 5.4 | Transactions, FK propagation |
| Include stitching edge cases | Integration | 5.5 | Empty results, null to-one |
| Every terminal method covered | Integration | 5.6 | 14 terminal methods |
| where() shows only filter methods | vitest expectTypeOf + Manual IDE | 6.1, 6.4, 6.5 | No asc/desc in where() |
| orderBy() shows only order methods | vitest expectTypeOf + Manual IDE | 6.2, 6.4, 6.5 | No eq/gt in orderBy() |

## Open Items

- **Autocompletion verification requires manual IDE testing** — no automated way to verify that TypeScript language server hides specific methods from completion lists.
- **Include strategy tests require PostgreSQL** — integration tests need a real PostgreSQL instance. Ensure CI has this configured.
- **combine() strategy expansion complexity** — implementing combine() for lateral/correlated may require significant compiler changes.
- **Benchmark methodology** — decide on harness (vitest bench, custom, etc.) and iteration counts for statistical significance.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/orm-client/spec.md`
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint:deps` pass cleanly
- [ ] Delete `projects/orm-client/`
