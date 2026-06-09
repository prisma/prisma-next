# postgres-rls — Plan

**Spec:** `projects/postgres-rls/spec.md`
**Linear Project:** [Postgres RLS](https://linear.app/prisma-company/project/postgres-rls-b7329340dbb2) · project issue [TML-2501](https://linear.app/prisma-company/issue/TML-2501) · parent umbrella [Supabase Integration](https://linear.app/prisma-company/project/supabase-integration-08e7667f5de4)

## At a glance

**Tracer-bullet first, then thicken.** After the IR foundation, the next slice is a thin **vertical** thread — PSL → IR → `CREATE POLICY` → live PGlite → `SET ROLE` → rows actually filtered — that proves every layer connects and demonstrates real RLS behavior. Only then do we widen into breadth (full authoring, full ops + verifier), converging on a Supabase-flavored walking skeleton. All hard dependencies have landed; no external blockers.

> **Reshaped 2026-06-08** from the original consumer-less "foundation → authoring ∥ ops → verifier" diamond. The foundation slice (TML-2868, shipped) had no consumer — reachable only through synthetic fixtures — so the remaining slices were re-cut around a tracer bullet. Rationale + lesson in [`learnings.md`](learnings.md) (L1).

```
1. Foundation ✅ (TML-2868, PR #771)
      │
2. PSL tracer bullet  ──  PSL policy_select → IR → CREATE POLICY + ENABLE RLS → PGlite proves filtering
      │
      ├── 3. Authoring breadth  (TS surface + parity, remaining PSL ops, diagnostics) ──┐
      └── 4. Migration + verifier breadth  (full ops + diff/rename + verifier) ─────────┤
                                                                                         │
                                                  5. Cross-space roles + Supabase walking skeleton
```

The tracer (2) is the near-root every later slice extends. Breadth slices 3 and 4 are independent (authoring vs migration/verifier) and run in **parallel**. Slice 5 converges them and adds the Supabase flavor + cross-space role resolution.

Per-slice spec + plan (`slices/<slice>/{spec,plan}.md`) are authored at slice-pickup time by `drive-specify-slice` / `drive-plan-slice` — not now. Project close-out (promote the content-addressed-naming ADR, subsystem doc, delete the project dir) is the project-DoD close via `drive-close-project`, **not** a slice.

## Composition

### Done

1. **Slice `foundation`** — Linear: [TML-2868](https://linear.app/prisma-company/issue/TML-2868) · **shipped, PR [#771](https://github.com/prisma/prisma-next/pull/771)**
   - **Outcome:** `PostgresRlsPolicy` + `PostgresRole` IR kinds, registered as `entityTypes` entity kinds (incl. `PostgresRole` as the `role` kind populating `entries['role']` that PSL `roles = [...]` refs bind against); `StorageTable.rls`; canonical normalizer + 8-hex content-hash; lossless `PostgresContractSerializer` round-trip + arktype validator schemas; framework `SchemaIssue` union widened with `rls_policy_renamed|rls_policy_tampered|rls_not_enabled`. Reachable only through synthetic fixtures (the smell that prompted the reshape — see L1).
   - **Hands to:** the IR shapes + `role` entity kind + `computeContentHash`/`normalizePredicate` + serializer round-trip that every later slice consumes.

### Near-root — the tracer bullet

2. **Slice `psl-tracer`** — Linear: [TML-2869](https://linear.app/prisma-company/issue/TML-2869)
   - **Outcome:** the thinnest **vertical** thread that demonstrates RLS working. A PSL `policy_select` block on **one** table with **one same-space declared role** and a `using` predicate → lowers to `PostgresRlsPolicy` IR (consuming slice 1) → just two migration ops, `CreatePostgresRlsPolicyOp` + `EnableRowLevelSecurityOp`, emit `CREATE POLICY` + `ENABLE ROW LEVEL SECURITY` → a hermetic **PGlite** test declares the policy, applies the migration, sets the role (`SET ROLE` / `current_setting`-based predicate), and **asserts rows are filtered**. The first observable behavior.
   - **Builds on:** slice 1 (IR + content-hash + serializer).
   - **Hands to:** a proven PSL→IR→DDL→live-DB thread, plus the PSL authoring path + the two ops that slices 3 and 4 extend.
   - **Focus:** depth over breadth. Same-space role only (no cross-space machinery); `policy_select` only (no other operations); Create+Enable only (no Drop/Alter/Disable, no diff/rename); no full verifier; no TS surface; no Supabase shim. Plain hermetic test, not the `examples/supabase` app.

### Breadth — both build on the tracer, independent of each other (parallel)

3. **Slice `authoring-breadth`** — Linear: [TML-2870](https://linear.app/prisma-company/issue/TML-2870)
   - **Outcome:** the full authoring surface lowering to identical IR (TS/PSL parity test). **TS** top-level Postgres-contributed policy helpers taking the model handle (Option C — the `enum`/`entityTypes` mechanism, invisible to SQLite/Mongo; **not** a model-builder method), the `ref()` predicate helper reading `{namespaceId,tableName}` off `extensionModel(…)` handles, model-level RLS enable/disable, duplicate-prefix/duplicate-name diagnostics. **PSL** the remaining per-operation blocks (`policy_insert|policy_update|policy_delete|policy_all`) beyond the tracer's `policy_select`, with cross-contract `target` rejected at load time. Same-space roles; **cross-space role resolution is slice 5.**
   - **Builds on:** slice 2 (extends the PSL authoring path + the role entity kind).
   - **Hands to:** a contract (TS or PSL) producing the full RLS IR shape.
   - **Focus:** authoring + lowering breadth only. No planner/verifier. Settles the residual signature decision (**per-operation vs array** helper form) and Q5 (two-body-form ADR likely subsumed by the substrate's ADR).

4. **Slice `migration-verifier-breadth`** — Linear: [TML-2871](https://linear.app/prisma-company/issue/TML-2871)
   - **Outcome:** the remaining ops — `DropPostgresRlsPolicyOp`, `AlterPostgresRlsPolicyOp`, `DisableRowLevelSecurityOp` — per ADR 195's `OpFactoryCall` pattern, plus the full diff algorithm (compare declared vs introspected by full wire name → Create/Drop/Alter; `ALTER POLICY … RENAME TO` for matching-hash-different-prefix; drop+create fallback for shapes Postgres can't ALTER in place, spec Q4). And the full `PostgresSchemaVerifier.verifyTargetExtensions()` (the empty stub): introspect `pg_policies`/`pg_class.relrowsecurity`, emit missing/extra/`rls_policy_tampered`/`rls_policy_renamed`/`rls_not_enabled` with severity via the control-policy two-layer dispatch (`classifySqlVerifierIssueKind` → `dispositionForCategory`). AC8: a manual `ALTER POLICY … USING(reformatted)` is `tampered`, not false drift.
   - **Builds on:** slice 2 (extends the tracer's two ops to the full set; constructs from synthetic IR — does not need the authoring breadth).
   - **Hands to:** the full emit + verify halves that slice 5's end-to-end run drives.
   - **Focus:** ops + diff + verifier breadth. Provable by op/DDL snapshot tests + PGlite verifier tests against synthetic IR. `missing_role` / `pg_roles` existence check lands with cross-space roles in slice 5.

### Convergence — Supabase walking skeleton

5. **Slice `supabase-skeleton`** — Linear: [TML-2876](https://linear.app/prisma-company/issue/TML-2876)
   - **Outcome:** **cross-space role-ref resolution** — roles from another contract space (the Supabase pack's `anon`/`authenticated`) are `scope: 'cross-space'` refs; the substrate's cross-space validation is a deliberate no-op pass-through deferred to its first consumer — us (`psl-extension-block-validator.ts:276-284`); wire it through the `(spaceId, namespaceId, 'role', name)` coordinate, reusing cross-contract-refs' aggregate machinery; add the verifier's `missing_role` / `pg_roles` existence check (a `fail` even under `external`). **Walking skeleton:** `bootstrapSupabaseShim` extended with the Postgres roles + `auth.uid()`/`auth.jwt()`/`auth.role()` GUC-reading SQL functions; `examples/supabase` `Profile` gains `anon` SELECT + `authenticated` UPDATE-own policies; an end-to-end PGlite test proves the full feature round-trips against a Supabase-flavored setup and the verifier diffs clean.
   - **Builds on:** slice 3 (authoring, to declare the example policies + the role-declaration surface cross-space extends) **and** slice 4 (full verifier, for `missing_role` + diff-clean).
   - **Focus:** the cross-space role machinery (the riskiest authoring work, deliberately isolated here) + the Supabase-flavored end-to-end proof. `extension-supabase` consumes the result.

## Dependencies (external)

- [x] **target-extensible-ir (TML-2459)** — done & closed. IR base, SPI seams, `entityTypes`, `__unbound__` sentinel all available.
- [x] **control-policy (TML-2493)** — done & closed. Two-layer verifier/planner dispatch live (ADR 224).
- [x] **target-contributed-psl-blocks substrate (slices 1–3)** — landed. Declarative `AuthoringPslBlockDescriptor` SPI usable for the `policy_*` keywords. (Slice 4 ADR/close-out still open, but does not block consumption.)
- [x] **cross-contract-refs (TML-2500) M1+M2+M3a** — merged. `extensionModel(…)` handles + `TargetFieldRef<TSpaceId>` available for the TS `ref()` helper. (M3b in flight; not a blocker.)

## Sequencing rationale

**Tracer-first over foundation-first.** The dominant risk in this project is integration — does PSL lower to IR, does IR emit correct DDL, does that DDL make Postgres actually filter rows — not any single layer's internal correctness. So after the IR floor (slice 1, already shipped), slice 2 is a **tracer bullet**: the thinnest vertical thread that exercises every layer for one case (PSL `policy_select`, one same-space role, Create+Enable, PGlite filtering proof). It is the new near-root — slices 3 and 4 extend its authoring path and its ops. This trades some of the original diamond's parallel-dispatch throughput for a working demo and early de-risking of the scariest seam; given the risk profile that is the right trade (see `learnings.md` L1).

**Breadth parallelizes, then converges.** Authoring breadth (3) and migration/verifier breadth (4) are genuinely independent — ops construct from synthetic IR and never touch the authoring surface — so they run in **parallel** off the tracer. Slice 5 converges them and carries the two deliberately-isolated hard parts: **cross-space role-ref resolution** (the substrate defers cross-space enforcement to its first consumer — us; the riskiest authoring work) and the **Supabase-flavored walking skeleton** (`examples/supabase` + `bootstrapSupabaseShim` + `auth.*` GUC functions), which needs both halves present to diff clean against `pg_policies`.

**Roles as references (cross-cutting).** `roles = [...]` are static refs to declared `role` entities, not strings. Slice 1 registered `PostgresRole` as the `role` entity kind so refs can bind; the tracer (2) and authoring breadth (3) use **same-space** declared roles (resolve without cross-space machinery); **cross-space** resolution + the verifier's `pg_roles` existence check (`missing_role`) are isolated in slice 5 where the Supabase pack's `anon`/`authenticated` first arrive. Authoring-time resolution (does `anon` name a declared role?) and verify-time existence (is it in the database?) are distinct checks, both in slice 5.

**Linear sync:** the project issue TML-2501 and the slice issues live in the dedicated [Postgres RLS](https://linear.app/prisma-company/project/postgres-rls-b7329340dbb2) Linear project. After the 2026-06-08 reshape (tracer-first), the mapping is: TML-2868 `foundation` (done) → **TML-2869 `psl-tracer`** → **TML-2870 `authoring-breadth`** ∥ **TML-2871 `migration-verifier-breadth`** → **TML-2876 `supabase-skeleton`**. Blocking relations: 2869 blockedBy 2868; 2870 & 2871 blockedBy 2869; 2876 blockedBy 2870 & 2871. Tickets re-scoped from the original "authoring / migration-ops / verifier+skeleton" cut on 2026-06-08.
