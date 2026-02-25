# ORM Client — Phase 2: Stabilization, Polish, and Extension

A consolidation and extension pass over the `@prisma-next/sql-orm-client` package following the completion of the initial implementation (16 task groups, ~6000 lines). This phase focuses on code quality review, documentation, API ergonomics, test coverage hardening, and closing design gaps before the ORM client becomes the flagship Prisma Next API.

# Description

The initial ORM client implementation (`@prisma-next/sql-orm-client`) is feature-complete per the original spec. All 16 task groups were implemented: Collection with full query builder API, three include strategies (lateral/correlated/multi-query), mutations (CRUD + upsert + nested), aggregations, groupBy, cursor pagination, distinct/distinctOn, select with type narrowing, type-state tracking, and the `orm()` factory with custom collection support.

This phase transitions the ORM client from "implemented" to "production-ready flagship API." The work spans:

- **Code review and stabilization**: Systematic review of all implemented code, fixing issues, removing dead code, and ensuring consistency.
- **Documentation**: Writing comprehensive docs and updating the root README to position the ORM client as the primary Prisma Next API.
- **API ergonomics**: Improving autocompletion by making the API surface more contextual — methods that don't apply in a given context should not appear.
- **Design gaps**: Resolving open questions from the previous spec's Q&A session and identifying remaining gaps relative to Prisma ORM feature parity.
- **Novel capabilities**: Identifying and implementing features that Prisma Next's architecture enables but Prisma ORM cannot offer.
- **Filter interop**: Building helpers to construct `WhereExpr` nodes from Kysely filter expressions and raw SQL fragments.
- **Include strategy coverage**: Ensuring all three include strategies are tested end-to-end with full functionality.
- **Test quality**: Improving test suite structure, coverage, and reliability.
- **Repository/model exploration**: Investigating how custom repository and typed model patterns could extend the collection API.

**Linear project:** [PN] Model Query Client — https://linear.app/prisma-company/project/pn-model-query-client-7fbff952f5dc

# Requirements

## Functional Requirements

### FR-1: Code Review and Issue Resolution

Review all source files in `packages/3-extensions/sql-orm-client/src/` for correctness, consistency, and adherence to project patterns. Specifically:

- **FR-1.1**: Verify all mutation paths (create, update, delete, upsert) handle edge cases: empty input arrays, null values in optional fields, missing defaults.
- **FR-1.2**: Verify nested mutation orchestration correctly handles transaction boundaries, FK propagation for both parent-owned and child-owned relations, and rollback on failure.
- **FR-1.3**: Verify include stitching correctly handles: empty parent results, empty child results, null for to-one relations with no match, mixed cardinalities in the same query.
- **FR-1.4**: Verify the Kysely compiler produces correct SQL for all combinations of query state (where + orderBy + take + skip + cursor + distinct + select + include).
- **FR-1.5**: Verify type-state gating works correctly: `cursor()` requires `orderBy()`, `distinctOn()` requires `orderBy()`, mutations require `where()` (except create).
- **FR-1.6**: Remove any dead code, unused types, or leftover prototype artifacts.

### FR-2: Documentation

- **FR-2.1**: Write comprehensive package-level documentation in `packages/3-extensions/sql-orm-client/README.md` covering: setup, basic queries, filtering, includes, mutations, aggregations, custom collections, and advanced patterns.
- **FR-2.2**: Update the root `README.md` to showcase the ORM client as the flagship Prisma Next API, with prominent examples demonstrating the key value propositions (composability, streaming, type safety, custom collections).
- **FR-2.3**: Add JSDoc comments to all public API exports (Collection methods, `orm()`, filter combinators, type exports).

### FR-3: Contextual Autocompletion

The current Collection class exposes all methods on a single class, meaning IDE autocompletion shows mutation methods alongside query methods, include refinement methods outside of include callbacks, etc. Improve this:

- **FR-3.1**: Terminal methods (`all()`, `find()`, `create()`, `update()`, `delete()`, `aggregate()`) and query-building methods (`where()`, `include()`, `orderBy()`, etc.) should be clearly separated so autocompletion in different contexts shows only relevant methods.
- **FR-3.2**: Include refinement aggregation methods (`count()`, `sum()`, `avg()`, `min()`, `max()`, `combine()`) must only appear in autocompletion within include refinement callbacks, not on the top-level collection.
- **FR-3.3**: Mutation methods (`update()`, `updateAll()`, `updateCount()`, `delete()`, `deleteAll()`, `deleteCount()`) should only appear after `where()` has been called (currently enforced at type level via type-state, but verify this actually hides them from autocompletion in practice).
- **FR-3.4**: `cursor()` and `distinctOn()` should only appear after `orderBy()` (same type-state verification).

**Assumption:** The approach is to use TypeScript conditional types on the Collection's type-state generic parameter to conditionally include/exclude method signatures. This may require splitting Collection into a base builder interface and method-specific extension interfaces, or using mapped types to conditionally expose methods. The specific implementation approach should be determined during planning.

### FR-4: Open Question Resolution

Resolve the open questions from the previous spec's Q&A session (documented in `specs/2026-02-16-repository-model-client/prisma-orm-comparison.md`, "Open Questions" section):

- **FR-4.1**: **Generic reusable filters** — Design a pattern for building filters that work on any model with a given field (e.g., any model with an `email` field). Prototype and document the recommended approach.
- **FR-4.2**: **Extension operators (ParadeDB etc.)** — Design how to build a `WhereExpr` node containing a raw SQL operator added by an extension. This connects to FR-6 (filter interop).
- **FR-4.3**: **`omit` as complement to `select`** — Evaluate `select(schema.users.fields.omit('password'))` vs a dedicated `omit()` method. Decide and implement.
- **FR-4.4**: **Conditional method application** — Design an ergonomic, type-safe way to conditionally apply methods like `cursor()`, `where()`, etc. For example: `query.if(cursor, q => q.cursor(cursor))` or a pipeline/pipe pattern.
- **FR-4.5**: **Typed model instances** — Explore what typed model instances could look like beyond plain row objects (connects to FR-9).

### FR-5: API Surface Gaps and Prisma Parity

Identify gaps between the current ORM client API and Prisma ORM's feature set, then prioritize and implement the high-value ones:

- **FR-5.1**: **`count()` shorthand** — `db.users.where(...).count()` as sugar for `.aggregate(a => ({ count: a.count() }))` returning `Promise<number>` directly.
- **FR-5.2**: **`exists()` terminal** — `db.users.where(...).exists()` returning `Promise<boolean>`.
- **FR-5.3**: **Raw query escape hatch** — Ability to drop to raw SQL from a collection context while preserving type context (field-to-column mappings available).
- **FR-5.4**: **Transaction API** — `db.$transaction(async (tx) => { ... })` wrapping multiple operations in a single transaction. The `RuntimeQueryable` interface already has optional `transaction()` support.
- **FR-5.5**: **Exhaustive Prisma ORM feature audit** — Document every Prisma ORM feature with a keep/skip/defer decision and rationale. This includes but is not limited to: `connectOrCreate`, `set` for to-many relations, `increment`/`decrement`/`multiply`/`divide` for numeric updates, `push`/`unset` for arrays, `createMany`, `findFirstOrThrow`/`findUniqueOrThrow`, raw queries (`$queryRaw`/`$executeRaw`), interactive transactions, batch transactions (`$transaction([...])`), `relationCount`, nested reads in mutations, and all other documented Prisma Client methods.

### FR-6: Filter Interop Helpers

- **FR-6.1**: **Kysely filter bridge** — Implement a helper that takes a Kysely `ExpressionBuilder` callback and produces a `WhereExpr` node. This lets users leverage Kysely's expression API for complex filters while staying within the ORM client.
- **FR-6.2**: **Raw SQL filter** — Implement a `rawFilter(sql, ...params)` helper (or `sql.raw` tagged template) that produces a `WhereExpr` wrapping a raw SQL fragment, with type-safe access to the model's column names for interpolation.
- **FR-6.3**: Ensure both helpers compose with `and()`, `or()`, `not()` and work in `where()` callbacks.

### FR-7: Include Strategy Test Coverage

- **FR-7.1**: All three include strategies (lateral, correlated, multi-query) must have integration tests covering: simple include, include with where, include with orderBy + take, nested include (2+ levels), to-one include, to-many include, include with select on parent, include with select on child.
- **FR-7.2**: Include scalar aggregations (`count()`, `sum()`, etc.) must be tested with all applicable strategies.
- **FR-7.3**: `combine()` must be tested (currently only works with multi-query strategy — *must* be extended to other strategies).
- **FR-7.4**: Test strategy auto-selection based on contract capabilities.

### FR-8: Test Suite Quality

- **FR-8.1**: Ensure every public API method has at least one unit test and one SQL compilation test.
- **FR-8.2**: Ensure integration tests cover the happy path for every terminal method (`all()`, `find()`, `create()`, `createAll()`, `createCount()`, `update()`, `updateAll()`, `updateCount()`, `delete()`, `deleteAll()`, `deleteCount()`, `upsert()`, `aggregate()`, `groupBy().aggregate()`).
- **FR-8.3**: Add error-path tests: invalid model names, invalid field names, type-state violations at runtime (if any), empty result handling.
- **FR-8.4**: Review and improve test organization — tests should be grouped by feature area, not by implementation file.
- **FR-8.5**: Verify all test descriptions omit "should" per project convention.
- **FR-8.6**: Ensure type-level tests (`*.test-d.ts`) cover all major type inference scenarios: select narrowing, include type augmentation, type-state transitions, CreateInput derivation, mutation return types.

### FR-9: Custom Repository and Model Exploration

- **FR-9.1**: **Custom repository pattern** — Explore extending `Collection` subclasses beyond domain filter methods. Can a "repository" class own transaction scoping, validation, or business logic? Prototype a pattern and evaluate ergonomics.
- **FR-9.2**: **Typed model instances** — Explore what it would look like if query results were instances of a model class (with methods) rather than plain objects. Consider: immutability, change tracking, lazy relation loading. Document trade-offs and recommend whether to pursue.
- **FR-9.3**: Document the recommended patterns for users who want repository or active-record-like abstractions built on top of the collection API.

## Non-Functional Requirements

- **NFR-1**: All existing tests continue to pass (`pnpm test`).
- **NFR-2**: Type checking passes across the monorepo (`pnpm typecheck`).
- **NFR-3**: Architectural boundaries are maintained (`pnpm lint:deps`).
- **NFR-4**: No regression in query compilation performance (compilation should remain sub-millisecond for typical queries).
- **NFR-5**: Breaking changes in the API are allowed but the demo app and docs must be updated accordingly. Never add any backward compatibility adapters, aliases or stubs.

## Non-goals

- **Pagination primitives** (offset/cursor pagination abstractions with page tokens) — deferred to a future phase.
- **Middleware/plugin system implementation** — This is not a responsibility of the ORM client.
- **Query plan caching** — Performance optimization deferred unless profiling shows compilation as a bottleneck.
- **Full-text search helpers** — Out of scope; can be addressed via the raw filter escape hatch (FR-6.2).
- **Soft delete built-in** — Can be implemented via custom collection methods; no framework-level support in this phase.
- **Connection pooling or driver-level concerns** — Handled by the adapter/driver layer, not the ORM client.

# Acceptance Criteria

## Code Quality
- [ ] All source files in `sql-orm-client/src/` have been reviewed and any issues documented and fixed
- [ ] No dead code or unused types remain in the package
- [ ] `pnpm test`, `pnpm typecheck`, and `pnpm lint:deps` pass cleanly

## Documentation
- [ ] Package README and `docs` directory contain comprehensive usage documentation with examples for every major feature
- [ ] Root README showcases the ORM client as the flagship API with at least 3 prominent code examples
- [ ] All public API exports have JSDoc comments

## Autocompletion
- [ ] IDE autocompletion on a fresh collection shows only query-building methods and read terminals, not mutation-only methods (except `create*`)
- [ ] IDE autocompletion after `.where()` additionally shows mutation terminals
- [ ] Column accessors only provide the methods which make sense in the current context (order direction, filter methods)
- [ ] Include refinement aggregation methods do not appear on top-level collections
- [ ] Terminal methods do not appear in `include` context
- [ ] `cursor()` and `distinctOn()` do not appear without prior `orderBy()`

## Open Questions
- [ ] Generic reusable filter pattern is documented with at least one working example
- [ ] Extension operator approach is documented
- [ ] Decision on `omit` is made and implemented (or explicitly deferred with rationale)
- [ ] Conditional method application pattern is designed and documented with examples
- [ ] Model instances exploration is documented with trade-off analysis

## API Parity
- [ ] `count()` shorthand terminal is implemented
- [ ] `exists()` terminal is implemented
- [ ] Transaction API design is documented (implementation if straightforward)
- [ ] Prisma ORM feature audit is documented with keep/skip/defer decisions

## Filter Interop
- [ ] Kysely expression bridge helper exists and is tested
- [ ] Raw SQL filter helper exists and is tested
- [ ] Both compose with `and()`, `or()`, `not()`

## Include Strategies
- [ ] Each of the three include strategies has integration tests covering: simple, filtered, nested, to-one, to-many, with parent select
- [ ] Include scalar aggregations are tested with applicable strategies
- [ ] `combine()` works with all three include strategies and is tested with each

## Test Suite
- [ ] Every public API method has unit and SQL compilation test coverage
- [ ] Integration tests cover every terminal method
- [ ] Error-path tests exist for invalid inputs and edge cases
- [ ] All test descriptions omit "should"
- [ ] Type-level tests cover select, include, type-state, CreateInput, and mutation return types

## Repository/Model Exploration
- [ ] Custom repository pattern prototype exists with evaluation
- [ ] Model instance exploration document exists with trade-off analysis and recommendation

# Other Considerations

## Security

No new security concerns introduced. The ORM client delegates all SQL execution to the runtime layer, which handles parameterization. The raw SQL filter helper (FR-6.2) must ensure parameters are always parameterized, never interpolated into the SQL string.

## Cost

No infrastructure cost impact. This is a library-level change with no runtime infrastructure dependencies.

## Observability

No changes. Query execution observability is handled by the runtime layer's plugin/hook system.

## Data Protection

No changes. The ORM client does not introduce new data storage or processing concerns.

## Analytics

N/A — this is a library package, not a service.

# References

- Previous spec: `projects/orm-client/specs/phase1-completed-spec/spec.md`
- Previous tasks: `projects/orm-client/specs/phase1-completed-spec/tasks.md`
- Prisma ORM comparison: `projects/orm-client/specs/phase1-completed-spec/prisma-orm-comparison.md`
- Planning docs: `projects/orm-client/specs/phase1-completed-spec/planning/requirements.md`
- Package source: `packages/3-extensions/sql-orm-client/`
- Demo app: `examples/prisma-next-demo/src/orm-client/`
- Linear project: https://linear.app/prisma-company/project/pn-model-query-client-7fbff952f5dc
- ADR 161 (Repository Layer): `docs/architecture docs/adrs/ADR 161 - Repository Layer.md`
- ADR 015 (ORM as Optional Extension): `docs/architecture docs/adrs/ADR 015 - ORM as Optional Extension.md`

# Resolved Questions

1. **Autocompletion approach**: Use conditional types on the type-state generic parameter, with a fallback to interface splitting if it doesn't produce good autocompletion in practice.

2. **Filter interop scope**: Must produce `WhereExpr` AST nodes, not opaque wrappers. `WhereExpr` is the universal filter interface, and the Kysely bridge must remain functional even if we stop using Kysely internally in the ORM client.

3. **Transaction API ownership**: ORM client provides `db.$transaction(...)` that creates a scoped ORM client backed by the transactional runtime scope.

4. **`combine()` strategy expansion**: `combine()` *must* work with all three include strategies (lateral, correlated, multi-query). Multi-query-only is not acceptable. This is a high-priority issue to fix.

5. **Terminology**: Keep "Collection." Repository may become a special case of Collection in the future.

6. **Prisma parity audit scope**: Exhaustive. Document every Prisma ORM feature with a keep/skip/defer decision and rationale.

# Open Questions

_None remaining. All design questions have been resolved._
