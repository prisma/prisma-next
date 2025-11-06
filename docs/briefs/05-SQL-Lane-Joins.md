## Slice 5 — SQL Lane: Explicit JOINs (portable, capability-agnostic)

### Goal

Add explicit JOIN operations to the SQL DSL lane, as close to SQL as possible, portable across SQL dialects, and arbitrarily chainable. This slice focuses only on flat joins (denormalized result rows). A separate slice will add capability-gated nested includes (LATERAL + json_agg).

### Relevant docs

- Architecture Overview (Plans, lane responsibilities): [../Architecture Overview.md](../Architecture%20Overview.md)
- Query Lanes (Plan model, capability gating, result typing): [../architecture docs/subsystems/3. Query Lanes.md](../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- ADR 011 Unified Plan Model (single-statement, plan shape): [../architecture docs/adrs/ADR 011 - Unified Plan Model.md](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- ADR 020 Result Typing Rules: [../architecture docs/subsystems/3. Query Lanes.md#type-inference](../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- Codec typing separation (typeId-based typing): [../architecture docs/adrs/ADR 131 - Codec typing separation.md](../architecture%20docs/adrs/ADR%20131%20-%20Codec%20typing%20separation.md)

### Scope (MVP)

- Add INNER/LEFT/RIGHT/FULL JOIN primitives to the SQL DSL.
- Support simple ON conditions with column = column equality (one or more joins chained arbitrarily).
- Keep result typing unchanged: row type comes from explicit select projection; joins only influence available columns and plan refs.
- Extend AST to carry joins; update plan.meta refs accordingly; do not implement nested includes or capability-gated behavior in this slice.

### API design (DSL)

Explicit, SQL-like join methods on the select builder:

```ts
// Tables
const t = makeT<Contract, CodecTypes>(contract);

const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .innerJoin(tables.post, on => on.eqCol(t.user.id, t.post.userId))
  // .leftJoin(tables.post, on => on.eqCol(t.user.id, t.post.userId))
  .where(t.user.active.eq(param('active')))
  .select({
    userId: t.user.id,
    email: t.user.email,
    postId: t.post.id,
    title: t.post.title,
  })
  .build({ params: { active: true } });
```

Notes
- Join methods: `innerJoin`, `leftJoin`, `rightJoin`, `fullJoin`.
- `on` callback receives a small helper with `eqCol(left, right)` to build a column-to-column equality condition (MVP: equality only).
- Arbitrary chaining: multiple joins are appended in order; `from(table).innerJoin(...).leftJoin(...).rightJoin(...)`.
- WHERE continues to accept column = param comparisons (unchanged for MVP).

### AST changes

Extend the relational AST to represent joins:

```ts
export interface JoinAst {
  readonly kind: 'join';
  readonly joinType: 'inner' | 'left' | 'right' | 'full';
  readonly table: TableRef;           // joined table
  // MVP: equality predicate col=col, but future-proof as an expression union
  readonly on: JoinOnExpr;
}

// MVP shape; future: add boolean composition (and/or), other predicates, literals
export type JoinOnExpr =
  | { readonly kind: 'eqCol'; readonly left: ColumnRef; readonly right: ColumnRef };

export interface SelectAst {
  readonly kind: 'select';
  readonly from: TableRef;
  readonly joins?: ReadonlyArray<JoinAst>;   // NEW
  readonly project: ReadonlyArray<{ alias: string; expr: ColumnRef }>;
  readonly where?: BinaryExpr;               // unchanged (col = param)
  readonly orderBy?: ReadonlyArray<{ expr: ColumnRef; dir: Direction }>;
  readonly limit?: number;
}
```

Builder adjustments
- Add `eqCol(other: ColumnBuilder)` or `on.eqCol(left: ColumnBuilder, right: ColumnBuilder)` to produce a join ON predicate.
- Validate at build time that `left` and `right` refer to columns (not params) and come from (potentially) different tables; throw PLAN.INVALID on misuse with a clear message.
- Do NOT change result typing: `InferProjectionRow` still composes selected columns.

### Meta and refs

- `meta.refs.tables`: include `from` table and all joined tables.
- `meta.refs.columns`: include columns referenced in projection, where, orderBy, and join ON clauses.
- `meta.projection` unchanged.
- `meta.annotations.codecs` and `projectionTypes` remain based on column type IDs; include only projected aliases and where params. Do not annotate join ON columns.

### Ordering guarantees

- Joins are applied in the order they were declared on the builder, before where/orderBy are lowered. Ordering is deterministic and preserved in `ast.joins[]`.

### Lowering

- Adapter lowerer renders joins according to `joinType` and ON clause.
- Tests can use the stub adapter (JSON-stringified AST) to assert join presence; SQL rendering changes can be covered by sql-target tests.

### Nullability semantics (typing note)

- LEFT/RIGHT/FULL joins can introduce nulls for columns from the joined table at runtime. For MVP, projection typing uses storage-declared column nullability only; join kind does not auto-propagate nullability changes. This is acceptable for the flat-join MVP and can be revisited later if we introduce nullability propagation rules.

### Non-goals (this slice)

- No nested includes (LATERAL/json_agg); will be a separate, capability-gated slice.
- No compound ON predicates or arbitrary boolean expressions (can be extended later).
- No automatic relation inference; all joins are explicit and close to SQL.

### Step-by-step implementation plan (TDD)

1) Types and AST
- Add `JoinAst` and `joins?: JoinAst[]` to `SelectAst` in `packages/sql/src/types.ts`.
- Add a small helper type for a join ON predicate builder.
- Unit tests: type file exports; ensure AST shape is correct.

2) Column-to-column equality builder
- Add `eqCol(other: ColumnBuilder)` to `ColumnBuilderImpl` OR implement `on.eqCol(left, right)` helper in the join API.
- Ensure it returns a typed representation suitable for joins (not params).
- Unit tests: building an ON predicate from two columns.

3) Builder API: innerJoin/leftJoin/rightJoin/fullJoin
- Add chainable methods on `SelectBuilderImpl` that:
  - Accept a `TableRef` and an `on` callback producing a valid join ON predicate.
  - Append a `JoinAst` to builder state.
- Keep generics (Row, CodecTypes) unchanged (typing derives from select projection only).
- Unit tests: single join and multiple chained joins produce correct AST joins array.

4) Build meta refs and tables list
- Update `buildMeta` to include joined tables in `refs.tables` and ON columns in `refs.columns`.
- Unit tests: refs contain all tables and join columns.

5) Plan build and param descriptors unaffected
- Ensure where/params behavior unchanged; join ON uses column-to-column equality (no params in MVP).
- Unit tests: where param descriptors remain correct alongside joins.

6) Adapter lowering compatibility
- Verify `adapter.lower(ast, ...)` receives the new `joins` array; stub adapter tests inspect AST JSON to confirm structure.
- sql-target tests can be added/extended to render SQL joins correctly (separate package scope).

7) Type tests
- Demonstrate that `ResultType<typeof plan>` is derived from selected columns; adding joins does not change typing beyond exposing additional columns to select.

8) Integration test
- Build a plan with innerJoin and leftJoin, select columns from both tables, run through stub adapter; assert:
  - AST contains expected joins in order
  - meta.refs.tables includes both tables
  - meta.annotations/projectionTypes remain aligned with projection

### Test matrix (examples)

- Single INNER JOIN with ON (user.id = post.userId)
- Chained joins: `user` INNER JOIN `post`, then LEFT JOIN `comment`
- LEFT vs INNER semantics (lowering level verification in sql-target)
- Where with param alongside joins
- Disambiguation when tables share column names; projection aliasing avoids collisions; refs show fully qualified table/column
- Joins order is preserved across multiple chained joins
- RIGHT/FULL joins exercise AST path in stub-lowering tests

### Ergonomics and future extensions

- Future: boolean ON expressions (`and`, `or`), greater-than, etc.
- Future: relation-aware helpers (e.g., `rel(t.user, 'posts')`) layered over this primitive.
- Future: capability-gated nested include (`includeMany`) built from LATERAL/json_agg.
- Future: optional table aliasing ergonomics; AST maintains stable `TableRef.name` while lowerers generate safe SQL aliases
- Future: optional `.rawOn(sql, refs)` escape hatch for complex ON predicates (not in MVP)

### Acceptance criteria

- SQL DSL exposes `innerJoin`, `leftJoin`, `rightJoin`, `fullJoin` with `on.eqCol(left, right)`.
- AST includes `joins[]` with type and ON predicate; builder supports arbitrary chaining.
- Plan meta refs updated; plan typing unchanged and derived solely from projection.
- Tests pass: unit (types, builder, meta), type-level, and DSL integration (stub lowerer) verifying AST shape and meta.


