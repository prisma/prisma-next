## Slice 6 — SQL Lane: Nested Projection Shaping (compile-time; flat SQL)

### Goal

Enable nested projection shaping in the SQL DSL lane so authors can express shapes like `{ name: t.user.name, post: { title: t.post.title } }` while the runtime compiles to flat SQL with aliased columns. Result typing (`ResultType<typeof plan>`) reflects the nested projection shape. No nested aggregation (json_agg/LATERAL) in this slice; that will be capability-gated in a separate slice.

Related slice: JOIN primitives (flat, portable) — see [Slice 5 — SQL Lane: Explicit JOINs](./05-SQL-Lane-Joins.md).

### Relevant docs

- Architecture Overview (Plans, lane responsibilities): [../Architecture Overview.md](../Architecture%20Overview.md)
- Query Lanes (Plan model, projection-driven typing): [../architecture docs/subsystems/3. Query Lanes.md](../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- ADR 011 Unified Plan Model (single-statement, plan shape): [../architecture docs/adrs/ADR 011 - Unified Plan Model.md](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- ADR 020 Result Typing Rules (projection-based typing): [../architecture docs/subsystems/3. Query Lanes.md#type-inference](../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- ADR 131 Codec typing separation (typeId-based typing): [../architecture docs/adrs/ADR 131 - Codec typing separation.md](../architecture%20docs/adrs/ADR%20131%20-%20Codec%20typing%20separation.md)

### Scope (MVP)

- Allow nested object literals inside `.select(...)` in the SQL DSL lane.
- Compile nested projections to a flat list of columns with deterministic aliases; update plan meta to reference these aliases as today.
- Maintain flat SQL; no aggregation or row reshaping at runtime in this slice.
- Result typing derives from the nested projection structure (compile-time only).

### API design (DSL)

```ts
const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .innerJoin(tables.post, on => on.eqCol(t.user.id, t.post.userId))
  .select({
    name: t.user.name,
    post: {
      title: t.post.title,
    },
  })
  .build();

type Row = ResultType<typeof plan>;
// Row === { name: string; post: { title: string } }
```

Notes
- Nested objects can be arbitrarily deep for shapes, but all leaves must be `ColumnBuilder`s.
- This is purely projection shaping; rows are not nested arrays/objects from SQL. Runtime keeps flat decoding; the type system provides the nested shape.

### Aliasing strategy (flat SQL)

- Each nested leaf `path` becomes a stable alias. MVP options (choose one):
  - Dotted path: `post.title` (requires lowerer to quote/munge per dialect); or
  - Flattened path: `post_title` (with a reversible map kept in memory during build for meta only).
- Plan.meta:
  - `projection`: alias → `table.column`
  - `projectionTypes`: alias → typeId
  - `annotations.codecs`: alias → typeId
- No change to `meta.refs` beyond columns referenced.
- Collision handling: builder errors on alias collision (PLAN.INVALID) with a clear message.

### AST

- Select AST remains a flat list of projected aliases; no AST change required beyond what Slice 5 adds for joins.
- Builder flattens nested projection into `{ alias, expr: ColumnRef }[]` at AST generation time.

### Typing rules

- Extend the compile-time projection inference to support nested projection objects:
  - Current: `InferProjectionRow<P extends Record<string, ColumnBuilder>>`.
  - New (recursive): support `Record<string, ColumnBuilder | NestedProjection>` where `NestedProjection` is `Record<string, ColumnBuilder | ...>`.
  - Leaf types use `ComputeColumnJsType` (via `CodecTypes[typeId].output`), preserving nullability.

### Runtime behavior

- Runtime returns flat JS objects keyed by aliases (as today). MVP does not materialize nested objects at runtime.
- Consumers can destructure/transform if they need nested values at runtime; type safety ensures columns exist and types match.

### Step-by-step plan (TDD)

1) Alias generator
- Implement a deterministic alias generator for nested keys (dotted or flattened). Guard against collisions; throw PLAN.INVALID on collision.
- Unit tests: nested paths map to expected aliases; collisions detected.

2) Builder flattening
- Extend the `.select(...)` builder to accept nested objects. Flatten to `{ alias, expr }` pairs and update AST/project accordingly.
- Unit tests: nested projection yields flat AST project array with expected aliases; meta.projection/projectionTypes/annotations include aliases.

3) Type inference (recursive)
- Introduce a recursive type `InferNestedProjectionRow<P, CodecTypes>` that walks nested projection objects; reuse `ComputeColumnJsType` at leaves.
- Replace `InferProjectionRow` usages in the builder’s generics with the new recursive variant.
- Type tests: nested projection yields nested `Row` shape.

4) Integration with joins
- Combine with Slice 5 joins: nested projection over joined columns.
- Integration tests (stub lowerer): AST contains expected joins; project contains flattened aliases; `ResultType` is nested.

5) E2E (optional for this slice)
- If available, run a simple end-to-end test with Postgres adapter to ensure decoding still returns values under the chosen aliases; no runtime nesting expected.

### Test matrix

- Single-level nesting: `{ post: { title } }`.
- Multi-level nesting: `{ a: { b: { c } } }`.
- Combined with joins (user→post): shape includes columns from joined table.
- Alias collision detection: `{ a_b: colX, a: { b: colY } }` → error.
- Mixed leaves and nested objects in the same projection.

### Acceptance criteria

- `.select(...)` accepts nested projection objects; builder flattens to aliases deterministically.
- `ResultType<typeof plan>` reflects nested shape; leaves typed by `CodecTypes[typeId].output` and storage nullability.
- Plan.meta includes `projection`, `projectionTypes`, and `annotations.codecs` keyed by aliases; `refs` include all referenced columns.
- Runtime remains flat; no nested row materialization in this slice.
- Tests pass: unit (aliasing, builder flattening), type-level (nested shape), integration (with joins, stub lowerer).

### Future work (separate slices)

- Capability-gated nested includes (arrays/objects) via LATERAL/json_agg (`includeMany`), gated by `jsonAgg` + `lateral`.
- Runtime row materialization (optional): transform flat alias map into nested objects based on alias dot-paths; out of scope for this slice.



