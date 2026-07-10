# Slice 4 — dispatch plan

Spec: [`spec.md`](./spec.md). Branch: `slice/rls-policy-operations-and-roles` (off `main` at slice-3 tip `1aae13583`). Four dispatches, sequential, persistent Sonnet implementer + Opus reviewer. Tests-first throughout.

Two independent strands share the walking-skeleton capstone: **operations** (W1→W2) and **roles** (W3). They don't depend on each other, so order is by implementer continuity, not dependency; W4 needs both. Per-dispatch gate (from [`drive/calibration/dod.md`](../../../../drive/calibration/dod.md)): build where typed exports change, forced typecheck, per-package `pnpm lint`, scoped `--filter` suites, `fixtures:check` when emission-adjacent, `lint:deps`, vocabulary ratchet.

## W1 — All policy operations: authoring + `withCheck` lowering

**Outcome:** `policy_insert`/`policy_update`/`policy_delete`/`policy_all` are contributed as declarative block descriptors beside `policy_select`, each with its operation-appropriate predicate param set (SELECT/DELETE → `using`; INSERT → `withCheck`; UPDATE/ALL → both); `lowerRlsPolicyFromBlock` is parameterized by operation and lowers `withCheck` into `PostgresRlsPolicy.withCheck` (already in IR + hash). A wrong-predicate-for-operation (e.g. `using` on `policy_insert`) is a load-time param error. All keywords require the `@@rls`-marked target (slice 3's `requiresModelAttribute`).
**Completed when:** AC-1 pinned — each keyword lowers to the right `operation`, `withCheck` enters the hash, round-trip lossless, wrong-predicate errors; contract-psl + postgres-target suites green; `fixtures:check` clean.
**Hands to W2:** all operations lower to correct IR; only the DDL render + per-op lifecycle proof remain.

## W2 — DDL `WITH CHECK` + per-operation lifecycle

**Outcome:** the `createPolicy` render emits `WITH CHECK (<withCheck>)` when present (op builders + contract-free DDL nodes carry `withCheck` through); `FOR <op>` already rendered. The slice-3 lifecycle is proven **per operation** against live PGlite: create → present; edit predicate → drop+create; prefix rename → `ALTER POLICY … RENAME TO`; managed/external grading; drift-fails-verify. No new op families (create/drop/rename/enable already take the full policy shape).
**Completed when:** AC-2 pinned per operation (exact SQL incl. `WITH CHECK`; lifecycle + drift); adapter-postgres + planner suites green; golden `plan()` diff byte-identical for existing examples (WITH CHECK render must not perturb SELECT-only policies).
**Hands to W3:** the operations strand is done; roles remain.

## W3 — Roles enter verify (existence-only, asymmetric, zero ops)

**Outcome:** `PostgresDatabaseSchemaNode.children()` yields role nodes; role node `id()` is collision-safe (a role can't collide with a same-named schema in the differ's sibling map); the `postgres-database-schema-node.test.ts` "children excludes roles" assertion inverts. `not-found` role → fail under every control policy (generic `declaredMissing`, pin it reaches the verdict under external + managed); `not-expected` role → tolerated unconditionally (the exemption lands in the SQL-family verdict filter keyed on node-kind classification, **not** a target import — widen the classification seam minimally if the family can't express "this structural kind's extras are always tolerated"); role issues produce **zero** planner ops (a third partition beside policy/relational that maps to no ops — never reaches the unsupported-operation path). No ordering machinery.
**Grounding confirmation (not a fork):** a `policy_*`'s roles are `ref`s that must resolve to declared roles at load time, so every role a policy references is a role node — the existence check is complete. Confirm in passing; don't add authoring validation.
**Completed when:** AC-3/4/5/6 pinned — collision-safe diff, missing role fails (external + managed), extra role tolerated (incl. managed), zero ops (golden diff byte-identical); a PGlite introspect-vs-contract integration test; family verify suites + multi-space guards green.
**Hands to W4:** role + operation behavior final; only the skeleton capstone + full gate remain.

## W4 — Walking skeleton capstone + full gate

**Outcome:** `examples/supabase` `Profile` gains `anon` SELECT + `authenticated` UPDATE-own policies (reusing `policy_update` + `withCheck` from W1/W2 and the roles from W3); the shim provides the roles + `auth.uid()`/`auth.jwt()`/`auth.role()` GUC-reading SQL functions as needed; a hermetic PGlite test proves RLS filters rows under a manual `SET ROLE`, a missing declared role fails verify, and the verifier otherwise diffs clean. Fixtures regenerated. Full slice gate.
**Completed when:** AC-7 green end-to-end; full gate — build, forced typecheck, whole Lint job (ratchet unchanged), `fixtures:check`, `test:packages` + `test:integration` + `test:e2e`, multi-space guards, `check:upgrade-coverage --mode pr --prev $(git merge-base origin/main HEAD)`; golden diff byte-identical; slice-DoD walked; `origin/main` synced before final validation + push.

## Sequencing & handoffs

`W1 → W2 → W3 → W4`, strictly (by implementer continuity). W2 builds on W1 (operations lowered before DDL/lifecycle); W3 is independent of W1/W2 (roles); W4 consumes W1–W3 (skeleton needs update policies + roles).

## Known blast radius (from grounding)

- `postgres-database-schema-node.test.ts` "children excludes roles" test **inverts** (W3); any root-children / issue-order assertions shift as roles join the child list.
- The `WITH CHECK` render change (W2) touches the shared `createPolicy` path — SELECT-only policies must render byte-identically (golden diff guards it).
- The verdict-filter change (W3) touches `packages/2-sql/9-family` — re-run family verify suites + multi-space guards.
- Marker/policy fixtures across postgres-target + `examples/supabase` regenerate for the new operations + skeleton policies (W2/W4) — `fixtures:check` is the guard.
- New PSL keywords may need the printer/formatter + language-server completions updated (grep for where `policy_select` is enumerated beyond the descriptor) — flag in W1 if so.

## Linear

Primary ticket [TML-2870](https://linear.app/prisma-company/issue/TML-2870) (all policy types); the role-verify strand folds in (a small sibling ticket for role verify is optional tracking — **operator's to create**). Blocking chain per project plan: TML-2869 (slice 3) → TML-2870 (slice 4) → TML-2883 (slice 5).
