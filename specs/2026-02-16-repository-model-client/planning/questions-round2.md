# Round 2 Follow-up Questions -- Repository Model Client

Based on your detailed answers to Round 1, I have follow-up questions that dig into the open design areas. These are grouped by topic.

---

## 1. Lateral joins for includes -- migration strategy and API implications

You said the current multi-query stitching for `include()` must be replaced with lateral joins / correlated subqueries. Looking at the current implementation, `stitchIncludes()` in `collection.ts` fetches parent rows first, collects their PKs, then issues a separate `SELECT ... WHERE fk IN (...)` for each included relation, and stitches results in JS.

The contract already declares `"lateral": true` as a Postgres capability. The PN AST (both current and PR #152) already has `IncludeAst` with `kind: 'includeMany'` and a `child` block containing `table`, `on`, `where`, `orderBy`, `limit`, `project`.

**1a.** The lateral join approach would compile `include()` into a single SQL statement with `LATERAL` subqueries (or `json_agg` + lateral join), meaning the repository emits one Plan instead of N+1. This is a major simplification -- the repository would no longer need `acquireRuntimeScope`, connection pinning, or in-memory stitching for reads. The Postgres adapter already lowers `IncludeAst` to lateral joins.

Is the intent that `include()` for reads should **always** produce a single Plan (using the existing `IncludeAst` -> lateral join lowering path), eliminating the multi-query read path entirely? Or should the multi-query path remain as a fallback for targets that lack lateral join support?

**1b.** If we go single-statement for includes, the repository layer for read queries essentially becomes a query builder that produces a single `SelectAst` with `IncludeAst` children, then delegates to the adapter for lowering. This would mean the repository layer's multi-query orchestration privilege (ADR 161) is only exercised for mutations, not reads.

Does that match your mental model? The repository layer is the multi-query orchestrator for **mutations** specifically, while reads (even with nested includes) remain single-Plan?

**1c.** For nested includes with `orderBy` and `take` on the child (e.g., "include posts, ordered by createdAt desc, limit 5 per user"), the lateral join approach handles this naturally since each lateral subquery is scoped to one parent row. The current stitching approach has a `slicePerParent` hack that applies limit/offset in JS after fetching all matching rows. Should we confirm that the lateral join approach replaces `slicePerParent` entirely, and per-parent limit/offset is handled in SQL?

---

## 2. findUnique -- uniqueness encoding and API shape

You said `findUnique()` is worth exploring, and the open question is whether to encode uniqueness in type state or take the unique filter as an argument.

**2a.** The contract's `StorageTable` has `primaryKey` and `uniques` arrays, so the unique constraint information is available at the type level. For example, the demo contract's `user` table has `primaryKey: { columns: ["id"] }` and could have `uniques: [{ columns: ["email"] }]`.

One approach: `findUnique()` accepts a discriminated union of objects matching each unique constraint:

```typescript
// Given User has PK on `id` and unique on `email`:
db.users.findUnique({ id: "user_001" })           // by PK
db.users.findUnique({ email: "alice@example.com" }) // by unique
```

The type would be derived from the contract's `primaryKey` and `uniques`:

```typescript
type UniqueWhere<...> = { id: string } | { email: string }
```

The alternative is requiring the caller to build a where clause first and then calling `.findUnique()` on a collection that already has filters, relying on the user to ensure the filter targets a unique constraint (no type-level enforcement).

Which direction do you prefer? The first approach gives type-level enforcement of the uniqueness guarantee. The second is simpler to implement but provides no compile-time guarantee.

**2b.** For `findUniqueOrThrow()` -- should this be a separate method that returns `Promise<Row>` (no null), or should we defer this until the error handling spec (TML-1911) is complete? Since the error type it throws would need to be defined by that spec.

---

## 3. Filter AST integration with PR #152

You said filters should be abstract AST nodes, that PR #152's AST is the one to use, and that there is no difference between "externally built" and "built-in" filters.

**3a.** Looking at PR #152's expanded `WhereExpr` type:

```typescript
type WhereExpr = BinaryExpr | ExistsExpr | NullCheckExpr | AndExpr | OrExpr;
type BinaryOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'like' | 'ilike' | 'in' | 'notIn';
```

Currently the repository's `FilterExpr` is a much simpler type (`{ column, op, value }`). The plan is to replace `FilterExpr` with the PN AST's `WhereExpr` as the internal representation. The `where()` callback's column accessor would produce `WhereExpr` nodes instead of `FilterExpr`.

Should `where()` accept `WhereExpr` directly (allowing externally-built AST nodes to be passed in), or should it accept a callback that returns `WhereExpr` (current pattern), or both?

For example:

```typescript
// Callback pattern (current, ergonomic for simple cases)
db.users.where(u => u.email.eq("alice@example.com"))

// Direct AST node pattern (for externally-built expressions)
db.users.where(someExternallyBuiltWhereExpr)

// Both overloads?
```

**3b.** The column accessor currently uses a Proxy that returns `ComparisonMethods<T>` (eq, neq, gt, lt, gte, lte). With the expanded AST, the accessor should also support `like`, `ilike`, `in`, `notIn`, `isNull`, `isNotNull`. Additionally, for compound filters:

```typescript
db.users.where(u => and(u.email.like('%@example.com'), u.kind.eq('admin')))
// or
db.users.where(u => or(u.kind.eq('admin'), u.kind.eq('moderator')))
```

Should `and()`, `or()`, `not()` be standalone functions (imported from the package), or methods on the accessor, or both? Standalone functions seem more composable and align with "functions are more composable" from the new-api.md notes.

---

## 4. Relational filters -- `has`, `some`, `every`, `none`

You said relational filters are in scope and are the ORM client's responsibility. The new-api.md sketch shows:

```typescript
db.users.where(u => u.posts.has(p => p.popular()))
```

**4a.** Under the hood, relational filters translate to `EXISTS` / `NOT EXISTS` subqueries (already in the AST as `ExistsExpr`). The semantics map to:

- `has(predicate)` / `some(predicate)` -- EXISTS with correlated subquery
- `every(predicate)` -- NOT EXISTS with negated correlated subquery
- `none(predicate)` -- NOT EXISTS with correlated subquery

Should we use Prisma ORM's naming (`some`, `every`, `none`) for familiarity, or the `has` naming from the new-api.md sketch? Or should we support both as aliases?

**4b.** The accessor proxy currently only exposes scalar fields. For relational filters, accessing `u.posts` needs to return something different -- a relation accessor that exposes `has()`/`some()`/`every()`/`none()` methods. The callback passed to these methods receives a fresh accessor for the related model.

This means the column accessor needs to be aware of relations (from the contract), not just scalar fields. The type would become something like:

```typescript
type ModelAccessor<...> = {
  // Scalar fields -> ComparisonMethods
  [K in ScalarFields]: ComparisonMethods<FieldType<K>>;
  // Relations -> RelationFilterMethods
  [K in RelationNames]: RelationAccessor<RelatedModel<K>>;
};
```

Is this the right direction? Should the same accessor object serve both scalar comparisons and relation filters?

---

## 5. Mutation API surface

You said mutations are in scope, and nested mutations are the real use case for multi-query orchestration. The new-api.md shows a nested mutation sketch:

```typescript
db.posts.where({ id: postId }).findUnique().comments.create(commentInput)
```

**5a.** For basic CRUD, I am assuming these methods on the repository/collection:

- `create(data)` -- INSERT, returns created row (uses RETURNING when available, INSERT + SELECT otherwise per ADR 161)
- `update(data)` -- UPDATE matching `where()` filters, returns updated rows
- `delete()` -- DELETE matching `where()` filters, returns deleted rows
- `upsert({ create, update })` -- INSERT ON CONFLICT ... DO UPDATE

For the input types: `create(data)` should accept an object where required fields (non-nullable without default or mutation default) are required, and optional fields (nullable or with defaults) are optional. This type can be derived from the contract's storage columns + execution mutation defaults.

Is this the right set of mutation methods for the initial spec? Should `update` and `delete` require at least one `where()` filter to prevent accidental bulk operations (matching the lint guardrails PR #152 adds)?

**5b.** The new-api.md sketch shows `findUnique().comments.create(commentInput)` as a chained fluent API for nested mutations. This is a fundamentally different pattern from the read API -- it implies `findUnique()` returns a "reference" object (not yet executed) that exposes relation accessors for mutations.

An alternative is explicit nesting in the `create` payload:

```typescript
db.users.create({
  email: "alice@example.com",
  posts: {
    create: [{ title: "First post" }]
  }
})
```

Which nested mutation style should we pursue? The fluent chain (find parent -> access relation -> mutate), the nested payload (Prisma ORM style), or both? The fluent chain requires a "lazy reference" concept; the nested payload requires recursive input types.

**5c.** For `createMany`, `updateMany`, `deleteMany` -- you said batch operations are in scope. Should these be separate methods, or should `create`/`update`/`delete` handle both single and batch cases based on input shape? For example, `create([...items])` accepting an array vs. `createMany([...items])` as a distinct method.

---

## 6. Select / projection type narrowing

You said field selection is back in scope because it influences type design.

**6a.** The two patterns explored in new-api.md were:

```typescript
// Callback with typed accessor
.select(u => ({ name: u.name, email: u.email }))

// Object literal
.select({ name: true, email: true })
```

Both were marked "rejected for now" in new-api.md, but you have now brought projection back in scope. Which style should we pursue? The callback style gives more flexibility (computed expressions), while the object style is simpler and more familiar to Prisma ORM users.

**6b.** For the interaction between `select()` and `include()`: when a user selects specific fields AND includes a relation, the resulting type should be the intersection of selected scalar fields plus included relations. For example:

```typescript
db.users
  .select({ id: true, email: true })
  .include('posts')
  .findMany()
// Type: Array<{ id: string; email: string; posts: Post[] }>
```

Is this the expected behavior? Should `select()` only apply to the root model's scalar fields, with `include()` always adding relation fields on top?

---

## 7. Aggregations, cursors, distinct, batch operations

You said all of these are in scope. Let me ask about the API shape for each.

**7a.** **Aggregations**: Should aggregate methods live on the collection (e.g., `db.users.count()`, `db.users.where(...).count()`)? For `groupBy` with aggregates, what is the expected shape?

```typescript
// Simple count
const count: number = await db.users.where(u => u.kind.eq('admin')).count()

// Aggregation with groupBy
const stats = await db.users
  .groupBy(u => u.kind)
  .aggregate({ count: true, avg: u => u.age })
  .findMany()
// Type: Array<{ kind: string; count: number; avg: number | null }>
```

Or should aggregations be a separate API surface (not on the collection)?

**7b.** **Cursor-based pagination**: Cursor pagination typically requires a deterministic `orderBy` and then filtering to records after/before the cursor position. Should cursors be explicit (user provides the cursor value and field)?

```typescript
db.users
  .orderBy(u => u.createdAt.desc())
  .cursor({ after: { createdAt: lastSeen } })
  .take(20)
  .findMany()
```

Or should cursors be opaque (encoded string token that the system manages)?

**7c.** **Distinct**: `distinct` typically means `SELECT DISTINCT` or `DISTINCT ON` (Postgres-specific). Should `distinct()` apply to all selected columns, or should it accept specific columns (like Prisma ORM's `distinct: ['email']`)?

```typescript
// All columns
db.users.distinct().findMany()
// Specific columns (Postgres DISTINCT ON)
db.users.distinct(u => [u.kind]).orderBy(u => u.createdAt.desc()).findMany()
```

The type-state question you raised: should `distinct()` require `orderBy()` to have been called first (for `DISTINCT ON`), or should the system infer when `DISTINCT ON` vs `DISTINCT` is needed?

---

## 8. Type-state tracking for method availability

You mentioned encoding `orderBy` in type state for distinct and cursors. Currently the `Collection` class uses a single generic type `Row` that evolves as methods are chained. There is no type-state tracking beyond the row shape.

**8a.** The type-state approach would use phantom types or branded generics to track which methods have been called:

```typescript
// Conceptual type state
Collection<Contract, Model, Row, State extends { ordered: boolean; filtered: boolean; ... }>
```

This would enable:
- `distinct(columns)` only available after `orderBy()` (for DISTINCT ON)
- `cursor()` only available after `orderBy()`
- `findUnique()` conditionally available based on filter matching a unique constraint

How far should the type-state go? Tracking `ordered` and `filtered` seems practical. Tracking whether filters match a unique constraint (for `findUnique`) is significantly more complex. Should we keep type-state minimal (just `ordered` for distinct/cursor gating) or invest in richer type-state?

**8b.** Type-state adds generic parameter complexity. Every method signature gets more verbose, and custom repository subclasses need to thread the state parameter through. Is the ergonomic cost acceptable, or should we prefer runtime validation (throwing if `cursor()` is called without `orderBy()`) with simpler types?

---

Please provide your thoughts on these follow-up areas. They will directly shape the specification.
