# Slice — `typed-migration-verification-queries` (spec)

**Project:** migrate-marker-ledger-to-typed-query-ast-commands · **Phase:** carved-out cross-cutting slice (operator-deferred from the #768 review; picked up 2026-06-11) · **Linear:** [TML-2889](https://linear.app/prisma-company/issue/TML-2889/typed-migration-verification-queries-precheckpostcheck-selects-through)

## Purpose

Convert the migration ops' precheck/postcheck verification SELECTs — today hand-built raw SQL strings in every `*Call.toOp()` path — into typed query-AST nodes built via the contract-free builder and lowered through the control adapter, the same path the `execute` steps already use. This kills the last systematic "express, don't concatenate" violation in the SQL planner surface and grows the contract-free builder the expressiveness (aggregate, comparison, EXISTS, function-call projection; function FROM-sources; joins) that Phase 2 needs anyway.

**Scope correction vs the project plan:** this slice is **SQL-only (Postgres + SQLite)**. Grounding showed Mongo's checks are already typed — `MongoMigrationCheck` carries an inspection command + `MongoFilterExpr` + `expect: 'exists' | 'notExists'` (`packages/2-mongo-family/4-query/query-ast/src/migration-operation-types.ts:10-52`). There is nothing to convert on Mongo.

## At a glance

```ts
// before — checks are escaped-literal string glue (planner-sql-checks.ts, operations/*.ts)
{ description: 'table absent', sql: `SELECT to_regclass('${qualified}') IS NULL` }
{ description: 'column absent',
  sql: `SELECT COUNT(*) = 0 FROM pragma_table_info('${escapeLiteral(t)}') WHERE name = '${escapeLiteral(c)}'` }

// after — built via the contract-free builder, lowered through the passed lowerer
const ast = /* cf select projecting NullCheckExpr.isNull(toRegclass(qualified)) */;
const { sql, params } = await lowerer.lowerToExecuteRequest(ast);
return { description: 'table absent', sql, params };
```

The check *semantics* are unchanged: the runner still executes each step and interprets first-row/first-column truthiness (`runner.ts` `stepResultIsTrue`). What changes is construction (typed AST, not string glue) and parameterization (identifiers/names become bound params where they are values, e.g. catalog `WHERE name = $1`; they stay lowered SQL where they are identifiers).

## Inventory (grounded)

**Postgres — `planner-sql-checks.ts` (shared helpers; converting each converts every op using it):** `toRegclass`/`tableExists`, `columnExistsCheck`, `columnNullabilityCheck`, `columnTypeCheck` (pg_attribute ⋈ pg_class ⋈ pg_namespace + `format_type`), `columnDefaultExistsCheck`, `tableHasPrimaryKeyCheck` (pg_index ⋈ pg_class ⋈ pg_namespace), `constraintExistsCheck` (pg_constraint ⋈ pg_namespace), `tableIsEmptyCheck`, `columnHasNoDefaultCheck`. Plus inline checks in `operations/enums.ts` (pg_type ⋈ pg_namespace) and `operations/dependencies.ts` `installExtension` (pg_extension).

**SQLite:** `operations/tables.ts` createTable/dropTable + recreateTable *prechecks* (sqlite_master counts), `operations/columns.ts` addColumn/dropColumn (`pragma_table_info` counts), `operations/indexes.ts` createIndex/dropIndex (sqlite_master counts).

**Substrate verified present:** the AST already expresses `count(*)` (`AggregateExpr.count()`), comparisons (`BinaryExpr`), `EXISTS`/`NOT` (`ExistsExpr`/`NotExpr`), `IS [NOT] NULL` (`NullCheckExpr`), scalar subqueries (`SubqueryExpr`), joins (`JoinAst`), `groupBy`/`having` (`SelectAst`), and typed function calls (`OperationExpr` with `SqlLoweringSpec {strategy: 'function', template}`). Both adapters' `renderExpr` already render all of these in projection position. The gaps are **builder-surface** (CfSelectQuery projection is column-only; no joins) and **two AST FROM/expr holes** (no table-valued-function FROM source — `TableSource` is always identifier-quoted; no CASE expression; no row-tuple IN — the latter two are deferred with their only consumer, see Non-goals).

## The load-bearing decisions (settled by the dispatch-1 spike, not here)

1. **Contract-free expression-projection API.** How `CfSelectQuery`/`TableHandle` projects non-column expressions with aliases (e.g. `count(*)`, `count(*) = 0`, `EXISTS(...)`, `to_regclass(...) IS NULL`). Must satisfy the F21 litmus: call sites read as fluent builder usage — no `new AggregateExpr(...)` / `ProjectionItem.of(...)` hand-assembly at the check-builder sites. Codec on computed projections stays `undefined` (the runner reads raw truthiness; no decode).
2. **Function FROM-source shape.** SQLite checks select `FROM pragma_table_info('t')` — a table-valued function. `TableSource` identifier-quotes its name, so this needs a new FROM-source node. Decide core-vs-target-contributed (project precedent — slice-2 retro finding 1 — says target-specific concepts must not become fields/nodes on generic core; but ANSI table-functions exist in PG too). Working position: a core `FunctionSource` node rendered by each adapter, with the *function vocabulary* contributed per target (mirroring how `ReferentialAction` is shared but rendering is per-adapter).
3. **Catalog scalar-function carrier.** `to_regclass`, `format_type`, `LOWER`: ride `OperationExpr` with `{strategy: 'function', template}` (verify the adapters' `operation` rendering arm handles a no-receiver/function form cleanly) vs a small target-contributed expression node. Working position: `OperationExpr`; the per-target function helpers live beside the targets' contract-free codec helpers (`@prisma-next/target-postgres/contract-free`, `…target-sqlite/contract-free`).
4. **Contract-free join surface.** PG's catalog EXISTS bodies join 2–3 catalog tables. Decide the minimal `Cf` join API (or whether `exists()` accepting a built inner select keeps the join construction at the handle level). Settle the smallest surface that keeps call sites fluent.
5. **Home of the converted check-builders.** Working position: the existing homes stay (`planner-sql-checks.ts` on PG; the op factories on SQLite) — they become AST-building + lowering functions instead of string-gluing functions. One home per concern is preserved; no new shared layer.

## Non-goals

- **SQLite `buildRecreatePostchecks` stays raw (deferred wholesale).** Its constraint-level postchecks need `CASE WHEN` and row-tuple `IN` — AST kinds that don't exist and deserve their own substrate decision. Deferred with a tracked follow-up (Phase 2); the helper is self-contained (`operations/tables.ts:252-388`, pinned by `recreate-postchecks.test.ts`). The simple recreateTable *prechecks* (sqlite_master counts) **are** in scope.
- **PG data-transform `EXISTS(<user sql>) AS ok` wrapper stays raw.** The inner SQL is user-supplied; there is no AST to build from. (`operations/data-transform.ts:116-140`.)
- **Mongo: nothing to do** (already typed; see Purpose).
- **No byte-parity requirement.** Unlike the execute-step slices, check SQL deliberately changes shape: inline escaped literals become bound params. Parity bar is *semantic* (same truthiness on the same database states), pinned by the existing runner integration tests + updated unit expectations.
- **No new check semantics.** Same catalog queries, same expectations, same runner interpretation. No new check kinds, no consolidation of which ops check what.
- **No user-facing builder exposure.** The grown contract-free surface remains control-plane/migration-internal, like the rest of the project.

## Cross-cutting requirements

- **No raw check SQL outside the two deferred sites.** After this slice, `grep` for hand-built `SELECT` strings under `*/migrations/` finds only `buildRecreatePostchecks` and the data-transform wrapper. Checks reach `{sql, params}` only via `lowerer.lowerToExecuteRequest(ast)`.
- **F21 litmus at every converted site.** Check-builders read as fluent builder calls; no `new <Node>(...)` / `.of([...])` assembly outside the builder internals.
- **Identifiers vs values.** Catalog-row *values* (table/column/constraint names compared in WHERE) become bound params with explicit target text/int codecs. SQL *identifiers* (the FROM catalog table, pragma function names) are lowered SQL, adapter-quoted where applicable.
- **Async ripple is bounded and explicit.** Converted helpers are async; ops adopting them follow the `CreateTableCall.toOp` pattern (async, lowerer-required, loud error if absent). The abstract base already allows `toOp(lowerer?): Op | Promise<Op>`.
- **Green main; `pnpm fixtures:check` clean; cast ratchet not regressed.**

## Definition of Done

- [ ] Team-DoD floor (repo gates, docs/migration, Linear close-out).
- [ ] The contract-free builder expresses aggregate, comparison/boolean, EXISTS, IS-NULL, and typed-function projections, plus the FROM/join shapes the inventory needs; surface decisions recorded in design-notes.
- [ ] Every in-scope check site (inventory above) builds its query via the contract-free builder and lowers through the passed lowerer; the raw-string forms are removed, not wrapped.
- [ ] Affected `*Call.toOp()` paths are async + lowerer-driven; planner/runner/round-trip tests updated; runner integration tests green on both dialects.
- [ ] The two deferred sites are recorded in the project plan with rationale (`buildRecreatePostchecks` → needs CASE + tuple-IN; data-transform wrapper → user SQL).

## Open questions

All five load-bearing decisions above — settled by the dispatch-1 spike and recorded in design-notes before the conversion sweep dispatches run.

## References

- Project spec/plan: [`../../spec.md`](../../spec.md), [`../../plan.md`](../../plan.md) (carved-out-slice section)
- Origin: operator deferral on the #768 review (slice 5)
- Precedent slices: `planner-create-table-adopts-ddl-ast` (lowerer threading), `pg-add-column-pioneer` (async toOp pattern), `codec-routed-ddl-defaults` (`lowerToExecuteRequest` contract)
- Key code: `packages/3-targets/3-targets/postgres/src/core/migrations/planner-sql-checks.ts`; `packages/3-targets/3-targets/sqlite/src/core/migrations/operations/{tables,columns,indexes}.ts`; `packages/2-sql/4-lanes/relational-core/src/contract-free/table.ts`; `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`
