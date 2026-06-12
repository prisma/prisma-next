# Slice — `typed-migration-verification-queries` (plan)

**Spec:** `./spec.md` · **Linear:** TML-2889 · **Base:** `main` · **Branch:** `tml-2889-typed-migration-verification-queries` · One PR (operator decision).

## Template (proven, from slices 4/5/7 — mirror it)

Check-builder constructs a `SelectAst` via the contract-free builder ← lowered by `lowerer.lowerToExecuteRequest(ast)` (async) ← `*Call.toOp(lowerer)` wires `{description, sql, params}` into precheck/postcheck (async + lowerer-required, loud error if absent — mirror `CreateTableCall.toOp`). Runner semantics untouched (first-row/first-column truthy; steps already carry `params`).

## Dispatches

### D1 — spike + substrate core, validated on the two simplest check shapes (design judgment lives here)

Settle spec open questions 1–3 + 5 **by landing the minimal substrate end-to-end with its first consumers**, mirroring how slice 1 settled the visitor seam:

- **Contract-free expression projection** — the fluent API for projecting `count(*)`, comparisons (`count(*) = 0`), `IS [NOT] NULL`, and typed function calls with an alias. F21 litmus is binding: converted call sites read as builder usage, zero `new <Node>(...)` / `.of(...)` outside builder internals. Codec on computed projections stays `undefined`.
- **Function FROM-source** — new FROM-source node for table-valued functions (`pragma_table_info('t')`). Decide core-vs-target-contributed (working position: core node, per-target rendering). **Union blast radius:** adding a member to `AnyFromSource` hits every exhaustive consumer workspace-wide (adapters' FROM rendering, rewriters/folders) — sweep them in this dispatch and gate on a **fresh, non-cached workspace typecheck** (`turbo --force`), per project learnings.
- **Catalog function carrier** — `to_regclass` via `OperationExpr {strategy:'function', template}` (verify both adapters' `operation` arm renders a no-receiver function form; small renderer touch in-scope if not). Per-target function helpers live beside the targets' contract-free codec helpers.
- **FROM-less SELECT** — `SELECT to_regclass(…) IS NULL` has no FROM clause; `SelectAst.from` is required today. Allow an absent FROM (render no FROM clause) — core change with a bounded renderer touch in both adapters.
- **First consumers (converted in this dispatch):** PG `toRegclass`/`tableExists` (`planner-sql-checks.ts`) and SQLite `addColumn`/`dropColumn` column-exists checks (`operations/columns.ts`), including the async/lowerer ripple into their `toOp()`s and their unit + round-trip test updates.
- Decisions recorded for design-notes in the dispatch return (orchestrator lands them).
- Gates: workspace typecheck (fresh), affected package tests, `fixtures:check`, lint:deps, cast ratchet, F21 grep on converted sites.

### D2 — contract-free joins + EXISTS projection, validated on PG `constraintExistsCheck`

- Minimal `Cf` join surface (PG catalog EXISTS bodies join 2–3 `pg_*` tables) + `EXISTS`/`NOT EXISTS` projection (spec open question 4 — settle whether `exists()` takes a built inner select).
- First consumer: `constraintExistsCheck` (pg_constraint ⋈ pg_namespace) — converts every constraint op's checks at once; async ripple into the constraint `*Call.toOp()`s; tests updated.
- Builds on: D1's expression-projection surface. Hands to: the full builder surface D3/D4 sweep with — **substrate is frozen after D2**; sweeps must not touch `relational-core`.

### D3 — PG sweep (mechanical against the D1/D2 shapes)

- Convert the remaining `planner-sql-checks.ts` helpers: `columnExistsCheck`, `columnNullabilityCheck`, `columnTypeCheck` (`format_type`, joins), `columnDefaultExistsCheck`, `tableHasPrimaryKeyCheck`, `tableIsEmptyCheck`, `columnHasNoDefaultCheck` — plus the inline checks in `operations/enums.ts` (pg_type ⋈ pg_namespace) and `operations/dependencies.ts` `installExtension` (pg_extension).
- Raw-string forms removed, not wrapped; async/lowerer ripple across the remaining PG `*Call.toOp()`s; PG unit + round-trip + runner integration tests updated.
- **Out:** data-transform `EXISTS(<user sql>)` wrapper (deferred per spec).

### D4 — SQLite sweep (mechanical against the D1 shapes)

- Convert `operations/tables.ts` createTable/dropTable + recreateTable **prechecks** (sqlite_master counts), `operations/indexes.ts` createIndex/dropIndex; columns.ts already done in D1.
- Async/lowerer ripple across the SQLite `*Call.toOp()`s; SQLite tests updated.
- **Out:** `buildRecreatePostchecks` (deferred per spec — stays raw, `recreate-postchecks.test.ts` untouched).
- Closing grep gate (slice DoD): hand-built `SELECT` strings under `*/migrations/` exist only in `buildRecreatePostchecks` + the data-transform wrapper.

## Sequencing

D1 → D2 → D3 → D4 on one branch (D3/D4 are logically independent but share the branch; run sequentially). Review pass after D4, then PR. Design-notes updates land orchestrator-side after D1 and D2.

## Risks (from grounding; carry into briefs)

- **`AnyFromSource` union widening** — exhaustive-consumer sweep + fresh workspace typecheck is the D1 gate (turbo cache hid exactly this in slice 1; see learnings).
- **`OperationExpr` function-form rendering** — unverified that the adapters' `operation` arm renders a receiver-less call; D1 verifies first.
- **Param codecs on check params** — names/ints bound via the target contract-free codec helpers (`text`, `int4`/int); confirm the SQLite int codec name at D1.
- **Async ripple breadth** — every converted op's `toOp` becomes async; the all-`*Call` smoke tests and any sync callers must be swept per dispatch, not left to the end.
- **No byte-parity bar** — checks change shape (literals → params); semantic parity via runner integration tests on both dialects is the bar. Don't let a reviewer demand byte-parity (spec records this).
