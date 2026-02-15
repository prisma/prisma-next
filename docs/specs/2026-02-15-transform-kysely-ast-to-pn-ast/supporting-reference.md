# Supporting reference material

This document collates current (as-is) plan/AST structures, how they’re attached, what runtime plugins receive, and the initial Kysely AST → PN SQL AST compatibility picture.

## 1) Current structure of PN query plans

### 1.1 Canonical runtime plan shape (`ExecutionPlan`)

All runtimes/plugins receive an `ExecutionPlan<Row, Ast>`:

- **`sql`**: executable SQL string
- **`params`**: positional parameter values (already encoded before hitting the driver)
- **`ast?`**: optional *family-specific* AST (SQL uses `QueryAst`)
- **`meta`**: lane + refs + paramDescriptors + projection typing hints

Source: `packages/1-framework/1-core/shared/contract/src/types.ts` (`ExecutionPlan`, `PlanMeta`, `ParamDescriptor`).

### 1.2 SQL lane pre-lowering plan shape (`SqlQueryPlan`)

SQL lanes (DSL/ORM) can return a “pre-lowering” plan that omits `sql` but includes:

- **`ast: QueryAst`** (SQL family AST)
- **`params`**
- **`meta`**

This is lowered in the SQL runtime to an executable `ExecutionPlan` while preserving the same `ast`.

Source: `packages/2-sql/4-lanes/relational-core/src/plan.ts` (`SqlQueryPlan`) and `packages/2-sql/5-runtime/src/lower-sql-plan.ts` (`lowerSqlPlan`).

## 2) How the PN AST is attached to plans today

### 2.1 SQL lanes attach PN AST as `plan.ast`

- DSL/ORM builders construct a `QueryAst` value and return it as `SqlQueryPlan.ast`.
- Runtime lowering (`lowerSqlPlan`) returns `ExecutionPlan` that includes `ast: queryPlan.ast` unchanged.

### 2.2 Kysely integration currently does **not** attach PN AST

`packages/3-extensions/integration-kysely/src/connection.ts` currently constructs:

- `ast: undefined`
- `meta.lane: 'raw'`
- `meta.paramDescriptors: []`

even though Kysely provides `compiledQuery.query` (Kysely AST) and `compiledQuery.parameters`.

## 3) What runtime plugins normally receive

Plugins are called with the full `ExecutionPlan`:

- `beforeExecute(plan, ctx)`
- `onRow(row, plan, ctx)`
- `afterExecute(plan, result, ctx)`

Today’s POC plugins show intended consumption patterns:

- **Budgets plugin** uses:
  - `plan.ast.kind === 'select'` and `plan.ast.limit` for boundedness checks
  - `plan.meta.refs?.tables?.[0]` as a quick “primary table” heuristic
  - fallback to `EXPLAIN` if `plan.ast` is missing
- **Lints plugin (POC)** currently returns early when `plan.ast` exists and only lints “raw” SQL via heuristic parsing. This is why attaching PN AST is necessary but not sufficient: the plugin must later be updated to actually *use* AST.

> Note: you mentioned `lints.ts` living in framework is a known early mistake; it should move into the SQL domain. This doc is describing the current as-is state for reference.

## 4) PN SQL AST (current) and robustness gaps

The current PN SQL AST lives under `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` and is intentionally minimal.

Key points for transformation work:

- Query roots: `SelectAst | InsertAst | UpdateAst | DeleteAst`
- PN node kinds (non-exhaustive but current):
  - `TableRef`, `ColumnRef`, `ParamRef`, `LiteralExpr`
  - `OperationExpr`
  - `BinaryExpr`, `ExistsExpr`, `NullCheckExpr`
  - `JoinAst`, `IncludeAst`, `IncludeRef`
  - `SelectAst`, `InsertAst`, `UpdateAst`, `DeleteAst`
- Expressions:
  - `ColumnRef`, `ParamRef`, `LiteralExpr`
  - `OperationExpr` (method + forTypeId + lowering spec) for extension operations (e.g., pgvector)
- WHERE is currently limited:
  - `BinaryExpr` with ops only `eq/neq/gt/lt/gte/lte`
  - `ExistsExpr`
  - `NullCheckExpr`
- Joins:
  - Join ON is currently only `eqCol` (column = column)

Given the demo scope and Kysely compilation output (see below), the PN AST must expand to include at least:

- `and/or` boolean composition
- `like` and `in` (and likely `notIn`, `ilike`, etc. depending on demo queries)
- richer join `on` expressions (or reuse `WhereExpr`/`Expression` patterns)
- representing lists (`IN (...)`) without leaking authoring-library node shapes

## 5) Kysely AST nodes encountered (local compilation)

We compiled representative Kysely queries (select/insert/update/delete/join/like/in/limit/returning) and extracted the `compiledQuery.query.kind` union.

Found node kinds:

- `AliasNode`
- `BinaryOperationNode`
- `ColumnNode`
- `ColumnUpdateNode`
- `DeleteQueryNode`
- `FromNode`
- `IdentifierNode`
- `InsertQueryNode`
- `JoinNode`
- `LimitNode`
- `OnNode`
- `OperatorNode`
- `OrderByItemNode`
- `OrderByNode`
- `PrimitiveValueListNode`
- `ReferenceNode`
- `ReturningNode`
- `SchemableIdentifierNode`
- `SelectAllNode`
- `SelectQueryNode`
- `SelectionNode`
- `TableNode`
- `UpdateQueryNode`
- `ValueNode`
- `ValuesNode`
- `WhereNode`

Representative `compiledQuery.query` structure (simplified):

- `SelectQueryNode`
  - `from: FromNode(froms: [TableNode(...)]`
  - `selections: [SelectionNode(SelectAllNode)]`
  - `where: WhereNode(BinaryOperationNode(ReferenceNode(ColumnNode(id)) OperatorNode('='), ValueNode('user_123')))`
  - `limit: LimitNode(ValueNode(1))`

Full dump captured locally at: `wip/kysely-compiled-query-dump.txt` (not committed).

## 6) Compatibility table: Kysely AST ↔ PN SQL AST (initial)

Legend:

- ✅ representable in PN AST today
- 🟡 representable but requires PN AST expansion
- ❌ not representable / unclear mapping yet

### 6.1 Query roots

| Kysely node kind | Meaning | PN node | Status |
|---|---|---|---|
| `SelectQueryNode` | SELECT query root | `SelectAst` (`kind: 'select'`) | ✅ |
| `InsertQueryNode` | INSERT query root | `InsertAst` (`kind: 'insert'`) | ✅ |
| `UpdateQueryNode` | UPDATE query root | `UpdateAst` (`kind: 'update'`) | ✅ |
| `DeleteQueryNode` | DELETE query root | `DeleteAst` (`kind: 'delete'`) | ✅ |

### 6.2 FROM / tables / columns / aliases

| Kysely node kind | Meaning | PN node(s) | Status |
|---|---|---|---|
| `FromNode`, `TableNode` | FROM + table | `TableRef` | ✅ |
| `ReferenceNode` + `ColumnNode` | column reference | `ColumnRef` | ✅ |
| `AliasNode` | aliased selection | `project: [{ alias, expr }]` | ✅ |
| `IdentifierNode` / `SchemableIdentifierNode` | identifier structure | (not modeled directly) | ✅ (compile-time detail) |

### 6.3 Selections / projection

| Kysely node kind | Meaning | PN node(s) | Status |
|---|---|---|---|
| `SelectionNode` | one projection item | `project[]` entry | ✅ |
| `SelectAllNode` | `select *` | (no equivalent) | 🟡 |

Notes:

- PN `SelectAst.project` requires explicit aliases/expressions.
- For Kysely `.selectAll()` we likely need to **expand** `*` into explicit `ColumnRef`s by reading the contract’s table columns (to keep refs/projectionTypes meaningful).

### 6.4 WHERE / predicates

| Kysely node kind | Meaning | PN node(s) | Status |
|---|---|---|---|
| `WhereNode` | WHERE wrapper | `SelectAst.where` | ✅ |
| `BinaryOperationNode` | binary predicate | `BinaryExpr` | 🟡 |
| `OperatorNode` (`=`, `like`, `in`, …) | operator | `BinaryOp` union | 🟡 |
| `ValueNode` | literal value | `ParamRef` or `LiteralExpr` | 🟡 |
| `PrimitiveValueListNode` | list literal (e.g. `IN (...)`) | (no equivalent) | 🟡 |

Notes:

- PN `BinaryOp` currently does **not** include `like` or `in`.
- PN WHERE lacks `and/or` composition (demo scope almost certainly needs this).

### 6.5 JOINs

| Kysely node kind | Meaning | PN node(s) | Status |
|---|---|---|---|
| `JoinNode` | JOIN | `JoinAst` | ✅ |
| `OnNode` | ON wrapper | `JoinAst.on` | 🟡 |

Notes:

- PN join-on expression is currently only `eqCol`. Kysely can express richer ON predicates; demo scope likely only needs simple column equality at first, but we should evolve PN join-on to accept general boolean expressions.

### 6.6 ORDER BY / LIMIT

| Kysely node kind | Meaning | PN node(s) | Status |
|---|---|---|---|
| `OrderByNode`, `OrderByItemNode` | ORDER BY | `SelectAst.orderBy[]` | ✅ |
| `LimitNode` | LIMIT | `SelectAst.limit: number` | ✅ (if constant) / 🟡 (if param) |

Notes:

- Kysely’s AST stores literal limit values as `ValueNode(value: number)` even when SQL compilation parameterizes it. We can attach `limit` as a number in PN AST while still using `compiledQuery.parameters` for execution.

### 6.7 INSERT/UPDATE/DELETE details

| Kysely node kind | Meaning | PN node(s) | Status |
|---|---|---|---|
| `ValuesNode` | INSERT values | `InsertAst.values` | ✅ |
| `ColumnUpdateNode` | UPDATE column assignment | `UpdateAst.set` | ✅ |
| `ReturningNode` | RETURNING | `returning?: ColumnRef[]` | ✅ |

## 7) How refs and query params are encoded in PN SQL query plans (today)

### 7.1 Refs (`plan.meta.refs`)

SQL DSL/ORM build `meta.refs` by collecting:

- `refs.tables`: set of referenced tables
- `refs.columns`: list of referenced `{ table, column }` pairs

This is used by guardrails/plugins for heuristics like:

- estimating rows by “primary table”
- detecting unbounded selects
- (future) detecting unindexed predicates

Source: `packages/2-sql/4-lanes/sql-lane/src/sql/plan.ts` (`buildMeta`).

### 7.2 Params (`plan.params` + `meta.paramDescriptors`)

- **`plan.params`**: positional params (array), ultimately passed to driver
- **`meta.paramDescriptors`**: per-param metadata, used for:
  - identifying param source (`dsl` vs `raw`)
  - associating params with `(table, column)` refs when possible
  - attaching codec/nativeType/nullability info when available

In DSL, param descriptors are created during WHERE building when a `param('name')` placeholder is bound against a known column ref.

Source: `packages/2-sql/4-lanes/sql-lane/src/sql/predicate-builder.ts` and `packages/1-framework/1-core/shared/contract/src/types.ts` (`ParamDescriptor`).

## 8) What’s missing to utilize refs/params for Kysely queries

To make Kysely plans equivalent (from a plugin’s perspective), we need:

1. **Attach PN AST**: produce `QueryAst` and set `plan.ast`.
2. **Set lane**: `meta.lane = 'kysely'` (observability only).
3. **Resolved refs**: build `meta.refs.tables/columns` from the PN AST (or during transformation) and validate against the contract.
4. **Param descriptors**:
   - Kysely provides `compiledQuery.parameters` but not names.
   - We must map each `ValueNode`/list element to a `ParamRef(index)` in PN AST and emit a corresponding `ParamDescriptor`:
     - `source`: likely needs to evolve beyond `'dsl' | 'raw'` (Kysely is neither).
     - `refs`: attach `{ table, column }` when the param is used in a predicate against a column.
     - `codecId/nativeType/nullable`: derive from contract column metadata once refs are resolved.
5. **PN AST expansion**: support operators and boolean composition required by demo queries (`like`, `in`, `and/or`, richer joins, etc.).

## 9) Explaining “normalization” (what you asked in Q7)

“Normalization” here means: **do we store identifiers in a canonical form**, or preserve the authoring surface’s syntactic choices.

Examples:

- Preserving authoring syntax: `"User"` vs `"user"`, schema-qualified `public.user`, quoted identifiers, alias casing, etc.
- Canonicalizing for plugins: normalize to the **contract’s table/column names** (`table: 'user'`, `column: 'createdAt'`) regardless of quoting/casing in generated SQL.

For plugin inspection, canonical identifiers are typically more useful because:

- they match `contract.storage.tables[...]` keys
- they make refs stable across lanes and SQL formatting

This does **not** prevent us from also retaining raw SQL + (optionally) a debug-only copy of the original Kysely AST for troubleshooting; but plugins should primarily rely on canonical PN AST + resolved refs.

