# Code Review: Transform Kysely AST → PN QueryAst

**Branch**: `tml-1892-transform-kysely-ast-to-pn-ast`  
**Base**: `origin/main`  
**Review date**: 2026-02-15

---

## Scope

**Review range**: `origin/main...HEAD`  
**Commits**: 30 commits across 8 phases (spec, AST expansion, transformer, guardrails, lint migration, demo parity, tests, docs)  
**Changed files**: ~56 files across `agent-os/specs/`, `packages/`, `examples/`, `docs/`, and `test/`

**Primary areas**:
- `packages/3-extensions/integration-kysely/` — transformer, guardrails, connection wiring
- `packages/2-sql/5-runtime/` — AST-first lint plugin, exports
- `packages/2-sql/4-lanes/relational-core/` — AST expansion (AndExpr, OrExpr, like/in/notIn, ListLiteralExpr, optional mutation where, selectAllIntent)
- `packages/1-framework/` — ParamDescriptor.source extension, lint removal
- Examples, integration tests, architecture docs

---

## Summary (what's strong / what's risky)

### Strengths

1. **Spec alignment** — All 10 phases from tasks.md are marked complete; requirements trace cleanly to implementation.
2. **Robustness** — Unsupported node kinds throw; no silent fallbacks; guardrails run before transformation.
3. **Lane-neutrality** — PN AST changes (AndExpr, OrExpr, like/in, ListLiteralExpr, etc.) are generic, not Kysely-specific.
4. **Param indexing** — ParamRef.index is 1-based into `plan.params`; paramDescriptors align with Kysely parameter order; transformer traversal is deterministic.
5. **Lint migration** — Lints are canonical in SQL domain, exported from `@prisma-next/sql-runtime`; framework README documents migration path.
6. **Test coverage** — Unit tests for transformer (select/insert/update/delete, predicates, guardrails, unsupported nodes), lints (AST-based + fallback), and integration tests including AST-first lint enforcement.
7. **Docs** — Architecture Overview, subsystem docs, ADR 160, and supporting-reference.md updated consistently.

### Risks / concerns

1. **Param order vs. Kysely compiler** — Traversal order (WHERE → LIMIT → …) may not exactly match Kysely’s. Integration tests pass, but there is no explicit lowering-parity test comparing lowered PN AST SQL to Kysely’s compiled SQL.
2. **Lowering equivalence expectation not asserted** — The updated spec and ADR 160 explicitly state that lowering the transformed PN SQL AST should be string-equal to Kysely where practical or semantically equivalent otherwise. Current tests do not appear to assert this property (they validate structural AST + refs/params, but not lowered-SQL parity).
3. **selectAll intent representation** — The implementation carries `selectAllIntent` on the `SelectAst` (and the lints plugin checks either AST or `meta.annotations.selectAllIntent`). This matches the spec’s “AST node or meta annotation” option, but it does mean any purely-meta consumers won’t see intent unless the lane also mirrors it into `meta.annotations`.
4. **Framework lints removal** — No deprecated re-export; consumers importing lints from `@prisma-next/runtime-executor` would break. Grep shows no such imports; migration appears complete.

---

## Spec adherence (bulleted requirements traceability)

| Requirement | Status | Notes |
|-------------|--------|-------|
| PN AST attachment at `plan.ast` | OK | Connection sets `ast` from transformer for Select/Insert/Update/Delete |
| `plan.meta.lane = 'kysely'` | OK | Set for transformable query kinds |
| Transform Kysely AST → PN QueryAst | OK | Full transformer in `transform/transform.ts` |
| No Kysely-shaped nodes in PN | OK | Only standard PN node kinds used |
| Unsupported nodes throw | OK | `transformKyselyToPnAst` throws with `UNSUPPORTED_NODE` |
| Resolved refs in `meta.refs` | OK | `extractRefsFromAst` + contract validation |
| `plan.params` + `meta.paramDescriptors` | OK | Params from `compiledQuery.parameters`; descriptors with refs, codecId, etc. |
| ParamRef.index 1-based | OK | `nextParamIndex` starts at 1; paramDescriptors mapped with `index: i + 1` |
| PN AST expansion (and/or, like, in, list literal, optional where, selectAllIntent) | OK | All in relational-core types and adapter |
| Example parity | OK | Kysely equivalents under `examples/.../kysely/` for demo queries |
| AST-first lint plugin | OK | `packages/2-sql/5-runtime/src/plugins/lints.ts` |
| Lint migration to SQL domain | OK | Exported from `@prisma-next/sql-runtime`; framework no longer provides lints |
| Guardrails (qualified refs, ambiguous selectAll) | OK | `runGuardrails` before transformer; throws on violations |
| Transformer throws on ambiguity | OK | `resolveColumnRef`, `resolveTable`, `transformSelections` throw |
| ParamDescriptor.source = 'lane' | OK | Used for Kysely params |

---

## Architectural / API review

### Package layering

- Transformer lives in `integration-kysely` (3-extensions). Imports from `contract`, `sql-relational-core`, `sql-contract`.
- Lints in `sql-runtime` (2-sql) import from `runtime-executor` for `Plugin`, `PluginContext`, and `evaluateRawGuardrails`.
- No layering violations observed; `pnpm lint:deps` would confirm.

### Lane-neutrality

- New AST node kinds (`AndExpr`, `OrExpr`, `ListLiteralExpr`, `like`/`ilike`/`in`/`notIn`, optional `DeleteAst.where`/`UpdateAst.where`, `selectAllIntent`) are defined in relational-core and rendered by the Postgres adapter. No Kysely-specific AST shapes.

### Export surface

- Lints: `@prisma-next/sql-runtime` exports `lints` and `LintsOptions`.
- Framework: `runtime-executor` no longer exports lints; README instructs migrating to `@prisma-next/sql-runtime`.

### Lowering implications

- Kysely plans set `plan.sql` / `plan.params` directly from Kysely’s compiled output and attach PN AST primarily for inspection (plugins/budgets/lints). Per the updated spec + ADR 160, **lowering equivalence** between the transformed PN AST and Kysely’s compiled SQL is still an important correctness expectation even if the execution path does not rely on lowered SQL for the Kysely lane.

---

## Correctness & edge cases

### Transformer

- **BinaryOp mapping** — `mapOperator` covers `=`, `<>`, `>`, `<`, `>=`, `<=`, `like`, `ilike`, `in`, `notIn`. `OperatorNode` with non-string `operator` could yield `[object Object]`; fixtures use string operators.
- **Limit literal vs param** — Limit from `ValueNode.value` when literal (`typeof directVal === 'number'`); otherwise param indexed. Handles both cases.
- **INSERT values structure** — Supports both column-keyed entries and positional rows via `columns`/`valueEntries`; handles `PrimitiveValueListNode` for `IN` lists.
- **Returning** — Handles `SelectAllNode`, `SelectionNode`, and column refs; expands selectAll via contract.

### Param indexing

- `nextParamIndex` increments before use; first param gets index 1. `paramDescriptors` rebuilt with `index: i + 1` in final step. Order matches WHERE → LIMIT (and other ValueNodes in traversal). Alignment with `compiledQuery.parameters` is asserted by integration tests but not by a dedicated lowering test.

### Guardrails

- Run only for `SelectQueryNode`; Insert/Update/Delete pass through. Matches spec (guardrails target multi-table SELECT).
- Walk covers selections, where, orderBy, join ON nodes. `checkUnqualifiedColumnRef` inspects `ReferenceNode` and `ColumnNode`; `hasExplicitTableRef` uses `getTableName`.

### Ref validation

- `validateTable` and `validateColumn` throw `INVALID_REF` for unknown table/column. `resolveColumnRef` and `resolveTable` enforce qualification in multi-table scope.

---

## Tests & CI readiness

### Unit tests

- **Transformer** (`integration-kysely/test/transform.test.ts`): select (all, where, limit, like, in, and, join, orderBy), insert (values, returning), update (set/where/returning), delete (with/without where, returning), unsupported nodes, defensive throws (unqualified ref, ambiguous selectAll), paramDescriptors, param indexing, ref extraction, contract validation.
- **Guardrails** (`guardrails.test.ts`): qualified/unqualified refs in selections/where/orderBy, ambiguous selectAll, single vs multi-table, non-select passthrough.
- **Lints** (`sql-runtime/test/lints.test.ts`): delete/update without where (block vs allow), unbounded select (warn/error), selectAll intent (ast + meta.annotations), fallback (raw/skip/default), severity overrides.

### Integration tests

- **Kysely** (`test/integration/test/kysely.test.ts`): CRUD, transactions, plan structure (ast, lane, refs, paramDescriptors, projection), AST-first lints blocking DELETE/UPDATE without WHERE, raw SQL (lane: raw, no ast).
- **Demo parity** (`examples/.../kysely-parity.integration.test.ts`): getUserById, getUserPosts, getUsers, getUsersWithPosts, dml, guardrail (delete/update without where), unbounded select.

### Gaps / brittleness

1. No test that `lower(transformedAst)` matches Kysely’s compiled SQL (exact where deterministic; otherwise semantic equivalence). Even if the Kysely lane executes Kysely’s compiled SQL directly, the spec/ADR position this parity as an important correctness property.
2. Tests rely on Kysely AST shape; Kysely version upgrades could change node structure.
3. Param-order dependency is implicit; a dedicated “param order matches Kysely” test would help.

---

## Docs & developer experience

### Accuracy

- Architecture Overview, Query Lanes, Runtime & Plugin Framework subsystems describe Kysely lane, AST attachment, and AST-first lints.
- ADR 160 and supporting-reference.md match implementation.
- integration-kysely and sql-runtime READMEs describe transformer, guardrails, and lints.

### Placement

- Spec and supporting docs in `agent-os/specs/2026-02-15-transform-kysely-ast-to-pn-ast/`.
- Architecture docs in `docs/` and `docs/architecture docs/`.

### Matching shipped behavior

- Docs correctly describe AST-first lint behavior and fallback. No obvious mismatches found.

---

## Recommendations (prioritized)

### Must

1. **Assert lowering equivalence (spec/ADR expectation)** — Add at least one unit-level test that lowers a transformed PN `QueryAst` and compares it to Kysely’s compiled SQL for representative queries (exact match where deterministic; otherwise assert semantic equivalence). Right now this expectation is documented but not clearly enforced by tests.

### Should

2. **Param-order assertion test** — Add a unit test that, for a given Kysely-style AST and params array, paramDescriptors indices 1..N correspond to params[0..N-1] in the same order Kysely would use.
3. **OperatorNode robustness** — If Kysely ever emits `OperatorNode` with `operator` as an object, `getOperatorFromNode` could return `"[object Object]"`. Add a defensive check or test for that case.
4. **Guardrails for INSERT subqueries** — If Kysely supports `INSERT ... SELECT` with multi-table SELECT, guardrails currently only run for root `SelectQueryNode`. Likely out of scope for MVP; document as future work if needed.

### Could

5. **Mirror selectAll intent into meta.annotations** — Not required (AST carries the signal and lints check it), but mirroring `selectAllIntent` into `plan.meta.annotations.selectAllIntent` could improve parity for any meta-only consumers.
6. **Framework deprecated re-export** — Consider a deprecated re-export in `runtime-executor` that forwards to SQL lints, for any external consumers that may not have been grepped.
7. **Limit param handling** — When limit is a param, the transformer uses `ctx.parameters[ctx.paramIndex - 1]`; verify this index is correct after `nextParamIndex` (off-by-one risk).

---

## Notable files

| File | Purpose |
|------|---------|
| `packages/3-extensions/integration-kysely/src/transform/transform.ts` | Core Kysely → PN AST transformer; 882 lines |
| `packages/3-extensions/integration-kysely/src/transform/guardrails.ts` | Pre-transform guardrails for qualified refs and selectAll |
| `packages/3-extensions/integration-kysely/src/connection.ts` | Plan construction; wires transformer and guardrails |
| `packages/2-sql/5-runtime/src/plugins/lints.ts` | AST-first lint plugin |
| `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` | AST expansion (AndExpr, OrExpr, like/in, etc.) |
| `packages/3-extensions/integration-kysely/src/transform/kysely-ast-types.ts` | `getTableName`, `getColumnName`, `hasKind` for Kysely AST |
| `packages/3-extensions/integration-kysely/src/transform/errors.ts` | `KyselyTransformError` and error codes |

---

## Assumptions and uncertainties

1. **Kysely AST stability** — Types are inferred from compiled query shape; Kysely does not export AST types. Future Kysely versions could change structure.
2. **Parameter order** — Traversal order is assumed to match Kysely’s compiler. Integration tests pass, but no formal proof.
3. **Raw SQL path** — For `sql\`...\`.execute(kysely)`, `query` may be absent or have a different kind; connection correctly falls back to `lane: 'raw'` and `ast: undefined`.
4. **Contract cast** — Connection casts `this.#contract` to `SqlContract<SqlStorage>`. If a non-SQL contract is passed, this could fail at runtime; considered acceptable for Kysely integration.
