# Brief: D2 — contract-free joins + EXISTS projection, first consumer `constraintExistsCheck`

_Resume-mode brief: you carry full D1 context. This restates only what's D2-specific. The slice spec/plan and your D1 surface are the standing contract. **The substrate freezes after this dispatch** — D3/D4 are mechanical sweeps over what D1+D2 ship; any builder gap they'd hit must be closed here._

## Outcome

PG's `constraintExistsCheck` (`packages/3-targets/3-targets/postgres/src/core/migrations/planner-sql-checks.ts:35-58`) — `SELECT [NOT ]EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.conname = … AND n.nspname = …)` — is built via the contract-free builder and lowered through `lowerer.lowerToExecuteRequest(ast)`, and every constraint op consuming it (`operations/constraints.ts`: addPrimaryKey, addUnique, addForeignKey, addCheckConstraint, the dropConstraint variants) rides it, with the async/lowerer ripple into their `*Call.toOp()`s following your established pattern (async, lowerer-required, loud error when absent).

## Substrate to add (settle spec OQ4 here)

1. **Aliased sources + minimal join surface on `CfExprSelectQuery`.** The inner query needs `FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace` and alias-qualified column refs in WHERE (`c.conname`, `n.nspname`). The AST has `JoinAst`/`SelectAst.joins` and source aliasing; design the minimal fluent surface (e.g. `.from(source, alias)` / `.join(source, alias, onCfExpr)`) — only what catalog EXISTS bodies need (inner joins; no LATERAL/outer variants). Alias-qualified identifier refs should ride your existing `cfExpr.identifierRef` (extend if needed — catalog columns carry no codec).
2. **EXISTS / NOT EXISTS projection.** A `cfExpr`-level wrapper over `ExistsExpr` (kind `'exists'`, `ast/types.ts:1111`) + `NotExpr`, taking the inner query as a built or buildable Cf query (decide: accept the `CfExprSelectQuery` and `.build()` internally — keeps call sites fluent; record the choice). Composes with `.project(alias, …)` like your other predicates.
3. **Any helper `constraintExistsCheck` needs that D3's checks also need** (e.g. an `eqIdentifier`-style comparison between two identifier refs for the join's ON clause) goes in core now, not improvised in D3.

D1 conventions hold: values (`conname`, `nspname` inputs) bind as `ParamRef` with `pg/text@1`; catalog table/column identifiers stay lowered SQL; computed projections carry no codec; F21 litmus binding (all node assembly inside the builder; `checks.ts` grows vocabulary wrappers only).

## Scope

**In:** `relational-core` contract-free builder + its tests; both adapters ONLY if a render arm genuinely needs a touch (joins/exists already render — verify before touching); `target-postgres/src/contract-free/checks.ts` (+ exports); `planner-sql-checks.ts` (the `constraintExistsCheck` function); `operations/constraints.ts`; the constraint `*Call`s in PG `op-factory-call.ts`; tests pinning the above (construction pins in relational-core, lowering pins in adapter-postgres, op-factory/round-trip updates in target-postgres).

**Out:** every other check helper (D3/D4); `tableHasPrimaryKeyCheck`/`columnTypeCheck` (D3 — but their join shapes must be expressible with what you ship); SQLite (D4); the deferred sites; rendering changes beyond what joins/exists genuinely require.

## Halt conditions

As D1, plus: if the constraint `*Call` async ripple escapes `op-factory-call.ts` + the planner path (e.g. a sync caller of constraint `toOp`s you can't adapt in scope), halt and report.

## Completed when

1. A test proves `constraintExistsCheck(... exists: true|false)` produces `{sql, params}` via the lowerer with the EXISTS body (join + alias-qualified WHERE) and bound params; adapter lowering pin added.
2. The raw-string `constraintExistsCheck` body is gone (not wrapped); all five constraint-op families' checks ride it; their `toOp`s are async + lowerer-required; affected tests updated.
3. Gates: workspace typecheck (fresh `--force` only if you widen a union — otherwise cached fine), `pnpm test:packages`, `pnpm fixtures:check`, `pnpm lint:deps`, cast ratchet delta 0.
4. Report: OQ4 decision (exists-input shape) + join-surface shape with file:line for design-notes; files; commits (two sign-off trailers); gates; anything D3 must know.
