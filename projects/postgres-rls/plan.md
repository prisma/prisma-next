# postgres-rls — Plan

**Spec:** `projects/postgres-rls/spec.md`
**Linear Project:** [Postgres RLS](https://linear.app/prisma-company/project/postgres-rls-b7329340dbb2) · project issue [TML-2501](https://linear.app/prisma-company/issue/TML-2501) · parent umbrella [Supabase Integration](https://linear.app/prisma-company/project/supabase-integration-08e7667f5de4)

## At a glance

Four slices in a **Sandwich-pattern diamond**: an IR/contract foundation, then authoring and migration-ops in **parallel** off it, converging on a verifier + walking-skeleton slice that proves RLS round-trips against a live Postgres. All hard dependencies have landed, so there are no external blockers; the only sequencing is internal (IR-first).

```
        ┌── 2. Authoring surfaces ──┐
1. Foundation                        ├── 4. Verifier + walking skeleton
        └── 3. Migration ops ───────┘
```

Per-slice spec + plan (`slices/<slice>/{spec,plan}.md`) are authored at slice-pickup time by `drive-specify-slice` / `drive-plan-slice` — not now. Project close-out (promote the content-addressed-naming ADR, subsystem doc, delete the project dir) is the project-DoD close via `drive-close-project`, **not** a slice.

## Composition

### Stack root

1. **Slice `foundation`** — Linear: [TML-2868](https://linear.app/prisma-company/issue/TML-2868)
   - **Outcome:** `PostgresRlsPolicy` and `PostgresRole` exist as Postgres-target-only IR kinds **and as `entityTypes`-contributed entity kinds** (registered via `postgresAuthoringEntityTypes`, following the `PostgresEnumType` precedent), so they populate `PostgresSchema.entries` under their kind keys — critically, `PostgresRole` lands as a **`role` entity kind populating `entries['role']`**, which is what PSL ref-resolution binds `roles = [anon, …]` against (refs resolve by `entries[refKind][name]`; with no `role` kind there is nothing for a `refKind: 'role'` ref to find). `StorageTable` carries `rls: 'auto'|'enabled'|'disabled'`; the canonical predicate normalizer + 8-hex content-hash compute deterministic wire names; `PostgresContractSerializer` round-trips all new fields losslessly; the framework `SchemaIssue` union is widened with `rls_policy_renamed|rls_policy_tampered|rls_not_enabled` (additive, `EnumValuesChangedIssue` precedent). Reachable only through synthetic test fixtures.
   - **Builds on:** None (all framework/family/target substrate landed).
   - **Hands to:** The IR class shapes + the `model`/`role`/policy entity kinds in `entries[…]` that slice 2's ref-resolution binds against + `computeContentHash`/`normalizePredicate` + serializer round-trip that slices 2–4 all consume.
   - **Focus:** IR + entity-kind registration + naming + serializer + union widening only. No authoring helpers, no planner, no verifier. `pnpm lint:deps` proves framework/SQL-family layers carry no RLS reference. Settles spec open-question D1 (union widening) and Q2 (normalizer home).

### Parallel group — both build on `foundation`, independent of each other

2. **Slice `authoring-surfaces`** — Linear: [TML-2869](https://linear.app/prisma-company/issue/TML-2869)
   - **Outcome:** Both authoring surfaces lower to identical `PostgresRlsPolicy` IR (parity test). **Roles are modeled as static references**, not strings: the `roles` param is a `list` of `ref`s with `refKind: 'role'` (the substrate supports list-of-refs natively — the landed `declarative-policy-select-extension` fixture already declares exactly this shape), resolved against declared `role` entities. This slice ships:
     - **A role-declaration authoring surface** (TS branded `RoleRef`, analogous to `extensionModel(…)` model handles; PSL bare identifiers) so an app — and this project's own same-space tests — can declare a `PostgresRole` and reference it, without depending on the Supabase pack.
     - **Cross-space role-ref resolution.** Roles referenced from another contract space (the Supabase pack's `anon`/`authenticated`) are `scope: 'cross-space'` refs; the substrate's cross-space ref validation is a **deliberate no-op pass-through deferred to "the first real consumer" (`psl-extension-block-validator.ts:276-284`) — this project is that consumer.** Wire it through the `(spaceId, namespaceId, 'role', name)` coordinate, reusing the cross-contract-refs aggregate machinery (same mechanism it built for FK targets). Same-space role refs resolve without this; cross-space is the net-new work.
     - **TS** top-level Postgres-contributed policy helpers taking the model handle (Option C — the `enum`/`entityTypes` mechanism, invisible to SQLite/Mongo authors; **not** a model-builder method), the `ref()` predicate helper reading `{namespaceId,tableName}` off `extensionModel(…)` handles, model-level RLS enable/disable, lowering, and duplicate-prefix / duplicate-name diagnostics.
     - **PSL** per-operation `policy_select|policy_insert|policy_update|policy_delete|policy_all` block descriptors contributed through the landed declarative PSL-block substrate, lowering to the same IR, with cross-contract `target` rejected as a load-time error.
   - **Builds on:** Slice 1's IR shapes + the `role` entity kind in `entries['role']` + content-hash compute; cross-contract-refs' contract-aggregate / coordinate machinery (merged) for cross-space role resolution.
   - **Hands to:** A contract (TS or PSL) that produces RLS IR with resolved role refs — the input slices 3 and 4 exercise end-to-end.
   - **Focus:** Authoring + ref-resolution + lowering only (mirrors cross-contract-refs' single "Authoring surfaces" slice). No planner, no verifier. Implements the resolved D3 surface (Option C); settles the residual signature detail (per-op vs array; enable/disable) and Q5 (two-body-form ADR likely subsumed by the substrate's ADR).

3. **Slice `migration-ops`** — Linear: [TML-2870](https://linear.app/prisma-company/issue/TML-2870)
   - **Outcome:** `CreatePostgresRlsPolicyOp`, `DropPostgresRlsPolicyOp`, `AlterPostgresRlsPolicyOp`, `EnableRowLevelSecurityOp`, `DisableRowLevelSecurityOp` exist per ADR 195's `OpFactoryCall` pattern (added to the `PostgresOpFactoryCall` union; pure factory fns in `operations/rls.ts`; DDL built inline via `step()`/`targetDetails()`). The diff algorithm compares declared policies against introspected rows by full wire name and emits Create/Drop/Alter; `ALTER POLICY … RENAME TO` for matching-hash-different-prefix, drop+create fallback for shapes Postgres can't ALTER in place (spec Q4). The `rls` resolution emits `ENABLE`/`DISABLE ROW LEVEL SECURITY`.
   - **Builds on:** Slice 1's IR shapes (constructs ops from synthetic IR fixtures — does not need the authoring surface).
   - **Hands to:** Planner strategies + ops that slice 4's verifier-driven plan consumes.
   - **Focus:** Emit side (planner). Provable by op/DDL snapshot tests against synthetic IR. No live-DB introspection here.

### Stack tip — converges the parallel group

4. **Slice `verifier-and-skeleton`** — Linear: [TML-2871](https://linear.app/prisma-company/issue/TML-2871)
   - **Outcome:** `PostgresSchemaVerifier.verifyTargetExtensions()` (the empty stub) introspects `pg_policies` / `pg_roles` / `pg_class.relrowsecurity` and diffs by wire name: missing/extra policies (severity via the landed control-policy two-layer dispatch — `classifySqlVerifierIssueKind` → `dispositionForCategory`), the single body-level tamper check (recompute hash vs suffix → `rls_policy_tampered`), rename detection (→ `rls_policy_renamed`), RLS-enabled state (→ `rls_not_enabled`), and `missing_role` (a `fail` even under `external`). **Walking skeleton wired:** `bootstrapSupabaseShim` extended with the Postgres roles + `auth.uid()`/`auth.jwt()`/`auth.role()` GUC-reading SQL functions; `examples/supabase` `Profile` gains `anon` SELECT + `authenticated` UPDATE-own policies; a hermetic PGlite test proves RLS filters rows under manual `SET ROLE` and the verifier diffs clean. AC8 proven: a manual `ALTER POLICY … USING(reformatted)` is `rls_policy_tampered`, not false drift.
   - **Builds on:** Slice 2's authoring (to declare the example-app policies) **and** Slice 3's ops + planner strategies (to apply and to plan issue responses).
   - **Hands to:** A fully round-tripping RLS feature — the substrate `extension-supabase` consumes.
   - **Focus:** Verify side + end-to-end proof. The PGlite integration lane is the slice's spine.

## Dependencies (external)

- [x] **target-extensible-ir (TML-2459)** — done & closed. IR base, SPI seams, `entityTypes`, `__unbound__` sentinel all available.
- [x] **control-policy (TML-2493)** — done & closed. Two-layer verifier/planner dispatch live (ADR 224).
- [x] **target-contributed-psl-blocks substrate (slices 1–3)** — landed. Declarative `AuthoringPslBlockDescriptor` SPI usable for the `policy_*` keywords. (Slice 4 ADR/close-out still open, but does not block consumption.)
- [x] **cross-contract-refs (TML-2500) M1+M2+M3a** — merged. `extensionModel(…)` handles + `TargetFieldRef<TSpaceId>` available for the TS `ref()` helper. (M3b in flight; not a blocker.)

## Sequencing rationale

The only hard constraint is **IR-first** (spec transitional-shape): every other slice consumes slice 1's IR shapes + entity kinds + content-hash compute, so it is the stack root. Authoring (2) and migration-ops (3) are genuinely independent — ops construct from synthetic IR fixtures and never touch the authoring surface — so they run in **parallel**, the default. Slice 4 is the convergence point: it needs authoring to declare the example-app policies and needs the ops + planner strategies to apply them and respond to verifier issues, and it carries the live-DB integration lane that proves the whole feature. The walking skeleton lands in slice 4 (not earlier) because diffing clean against `pg_policies` requires both the emit and verify halves present.

**Roles as references (cross-cutting through slices 1–2 and 4).** `roles = [anon, …]` are static refs to declared `role` entities, not strings — so slice 1 must register `PostgresRole` as a `role` entity kind (not just an IR class) for refs to bind, slice 2 must wire cross-space role-ref resolution (the substrate defers cross-space enforcement to its first consumer — us), and slice 4's verifier carries the runtime `pg_roles` existence check (`missing_role`). The authoring-time resolution (does `anon` name a declared role?) and the verify-time check (does it exist in the database?) are distinct; both are in scope, in different slices. This does not change the diamond — it sharpens slice 1 and slice 2 scope.

**Linear sync:** the project issue TML-2501 and the four slice issues (TML-2868 → TML-2869 ∥ TML-2870 → TML-2871) live in the dedicated [Postgres RLS](https://linear.app/prisma-company/project/postgres-rls-b7329340dbb2) Linear project (decomposed from the Supabase Integration umbrella), with blocking relations matching the diamond (2 & 3 blocked by 1; 4 blocked by 2 & 3). Slice issues created 2026-06-08 after operator plan validation; moved into the dedicated project 2026-06-08.
