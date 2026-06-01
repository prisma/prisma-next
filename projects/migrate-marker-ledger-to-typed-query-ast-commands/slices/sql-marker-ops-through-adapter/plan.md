# Dispatch plan — SQL DDL AST + contract-free builder (control-table bootstrap consumer)

**Slice spec:** `projects/migrate-marker-ledger-to-typed-query-ast-commands/slices/sql-marker-ops-through-adapter/spec.md`

Sandwich shape: substrate (D1) → per-adapter implementation (D2, D3) → consumer migration (D4). Four dispatches, sequential. Every dispatch is test-first (write the failing test, then the implementation — repo rule) and omits "should" in test descriptions; no transient project IDs in code/test names; no bare casts (`blindCast`/`castAs` if unavoidable).

### Dispatch 1: DDL AST nodes + contract-free builder DDL surface

- **Outcome:** `CreateSchemaAst` and `CreateTableAst` frozen nodes exist in `@prisma-next/sql-relational-core` (`src/ast/types.ts`), are members of `AnyQueryAst` + `queryAstKinds`, and a new contract-free builder module (`src/contract-free/`) constructs them from string identifiers, type/default/pk descriptors, and `ifNotExists` — with unit tests covering construction, frozen-ness, `collectParamRefs() === []`, `rewrite` identity, and the builder's node output for the marker + ledger column shapes.
- **Builds on:** The spec's chosen design; existing `QueryAst` base + `InsertAst`/`UpdateAst` frozen-class pattern.
- **Hands to:** Two exported DDL node classes + the extended `AnyQueryAst` union, and a contract-free builder whose DDL methods (`createSchema`, `createTable`, column helper) emit them. This is the stable surface D2/D3 render and D4 consumes.
- **Focus:** `@prisma-next/sql-relational-core` only. Open Question 1 is **resolved (operator): extend `AnyQueryAst`, DDL is a first-class kind, no runtime throw** — implement it (real DDL handling at each exhaustive `ast.kind` switch in this package: render where applicable, `collectParamRefs() -> []`, `rewrite` identity). Open Question 2 (builder in `src/contract-free/`) is the working position — adopt it. Surface to the Orchestrator only if some `AnyQueryAst` visitor genuinely can't give DDL sensible handling. DML builder methods are out (sibling slice).
- **Gate:** `cd packages/2-sql/4-lanes/relational-core && pnpm typecheck` (+ `tsc -p tsconfig.test.json --noEmit` if test project is separate); `pnpm --filter @prisma-next/sql-relational-core test`; `pnpm --filter @prisma-next/sql-relational-core lint`.

### Dispatch 2: Postgres DDL lowering (byte-matched)

- **Outcome:** The shared Postgres renderer (`@prisma-next/adapter-postgres`, `src/core/sql-renderer.ts`) lowers `CreateSchemaAst`/`CreateTableAst` to Postgres DDL, reachable through `PostgresControlAdapter.lower` and `PostgresAdapterImpl.lower` (byte-identical, the renderer's existing invariant). A test pins the lowered output **byte-equal** to `ensurePrismaContractSchemaStatement`, `ensureMarkerTableStatement`, `ensureLedgerTableStatement`, and the `sql-runtime` `ensureSchemaStatement`/`ensureTableStatement` Postgres shapes. DDL is a first-class query kind (slice spec Open Question 1, resolved): the renderer renders DDL like any other kind — **no runtime throw**; exhaustive `AnyQueryAst` switches in this package gain real DDL handling.
- **Builds on:** D1's DDL nodes + builder DDL surface (`AnyQueryAst` now includes the DDL kinds).
- **Hands to:** Postgres lowering that reproduces today's bootstrap SQL exactly — the byte-equality guarantee D4 relies on to keep golden/fixtures green.
- **Focus:** `@prisma-next/adapter-postgres` renderer + control adapter. Postgres idioms only (`text[]`/`jsonb`/`timestamptz`/`now()`/`bigserial`). No routing yet.
- **Gate:** `cd packages/3-targets/6-adapters/postgres && pnpm typecheck`; `pnpm --filter @prisma-next/adapter-postgres test`; `pnpm --filter @prisma-next/adapter-postgres lint`.

### Dispatch 3: SQLite DDL lowering (byte-matched)

- **Outcome:** The SQLite renderer (`@prisma-next/adapter-sqlite`, `src/core/adapter.ts`) lowers the same DDL nodes to SQLite DDL through its control adapter; a test pins the output byte-equal to the SQLite `ensureMarkerTableStatement`/`ensureLedgerTableStatement` shapes (`TEXT`, `INTEGER PRIMARY KEY AUTOINCREMENT`, `datetime('now')`, no schema qualifier). DDL is a first-class query kind — the renderer renders it, **no runtime throw**.
- **Builds on:** D1's DDL nodes + builder DDL surface. Independent of D2 (different adapter) but listed after it so the byte-equality test idiom established in D2 is reused.
- **Hands to:** SQLite lowering byte-matching today's bootstrap SQL — completes the per-dialect rendering D4 needs for both targets.
- **Focus:** `@prisma-next/adapter-sqlite` only. SQLite idioms; the dialect's lack of a schema namespace (the `CREATE SCHEMA` node lowers to a no-op / is not emitted on SQLite — pin this in the test).
- **Gate:** `cd packages/3-targets/6-adapters/sqlite && pnpm typecheck`; `pnpm --filter @prisma-next/adapter-sqlite test`; `pnpm --filter @prisma-next/adapter-sqlite lint`.

### Dispatch 4: Route control-table bootstrap through the adapter + retire raw constants

- **Outcome:** The Postgres runner `ensureControlTables`, the SQLite runner `ensureControlTables`, and the `family-sql` sign path (`control-instance.ts`) construct bootstrap DDL via the contract-free builder and execute it as `family.lowerAst`/`adapter.lower` → `driver.query(lowered.sql, lowered.params)` instead of running hand-written `CREATE …` strings. The superseded `ensure*Statement` constants in both targets' `statement-builders.ts` and in `sql-runtime/src/sql-marker.ts` are deleted (along with their now-unused exports). The grep gate returns no raw control-table DDL outside the renderer/tests; `fixtures:check` is clean (byte-identical output ⇒ no golden drift).
- **Builds on:** D1 (builder DDL surface) + D2 + D3 (both dialects lower byte-equal). Non-linear: depends on **all** of D1–D3, not just D3.
- **Hands to:** Zero raw control-table DDL strings in scope; bootstrap DDL flows through `adapter.lower()`. The contract-free builder is now exercised by a live consumer — the stable surface the sibling marker-write slice extends with DML.
- **Focus:** `@prisma-next/target-postgres` + `@prisma-next/target-sqlite` runners and `@prisma-next/family-sql` sign path. Marker/ledger *write* routing stays out (sibling slice) — only the `ensureControlTables`/sign-path *schema+table creation* moves.
- **Gate:** `pnpm typecheck` (workspace — exported AST/builder types consumed cross-package); `pnpm lint:deps` (new module + cross-package imports changed); `pnpm fixtures:check`; `pnpm test:integration` (PGlite + SQLite bootstrap paths); `pnpm --filter @prisma-next/family-sql test`; the spec's grep gate.

## Handoff completeness

The final dispatch's hand-off (no raw control-table DDL; bootstrap routed through `lower()`; contract-free builder validated by a live consumer) adds up to this slice's done condition and leaves the two surfaces the sibling marker-write slice's `builds-on` requires (DDL nodes + lowering, contract-free builder). The marker-write SPI, DML builder surface, read/parser dedup, and invariant convergence are explicitly the sibling slice — not reachable from (nor required by) this dispatch sequence.
