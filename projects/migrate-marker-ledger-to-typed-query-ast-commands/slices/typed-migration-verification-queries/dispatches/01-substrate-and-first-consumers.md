# Brief: D1 — verification-query substrate + first consumers (PG `to_regclass` checks; SQLite column-exists checks)

## Mental model — read this before you touch any file

This slice converts migration precheck/postcheck SQL from hand-glued strings to typed query-AST nodes built via the **contract-free builder** and lowered through the control adapter — the same path execute steps already take (see `CreateTableCall.toOp` post-#768/#813). D1 lands the **substrate** and proves it end-to-end on the two simplest check shapes, one per dialect. D2–D4 build on the surface you ship; **the substrate freezes after D2**, so the shapes you settle here carry the slice.

Read first (in order):

1. `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/typed-migration-verification-queries/spec.md` — the slice contract; its five "load-bearing decisions" are what D1 settles.
2. `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/typed-migration-verification-queries/plan.md` — D1's entry + risks.
3. `projects/migrate-marker-ledger-to-typed-query-ast-commands/design-notes.md` — the project's settled design vocabulary (target owns shape / adapter owns rendering; contract-free builder principles).
4. `projects/migrate-marker-ledger-to-typed-query-ast-commands/learnings.md` — especially the union-widening blast-radius lesson and the F21 correction.

## What D1 delivers

### A. Substrate (in `relational-core` + the two targets/adapters)

1. **Contract-free expression projection.** The contract-free builder (`packages/2-sql/4-lanes/relational-core/src/contract-free/table.ts`) can project non-column expressions with an alias: `count(*)`, comparisons against literals (`count(*) = 0`), `IS [NOT] NULL` over an expression, and typed function calls. The AST already carries everything (`AggregateExpr.count()` `ast/types.ts:676`, `BinaryExpr` `:972`, `NullCheckExpr` `:1143`, `ProjectionItem.expr` accepts any expression `:1271`); the gap is builder surface only. Design the fluent API — e.g. an expression-projection entry point plus small expression helpers — and record the choice. `ProjectionItem.codec` stays `undefined` for computed projections (the runner reads raw first-row/first-column truthiness; no decode).
2. **FROM-less SELECT.** `SELECT to_regclass(…) IS NULL` has no FROM. `SelectAst.from` (`ast/types.ts:1318`) is required today. Make an absent FROM representable (working position: `from` becomes optional; both adapters' `renderSelect` render no FROM clause when absent). Sweep every consumer of `SelectAst.from` workspace-wide.
3. **Table-valued-function FROM source.** SQLite checks select `FROM pragma_table_info('t')`. `TableSource` is identifier-quoted at render (`6-adapters/sqlite/src/core/adapter.ts:232`), so this needs a new FROM-source node. Working position (spec OQ2): a **core** node in `relational-core` (function name + argument expressions), rendered per-adapter; the *vocabulary* (which functions exist) is contributed per target as helpers. Do not put target-named fields/kinds on core classes (see learnings: the `TableSource.schema?` violation).
   **Union blast radius:** adding a member to `AnyFromSource` breaks every exhaustive consumer workspace-wide (adapters' FROM rendering, rewriters/folders, lints). Sweep them all in this dispatch; the gate is a **fresh, non-cached workspace typecheck** (`pnpm typecheck` with turbo forced, e.g. `pnpm turbo typecheck --force` — match whatever the repo's scripts support). Per-package typecheck alone is known to hide this (learnings § "Adding a kind to a discriminated union").
4. **Catalog scalar-function carrier.** Working position (spec OQ3): `OperationExpr` with `lowering: {targetFamily:'sql', strategy:'function', template:'to_regclass'}` (`ast/types.ts:588`; `SqlLoweringSpec` in `packages/2-sql/1-core/operations/src/index.ts:9`). **Verify first** how both adapters' `operation` render arm handles this — `OperationExpr.self` is receiver-style; check whether a single-arg function (`to_regclass('"s"."t"')`) renders cleanly with the argument as `self`. A small, scoped renderer fix is in-scope if the function form needs it. If `OperationExpr` can't carry this without distorting its contract, HALT and surface (don't invent a new node kind unilaterally).
5. **Per-target function/builder helpers.** The `to_regclass` helper lives with the Postgres target's contract-free surface (beside its codec helpers, `@prisma-next/target-postgres/contract-free`); the pragma-source helper(s) live with SQLite's. Param values (table/column names) bind as `ParamRef` with the target's text codec from those same helpers — values become bound params, identifiers stay lowered SQL.

### B. First consumers (converted in this dispatch — the substrate never ships unused)

6. **PG:** the `toRegclass`/`tableExists` checks in `packages/3-targets/3-targets/postgres/src/core/migrations/planner-sql-checks.ts:22-28` become builder-built `SelectAst`s lowered via `lowerer.lowerToExecuteRequest(ast)`. Their consumers inside already-lowerer-having ops (`CreateTableCall.toOp`, `op-factory-call.ts:220-261`) switch to the new form. If other (sync, lowerer-less) ops also call `tableExists` (`dropTable`, `createIndex`/`dropIndex`), convert those call sites too **only if** the async/lowerer ripple stays contained to their `toOp`s following the established pattern (`async toOp(lowerer?)`, loud error when absent — mirror `CreateTableCall.toOp`); otherwise leave them on a clearly-marked legacy copy and note it in your report for D3 (the helper must not silently serve both shapes without a deprecation note).
7. **SQLite:** the column-exists checks in `packages/3-targets/3-targets/sqlite/src/core/migrations/operations/columns.ts:5-62` (`SELECT COUNT(*) = 0|> 0 FROM pragma_table_info('t') WHERE name = 'c'`) become builder-built ASTs lowered through the adapter; the SQLite `AddColumnCall`/`DropColumnCall` `toOp`s go async + lowerer-required (the abstract base already allows `toOp(lowerer?): Op | Promise<Op>`; the planner already threads the lowerer to `toOp` — verify at the SQLite planner call site).
8. **Tests first, then implementation** (repo golden rule). New tests pin: the builder's expression-projection output AST shape; the lowered `{sql, params}` for both converted check shapes on both adapters; runner integration behavior unchanged (existing integration suites). Update the unit/round-trip tests that pin the old raw strings (`packages/3-targets/3-targets/sqlite/test/migrations/op-factory-call.test.ts`, the PG render/round-trip suites). **No byte-parity bar:** check SQL deliberately changes (inline escaped literals → bound params + aliased projection). Semantic parity is the bar.

## The F21 litmus (binding, reviewer will grep for it)

Converted call sites must read as fluent builder usage. Zero `new <Node>(...)`, `<Node>.of(...)`, or hand-assembled `ProjectionItem`/`AggregateExpr`/`BinaryExpr` at check-builder sites — that assembly belongs inside the builder. If your converted `tableExists` looks like option-bag wrappers around `new`-chains, it is the failure mode this project has already shipped and reverted twice (learnings § CORRECTION).

## Scope

**In:** `packages/2-sql/4-lanes/relational-core/src/{contract-free,ast}/**`, both adapters' renderers (`packages/3-targets/6-adapters/{postgres,sqlite}/src/core/**`), the two targets' contract-free helper surfaces, `planner-sql-checks.ts` (the two functions named), SQLite `operations/columns.ts`, the affected `op-factory-call.ts` files, exhaustive `AnyFromSource`/`SelectAst.from` consumers found by the sweep, and the tests covering all of the above.

**Out (do not touch):** `buildRecreatePostchecks` (SQLite `operations/tables.ts:252-388`) and `recreate-postchecks.test.ts`; the PG data-transform `EXISTS(<user sql>)` wrapper; every other check helper (D2/D3/D4); the contract-BOUND `sql()` builder; marker/ledger code; `LoweredStatement`/`lower()`/`lowerToDriverStatement` contracts; Mongo anything.

## Constraints

- Never `any`; no bare `as` in production code (`blindCast`/`castAs` from `@prisma-next/utils/casts` if truly unavoidable — the cast ratchet must not regress).
- No new comments unless stating a non-obvious constraint; no drive-by refactors or renames outside scope.
- No barrel files; export from the packages' existing `exports/` surfaces only.
- Frozen-class discipline for any new AST node (`freeze()` in constructor, `rewrite`/`fold` arms, kind string registered wherever sibling kinds are — mirror `TableSource`/`DerivedTableSource` exactly).
- Commit on this branch (`tml-2889-typed-migration-verification-queries`), staging files explicitly (never `git add -A`), with: `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>" -m '<msg>'`. Multiple commits welcome at coherent boundaries (substrate vs consumers).

## Halt conditions (stop, write your status, report back — do not improvise)

- A spec working position doesn't survive contact with the code (e.g. `OperationExpr` can't carry receiver-less functions; core `FunctionSource` forces a target-specific field; optional `from` breaks a consumer you can't adapt within scope).
- The async/lowerer ripple escapes the named `toOp` files (e.g. a sync caller of `toOp` outside the planner path that can't await).
- Any fork the spec doesn't pin and the working positions don't cover.

## Heartbeat

Append a line to `wip/heartbeats/implementer.txt` (create it) every ~10–15 minutes of work: `<ISO ts> | <phase> | <one-line status>`. Phases: reading / tests / substrate / consumers / sweep / gates / done.

## Completed when

1. Both converted check shapes lower end-to-end: a test proves PG `tableExists` and SQLite column-exists produce `{sql, params}` via `lowerer.lowerToExecuteRequest(builderBuiltAst)` and the runner integration suites pass on both dialects.
2. The raw-string forms of the converted checks are gone from the converted call sites (not wrapped); `rg "to_regclass\('" packages/3-targets/3-targets/postgres/src/core/migrations/` and `rg "pragma_table_info\('" packages/3-targets/3-targets/sqlite/src/core/migrations/operations/columns.ts` return no string-glue hits in converted sites.
3. Fresh workspace gates green: `pnpm build` (affected packages), **fresh non-cached `pnpm typecheck`**, `pnpm test:packages`, `pnpm fixtures:check`, `pnpm lint:deps`, cast ratchet unchanged.
4. Your report records, with file:line, each settled decision (expression-projection API; FROM-less select; FunctionSource shape + placement; function carrier verdict; helper placement) for the orchestrator to land in design-notes.

## Return shape

Report: decisions settled (per item 4 above) · files touched · commits made · gates run with results · anything halted/deferred for D2–D4 (e.g. lowerer-less PG ops left on a legacy copy) · test deltas (what was re-pinned and why).
