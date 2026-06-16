# Brief: D3 — Postgres sweep (mechanical, against the frozen D1/D2 substrate)

_Resume-mode brief. The substrate is frozen (reviewer-certified to cover this entire inventory — including LEFT JOIN via `.leftJoin`, `LIMIT 1` via `.limit`, `format_type` via `cfExpr.fn`, `information_schema` FROM via schema-qualified `PostgresTableSource`, schema comparands via `schemaFilterExpression()`). This dispatch is transliteration + consumer conversion only. **If you hit a shape the substrate cannot express, that is a HALT** — report it; do not extend `relational-core` and do not improvise a semantic conversion._

## Outcome

Every remaining raw-string verification check in the Postgres target is built via the contract-free builder and lowered through the passed lowerer; the raw forms are deleted (not wrapped); the affected ops follow the established async + lowerer-required pattern end-to-end (toOp, op factory, authored `PostgresMigration` method where the op has an authored surface, `renderTypeScript` method form, examples regenerated if affected).

## Inventory (complete — nothing else)

**`planner-sql-checks.ts` helpers → typed `*Ast` builders in `target-postgres/src/contract-free/checks.ts`:**
1. `columnExistsCheck` (information_schema.columns EXISTS; no join)
2. `columnNullabilityCheck` (information_schema.columns, `is_nullable`)
3. `columnTypeCheck` (pg_attribute ⋈ pg_class ⋈ pg_namespace, `format_type(a.atttypid, a.atttypmod)`, `NOT a.attisdropped`)
4. `columnDefaultExistsCheck` (information_schema.columns, `column_default IS [NOT] NULL`)
5. `columnHasNoDefaultCheck` (NOT EXISTS variant)
6. `tableHasPrimaryKeyCheck` (pg_index ⋈ pg_class [LEFT JOIN] ⋈ pg_namespace, `indisprimary`)
7. `tableIsEmptyCheck` (`NOT EXISTS (SELECT 1 FROM tbl LIMIT 1)` — the user-table FROM is a schema-qualified `PostgresTableSource`)

**Inline check sites:**
8. `operations/enums.ts` — enum-type existence (pg_type ⋈ pg_namespace) for createEnumType/addEnumValues/dropEnumType/renameType
9. `operations/dependencies.ts` `installExtension` — pg_extension existence

**D1 legacy copies (close them):**
10. `operations/tables.ts` `dropTable` — to_regclass checks via the existing `tableExistsAst`
11. `operations/indexes.ts` `createIndex`/`dropIndex` — to_regclass (index variant; reuse/extend the `toRegclass` vocabulary, not a new carrier)

**Out:** the data-transform `EXISTS(<user sql>)` wrapper (deferred per spec); SQLite anything (D4); `relational-core` (frozen); Mongo.

## Conventions (all established — mirror, don't redesign)

- Values bind as `ParamRef` with `pg/text@1` (names) — never inlined; identifiers stay lowered SQL; computed projections carry no codec; inner EXISTS bodies project `1 AS "one"`; `allOf` for AND groups; `schemaFilterExpression()` for every schema comparand (named vs unbound handled polymorphically — do not branch).
- Per-op ripple mirrors D2's constraint conversion: async factory + async lowerer-required `toOp` (loud `createPostgresMigrationPlanner` error) + `PostgresMigration` method where an authored bare factory exists today (remove the bare export per no-backward-compat; `renderTypeScript` emits method form; `importRequirements() = []`).
- F21 litmus binding: zero node assembly outside `relational-core` builder internals; `checks.ts` grows vocabulary wrappers only (`cfExpr.fn` for `format_type` etc.).
- Tests: construction pins for each new `*Ast` builder (target-postgres), lowering pins (adapter-postgres), op-factory/round-trip/render updates, examples regenerated if their migrations reference converted ops. No byte-parity demands — semantic parity via the runner integration suites.

## Completed when

1. `rg "SELECT" packages/3-targets/3-targets/postgres/src/core/migrations/` finds no hand-glued check SQL outside the data-transform wrapper; `planner-sql-checks.ts` contains no raw SQL strings (or is deleted if empty — prefer deletion over a husk).
2. All inventory ops' checks ride `lowerer.lowerToExecuteRequest(ast)`; their `toOp`s async + lowerer-required; authored surfaces converged per the D2 pattern.
3. Gates: cached workspace typecheck (no union changes expected; use `--force` if anything in a core type moves — which would itself be a halt signal), `pnpm test:packages`, `pnpm fixtures:check`, `pnpm lint:deps`, cast ratchet delta 0, PG runner integration suite green.
4. Report: per-inventory-item disposition table (converted / halted+why), files, commits (two trailers), gates, anything D4 must know.
