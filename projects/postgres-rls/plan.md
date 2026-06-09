# postgres-rls — Plan

**Spec:** `projects/postgres-rls/spec.md`
**Linear Project:** [Postgres RLS](https://linear.app/prisma-company/project/postgres-rls-b7329340dbb2) · project issue [TML-2501](https://linear.app/prisma-company/issue/TML-2501) · parent umbrella [Supabase Integration](https://linear.app/prisma-company/project/supabase-integration-08e7667f5de4)

## At a glance

RLS verification and planning ride a **new generic schema-diff architecture**, not the legacy per-kind verifier. The framework can't own RLS-specific issue kinds (the layering violation that sank the first foundation slice), so rather than widen framework types we make the **differ generic**: diff two `SchemaIR` trees by node identity, emit only `missing | extra | mismatch` + a coordinate, and dispatch planning per node type. RLS is one clean, greenfield consumer of that differ.

The first slice is the **walking skeleton**: a developer authors one PSL `policy_select` block, and it threads all the way through the new architecture to filter rows on a live PGlite database — proving the architecture *and* shipping observable, user-authored behavior, side-by-side with the untouched legacy path, emitting only new-native structures. Then we widen. Porting the 25 legacy relational kinds onto the differ, and adding dependency-aware planner ordering, are **independent follow-on projects that never gate RLS**.

```
1. RLS walking skeleton  ──  PSL policy_select → IR → SchemaIR → generic diff → per-node plan → PGlite rows filtered
      │                       (strips the foundation leaks as part of building the right path; #771)
      ├── 2. Authoring breadth      (TS surface + parity, remaining PSL operations, ref(), diagnostics)
      └── 3. Verify/plan breadth    (rename, tamper, missing-role, drop/alter, severity via control policy)
                    │
                    4. Cross-space roles + Supabase walking skeleton

Independent follow-on projects (own schedule, never block RLS):
  A. Port legacy relational verification onto the generic differ
  B. Dependency-aware generic planner ordering
```

Per-slice spec + plan are authored at slice-pickup by `drive-specify-slice` / `drive-plan-slice`. Project close-out (promote the content-addressed-naming ADR, subsystem doc, delete the project dir) is the project-DoD close via `drive-close-project`, not a slice.

## Architecture decisions (locked in design discussion, 2026-06-09)

Settled with the operator; bind every slice. Detail in `spec.md § Design`.

1. **Generic differ, `SchemaIR` ↔ `SchemaIR`.** Lower the contract to a `SchemaIR` (expected), introspect the DB to a `SchemaIR` (actual), diff two of the *same* hierarchy. No cross-hierarchy comparison; `isEqualTo(other: OwnType)` is well-typed.
2. **Three outcomes + a coordinate.** An issue is `{ coordinate, outcome: missing | extra | mismatch, expected?, actual? }`. No `kind` vocabulary, no per-kind payload, no framework enumeration of issue kinds — this is what removes the layering leak structurally.
3. **Identity and equality are virtual methods on the node.** `identity()` returns the node's local key (name / column-list / singleton / content-hash wire name) for alignment; `isEqualTo(other)` compares a matched pair. RLS is the clean case where identity (wire name) already settles equality.
4. **Per-node-kind planner dispatch.** `create / delete / update(from,to) → OpFactoryCall[]`. Methods on target-only nodes (policy/role); target-contributed strategies for family-shared nodes (SQLite/Postgres DDL diverge). The central `mapIssueToCall` switch dissolves.
5. **Derivation holds the per-kind smarts.** Type/default normalization, FK-backing-index + unique↔index synthesis, name/namespace assignment all move into contract→`SchemaIR` derivation and DB→`SchemaIR` introspection, so the diff stays a pure recursive walk and `isEqualTo` is plain structural equality.
6. **Ordering: coarse buckets now, dependency graph later.** RLS's ordering (roles → tables → policies+enable-RLS) fits the existing coarse-bucket mechanism. The dependency-edge + topological-sort machinery a general planner needs is **follow-on B** — RLS doesn't need it.
7. **The legacy port is independent.** The differ ships only the top-level-entity layer RLS needs. Migrating the 25 relational kinds (nested coordinates, normalization-in-derivation, retiring the `SchemaIssue` union + classify switch + legacy planner switches) is **follow-on A**, on its own schedule, validated by run-both-assert-equal against the legacy baseline.

## Composition

### Slice 1 — `rls-walking-skeleton` · Linear [TML-2868](https://linear.app/prisma-company/issue/TML-2868) · [#771](https://github.com/prisma/prisma-next/pull/771) (draft)

The smallest **vertical** thread: a user authors one policy and it filters rows, threaded through the new architecture, with the foundation leaks removed as part of building it.

- **Outcome:** a PSL `policy_select` block (one table, one **same-space** declared role, a `using` predicate — the landed declarative PSL-block substrate) lowers to `PostgresRlsPolicy` IR → contract derives to `SchemaIR` → a PGlite DB introspects to `SchemaIR` → the **generic differ** (recursive walk over `identity()`/`isEqualTo()`) emits a coordinate+outcome issue → per-node `create` produces `OpFactoryCall`s (`CreatePolicy` + `EnableRls`) → coarse-bucket ordering → `toOp()` applies → **rows are filtered under `SET ROLE`**, and a re-introspect → diff returns clean. Covers `missing → create → filter → clean`.
- **Strips the leaks (foundation rework):** remove the `rls_policy_*` members from the framework `SchemaIssue` union + exports + the `classifySqlVerifierIssueKind` cases + the SQLite/Postgres narrowing guards; remove `StorageTable.rls`/`RlsMode` from SQL core (the table RLS-enabled state is Postgres-derived — enable where policies exist); relocate `PostgresRoleSchema`/`PostgresRlsPolicySchema` into the Postgres target. Keep the sound foundation parts (IR classes + `entityTypes`, content-hash, serializer round-trip).
- **Side-by-side, no legacy re-emission:** the legacy relational verifier/planner runs **unchanged** in the same invocation (it emits `CREATE TABLE` for the table); the new path emits only new-native structures into a **separate issue channel** and contributes its own `OpFactoryCall`s to the same ordered plan. The new differ never produces `SchemaIssue`; the new planner never goes through `mapIssueToCall`.
- **Builds:** the generic differ + node `identity()`/`isEqualTo()` + the coordinate+outcome issue type + per-node planner dispatch + SchemaIR policy/role nodes + their introspection — the substrate slices 2–4 extend.
- **Out of scope:** TS authoring + other operations + diagnostics + parity (breadth → slice 2); cross-space roles (pre-create the role in the harness); `mismatch` refinements — rename/tamper (→ slice 3); `CREATE ROLE`; dependency-ordering machinery; the relational port. SQLite untouched.
- **Done when:** the PGlite skeleton passes; `pnpm lint:deps` clean AND no RLS string in any framework/SQL-family/core file; no legacy `SchemaIssue`/`mapIssueToCall` on the new path.

### Slice 2 — `authoring-breadth` · Linear [TML-2869](https://linear.app/prisma-company/issue/TML-2869)

- **Outcome:** the full authoring surface lowering to identical IR (TS/PSL parity test). TS top-level Postgres-contributed policy helper (the `enum`/`entityTypes` mechanism, invisible to SQLite/Mongo; not a model-builder method — spec § Design D3); `ref()` predicate helper; model-level enable/disable; duplicate-prefix/name diagnostics; the remaining PSL operations (`policy_insert|policy_update|policy_delete|policy_all`) beyond the skeleton's `policy_select`. Same-space roles.
- **Builds on:** slice 1 (extends the authoring path that the skeleton opened).
- **Settles:** the per-operation-vs-single-array TS helper signature (spec § Alternatives § Still open).

### Slice 3 — `verify-plan-breadth` · Linear [TML-2870](https://linear.app/prisma-company/issue/TML-2870)

- **Outcome:** the rest of RLS on the generic differ — policy `mismatch` (drop+create), **rename** (matching content-hash extra+missing → `ALTER POLICY … RENAME TO`, a Postgres coalescing strategy), **tamper** (introspection recomputes the hash → a tampered body surfaces as extra+missing), **`missing_role`** (`pg_roles` existence), the table RLS-enabled mismatch, severity for missing/extra via the control-policy disposition, Drop/Alter/Disable ops.
- **Builds on:** slice 1 (differ + per-node dispatch) and slice 2 (real declared policies). Runs in parallel with slice 2.

### Slice 4 — `supabase-skeleton` · Linear [TML-2871](https://linear.app/prisma-company/issue/TML-2871)

- **Outcome:** cross-space role-ref resolution (Supabase pack's `anon`/`authenticated` via the `(spaceId, namespaceId, 'role', name)` coordinate, wiring the substrate's deferred cross-space validation); `bootstrapSupabaseShim` + `auth.uid()`/`auth.jwt()`/`auth.role()` GUC functions; `examples/supabase` `Profile` policies; end-to-end PGlite proof; verifier diffs clean.
- **Builds on:** slices 2 + 3. Consumed by `extension-supabase`.

> Linear note: the four slices remap onto the existing tickets TML-2868/2869/2870/2871 (re-scoped); TML-2876 (the prior fifth slice) is folded into slice 4 / closed. Mapping recorded in § Linear sync.

## Independent follow-on projects (not postgres-rls)

Generalize the architecture the skeleton proves; own schedule; **must not gate RLS**. Each filed as its own Linear project.

- **A — Port legacy relational verification onto the generic differ.** Derive the 25 relational kinds to canonical `SchemaIR`; add nested coordinates + per-node `identity()`/`isEqualTo()`; move type/default normalization and FK-backing-index / unique↔index synthesis into derivation; retire the `SchemaIssue` kind union, `classifySqlVerifierIssueKind`, and the per-target `mapIssueToCall` switches. Validate by run-both-assert-identical per kind before cutover.
- **B — Dependency-aware generic planner ordering.** Replace the hardcoded `ISSUE_KIND_ORDER` lists + the `recipe` boolean (which already `throw`s on two-bucket plans) with declared dependency edges + a topological sort, plus a coalescing contract so a target (SQLite) can fold N node-diffs into one parent op.

## Dependencies (external — all landed)

- [x] **target-extensible-ir (TML-2459)** — IR base, SPI seams, `entityTypes`, `__unbound__`. (Its `verifyTargetExtensions` returns the closed `SchemaIssue[]`; the generic-differ work supersedes that channel rather than extending it.)
- [x] **control-policy (TML-2493)** — `ControlPolicy` + category→disposition grading (ADR 224); reused by slice 3 for missing/extra severity.
- [x] **target-contributed-psl-blocks** — declarative `policy_*` block SPI (slice 1 `policy_select`, slice 2 the rest).
- [x] **cross-contract-refs (TML-2500)** — `extensionModel(…)` handles + aggregate/coordinate machinery (slice 2 `ref()`, slice 4 cross-space roles).

## Sequencing rationale

**Walking-skeleton first.** The first slice is a genuine vertical thread — authoring at the top, rows filtered at the bottom — so it ships user-observable value, *and* it's the architecture proof (the planner is issue-driven, so "create this policy" comes from the differ saying it's missing — the differ is on the critical path even for the migration). Authoring is the top of the vertical for this system; a slice that started from a synthetic contract would be an internal proof, not a vertical slice (the mistake this plan corrects).

**Leaks come out in slice 1.** The framework `SchemaIssue` widening and `StorageTable.rls` are wrong under the new architecture (issues are coordinate+outcome; the differ never enumerates kinds). #771 is draft, so this is fixing in-flight work, not reverting `main` — the leak commits are superseded within the slice as the correct path is built.

**Breadth parallelizes; the legacy port is independent.** Authoring breadth (2) and verify/plan breadth (3) build on the skeleton and run in parallel; slice 4 converges them with cross-space roles + the Supabase flavor. The 25-kind relational port and dependency-aware ordering are off RLS's critical path entirely (follow-ons A, B).

**Linear sync (re-cut pending this plan):** TML-2868 → `rls-walking-skeleton` (#771); TML-2869 → `authoring-breadth`; TML-2870 → `verify-plan-breadth`; TML-2871 → `supabase-skeleton`; TML-2876 folded into slice 4 and closed. Plus two new Linear projects for follow-ons A and B. Blocking: 2869 & 2870 blockedBy 2868; 2871 blockedBy 2869 & 2870.

## Alternatives considered (architecture + slicing)

- **Widen the framework `SchemaIssue` union target-side (rejected).** The interim pattern the codebase documents and that enum already follows — it's the layering violation we hit. The generic differ removes the need; enum is prior art for the same bug, not a precedent.
- **Generic differ re-emits legacy `kind` issues during migration (rejected by operator).** Keeps the planner untouched but means the new architecture speaks legacy structures. We want it proven on its own native structures, side-by-side, from day one.
- **Synthetic-contract architecture proof as the first slice (rejected).** A hand-built contract is a test fixture, not a user surface — it proves the architecture but isn't a vertical slice (no user can author a policy). Fixed by folding the thinnest PSL authoring into slice 1.
- **Reseat all 25 relational kinds in this project (rejected).** Drags nested coordinates, cross-sibling synthesis, and normalization onto RLS's critical path. Deferred to follow-on A.
