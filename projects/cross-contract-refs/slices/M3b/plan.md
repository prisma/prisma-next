# M3b — dispatch decomposition

Slice goal + scope + anchors: see `slices/M3b/spec.md`. One PR; sonnet implementer + opus reviewer.
TDD mandatory. Standing dispatch gate (per dispatch) is in the slice spec § "Standing dispatch gate".

Sequence (each builds on the prior): **M3b.1 → M3b.2 → M3b.3 → M3b.4.** M3b.1 (type cleanup) is
independent and landed first for diff legibility. M3b.2 (substrate fix — typeParams empty-state
equivalence) was inserted 2026-06-08 as an operator-authorized scope shift after the original M3b.2
attempt halted on the substrate gap; it unblocks the walking-skeleton path. M3b.3 (walking-skeleton
PSL + CLI regenerate, previously M3b.2) reads the fixed substrate. M3b.4 (cascade test, previously
M3b.3) is the deliverable test that closes AC4/AC7's walking-skeleton ends.

**Total dispatches (per trace.jsonl): 5.** The 5th is M3b.2-original (the walking-skeleton's first
attempt, dispatch_id `e1f3fbf1-…`) which ran 4 rounds before halting on the substrate gap and ended
with `result: failed`. Operator authorized the substrate-fix scope shift, the dispatch was abandoned,
and the work was replaced by M3b.2 (new, substrate fix — dispatch_id `d8c870c8-…`) + M3b.3
(re-attempted walking-skeleton — dispatch_id `9d76b3cb-…`). The failed dispatch is historical and
is included in the dispatch count for trace-integrity purposes.

## Dispatch M3b.1 — `BuiltStorageTables.spaceId` type addition + M2.3 cast drops

**Status: COMPLETE** (commits `cf2cd490f` + `df0753207`; reviewer SATISFIED 2026-06-08).

- **Outcome:** `BuiltStorageTables<Definition>`'s FK target object at
  `packages/2-sql/2-authoring/contract-ts/src/contract-types.ts:535-539` carries
  `readonly spaceId?: string` (optional, alongside `namespaceId`, `tableName`, `columns`). The M2.3
  record cast at `cross-space-relation.test.ts:300` AND the sibling cast at
  `contract-handles.test.ts:139-142` (F1) drop to typed reads. The cast drops are verifiable in
  the commit diff; `pnpm lint:casts` does NOT measure test-file casts per the `no-bare-cast.grit`
  plugin's exclusion rule, so the ratchet metric does not move.
- **Builds on:** the spec's chosen design — purely additive. Independent of the example app.
- **Hands to:** "the FK target type carries optional `spaceId`; the M2.3 + sibling cast sites read
  it type-safely." Downstream dispatches don't depend on M3b.1.
- **Focus:** `packages/2-sql/2-authoring/contract-ts/src/contract-types.ts` + the two test files.
- **dispatch-INVEST:** "Surgical substrate change" pattern — one type-level change, narrow surface.

## Dispatch M3b.2 — `typeParams` empty-state equivalence (substrate fix; NEW 2026-06-08)

- **Outcome:** the runtime validator (`packages/2-sql/5-runtime/src/sql-context.ts:483-495`,
  `assertColumnCodecIntegrity`) accepts `typeParams: {}` AND missing as equivalent empty — only
  rejects when `typeParams` has actual keys against a non-parameterized codec. The PSL interpreter
  (`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:571-577`) no longer writes
  `typeParams: {}` when the descriptor has no params (emits omit-when-empty). The IR shape is
  reconciled across `StorageTypeInstance.typeParams` (currently required) and
  `StorageColumn.typeParams` (currently optional) — implementer picks the smaller diff that
  expresses "object's empty state is canonical at every boundary." Any in-repo `contract.json`
  fixtures whose typeParams representation flips are re-emitted (Supabase extension's contract.json
  is the obvious one; `pnpm fixtures:check` reveals others if any).
- **Builds on:** nothing in M3b.1; this is a fresh substrate fix triggered by M3b.2's prior
  (failed) attempt to wire the walking-skeleton through the runtime path.
- **Hands to:** "the substrate accepts the supabase extension's `Uuid = String @db.Uuid` named-type
  pattern through both the PSL→IR→JSON path AND the runtime client's contract validation path,
  consistently — `examples/supabase` can use the canonical `types {}` block and the runtime loads
  cleanly."
- **Focus:** the 4 surfaces named above. **Do NOT touch:** codec descriptor registration (no new
  `pg/uuid` codec), the PSL grammar surface, the FK carrier shape, the planner, the verifier. The
  fix is purely about the equivalence of two ways of saying "empty" at the typeParams slot.
- **dispatch-INVEST:** matches the calibration's "Surgical substrate change" pattern. Outcome is
  binary (validator accepts both forms; emitter writes canonical form; runtime client loads the
  Supabase `Uuid`-using example). Testable via: existing typecheck (138/138); existing test suite
  (no regressions); a new targeted unit test asserting the validator accepts both `{}` and missing
  for non-parameterized codecs; `pnpm fixtures:check` shows expected churn in any in-repo
  contract.json fixtures (supabase extension at minimum).

## Dispatch M3b.3 — Walking-skeleton PSL + CLI regenerate + M1 handler/test adjustment (was M3b.2 pre-2026-06-08; scope expanded 2026-06-08 M3b.3 R1)

- **Outcome:** `examples/supabase/src/contract.prisma` declares a local
  `types { Uuid = String @db.Uuid }` block, and `Profile` gains `userId Uuid @unique` +
  `user supabase:auth.AuthUser @relation(fields:[userId], references:[id], onDelete: Cascade)`
  field declarations inside `namespace public { model Profile { ... } }`. Running
  `pnpm --filter @prisma-next/example-supabase emit` regenerates
  `examples/supabase/src/contract.json` + `examples/supabase/src/contract.d.ts`; the regenerated
  JSON contains the cross-space FK with `target.spaceId === 'supabase'`,
  `target.namespaceId === 'auth'`, `target.tableName === 'users'`, `columns === ['id']`, and
  `onDelete === 'cascade'`. `pnpm fixtures:check` is clean (the only churn is the expected new
  FK + new column + new unique constraint in this one example). The existing M1 walking-skeleton
  `it` block continues to pass against the regenerated contract — including the `db.connect`
  runtime path that previously failed in M3b.2's original (pre-substrate-fix) attempt.
  **No committed migration files change** — `examples/supabase/migrations/` is not on disk.
- **Builds on:** M3b.2's hand-off (the runtime accepts the supabase extension's `Uuid` named
  type), plus M2.4 (PSL `supabase:auth.AuthUser` colon-prefix grammar), M2.3 (extension brand
  exposure for `AuthUser`), and M3a.1 (the aggregate loader's `tableName` resolution).
- **Hands to:** "`examples/supabase/src/contract.json` declares the cross-space FK in its
  canonical lowered shape; the regenerated `contract.d.ts` exposes it; the existing M1 `it`
  remains green; no committed migration file change."
- **Focus:** `examples/supabase/src/contract.prisma` + `examples/supabase/src/contract.json` +
  `examples/supabase/src/contract.d.ts`. The implementer runs `pnpm --filter
  @prisma-next/example-supabase emit` to regenerate; if the CLI doesn't produce a contract.json
  that declares the FK with the expected target coordinates, **stop and report**. Do NOT
  hand-edit `contract.json` or `contract.d.ts`.
- **dispatch-INVEST:** "Fixture regen + replay probe" pattern. Outcome binary. Verification:
  `fixtures:check` clean (modulo the example app's expected churn) + `pnpm --filter
  @prisma-next/example-supabase test` runs the existing M1 `it` against the new contract.json
  and the new runtime-validator semantics.

## Dispatch M3b.4 — Hermetic cascade-delete `it` (was M3b.3 pre-2026-06-08)

- **Outcome:** `examples/supabase/test/skeleton.integration.test.ts` carries a second `it` block
  alongside the existing M1 walking-skeleton test. The new `it`:
  1. Calls `bootstrapSupabaseShim` (existing) to seed `auth.*` schemas.
  2. Materialises the supabase extension space via `emitContractSpaceArtefacts` (existing pattern).
  3. Runs `client.dbInit({ mode: 'apply' })` against PGlite — this creates `public.profile` with
     the cross-schema FK `ALTER TABLE "public"."profile" ADD CONSTRAINT ... FOREIGN KEY ("userId")
     REFERENCES "auth"."users"("id") ON DELETE CASCADE`.
  4. In a single `withClient` block: INSERTs a row into `auth.users` (id uuid via
     `crypto.randomUUID()`, email text, both timestamps), INSERTs a referencing row into
     `public.profile`, asserts the profile row is present, DELETEs the auth.users row, asserts
     the profile row was cascade-deleted (`SELECT COUNT(*) FROM public.profile WHERE "userId"=$1`
     returns `0`).
  The `it` passes against PGlite via `pnpm --filter @prisma-next/example-supabase test`. The
  existing M1 `it` block remains unchanged and still passes.
- **Builds on:** M3b.3's hand-off — the cascade test reads `contractJson` at test runtime;
  without M3b.3's FK declaration, the emitted DDL has no FK.
- **Hands to:** the slice DoD. AC4 (live-DDL end) + AC7 (walking-skeleton end) close.
- **Focus:** `examples/supabase/test/skeleton.integration.test.ts` only. No production code
  changes. Reuses existing imports + helpers.
- **dispatch-INVEST:** "Single-package new feature" pattern. Outcome binary (test passes).

## Slice DoD (gate for closing M3b)

- AC4 (live-DDL end: `ON DELETE CASCADE` in emitted DDL + cascade fires in live DB) +
  AC7 (walking-skeleton end of AC7) PASS through the example app's normal generate flow and
  the new cascade-delete `it`.
- Project § "Walking-skeleton integration" both checklist items closed.
- All four dispatches reviewer-SATISFIED; trace backstop passes (cumulative dispatch count
  bumps to **17** = M1's 3 + M2's 6 + M3a's 4 + M3b's 4); PR opened against `main`.
- M3b.1's cast drops verifiable in commit diff (lint:casts ratchet does not move — test-file
  exclusion in the no-bare-cast plugin).
- M3b.2's substrate fix: runtime validator accepts equivalent empty forms; PSL emitter writes
  canonical empty (omit-when-empty); IR shape consistent; supabase extension contract.json
  re-emitted to match.
- M3b.3's `examples/supabase/src/contract.json` + `contract.d.ts` are CLI-regenerated, not
  hand-edited.
- M3b.4's cascade test passes; no change to `examples/supabase/src/handlers.ts`.
- The existing M1 walking-skeleton `it` continues to pass unchanged.

## After M3b lands

Only **M4 (documentation + close-out)** remains for the project. M4's tasks are listed in
`projects/cross-contract-refs/plan.md` § M4 — Documentation + close-out: subsystem doc update,
extension-authoring guidance (skill or rulecard) including the typeParams empty-state convention
and the PSL `@db.X` placement rule (per `learnings.md`), ADR promotion if any drafts were produced,
umbrella `decisions.md` update marking the project ✅ shipped, and the close-out delete of
`projects/cross-contract-refs/` per the project workflow rule.
