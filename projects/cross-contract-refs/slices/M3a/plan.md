# M3a — dispatch decomposition

Slice goal + scope + anchors: see `slices/M3a/spec.md`. One PR; sonnet implementer + opus reviewer.
TDD mandatory. Standing gate per dispatch is in the slice spec.

Sequence (each builds on the prior): **M3a.1 → M3a.2 → M3a.3 → M3a.4.** M3a.1 is the keystone —
without resolved `tableName`s the planner/verifier dispatches can't be properly tested. M3a.4 is the
deliverable test that closes AC7.

## Dispatch M3a.1 — PSL aggregate resolution + parity test flip

- **Outcome:** the CLI's contract-space aggregate loader, immediately after composing
  `[app, ...extensions]`, walks the app contract's cross-space FKs (`fk.target.spaceId !==
  undefined`) and patches `fk.target.tableName` to the **real** table name from the corresponding
  extension contract. Lookup key is `fk.target.namespaceId + ' . ' + fk.references.model` (the
  authoritative model name M2 preserved on the carrier). Defensively re-check that `namespaceId`
  matches the extension's namespace and that all `columns` exist on the resolved target. Throw a
  clear diagnostic on miss — "model `<name>` not found in space `<spaceId>` namespace
  `<namespaceId>`; available models: `<list>`" — this is an internal-error path (M2 rejected
  authoring against an undeclared space) but a precise message saves debug time. The PSL↔TS parity
  test divergence at `psl-ts-namespace-parity.test.ts:209-215` **flips**: the `'user'` assertion
  becomes `'users'`, and a `toEqual(pslFks, tsFks)` end-to-end assertion is added (covers all
  carrier fields).
- **Builds-on:** nothing (first M3a dispatch, the keystone).
- **Hands-to:** M3a.2 (planner now sees the real `tableName`), M3a.3 (verifier likewise), M3a.4
  (the live-DB test relies on the resolved carrier).
- **Focus:** `packages/1-framework/3-tooling/cli/src/utils/contract-space-aggregate-loader.ts` (the
  patching site) + a new helper in the same package or `migration-tools` (small, target-agnostic);
  `packages/2-sql/2-authoring/contract-psl/test/psl-ts-namespace-parity.test.ts` (the assertion
  flip + the new `toEqual` assertion driven through the real loader if reachable from this test,
  otherwise an integration test alongside it).
- **dispatch-INVEST:** Small (one resolution function + one patching site + assertion flip);
  Testable (parity test is the canonical failing-then-passing case + a unit test for the lookup
  helper's miss diagnostic); Valuable (every downstream dispatch needs it).

## Dispatch M3a.2 — Planner DDL audit + buggy-path fix

- **Outcome:** the Postgres planner emits a correct cross-schema `REFERENCES` for both
  `__bound__` (qualified, `"auth"."users"`) and `__unbound__` (unqualified, `"users"`) cross-space
  FK targets. Audit which FK DDL emitter — `renderForeignKeySql` (op-factory) vs
  `buildForeignKeySql` (planner-ddl-builders) — runs on the cross-space FK-add hot path. If
  `buildForeignKeySql` is dead on this path, add a regression test pinning that fact (and
  optionally delete the dead code in a scope-noted side commit if it's clearly unused). If it's
  live, **fix the bug** (it uses the source schema for REFERENCES; should use
  `foreignKey.target.namespaceId`) and add a test that would have caught the bug.
- **Builds-on:** M3a.1 (without resolved `tableName`, the synthetic fixture's emitted DDL would
  contain the symbolic `user`, not the real `users`).
- **Hands-to:** M3a.3 (verifier) and M3a.4 (integration test).
- **Focus:** `packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts`
  + `operations/constraints.ts` + `issue-planner.ts`. New unit tests in
  `packages/3-targets/6-adapters/postgres/test/migrations/` (synthetic two-contract fixture; assert
  the emitted DDL string for the FK-add op, both qualified and unqualified target namespaces).
- **dispatch-INVEST:** Small if `buildForeignKeySql` is dead (just an audit + a pinning test);
  Small-medium if it needs a fix (one-line change + test). The hardest part is the audit, not the
  code change.

## Dispatch M3a.3 — Verifier confirmation + regression test

- **Outcome:** `verifyForeignKeys` walks a cross-space FK identically to a local FK and matches
  against the introspected `pg_constraint` row when the target schema/table/columns agree. No new
  code expected (the comparison is already target-table-agnostic). A new test exercises a
  cross-space FK through the real `verifySqlSchema` path with a stub `SqlSchemaIR` containing the
  introspected FK; asserts zero issues when they agree and the expected `FOREIGN_KEY_MISMATCH`
  issue when they don't. Also confirms that the verifier does **not** try to look up the cross-
  space target table in the app contract's namespaces (no `MISSING_TABLE` issue for `auth.users`).
- **Builds-on:** M3a.1 (resolved `tableName`).
- **Hands-to:** M3a.4 (the integration test goes end-to-end through the verifier).
- **Focus:** test only — `packages/2-sql/9-family/test/schema-verify/` (or wherever
  `verifyForeignKeys` is currently tested). If a code change does turn out to be needed (e.g. a
  control-policy disposition edge case the investigation missed), keep it minimal and document why.
- **dispatch-INVEST:** Small (mostly tests).

## Dispatch M3a.4 — PGlite integration test (AC7)

- **Outcome:** a new PGlite-backed integration test creates a cross-schema FK end-to-end. Steps:
  (1) compose an app contract that declares `extensionPacks: [supabasePack]` + a `Profile` model
  with `userId String @unique` + `rel.belongsTo(AuthUser, …)` + `constraints.foreignKey(cols.userId,
  AuthUser.refs.id, { onDelete: 'cascade' })`; (2) materialize the supabase extension space
  artefacts on disk (`emitContractSpaceArtefacts`); (3) bootstrap PGlite via `createDevDatabase` +
  call `bootstrapSupabaseShim` to seed `auth.*` + `storage.*` external tables; (4) run the CLI's
  `dbInit` (apply mode); (5) query `pg_constraint` (cross-joined with `pg_namespace`/`pg_class`)
  and assert the FK exists with `referencedSchema='auth'`, `referencedTable='users'`,
  `referencedColumns=['id']`; (6) run `dbVerify` and assert zero issues across both spaces. This is
  the AC7 deliverable.
- **Builds-on:** M3a.1 + M3a.2 + M3a.3 (the full chain must work).
- **Hands-to:** slice DoD.
- **Focus:** a new test file under `packages/3-extensions/supabase/test/` (the supabase package
  already has the PGlite + shim infrastructure) or — if cleaner — a new dedicated
  cross-contract-refs integration package. Reuses `bootstrapSupabaseShim`. Does **not** modify
  `examples/supabase/` (that's M3b).
- **dispatch-INVEST:** Small-medium (one new test file with several setup steps but a short
  assertion surface). Testable end-to-end; Valuable (closes AC7).

## Slice DoD (gate for closing M3a)

- AC2 (closeout) + AC3 (planner half) + AC7 + AC9 + AC10 PASS through real load/plan/verify.
- Both FK DDL emitters audited; the buggy path either fixed with a test or pinned as dead.
- All four dispatches reviewer-SATISFIED; trace backstop passes (cumulative dispatch count
  bumps to **13** = M1's 3 + M2's 6 + M3a's 4); PR opened against `main`.
- No `examples/` change, no `BuiltStorageTables` type-surface change (M3b).

## Open items (deferred from M3a — recorded for M3b)

- Walking-skeleton wiring: `examples/supabase/src/contract.prisma` adds `userId String @unique` +
  `user supabase:auth.User @relation(fields:[userId], references:[id], onDelete: Cascade)`;
  regenerate `contract.json`/`contract.d.ts`/migration files.
- Hermetic cascade-delete test in `examples/supabase/test/skeleton.integration.test.ts` (extend or
  add a second `it`); use `withClient` to seed `auth.users` + `public.profile`, DELETE the
  `auth.users` row, assert the `public.profile` row is gone.
- `BuiltStorageTables<Definition>` type-surface cleanup: add `readonly spaceId?: string` to the
  FK target object at `packages/2-sql/2-authoring/contract-ts/src/contract-types.ts:536-539`. Pure
  type-level; runtime already emits it. Existing M2 tests that used a record cast can drop the
  cast.
