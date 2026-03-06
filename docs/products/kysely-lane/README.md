## Kysely lane (build-only) — current capabilities and limitations

Last updated: 2026-03-02

This document describes what the **build-only Kysely lane** (`@prisma-next/sql-kysely-lane`) can do today, and the limitations / known footguns we’re actively working through.

## What you can do today (supported subset)

### Build plans for simple queries

You can author supported Kysely queries and build a Prisma Next `SqlQueryPlan<Row>` that carries PN SQL AST and lane metadata (`refs`, `paramDescriptors`, projections).

Supported root query kinds:

- `SelectQueryNode`
- `InsertQueryNode`
- `UpdateQueryNode`
- `DeleteQueryNode`

### SELECT (safe patterns)

- **Single `FROM`** queries.
- `selectAll()` in single-table scope.
- Selecting **column references** (including aliased refs).
- `where()` with:
  - `AND` / `OR` / parentheses, and
  - binary comparisons where the **left operand is a column reference**.
- Supported operators:
  - `=`, `==`
  - `!=`, `<>`
  - `>`, `<`, `>=`, `<=`
  - `like`, `ilike`
  - `in`, `not in` (and `notin`)
- `orderBy()` on column refs with `asc` / `desc`.
- `limit(<number>)` when the limit resolves to a number.

### JOIN (safe patterns)

- Inner/left/right/full joins that compile to a supported join kind string.
- Join `ON` clauses that fit the same “where expression” subset (binary ops, column-ref left operands).

### DML (safe patterns)

- Single-row `insertInto(...).values(...)` **with parameterized values**.
- `updateTable(...).set(...)` **with parameterized values**.
- `deleteFrom(...).where(...)` within the supported where subset.
- `returning(...)` limited to column refs and `selectAll` expansions.

### `whereExpr(...)` (interop with ORM `where(...)`)

`db.kysely.whereExpr(query)` produces a `ToWhereExpr` payload for ORM interop.

Safe pattern: a `SELECT` query with a supported `where` clause where the rest of the query is also in the supported subset.

## Limitations and known footguns

### Scope and non-goals

- **Build-only**: `db.kysely` is an authoring surface. It does not execute queries. Attempting to acquire a connection / transaction via the lane-owned dialect throws by design.
- **Postgres-coupled (for now)**: the lane is currently Postgres-coupled; treat emitted plans and where-expr payloads as having Postgres semantics.
- **AST-first**: supported Kysely queries must be representable as PN SQL `QueryAst`. Unsupported or ambiguous shapes fail fast rather than “best-effort” compilation.

### Supported root query kinds (hard boundary)

Only these Kysely root node kinds are transformable:

- `SelectQueryNode`
- `InsertQueryNode`
- `UpdateQueryNode`
- `DeleteQueryNode`

Anything else (e.g. CTEs/`WITH`, unions, many “raw-ish” constructs) fails with `KYSELY_TRANSFORM_UNSUPPORTED_NODE`.

### Multi-table ambiguity and guardrails (what fails fast)

Even for otherwise-supported node kinds, the lane refuses to emit a plan when it can’t produce *deterministic* refs:

- **Unqualified column refs in multi-table scope** (joins or multiple FROM entries) fail with `KYSELY_TRANSFORM_UNQUALIFIED_REF_IN_MULTI_TABLE`.
- **Ambiguous `selectAll()` in multi-table scope** fails with `KYSELY_TRANSFORM_AMBIGUOUS_SELECT_ALL`.

Important nuance:

- Guardrails are **select-only** today (they run only when the root is a `SelectQueryNode`).

### SELECT limitations (common)

#### Multiple FROM entries are not safely supported

Kysely can represent multiple `FROM` entries (`froms.length > 1`). Today:

- The guardrails treat multi-FROM as “multi-table scope” (so you’ll get stricter qualification requirements).
- The transformer only uses the **first** FROM entry as the plan’s `from` table.

Net effect: multi-FROM queries are currently a **correctness footgun** (they may partially transform but not represent the actual query).

#### OFFSET is not supported

There is no `offset` handling in the transformer. Queries that include offset either:

- won’t compile into a meaningful `QueryAst` (depending on Kysely’s node shape), or
- will compile but **drop** the offset semantics at the PN AST level.

#### LIMIT is only represented when it resolves to a number

`limit(10)` becomes `ast.limit = 10`.

If the limit is non-numeric at transform time, the lane may collect a parameter/descriptor for it, but `ast.limit` becomes `undefined`, meaning the plan no longer reflects the author’s intended limit.

#### Projection is intentionally narrow

Selections are expected to resolve to **column refs** (and `selectAll` expansions). Many Kysely projection features are not supported yet, including computed expressions and arbitrary SQL fragments, because the transformer validates refs against `contract.storage.tables.*`.

### WHERE / expression limitations

#### Binary comparisons are limited to “column ref on the left”

Supported WHERE shapes are primarily:

- `AND` / `OR` / parenthesized forms, and
- binary operations where the **left operand is a column reference**.

Expressions like `(u.age + 1) > 10`, function calls, or computed left operands are not supported.

#### Supported operators are a small fixed set

Operator mapping is limited to:

- `=`, `==`
- `!=`, `<>`
- `>`, `<`, `>=`, `<=`
- `like`, `ilike`
- `in`, `not in` (and `notin`)

Other operators and Kysely expression helpers are not represented.

#### Value handling differs between compiled and compile-free paths

The transformer can run in two modes:

- **compiled**: `transformKyselyToPnAst(contract, query, compiled.parameters)`
- **compile-free**: `transformKyselyToPnAstCollectingParams(contract, opNode)`

In compile-free mode the lane collects params during traversal. In compiled mode it attempts to match some nodes by identity against `compiled.parameters` and otherwise treats them as literals.

This means the exact “param vs literal” behavior can vary depending on which entrypoint is used and how Kysely structures the node tree.

### JOIN limitations

- Join `ON` conditions are transformed using the same WHERE/expression limitations above.
- Join types are mapped from a fixed set of Kysely join kind strings. Unknown join kinds fail with `KYSELY_TRANSFORM_UNSUPPORTED_NODE`.
- Joins that don’t have a usable `ON` clause are not representable (the lane requires `ON` for the join AST it emits).

### DML limitations (INSERT/UPDATE/DELETE)

#### INSERT

- **Multi-row INSERT is not supported** (fails fast).
- INSERT requires a **column list** for values transformation.
- **Only parameterized VALUES are supported**. If the transformer sees a literal (immediate value) where a param is expected, it throws.
- `returning` is limited to column refs and `selectAll` expansions; expression returning is not supported.

#### UPDATE

- `set(...)` values must be parameterized (same “param-only” restriction as insert).
- `where` has the same expression limitations as SELECT.
- `returning` has the same restrictions as INSERT.

#### DELETE

- `where` has the same expression limitations as SELECT.
- `returning` has the same restrictions as INSERT.

### `whereExpr(...)` / `ToWhereExpr` interop limitations

`db.kysely.whereExpr(query)` produces a `ToWhereExpr` payload for ORM interop, but there are important constraints:

- It requires a **SELECT query with a WHERE clause**.
- It builds a full plan first, then extracts/remaps the WHERE. So if the query includes unsupported non-WHERE elements (projection features, joins, limit/offset shape, etc.), `whereExpr(...)` will still fail.
- It remaps parameter indexes to “dense” indexes and will throw if any `ParamRef.index` is missing a param value or descriptor.

The biggest product limitation: `ToWhereExpr` is currently a lossy interface (unsupported query elements are not prevented by the type system and may be dropped / not representable).

### Contract coupling and identifier constraints

- Table/column resolution is validated against `contract.storage.tables`.
- Column refs must be resolvable to a concrete `table` + `column`. The lane does not currently have a representation for:
  - computed “virtual columns”
  - ad-hoc identifiers outside the contract
  - arbitrary schema-qualified naming (beyond what the AST helpers recognize)

### Version and node-shape sensitivity

The lane intentionally depends on Kysely AST node shapes. Some transforms include compatibility branches for observed compiled shapes, but new Kysely versions may change node structures. When that happens, the lane typically fails fast with `KYSELY_TRANSFORM_UNSUPPORTED_NODE` until support is added.

### Error behavior (what to expect)

The lane prefers “loud” failure over silent degradation:

- Unsupported node kinds → `KYSELY_TRANSFORM_UNSUPPORTED_NODE`
- Invalid refs (unknown table/column, missing FROM, etc.) → `KYSELY_TRANSFORM_INVALID_REF`
- Multi-table ambiguity → `KYSELY_TRANSFORM_UNQUALIFIED_REF_IN_MULTI_TABLE` / `KYSELY_TRANSFORM_AMBIGUOUS_SELECT_ALL`
- Parameter collection/descriptor mismatches (especially on compile-free paths) → `KYSELY_TRANSFORM_PARAMETER_MISMATCH`

### Practical guidance (what to do today)

- Prefer **simple, single-FROM SELECTs** with explicit table qualification once joins are introduced.
- Avoid multi-FROM queries entirely (treat them as unsupported until the transformer explicitly handles them).
- Avoid computed expressions in SELECT/WHERE; stick to column refs + supported binary ops.
- Treat OFFSET as unsupported.
- For DML, assume **param-only** values; don’t rely on literals or multi-row insert support.

