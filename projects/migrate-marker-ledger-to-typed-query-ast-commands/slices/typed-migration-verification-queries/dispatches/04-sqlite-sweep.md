# Brief: D4 — SQLite sweep + closing grep gate (mechanical, against the frozen D1/D2 substrate)

The contract-free substrate is FROZEN (D1/D2, reviewer-certified). Do NOT edit `packages/2-sql/4-lanes/relational-core/`. This dispatch converts SQLite's raw-SQL verification checks to typed query-AST built via the contract-free builder + lowered through the adapter — mirroring the PG D3 sweep just landed (commits `7ee9352ab`/`6da8760e1`/`344cec2fe`). If you hit a shape the frozen substrate can't express, HALT and report.

## Inventory (complete — nothing else)

Convert these SQLite check sites to typed `*Ast` builders (SQLite target's contract-free surface, mirroring `target-postgres/src/contract-free/checks.ts`) lowered via `lowerer.lowerToExecuteRequest`:
1. `operations/tables.ts` — createTable / dropTable existence checks (`sqlite_master` counts).
2. `operations/tables.ts` — recreateTable **PRECHECKS** only (the `sqlite_master`/table-exists prechecks). **OUT: `buildRecreatePostchecks`** stays raw (needs CASE + row-tuple IN — deferred per spec; do NOT touch it or `recreate-postchecks.test.ts`).
3. `operations/columns.ts` — addColumn / dropColumn column-exists checks (`pragma_table_info` counts). NOTE: D1 already converted SQLite column-exists for some path — check what's already typed and avoid a dual raw/typed path; collapse if found.
4. `operations/indexes.ts` — createIndex / dropIndex existence checks (`sqlite_master` type='index').
5. Close any D1 SQLite **legacy raw copies** left for the authored-migration facade (mirror how D3 handled PG's legacy copies).

The SQLite catalog sources are table-valued functions (`pragma_table_info('t')`) and `sqlite_master` — use the `FunctionSource` / builder surface D1 added. Names bind as `ParamRef` with the SQLite text codec; identifiers stay lowered SQL. `*Call.toOp()` go async + lowerer-required following the established pattern.

## Conventions (all established — mirror PG D3, don't redesign)

- F21 litmus binding: zero `new <Node>(...)` / `.of(...)` outside builder internals; checks.ts grows vocabulary wrappers only.
- Computed projections carry no codec; inner EXISTS bodies project `1 AS "one"`; values→params, identifiers→lowered SQL.
- tests-before-impl: construction pins (target-sqlite) + lowering pins (adapter-sqlite); update op-factory/round-trip/planner tests for the async shape. **Watch the render-typescript round-trip test** if SQLite has one — the PG analogue broke on an `instanceof` across the tsx-subprocess module boundary (fixed in `344cec2fe` via a structural `hasExplicitSchema` predicate); if the SQLite renderer has a similar `instanceof <TableSource subclass>`, apply the same structural-predicate fix.
- No byte-parity demand (literals→params is intended); semantic parity via runner integration suites.

## Closing grep gate (slice DoD — must hold after this dispatch)

Hand-built `SELECT` check strings under `*/migrations/` exist ONLY in (a) SQLite `buildRecreatePostchecks` and (b) the PG data-transform `EXISTS(<user sql>)` wrapper. Everything else lowers through the adapter. Verify with a repo-wide grep and report the result.

## Gates

Workspace typecheck (cached fine — no union changes; `--force` only if you somehow touch a core type, which would be a HALT), `pnpm test:packages` (re-run flaky CLI/integration suites isolated — they contend under load; the documented pattern is "different suite each run, all pass standalone"), `pnpm fixtures:check`, `pnpm lint:deps`, cast ratchet delta 0. Commit with two sign-off trailers.

## Report

Per-inventory-item disposition table (converted / collapsed-dual-path / deferred), the closing-grep-gate result, files, commit shas, gates with results (note any isolated-flake re-runs).
