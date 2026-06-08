# Slice: sqlite-create-table-adoption — Dispatch plan

_(In-project slice. Spec: [`./spec.md`](./spec.md). Linear: [TML-2859](https://linear.app/prisma-company/issue/TML-2859). Pattern reference: slice 4 [`planner-create-table-adopts-ddl-ast`](../planner-create-table-adopts-ddl-ast/plan.md).)_

## Amendment 2026-06-08

Original plan: 3 dispatches (D1 plumbing → D2 toOp migration → D3 authoring API). D1 landed clean (commit `de813cb18`). **D2 halted on a falsified-assumption stop condition** (the spec assumed the SQLite adapter substrate was byte-parity-ready — it isn't). Per operator decision, slice 5 expands to fix the SQLite adapter renderer + replicate slice 4's `*Call holds DdlColumn[]` refactor on the SQLite side. The plan now has 4 dispatches: D1 (done) + D2 (substrate renderer fix) + D3 (CreateTableCall refactor + planner-side construction migration + toOp lower) + D4 (authoring API, unchanged).

Re-planning rationale: D2 (renderer fix in isolation) and D3 (consumer-side refactor that depends on D2) are split because the substrate-vs-consumer joint is the right hand-off boundary — D2 leaves a stable state (renderer convention-correct, existing tests stay green, no consumer change), D3 then refactors the consumer mechanically against the fixed substrate. Bundling them would re-create the "substrate change + consumer migration in one dispatch" anti-pattern from `drive/calibration/sizing.md`.

### Dispatch 1: Thread `Lowerer` through the SQLite planner stack ✅ DONE

Commit: `de813cb18`. 10 files (+69/-34). All four validation gates passed (with TML-2860 filed for pre-existing slice-4 adapter-sqlite test debt, surfaced by the typecheck gate).

Hand-off realised: `SqliteCreateTableCall.toOp(lowerer?)` accepts an optional `Lowerer`; the production path threads a real adapter; bodies still ignore it.

### Dispatch 2: Fix the SQLite adapter renderer to convention (substrate fix)

- **Outcome:** `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts` `quoteIdentifier`s every identifier reference (table, columns, constraint names, refTable, refColumns) — mirror PG's adapter renderer at `packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts`. The `CREATE TABLE` rendering uses the planner's `renderCreateTableSql` indentation convention (2-space) so adapter output can be byte-identical to planner output. Existing 4 byte-parity tests at `packages/3-targets/6-adapters/sqlite/test/ddl-table-constraints-lowering.test.ts` are extended (NOT regenerated) to cover the new quoting + indentation behaviour; if the existing tests' expected outputs assumed the buggy unquoted form, those expectations are updated (the tests' INTENT — "the adapter renders correct SQLite DDL" — is preserved; the buggy literal was the wrong oracle). No consumer-side change.
- **Builds on:** D1's hand-off. External: the PG adapter renderer's pattern for identifier-quoting + the planner's `renderCreateTableSql` for the canonical indentation form.
- **Hands to:** The SQLite adapter renderer emits conventionally-correct DDL SQL that matches `renderCreateTableSql`'s format byte-for-byte for any input the consumer would supply.
- **Focus:** Substrate-only. Do NOT touch `SqliteCreateTableCall` (D3 owns the consumer refactor). Do NOT touch the planner's call-construction site. Do NOT migrate `toOp` bodies. The fix is to the renderer's output format, nothing else.

**Dispatch-INVEST check.** _Independent_ — produces a stable substrate (renderer conventionally correct); D3 builds on it. _Negotiable_ — outcome named (quote-identifier + match indentation); implementer's grep finds the call sites. _Valuable_ — D3's byte-parity test is unrunnable until D2 lands. _Estimable_ — binary: `quoteIdentifier` is called on every identifier reference (verifiable by grep); existing constraint tests + the new full-CREATE-TABLE-with-mixed-case-identifier test all pass. _Small_ — one file modification + extended tests in one test file. _Testable_ — `pnpm --filter @prisma-next/adapter-sqlite typecheck` + `... test` + an extended byte-parity test that pins the mixed-case + reserved-word case.

### Dispatch 3: Refactor `SqliteCreateTableCall` to hold `DdlColumn[]`; migrate `toOp(lowerer)` (consumer refactor + byte-parity proof)

- **Outcome:** `SqliteCreateTableCall` (`packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts:50`) changes its field shape from `spec: SqliteTableSpec` to `columns: readonly DdlColumn[]` + `constraints?: readonly DdlTableConstraint[]` (mirror `PostgresCreateTableCall`). The upstream planner site that constructs `SqliteCreateTableCall` (in `planner-strategies.ts` / `issue-planner.ts` — implementer finds via grep) builds `DdlColumn` instances with structured `LiteralColumnDefault`/`FunctionColumnDefault` from the source `StorageColumn` — mirror PG's flow. `SqliteCreateTableCall.toOp(lowerer)` builds the `SqliteCreateTable` DDL node via the contract-free `createTable({...})` constructor and lowers through `lowerer.lower(...)`. A new byte-parity test drives `SqliteCreateTableCall.toOp(lowerer)` end-to-end across ≥5 representative shapes (simple, composite-PK, FK with actions, table-level unique, autoincrement) and asserts byte-identity vs the current `renderCreateTableSql` output. The free `createTable(...)` Op-builder + its `renderCreateTableSql` helper at `operations/tables.ts:22,45` STAY (still called by `recreateTable` at line 171, Phase 2).
- **Builds on:** D2's hand-off (the SQLite adapter renderer is convention-correct). D1's hand-off (the threaded `Lowerer` reaches `toOp`). PG's slice-4 `PostgresCreateTableCall` shape as the structural oracle. The slice-1 `DdlColumn` / `LiteralColumnDefault` / `FunctionColumnDefault` substrate that's been in `relational-core/src/ast/ddl-types.ts` since slice 1 but never used by SQLite.
- **Hands to:** SQLite `CREATE TABLE` planner-emitted SQL is produced via the typed-AST + adapter-lowering path with byte-identity vs pre-slice-5 output, pinned by a test that drives `toOp(lowerer)` end-to-end. `pnpm fixtures:check` green. The slice's named outcome is achieved.
- **Focus:** One `*Call` refactor + the upstream construction site that builds it + the byte-parity test. The `defaultSql: string` production path stays alive in the helpers for `recreateTable`'s use; only the `CreateTableCall` construction path stops producing it.

**Dispatch-INVEST check.** _Independent_ — once D2 lands, D3 only touches `CreateTableCall`'s shape, the one construction site, and the test. _Negotiable_ — outcome names the surfaces; the implementer's grep finds the construction site + mirrors PG's flow. _Valuable_ — closes the slice's named outcome. _Estimable_ — binary: the field shape change is structural (compiler-checked); the byte-parity test asserts exact-string equality across the representative shapes; `pnpm fixtures:check` green. _Small_ — ~3-5 files (op-factory-call + the construction site + the new test + possibly the `renderTypeScript()` update for the new field shape). _Testable_ — `pnpm --filter @prisma-next/target-sqlite typecheck + test` + `pnpm --filter @prisma-next/adapter-sqlite typecheck + test` + the new byte-parity test + `pnpm fixtures:check`.

### Dispatch 4: `SqliteMigration.createTable({...})` authoring method + drop free re-export

- **Outcome:** `SqliteMigration` (the abstract base class at `packages/3-targets/3-targets/sqlite/src/core/migrations/sqlite-migration.ts`) gains a constructor that builds and holds a `controlAdapter: SqlControlAdapter<'sqlite'> | undefined` from `stack?.adapter` and a protected `createTable({ table, columns, constraints?, ifNotExists? })` method that instantiates `SqliteCreateTableCall(...)` and calls `.toOp(this.controlAdapter)` — symmetric with `PostgresMigration.createTable` at `postgres-migration.ts:79-94`. The free `createTable` is removed from `packages/3-targets/3-targets/sqlite/src/exports/migration.ts`. The SQLite facade re-export test at `packages/3-extensions/sqlite/test/migration/re-export.test.ts` is updated to drop (or replace with a "method-on-Migration" comment) the assertion for free `createTable` — mirroring slice 4's commit `0d09f8b0b`. User-facing API change is recorded via `record-upgrade-instructions` at PR-write time.
- **Builds on:** D3's hand-off (the migrated `SqliteCreateTableCall.toOp(lowerer)` is what `Migration.createTable` delegates to). PG's `PostgresMigration.createTable` for the method shape.
- **Hands to:** User-edited SQLite `migration.ts` files use `this.createTable({...})` for new code. Slice DoD met.
- **Focus:** Three small file edits. Does NOT touch planner internals.

**Dispatch-INVEST check.** Unchanged from the original plan's D3 — _Small_ / single new feature with a precedent.

## Handoff contract — linearity + DoD completeness

- **Linearity.** D2 builds on D1. D3 builds on D2 (substrate fix) + D1 (lowerer threading). D4 builds on D3 (migrated `toOp`).
- **DoD completeness.** The slice spec lists three DoD items:
  1. _`CreateTableCall.toOp(lowerer)` lowers via the adapter; live-path grep zero._ → satisfied by **D3**.
  2. _Byte-identical SQL via a `toOp(lowerer)` test; goldens + `fixtures:check` green._ → satisfied by **D3** (D2 is the prerequisite that makes byte-identity attainable).
  3. _Free `createTable` export removed; facade re-export test updated._ → satisfied by **D4**.

## Model-tier routing

D2 (surgical substrate change with a load-bearing convention to mirror) → sonnet. D3 (consumer refactor + byte-parity proof) → sonnet. D4 (small "single new feature" with precedent) → sonnet. Reviewer pass at slice DoD → opus-high.

## Notes for the build loop

- **D2's test-update discipline.** The existing 4 byte-parity tests at `ddl-table-constraints-lowering.test.ts` likely have expected-output literals that encode the buggy unquoted form. The implementer MUST update those expectations to the conventionally-correct form (with a code-comment explaining the convention) — this is not "tests being changed to pass" because the tests' INTENT (the adapter renders correct SQLite DDL) is preserved; the literal oracle was the wrong target. Surface any expectation update that feels like papering over a real bug.
- **D3's `defaultSql` legacy path.** The `defaultSql: string` field on `SqliteColumnSpec` and the upstream `buildColumnDefaultSql` helper still serve `recreateTable` (Phase 2). Keep them; don't refactor `recreateTable` onto the new shape (Phase 2 owns that). D3's grep gate is "`SqliteCreateTableCall` construction site no longer reads `defaultSql`" — not "`buildColumnDefaultSql` deleted."
