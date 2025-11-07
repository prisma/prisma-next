## Slice 8 — ORM Lane: Discoverable, Relation-Aware Chained API (Reads + Base Writes)

### Goal

Introduce a model-centric ORM lane that optimizes for discoverability and relationship traversal while compiling to the SQL lane primitives. Provide a fluent, chainable API for reads and base-model writes. Relation filters use a namespaced, explicit `where.related.<relation>.some/none/every` shape. Nested result includes will be a later slice.

### Relevant docs

- Architecture Overview (Plans, lane responsibilities): [../Architecture Overview.md](../Architecture%20Overview.md)
- Query Lanes (Plan model, traversal, capability gating): [../architecture docs/subsystems/3. Query Lanes.md](../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- ADR 011 Unified Plan Model: [../architecture docs/adrs/ADR 011 - Unified Plan Model.md](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- ADR 016 Adapter SPI for Lowering: [../architecture docs/adrs/ADR 016 - Adapter SPI for Lowering.md](../architecture%20docs/adrs/ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md)
- ADR 020 Result Typing Rules: [../architecture docs/subsystems/3. Query Lanes.md#type-inference](../architecture%20docs/subsystems/3.%20Query%20Lanes.md#type-inference)
- ADR 131 Codec typing separation: [../architecture docs/adrs/ADR 131 - Codec typing separation.md](../architecture%20docs/adrs/ADR%20131%20-%20Codec%20typing%20separation.md)
- Builds on: [Slice 5 — SQL Lane: JOINs](./05-SQL-Lane-Joins.md) and [Slice 7 — includeMany (LATERAL/json_agg)](./07-SQL-Lane-IncludeMany-Lateral-JsonAgg.md) (for future includes)

### Scope (MVP)

- Entrypoint (discoverable): `orm.<model>()`, e.g., `orm.user()` with strong intellisense.
- Reads (terminal): `findMany()`, `findFirst()`, `findUnique()`.
- Base-model writes (terminal): `create(data)`, `update(where, data)`, `delete(where)`.
- Chain before terminals: `.where(...)`, `.orderBy(...)`, `.take(n)`, `.skip(n)`, `.select(...)`.
- Relation filters (filter-only): `where.related.<relation>.some/none/every(predicate)`.
- Child selection (nested includes): `include.<relation>(child => child.select(...).where(...).orderBy(...).take(n))` — capability-gated by a single adapter capability `includes.singleStmt`.
- No nested writes yet.

### API design

Reads
```ts
// Filter users by related posts that match a predicate (exists)
const users = await orm.user()
  .where(u => u.active.eq(true))
  .where.related.posts.some(p => p.where(pp => pp.createdAt.gt(param('since'))))
  .orderBy(u => u.createdAt.desc())
  .select(u => ({ id: u.id, email: u.email }))
  .findMany();

// Variants
orm.post().where.related.author.some(a => a.where(aa => aa.name.eq(param('name')))).findMany();
orm.post().where.related.author.none(a => a.where(aa => aa.active.eq(false)) ).findMany();
orm.post().where.related.author.every(a => a.where(aa => aa.orgId.eq(param('org')))).findMany();

// Include child rows (nested array) — capability-gated (includes.singleStmt)
const usersWithPosts = await orm.user()
  .include.posts(p => p
    .where(pp => pp.createdAt.gt(param('since')))
    .orderBy(pp => pp.createdAt.desc())
    .take(10)
    .select(pp => ({ id: pp.id, title: pp.title }))
  )
  .select(u => ({ id: u.id, email: u.email, posts: true }))
  .findMany();
// Row: { id: number; email: string; posts: Array<{ id: number; title: string }> }
```

Writes (base model only)
```ts
await orm.user().create({ id: 1, email: 'x@example.com' });
await orm.user().update({ id: 1 }, { email: 'y@example.com' });
await orm.user().delete({ id: 1 });
```

Notes
- `where.related.<relation>` exposes relations from the contract (`Contract['relations'][Model]`) as dot-properties, typed and explicit.
- `.some/.none/.every` compile respectively to `EXISTS`, `NOT EXISTS`, and `NOT EXISTS` of the complement (or adapter `join.semi` when available). No ordering/limit/select inside the predicate; it’s a filter-only scope.
- `.include.<relation>(...)` compiles to the SQL lane `includeMany` and is capability-gated by `includes.singleStmt`; compile-time error when the capability is not declared as a literal `true` in `contract.d.ts` (fallback: PLAN.UNSUPPORTED at build if not literal).
- `.select(...)` uses projection shaping rules from the SQL lane (nested objects allowed; compiles to aliased flat columns; types reflect nested shape).

### Lowering

- ORM compiles to the SQL lane builder under the hood:
  - where: column=param maps to SQL lane where
  - orderBy/take/skip maps to lane equivalents
  - related.some/none/every maps to EXISTS/NOT EXISTS subqueries built from relation metadata, or `join.semi` when supported by the adapter
  - include.<relation>(...) maps to SQL lane includeMany (Slice 7). The adapter chooses the concrete single-statement lowering strategy (e.g., LATERAL+json_agg on Postgres, correlated JSON subquery on MySQL/MariaDB, APPLY+FOR JSON on SQL Server/Oracle). Child where/orderBy/take are applied inside the subquery; alias defaults to the relation name.
  - select maps to SQL lane projection shaping (nested compile-time only)
- Terminal read methods call `.build()` and hand the plan to runtime; writes compile to single-statement DML plans (MVP).

### Typing rules

 - Read result typing derives from `.select(...)` (projection-driven) using `ComputeColumnJsType` and `CodecTypes`.
 - `.where.related.*` affects filtering only; it does not alter the row shape.
 - `.include.<relation>(...)` contributes `{ [relation]: Array<ChildShape> }` to the row when selected (e.g., `.select(..., posts: true)`); child element shape derives from the child projection in the include callback.
- Writes return either void, number of affected rows, or selected fields when `.select(...)` is chained (MVP choice: return affected rows; selection-on-write can be a follow-up).

### Examples

Child-centric filtering via parent
```ts
// Posts authored by users in a given org
const posts = await orm.post()
  .where.related.author.some(a => a.where(u => u.orgId.eq(param('orgId'))))
  .select(p => ({ id: p.id, title: p.title }))
  .findMany();
```

Multi-hop filtering
```ts
// Tags whose posts are authored by active users
const tags = await orm.tag()
  .where.related.posts.some(p => p.where(pp => pp.active.eq(true)))
  .where.related.posts.some(p => p.where(pp => pp.related.author.some(a => a.where(aa => aa.active.eq(true)))))
  .findMany();

Parent-centric include with child filter
```ts
const users = await orm.user()
  .include.posts(p => p.where(pp => pp.active.eq(true)).select(pp => ({ id: pp.id })))
  .select(u => ({ id: u.id, posts: true }))
  .findMany();
// Row: { id: number; posts: Array<{ id: number }> }
```
```

### Implementation plan (TDD)

1) Entrypoint and model registry
- Implement `orm.<model>()` proxies generated from `Contract['models']` with strong typing.
- Unit tests: exposes only valid model names; invalid access rejected at compile time.

2) Base builder
- Implement chained methods: `.where(fn)`, `.orderBy(fn)`, `.take(n)`, `.skip(n)`, `.select(fn)`; terminal `.findMany()/.findFirst()/.findUnique()`.
- Map the chain to equivalent SQL lane calls; unit tests verify mapping outcome using a stub lowerer (AST JSON). Type tests verify `ResultType` from `.select`.

3) Relation filters (some/none/every)
- Implement `where.related` proxy exposing relation names for the base model.
- Provide `.some/.none/.every(predicate)`; inside predicate, expose a scoped builder with only `.where` (filter-only scope; no select/order/limit).
- Lower `.some/.none/.every` to EXISTS/NOT EXISTS using relation metadata (FK columns) or adapter `join.semi` when available.
- Unit tests: chained related filters compile to expected AST structure (stub JSON) and disallow invalid operations inside predicate.

4) Includes (child selection)
- Implement `include.<relation>(child => child.where(...).orderBy(...).take(n).select(...))` with capability gating via `includes.singleStmt`.
- Validate: child projection non-empty; alias collision checks with other includes and selected fields; relation name must exist on model.
- Lower to SQL lane includeMany; unit tests verify AST includes and projection includeRef; type tests verify row includes `{ [alias]: Array<ChildShape> }` when selected.

5) Writes (base model only)
- Implement `.create(data)`, `.update(where, data)`, `.delete(where)`; compile to single DML statements in SQL lane; return affected rows (MVP).
- Unit tests: compile expected DML AST; disallow nested writes.

6) Integration tests
- Build representative read queries with related.some/none/every and verify:
  - AST has EXISTS/NOT EXISTS structure (stub lowerer)
  - Plan meta refs include involved tables
  - `ResultType` matches `.select` projection
 - Include tests: include posts under users; child where/order/limit applied; plan has includes; runtime decodes JSON array; `ResultType` includes nested array when selected.
 - Simple write tests verify DML statements are single-statement and return affected rows.

### Acceptance criteria

- `orm.<model>()` exists with chained `.where/.orderBy/.take/.skip/.select` and terminal `.findMany/.findFirst/.findUnique`.
- `where.related.<relation>.some/none/every` works for any relation defined in the contract; filters base rows only; typed and discoverable.
- Lowering uses EXISTS/NOT EXISTS (or join.semi) with explicit relation metadata; no ambiguity.
 - `include.<relation>(...)` exists (capability-gated by `includes.singleStmt`) and compiles to SQL lane includeMany; selecting the include alias contributes a nested array type to the row.
- Base writes compile to single DML statements; no nested writes.
- Tests pass: unit (builder API, relation filters, writes), type-level (ResultType from select), integration (stub lowerer AST).

### Future work (follow-up slices)

- Nested result includes for arrays/objects (via `includeMany` API; capability-gated by `includes.singleStmt`).
- Nested writes (connect/create/update on relations).
- Operation registry for pack-defined operators and parameterized types (vector/geospatial).


