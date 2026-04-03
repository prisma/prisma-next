# Summary

Consolidate the SQL and Mongo ORM clients onto a shared `Collection` interface with fluent chaining, following [ADR 175 — Shared ORM Collection interface](../../docs/architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md). Phase 1 builds a Mongo `Collection` independently (spike), mirroring the SQL ORM's chaining API shape. Phase 2 extracts the shared interface from the two concrete implementations.

# Description

The Mongo ORM currently uses an options-bag API (`findMany({ where, include })`) from the Phase 3 PoC. The SQL ORM uses a fluent chaining pattern (`Collection` class with immutable method chaining). ADR 175 decides that the chaining API is the shared interface for all families.

Two ORM clients with divergent APIs for the same conceptual operations creates three problems:

1. Users who work with both SQL and Mongo must learn two different patterns for the same operations.
2. Custom collection subclasses (a key feature of the SQL ORM) don't work with the options-bag approach.
3. Code that operates on "any collection" (framework utilities, testing helpers, middleware) can't be written against a common interface.

**Approach: spike then extract.** Per ADR 175, the abstraction is discovered from the overlap between two concrete implementations, not predicted from one. Phase 1 builds the Mongo Collection independently. Phase 2 extracts the shared base once both families have working implementations.

**Parallelism:** This work has no dependency on M5 (unified contract type) or M6 (SQL emitter migration) from the [contract domain extraction project](../contract-domain-extraction/spec.md). The ORM query surface is independent of contract representation changes, and the domain-level access patterns are stable from M2 of that project.

**Design constraint — pipeline-only:** All MongoDB read queries compile to typed aggregation pipeline stages exclusively. The older `find()` API is not used. See [ADR 183 — Pipeline-only query representation for MongoDB](../../docs/architecture%20docs/adrs/ADR%20183%20-%20Pipeline-only%20query%20representation%20for%20MongoDB.md). The typed stage representation is shared between the ORM and the future pipeline query builder.

# Before / After

## API surface

**Before** (Mongo — options-bag):

```typescript
const db = mongoOrm({ contract, executor });

const users = await db.users.findMany({
  where: { email: 'alice@example.com' },
  include: { posts: true },
});
```

**After** (Mongo — fluent chaining, symmetric with SQL):

```typescript
const db = mongoOrm({ contract, executor });

const users = await db.users
  .where((user) => user.email.eq('alice@example.com'))
  .include('posts')
  .all();

const admin = await db.users
  .where({ kind: 'admin' })
  .orderBy([(user) => user.createdAt.desc()])
  .first();
```

**After** (shared custom collection subclass):

```typescript
class UserCollection extends Collection<Contract, 'User'> {
  admins() { return this.where({ kind: 'admin' }); }
  byEmail(email: string) { return this.where({ email }); }
}

// Works identically for SQL and Mongo
const admin = await db.users.admins().first();
```

# Requirements

## Functional Requirements

### Phase 1: Mongo Collection spike (isolated)

1. **Implement `MongoCollection` with fluent chaining.** `.where().select().include().orderBy().take().skip()` with immutable-clone state accumulation (same pattern as SQL `Collection`). Compile to `MongoQueryPlan` at terminal methods (`.all()`, `.first()`).

2. **Implement `CollectionState` → `MongoQueryPlan` compilation.** Translate accumulated filters, includes, orderBy, limit/offset, selectedFields into typed pipeline stages via `AggregateCommand` ([ADR 183](../../docs/architecture%20docs/adrs/ADR%20183%20-%20Pipeline-only%20query%20representation%20for%20MongoDB.md)). Pipeline stages are a discriminated union of typed nodes (`MongoMatchStage`, `MongoLookupStage`, `MongoProjectStage`, `MongoSortStage`, etc.), not untyped documents.

3. **Implement typed `where` DSL for Mongo.** `MongoModelAccessor` with comparison methods (`.eq()`, `.neq()`, `.gt()`, `.lt()`, `.gte()`, `.lte()`, `.in()`, `.isNull()`), producing a structured Mongo filter expression AST (mirroring SQL's `AnyExpression` pattern with visitor/interpreter separation). Support both callback style `(model) => model.field.eq(value)` and shorthand object style `{ field: value }`. The filter AST is the content of `MongoMatchStage` in the pipeline.

4. **Wire `mongoOrm()` to return `MongoCollection` instances.** `orm.users` returns a `MongoCollection<Contract, 'User'>` instead of the current options-bag accessor.

5. **Update Mongo demo.** Replace `findMany({ ... })` calls with chaining API.

6. **Tests.** Unit tests for collection chaining, compilation to MongoQueryPlan, and integration tests against `mongodb-memory-server`.

### Phase 2: Shared interface extraction (coordinate with Alexey)

7. **Extract `Collection<C, M>` base class to the framework layer.** Both SQL and Mongo Collections extend it. The base owns chaining methods and `CollectionState` accumulation; subclasses implement terminal compilation.

8. **Extract `InferModelRow` utility type.** A shared row type inference utility using `model.fields[f].codecId`. Both families currently have their own version.

9. **Verify custom collection subclasses work.** `class UserCollection extends Collection<C, 'User'>` with domain methods (`.admins()`, `.byEmail(email)`) works identically for both families.

10. **Extract shared `include` interface.** Cardinality-aware coercion (to-one → `T | null`, to-many → `T[]`) with refinement callbacks.

## Non-Functional Requirements

- **Immutable chaining.** Every chaining method returns a new instance; the original is never mutated. This enables safe reuse of intermediate queries.
- **Custom subclass preservation.** `#createSelf` uses `this.constructor` so chained operations stay on the subclass (matching SQL ORM behavior).
- **Type safety.** Where DSL comparison methods are gated by codec semantic traits. Include only offers reference relations (not embedded). Select only allows model field names.

## Non-goals

- **Mutations.** `create`, `update`, `delete`, `upsert` on the Mongo Collection are deferred. Phase 1 is read-only.
- **Cursor pagination.** `cursor()` is deferred.
- **Distinct / distinctOn.** Deferred.
- **GroupBy / aggregation.** `GroupedCollection` equivalent for Mongo is deferred. The pipeline DSL is the Mongo equivalent of the SQL query builder (a lower-level escape hatch).
- **Family-specific where operators.** SQL-specific (`ilike`, `between`) and Mongo-specific (`$regex`, `$elemMatch`, `$exists`) extensions are deferred. Phase 1 covers universal operators only.
- **Nested includes.** SQL supports multi-level nested includes. Mongo supports single-level `$lookup`. The shared interface accommodates both but the Mongo spike implements single-level only.

# Acceptance Criteria

### Phase 1

- [ ] `MongoCollection` class with fluent chaining: `.where().select().include().orderBy().take().skip().all().first()`
- [ ] Chaining is immutable — each method returns a new instance
- [ ] `.where()` supports callback style `(model) => model.field.eq(value)` and shorthand object style `{ field: value }`
- [ ] `MongoModelAccessor` provides comparison methods gated by codec traits: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `in`, `isNull`
- [ ] `.select()` compiles to `MongoProjectStage`
- [ ] `.orderBy()` compiles to `MongoSortStage`
- [ ] `.take()` and `.skip()` compile to `MongoLimitStage` and `MongoSkipStage`
- [ ] All read queries compile to typed pipeline stages via `AggregateCommand` — `FindCommand` is not used ([ADR 183](../../docs/architecture%20docs/adrs/ADR%20183%20-%20Pipeline-only%20query%20representation%20for%20MongoDB.md))
- [ ] `.include()` compiles to `$lookup` pipeline stages with cardinality-aware `$unwind`
- [ ] `.first()` returns `T | null` (single result or null)
- [ ] `mongoOrm()` returns Collection instances instead of options-bag accessors
- [ ] Mongo demo uses the chaining API
- [ ] Unit tests for chaining, compilation, and where DSL
- [ ] Integration tests against `mongodb-memory-server`

### Phase 2

- [ ] `Collection<C, M>` base class in the framework layer, extended by both SQL and Mongo
- [ ] Shared `CollectionState` type in the framework layer
- [ ] Shared `InferModelRow` utility type in the framework layer
- [ ] Custom collection subclasses work identically for both families
- [ ] Shared include interface with cardinality-aware coercion
- [ ] SQL ORM continues to pass all existing tests after extraction
- [ ] Mongo ORM continues to pass all existing tests after extraction

# Other Considerations

## Coordination

- **Alexey (SQL ORM):** Phase 1 does not touch the SQL ORM. Phase 2 changes the SQL Collection's inheritance hierarchy — requires coordination. Should be sequenced when Alexey has a natural pause point (likely after VP1: transactions or VP2: extension operations).
- **Contract domain extraction (Will):** No blocking dependency. Runs in parallel with M5/M6.

## Risk

- **Where DSL intermediate representation.** The SQL `ModelAccessor` produces SQL AST nodes; the Mongo equivalent produces `MongoExpr`. The shared interface (Phase 2) needs a generic `ModelAccessor<ExprType>` or an intermediate representation. Phase 1 sidesteps this by building a Mongo-specific accessor.
- **SQL Collection extraction difficulty.** The SQL Collection is ~1000 lines with deep coupling to SQL-specific internals (column mapping, `AnyWhereExpr`, SQL query plan compilation). Extracting the shared interface requires careful separation. Having two concrete implementations first (Phase 1) makes this easier because the boundary is discovered, not predicted.

# References

- [ADR 175 — Shared ORM Collection interface](../../docs/architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)
- [ADR 183 — Pipeline-only query representation for MongoDB](../../docs/architecture%20docs/adrs/ADR%20183%20-%20Pipeline-only%20query%20representation%20for%20MongoDB.md)
- [ADR 172 — Contract domain-storage separation](../../docs/architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md)
- [April milestone plan](../../docs/planning/april-milestone.md) § WS4, task 2
- Linear: [TML-2189](https://linear.app/prisma-company/issue/TML-2189)
- Current Mongo ORM: `packages/2-mongo-family/4-orm/src/`
- SQL ORM Collection: `packages/3-extensions/sql-orm-client/src/`

# Open Questions

1. **Where DSL generalization (Phase 2).** Common operators (eq, neq, gt, lt) vs family-specific extensions (SQL: ilike, between; Mongo: $regex, $elemMatch). How does the shared `ModelAccessor` accommodate both?
2. **Aggregation/groupBy (future).** Shared Collection interface or family-specific extension?
3. **Include refinement depth.** Single-level (current Mongo `$lookup`) vs nested (SQL supports arbitrary depth). How does the shared interface express family-specific depth limits?
