## Slice 7 — SQL Lane: includeMany via LATERAL + json_agg (capability-gated)

### Goal

Add a capability-gated nested include operation to the SQL DSL lane that returns one row per parent with a nested array field for children, built in a single statement using `LATERAL` + `json_agg` (when supported). This builds on:

- Slice 5 — SQL Lane: Explicit JOINs (portable primitives)
- Slice 6 — SQL Lane: Nested Projection Shaping (compile-time nested shapes)

### Relevant docs

- Architecture Overview (Plans, lane responsibilities): [../Architecture Overview.md](../Architecture%20Overview.md)
- Query Lanes (First-class relationship traversal; lowering; capability gating): [../architecture docs/subsystems/3. Query Lanes.md#first-class-relationship-traversal-in-the-core-ast](../architecture%20docs/subsystems/3.%20Query%20Lanes.md#first-class-relationship-traversal-in-the-core-ast)
- ADR 011 Unified Plan Model: [../architecture docs/adrs/ADR 011 - Unified Plan Model.md](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- ADR 016 Adapter SPI for Lowering: [../architecture docs/adrs/ADR 016 - Adapter SPI for Lowering.md](../architecture%20docs/adrs/ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md)
- ADR 020 Result Typing Rules: [../architecture docs/subsystems/3. Query Lanes.md#type-inference](../architecture%20docs/subsystems/3.%20Query%20Lanes.md#type-inference)
- ADR 131 Codec typing separation: [../architecture docs/adrs/ADR 131 - Codec typing separation.md](../architecture%20docs/adrs/ADR%20131%20-%20Codec%20typing%20separation.md)

### Scope (MVP)

- Add `includeMany` to the SQL lane that produces nested arrays per parent row via `LATERAL` + `json_agg`.
- Capability-gated: requires `Contract['capabilities']` to declare both `jsonAgg` and `lateral` (or equivalent names surfaced by the adapter).
- Explicit relation specification (no inference): caller supplies child table and ON predicate via column equality (same `eqCol` builder as JOINs).
- Child subquery allows a nested projection (Slice 6), optional `where`, `orderBy`, and `limit` scoped to children.
- Result typing reflects `{ alias: Array<ChildShape> }` under the chosen alias; empty array when no children.

### API design (DSL)

```ts
const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .includeMany(
    tables.post,
    on => on.eqCol(t.user.id, t.post.userId),
    child => child.select({ id: t.post.id, title: t.post.title }).orderBy(t.post.createdAt.desc()).limit(10),
    { alias: 'posts' },
  )
  .select({ id: t.user.id, name: t.user.name, posts: true }) // picks include alias
  .build();

type Row = ResultType<typeof plan>;
// Row === { id: number; name: string; posts: Array<{ id: number; title: string }> }
```

Notes
- `alias` defaults to the child table name; allow override via options.
- Projection selection: either include the alias in the top-level `.select({ posts: true })`, or auto-include by default; MVP uses explicit selection to keep semantics clear.
- `includeMany` does not filter parents; it is equivalent to LEFT semantics at the parent level but yields an empty array for no children.

### Capability gating (compile-time)

- Provide a conditional type on `includeMany` that constrains `Contract['capabilities']['lateral']` and `Contract['capabilities']['jsonAgg']` to `true`.
- When capabilities are not present as literal `true`, calls to `includeMany` are a type error with a helpful message (no runtime branching ambiguity).

### AST

Introduce an `IncludeAst` node alongside `SelectAst` that the lowerer can render to a lateral subquery:

```ts
export interface IncludeAst {
  readonly kind: 'includeMany';
  readonly alias: string; // e.g., 'posts'
  readonly child: {
    readonly table: TableRef;
    readonly on: JoinOnExpr; // eqCol between parent and child
    readonly where?: BinaryExpr; // scoped to child
    readonly orderBy?: ReadonlyArray<{ expr: ColumnRef; dir: Direction }>;
    readonly limit?: number;
    readonly project: ReadonlyArray<{ alias: string; expr: ColumnRef }>; // flattened child projection
  };
}

export interface SelectAst {
  readonly kind: 'select';
  readonly from: TableRef;
  readonly joins?: ReadonlyArray<JoinAst>;
  readonly includes?: ReadonlyArray<IncludeAst>; // NEW
  readonly project: ReadonlyArray<{ alias: string; expr: ColumnRef | { kind: 'includeRef'; alias: string } }>;
  readonly where?: BinaryExpr;
  readonly orderBy?: ReadonlyArray<{ expr: ColumnRef; dir: Direction }>;
  readonly limit?: number;
}
```

The projection references the include by alias with a special `includeRef`; lowerers render a lateral subquery that returns a single JSON value (aggregated), aliased to the include alias.

### Lowering (Postgres MVP)

- Render a `LEFT JOIN LATERAL (
  SELECT json_agg(json_build_object(...child columns... ORDER BY ... LIMIT ...)) AS posts
  FROM child
  WHERE child.user_id = parent.id AND (child WHERE ...)
) AS posts ON true` pattern.
- Enforce child `orderBy` and `limit` inside the lateral.
- Parent projection selects the include alias `posts` and other parent columns as requested.

### Plan meta and decoding

- `meta.projection` includes the include alias → special marker (e.g., `include:posts`) for tooling; `projectionTypes[alias]` can be omitted or marked as `'core/json@1'`.
- `meta.annotations.codecs` does not need codec entries for includes; decoding is handled generically by the runtime for this slice.
- Runtime decoding: parse the JSON string from the include alias and return a JS array of objects matching the child projection shape. This is target-agnostic and capability-gated by the include API; no adapter-specific logic.

### Typing rules

- Extend the projection typing so that including an `includeRef` alias produces an array type whose element shape is derived from the child projection using the same `ComputeColumnJsType` rules.
- The final `Row` type is a composition of parent selected columns and `{ [alias]: Array<ChildShape> }`.

### Step-by-step plan (TDD)

1) Capability type gating
- Add utility types to constrain `includeMany` availability based on `Contract['capabilities']` literal booleans.
- Type-level tests: usage errors when capabilities are absent; compiles when present.

2) AST additions
- Add `IncludeAst` and `includes?: IncludeAst[]` to `SelectAst`. Add `includeRef` support in projection entries.
- Unit tests: selecting an include alias produces an `includeRef` entry.

3) Builder API
- Implement `includeMany(childTable, on => on.eqCol(...), childBuilder => childBuilder.select({...}).orderBy(...).limit(...), options?: { alias?: string })`.
- Validate: ON uses column equality; alias collision checks; child projection non-empty.
- Unit tests: builder produces `includes[]` and projection includes `includeRef` alias.

4) Lowering (stub adapter + sql-target outline)
- Stub adapter test: AST JSON contains `includes[]` with correct shape.
- sql-target tests (in its package): lower `includes` to LEFT JOIN LATERAL + json_agg for Postgres; include ORDER BY/LIMIT.

5) Meta and decoding
- Plan meta: ensure refs include parent and child tables; projection maps include alias; annotations remain intact for non-include aliases.
- Runtime test: parse JSON string from include alias into JS array of child-shape objects.

6) Type tests
- Confirm `ResultType<typeof plan>` for includeMany yields `{ parentCols...; posts: Array<{ childCols... }> }` using `CodecTypes[typeId].output` and storage nullability for leaves.

### Test matrix

- includeMany with alias default vs custom.
- includeMany with child where/orderBy/limit.
- Combined with JOINs in the same query.
- Capability negative test: includeMany rejected at compile time if capabilities missing.

### Acceptance criteria

- `includeMany` is available only when capabilities declare `lateral` and `jsonAgg`.
- Builder produces `includes[]` and projection `includeRef` entries; alias collisions prevented.
- Lowerer renders LATERAL + json_agg with child projection; runtime decodes include JSON to JS array according to child projection shape.
- `ResultType<typeof plan>` reflects `{ [alias]: Array<ChildShape> }` and parent columns; tests pass.

### Future work

- Optional nested object (single) include (N:1) using json_build_object without aggregation.
- Multi-include performance and plan size considerations.
- Adapter-provided JSON decoding via codec registry if we later standardize a `core/json@1` codec.


