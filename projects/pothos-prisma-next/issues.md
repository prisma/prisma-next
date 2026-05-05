# Open issues — orm-client single-query gaps

Two follow-up bugs surfaced while building `examples/pothos-integration`. Both live in `packages/3-extensions/sql-orm-client/`. They're independent of each other and independent of the W-1 (FK augmentation) fix already in the walker. They share the lateral/correlated emission path, so a unified fix is feasible.

The pre-existing W-8 fix (`fix(orm-client): selectIncludeStrategy now finds capability flags…`) made the strategy detection see capability flags in their actual emitted location. The single-query path now activates when capabilities allow, but it still falls back to the multi-query strategy whenever it sees a shape it doesn't know how to emit. Two short-circuits remain.

## Background: how a Collection fetch is dispatched

When you call `db.User.include('posts', …).all()`, the orm-client builds a `CollectionState` with a list of `IncludeExpr` entries and routes execution through `dispatchCollectionRows` (`packages/3-extensions/sql-orm-client/src/collection-dispatch.ts:47-69`). That delegates to `dispatchWithIncludeStrategy` when there are includes (`collection-dispatch.ts:71-101`):

```ts
function dispatchWithIncludeStrategy<Row>(options: {…}): AsyncIterableResult<Row> {
  const strategy = selectIncludeStrategy(options.contract);

  if (
    hasNestedIncludes(options.state.includes) ||           // ← Issue A short-circuit
    hasComplexIncludeDescriptors(options.state.includes)   // ← Issue B short-circuit
  ) {
    return dispatchWithMultiQueryIncludes<Row>(options);
  }

  switch (strategy) {
    case 'lateral':    return dispatchWithSingleQueryIncludes<Row>({ …, strategy: 'lateral' });
    case 'correlated': return dispatchWithSingleQueryIncludes<Row>({ …, strategy: 'correlated' });
    default:           return dispatchWithMultiQueryIncludes<Row>(options);
  }
}
```

Two paths, then:

- **Single-query** (`dispatchWithSingleQueryIncludes`, `collection-dispatch.ts:103-178`): one outer SELECT with a LATERAL JOIN per relation (lateral mode) or a correlated subquery per relation (correlated mode). The relation rows come back inside the parent row as JSON.
- **Multi-query** (`dispatchWithMultiQueryIncludes`, `collection-dispatch.ts:180-238`): one SELECT for the parent rows, then one SELECT per relation (with an `IN (parent-pk-values)` filter), stitched together in JS.

The two short-circuits force every nested include and every combine/scalar include into the multi-query path, even on databases that could do it in one statement.

`IncludeExpr` (`packages/3-extensions/sql-orm-client/src/types.ts:55-65`) is the data each entry carries:

```ts
export interface IncludeExpr {
  readonly relationName: string;
  readonly relatedModelName: string;
  readonly relatedTableName: string;
  readonly targetColumn: string;
  readonly localColumn: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly nested: CollectionState;            // ← Issue A: includes inside .nested.includes
  readonly scalar: IncludeScalar<unknown> | undefined;        // ← Issue B
  readonly combine: Readonly<Record<string, IncludeCombineBranch>> | undefined; // ← Issue B
}
```

Note `nested: CollectionState` — that's a *full* CollectionState, including its own `.includes[]`. So the IR already supports arbitrary nesting; only the emission and dispatch fall short.

---

## Issue A — `hasNestedIncludes` short-circuit

`db.User.include('posts', p => p.include('comments'))` (depth 2+) currently fires N+1 queries even when `lateral && jsonAgg` are available.

### Symptom

```graphql
{ users { posts { comments { body } } } }
```

Should be one SQL statement on Postgres (LATERAL with json_array_agg) or one statement on SQLite (correlated subquery with json_group_array). Actually fires three: one for users, one for posts, one for comments.

### Root cause

`dispatchWithIncludeStrategy` short-circuits on `hasNestedIncludes` (`collection-dispatch.ts:474-476`):

```ts
function hasNestedIncludes(includes: readonly IncludeExpr[]): boolean {
  return includes.some((include) => include.nested.includes.length > 0);
}
```

If any include has its own includes, the dispatcher routes to multi-query without consulting `selectIncludeStrategy`.

The reason: the single-query emission path was written for depth-1 only. Look at `buildIncludeChildRowsSelect` (`packages/3-extensions/sql-orm-client/src/query-plan-select.ts:208-270`) — the function the lateral/correlated artifact builders use to construct the inner SELECT for a relation:

```ts
function buildIncludeChildRowsSelect(contract, parentTableName, include) {
  const childState = include.nested;
  // …
  const childProjection = buildProjection(
    contract,
    include.relatedTableName,
    childState.selectedFields,
    childTableRef,
  );
  // …
  let childRows = SelectAst.from(TableSource.named(include.relatedTableName, childTableAlias))
    .withProjection([...childProjection, ...hiddenOrderProjection])
    .withWhere(whereExpr);
  // …
  return { childRows, childProjection, rowsAlias, aggregateOrderBy };
}
```

Notice it reads `childState.selectedFields`, `.orderBy`, `.distinct`, `.limit`, `.offset` — but never `childState.includes`. The child SELECT is flat: it joins the child table to the parent on the FK, projects the child's scalar columns, and stops. Any further includes the user added inside the relation's refinement get silently dropped.

The same blindness shows up in `dispatchWithSingleQueryIncludes` at result-unwrap time (`collection-dispatch.ts:145-160`):

```ts
for (const parent of parentRows) {
  for (const include of state.includes) {
    if (include.scalar || include.combine) {
      throw new Error(
        'single-query include strategy does not support scalar include selectors or combine()',
      );
    }
    const rawChildren = parseIncludedRows(parent.raw[include.relationName]);
    const mappedChildren = rawChildren.map((childRow) =>
      mapStorageRowToModelFields(contract, include.relatedModelName, childRow),
    );
    parent.mapped[include.relationName] = coerceSingleQueryIncludeResult(
      mappedChildren,
      include.cardinality,
    );
  }
}
```

`parseIncludedRows` does one level of JSON parse + per-row mapping. It doesn't know that a child row itself might have its own nested-include result key (`comment.author`) that needs the same treatment.

### What the fix looks like

Recursive emission, three places:

**1. `buildIncludeChildRowsSelect` becomes recursive.** When `childState.includes.length > 0`, build the same lateral/correlated artifacts for each grandchild, append their joins/projections to the child's SELECT. Each grandchild's projection is itself a `json_array_agg(json_object(…))` (or `json_object` for to-one relations), which becomes one column in the child's projection.

**2. Each level needs a stable alias namespace.** The current code uses `${include.relationName}__rows` and `${include.relationName}_lateral`. With nesting, two relations on different levels could share a name (e.g. `User → Comments` and `Post → Comments`), and you'd get duplicate aliases inside the same SELECT — invalid SQL. Need a path-prefixed alias like `posts__comments__rows`.

**3. `dispatchWithSingleQueryIncludes` result unwrap recurses.** After parsing `parent.raw['posts']` as a JSON array of post rows, walk the include's `nested.includes` and apply the same `parseIncludedRows` + map step to each post row's `comments` key, and so on. Currently it stops at depth 1.

### Risks

These are real correctness landmines, not just engineering complexity:

1. **Codec decoding through JSON.** The depth-1 path already wrestles with this, but the surface grows at depth 2+. Today `mapStorageRowToModelFields` decodes column values through the codec registry — that path assumes raw column values from the driver. JSON aggregation gives you JSON-stringified values for everything. Codecs like `pg/timestamptz@1`, `pg/numeric@1`, `pgvector` need a way to decode from the JSON representation. The depth-1 path handles common scalars; depth-2 has to handle the same logic but for grandchildren the codec lookup is keyed on the grandchild's `relatedModelName`. Easy to wire wrong.

2. **Nullable vs empty-array.** A to-one relation that's null vs a to-many relation that's empty look the same coming back as `null` from `coalesce(json_group_array(...), '[]')`. The depth-1 path uses `coerceSingleQueryIncludeResult` (`collection-dispatch.ts:542-547`) which checks cardinality. Depth-2 has to do the same recursively at every level, with the cardinality available at each `IncludeExpr`.

3. **Postgres LATERAL planner cost.** LATERAL on Postgres can be very fast or very slow depending on the query planner's stats and the table sizes. For wide schema graphs (e.g. a User type with 10 relations each with their own includes), nested LATERAL can produce planner-time blowups. The multi-query path is "boring but predictable"; lateral nested isn't. A heuristic — fall back to multi-query above some depth, or below some row-count threshold — might be worth shipping with the fix.

4. **SQLite correlated subqueries.** SQLite doesn't have LATERAL; the correlated-mode path is the only single-query option. Deeply correlated subqueries are slow on SQLite (no index push-down through subquery boundaries). Worth measuring before assuming the fix is a perf win for SQLite.

5. **MySQL/MariaDB.** Lateral support landed in MySQL 8.0.14 (called "lateral derived tables"). MariaDB doesn't have it. If the orm-client ever adds those targets, the correlated path is the only single-query option, and the depth-2 cost concern is louder.

### Test impact

- **In `sql-orm-client/`**: probably 0–3 tests break. The existing single-query integration tests are depth-1 (`integration/include.test.ts` lines 332-543) and would be unaffected. The multi-query tests force capabilities to empty / use depth-1 + scalar/combine and would still hit the same path via Issue B's short-circuit. Worth scanning for any explicit `executions.length` assertions on depth-2+ shapes.
- **In `e2e-tests/`, `integration-tests/`**: unknown. Would need a sweep — the e2e suite exercises real Postgres queries, and any test asserting on SQL-statement count for nested includes would break.

### Effort

**1–2 weeks** for someone with the codebase. Most of the time goes to:

- Codec-through-JSON for non-trivial codecs (the existing depth-1 logic isn't reusable as-is for grandchildren).
- The performance-heuristic question (do we always emit nested lateral? threshold? per-target opt-out?).
- Test matrix.

The SQL emission itself is well-understood — it's the same pattern composed recursively. The hard part is everything else.

---

## Issue B — `hasComplexIncludeDescriptors` short-circuit (combine + scalar)

`db.User.include('posts', p => p.combine({ recent: p.take(1), total: p.count() }))` always fires N+1 queries, regardless of capabilities.

### Symptom

The Pothos integration's headline differentiator query:

```graphql
{ users { drafts publishedPosts postCount } }
```

Walker emits `db.User.include('posts', p => p.combine({ drafts: …, publishedPosts: …, postCount: p.count() }))`. Currently dispatched as 1 outer query + 1 SELECT per branch = **4 SQL statements**. Could be 1.

### Root cause

`hasComplexIncludeDescriptors` (`collection-dispatch.ts:478-480`):

```ts
function hasComplexIncludeDescriptors(includes: readonly IncludeExpr[]): boolean {
  return includes.some((include) => include.scalar !== undefined || include.combine !== undefined);
}
```

If any include carries a `scalar` or `combine` descriptor, the dispatcher routes to multi-query.

And inside `compileSelectWithIncludeStrategy` (`query-plan-select.ts:475-528`) — which is what the single-query path calls to compile the SQL — the same defence shows up explicitly:

```ts
export function compileSelectWithIncludeStrategy(
  contract,
  tableName,
  state,
  strategy: 'lateral' | 'correlated',
  modelName?,
): SqlQueryPlan<…> {
  if (
    state.includes.some((include) => include.scalar !== undefined || include.combine !== undefined)
  ) {
    throw new Error(
      'single-query include strategy does not support scalar include selectors or combine()',
    );
  }
  // …
}
```

So the hand-off to single-query SQL emission *itself* refuses when scalar or combine is present — even if the outer dispatcher slipped through somehow. Two layers of defence in depth, both correct: the lateral/correlated emitters genuinely don't know how to produce these shapes.

What scalar and combine actually mean today:

**Scalar** is one of `count`/`sum`/`avg`/`min`/`max` — implemented in JS in the multi-query path via `computeScalarValue` (`collection-dispatch.ts:579-618`):

```ts
function computeScalarValue(selector, rows): number | null {
  if (selector.fn === 'count') return rows.length;
  const column = selector.column;
  if (!column) return null;
  const numericValues = rows
    .map((row) => coerceNumericValue(row[column]))
    .filter((value): value is number => value !== null);
  // …
  if (selector.fn === 'sum') return numericValues.reduce((total, value) => total + value, 0);
  if (selector.fn === 'avg') /* mean of numericValues */;
  if (selector.fn === 'min') return Math.min(...numericValues);
  if (selector.fn === 'max') return Math.max(...numericValues);
}
```

So scalar values today: fetch every matching row through `resolveScalarByParent` (`collection-dispatch.ts:419-468`), pass them to `computeScalarValue`, and reduce them in JS *after codec decoding*.

**Combine** is a record of named branches, each either a row-include or a scalar (`collection-dispatch.ts:277-322` — `stitchCombinedInclude`). Each branch fires its own SELECT in multi-query mode. With three branches (rows + rows + count): 1 outer + 3 branch SELECTs = 4 statements.

### What the fix looks like

**Scalar emission**: drop the JS reduction in favour of a SQL aggregate inside a correlated subquery (or LATERAL):

- `count` → `(SELECT COUNT(*) FROM child WHERE child.targetColumn = parent.localColumn [+ where])`
- `sum(col)` → `(SELECT SUM(child.col) FROM child WHERE …)`
- `avg`, `min`, `max` analogously.

The `where` clause comes from the scalar's `state.filters`. The orderBy/limit/offset on a scalar are weird — `count(*)` doesn't have an order, but `sum` over a `LIMIT`-ed window might. The current JS path uses `slicePerParent` (`collection-dispatch.ts:549-562`) for offset/limit per parent group. SQL doesn't have a clean equivalent of "per group, the top-N rows" without window functions. Probably: only support orderless aggregates in single-query mode, fall back to multi-query when offset/limit is set on a scalar branch. (The demo doesn't exercise this; it's an open design question.)

**Combine emission**: each branch becomes a key in a single `json_object(…)` projection, all wrapped in a single LATERAL or correlated subquery against the relation. Rough shape (correlated mode, SQLite syntax):

```sql
(SELECT json_object(
  'drafts',         (SELECT coalesce(json_group_array(…), '[]') FROM post WHERE post.authorId = user.id AND post.published = 0),
  'publishedPosts', (SELECT coalesce(json_group_array(…), '[]') FROM post WHERE post.authorId = user.id AND post.published = 1),
  'postCount',      (SELECT COUNT(*) FROM post WHERE post.authorId = user.id)
)) AS posts
```

That's one correlated subquery in the user SELECT's projection, replacing today's three round-trips. Lateral mode is analogous with `LEFT JOIN LATERAL …`.

The result-unwrap path needs to handle the new shape: `parent.raw['posts']` is a JSON object (not an array), with branch keys mapping to either arrays (rows) or scalars (counts/sums). The existing `parseIncludedRows` and `coerceSingleQueryIncludeResult` only handle the array shape; they'd need a sibling `parseCombinedInclude`.

### Risks

**The big one: aggregation semantics divergence.** Today scalar values are computed in JS over codec-decoded values. Move them to SQL and the values are computed over the database's raw column type. For most scalars (int, real, text-as-string) these agree. For others they don't:

- **`pg/numeric@1` (arbitrary-precision decimal)**: JS reducer uses `Number(string)` via `coerceNumericValue` (`collection-dispatch.ts:620-642`), which loses precision past ~15 digits. SQL `SUM` preserves the precision. **Result for `sum(account_balance)` on a billion-row dataset: JS rounds, SQL doesn't.** The "fix" silently changes observable user behaviour.
- **Custom user codecs** (e.g. money codecs that decode to a `Money` class with currency): the JS reducer would call `coerceNumericValue(money)` which returns `null` (it's an object), so the JS path silently produces null. SQL `SUM(money_column)` would sum the underlying number column, which may or may not be what the user intended. Either way: the behaviours differ.
- **`pg/timestamptz@1` for `min`/`max`**: JS would `Math.min`/`Math.max` over decoded `Date` objects → `NaN` because Dates aren't numbers. SQL `MIN`/`MAX` over `timestamptz` works correctly. Here SQL is *more* correct — the JS path is currently buggy for non-numeric columns, and the fix would expose intent users had to work around. Still: behavioural change.
- **NULL handling.** SQL `AVG` ignores NULLs. The current JS reducer also filters via `coerceNumericValue` returning `null` for NULL input — so they agree on plain numerics, but an aggregate over a column where the codec decodes NULL to a sentinel value (some custom codecs do this) would diverge.

**Decision required**: do you (a) ship SQL aggregation only for an allowlist of codec ids known to be safe (`pg/int4@1`, `pg/int8@1`, `pg/float8@1`, etc.) and keep the JS path for the rest, or (b) ship SQL aggregation across the board and document the semantics change? Option (a) is conservative and ugly; option (b) needs an ADR and probably a migration note.

**`where` on combine branches**: each branch can have `state.filters`. Current emission needs each branch's WHERE inlined into the correlated subquery / LATERAL derived table. Mostly mechanical, but the WHERE-binder (`buildStateWhere` in `query-plan-select.ts`) needs to be invoked per-branch with the right table reference.

**Counts vs filtered counts**: the demo's `postCount` field has no `where`. If the user adds `where`, today the JS path filters in memory after fetching all matching rows. SQL aggregation needs `COUNT(*) FILTER (WHERE …)` (Postgres) or a subquery (SQLite). Per-target SQL.

**State coupling**: today, `parent.mapped[include.relationName]` is the combine object after stitch (`collection-dispatch.ts:277-322`). The pothos-integration plugin's `wrapResolve` reshape walks this object to lift branches to flat keys. If we change combine to come back as a JSON object inside the parent row's `raw` field instead, the reshape needs to keep working — which it does, because both paths produce the same shape post-mapping.

### Test impact

- 2–5 tests in `sql-orm-client/` will break. Specifically the combine integration tests at `integration/include.test.ts` that assert `runtime.executions.length === 4` for combine cases. Those would become 1.
- Adapter and e2e tests potentially affected if they assert SQL count for combine-using queries.
- New tests required: per-aggregation-fn correctness (especially numeric-precision and NULL), per-target SQL emission (Postgres/SQLite), the combine-with-where branch path.

### Effort

**3–7 days**. Smaller than Issue A — the scalar/combine emission is a localized addition rather than a recursive restructure. The bulk goes to:

- The codec/aggregation-semantics decision (above) — needs a design discussion before code.
- Per-target SQL for `COUNT(*) FILTER (WHERE …)` etc.

The mechanical SQL emission is straightforward.

---

## Combined?

Both bugs share the lateral/correlated emission path, so a unified fix is feasible — but the work isn't really "the SQL". It's the supporting infrastructure:

- A clear codec-through-JSON story for nested aggregation (Issue A).
- An aggregation-semantics decision: SQL-side vs JS-side, allowlist vs change-of-behaviour (Issue B).
- A heuristic for when to actually use single-query nested vs falling back to multi-query (Issue A — some workloads are faster multi-query).

Combined effort: **1.5–3 weeks**.

The naive "just lift the short-circuits" fix is dangerous because it can silently change observable behaviour for users with custom codecs (scalar aggregation) or surprise them with planner-time blowups (deeply nested LATERAL). Both deserve an ADR before implementation.

For the pothos demo, neither bug blocks the headline story:

- Issue A (depth ≥ 2) remains visible to the Pothos author as `executionCount > 1` on deep queries. That's now *honest* about the underlying behaviour — the dispatch falls back, the lateral path exists but is conservative.
- Issue B (combine + scalar) keeps the multi-query overhead on the drafts/publishedPosts/postCount case but the demo functionally works (flat keys, correct values).

Both deserve Linear tickets; neither is urgent for this branch.

---

## File / line index

For convenience when filing the Linear tickets:

| Concern | File | Lines |
|---|---|---|
| Strategy detection (W-8, fixed) | `packages/3-extensions/sql-orm-client/src/include-strategy.ts` | 6-58 |
| Dispatch entry | `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts` | 47-69 |
| Dispatch strategy + short-circuits (Issue A, Issue B) | `…/collection-dispatch.ts` | 71-101 |
| Single-query dispatch + result unwrap (Issue A) | `…/collection-dispatch.ts` | 103-178 |
| Multi-query dispatch (reference impl) | `…/collection-dispatch.ts` | 180-238 |
| `hasNestedIncludes` (Issue A) | `…/collection-dispatch.ts` | 474-476 |
| `hasComplexIncludeDescriptors` (Issue B) | `…/collection-dispatch.ts` | 478-480 |
| `parseIncludedRows` (Issue A — depth-1 only) | `…/collection-dispatch.ts` | 509-525 |
| `coerceSingleQueryIncludeResult` | `…/collection-dispatch.ts` | 542-547 |
| Combine / scalar stitching (multi-query reference for Issue B) | `…/collection-dispatch.ts` | 277-345 |
| `resolveRowsByParent` (multi-query stitch) | `…/collection-dispatch.ts` | 368-417 |
| `resolveScalarByParent` (multi-query scalar) | `…/collection-dispatch.ts` | 419-468 |
| `computeScalarValue` (Issue B — JS reducer to replace) | `…/collection-dispatch.ts` | 579-618 |
| `compileSelectWithIncludeStrategy` (single-query SQL emit) | `packages/3-extensions/sql-orm-client/src/query-plan-select.ts` | 475-528 |
| `buildIncludeChildRowsSelect` (Issue A — needs recursion) | `…/query-plan-select.ts` | 208-270 |
| `buildLateralIncludeArtifacts` | `…/query-plan-select.ts` | 272-308 |
| `buildCorrelatedIncludeProjection` | `…/query-plan-select.ts` | 310-339 |
| `IncludeExpr` shape | `packages/3-extensions/sql-orm-client/src/types.ts` | 55-65 |
