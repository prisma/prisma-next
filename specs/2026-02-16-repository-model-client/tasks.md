# Tasks: ORM Client

## Overview

This task breakdown covers the full implementation of the ORM Client spec for `@prisma-next/sql-orm-client` (`/Users/aqrln/prisma/prisma-next/packages/2-sql/6-orm-client/`). The work builds incrementally on the existing prototype, which already has: `Collection` with `where()`/`include()`/`orderBy()`/`take()`/`skip()`/`all()`/`find()`, `createColumnAccessor()`, Kysely-based compilation, `orm()` factory with model aliasing, multi-query include stitching, and unit tests.

The tasks are ordered so that foundational internal refactors come first, followed by incremental feature additions that build on each other. Testing is embedded alongside implementation, not deferred to a separate phase.

Total estimated tasks: 15 task groups, ~65 sub-tasks.

---

## Group 1: AST Integration -- Replace FilterExpr with WhereExpr

The most fundamental internal change. Everything downstream (new operators, relational filters, shorthand filters, logical combinators) depends on the filter representation being PN AST `WhereExpr` nodes instead of the prototype's internal `FilterExpr`.

- [x] **1.1 Extend WhereExpr to support AndExpr, OrExpr, and ListLiteralExpr**
  - The spec (section 3.4) requires `AndExpr`, `OrExpr`, `ListLiteralExpr` in the `WhereExpr` union, but the current AST types at `/Users/aqrln/prisma/prisma-next/packages/2-sql/4-lanes/relational-core/src/ast/types.ts` only have `BinaryExpr | ExistsExpr | NullCheckExpr`
  - Add `AndExpr { kind: 'and'; exprs: ReadonlyArray<WhereExpr> }` and `OrExpr { kind: 'or'; exprs: ReadonlyArray<WhereExpr> }` to the `WhereExpr` union
  - Add `ListLiteralExpr { kind: 'listLiteral'; values: ReadonlyArray<ParamRef | LiteralExpr> }` to support `in`/`notIn` operations
  - Extend `BinaryOp` to include `'like' | 'ilike' | 'in' | 'notIn'`
  - Update `BinaryExpr.right` to also accept `ListLiteralExpr`
  - Ensure existing consumers of `WhereExpr` in lanes/adapters still compile
  - Files to modify: `/Users/aqrln/prisma/prisma-next/packages/2-sql/4-lanes/relational-core/src/ast/types.ts`
  - Acceptance: `pnpm typecheck` passes across the monorepo; existing lane/adapter tests still pass

- [x] **1.2 Replace FilterExpr with WhereExpr in CollectionState**
  - Change `CollectionState.filters` from `readonly FilterExpr[]` to `readonly WhereExpr[]`
  - Remove the `FilterExpr`, `ComparisonOp` types from `/Users/aqrln/prisma/prisma-next/packages/2-sql/6-orm-client/src/types.ts`
  - Update the `ComparisonMethods` type to return `WhereExpr` instead of `FilterExpr`
  - Update exports in `/Users/aqrln/prisma/prisma-next/packages/2-sql/6-orm-client/src/exports/index.ts`
  - Files to modify: `src/types.ts`, `src/exports/index.ts`

- [x] **1.3 Rewrite createColumnAccessor to produce WhereExpr nodes**
  - The current accessor at `src/column-accessor.ts` produces `FilterExpr` objects `{ column, op, value }`
  - Rewrite to produce `BinaryExpr` nodes with proper `ColumnRef` left-hand side and `ParamRef`/`LiteralExpr` right-hand side
  - Resolve field names to storage column names using `contract.mappings.fieldToColumn`, and populate the `ColumnRef.table` from `contract.mappings.modelToTable`
  - Keep the Proxy-based approach
  - Files to modify: `src/column-accessor.ts`

- [x] **1.4 Rewrite kysely-compiler to consume WhereExpr**
  - Replace the `comparisonOpToSql` mapping and `qb.where(f.column, op, f.value)` pattern in `src/kysely-compiler.ts` with a recursive `WhereExpr`-to-Kysely translation
  - Handle `BinaryExpr`, `NullCheckExpr`, `AndExpr`, `OrExpr`, `ExistsExpr` node kinds
  - Use Kysely's `ExpressionBuilder` and `eb.and()`, `eb.or()`, `eb.exists()` for compound expressions
  - Files to modify: `src/kysely-compiler.ts`

- [x] **1.5 Update existing tests to match new WhereExpr-based filter shapes**
  - Tests in `test/collection.test.ts` and `test/column-accessor.test.ts` assert on `FilterExpr` shapes (`{ column, op, value }`)
  - Update assertions to match `WhereExpr` node shapes (`{ kind: 'bin', op, left: { kind: 'col', ... }, right: { kind: 'param', ... } }`)
  - Ensure all existing tests pass with the new internal representation
  - Files to modify: `test/collection.test.ts`, `test/column-accessor.test.ts`
  - Acceptance: `pnpm --filter @prisma-next/sql-orm-client test` passes; all existing behavior preserved

**Acceptance Criteria for Group 1:**
- `FilterExpr` type is completely removed from the codebase
- `CollectionState.filters` holds `WhereExpr[]`
- Column accessor produces proper PN AST nodes
- Kysely compiler translates WhereExpr to SQL correctly
- All existing unit and integration tests pass

---

## Group 2: Standalone Logical Combinators and Expanded ModelAccessor

Depends on: Group 1 (WhereExpr integration)

- [x] **2.1 Implement `and()`, `or()`, `not()`, `all()` standalone functions**
  - Create a new file `src/filters.ts` exporting these four functions
  - `and(...exprs: WhereExpr[]): AndExpr` -- produces `{ kind: 'and', exprs }`
  - `or(...exprs: WhereExpr[]): OrExpr` -- produces `{ kind: 'or', exprs }`
  - `not(expr: WhereExpr): WhereExpr` -- wraps/negates the expression (for `BinaryExpr` with `eq`, produce `neq`; for `AndExpr`, produce `OrExpr` with negated children via De Morgan; or produce a `NotExpr` wrapper if one is added to the AST; simplest approach: produce `{ kind: 'not', expr }` if the AST supports it, otherwise use semantic negation)
  - `all(): WhereExpr` -- sentinel for "match everything"; produces a tautology node (e.g. `{ kind: 'literal', value: true }` or a dedicated `TrueExpr`)
  - Export from `src/exports/index.ts`
  - Write 3-5 unit tests in `test/filters.test.ts` covering composition: `and(a, b)`, `or(a, b)`, `not(a)`, nested `and(a, or(b, c))`

- [x] **2.2 Expand ColumnAccessor into full ModelAccessor with additional operators**
  - Rename `src/column-accessor.ts` to `src/model-accessor.ts` (or refactor in place)
  - Add string operators: `like(pattern: string)`, `ilike(pattern: string)` -- only available when field type extends string
  - Add list operators: `in(values: T[])`, `notIn(values: T[])` -- produce `BinaryExpr` with `ListLiteralExpr` right-hand side
  - Add null checks: `isNull()`, `isNotNull()` -- produce `NullCheckExpr`
  - Add ordering methods: `asc()`, `desc()` -- return `OrderByDirective` (or similar), replacing the current raw `{ column, direction }` pattern
  - Update the `ModelAccessor` type in `src/types.ts` to reflect the full `ScalarFieldAccessor<T>` interface from spec section 5.3
  - Files to modify: `src/column-accessor.ts` (or new `src/model-accessor.ts`), `src/types.ts`
  - Write 4-6 tests in `test/model-accessor.test.ts` covering: `like`, `in`, `isNull`, `asc/desc`, plus basic eq/neq still work

- [x] **2.3 Add relation accessors to ModelAccessor (some/every/none)**
  - Extend the Proxy in the model accessor to detect relation names from the contract
  - When a relation name is accessed, return a `RelationFilterAccessor` with `some(predicate?)`, `every(predicate)`, `none(predicate?)` methods
  - `some(pred)` produces `ExistsExpr { kind: 'exists', not: false, subquery: ... }`
  - `every(pred)` produces `ExistsExpr { kind: 'exists', not: true, subquery with NOT pred }`
  - `none(pred?)` produces `ExistsExpr { kind: 'exists', not: true, subquery: ... }`
  - The subquery `SelectAst` must reference the related table, join condition, and the predicate
  - Predicate accepts both callback and shorthand object overloads (reuse the same overload pattern as `where()`)
  - Write 3-5 tests covering: `u.posts.some()`, `u.posts.some(p => p.published.eq(true))`, `u.posts.none()`, `u.posts.every(p => ...)`, nested `u.posts.some(p => p.comments.some(c => ...))`
  - Files to modify: `src/model-accessor.ts` (or `src/column-accessor.ts`), `src/types.ts`

- [x] **2.4 Update orderBy to use typed accessor with asc/desc methods**
  - The current `orderBy()` callback returns `{ column, direction }` manually
  - Change to use the ModelAccessor's `.asc()` / `.desc()` methods
  - Update `Collection.orderBy()` signature and implementation
  - Support array overload: `orderBy([u => u.lastName.asc(), u => u.firstName.asc()])`
  - Chained `orderBy()` appends to the order list (already does this)
  - Update `OrderExpr` type or introduce `OrderByDirective` type
  - Update demo app files that use the old `orderBy(() => ({ column, direction }))` pattern
  - Files to modify: `src/collection.ts`, `src/types.ts`, demo app files
  - Write 2-3 tests: single orderBy with `.desc()`, array multi-column orderBy, chained orderBy

**Acceptance Criteria for Group 2:**
- `and()`, `or()`, `not()`, `all()` exported and usable in `where()` callbacks
- ModelAccessor has all operators from spec section 5.3 (eq, neq, gt, lt, gte, lte, like, ilike, in, notIn, isNull, isNotNull, asc, desc)
- Relation accessors (some/every/none) work and compile to EXISTS subqueries
- orderBy uses typed accessor pattern
- All tests pass

---

## Group 3: Shorthand Object Filter and where()/find() Overloads

Depends on: Group 2 (expanded ModelAccessor, logical combinators)

- [x] **3.1 Implement shorthand object filter overload for where()**
  - Add a second overload to `Collection.where()` accepting `Partial<Record<ScalarFieldName, FieldValue>>`
  - Desugar `{ field: value }` into `BinaryExpr` with `eq` operator
  - Multiple fields produce `AndExpr`
  - `null` values produce `NullCheckExpr { isNull: true }`
  - `undefined` values are silently ignored (supports conditional filters)
  - `{}` is identity (no filter added)
  - Arrays are treated as equality against a scalar list value (NOT `in`)
  - Create a helper function `shorthandToWhereExpr(contract, modelName, filters)` in `src/filters.ts`
  - Files to modify: `src/collection.ts`, `src/filters.ts`, `src/types.ts`
  - Write 4-6 tests: basic `where({ role: 'admin' })`, multi-field `where({ role: 'admin', active: true })`, null handling, undefined handling, empty object

- [x] **3.2 Add filter overloads to find()**
  - `find()` currently accepts an optional callback filter
  - Add a second overload accepting shorthand object (same as `where()`)
  - `find({ email: 'alice@example.com' })` -- shorthand equality
  - `find(u => u.email.eq('alice@example.com'))` -- callback
  - `find()` -- no additional filter
  - Provided filter is ANDed with existing `where()` filters
  - Files to modify: `src/collection.ts`
  - Write 2-3 tests: `find({ id: 42 })`, `find(u => u.email.eq('alice'))`, `find()` after `where()`

**Acceptance Criteria for Group 3:**
- `where()` accepts both callback and shorthand object
- `find()` accepts both callback and shorthand object
- Shorthand filters correctly desugar to WhereExpr
- Edge cases (null, undefined, empty object) handled per spec

---

## Group 4: select() and Type-State Tracking

Depends on: Group 2 (ModelAccessor)

- [x] **4.1 Add CollectionTypeState generic parameter to Collection**
  - Introduce `CollectionTypeState` interface: `{ hasOrderBy: boolean; hasWhere: boolean; hasUniqueFilter: boolean }`
  - Add a fourth generic parameter `State extends CollectionTypeState` to `Collection` class with default `{ hasOrderBy: false; hasWhere: false; hasUniqueFilter: false }`
  - Update `where()` to flip `hasWhere: true` in the returned type
  - Update `orderBy()` to flip `hasOrderBy: true` in the returned type
  - Ensure custom collection subclasses do NOT need to specify type-state generics manually -- they should be inferred through method chaining
  - Update `#clone` and `#cloneWithRow` helpers to propagate type state
  - Files to modify: `src/collection.ts`, `src/types.ts`
  - Acceptance: Existing tests compile without changes; `pnpm typecheck` passes

- [x] **4.2 Implement select() with type narrowing**
  - Add `select(...fields: FieldName[])` method to Collection
  - Returns a new Collection with `Row` narrowed to `Pick<DefaultModelRow, Fields> & IncludedRelations`
  - Last call wins (replaces previous selection)
  - Add `selectedFields` to `CollectionState`
  - Update Kysely compiler to emit specific column names instead of `selectAll()` when `selectedFields` is set
  - Files to modify: `src/collection.ts`, `src/types.ts`, `src/kysely-compiler.ts`
  - Write 3-4 tests: `select('name', 'email')` narrows result; `select()` then `include()` preserves relations; `select()` replaces previous selection; select compiles to specific columns in SQL

- [x] **4.3 Write type-level tests for select() and type-state**
  - Add type assertions in `test/generated-contract-types.test-d.ts` (or a new `.test-d.ts` file)
  - Test that `select('name', 'email')` result type is `{ name: string; email: string }`
  - Test that `select('name').include('posts')` result type includes both `name` and `posts`
  - Test that `where()` produces `hasWhere: true` in the type state (for later gating)
  - Files to modify: `test/generated-contract-types.test-d.ts` or new `test/type-state.test-d.ts`

**Acceptance Criteria for Group 4:**
- `select()` produces correct narrowed types
- `select()` and `include()` are complementary
- Type-state tracks hasOrderBy and hasWhere
- Custom collection subclasses do not need explicit type-state generics

---

## Group 5: Cursor Pagination, Distinct, and Type-State Gating

Depends on: Group 4 (type-state tracking)

- [x] **5.1 Implement cursor() with type-state gating**
  - Add `cursor(cursor: Record<string, unknown>)` method to Collection
  - Gate at type level: only available when `State['hasOrderBy']` is `true`
  - For single-column orderBy: compile to `WHERE field > value` (or `< value` for desc)
  - For compound cursors: generate tuple comparison
  - Add `cursor` field to `CollectionState`
  - Update Kysely compiler to handle cursor state
  - Files to modify: `src/collection.ts`, `src/types.ts`, `src/kysely-compiler.ts`
  - Write 3 tests: basic cursor with orderBy, compound cursor, type error without orderBy (type test)

- [x] **5.2 Implement distinct() and distinctOn()**
  - `distinct(...fields)` -- compiles to `SELECT DISTINCT`
  - `distinctOn(...fields)` -- compiles to `DISTINCT ON` (Postgres); gated by `hasOrderBy: true` at type level
  - Add `distinct` and `distinctOn` fields to `CollectionState`
  - Update Kysely compiler
  - Files to modify: `src/collection.ts`, `src/types.ts`, `src/kysely-compiler.ts`
  - Write 2-3 tests: `distinct('role')`, `distinctOn('email')` with orderBy, type error for distinctOn without orderBy

**Acceptance Criteria for Group 5:**
- `cursor()` compiles correctly and is type-gated behind `orderBy()`
- `distinct()` and `distinctOn()` compile correctly
- `distinctOn()` is type-gated behind `orderBy()`
- Type tests verify compile-time errors for missing prerequisites

---

## Group 6: Include Cardinality and Collection Registry Propagation

Depends on: Group 1 (WhereExpr integration)

- [x] **6.1 Add cardinality-aware include result types**
  - The current `include()` always types the result as `IncludedRow[]`
  - Read relation cardinality from the contract (`1:1`, `N:1`, `1:N`, `M:N`)
  - For `1:1` and `N:1`: type as `Row | null`
  - For `1:N` and `M:N`: type as `Row[]`
  - Update the `include()` return type generic computation
  - At runtime, the multi-query stitcher must assign single objects (or null) for to-one relations instead of arrays
  - Update `IncludeExpr` to carry cardinality information
  - Files to modify: `src/collection.ts`, `src/types.ts`
  - Write 3-4 tests: to-many include returns array, to-one include returns single object or null, to-one with no match returns null

- [x] **6.2 Extend test contract with to-one relations**
  - The current test contract (`test/helpers.ts`) only has `1:N` relations (User->Posts, Post->Comments)
  - Add `author` relation from Post to User (`N:1`) and `profile` from User to Profile (`1:1`)
  - Add a `Profile` model to the test contract
  - This supports testing cardinality-aware include types
  - Files to modify: `test/helpers.ts`

- [x] **6.3 Propagate collection registry through include refinements**
  - The `include()` refinement callback should receive an instance of the **registered collection class** for the related model
  - Already partially implemented: `#createCollection` checks `this.registry`
  - Verify that custom collection methods (e.g. `PostCollection.published()`) are available inside include refinement callbacks
  - Ensure the refinement collection is a restricted surface (no `all()`, `find()`, mutation terminals) -- this may be done via a type narrowing or a separate `IncludeCollection` type
  - Write 2-3 tests: custom method available in include refinement, registry propagation through nested includes
  - Files to modify: `src/collection.ts`, `src/types.ts` (if restricted surface type is needed)

**Acceptance Criteria for Group 6:**
- `include('author')` on Post returns `UserRow | null` (to-one)
- `include('posts')` on User returns `PostRow[]` (to-many)
- Custom collection methods work inside include refinement callbacks
- Include refinement collection does not expose terminal methods (type-level restriction)

---

## Group 7: Capability-Based Include Strategy

Depends on: Group 6 (include cardinality)

- [x] **7.1 Implement include strategy selection from contract capabilities**
  - Read `contract.capabilities` to determine available strategies
  - Define capability keys: `lateral` (lateral joins), `jsonAgg` (JSON aggregation)
  - Implement strategy selection logic:
    - Both `lateral` + `jsonAgg` present: Strategy 1 (lateral joins)
    - Only `jsonAgg` present: Strategy 2 (correlated subqueries)
    - Neither: Strategy 3 (multi-query stitching, current behavior)
  - Create `src/include-strategy.ts` with strategy selection function
  - Files to create: `src/include-strategy.ts`
  - Files to modify: `src/collection.ts`

- [ ] **7.2 Implement lateral join include strategy**
  - When lateral joins are available, compile includes into a single Kysely query using `LATERAL` subqueries with `json_agg`
  - Produce SQL matching the pattern in spec section 6.3 Strategy 1
  - Handle per-parent limit/offset in the lateral subquery
  - Files to modify: `src/kysely-compiler.ts`, `src/collection.ts`
  - Write 2-3 tests with lateral capability enabled: single include, include with take/skip, nested include

- [ ] **7.3 Implement correlated subquery include strategy**
  - Fallback when `jsonAgg` is available but `lateral` is not
  - Compile includes into correlated subqueries referencing the outer table
  - Files to modify: `src/kysely-compiler.ts`, `src/collection.ts`
  - Write 1-2 tests with only jsonAgg capability

- [x] **7.4 Refactor multi-query stitching as explicit Strategy 3**
  - The current `stitchIncludes` in `src/collection.ts` IS the multi-query strategy
  - Refactor it to fit the strategy pattern alongside lateral and correlated strategies
  - This should be a cleanup/reorganization, not a rewrite
  - Files to modify: `src/collection.ts`

**Acceptance Criteria for Group 7:**
- Include strategy is selected based on contract capabilities
- Lateral join strategy produces single-query SQL
- Correlated subquery strategy produces single-query SQL
- Multi-query stitching still works as fallback
- Tests can toggle capabilities to test each strategy path

---

## Group 8: Create Mutations

Depends on: Group 4 (type-state, select), Group 1 (WhereExpr)

- [x] **8.1 Define CreateInput type derived from contract**
  - `CreateInput<TContract, ModelName>` distinguishes required from optional fields
  - Required: non-nullable fields without defaults
  - Optional: nullable fields, fields with defaults, auto-generated fields (autoincrement, etc.)
  - Derive from contract metadata: `storage.tables[tableName].columns[col].nullable`, default presence, primary key auto-generation
  - This is a pure types task
  - Files to modify: `src/types.ts`
  - Write type-level tests in `test/` verifying correct required/optional field derivation

- [x] **8.2 Implement create(), createAll(), createCount()**
  - `create(data: CreateInput)` -- `INSERT ... RETURNING *`, returns `Promise<Row>`
  - `createAll(data: CreateInput[])` -- `INSERT ... RETURNING *`, returns `AsyncIterableResult<Row>`
  - `createCount(data: CreateInput[])` -- `INSERT` without RETURNING, returns `Promise<number>`
  - `create`/`createAll` require `returning` capability in contract; `createCount` works universally
  - Add mutation compilation to Kysely compiler: `insertInto(table).values(data).returningAll()`
  - Map field names to column names using contract mappings
  - `select()` and `include()` apply to row-returning variants
  - Files to modify: `src/collection.ts`, `src/kysely-compiler.ts`, `src/types.ts`
  - Write 4-6 tests: basic create, createAll with multiple records, createCount, create with select projection, create with include

**Acceptance Criteria for Group 8:**
- `create()` inserts a record and returns it with proper field mapping
- `createAll()` inserts multiple records and returns them
- `createCount()` returns affected row count
- Field-to-column mapping works correctly for inserts
- `select()`/`include()` shape the returned row type

---

## Group 9: Update and Delete Mutations

Depends on: Group 8 (create mutations), Group 4 (type-state with hasWhere)

- [x] **9.1 Implement update(), updateAll(), updateCount()**
  - All variants require `hasWhere: true` (type-state gated)
  - `update(data)` -- `UPDATE ... WHERE ... LIMIT 1 RETURNING *`, returns `Promise<Row | null>`
  - `updateAll(data)` -- `UPDATE ... WHERE ... RETURNING *`, returns `AsyncIterableResult<Row>`
  - `updateCount(data)` -- `UPDATE ... WHERE ...`, returns `Promise<number>`
  - `where(all)` enables whole-table updates
  - `update`/`updateAll` require `returning` capability
  - Add UPDATE compilation to Kysely compiler
  - Files to modify: `src/collection.ts`, `src/kysely-compiler.ts`, `src/types.ts`
  - Write 4-5 tests: basic update with where, updateAll, updateCount, type error without where, whole-table with `where(all)`

- [x] **9.2 Implement delete(), deleteAll(), deleteCount()**
  - All variants require `hasWhere: true` (type-state gated)
  - `delete()` -- `DELETE ... WHERE ... LIMIT 1 RETURNING *`, returns `Promise<Row | null>`
  - `deleteAll()` -- `DELETE ... WHERE ... RETURNING *`, returns `AsyncIterableResult<Row>`
  - `deleteCount()` -- `DELETE ... WHERE ...`, returns `Promise<number>`
  - `where(all)` enables whole-table deletes
  - `delete`/`deleteAll` require `returning` capability
  - Add DELETE compilation to Kysely compiler
  - Files to modify: `src/collection.ts`, `src/kysely-compiler.ts`, `src/types.ts`
  - Write 3-4 tests: basic delete with where, deleteCount, type error without where

- [x] **9.3 Implement upsert()**
  - `upsert({ create, update, conflictOn? })` -- `INSERT ... ON CONFLICT DO UPDATE`, returns `Promise<Row>`
  - `conflictOn` specifies which unique constraint to use (optional when model has a single PK)
  - Define `UniqueConstraintCriterion` type from contract PK + unique indexes
  - Requires `returning` capability
  - Files to modify: `src/collection.ts`, `src/kysely-compiler.ts`, `src/types.ts`
  - Write 2-3 tests: basic upsert, upsert with conflictOn, upsert returning created vs updated

**Acceptance Criteria for Group 9:**
- Update/delete refuse to compile without `where()` (type-level enforcement)
- `where(all)` enables whole-table operations
- All three variants (single, all, count) work for both update and delete
- Upsert compiles to `ON CONFLICT DO UPDATE`
- Row-returning variants require `returning` capability

---

## Group 10: Nested Mutations

Depends on: Group 8 (create), Group 9 (update/delete)

- [ ] **10.1 Define RelationMutator type and RelationMutation data structure**
  - `RelationMutator<TContract, ModelName>` has methods: `create(data)`, `create(data[])`, `connect(criterion)`, `connect(criterion[])`, `disconnect()`, `disconnect(criterion[])`
  - Each method returns a `RelationMutation` -- an opaque descriptor `{ kind: 'create' | 'connect' | 'disconnect', data: ... }`
  - Create `src/relation-mutator.ts`
  - Define `MutationCreateInput<TContract, ModelName>` -- `CreateInput` extended with relation fields that accept callbacks `(mutator: RelationMutator) => RelationMutation`
  - Files to create: `src/relation-mutator.ts`
  - Files to modify: `src/types.ts`

- [ ] **10.2 Implement nested mutation execution orchestration**
  - When `create()` receives data with relation callbacks, execute in a transaction:
    1. Insert parent record, capture generated PK
    2. For each relation callback: invoke the mutator, get the RelationMutation descriptor
    3. For `create` mutations: insert child records with parent FK set to captured PK
    4. For `connect` mutations: update the FK on the existing record(s)
  - Same pattern for `update()` with relation callbacks
  - `disconnect()` sets FK to null (nullable to-one) or removes junction rows (to-many)
  - Nested mutations should work to arbitrary depth (recursive)
  - Files to modify: `src/collection.ts` (or new `src/mutation-executor.ts`)
  - Write 4-6 tests: create with nested create, create with connect, update with nested create, deep nesting (3 levels), disconnect

**Acceptance Criteria for Group 10:**
- `create({ ..., posts: p => p.create([...]) })` inserts parent and children
- `create({ ..., author: a => a.connect({ id: 1 }) })` links to existing record
- Generated PKs propagate to child inserts
- Nested mutations execute within a transaction boundary
- Deep nesting (3+ levels) works correctly

---

## Group 11: Root Aggregations

Depends on: Group 1 (WhereExpr)

- [ ] **11.1 Implement aggregate() terminal method**
  - `aggregate(fn: (a: AggregateBuilder) => AggregateSpec)` -- returns `Promise<AggregateResult>`
  - `AggregateBuilder` provides: `count()`, `sum(field)`, `avg(field)`, `min(field)`, `max(field)`
  - `sum`/`avg` typed to accept only numeric fields
  - Return types: `count` is `number`; `sum`/`avg`/`min`/`max` are `number | null`
  - User returns an object shape: `a => ({ count: a.count(), total: a.sum('amount') })`
  - Result type mirrors the shape: `{ count: number; total: number | null }`
  - Compiles to `SELECT count(*), sum("amount") FROM ... WHERE ...`
  - Create `src/aggregate-builder.ts`
  - Files to create: `src/aggregate-builder.ts`
  - Files to modify: `src/collection.ts`, `src/kysely-compiler.ts`, `src/types.ts`
  - Write 3-4 tests: count only, multiple aggregations, with where filter, empty result set returns null for sum/avg

**Acceptance Criteria for Group 11:**
- `aggregate()` computes multiple aggregations in a single query
- Result type matches the shape returned by the callback
- Numeric-only constraint on sum/avg/min/max fields
- Correct nullability for each aggregation function

---

## Group 12: GroupBy Aggregations

Depends on: Group 11 (root aggregations)

- [ ] **12.1 Implement groupBy() returning GroupedCollection**
  - `groupBy(...fields)` returns a `GroupedCollection` -- a new class or restricted Collection surface
  - `GroupedCollection` has: `having(predicate)`, `aggregate(fn)` -- but NOT `all()`, `find()`, `select()`, `include()`, mutations
  - The `aggregate()` on GroupedCollection returns `Promise<Array<{ [groupField]: value; [aggField]: value }>>`
  - Create `src/grouped-collection.ts`
  - Files to create: `src/grouped-collection.ts`
  - Files to modify: `src/collection.ts`, `src/kysely-compiler.ts`, `src/types.ts`

- [ ] **12.2 Implement having() on GroupedCollection**
  - `having(predicate: (h: HavingBuilder) => WhereExpr)` -- filter groups
  - `HavingBuilder` provides aggregate comparison methods: `h.count().gt(5)`, `h.sum('amount').gt(1000)`
  - Compiles to `HAVING count(*) > 5`
  - Files to modify: `src/grouped-collection.ts`, `src/kysely-compiler.ts`

- [ ] **12.3 Write tests for groupBy + having + aggregate**
  - Write 3-5 tests: basic groupBy with count, multi-column groupBy, having filter, groupBy with sum/avg, groupBy preserving where filters
  - Files to create: `test/grouped-collection.test.ts`

**Acceptance Criteria for Group 12:**
- `groupBy('role').aggregate(a => ({ count: a.count() }))` returns `Array<{ role: string; count: number }>`
- `having()` filters groups
- GroupedCollection does not expose read/mutation terminals

---

## Group 13: Include Aggregations and combine()

Depends on: Group 11 (aggregations), Group 6 (include cardinality)

- [ ] **13.1 Add scalar aggregation selectors to include refinement collections**
  - For to-many includes, the refinement collection exposes: `count()`, `sum(field)`, `avg(field)`, `min(field)`, `max(field)`
  - These return `IncludeScalar<T>` nodes (not query results)
  - When returned directly from the refinement callback, the include result type becomes the scalar type instead of row array
  - Example: `include('comments', c => c.count())` -> `{ ...PostFields, comments: number }`
  - Files to modify: `src/collection.ts`, `src/types.ts`
  - Write 2-3 tests: include with count, include with sum

- [ ] **13.2 Implement combine() for multi-branch includes**
  - `combine(spec: { [name]: Collection | IncludeScalar })` -- returns a composite include descriptor
  - Each branch is evaluated independently (different where/orderBy/take can apply)
  - Result type: `{ [name]: Row[] | number | null }`
  - Example: `include('comments', c => c.combine({ approved: c.where({ approved: true }), totalCount: c.count() }))`
  - Result type: `{ comments: { approved: CommentRow[]; totalCount: number } }`
  - Files to modify: `src/collection.ts`, `src/types.ts`, `src/kysely-compiler.ts`
  - Write 2-3 tests: combine with two row branches, combine with rows + count, combine with different filters per branch

**Acceptance Criteria for Group 13:**
- Include refinements can return scalar aggregations (count, sum, etc.)
- `combine()` produces named multi-branch results
- Each branch can have independent filters/ordering
- Types correctly reflect the combined shape

---

## Group 14: ORM Client Factory Refinements

Depends on: Groups 1-6 (core Collection changes)

- [ ] **14.1 Update orm() factory for spec compliance**
  - Verify the `collections` option key (already renamed from `repositories` to `collections`)
  - Ensure collection classes (not instances) are passed and instantiated lazily
  - Verify model name aliasing: `User`, `user`, `users` all resolve correctly
  - Verify caching of created collections
  - Update `OrmOptions` type if needed
  - Files to modify: `src/orm.ts`

- [ ] **14.2 Verify custom collection methods propagate through include refinements**
  - End-to-end test: register `PostCollection` with `published()` method, then verify `db.users.include('posts', p => p.published())` works
  - Verify registry propagation through nested includes
  - Files to modify: `test/orm.test.ts`
  - Write 2-3 tests

- [ ] **14.3 Update public exports**
  - Export new functions and types: `and`, `or`, `not`, `all`, `GroupedCollection`, `AggregateBuilder`
  - Export new type helpers: `CreateInput`, `UniqueConstraintCriterion`, `RelationMutator`, `CollectionTypeState`
  - Remove deprecated exports (`FilterExpr`, `ComparisonOp` if still exported)
  - Files to modify: `src/exports/index.ts`

**Acceptance Criteria for Group 14:**
- `orm()` factory works with all new Collection features
- Public API surface matches spec Appendix A
- No deprecated types in exports

---

## Group 15: Demo App Migration and Integration Validation

Depends on: All previous groups

- [ ] **15.1 Update demo app to use new API patterns**
  - Migrate `/Users/aqrln/prisma/prisma-next/examples/prisma-next-demo/src/orm-client/` files
  - Replace old `orderBy(() => ({ column, direction }))` with new `orderBy(p => p.createdAt.desc())` pattern
  - Add examples using: `select()`, shorthand `where()`, `find({ id: 42 })`, `and()`/`or()`
  - Add mutation examples: `create()`, `update()` with `where()`
  - Add aggregation example: `aggregate()`
  - Files to modify: all files in `examples/prisma-next-demo/src/orm-client/`

- [ ] **15.2 Verify demo app builds and runs**
  - Run `pnpm --filter prisma-next-demo build` and `pnpm --filter prisma-next-demo test` (if applicable)
  - Verify no TypeScript errors
  - Verify queries execute correctly against the test database
  - Acceptance: Demo app compiles and integration tests pass

- [ ] **15.3 Delete deprecated ORM lane package**
  - Per spec section 12: `@prisma-next/sql-orm-lane` is replaced by the ORM client
  - Remove the package directory and references from the monorepo
  - Update any imports or references in other packages/examples
  - Files to delete: `packages/2-sql/4-lanes/orm-lane/` (or equivalent path)
  - Files to modify: root `pnpm-workspace.yaml` or `turbo.json` if needed

- [ ] **15.4 Run full test suite and typecheck**
  - `pnpm test` -- all tests across monorepo
  - `pnpm typecheck` -- type checking across monorepo
  - `pnpm lint:deps` -- architectural boundary validation
  - Fix any regressions
  - Acceptance: Clean CI-equivalent run

**Acceptance Criteria for Group 15:**
- Demo app uses the new API and works correctly
- Deprecated ORM lane package is removed
- Full monorepo test suite, typecheck, and lint pass

---

## Execution Order

The recommended implementation sequence, accounting for dependencies:

```
Group 1:  AST Integration (FilterExpr -> WhereExpr)
  |
  +---> Group 2:  Logical Combinators + Expanded ModelAccessor
  |       |
  |       +---> Group 3:  Shorthand Object Filters
  |       |
  |       +---> Group 4:  select() + Type-State Tracking
  |               |
  |               +---> Group 5:  Cursor, Distinct, Type-State Gating
  |               |
  |               +---> Group 8:  Create Mutations
  |                       |
  |                       +---> Group 9:  Update/Delete/Upsert
  |                               |
  |                               +---> Group 10: Nested Mutations
  |
  +---> Group 6:  Include Cardinality + Registry Propagation
  |       |
  |       +---> Group 7:  Capability-Based Include Strategy
  |       |
  |       +---> Group 13: Include Aggregations + combine()
  |
  +---> Group 11: Root Aggregations
          |
          +---> Group 12: GroupBy Aggregations
          |
          +---> Group 13: Include Aggregations + combine()

Group 14: ORM Client Factory Refinements (after Groups 1-6)
Group 15: Demo App Migration + Integration Validation (after all)
```

Groups that share the same dependency level can be parallelized. For example, after Group 1, Groups 2, 6, and 11 can proceed concurrently if different people work on them.

---

## Key Files Reference

| File | Role |
|------|------|
| `packages/2-sql/6-orm-client/src/collection.ts` | Core Collection class -- most changes land here |
| `packages/2-sql/6-orm-client/src/types.ts` | All type definitions (CollectionState, ModelAccessor, Row types) |
| `packages/2-sql/6-orm-client/src/column-accessor.ts` | Proxy-based accessor -- becomes ModelAccessor |
| `packages/2-sql/6-orm-client/src/kysely-compiler.ts` | Compiles CollectionState to SQL via Kysely |
| `packages/2-sql/6-orm-client/src/orm.ts` | `orm()` factory, client proxy, model aliasing |
| `packages/2-sql/6-orm-client/src/exports/index.ts` | Public API surface |
| `packages/2-sql/6-orm-client/test/helpers.ts` | Test contract and mock runtime |
| `packages/2-sql/6-orm-client/test/collection.test.ts` | Main test file for Collection |
| `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` | PN AST types (WhereExpr, BinaryExpr, etc.) |
| `examples/prisma-next-demo/src/orm-client/` | Demo app integration |
