# postgres-rls — Plan

**Spec:** `projects/postgres-rls/spec.md`
**Linear Project:** [Postgres RLS](https://linear.app/prisma-company/project/postgres-rls-b7329340dbb2) · project issue [TML-2501](https://linear.app/prisma-company/issue/TML-2501) · parent umbrella [Supabase Integration](https://linear.app/prisma-company/project/supabase-integration-08e7667f5de4)

> **Re-cut 2026-06-10 (operator).** The previous cut named slices after layers ("authoring breadth", "verify/plan breadth") and let user-invisible machinery count as delivery — the local PR review exposed the consequences (drift was "detected" into a channel nothing reads; editing a policy silently left the stale one active). The new cut names each slice after the thing a user can rely on when it merges, and every slice AC is an **operator-observable behavior**, never an artifact.

## At a glance

Four slices. Slice 1 makes **SELECT policies dependable end-to-end** — full lifecycle (create, change, remove), drift makes `db verify` fail, proven in the Supabase example app. Slice 2 makes **drift handling correct per variation** and introduces the **policy→role traversal** that seeds the dependency graph. Slice 3 extends everything to **the other policy types**. Slice 4 adds the **TypeScript authoring surface** with PSL parity.

RLS rides the generic schema-diff architecture (unchanged — see § Architecture decisions): generic differ + `{coordinate, outcome}` issues; zero RLS symbols in framework/SQL-family; content-addressed wire names; side-by-side with the untouched legacy relational verifier/planner. The relational port and dependency-aware planner ordering remain independent follow-on projects.

## Composition

### Slice 1 — `select-policies-dependable` · [TML-2868](https://linear.app/prisma-company/issue/TML-2868) · PR [#771](https://github.com/prisma/prisma-next/pull/771) (continues)

A developer can declare a SELECT policy and **rely on it**: it gets created, edits replace it, removals drop it, drift errors out, and the Supabase example app proves the whole thing.

Already landed on the branch: the architecture (generic differ, content-addressed naming + normalizer, introspection, PSL `policy_select` authoring through the production interpreter, create/enable ops, planner diff-wiring, the verify `extensionIssues` channel) and two PGlite e2e spines. **Remaining to slice DoD:**

1. **Fix the build** (review F01): `extensionIssues` made required without updating three constructors (mongo verify, CLI `db-verify`, `combine-schema-results`) — workspace `pnpm typecheck` must be green; add the workspace typecheck to the standing gates.
2. **Full SELECT-policy lifecycle** (kills the edit-trap): `DropPostgresRlsPolicyCall` + planner handling for `extra` (declared-removed → `DROP POLICY`) and for changed policies (`missing`+`extra` pair → create new + drop old — never leave a stale policy active); `DISABLE ROW LEVEL SECURITY` when a table's last policy is removed (or an explicit decision not to, recorded). Route `extraBucketableCalls` through the operation-class policy gating (review F06) since drops are destructive.
3. **Drift errors out** (resolves F02 as wire-it-now, bluntly): any non-empty `extensionIssues` fails the verify verdict — fold into `ok`/counts at the family assembly and thread through `combineSchemaResults`. Nuanced per-kind severity is slice 2; slice 1's rule is simply *any RLS drift → verify fails with a message naming the policy*.
4. **Supabase example app e2e**: extend `bootstrapSupabaseShim` with the Postgres roles (`anon`, `authenticated`, `service_role`) and the `auth.uid()` GUC-reading function (verified 2026-06-10: the shim seeds only schemas/tables today; roles are platform-provided in real Supabase, so the shim emulates that — this project never authors or migrates roles); add a SELECT policy to `examples/supabase` `Profile`; e2e proves: migrate → rows filtered under the role → `db verify` clean → drop the policy out-of-band → `db verify` **fails**.
5. Review follow-ups in scope: F03 (role-name rendering shim hardening or input constraint), F05 (a parsed extension block with no registered factory must not be silently dropped), F07 (`rlsEnabledByTable` keyed by bare table name — cross-schema collision), the structural anti-leak test (assert no RLS tokens in framework/SQL-core, since `lint:deps` can't catch this class).

- **DoD (operator-observable):** declare a SELECT policy in the example app → migrate → only permitted rows visible under the role; edit the predicate → migrate → exactly one policy active, with the new predicate; remove it → migrate → policy gone; drop/alter it out-of-band → `prisma db verify` exits non-zero naming the policy. Workspace typecheck green; all suites green.

### Slice 2 — `drift-handled-correctly` · [TML-2869](https://linear.app/prisma-company/issue/TML-2869)

Every drift variation for a SELECT policy is handled **correctly** (not just "error"), and the schema graph gains its first edge.

- **Drift variations, each implemented + e2e-tested:** rename (matching content-hash, different prefix → `ALTER POLICY … RENAME TO`, not drop+create); tamper (out-of-band body change → recomputed hash mismatch → reported as tamper, and a reformat-only change does NOT false-positive); RLS-disabled-with-policies-declared; extra/unmanaged policies (severity via the table's control policy — `managed` fails, `external` tolerates); the blunt slice-1 "any drift errors" rule is refined into per-variation verdicts through the control-policy disposition.
- **Policy → Role traversal (the dependency-graph seed):** the SchemaIR gains traversal from a top-level RLS policy node to its referent Role node(s). Roles become diffable: a policy referencing a role absent from `pg_roles` is an issue. Issue processing is **leaves-first, then up the tree** — the role leaf's issue surfaces before/along the dependent policy's — establishing the edge model the future dependency-aware planner (follow-on B) builds on.
- **DoD (operator-observable):** rename a policy prefix → migrate emits a RENAME (verifiable in the plan output); tamper with a policy body in the DB → `db verify` names it as tampered; reformat-only out-of-band change → verify stays clean; reference a role that doesn't exist → verify fails naming the role.

### Slice 3 — `all-policy-types` · [TML-2870](https://linear.app/prisma-company/issue/TML-2870)

Everything slices 1–2 made dependable for SELECT works for **INSERT / UPDATE / DELETE / ALL** policies.

- PSL `policy_insert | policy_update | policy_delete | policy_all` block descriptors lowering through the same generic interpreter pass; `withCheck` handling (INSERT/UPDATE) end-to-end; the lifecycle + drift behaviors from slices 1–2 verified per type (the content-hash already covers operation + withCheck, so this is descriptors + DDL rendering + per-type e2e, not new architecture).
- **DoD (operator-observable):** the slice-1 example-app scenario repeated with an UPDATE-own policy (`using` + `withCheck`): a user can update only their own row; editing/removing/drifting behaves exactly as for SELECT.

### Slice 4 — `typescript-authoring` · _(Linear: see § Linear sync)_

A developer can author the same policies in **TypeScript** instead of PSL, with identical results.

- Top-level Postgres-contributed policy helpers taking the model handle (the decided surface — the `enum`/`entityTypes` mechanism, invisible to SQLite/Mongo authors; **not** a model-builder method; rationale in [`specs/design-rls-authoring-surface.md`](specs/design-rls-authoring-surface.md)). Settles the still-open **per-operation (`policySelect(…)`) vs single-array** helper-signature decision at slice pickup.
- The `ref()` predicate helper (reads `{namespaceId, tableName}` off `extensionModel(…)` handles so predicates track renames); model-level RLS enable/disable; duplicate-prefix/name diagnostics.
- **TS/PSL parity test:** the same policies authored both ways lower to structurally identical IR with identical wire names.
- **DoD (operator-observable):** the slice-1 example-app scenario authored in TS instead of PSL behaves identically (filtered rows, lifecycle, drift→verify-fails); the parity test pins identical contracts.

## Not in this project's plan-of-record (operator cut, 2026-06-10)

- **Cross-space role-ref *validation* / role authoring** — roles are external (platform-provided; shim-seeded in tests); policies reference them by name. The substrate's cross-space pass-through stands; real role-ref validation arrives with slice 2's role traversal only to the extent of "referenced role exists in the DB," not authoring-time cross-space resolution.
- Independent follow-on projects (unchanged, filed in Linear): **A** — port the 25 legacy relational verifier kinds onto the generic differ; **B** — dependency-aware generic planner ordering (slice 2's policy→role edges are its seed).

## Architecture decisions (locked 2026-06-09 — unchanged by the re-cut)

1. Generic differ, same-hierarchy comparison; issues are `{coordinate, outcome: missing|extra|mismatch}` — the framework never enumerates target kinds.
2. `identity()` / `isEqualTo()` as virtual methods on nodes; policy identity = content-addressed wire name.
3. Per-node-kind planner dispatch (`create/delete/update → OpFactoryCall[]`); coarse buckets now, dependency graph later (slice 2 seeds the edges; follow-on B builds the ordering).
4. Derivation/introspection hold per-kind smarts; the diff stays a pure walk.
5. Side-by-side with the legacy verifier/planner until follow-on A retires it; the new path emits only new-native structures.
6. Layering invariant: zero RLS symbols in `packages/1-framework` / `packages/2-sql` — to be enforced by a structural test (slice 1 item 5), not review vigilance.

## Linear sync

TML-2868 → `select-policies-dependable` (re-scoped; PR #771 continues under it). TML-2869 → `drift-handled-correctly`. TML-2870 → `all-policy-types`. [TML-2883](https://linear.app/prisma-company/issue/TML-2883) → `typescript-authoring` (slice 4, re-added 2026-06-10). TML-2871 → canceled (contents split: example-app skeleton → slice 1; role existence → slice 2; cross-space role validation → dropped). Blocking: 2869 blockedBy 2868; 2870 blockedBy 2869; 2883 blockedBy 2870.
