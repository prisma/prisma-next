# Task Breakdown: Kysely AST → PN QueryAst Transform

**Spec**: [spec.md](./spec.md)  
**Requirements**: [planning/requirements.md](./planning/requirements.md)  
**Date**: 2026-02-15

This document breaks the spec into ordered phases with actionable tasks. Execute sequentially; later phases depend on earlier ones.

---

## Phase 1: PN AST expansion (foundation)

Expand the PN SQL AST in a lane-neutral way to support the demo scope. These changes are prerequisites for the transformer and lint plugin.

### 1.1 Boolean composition (AND/OR)

- [ ] Add `AndExpr` and `OrExpr` node kinds to `WhereExpr` in `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`
- [ ] Extend `WhereExpr` union to include `AndExpr | OrExpr`
- [ ] Update adapter lowering to handle `AndExpr` / `OrExpr` (Postgres adapter)
- [ ] Add unit tests for lowering new node kinds

### 1.2 Predicate operators

- [ ] Add `like` and `ilike` (if needed) to `BinaryOp` union in AST types
- [ ] Add `in` and `notIn` to `BinaryOp` union
- [ ] Add `ListLiteralExpr` (or equivalent) for `IN (...)` operands
- [ ] Update adapter lowering for new operators
- [ ] Add unit tests for `like`, `in` lowering

### 1.3 Join ON expressiveness

- [ ] Evolve `JoinAst.on` from `eqCol`-only to accept `WhereExpr` (or a compatible expression structure)
- [ ] Update join lowering in adapter
- [ ] Add tests for join conditions

### 1.4 selectAll intent

- [ ] Add `selectAll` intent representation—either an explicit AST node or `meta.annotations.selectAllIntent` when normalized to explicit columns
- [ ] Ensure `SelectAst.project` can represent select-all when expanded via contract table columns
- [ ] Add tests for selectAll expansion and intent preservation

### 1.5 Optional mutation WHERE

- [ ] Make `DeleteAst.where` optional (`WhereExpr | undefined`)
- [ ] Make `UpdateAst.where` optional (`WhereExpr | undefined`)
- [ ] Add tests ensuring undefined where is representable

**Phase 1 acceptance criteria**:

- All new AST node kinds have adapter lowering coverage
- DSL/ORM lanes still work (no regressions)
- Unit tests pass for each new construct

---

## Phase 2: Param descriptor and shared type updates

Update shared contract types used by all lanes.

### 2.1 ParamDescriptor.source extension

- [ ] Extend `ParamDescriptor.source` from `'dsl' | 'raw'` to `'dsl' | 'raw' | 'lane'` in `packages/1-framework/1-core/shared/contract/src/types.ts`
- [ ] Update any existing `ParamDescriptor` creation sites for `source` typing
- [ ] Add unit test for new source value

### 2.2 Documentation

- [ ] Update contract README or type docs to document `source: 'lane'`

**Phase 2 acceptance criteria**:

- `pnpm typecheck` passes across packages
- No runtime regressions in DSL/ORM plans

---

## Phase 3: Kysely AST → PN QueryAst transformer

Implement the core transformer as a pure function in the SQL domain.

### 3.1 Transformer module setup

- [ ] Create transformer module location (e.g. `packages/3-extensions/integration-kysely/src/transform/` or SQL domain equivalent per architecture)
- [ ] Define transformer function signature: `(contract, compiledQuery.query, compiledQuery.parameters) => { ast, metaAdditions }`
- [ ] Add fixture contract for unit tests

### 3.2 Query roots

- [ ] Implement transformation for `SelectQueryNode` → `SelectAst`
- [ ] Implement transformation for `InsertQueryNode` → `InsertAst`
- [ ] Implement transformation for `UpdateQueryNode` → `UpdateAst`
- [ ] Implement transformation for `DeleteQueryNode` → `DeleteAst`
- [ ] Add unit tests for each query root

### 3.3 FROM, tables, columns, aliases

- [ ] Transform `FromNode` / `TableNode` → `TableRef`
- [ ] Transform `ReferenceNode` + `ColumnNode` → `ColumnRef` (with contract validation)
- [ ] Handle `AliasNode` for selections
- [ ] Add unit tests for ref resolution

### 3.4 Selections and projection

- [ ] Transform `SelectionNode` → `SelectAst.project` entries
- [ ] Transform `SelectAllNode` → expanded explicit columns via contract (with selectAll intent annotation)
- [ ] Add unit tests for projection, including selectAll expansion

### 3.5 WHERE predicates

- [ ] Transform `WhereNode` → `WhereExpr`
- [ ] Transform `BinaryOperationNode` with operators: `=`, `<>`, `>`, `<`, `>=`, `<=`, `like`, `in`
- [ ] Transform `ValueNode` → `ParamRef` or `LiteralExpr`
- [ ] Transform `PrimitiveValueListNode` → `ListLiteralExpr`
- [ ] Implement AND/OR composition for compound WHERE
- [ ] Add unit tests for each predicate type

### 3.6 JOINs, ORDER BY, LIMIT

- [ ] Transform `JoinNode` + `OnNode` → `JoinAst`
- [ ] Transform `OrderByNode` / `OrderByItemNode` → `SelectAst.orderBy`
- [ ] Transform `LimitNode` → `SelectAst.limit`
- [ ] Add unit tests for joins, orderBy, limit

### 3.7 INSERT/UPDATE/DELETE specifics

- [ ] Transform `ValuesNode` → `InsertAst.values`
- [ ] Transform `ColumnUpdateNode` → `UpdateAst.set`
- [ ] Transform `ReturningNode` → `returning` column refs
- [ ] Add unit tests for DML details

### 3.8 Parameter indexing and paramDescriptors

- [ ] Implement deterministic parameter traversal matching Kysely compiler order
- [ ] Map each parameterized value to `ParamRef.index` (1-based into `plan.params`)
- [ ] Build `meta.paramDescriptors` with `refs`, `codecId`, `nativeType`, `nullable` when contract metadata available
- [ ] Use `ParamDescriptor.source = 'lane'` for Kysely params
- [ ] Add unit tests verifying param index alignment with `compiledQuery.parameters`

### 3.9 Ref extraction and validation

- [ ] Extract `meta.refs.tables` and `meta.refs.columns` from transformed AST
- [ ] Validate all refs against `contract.storage.tables`
- [ ] Add unit tests for ref resolution

### 3.10 Unsupported node handling

- [ ] Throw on unsupported Kysely node kinds (no silent fallback)
- [ ] Use stable error shape (code, message, details)
- [ ] Add unit tests for unsupported-node throws

**Phase 3 acceptance criteria**:

- Transformer produces expected `QueryAst` for representative Kysely AST inputs
- Parameter indexing matches `compiledQuery.parameters`
- `meta.refs` resolved and validated against fixture contract
- Unsupported node kinds throw with stable error shape

---

## Phase 4: PN-native refs and ambiguity guardrails

Ensure Kysely lane rejects ambiguous queries before transformation.

### 4.1 Pre-transform guardrails

- [ ] Implement qualified-ref check: in multi-table scope, reject unqualified column references
- [ ] Implement ambiguous selectAll check: reject `selectAll()` / `select *` in multi-table scope unless unambiguously scoped
- [ ] Integrate guardrails into Kysely lane execution path (before calling transformer)
- [ ] Add unit tests for each guardrail (reject expected queries)

### 4.2 Transformer fallback

- [ ] Document that transformer throws if ambiguity slips through (defensive)
- [ ] Add test: transformer throws on ambiguous/invalid node shapes

**Phase 4 acceptance criteria**:

- Ambiguous queries are rejected before execution
- Transformer never emits best-effort refs; throws on ambiguity

---

## Phase 5: Kysely lane plan construction

Wire the transformer into the Kysely integration so plans carry PN AST and meta.

### 5.1 Plan construction

- [ ] In `packages/3-extensions/integration-kysely/src/connection.ts`, call transformer with `compiledQuery`, `contract`
- [ ] Set `plan.ast = transformed QueryAst`
- [ ] Set `plan.meta.lane = 'kysely'`
- [ ] Set `plan.meta.refs` from transformer output
- [ ] Set `plan.meta.paramDescriptors` from transformer output
- [ ] Set `plan.meta.projection` and `plan.meta.projectionTypes` where applicable
- [ ] Set `plan.params = compiledQuery.parameters`
- [ ] Ensure `plan.meta.annotations.codecs` populated when projection types known

### 5.2 Integration tests

- [ ] Extend `test/integration/test/` Kysely tests to assert `plan.ast` presence
- [ ] Assert `plan.meta.refs` populated for Kysely queries
- [ ] Assert `plan.meta.paramDescriptors` populated
- [ ] Run Kysely integration with AST-first lints enabled

**Phase 5 acceptance criteria**:

- Kysely plans have `plan.ast`, `plan.meta.lane = 'kysely'`, and full meta
- Integration tests pass

---

## Phase 6: AST-first lint plugin

Reimplement the lint plugin to inspect `plan.ast` instead of raw SQL.

### 6.1 New lint implementation (SQL domain)

- [ ] Create `packages/2-sql/5-runtime/src/plugins/lints.ts`
- [ ] Implement `beforeExecute` that inspects `plan.ast` when present (SQL `QueryAst`)
- [ ] Rule: **DELETE without WHERE** — `ast.kind === 'delete'` and `ast.where` missing → block execution
- [ ] Rule: **UPDATE without WHERE** — `ast.kind === 'update'` and `ast.where` missing → block execution
- [ ] Rule: **Unbounded SELECT** — `ast.kind === 'select'` and `ast.limit` missing → warn/error (severity configurable)
- [ ] Rule: **SELECT * intent** — detect selectAll intent (AST or meta) → warn/error
- [ ] Preserve `LintsOptions` and severity configuration
- [ ] Add unit tests for each lint rule (AST-based)

### 6.2 Fallback behavior

- [ ] When `plan.ast` is missing, optionally fall back to raw guardrails (heuristic) or skip lints
- [ ] Document fallback behavior
- [ ] Add unit test for fallback path

**Phase 6 acceptance criteria**:

- Lint rules operate on `plan.ast`
- Kysely-authored plans are linted correctly
- Unit tests cover each rule

---

## Phase 7: Lint plugin migration to SQL domain

Move lint plugin from framework to SQL runtime and update exports.

### 7.1 Migration

- [ ] Ensure `packages/2-sql/5-runtime/src/plugins/lints.ts` is the canonical implementation (from Phase 6)
- [ ] Export lints from `packages/2-sql/5-runtime/src/exports/index.ts`
- [ ] Update framework `packages/1-framework/4-runtime-executor`: remove or deprecate `plugins/lints.ts`, add re-export from SQL runtime if backward compat desired
- [ ] Update any imports that reference framework lints to use SQL runtime
- [ ] Run `pnpm lint:deps` to validate imports

### 7.2 Package README

- [ ] Update SQL runtime README: document lints plugin, export surface, usage
- [ ] Update framework README if lints were removed or deprecated

**Phase 7 acceptance criteria**:

- Lints are exported from SQL runtime
- Framework either re-exports or documents migration path
- `pnpm lint:deps` passes
- No broken imports

---

## Phase 8: Demo Kysely parity queries

Add Kysely equivalents for all demo queries.

### 8.1 Map demo queries to Kysely

- [ ] Audit `examples/prisma-next-demo/src/queries`: list all query patterns (select, insert, update, delete, joins, like, in, limit, returning, etc.)
- [ ] Create `examples/prisma-next-demo/src/kysely/` structure mirroring queries where applicable

### 8.2 Implement Kysely equivalents

- [ ] `get-user-by-id` (already exists; verify and enhance if needed)
- [ ] `get-user-posts` (filter by userId)
- [ ] `get-users` (with limit)
- [ ] `get-users-with-posts` (or closest Kysely join equivalent)
- [ ] `get-all-posts-unbounded` (for unbounded SELECT lint test)
- [ ] `dml-operations`: insert, update, delete (with returning)
- [ ] `insert-user-transaction` (already exists; verify)
- [ ] Add like/in queries if present in demo
- [ ] Add at least one **guardrail-proving** query: DELETE without WHERE (intentionally failing to verify AST-based plugin blocks execution)

### 8.3 Wire into demo

- [ ] Ensure demo `main.ts` (or equivalent) can run Kysely parity commands
- [ ] Validate execution succeeds for safe queries
- [ ] Validate guardrail-proving query is blocked

**Phase 8 acceptance criteria**:

- All demo query patterns have Kysely equivalents under `examples/prisma-next-demo/src/kysely`
- Queries execute successfully with demo runtime
- Plans carry `plan.ast`, `plan.meta.refs`, `paramDescriptors`, `projectionTypes`
- Guardrail-proving query demonstrates AST-based lint blocks execution

---

## Phase 9: Test coverage

Ensure adequate unit, integration, and demo coverage.

### 9.1 Unit tests (SQL domain)

- [ ] Transformer: select, where, like, in, join, limit, insert, update, delete, returning
- [ ] Param indexing and paramDescriptors
- [ ] Ref resolution and contract validation
- [ ] Unsupported node throws

### 9.2 Unit tests (lints)

- [ ] AST-first lint blocks delete without where
- [ ] AST-first lint blocks update without where
- [ ] AST-first lint flags missing select limit
- [ ] AST-first lint flags selectAll intent

### 9.3 Integration tests

- [ ] Kysely integration: assert `plan.ast` presence
- [ ] Kysely integration with AST-first lints: assert expected failures for unsafe queries
- [ ] Run full integration suite

### 9.4 Demo tests

- [ ] Add/run Kysely demo execution tests
- [ ] Validate plugin observation (e.g. budgets, lints) for Kysely plans

**Phase 9 acceptance criteria**:

- `pnpm test:packages` passes
- `pnpm test:integration` passes
- Demo Kysely flow executes and validates end-to-end

---

## Phase 10: Documentation updates

Keep architecture docs and package READMEs aligned with the implementation.

### 10.1 Supporting reference

- [ ] Update `supporting-reference.md` as compatibility/implementation evolves during work

### 10.2 ADR

- [ ] Ensure [ADR 159](../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Kysely%20lane%20emits%20PN%20SQL%20AST.md) reflects final decisions (update if needed)
- [ ] Add ADR to ADR-INDEX if not already listed

### 10.3 Subsystem docs

- [ ] Update Query Lanes subsystem doc: mention Kysely lane, AST attachment, transformer
- [ ] Update Runtime & Plugin Framework subsystem doc: AST-first lints, lint plugin in SQL domain

### 10.4 Package READMEs

- [ ] `integration-kysely`: describe transformer, plan structure, guardrails
- [ ] `sql-runtime`: describe lints plugin, export surface
- [ ] `relational-core` (or AST package): document new AST node kinds if significant

### 10.5 Architecture overview

- [ ] Update `docs/Architecture Overview.md` if Kysely lane / AST-first lints affect high-level picture

**Phase 10 acceptance criteria**:

- All relevant docs reflect the implementation
- Links between docs are correct
- New developers can understand Kysely lane and AST-first lints from docs

---

## Dependency summary

```
Phase 1 (AST expansion) ─────────────────────────┐
Phase 2 (ParamDescriptor) ────────────────────────┤
                                                  ├─► Phase 3 (Transformer)
                                                  ├─► Phase 4 (Guardrails)
                                                  └─► Phase 5 (Lane wiring)

Phase 1, 2 ──────────────────────────────────────► Phase 6 (AST-first lints)
Phase 6 ─────────────────────────────────────────► Phase 7 (Lint migration)

Phase 1–7 ───────────────────────────────────────► Phase 8 (Demo parity)
Phase 1–8 ───────────────────────────────────────► Phase 9 (Test coverage)
Phase 1–9 ───────────────────────────────────────► Phase 10 (Docs)
```

---

## Quick reference: key files

| Area | Key paths |
|------|-----------|
| PN AST types | `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` |
| ParamDescriptor | `packages/1-framework/1-core/shared/contract/src/types.ts` |
| Kysely integration | `packages/3-extensions/integration-kysely/src/connection.ts` |
| Current lints | `packages/1-framework/4-runtime-executor/src/plugins/lints.ts` |
| Raw guardrails | `packages/1-framework/4-runtime-executor/src/guardrails/raw.ts` |
| SQL runtime exports | `packages/2-sql/5-runtime/src/exports/index.ts` |
| Demo queries | `examples/prisma-next-demo/src/queries/` |
| Demo Kysely | `examples/prisma-next-demo/src/kysely/` |
| ADR 159 | `docs/architecture docs/adrs/ADR 159 - Kysely lane emits PN SQL AST.md` |
