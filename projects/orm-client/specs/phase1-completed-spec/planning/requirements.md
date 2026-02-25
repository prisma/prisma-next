# Spec Requirements: Repository Model Client

## Initial Description

Creating a model client for Prisma Next using a simple repository pattern.

The existing codebase already has a working `Collection`, `Repository`, `orm()` factory, include stitching, custom repository subclasses, Kysely-based SQL compilation, and integration tests in the demo app. This spec aims to solidify, complete, and extend the repository/model client API into a comprehensive data access layer.

## Requirements Discussion

### First Round Questions

**Q1:** Scope boundary -- read-only vs. mutations in this spec. Should this spec focus on solidifying the read API (findMany, findFirst, findUnique, count, exists, select, distinct) and then separately tackle basic mutations? Or should mutations and nested mutations also be in scope?

**Answer:** Both reads and mutations are in scope. The full set includes:
- Read API: findMany, findFirst (returns `Promise<Row | null>`), findUnique (type-safe unique criterion)
- Mutations: create, update, delete, upsert (including nested mutations)
- Batch operations: createMany, updateMany, deleteMany (plus returning variants)
- Field selection / projection
- Relational filters (some/every/none)
- Aggregations (count, sum, avg, min, max, groupBy) -- API surface TBD
- Cursor-based pagination (explicit field+value cursors)
- Distinct (both SELECT DISTINCT and DISTINCT ON)
- orderBy with typed accessors, array for multi-column
- Include with cardinality-aware types (1:1 returns Row|null, 1:N returns Row[])

**Q2:** The `findFirst()` return type -- single item vs. array. Should findFirst() return `Promise<Row | null>` or keep returning `AsyncIterableResult`? Should there be a `findUnique()` variant that throws?

**Answer:** findFirst() should return `Promise<Row | null>` (not AsyncIterableResult). findUniqueOrThrow is deferred to the error handling spec (TML-1911).

**Q3:** The `where()` API -- compound filters (AND/OR/NOT). Should the spec define compound logical operators, string operators, list operators, null checks? Should relation-level filters also be in scope?

**Answer:** Filters should be abstract AST nodes that encode filter expressions. Built-in ergonomic filters produce the same AST node type as externally-built ones -- no difference at the type level. The ORM Client must NOT depend on Kysely types in public API. `and()`, `or()`, `not()` are standalone importable functions (fundamental abstraction). Column accessor methods delegate to these. Users can define their own filter-building functions that produce the same AST node type. Two overloads for `where()`: callback (ergonomic) and direct AST node. Relational filters (some/every/none) are in scope.

**Q4:** The `orderBy()` ergonomics -- should it use typed accessor pattern? Single call with array vs. chaining?

**Answer:** Typed accessor pattern confirmed: `.orderBy(u => u.createdAt.desc())`. Array for multi-column ordering. Consider encoding orderBy in type state for distinct and cursor gating.

**Q5:** Field selection / projection -- is `.select()` needed now or out of scope?

**Answer:** Back in scope. Primary API is array of field names (or spread arguments): `.select('name', 'email')`. Callback overload only if renaming/computed fields are supported (deferred for now -- too complex). `select()` and `include()` interact: select narrows scalars, include adds relations.

**Q6:** Custom repository pattern ergonomics -- should the model name be inferred from the generic parameter?

**Answer:** Model name parameter stays as-is (runtime requirement, cannot infer from generics). Current explicit pattern: `new UserRepository({ contract, runtime }, 'User')`.

**Q7:** Transaction support at the repository level -- should a `db.$transaction()` pattern be defined?

**Answer:** Transactions are out of scope, deferred to TML-1912.

**Q8:** Relation cardinality handling (1:1 vs. 1:N) -- should includes return cardinality-aware types?

**Answer:** Yes. Cardinality-aware include types: hasOne/belongsTo returns `Row | null`, hasMany returns `Row[]`.

**Q9:** Error handling strategy -- should we define a repository-specific error taxonomy?

**Answer:** Error handling taxonomy is out of scope, deferred to TML-1911.

**Q10:** Exclusions -- aggregations, raw SQL, cursor pagination, batch operations?

**Answer:** Contrary to the initial assumption, aggregations, cursor-based pagination, distinct, and batch operations are all IN scope. Explicitly out of scope: transactions (TML-1912), error handling taxonomy (TML-1911), raw SQL escape hatch (use different query lane or driver), and adding more comparison operators beyond the basics (conceptually similar, can add later).

### Existing Code to Reference

**Similar Features Identified:**
- Feature: SQL Repositories package - Path: `/Users/aqrln/prisma/prisma-next/packages/2-sql/6-repositories/src/`
  - `collection.ts` -- current Collection class with findMany, findFirst, where, include, orderBy, take, skip, stitchIncludes
  - `column-accessor.ts` -- Proxy-based typed column accessor (eq, neq, gt, lt, gte, lte)
  - `kysely-compiler.ts` -- Kysely-based SQL compilation from repository operations
  - `orm.ts` -- orm() factory, OrmClient, model accessor creation
  - `repository.ts` -- Repository base class for custom repositories
  - `types.ts` -- Type definitions (FilterExpr, OrderByExpr, IncludeSpec, etc.)
- Feature: Demo repositories - Path: `/Users/aqrln/prisma/prisma-next/examples/prisma-next-demo/src/repositories/`
  - `client.ts` -- OrmClient setup with contract and runtime
  - `get-admin-users.ts` -- Custom repository with where filter
  - `get-user-posts.ts` -- Include pattern with user posts
  - `get-users.ts` -- Basic findMany usage
- Feature: PR #152 -- Kysely-to-PN AST transformation (parallel work, handles AST integration)
- Feature: RuntimeExecutor plugin lifecycle hooks (beforeCompile, afterExecute) -- repository operations should participate in these hooks
- Note: `sql-orm-lane` package (`@prisma-next/sql-orm-lane`) is being superseded by this work

**Key technical direction:**
- Continue using Kysely internally as the SQL query builder
- No public types depend on Kysely -- must be replaceable
- Repository operations participate in RuntimeExecutor plugin lifecycle hooks

### Follow-up Questions

**Follow-up 1:** Lateral joins for includes -- should include() always produce a single Plan using lateral join lowering, eliminating multi-query stitching? Should multi-query orchestration be reserved for mutations only? Does the lateral join approach replace `slicePerParent` entirely?

**Answer:** Capability-based strategy derived from the contract:
- If target supports lateral joins + JSON aggregation, use those (single query)
- If target supports correlated subqueries + JSON aggregation, use those
- Fallback to multi-query stitching only when neither is available
- Per-parent limit/offset moves to SQL when using lateral/correlated approaches
- Multi-query stitching remains only as a fallback path
- Currently only Postgres is supported, but the design should accommodate capability-based selection
- Test the fallback path by disabling capabilities in the contract

**Follow-up 2a:** findUnique -- should it accept a discriminated union of unique constraint objects (type-level enforcement) or rely on runtime validation?

**Answer:** Type-safe unique criterion guarantee at the type level. findUnique accepts a discriminated union derived from the contract's PK + unique constraints. For example: `{ id: string } | { email: string }`.

**Follow-up 2b:** findUniqueOrThrow -- separate method or defer?

**Answer:** Deferred to error handling spec (TML-1911).

**Follow-up 3a:** Filter AST integration -- should where() accept WhereExpr directly, callback returning WhereExpr, or both?

**Answer:** Both overloads: callback pattern (ergonomic) and direct AST node pattern. The ORM Client must NOT depend on Kysely types in the public API.

**Follow-up 3b:** Should and(), or(), not() be standalone functions, methods on the accessor, or both?

**Answer:** Standalone importable functions (fundamental abstraction). Column accessor methods delegate to these functions. Users can define their own filter-building functions producing the same AST node type.

**Follow-up 4a:** Relational filters naming -- `has` vs `some`/`every`/`none` vs aliases?

**Answer:** Use `some`/`every`/`none` naming (no aliases).

**Follow-up 4b:** Should the same accessor object serve both scalar comparisons and relation filters?

**Answer:** Yes. The column accessor proxy is extended to expose relation accessors, creating a unified `ModelAccessor` type that includes both scalar field comparisons and relation filter methods.

**Follow-up 5a:** Mutation methods -- create, update, delete, upsert with required where() safety guardrails?

**Answer:** Yes to all four methods. Safety guardrail: update/delete REQUIRE at least one `where()` filter to prevent accidental bulk operations. To update/delete an entire table, users must explicitly write `where(all())`. Batch operations (createMany, updateMany, deleteMany) are also in scope, with returning variants.

**Follow-up 5b:** Nested mutation style -- fluent chain, nested payload, or both?

**Answer:** Resolved in Round 3 -- both styles are in scope. See Round 3, question 1.

**Follow-up 5c:** Batch operations -- separate methods vs overloaded create/update/delete?

**Answer:** In scope. Explore mirroring read patterns (e.g. updateMany/updateUnique for returning variants). Need to distinguish between:
- `insert/update ... RETURNING` (returns the record(s))
- Pure mutation returning affected row count
- Naming and whether these are separate methods: resolved in Round 3. See Round 3, question 2.

**Follow-up 6a:** Select / projection style -- callback with typed accessor, or object literal (`{ name: true }`), or field name array?

**Answer:** Primary API is array of field names (or spread arguments): `.select('name', 'email')`. Callback overload only if renaming/computed fields are supported, which is deferred for now as too complex.

**Follow-up 6b:** Interaction between select() and include()?

**Answer:** Clarified in Round 3. See Round 3, question 4 for the full architectural decision.

**Follow-up 7a:** Aggregations API surface?

**Answer:** In scope but API surface (collection methods vs separate API) is still TBD -- general direction established in Round 3. See Round 3, question 3.

**Follow-up 7b:** Cursor-based pagination -- explicit field+value or opaque token?

**Answer:** Explicit field+value: `cursor({ id: 42 })`.

**Follow-up 7c:** Distinct -- SELECT DISTINCT vs DISTINCT ON, and should distinct() require orderBy()?

**Answer:** Support both SELECT DISTINCT and Postgres DISTINCT ON. Possibly separate APIs. DISTINCT ON should be gated by type-state requiring orderBy.

**Follow-up 8a:** Type-state tracking -- how far should it go?

**Answer:** As rich as needed for type safety goals. Track enough to gate: findUnique availability, cursor requiring orderBy, DISTINCT ON requiring orderBy. Complex internal/intermediate types are acceptable as long as user-facing types remain simple. Extensions on repositories should not require complex generics.

**Follow-up 8b:** Type-state adds generic parameter complexity -- is ergonomic cost acceptable?

**Answer:** Yes, the cost is acceptable. User-facing types must be simple, but complex internal/intermediate types are fine.

## Round 3 -- Final Clarifications

**Q1:** Nested mutation style -- fluent chain (`db.posts.findUnique({id}).comments.create({...})`) vs nested payload (`db.posts.create({ title: '...', comments: { create: [...] } })`) vs both?

**Answer:** Both styles are in scope. Fluent chain AND nested payload serve different use cases:
- Fluent chain: `db.posts.findUnique({id}).comments.create({...})`
- Nested payload: `db.posts.create({ title: '...', comments: { create: [...] } })`
Both are included because they address different ergonomic needs.

**Q2:** Mutation returning variants -- naming and API shape for RETURNING (record data) vs affected row count. Separate methods? How to distinguish?

**Answer:** Leaning towards method-based approach to avoid cross-product explosion of methods. Key constraints:
- MUST avoid SQL-specific terms like "rows" and even "returning" -- the ORM client speaks in application developer terms, not database terms
- Consider how `select()`/`include()` interact with mutations (e.g. select which fields to get back from a create)
- Document multiple options to facilitate team discussion; exact naming is not yet finalized

**Q3:** Aggregations -- API surface and design direction.

**Answer:** General direction established, detailed API marked as "design TBD":
- 3A: `db.users.where(...).count()` looks promising, especially for count. Open questions remain: does it return a single scalar? How does it interact with select/include?
- 3B: Prisma-style aggregate objects deviate from the fluent API built so far. Interesting possibility: aggregations within includes (e.g. `.include('posts', p => p.aggregate(...))`)
- 3C: `groupBy` is definitely a separate builder with different types and type state
- Overall: aggregations need more design exploration. The spec should include general direction and constraints but mark the detailed API as "design TBD"

**Q4:** Select/include interaction -- architectural clarification.

**Answer:** Key architectural decision for the type system:
- `select()` refers to the CURRENT model only (scalar fields)
- `include()` adds relations
- To select fields within a relationship, use include with nested customization: `.include('posts', p => p.select(...))`
- Select and include are COMPLEMENTARY, not mutually exclusive
- This is a fundamental constraint on the type system design

**Q5:** NEW -- Shorthand object filter syntax for `where()`.

**Answer:** A third `where()` overload is desired alongside callback and direct AST node:
- `.where({ role: 'admin' })` as shorthand for `.where(u => u.role.eq('admin'))`
- Object keys are field names, values are equality-checked
- This addresses the most common filter case (equality) with minimal ceremony
- Three `where()` overloads total: callback, direct AST node, shorthand object

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- no visual files were found in `/Users/aqrln/prisma/prisma-next/specs/2026-02-16-repository-model-client/planning/visuals/`.

## Requirements Summary

### Functional Requirements

**Read Operations:**
- `findMany()` -- returns array of rows (current behavior, keep as-is)
- `findFirst()` -- returns `Promise<Row | null>` (changed from AsyncIterableResult)
- `findUnique(criterion)` -- accepts discriminated union from contract's PK + unique constraints, returns `Promise<Row | null>`
- `where()` -- three overloads: callback with typed accessor, direct AST node, and shorthand object (`{ field: value }` for equality)
- `include()` -- cardinality-aware types (hasOne/belongsTo returns `Row | null`, hasMany returns `Row[]`)
- `select('field1', 'field2')` -- field projection via spread arguments or array of field names; refers to current model's scalar fields only
- `include('relation', r => r.select(...))` -- nested customization for relation field selection
- Select and include are complementary, not mutually exclusive
- `orderBy(u => u.field.asc())` -- typed accessor pattern, array for multi-column
- `take()` / `skip()` -- offset-based pagination (existing)
- `cursor({ field: value })` -- explicit field+value cursor-based pagination
- `distinct()` -- both SELECT DISTINCT and DISTINCT ON (Postgres), possibly separate APIs
- `distinct()` with columns gated by type-state requiring orderBy for DISTINCT ON

**Filter System:**
- Filters are abstract AST nodes (WhereExpr from PN AST)
- `and()`, `or()`, `not()` as standalone importable functions
- Column accessor methods produce WhereExpr nodes (eq, neq, gt, lt, gte, lte, like, ilike, in, notIn, isNull, isNotNull)
- Relational filters via `some`/`every`/`none` on relation accessors
- Unified `ModelAccessor` type combining scalar field accessors and relation accessors
- Users can define custom filter-building functions producing the same AST node type
- Shorthand object filter: `.where({ role: 'admin' })` as equality shorthand

**Mutation Operations:**
- `create(data)` -- INSERT, input types derived from contract (required vs optional fields)
- `update(data)` -- UPDATE matching where() filters
- `delete()` -- DELETE matching where() filters
- `upsert({ create, update })` -- INSERT ON CONFLICT DO UPDATE
- Safety guardrail: update/delete REQUIRE at least one where() filter; use `where(all())` for whole-table operations
- `createMany`, `updateMany`, `deleteMany` -- batch operations
- Returning variants: method-based approach preferred; must avoid SQL-specific terms ("rows", "returning"); exact naming TBD for team discussion
- `select()`/`include()` interact with mutations (e.g. select which fields to get back from a create)
- Nested mutations: BOTH fluent chain and nested payload styles in scope
  - Fluent chain: `db.posts.findUnique({id}).comments.create({...})`
  - Nested payload: `db.posts.create({ title: '...', comments: { create: [...] } })`

**Aggregations:**
- count, sum, avg, min, max, groupBy
- General direction: `db.users.where(...).count()` for simple aggregations on the fluent chain
- `groupBy` is a separate builder with different types and type state
- Aggregations within includes is an interesting possibility to explore (e.g. `.include('posts', p => p.aggregate(...))`)
- Detailed API design: TBD (needs more design exploration)

**Type System:**
- Type-state tracking for method availability gating:
  - findUnique availability based on filter matching unique constraint
  - cursor() requires orderBy
  - DISTINCT ON requires orderBy
- Complex intermediate types acceptable; user-facing types must be simple
- Cardinality-aware include types from contract metadata
- Select narrows scalar types on current model; include adds relation types on top
- Select and include are complementary, not mutually exclusive
- Nested select within include: `.include('posts', p => p.select(...))`

### Reusability Opportunities

- Existing `Collection` class in `/Users/aqrln/prisma/prisma-next/packages/2-sql/6-repositories/src/collection.ts` -- foundation for read operations
- Existing `column-accessor.ts` Proxy pattern -- extend for relation accessors and additional operators
- Existing `kysely-compiler.ts` -- continue using Kysely internally for SQL compilation
- Existing `orm.ts` factory and OrmClient pattern -- extend with mutation methods
- Existing `repository.ts` base class -- extend for custom repository subclasses
- PR #152 AST types (WhereExpr, BinaryExpr, ExistsExpr, etc.) -- replace internal FilterExpr
- PR #152 Kysely-to-PN AST transformation -- parallel work to integrate
- RuntimeExecutor plugin lifecycle hooks -- repository operations participate in these
- Contract capability declarations (lateral joins, JSON aggregation) -- drive query strategy selection
- IncludeAst with lateral join lowering already exists in the Postgres adapter

### Scope Boundaries

**In Scope:**
- Read API: findMany, findFirst, findUnique
- Mutations: create, update, delete, upsert
- Batch operations: createMany, updateMany, deleteMany (with returning variants)
- Nested mutations: both fluent chain and nested payload styles
- Field selection / projection via `.select('field1', 'field2')`
- Select/include complementary interaction with nested customization
- Filter system: abstract AST nodes, compound filters (and/or/not), relational filters (some/every/none), shorthand object equality filter
- Include with cardinality-aware types
- orderBy with typed accessors and multi-column support
- Cursor-based pagination (explicit field+value)
- Distinct (SELECT DISTINCT and DISTINCT ON)
- Aggregations (count, sum, avg, min, max, groupBy) -- general direction established, detailed API design TBD
- Type-state tracking for method availability gating
- Capability-based include strategy (lateral joins vs correlated subqueries vs multi-query fallback)
- Safety guardrails for mutations (required where() for update/delete)
- Custom repository constructor pattern (model name parameter stays)

**Out of Scope:**
- Transactions (deferred to TML-1912)
- Error handling taxonomy and findUniqueOrThrow (deferred to TML-1911)
- Raw SQL escape hatch (use different query lane or driver)
- Additional comparison operators beyond the basics (can add later, conceptually similar)
- Computed fields / renaming in select (deferred -- too complex for initial spec)
- Opaque cursor tokens (using explicit field+value instead)

### Technical Considerations

- **Internal SQL building**: Continue using Kysely internally; no public types depend on Kysely; must remain replaceable
- **AST integration**: Replace internal FilterExpr with PN AST WhereExpr from PR #152
- **Include strategy**: Capability-based from contract -- lateral joins + JSON aggregation preferred, correlated subqueries as second option, multi-query stitching as fallback only
- **Plugin lifecycle**: Repository operations participate in RuntimeExecutor plugin lifecycle hooks (beforeCompile, afterExecute)
- **Target support**: Currently only Postgres, but design for capability-based selection to support future targets
- **Testing**: Test lateral join fallback by disabling capabilities in contract
- **Parallel work**: PR #152 handles Kysely-to-PN AST transformation; this spec should be designed to integrate with that work
- **ORM language**: Mutation APIs must avoid SQL-specific terminology ("rows", "returning") -- speak in application developer terms

### Open Design Questions (Require Further Decision)

**Resolved:**
1. ~~Nested mutation style~~ -- **Resolved**: Both fluent chain and nested payload are in scope (Round 3, Q1)
2. ~~Mutation returning variants~~ -- **Resolved**: Method-based approach preferred; must avoid SQL terms; document multiple options for team discussion (Round 3, Q2)

**Still Open:**
1. **Aggregation detailed API design**: General direction established (fluent chain for simple aggregations, separate builder for groupBy, possible aggregation-in-includes), but the specific method signatures and return types need more design exploration
2. **Exact naming for mutation method variants**: Method-based approach confirmed but specific method names (for record-returning vs count-returning mutations) need team discussion; multiple options should be documented in the spec
3. **Shorthand filter syntax details**: The `.where({ field: value })` equality shorthand overload is desired, but detailed behavior for edge cases (multiple fields = AND? nested objects? null values?) needs to be specified
