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

### 2.2 Kysely integration attaches PN AST (as of transform spec implementation)

`packages/3-extensions/integration-kysely/src/connection.ts` now:

- Calls `transformKyselyToPnAst(contract, compiledQuery.query, compiledQuery.parameters)` to produce PN `QueryAst` and meta
- Sets `ast` to the transformed `QueryAst` for `SelectQueryNode`, `InsertQueryNode`, `UpdateQueryNode`, `DeleteQueryNode`
- Sets `meta.lane = 'kysely'` for transformed plans
- Populates `meta.paramDescriptors`, `meta.refs`, `meta.projection`, `meta.projectionTypes` from transformer output
- Runs `runGuardrails()` before transformation to reject unqualified refs and ambiguous `selectAll` in multi-table scope
- Falls back to `ast: undefined`, `meta.lane: 'raw'`, `meta.paramDescriptors: []` for non-transformable query kinds

## 3) What runtime plugins normally receive

Plugins are called with the full `ExecutionPlan`:

- `beforeExecute(plan, ctx)`
- `onRow(row, plan, ctx)`
- `afterExecute(plan, result, ctx)`

Plugins consume plans as follows:

- **Budgets plugin** uses:
  - `plan.ast.kind === 'select'` and `plan.ast.limit` for boundedness checks
  - `plan.meta.refs?.tables?.[0]` as a quick "primary table" heuristic
  - fallback to `EXPLAIN` if `plan.ast` is missing
- **Lints plugin** (canonical in SQL domain: `packages/2-sql/5-runtime/src/plugins/lints.ts`) inspects `plan.ast` when present:
  - DELETE without WHERE — blocks execution
  - UPDATE without WHERE — blocks execution
  - Unbounded SELECT — warns/errors when `limit` is missing
  - SELECT * intent — warns/errors when `selectAllIntent` is present
  - When `plan.ast` is missing, falls back to raw heuristic guardrails or skips linting (configurable via `fallbackWhenAstMissing`)

The lints plugin is exported from `@prisma-next/sql-runtime`; framework `runtime-executor` no longer provides it.

## 4) PN SQL AST (current state after transform spec implementation)

The PN SQL AST lives under `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`.

Key types for transformation:

- Query roots: `SelectAst | InsertAst | UpdateAst | DeleteAst`
- PN node kinds:
  - `TableRef`, `ColumnRef`, `ParamRef`, `LiteralExpr`
  - `OperationExpr`
  - `BinaryExpr`, `ExistsExpr`, `NullCheckExpr`
  - `AndExpr`, `OrExpr` — boolean composition for WHERE/ON
  - `ListLiteralExpr` — for `IN (...)` operands
  - `JoinAst`, `IncludeAst`, `IncludeRef`
  - `SelectAst`, `InsertAst`, `UpdateAst`, `DeleteAst`
- Expressions:
  - `ColumnRef`, `ParamRef`, `LiteralExpr`
  - `OperationExpr` (method + forTypeId + lowering spec) for extension operations (e.g., pgvector)
- WHERE and predicate operators:
  - `BinaryExpr` with `BinaryOp`: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `like`, `ilike`, `in`, `notIn`
  - `ExistsExpr`, `NullCheckExpr`
  - `AndExpr`, `OrExpr` for compound predicates
- Joins:
  - `JoinOnExpr` is `eqCol` (column = column) or any `WhereExpr` (richer ON predicates)
- Select all intent:
  - `SelectAst.selectAllIntent?: { table?: string }` preserved when normalizing `selectAll()` to explicit columns
- Mutations:
  - `DeleteAst.where` and `UpdateAst.where` are optional (`WhereExpr | undefined`) to support lints that block mutation without WHERE

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
| `SelectAllNode` | `select *` | Expanded columns + `selectAllIntent` | ✅ |

Notes:

- PN `SelectAst.project` requires explicit aliases/expressions.
- For Kysely `.selectAll()` we likely need to **expand** `*` into explicit `ColumnRef`s by reading the contract’s table columns (to keep refs/projectionTypes meaningful).

### 6.4 WHERE / predicates

| Kysely node kind | Meaning | PN node(s) | Status |
|---|---|---|---|
| `WhereNode` | WHERE wrapper | `SelectAst.where` | ✅ |
| `BinaryOperationNode` | binary predicate | `BinaryExpr` | ✅ |
| `OperatorNode` (`=`, `like`, `in`, …) | operator | `BinaryOp` union | ✅ |
| `ValueNode` | literal value | `ParamRef` or `LiteralExpr` | ✅ |
| `PrimitiveValueListNode` | list literal (e.g. `IN (...)`) | `ListLiteralExpr` | ✅ |

Notes:

- PN `BinaryOp` includes `like`, `ilike`, `in`, `notIn`. `AndExpr`/`OrExpr` provide boolean composition.

### 6.5 JOINs

| Kysely node kind | Meaning | PN node(s) | Status |
|---|---|---|---|
| `JoinNode` | JOIN | `JoinAst` | ✅ |
| `OnNode` | ON wrapper | `JoinAst.on` (WhereExpr) | ✅ |

Notes:

- PN `JoinOnExpr` accepts `eqCol` or any `WhereExpr` for richer ON predicates.

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

## 8) Kysely plan parity (implemented)

Kysely plans are now equivalent to DSL/ORM plans from a plugin's perspective:

1. **Attach PN AST** — transformer produces `QueryAst` and sets `plan.ast`.
2. **Set lane** — `meta.lane = 'kysely'` for transformed plans.
3. **Resolved refs** — transformer builds `meta.refs.tables/columns` and validates against the contract.
4. **Param descriptors** — transformer maps `ValueNode`/list elements to `ParamRef(index)` and emits `ParamDescriptor` with `source: 'lane'`, `refs` when resolvable, and `codecId`/`nativeType`/`nullable` from contract.
5. **PN AST expansion** — implemented: `AndExpr`/`OrExpr`, `like`/`ilike`/`in`/`notIn`, `ListLiteralExpr`, richer `JoinOnExpr`, `selectAllIntent`, optional `DeleteAst.where`/`UpdateAst.where`.

## 9) Explaining “normalization” (what you asked in Q7)

“Normalization” here means: **do we store identifiers in a canonical form**, or preserve the authoring surface’s syntactic choices.

Examples:

- Preserving authoring syntax: `"User"` vs `"user"`, schema-qualified `public.user`, quoted identifiers, alias casing, etc.
- Canonicalizing for plugins: normalize to the **contract’s table/column names** (`table: 'user'`, `column: 'createdAt'`) regardless of quoting/casing in generated SQL.

For plugin inspection, canonical identifiers are typically more useful because:

- they match `contract.storage.tables[...]` keys
- they make refs stable across lanes and SQL formatting

This does **not** prevent us from also retaining raw SQL + (optionally) a debug-only copy of the original Kysely AST for troubleshooting; but plugins should primarily rely on canonical PN AST + resolved refs.

