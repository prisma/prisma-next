# Transform Kysely AST → Prisma Next SQL AST (QueryAst) for plugin inspection

Date: 2026-02-15  
Status: Draft

## Summary

The Kysely query lane currently executes compiled SQL but produces plans with **no Prisma Next SQL AST** attached (`plan.ast` is `undefined`) and no structured refs/param descriptors. As a result, runtime plugins cannot inspect query structure (e.g. “DELETE without WHERE”).

This spec adds a **Kysely → PN SQL AST transformer** that converts Kysely’s `compiledQuery.query` into Prisma Next’s SQL-family AST (`QueryAst`), attaches it as `plan.ast`, and populates `plan.meta` with **resolved refs**, **projection typing hints**, and **param descriptors**. Where the current PN SQL AST is too rudimentary, we expand it in a lane-neutral way (no Kysely-shaped nodes in PN).

Acceptance scope is defined by the demo app: recreate all query examples under `examples/prisma-next-demo/src/queries` as Kysely equivalents under `examples/prisma-next-demo/src/kysely`.

To prove the end-to-end concept, this spec also reimplements the lint plugin to actually lint based on `plan.ast` and migrates that plugin into a SQL-owned location (so SQL-aware plugins aren’t sourced from the framework domain).

## Background

### Current plan model and plugin surfaces

- Runtime plugins receive an `ExecutionPlan` (`sql`, `params`, optional `ast`, and `meta`).
- SQL lanes (DSL/ORM) attach a PN SQL AST as `plan.ast` (`QueryAst`) and populate `meta.refs`, `meta.projection`, `meta.projectionTypes`, and `meta.paramDescriptors`.
- The SQL runtime uses `meta.annotations.codecs` / `meta.projectionTypes` to decode result rows and `meta.paramDescriptors` to encode params.

Kysely integration (`packages/3-extensions/integration-kysely/src/connection.ts`) currently creates an `ExecutionPlan` with:

- `ast: undefined`
- `meta.lane: 'raw'`
- `meta.paramDescriptors: []`

…even though Kysely exposes a structured AST (`compiledQuery.query`) and parameter values (`compiledQuery.parameters`).

### Why “Kysely AST inside the plan” is not enough

We explicitly do not want plugins to depend on Kysely node shapes or semantics. Plans must carry a **Prisma Next-native AST** so:

- plugins are lane-agnostic (Kysely/DSL/ORM)
- guardrails and budgets can share heuristics reliably
- future lanes can reuse the same inspection surfaces

## Goals

- Transform Kysely `compiledQuery.query` into a PN SQL AST (`QueryAst`) and attach it as `plan.ast`.
- Populate plan metadata (`PlanMeta`) with:
  - `lane: 'kysely'`
  - `refs.tables` / `refs.columns` (resolved + contract-validated)
  - `projection` + `projectionTypes` + `annotations.codecs` sufficient for runtime decoding
  - `paramDescriptors` sufficient for runtime encoding and plugin inspection
- Expand PN SQL AST (lane-neutral) to represent constructs required by demo scope.
- Enforce robustness: unsupported constructs throw (forcing function).
- Reimplement linting as an AST-first plugin and use it to prove Kysely lane compatibility with Prisma Next plugin analysis and PN SQL lowering.
- Migrate the lint plugin into a SQL-owned location and export it from a SQL surface.

## Non-goals

- Encoding Kysely-specific node kinds into PN SQL AST.
- Implementing or finalizing a production lint ruleset beyond what’s needed to prove AST-based inspection.

## Design

### High-level architecture

```mermaid
flowchart LR
  App[Kysely query builder] -->|compile()| KyselyCompiled[compiledQuery: { sql, parameters, query }]
  KyselyCompiled -->|transform| PNAST[PN SQL AST: QueryAst]
  KyselyCompiled -->|meta build| Meta[PlanMeta: refs/projection/types/params]
  PNAST --> Plan[ExecutionPlan.ast]
  Meta --> Plan[ExecutionPlan.meta]
  Plan --> Runtime[SQL runtime]
  Runtime --> Plugins[Runtime plugins]
```

### Where the PN AST lives

Attach the PN SQL AST at **`ExecutionPlan.ast`** (type `QueryAst`). This matches existing SQL lanes and is what budgets/lints/plugins can consume without knowing lane specifics.

### Lane identity

Set `plan.meta.lane = 'kysely'` for observability and debugging. Plugins must remain lane-agnostic by keying off `plan.ast` and `plan.meta.*` rather than `lane`.

### “Normalization” policy for identifiers

For inspection and codec resolution, we store **canonical identifiers** aligned with the contract:

- `TableRef.name` and `ColumnRef.table/column` are contract keys (e.g. `user`, `createdAt`)
- quoting/casing/schema-qualification from SQL generation is not preserved in the PN AST

This keeps refs stable across lanes and across SQL formatting differences.

### Preventing ambiguous queries (refs must be PN-native)

We expect the Kysely lane to provide **PN-native refs** (`plan.meta.refs` as canonical `{ table, column }` pairs), not best-effort strings.

To make that possible, the lane must **prevent** users from constructing ambiguous queries (for example, unqualified column refs when multiple tables are in scope). Guardrails should fail early with actionable errors. If ambiguity still reaches the transformer, we throw (forcing function).

## Detailed design

### 1) Kysely → PN SQL AST transformation

We add a pure transformer (SQL-domain-owned) that:

- takes:
  - `contract` (for resolving tables/columns/codecs)
  - `compiledQuery.query` (Kysely AST)
  - `compiledQuery.parameters` (positional values)
- returns:
  - `ast: QueryAst`
  - `meta additions` (refs, projection, projectionTypes/codecs, paramDescriptors)

**Unsupported constructs** throw with a stable “NOT_IMPLEMENTED” error class (or a runtime error code) and include:

- the encountered Kysely node kind
- a small “path” to help locate it
- the query lane (`kysely`)

### 2) Parameter indexing and mapping

Prisma Next’s SQL AST uses `ParamRef.index` that aligns with SQL placeholders (\($1\), \($2\), …). Existing DSL code uses 1-based indices (via `values.push`).

For Kysely, we construct PN `ParamRef` indices to match:

- `plan.params = compiledQuery.parameters` (0-based JS array)
- `ParamRef.index` = **1-based** position into that array

Mapping rule: every time we encounter a Kysely AST value that Kysely parameterizes, we allocate the next parameter index.

Implementation note: Kysely’s `compiledQuery.query` contains literal `ValueNode(value: ...)` but the compiler decides parameterization. For the subset we support, the Kysely compiler parameterization order matches a deterministic traversal order (observed in local dumps). We implement node-specific visitors (not generic object iteration) to ensure stable ordering.

### 3) Plan metadata parity (refs, projection typing, codecs)

We must produce the metadata needed by the SQL runtime:

#### 3.1 `meta.refs`

Build `meta.refs.tables` / `meta.refs.columns` from the PN AST (or during transform) and validate against `contract.storage.tables`.

This is required for:

- plugin heuristics (budget estimation, future lints)
- “resolved refs” requirement (no best-effort strings)

**Ambiguity policy**:

- Prefer preventing ambiguity in the Kysely lane (guardrails) over “resolving” heuristically.
- If a ref cannot be deterministically resolved to a single contract `{ table, column }`, throw.

#### 3.2 `meta.projection`, `meta.projectionTypes`, `meta.annotations.codecs`

Runtime decoding (`packages/2-sql/5-runtime/src/codecs/decoding.ts`) resolves per-alias codecs from:

1. `meta.annotations.codecs[alias]` (preferred)
2. `meta.projectionTypes[alias]`

For Kysely queries, we therefore build:

- `meta.projection`: alias → `table.column` (or `operation:*` if/when we support expression selections)
- `meta.projectionTypes`: alias → `codecId` derived from contract column metadata
- `meta.annotations.codecs`: alias → `codecId` (optionally redundant but mirrors DSL patterns)

#### 3.3 `meta.paramDescriptors`

For each positional parameter, emit a `ParamDescriptor`:

- `index`: 1-based
- `source`: update to allow lane-produced structured params (see “AST & meta model changes”)
- `refs` when the param is used in a predicate against a known `ColumnRef`
- `codecId/nativeType/nullable` derived from the referenced column’s storage metadata (when refs exist)

This is required for runtime param encoding (and for future plugin rules like “unindexed predicate”).

### 4) PN SQL AST expansions (lane-neutral)

The current SQL AST is minimal and does not represent several constructs present in Kysely compilation and demo needs (e.g. `like`, `in`, boolean composition).

We expand the AST in a Prisma Next-native way (no Kysely node mirrors). Minimum expected additions:

- **Boolean composition**: `AND` / `OR` of `WhereExpr`s
- **More predicate ops**: add at least `like` and `in`
- **List values**: represent `IN (...)` lists
- **`select *` representation**: either
  - represent `selectAll` explicitly, or
  - normalize by expanding to explicit column refs using contract columns (preferred for stable refs/projection typing)
- **Join ON expressiveness**: allow ON clauses to reuse where-expression structure (not just `eqCol`)

These expansions require updating:

- SQL lowering in adapters (e.g. Postgres adapter) to handle new node kinds/operators
- existing lane builders/tests if they share types (they will)

### 4.1 AST needs to represent “missing WHERE” for mutations

To support a meaningful lint like “DELETE without WHERE” or “UPDATE without WHERE”, the PN SQL AST must be able to represent that absence.

Today:

- `DeleteAst.where` is required
- `UpdateAst.where` is required

Change (lane-neutral, enables linting + Kysely parity):

- make `DeleteAst.where?: WhereExpr`
- make `UpdateAst.where?: WhereExpr`

DSL/ORM builders can continue to enforce “WHERE required” at the builder layer, but the AST must allow representing “no where clause” when authoring surfaces (or raw queries) permit it.

### 5) Compatibility surface (observed Kysely node kinds)

From local compilation of representative Kysely queries, the following Kysely node kinds appear:

`SelectQueryNode`, `WhereNode`, `BinaryOperationNode`, `OperatorNode`, `ValueNode`, `PrimitiveValueListNode`, `JoinNode`, `OnNode`, `OrderByNode`, `LimitNode`, `InsertQueryNode`, `ValuesNode`, `UpdateQueryNode`, `ColumnUpdateNode`, `DeleteQueryNode`, `ReturningNode`, plus identifier/selection wrapper nodes.

See `agent-os/specs/2026-02-15-transform-kysely-ast-to-pn-ast/supporting-reference.md` for the full union list and a representative `compiledQuery.query` dump.

## AST & meta model changes

### 1) `ParamDescriptor.source` needs a lane-neutral expansion

Today it is `source: 'dsl' | 'raw'`. Kysely is neither, and overloading `'raw'` defeats intent.

Change proposal (lane-neutral):

- Extend to: `source: 'dsl' | 'raw' | 'lane'`
- Interpret actual lane via `plan.meta.lane` (already present)

This avoids baking `kysely` into the shared contract types while still marking “structured param from a lane”.

### 2) SQL AST expansions (operators + boolean composition + IN lists)

Add new AST node types / unions under `@prisma-next/sql-relational-core/ast` to represent:

- `and/or` where composition
- `like`, `in` ops (and any additional ops required by demo parity)
- list operands for `IN`

## Example parity plan

Add Kysely equivalents for demo queries under `examples/prisma-next-demo/src/kysely/` and ensure:

- each query executes successfully using the demo runtime wiring
- plans built via Kysely carry `plan.ast` and `plan.meta.refs/paramDescriptors/projectionTypes`
- plugins (budgets, future lints) can operate based on AST/refs rather than raw SQL parsing

Additionally, include one or more “guardrail proving” queries in the Kysely demo set that intentionally violate lints (e.g. DELETE without WHERE) to verify AST-based plugin enforcement blocks execution.

## Lint plugin: AST-first inspection + migration

### Why

The current POC lint plugin (`packages/1-framework/4-runtime-executor/src/plugins/lints.ts`) only lints when `plan.ast` is missing (it returns early when AST exists) and relies on raw SQL heuristics. That does not validate the intended architecture.

### Desired behavior

Implement an AST-first lints plugin that:

- if `plan.ast` is a SQL `QueryAst`, performs structural linting on the AST
- if `plan.ast` is missing, may optionally fall back to raw guardrails (heuristic), but AST-bearing plans are the primary target

Minimum lint rules (to prove the concept):

- **DELETE without WHERE**: block execution when `ast.kind === 'delete'` and `ast.where` is missing
- **UPDATE without WHERE**: block execution when `ast.kind === 'update'` and `ast.where` is missing
- **Unbounded SELECT**: warn/error when `ast.kind === 'select'` and `ast.limit` is missing (severity configurable)
- **SELECT \***: warn/error when query intent was “select all columns”
  - if we normalize `.selectAll()` by expanding to explicit columns, preserve a signal for “selectAll intent” via AST or `meta.annotations`

### Migration target

Move the lint plugin into a SQL-owned location, proposed:

- `packages/2-sql/5-runtime/src/plugins/lints.ts` (and export from `packages/2-sql/5-runtime/src/exports/index.ts`)

This keeps SQL-aware plugin logic in the SQL domain while still using the family-agnostic plugin interface from `@prisma-next/runtime-executor`.

## Testing plan

- **Unit tests (SQL domain)**:
  - transformer produces the expected `QueryAst` for representative Kysely AST inputs (select/where/like/in/join/limit + insert/update/delete + returning)
  - parameter indexing matches `compiledQuery.parameters` order
  - `meta.refs` is resolved and validated against a fixture contract
  - `meta.projectionTypes` and `annotations.codecs` are present and correct for selectAll/returningAll
  - unsupported node kinds throw with stable error shape
  - AST-first lint plugin:
    - blocks delete/update without where
    - flags missing select limit
    - flags selectAll intent
- **Integration**:
  - extend `test/integration/test/kysely.test.ts` to assert `plan.ast` presence (by instrumenting the Kysely dialect/connection) and ensure plugins can observe AST-bearing plans
  - run Kysely integration tests with AST-first lints plugin enabled and assert expected failures for unsafe queries
- **Demo**:
  - add/execute Kysely equivalents under `examples/prisma-next-demo/src/kysely`

## Risks and mitigations

- **Parameter ordering mismatch**: mitigate by implementing explicit node visitors matching Kysely compiler structure; cover with tests.
- **AST expansions require lowering changes**: treat as part of the spec; add tests around adapter lowering for new node kinds.
- **`selectAll` expansion needs contract access**: transformer receives contract; expansion uses contract table columns deterministically (sorted keys).
- **Ambiguous refs in multi-table scope**: mitigate by Kysely-lane guardrails that reject unqualified refs / ambiguous `selectAll` before execution; transformer still throws if ambiguity slips through.

## Documentation updates

- Keep `agent-os/specs/2026-02-15-transform-kysely-ast-to-pn-ast/supporting-reference.md` as the evolving compatibility/implementation reference.
- If/when we change shared types (`ParamDescriptor.source`), update any relevant architecture docs and package READMEs that describe plan metadata expectations.

