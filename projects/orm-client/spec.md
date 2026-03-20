# ORM Client — Phase 2: DX, Integration, and Polish

A consolidation pass over the `@prisma-next/sql-orm-client` package following the initial implementation. This phase focuses on fixing type and autocompletion bugs, integrating the ORM client into the `postgres()` one-liner, ensuring ORM plans carry valid PN ASTs for plugin behavior, verifying query correctness, and improving API ergonomics with contextual method autocompletion.

# Description

The initial ORM client implementation (`@prisma-next/sql-orm-client`) is feature-complete per the original spec. All 16 task groups were implemented: Collection with full query builder API, three include strategies (lateral/correlated/multi-query), mutations (CRUD + upsert + nested), aggregations, groupBy, cursor pagination, distinct/distinctOn, select with type narrowing, type-state tracking, and the `orm()` factory with custom collection support.

This phase transitions the ORM client from "implemented" to "production-ready flagship API." The work spans:

- **DX correctness**: Fix bugs in TypeScript types, autocompletion, result type inference, and relationship traversal.
- **Example app integration**: Make the ORM client available as `db.orm` from the `postgres()` one-liner, with support for custom collections passed directly to the one-liner. The ORM client plans queries directly from ORM DSL to PN AST, which then flows through runtime plugins and adapter lowering.
- **Plugin correctness**: Ensure plugins (`budgets`, `lints`) operate correctly on queries built via the ORM client and the Kysely lane, by verifying the `ExecutionPlan` contains a valid PN AST in both paths.
- **Benchmarks**: Establish baseline performance benchmarks for ORM query compilation and Kysely lane transformation overhead.
- **Query correctness**: Ensure all query types produce correct results across include strategies, mutations, aggregations, and edge cases.
- **Contextual autocompletion**: Split column accessor interfaces so filter methods only appear in `where()` and ordering methods only appear in `orderBy()`.

**Linear project:** [PN] Model Query Client — https://linear.app/prisma-company/project/pn-model-query-client-7fbff952f5dc

# Requirements

## Functional Requirements

### FR-1: DX — Types, Autocompletion, and Result Types

Fix all bugs and correctness issues in the TypeScript types and autocompletion behavior of the ORM client.

- **FR-1.1**: Fix broken `select` types in nested includes. Currently `db.users.take(limit).include('posts', p => p.select('title')).select('email').find()` infers the included posts as having all fields (createdAt, embedding, id, title, userId) instead of only the selected `title` field.
- **FR-1.2**: Verify and fix that result types are correctly inferred for all query patterns: plain `all()`, with `select()`, with `include()`, with `select()` + `include()`, with `combine()`, with `aggregate()`, with `groupBy().aggregate()`.
- **FR-1.3**: Expand result types via a mapped type instead of exposing opaque type aliases like `DefaultModelRow<Contract, "User">` in IDE tooltips. Result types should show actual field names and types when hovered.
- **FR-1.4**: Verify and fix that `CreateInput` types correctly derive required vs optional fields based on defaults, nullability, and auto-increment.
- **FR-1.5**: Verify and fix that relationship traversal in `where()` callbacks produces correct autocompletion for nested model fields (e.g., `user.posts.some((post) => post.title.eq(...))`).
- **FR-1.6**: Verify and fix that type-state gating works correctly: `cursor()` requires `orderBy()`, `distinctOn()` requires `orderBy()`, mutations require `where()` (except create).
- **FR-1.7**: Settle on a single model accessor name on the ORM client. Currently all three forms (`Post`, `post`, `posts`) appear in autocompletion. Pick one canonical form and remove the aliases.
- **FR-1.8**: Remove `LegacyModelRelations` — clean up the legacy type that is no longer needed.
- **FR-1.9**: Fix silently broken types when using `skipLibCheck: true`. Currently emitting the contract to json + `.d.ts` breaks if the user doesn't install the packages imported by the `.d.ts` file (`@prisma-next/contract` and `@prisma-next/sql-contract`), and `skipLibCheck: true` hides these errors. Consider generating normal `.ts` files instead of `.d.ts` to avoid this pitfall.
- **FR-1.10**: Ensure all publicly exported types are correct and usable in downstream code (custom collections, generic utilities, etc.).

### FR-1B: Extensible Query Methods

**High priority.** Make `orderBy` and other relevant query builder methods extensible in the same way as `where`. Currently `where()` supports arbitrary `WhereExpr` nodes (including extension-provided ones via `kysely.whereExpr()`), but `orderBy()` is limited to built-in `column.asc()` / `column.desc()`. Extensions like pgvector must be able to inject custom ordering expressions (e.g., ordering by cosine distance `embedding <=> $1`) without the ORM client having any first-party knowledge of pgvector or its operators.

- **FR-1B.1**: `orderBy()` must accept extension-provided ordering expressions, not just `column.asc()` / `column.desc()`. For example, pgvector's `cosineDistance(column, embedding)` must be usable in `orderBy()` to produce `ORDER BY embedding <=> $1`.
- **FR-1B.2**: Audit all other query builder methods (`select`, `groupBy`, `having`, `distinctOn`, etc.) for the same extensibility gap. Any method that accepts column-based expressions should also accept extension-provided expressions.
- **FR-1B.3**: The extensibility mechanism must be type-safe — extension operations should only appear on columns of compatible types (e.g., pgvector distance operators only on vector columns).
- **FR-1B.4**: Validate the design by demonstrating end-to-end pgvector usage: `db.posts.orderBy(p => p.embedding.cosineDistance(searchEmbedding)).take(10).all()` or equivalent, with the pgvector extension providing the operator without any orm-client changes.

### FR-2: Example App Integration — `postgres()` One-Liner

Make the ORM client a first-class citizen of the `postgres()` one-liner, so users get a fully pre-instantiated ORM client with no additional setup. The ORM client must plan queries directly to PN AST, so that runtime plugins operate on the same canonical AST used by adapter lowering. Kysely remains available separately via `db.kysely`.

- **FR-2.1**: Add a `collections` option to `PostgresOptions` that accepts a map of model name aliases to `Collection` subclasses. The type parameter must flow through so that `db.orm.users` returns the custom collection type.
- **FR-2.2**: `db.orm` must be fully functional with the same capabilities as an `orm()` factory created manually — including custom collection methods, relationship traversal, and all query patterns.
- **FR-2.3**: Update the example app to use `db.orm` from the `postgres()` one-liner instead of creating a separate ORM client via `orm()`.
- **FR-2.4**: Users who need more low-level control can still create a runtime manually and use the `orm()` factory directly.

### FR-3: Plugin Correctness on ORM and Kysely Queries

Ensure plugins operate correctly on queries built via the ORM client and the Kysely lane.

- **FR-3.1**: ORM client queries must flow through the direct planning path: ORM DSL → PN AST → plugin pipeline → adapter lowering → execution. The `ExecutionPlan` must contain a valid `plan.ast` (PN `QueryAst`).
- **FR-3.2**: Verify that the `budgets` plugin correctly estimates row counts and enforces limits on ORM queries.
- **FR-3.3**: Verify that the `lints` plugin correctly applies lint rules (`DELETE_WITHOUT_WHERE`, `UPDATE_WITHOUT_WHERE`, `NO_LIMIT`, `SELECT_STAR`) to ORM queries.
- **FR-3.4**: Verify the same plugin correctness for queries built directly via the Kysely lane (`db.kysely`), where Kysely AST is transformed to PN AST before plugin execution.

### FR-4: Benchmarks

Establish baseline performance benchmarks for ORM query compilation and Kysely lane transformation.

- **FR-4.1**: Benchmark ORM query compilation (ORM DSL → PN AST → lowered SQL) for common query patterns: simple select, where + orderBy + take, include, nested include, aggregate, mutation.
- **FR-4.2**: Benchmark the Kysely lane transformation overhead (`transformKyselyToPnAst()`) for typical query complexity levels.
- **FR-4.3**: Compare ORM query compilation performance to direct sql-lane usage.

### FR-5: Query Correctness

Ensure all query types produce correct results.

- **FR-5.1**: All three include strategies (lateral, correlated, multi-query) must produce correct results for: simple include, include with where, include with orderBy + take, nested include (2+ levels), to-one, to-many, include with select on parent/child.
- **FR-5.2**: `combine()` must work with all three include strategies (currently only works with multi-query — must be extended to lateral and correlated).
- **FR-5.3**: All mutation paths (create, update, delete, upsert) must handle edge cases: empty input arrays, null values in optional fields, missing defaults.
- **FR-5.4**: Nested mutation orchestration must correctly handle transaction boundaries, FK propagation for both parent-owned and child-owned relations, and rollback on failure.
- **FR-5.5**: Include stitching must correctly handle: empty parent results, empty child results, null for to-one relations with no match, mixed cardinalities in the same query.
- **FR-5.6**: Every terminal method must produce correct results: `all()`, `find()`, `create()`, `createAll()`, `createCount()`, `update()`, `updateAll()`, `updateCount()`, `delete()`, `deleteAll()`, `deleteCount()`, `upsert()`, `aggregate()`, `groupBy().aggregate()`.

### FR-6: Contextual Method Autocompletion

Split the column accessor interfaces to make autocompletion context-aware, following the interface segregation principle. Currently methods like `eq`, `gt`, `like` and `asc`/`desc` are lumped together in the single `ComparisonMethods<T>` interface. Using a filter in `orderBy()` or a sort direction in `where()` produces a type error, but the methods still clutter autocompletion.

- **FR-6.1**: `where()` callbacks should only show filter methods (`eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `like`, `ilike`, `in`, `notIn`, `isNull`, `isNotNull`) on column accessors — not `asc()` or `desc()`.
- **FR-6.2**: `orderBy()` callbacks should only show ordering methods (`asc`, `desc`) on column accessors — not filter methods.
- **FR-6.3**: The `ComparisonMethods<T>` interface in `types.ts` must be split into `FilterMethods<T>` and `OrderMethods`.
- **FR-6.4**: The `ModelAccessor` proxy in `model-accessor.ts` must be parameterized to only expose methods valid for the given context.

## Non-Functional Requirements

- **NFR-1**: All existing tests continue to pass (`pnpm test`).
- **NFR-2**: Type checking passes across the monorepo (`pnpm typecheck`).
- **NFR-3**: Architectural boundaries are maintained (`pnpm lint:deps`).
- **NFR-4**: No regression in query compilation performance.
- **NFR-5**: Breaking changes in the API are allowed but the demo app must be updated accordingly. Never add backward compatibility adapters, aliases or stubs.

## Non-goals

- **Pagination primitives** (offset/cursor pagination abstractions with page tokens) — deferred.
- **Middleware/plugin system implementation** — not a responsibility of the ORM client.
- **Query plan caching** — deferred unless profiling shows compilation as a bottleneck.
- **Full-text search helpers** — out of scope.
- **Soft delete built-in** — can be implemented via custom collection methods.
- **Connection pooling or driver-level concerns** — handled by the adapter/driver layer.
- **Comprehensive documentation** — deferred to a future phase.
- **Custom repository/model pattern exploration** — deferred.
- **Filter interop helpers** (Kysely bridge, raw SQL filter) — the existing `kysely.whereExpr()` is sufficient for now.
- **Prisma ORM feature parity audit** — deferred.
- **Open question resolution** (generic reusable filters, extension operators, omit, conditional method application, typed model instances) — deferred.

# Acceptance Criteria

## DX
- [ ] `select` in nested includes produces correctly narrowed types (not all fields)
- [ ] Result types are correctly inferred for all query patterns (select, include, combine, aggregate, groupBy)
- [ ] Result types are expanded via mapped types in IDE tooltips (no opaque `DefaultModelRow<...>`)
- [ ] `CreateInput` types correctly derive required vs optional fields
- [ ] Relationship traversal autocompletion works in `where()` callbacks
- [ ] Type-state gating works correctly (cursor requires orderBy, etc.)
- [ ] Single canonical model accessor name (no `Post`/`post`/`posts` triplication)
- [ ] `LegacyModelRelations` removed
- [ ] Contract emission generates `.ts` instead of `.d.ts` (or otherwise avoids silent breakage with `skipLibCheck: true`)
- [ ] All public type exports are correct and usable

## Extensible Query Methods
- [ ] `orderBy()` accepts extension-provided ordering expressions (not just `asc`/`desc`)
- [ ] Other relevant query methods (`select`, `groupBy`, `having`, `distinctOn`) accept extension-provided expressions where applicable
- [ ] Extension operations are type-safe (only appear on compatible column types)
- [ ] End-to-end pgvector ordering works without first-party pgvector knowledge in the ORM client

## Example App Integration
- [ ] `postgres()` accepts a `collections` option with proper type flow
- [ ] `db.orm` is fully functional with custom collections from the one-liner
- [ ] Example app uses `db.orm` from `postgres()` instead of separate `orm()` call
- [ ] Manual `orm()` factory still works for advanced use cases

## Plugin Correctness
- [ ] ORM queries plan directly to PN AST
- [ ] `ExecutionPlan` from ORM queries contains valid `plan.ast`
- [ ] `budgets` plugin works on ORM queries
- [ ] `lints` plugin works on ORM queries
- [ ] `db.kysely` queries still flow through the Kysely lane (Kysely AST → PN AST)

## Benchmarks
- [ ] Baseline benchmarks exist for ORM query compilation
- [ ] Kysely lane transformation overhead is measured
- [ ] ORM vs sql-lane compilation performance is compared

## Query Correctness
- [ ] All three include strategies produce correct results for the full test matrix
- [ ] `combine()` works with all three strategies
- [ ] Mutation edge cases are handled correctly
- [ ] Nested mutations handle transactions, FK propagation, rollback
- [ ] Include stitching handles empty results, null to-one, mixed cardinalities
- [ ] Every terminal method produces correct results

## Contextual Autocompletion
- [ ] `where()` callbacks only show filter methods on column accessors
- [ ] `orderBy()` callbacks only show ordering methods on column accessors
- [ ] IDE autocompletion verified manually in VS Code

# Other Considerations

## Security

No new security concerns. The ORM client delegates all SQL execution to the runtime layer, which handles parameterization.

## Cost

No infrastructure cost impact. This is a library-level change with no runtime infrastructure dependencies.

## Observability

No changes. Query execution observability is handled by the runtime layer's plugin/hook system.

# References

- Previous spec: `projects/orm-client/specs/phase1-completed-spec/spec.md`
- Previous tasks: `projects/orm-client/specs/phase1-completed-spec/tasks.md`
- Prisma ORM comparison: `projects/orm-client/specs/phase1-completed-spec/prisma-orm-comparison.md`
- Package source: `packages/3-extensions/sql-orm-client/`
- Postgres one-liner: `packages/3-extensions/postgres/src/runtime/postgres.ts`
- Kysely lane: `packages/2-sql/4-lanes/kysely-lane/`
- Demo app: `examples/prisma-next-demo/src/orm-client/`
- Linear project: https://linear.app/prisma-company/project/pn-model-query-client-7fbff952f5dc

# Resolved Questions

1. **`combine()` strategy expansion**: `combine()` *must* work with all three include strategies (lateral, correlated, multi-query). Multi-query-only is not acceptable.

2. **Terminology**: Keep "Collection."

3. **Contextual autocompletion approach**: Split `ComparisonMethods<T>` into `FilterMethods<T>` and `OrderMethods`. Parameterize the `ModelAccessor` proxy to only expose methods valid for the given context.

# Open Questions

_None remaining._
