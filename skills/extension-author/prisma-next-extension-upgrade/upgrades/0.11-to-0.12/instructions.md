---
from: "0.11"
to: "0.12"
changes:
  - id: expr-visitor-add-window-func-method
    summary: |
      The `ExprVisitor<R>` interface in `@prisma-next/sql-relational-core/ast` gained a required `windowFunc(expr: WindowFuncExpr): R` method (added to support `ROW_NUMBER() OVER (…)` lowering for `.distinct(cols)`). Every `ExprVisitor<R>` implementation in your extension — typically the object literal you pass to `expr.accept({ … })` — must add the new method or TypeScript will refuse the literal. The right body depends on what the visitor does: binding/encoding/transforming visitors usually treat `WindowFuncExpr` similarly to `AggregateExpr`; visitors that reject unsupported kinds in restricted contexts (e.g. grouped `HAVING`) should reject window functions there too. No automated codemod — author the body per visitor by hand.
    detection:
      glob: "**/*.ts"
      contains:
        - "ExprVisitor"
        - "aggregate"
      anyMatch: false
  - id: any-expression-exhaustive-switch-add-window-func-case
    summary: |
      The `AnyExpression` discriminated union in `@prisma-next/sql-relational-core/ast` gained a `WindowFuncExpr` variant (`kind: 'window-func'`). Exhaustive switches over `expr.kind` that use the `satisfies never` exhaustiveness pattern — typically in SQL renderers, AST walkers, and analysis passes — will fail to compile until they add a `case 'window-func':` arm. The arm's body depends on the switch's purpose; the most common shape is "render the window function as `fn() OVER (…)`" (matching Postgres/SQLite syntax) or "reject as unsupported in this context".
    detection:
      glob: "**/*.ts"
      contains:
        - "case 'aggregate':"
        - "satisfies never"
      anyMatch: false
  - id: distinct-cols-now-collapses-by-specified-columns
    summary: |
      `.distinct(cols)` on `@prisma-next/sql-orm-client` `Collection` (and on nested `.include(…, c => c.distinct(cols)…)`) now keeps **one representative row per `(cols)` group**, matching Prisma semantics. Prior to 0.12 the lowering was effectively a no-op — `.distinct('title')` returned every row whenever the projection contained any unique column (typically `id`), because the underlying SQL `DISTINCT` deduped on the full projected row. No code change is required for consumer call sites, but any extension tests or fixtures that asserted the pre-0.12 no-collapse output will fail and need updating to reflect the new collapsed shape. The representative within each partition is picked by the user's `.orderBy(…)` (if any); when the orderBy doesn't fully order rows in a partition the pick is implementation-defined, matching Prisma's documented behaviour.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - ".distinct("
      anyMatch: true
---

# 0.11 → 0.12 — Extension-author upgrade instructions

## `expr-visitor-add-window-func-method`

Starting at the 0.12 release, the framework `ExprVisitor<R>` interface in `@prisma-next/sql-relational-core/ast` gained a required method:

```ts
windowFunc(expr: WindowFuncExpr): R;
```

This method was added to support `WindowFuncExpr` — the new AST node for window functions, currently lowering `ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)` used by `.distinct(cols)` (and reserved for `RANK` / `DENSE_RANK` as future additions).

Every `ExprVisitor<R>` implementation needs to add the new method. The natural body depends on what the visitor does:

- **Binding / encoding / transforming visitors** — usually treat `WindowFuncExpr` the same way they treat `AggregateExpr` (recurse into `args`, `partitionBy`, and `orderBy`).
- **Validating visitors** that restrict which expression kinds are allowed in a given context (e.g. grouped `HAVING` clauses) — typically reject window functions just like they reject aggregates in unrelated contexts.

### Before 0.12

```ts
expr.accept<AnyExpression>({
  columnRef: (e) => bindExpression(contract, e),
  identifierRef: (e) => e,
  subquery: (e) => bindExpression(contract, e),
  operation: (e) => bindExpression(contract, e),
  aggregate: (e) => bindExpression(contract, e),
  // … other methods …
});
```

### Starting at 0.12

```ts
expr.accept<AnyExpression>({
  columnRef: (e) => bindExpression(contract, e),
  identifierRef: (e) => e,
  subquery: (e) => bindExpression(contract, e),
  operation: (e) => bindExpression(contract, e),
  aggregate: (e) => bindExpression(contract, e),
  windowFunc: (e) => bindExpression(contract, e), // ← new: required
  // … other methods …
});
```

### Or, for a context that rejects unsupported kinds

```ts
expr.accept<AnyExpression>({
  // …
  aggregate: rejectInThisContext,
  windowFunc: rejectInThisContext, // ← new: required
  // …
});
```

TypeScript will report missing-property errors on every visitor literal after the bump; that's a reliable compile-time signal for every affected site. No automated codemod — the right body depends on what your visitor does, so author each one by hand.

## `any-expression-exhaustive-switch-add-window-func-case`

Starting at the 0.12 release, the `AnyExpression` discriminated union in `@prisma-next/sql-relational-core/ast` gained `WindowFuncExpr` (`kind: 'window-func'`). Exhaustive switches over `expr.kind` that use the `satisfies never` exhaustiveness pattern will fail to compile until they add a matching arm.

The most common case is in SQL renderers — Postgres and SQLite both render `WindowFuncExpr` as `fn() OVER (PARTITION BY … ORDER BY …)` (the syntax is identical across the two targets we ship).

### Before 0.12

```ts
function renderExpr(expr: AnyExpression): string {
  switch (expr.kind) {
    case 'column-ref':
      return renderColumn(expr);
    case 'aggregate':
      return renderAggregate(expr);
    // … other cases …
    // v8 ignore next 4
    default:
      throw new Error(
        `Unsupported expression node kind: ${(expr satisfies never as { kind: string }).kind}`,
      );
  }
}
```

### Starting at 0.12

```ts
function renderExpr(expr: AnyExpression): string {
  switch (expr.kind) {
    case 'column-ref':
      return renderColumn(expr);
    case 'aggregate':
      return renderAggregate(expr);
    case 'window-func':
      return renderWindowFunc(expr); // ← new: required
    // … other cases …
    default:
      throw new Error(
        `Unsupported expression node kind: ${(expr satisfies never as { kind: string }).kind}`,
      );
  }
}

function renderWindowFunc(expr: WindowFuncExpr): string {
  const fn = expr.fn.toUpperCase();
  const args = expr.args.map(renderExpr).join(', ');
  const partition =
    expr.partitionBy && expr.partitionBy.length > 0
      ? `PARTITION BY ${expr.partitionBy.map(renderExpr).join(', ')}`
      : '';
  const order =
    expr.orderBy && expr.orderBy.length > 0
      ? `ORDER BY ${expr.orderBy.map((o) => `${renderExpr(o.expr)} ${o.dir.toUpperCase()}`).join(', ')}`
      : '';
  const over = [partition, order].filter((s) => s.length > 0).join(' ');
  return `${fn}(${args}) OVER (${over})`;
}
```

If your switch builds an `isAtomicExpressionKind` predicate or anything similar (used to decide whether the rendered expression needs surrounding parentheses), treat `'window-func'` as atomic — `fn() OVER (…)` is self-delimited by its own parentheses.

No automated codemod — the body of the new arm depends on what the switch does. TypeScript pinpoints every site at compile time.

## `distinct-cols-now-collapses-by-specified-columns`

Starting at the 0.12 release, `.distinct(cols)` on the `@prisma-next/sql-orm-client` `Collection` API — at the top level (`db.Post.distinct('title')`), on leaf includes (`include('posts', p => p.distinct('title'))`), and on non-leaf includes (`include('posts', p => p.distinct('title').include('comments'))`) — keeps one representative row per `(cols)` group, matching Prisma's documented semantics.

Prior to 0.12, the lowering compiled to `SELECT DISTINCT <projected-cols>` — which dedupes on the full projected row. Once the projection included any unique column (typically `id` — and grandchild-include force-includes added it implicitly), the dedup never collapsed anything; `.distinct('title')` returned every row. The bug existed at all three call sites and was preserved as "status-quo behaviour" by an earlier spec decision, then fixed in the same PR that landed the non-leaf single-query lowering. See `projects/tml-2656-distinct-on-non-leaf-include/spec.md` § D3 in the source tree.

### No code change for consumer call sites

```ts
// Both 0.11 and 0.12 — same call site, different runtime behaviour:
const posts = await db.Post
  .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
  .distinct('title')
  .all();

// 0.11: returns every post (if seed has 3 posts including two sharing title='A',
// you get 3 back).
// 0.12: returns one post per title (you get 2 back — title='A' picks the
// lower-id row per the orderBy; title='B' is unaffected).
```

The API surface is unchanged. Type-level signatures are unchanged. Only the SQL produced and the rows returned differ.

### Tests and fixtures that assert pre-0.12 output

Any extension test that exercises `.distinct(cols)` and asserts the result set will fail under 0.12. Updates needed:

- **Seed data with duplicates** on every column passed to `.distinct(...)` so the test actually exercises dedup (a test with no duplicates is a no-op assertion in either era).
- **Pair `.distinct(...)` with an `.orderBy(...)`** that fully orders rows within each partition (e.g. `[distinctCol.asc(), id.asc()]`) so the picked representative is deterministic. When the orderBy doesn't fully order a partition the choice is implementation-defined — matches Prisma's behaviour, but makes assertions flaky.
- **Update `expect(rows).toEqual([…])` shapes** to match the post-collapse output. The dropped row's grandchildren (where `.distinct(cols).include(grandchild)` is in play) do not appear in the output either.

### Representative-selection behaviour

The user's `.orderBy(…)` drives the OVER ORDER BY of the underlying `ROW_NUMBER()` — the row with rank 1 in each partition wins. When the orderBy doesn't fully order rows within a partition, the choice between tied rows is implementation-defined (Postgres and SQLite are each entitled to pick any row in the tie). This matches Prisma's documented behaviour; if your extension needs deterministic picks across partition ties, add a primary-key tiebreaker to the orderBy.

### Validation

After updating fixture / test data, run your extension's standard `pnpm test` (or `pnpm test:integration` for tests that exercise live SQL). No type-level changes — TypeScript will not pinpoint sites; runtime assertions are the signal.

## Validation by execution

These entries are prose-only (no codemod scripts). The substrate diff inside `packages/3-extensions/sql-orm-client/` in this transition is the same code translation downstream extension authors will replicate by hand:

- The `windowFunc` method literally added to `bindWhereExprNode`'s `ExprVisitor` literal in `where-binding.ts`.
- The `windowFunc: rejectHavingExpr` literally added to `validateGroupedHavingExpr`'s `ExprVisitor` literal in `query-plan-aggregate.ts`.
- The `case 'window-func':` arms in the Postgres and SQLite adapter renderers.
- Flipped fixture row counts in the distinct integration tests.

There is no scriptable transform — the right body for the `ExprVisitor` method and the right arm for the exhaustive switch depend on what the consumer's visitor / switch does. The release-pipeline gate (`pnpm check:upgrade-coverage`) is satisfied by this directory existing with at least one entry; the substantive verification of the consumer-facing translation lives in the published extension-upgrade skill's per-step bump-install-instructions-validate-commit loop, which runs in extension authors' own CI.
