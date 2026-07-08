# Slice 4 — implicit M:N synthesis — Dispatch plan

**Slice spec:** `projects/psl-relation-syntax/slices/04-implicit-mn-synthesis/spec.md`
**Linear:** [TML-2943](https://linear.app/prisma-company/issue/TML-2943)

Two dispatches. M1 front-loads the feasibility halt; M2 proves it downstream.

## M1 — Detection + synthesis of the model-less junction (feasibility-gated)

- **Outcome:** an implicit M:N (both ends bare, no junction model) emits a contract carrying a synthesised `_<A>To<B>` table (cols `A`/`B`, composite PK, FKs to the two model ids) + `N:M`/`through` on both ends, round-tripping `validateContract`; D5 precedence preserved.
- **Builds on:** slice 2's `through` lowering shape (the descriptor it emits) + slice 3 (no conflict).
- **Hands to:** the synthesised junction contract the migration + runtime consume.
- **Focus:** **first confirm the contract IR can hold a model-less storage table** (the § Feasibility halt) — read the storage-table IR + how `interpreter.ts` builds tables from models; if synthesis can't be injected cleanly within slice scope, HALT and surface. Then: detect the synthesise case in the bare-list path; inject the `_AToB` table (decision #7 naming) + emit the `through` on both ends; reuse the slice-2 `through`-descriptor machinery. Diagnostics for the edge cases (no `@id`; two implicit M:N between the same pair; name collision with a real table).
- **Completed when:**
  - [ ] `pnpm --filter @prisma-next/sql-contract-psl test` green with: an implicit-M:N lowering test (synthesised table + `N:M`/`through`, `toEqual` on `Contract` + `validateSqlContractFully`); the D5-precedence control (both-bare-with-junction-model → recognised, **not** synthesised); the no-`@id` / ambiguous / collision diagnostics.
  - [ ] `cd packages/2-sql/2-authoring/contract-psl && pnpm typecheck` + `lint` clean.
- **Halt conditions:**
  - The contract IR / validator can't accept a model-less storage table within slice scope → **HALT + surface** (re-scope signal).
  - Two implicit M:N between the same pair collide on the synthesised name → diagnostic (don't silently clobber).

## M2 — Migration DDL + runtime integration

- **Outcome:** the synthesised junction is created by `migrate` (postgres + sqlite), and `db.orm.<Model>.include(<m2n>)` over an implicit M:N returns the related rows.
- **Builds on:** M1's synthesised contract.
- **Hands to:** implicit M:N parity with Prisma (the slice's downstream DoD).
- **Focus:** confirm the migration pipeline emits `CREATE TABLE _AToB` + composite PK + the two FKs for postgres **and** sqlite (it should, as a normal contract table — if it needs threading, that's the real work here); a PSL fixture authored as an implicit M:N (both bare, no junction), emitted + migrated; an `include` integration test (whole-row, ≥1 implicit; PGlite). `pnpm build` before integration/`fixtures:check`.
- **Completed when:**
  - [ ] A migration/DDL test shows the synthesised table created on postgres + sqlite.
  - [ ] The implicit-M:N `include` integration test passes (PGlite).
  - [ ] `pnpm fixtures:check` clean (after `pnpm build`).
- **Halt conditions:**
  - The migration pipeline rejects / can't create the model-less table → surface (may need its own dispatch).

## Hand-off completeness

M1 (synthesis into the contract) + M2 (migration creates it, runtime walks it) compose to the slice-DoD: implicit M:N authored as bare lists works end-to-end, with D5 precedence intact. The feasibility halt on M1 is the guard against the slice being bigger than scoped.
