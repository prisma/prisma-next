# M3a — Planner + verifier + PSL aggregate resolution + AC7 integration test: slice spec

## Goal

Wire M2's cross-space FK carrier through to actual DB DDL and verification. After this slice an app
contract that declares `Profile.userId → supabase:auth.User.id` (TS or PSL) **lowers to a real FK
constraint in `pg_constraint`**, and the verifier confirms it without trying to own the target table.
No skeleton changes (M3b) — this slice proves the substrate via a synthetic two-contract PGlite
integration test (AC7). One PR.

Branch: `tml-2500-m3-planner-verifier` (already cut from updated `main`, M2 included).
Model tiers: implementer = sonnet; reviewer = opus. TDD mandatory.

## In scope

- **PSL aggregate resolution.** Patch the loaded app contract's cross-space FK target `tableName`s
  from the corresponding extension contracts at the CLI's aggregate-loader boundary, **before**
  handoff to the planner. After this, a PSL cross-space FK no longer carries the symbolic
  `modelName.toLowerCase()` fallback — it carries the real `users` table.
- **PSL↔TS parity test flip.** The deferred-divergence assertion in
  `psl-ts-namespace-parity.test.ts:209-215` flips: PSL and TS now produce byte-identical
  cross-space FK carriers. Add an end-to-end test that drives the resolution through the real
  loader, not a synthetic stub.
- **Planner DDL audit + fix.** The Postgres planner has two FK DDL paths:
  - `renderForeignKeySql` (op-factory, `operations/constraints.ts:14-37`) reads `fk.references.schema`
    correctly.
  - `buildForeignKeySql` (`planner-ddl-builders.ts:228-257`) uses `schemaName` (the *source*
    schema) for the REFERENCES target — a **pre-existing bug** that surfaces when this path runs.
  Audit which path runs for the cross-space FK-add case. If the buggy path is on the hot path, fix
  it; otherwise document the dead/secondary path and add a test that pins the correct path's
  output. The `__bound__` (named target namespace) and `__unbound__` (unqualified `REFERENCES`)
  paths both flow through the existing `qualifyTableName` polymorphism — no change needed there.
- **Verifier confirmation.** `verifyForeignKeys` (`verify-helpers.ts:181-334`) already compares
  contract FK metadata against introspected `pg_constraint` rows without verifying target-table
  existence — so cross-space refs walk identically to local once `tableName` resolves. Prove this
  with a regression test that exercises a cross-space FK through the real verifier.
- **PGlite integration test (AC7).** A synthetic two-contract fixture: app declares
  `Profile.userId → auth.users.id` referencing `supabasePack`, the test (a) bootstraps the
  extension's external tables via `bootstrapSupabaseShim`, (b) runs the CLI's `dbInit` against
  PGlite, (c) queries `pg_constraint` cross-joined with `pg_namespace`/`pg_class` to assert the FK
  exists with the right target schema/table/column, and (d) runs `dbVerify` with **zero issues**.
  Cascade-delete behaviour is part of M3b's skeleton work, NOT this AC7 test (the FK constraint
  existence is what AC7 actually demands).

## Out of scope (hard — these are M3b)

- Wiring the `examples/supabase` walking-skeleton FK (`Profile.userId → auth.User.id`) — M3b.
- The hermetic cascade-delete test against the skeleton — M3b.
- `BuiltStorageTables<Definition>` `spaceId` type-surface cleanup — M3b.
- Runtime cross-space query/traversal (undesigned; future project).

## Decisions to honor (from M1/M2)

- **Resolution at the aggregate boundary, not in the planner.** The planner already receives the
  app contract and has no native visibility into the multi-space aggregate; threading the aggregate
  in would widen its surface for no gain. The CLI's `contract-space-aggregate-loader.ts` already
  holds all extension contracts at the moment it builds the aggregate — patch there.
- **Don't invent a new resolver.** Read the extension contract via its `contract()` accessor on the
  `ContractSpaceMember`, look up the FK target by `model` (the authoritative name M2.4 preserved on
  the relation/FK carrier), and copy the resolved `tableName` + (defensively) re-confirm
  `namespaceId` and `columns`. If the lookup fails (model not found in the named space), throw a
  clear diagnostic — this is a programming error, not a user error (M2 would have rejected
  authoring the FK if the space wasn't composed).
- **Planner stays target-agnostic to extension membership.** It sees a `ForeignKeyReference` with
  `spaceId` + resolved `tableName` and emits the right DDL; it does NOT walk extension contracts.

## Grounded anchors (from the 2026-06-07 read-only investigation)

- **Aggregate loader:** `packages/1-framework/3-tooling/cli/src/utils/contract-space-aggregate-loader.ts`
  (called by `migrate` / `db-verify` / `db-run` / `migration-plan`).
- **Aggregate types:** `createContractSpaceAggregate` at
  `packages/1-framework/3-tooling/migration/src/aggregate/aggregate.ts:269-288`; members carry a
  lazy `contract()` accessor.
- **FK target carrier:** `ForeignKeyReference.spaceId/namespaceId/tableName/columns` —
  `packages/2-sql/1-core/contract/src/ir/foreign-key-reference.ts:39-53`.
- **Planner branch points (cross-space FK):** `issue-planner.ts:269-283` (`missing_table` →
  ForeignKeySpec assembly) and `:564-582` (`foreign_key_mismatch` → ForeignKeySpec). Both read
  `fk.target.namespaceId` and `fk.target.tableName` — no change needed if `tableName` is real.
- **FK DDL emitters (the two paths):** `renderForeignKeySql`
  (`packages/3-targets/3-targets/postgres/src/core/migrations/operations/constraints.ts:14-37`,
  correct) and `buildForeignKeySql`
  (`packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts:228-257`,
  uses source schema for REFERENCES — bug).
- **`qualifyTableName` (polymorphic `__unbound__` elision):**
  `packages/3-targets/3-targets/postgres/src/core/migrations/planner-sql-checks.ts:22-24`.
- **`partitionIssuesByControlPolicy` (already drops `external` target tables from `CREATE TABLE`
  planning):** `packages/2-sql/9-family/src/core/migrations/control-policy.ts:208-318`, called from
  `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:156-164`.
- **Verifier FK walk:** `verifyForeignKeys` —
  `packages/2-sql/9-family/src/core/schema-verify/verify-helpers.ts:181-334`.
  Target-table-agnostic comparison at `:196-212`.
- **Family-layer IR conversion:** `convertForeignKey`
  (`packages/2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts:170-179`) maps
  `fk.target.namespaceId → SqlForeignKeyIR.referencedSchema`; works for cross-space unchanged.
- **PGlite integration harness:** `createDevDatabase` from `@prisma-next/test-utils` — used in
  `skeleton.integration.test.ts` and `planner.reconciliation.integration.test.ts`. Canonical
  `pg_constraint` assertion pattern at `planner.reconciliation.integration.test.ts:779-786` (extend
  with `JOIN pg_namespace`/`pg_class` for cross-schema).
- **Parity test divergence:** `psl-ts-namespace-parity.test.ts:209-215` — `'user'` vs `'users'`.
- **`bootstrapSupabaseShim` (seeds `auth`/`storage` schemas + 4 tables):**
  `packages/3-extensions/supabase/test/supabase-bootstrap.ts:53-98`.

## Acceptance criteria owned by M3a

- **AC2 (final closeout)** — the PSL→TS parity test now agrees on `tableName` (resolved by the
  aggregate loader). The assertion that pinned the divergence flips and a `toEqual(pslFks, tsFks)`
  becomes meaningful.
- **AC3 (planner half)** — the planner emits `REFERENCES "auth"."users"("id")` for a named target
  namespace and unqualified `REFERENCES "users"("id")` for `__unbound__`. Verified by inspecting
  the planner's emitted DDL string for both shapes (synthetic fixture; no live DB needed for this
  AC).
- **AC7 (live-DB integration)** — a PGlite-backed test creates a cross-schema FK from
  `public.profile.user_id` to `auth.users.id`, runs the CLI's `dbInit`, queries `pg_constraint` and
  confirms the FK exists with the right target, and runs `dbVerify` returning zero issues.
- **AC9 (regression)** — existing TML-2459 local cross-namespace FK tests pass unchanged; existing
  local-FK planner/verifier tests pass unchanged.
- **AC10** — `lint:deps` + cast ratchet clean; no new layering violations.

(AC1 / AC4 / AC5 / AC6 / AC8 landed in M1–M2; the `__unspecified__` *DDL* half of AC3 is exercised
above; the walking-skeleton/cascade end of AC7 is M3b.)

## Standing validation gate (per dispatch — M1+M2 babysit lessons)

Before the reviewer is engaged, every dispatch must:
1. `pnpm --filter <changed-pkg> build` and **rebuild dependent `dist`** before any downstream test.
2. **Full `pnpm typecheck`** (not just package-scoped). M2 closed at 138/138 — any failure is yours.
3. The touched packages' `pnpm test` + a re-run of any integration test the dispatch added or
   modified.
4. `pnpm lint:deps` + `pnpm lint:casts` (delta ≤ 0; no new bare `as`) + full `pnpm lint`
   (`biome check --error-on-warnings`).
5. `pnpm fixtures:check` (the resolution change patches values that flow into emitted
   `contract.json`; expect targeted churn for any in-repo fixture that exercises a cross-space FK —
   regenerate, confirm the only change is the now-resolved `tableName`, and report).
6. `pnpm check:upgrade-coverage --mode pr` (touch `instructions.md` per the
   `record-upgrade-instructions` skill if the substrate diff lands under `packages/3-extensions/`
   or `examples/` — for M3a this is unlikely; the work is mostly framework + CLI).
7. Worktree caveat: run a full `pnpm build` once before `fixtures:check` to materialize missing
   `dist` (the worktree's mongo/cli/pgvector may need a fresh build).

Trace events emit **live** per dispatch/round (never back-filled).

## Slice DoD

- AC2 (closeout) + AC3 (planner half) + AC7 + AC9 + AC10 demonstrated by tests through the real
  load/plan/verify path (not synthetic stubs).
- Both FK DDL emitters audited; the buggy `buildForeignKeySql` either fixed or proven dead-on-this-path
  with a regression-pinning test.
- Reviewer SATISFIED across all dispatches; trace backstop passes; PR opened against `main`.
- M3b (the walking-skeleton FK + cascade test + `BuiltStorageTables.spaceId` cleanup) stays out of
  scope — that's the next PR.
