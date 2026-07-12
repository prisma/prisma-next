# Slice 4: rls-policy-operations-and-roles

**Linear:** [TML-2870](https://linear.app/prisma-company/issue/TML-2870) (all policy types) + folded-in role verify · builds on slice 3 ([#945](https://github.com/prisma/prisma-next/pull/945), merged).

Completes the **PSL** RLS surface. Every RLS operation — not just `SELECT` — is authorable and follows the slice-3 lifecycle: `policy_insert`, `policy_update`, `policy_delete`, `policy_all`, each with an optional `withCheck` predicate. And Postgres roles enter verify: a role a contract declares but the live database lacks makes `db verify` **fail**, even under `control: 'external'`. The capstone is the project's walking skeleton — the Supabase example running `anon` SELECT + `authenticated` UPDATE-own policies, filtering rows under `SET ROLE`, verifying clean.

This slice merges the former slices 4 (role verify) and 5 (all policy types): both are small, additive to the shipped substrate, introduce no new architecture, and share one end-to-end capstone that needs both (the walking skeleton's UPDATE-own policy needs `policy_update` + `withCheck`; its `anon`/`authenticated` roles need role verify).

## What already exists (do not rebuild)

- **Content addressing already covers all operations + `withCheck`.** `computeContentHash` hashes `(using, withCheck, roles, operation, permissive)`; `PostgresRlsPolicy` already carries `operation: 'select'|'insert'|'update'|'delete'|'all'` and `withCheck`. So naming, rename-pairing, and grading are already operation-aware — the gap is purely the **PSL authoring keywords** for the non-select operations and the **DDL** that renders `FOR <op>` / `WITH CHECK`.
- **The block-descriptor substrate** already contributes `policy_select` declaratively (`postgresAuthoringPslBlockDescriptors`); the other operations are more descriptors of the same shape.
- **Roles are already introspected + projected + diffable-capable.** `introspectRoles` reads `pg_roles`; `contract-to-postgres-database-schema-node` projects declared roles onto the root; `PostgresRoleSchemaNode` is a `DiffableNode`; `not-found → declaredMissing → fail-even-under-external` is already generic. The only gap is `PostgresDatabaseSchemaNode.children()` withholding roles, plus the asymmetric grading (extras tolerated) and the planner producing zero role ops.

## Decisions

### D1 — All policy operations via more block descriptors + `withCheck`

`policy_insert` / `policy_update` / `policy_delete` / `policy_all` are contributed as declarative `AuthoringPslBlockDescriptor`s beside `policy_select` (the keyword *is* the operation — no `policy { operation = … }` conditional block, per the project's A2 rejection). Each carries the fixed param set: `target` (ref, same-namespace, required, `@@rls`-marked via slice 3's `requiresModelAttribute`), `roles` (ref list), `using` (predicate), and `withCheck` (predicate) — with the operation-appropriate subset. `withCheck` lowers to `PostgresRlsPolicy.withCheck` (already in the IR + hash). The lowering reuses `lowerRlsPolicyFromBlock`, parameterized by operation.

**Which operations take which predicate** (mirror Postgres): `SELECT`/`DELETE` take `USING` only; `INSERT` takes `WITH CHECK` only; `UPDATE` takes both; `ALL` takes both. The descriptor param set per keyword enforces this — an `using` on `policy_insert` or a `withCheck` on `policy_select` is a load-time param error, not silently dropped.

### D2 — DDL renders `FOR <op>` and `WITH CHECK`

The `createPolicy` render (`control-adapter.ts`) already emits `CREATE POLICY … FOR <op>`; extend it to render `WITH CHECK (<withCheck>)` when present (today only `USING` is rendered for select). The op builders + contract-free DDL nodes carry `withCheck` through. Drop/rename/enable are operation-agnostic (already shipped). No new op families — the slice-3 create/drop/rename/enable calls already take the full policy shape.

### D3 — The slice-3 lifecycle holds per operation

Create / edit-replaces (hash change → drop+create) / rename (hash match, prefix change → `ALTER POLICY … RENAME TO`) / managed-external-tolerated grading / drift-fails-verify — all verified **per operation type**, not just SELECT. Because the hash and the ops are already operation-aware, this is proving the lifecycle across operations, not building new lifecycle machinery.

### D4 — Roles enter verify: existence-only, asymmetric, zero ops

Unchanged from the standalone role-verify design (dependency ordering cut — see Non-goals):
- `PostgresDatabaseSchemaNode.children()` yields role nodes (root-level, siblings of namespaces). Role node `id()` becomes **collision-safe** — a role-qualified id that cannot equal a namespace/schema id in the differ's flat sibling-map (which throws on duplicate ids). The [schema-diff ADR](../../specs/adr-schema-diff-over-structured-ir.md) left "where roles attach" to when roles are diffed; this settles it: root-level, no new tree tier.
- **`not-found`** (declared, absent from `pg_roles`) → **fail** verify under *every* control policy including `external` (generic `declaredMissing`; no new verify code — the issue must just reach the verdict).
- **`not-expected`** (present, undeclared) → **tolerated unconditionally** — never a failure, never a drop, under any policy including `managed`. The framework does not own the cluster's role list. Expressed through the family's node-kind classification seam (reason + kind), **not** a target import into `2-sql`.
- **Zero ops.** Role provisioning is a project non-goal — role diff issues produce no migration operations (a role issue must never reach the planner's op-mapping unsupported-operation path). Adding roles to the diff adds zero ops to any plan.

## Behaviour contract

- **Deliberate (new):** all four non-select operations authorable in PSL with `withCheck`; per-operation lifecycle + drift; a declared role missing from `pg_roles` fails verify (every control policy); `children()`-excludes-roles test flips.
- **Unchanged (hard):** existing SELECT-policy behavior byte-identical; **zero** new migration ops from roles (golden `plan()` diff byte-identical, planner/adapter suites unchanged); an undeclared live role never fails and never drops; non-RLS verify verdicts unchanged in every mode; SQLite + Mongo untouched; the layering invariant holds (no RLS/role vocabulary in `1-framework`/`2-sql`; role-kind grading via family classification, not a target import; vocabulary ratchet unchanged).

## Contract impact

New PSL keywords lower to the existing `PostgresRlsPolicy` entity (no new IR — `operation`/`withCheck` already exist). Role verify is contract-neutral (`PostgresRole` already ships). **Breaking for authors only if** a contract already authored a policy with a predicate the operation shouldn't take (previously impossible — only `policy_select` existed). No `@@rls`-style breaking change expected.

## Adapter impact

`adapter-postgres`: `createPolicy` render gains `WITH CHECK`; role introspection already reads `pg_roles` (no change). No new DDL node families. SQLite + Mongo untouched.

## Non-goals

- **Dependency-aware planner ordering** — off the RLS critical path (follow-on B). Roles produce zero ops, so nothing needs op-ordering here; role issues emit in `children()` order with no ordering guarantee, no edge object, no topological sort.
- **Role provisioning** (`CREATE`/`DROP`/`ALTER ROLE`) — project non-goal; existence verify only.
- **Role attributes** (`LOGIN`, membership) — `PostgresRole` carries only the name; `isEqualTo` compares only the name.
- **Per-role control-policy overrides** — a role issue has no owning table to resolve a per-node policy; immaterial since `declaredMissing` fails regardless and `not-expected` is exempt.
- **TypeScript authoring** — slice 5. This slice is PSL-only.
- **Predicate-body validation / SQL parsing** — `using`/`withCheck` are opaque predicate text (D2 of the project spec).

## Pre-investigated edge cases

- **`withCheck` on the wrong operation** — a `withCheck` on `policy_select`/`policy_delete`, or a `using` on `policy_insert`, is a load-time param error (D1), not silently dropped.
- **Role name collides with a schema name** (role `public`, schema `public`) — the flat sibling-id map throws without D4's qualified id; pin a same-named role+schema diffing without collision.
- **Undeclared live role under `managed`** — must be tolerated (the generic `extraAuxiliary` path would fail it under managed-strict); pin managed + extra live role verifies clean, plans nothing.
- **`policy_all` alongside per-operation policies on one table** — Postgres allows an `ALL` policy beside operation-specific ones; both author and diff independently (distinct wire names by operation).
- **Rename across operations** — a prefix change on a `policy_update` renames; a change that also flips the operation is a new hash → drop+create, not a rename (operation is in the hash).

## Acceptance criteria

- **AC-1 (author all operations):** `policy_insert`/`policy_update`/`policy_delete`/`policy_all` lower to `PostgresRlsPolicy` with the right `operation`; `withCheck` lowers and enters the hash; round-trip lossless; wrong-predicate-for-operation is a load-time error.
- **AC-2 (per-operation lifecycle, live PGlite):** for each operation, create → present; edit predicate → drop+create; prefix rename → `ALTER POLICY … RENAME TO`; managed/external grading + drift-fails-verify — pinned per operation, not just SELECT. DDL renders `FOR <op>` + `WITH CHECK` correctly.
- **AC-3 (roles diffable):** `children()` yields roles; collision-safe id lets a role + same-named schema diff without the duplicate-id throw; the old "children excludes roles" test is inverted.
- **AC-4 (missing role fails):** a contract declaring role `R` against a DB without `R` fails `db verify` naming `R`, under `external` **and** `managed`.
- **AC-5 (extra role tolerated):** a DB role the contract doesn't declare verifies clean under every control policy and plans no drop.
- **AC-6 (roles zero ops):** roles entering the diff add no operations; golden `plan()` diff byte-identical; planner suites unchanged.
- **AC-7 (walking skeleton, live PGlite):** `examples/supabase` `Profile` gains `anon` SELECT + `authenticated` UPDATE-own policies (+ the roles + `auth.*` GUC-reading SQL functions as needed); a hermetic PGlite test proves RLS filters rows under a manual `SET ROLE`, a missing declared role fails verify, and the verifier otherwise diffs clean.
- **AC-8 (layering + gate):** `pnpm lint:deps` clean; no RLS/role vocabulary in framework/SQL-family (ratchet unchanged); SQLite + Mongo green; full gate — build, forced typecheck, whole Lint job, `fixtures:check`, three suites, multi-space guards, `check:upgrade-coverage --mode pr`.

## Slice Definition of Done

Inherits the team floor ([`drive/calibration/dod.md`](../../../../drive/calibration/dod.md)). Slice-specific: the AC-7 walking skeleton runs green against live PGlite — the project's central end-to-end proof that authored RLS (multiple operations + roles) filters real rows and verifies clean.

## Grounding for the plan step

The plan must ground: the `policy_select` descriptor + `lowerRlsPolicyFromBlock` (to replicate per operation and add `withCheck`); the per-operation predicate matrix (which keyword takes `using`/`withCheck`); the `createPolicy` render site for `WITH CHECK`; the `children()` change + collision-safe id + the flipping test; where the `not-expected`-role exemption lands in the SQL-family verdict filter (node-kind classification, without importing a target kind — widen the seam minimally if needed); where role issues get filtered out of the planner op-mapping; the walking-skeleton shim (roles + `auth.uid()`/`auth.jwt()`/`auth.role()` GUC functions) already present in the Supabase example vs. what AC-7 adds; and golden-diff reuse for AC-6.
