# Slice 4: migration-support-for-roles

**Linear:** new ticket (TBD — operator to create) · builds on slice 3 ([#945](https://github.com/prisma/prisma-next/pull/945), merged) and the one-differ substrate.

Postgres roles become diffable off the database root. A role a contract declares but the live database lacks makes `db verify` **fail** — even under `control: 'external'` — and the failure names the role. The role check surfaces **before** the policy that references it (leaves-first), the first dependency edge in the schema diff. No role is ever created or dropped by a migration: role provisioning stays out of scope, so a live role the contract doesn't declare is left alone.

## What already exists (do not rebuild)

Grounded on `main` at slice-3 tip:
- **Roles are already introspected** — `control-adapter.ts` `introspectRoles` reads `pg_catalog.pg_roles` (excluding `pg_%` / `postgres`) into `PostgresRoleSchemaNode`s on the root; pinned by `rls-introspection.integration.test.ts`.
- **Roles are already projected from the contract** — `contract-to-postgres-database-schema-node.ts` builds role nodes from `entries.role` onto the root.
- **`PostgresRoleSchemaNode` is already a `DiffableNode`** (`id`/`isEqualTo`/`children`), granularity `structural`; `PostgresRole` contract entity + entity-kind + validator all shipped.
- **"Missing → fail even under external" is already generic** — `classifySqlDiffIssue` maps `not-found` → `declaredMissing` unconditionally, and `dispositionForCategory` never suppresses `declaredMissing` under any control policy (only `observed` downgrades to warn).

So the slice is **not** new IR or new introspection. It is: letting the existing role nodes into the diff, making the diff asymmetric (existence-only, never provisioned), ordering roles before policies, and proving it end-to-end.

## Decisions

### D1 — Roles enter the diff as root-level leaves, with a collision-safe id

`PostgresDatabaseSchemaNode.children()` yields role nodes **and** namespace nodes (today: namespaces only, guarded by a test that must flip). Roles are cluster-scoped — above any single namespace — and attach pragmatically as **direct children of the database root**, siblings of the namespaces (the [schema-diff ADR](../../specs/adr-schema-diff-over-structured-ir.md) left this to "settled when roles are diffed"; this settles it: root-level, no new tree tier).

The differ keys a parent's children into one flat `id → node` map and **throws on a duplicate id among siblings**. A role and a namespace can share a name (a role `public`, a schema `public`), so role node `id()` must be **namespaced away from schema ids** — return a role-qualified id (e.g. a `role:` sigil) so a role can never collide with a namespace at the root level. The role's path segment carries the qualification; diagnostics still name the bare role.

### D2 — The role diff is asymmetric: existence-only, never provisioned

Role provisioning (`CREATE ROLE`/`DROP ROLE`/`ALTER ROLE`) is a project non-goal. So unlike tables:

- **`not-found`** (declared in contract, absent from `pg_roles`) → **fail** verify, always, every control policy including `external`. Falls out of the generic `declaredMissing` category — no new verify code, only the issue must now reach the verdict.
- **`not-expected`** (present in `pg_roles`, not declared) → **tolerated unconditionally**: never a verify failure, never a drop, under *any* control policy (including `managed`). This is the deliberate asymmetry — the generic path would treat a `not-expected` structural node as `extraAuxiliary` (suppressed under `external`/`tolerated` but a strict-mode failure under `managed`); roles must be exempt from that because the framework does not own the cluster's role list. The exemption is keyed on the role node kind, in the SQL-family verdict filter (reason-based, as slice 2.5 established) — not a role-specific branch smuggled into the differ.
- **`not-equal`** is unreachable today (role `isEqualTo` compares only the name; a name difference is a different id, i.e. not-found + not-expected, not a mismatch). If role attributes are ever modeled (`LOGIN`, membership), the slice-3 delta-guard pattern (`mapTableNodeIssue`'s explicit-delta-else-fail-loud) is the template — but no `mapRoleNodeIssue` is written now because roles produce **no ops**.

### D3 — Roles are verify-only: the planner emits zero role ops

Because roles are never provisioned, role diff issues must produce **no migration operations**. The planner filters role issues out of op-mapping (a role issue reaching `mapNodeIssueToCall` today would hit the unsupported-operation fail-loud — that path must never be reached for roles; they are dropped before it). Op parity is therefore exact: adding roles to the diff adds zero ops to any plan. Proven by the same golden `plan()` diff + planner/adapter suites that guard every op-touching change — roles contribute nothing to them.

### D4 — Leaves-first ordering: the role surfaces before the policy that references it

A policy's `TO <roles>` references roles by name; those names resolve to declared `PostgresRole` entities (D4 of the project spec — roles are static references, enforced at authoring). So every role a policy depends on is a role node, existence-checked by D2. The **dependency** (the role) surfaces before the **dependent** (the policy) in both verify output and issue processing: `children()` returns roles before namespaces, and the differ walks children in array order, so role issues precede all namespace/table/policy issues. This is the **dependency-graph seed** — the first policy→role edge, expressed as ordering, that the dependency-aware-planner follow-on (project follow-on B) builds a real graph on. This slice ships the ordering convention and the single edge, not a general graph.

## Behaviour contract

- **Deliberate (new):** a declared role absent from `pg_roles` fails `db verify` naming the role, under every control policy; role issues order before policy issues; the `children()`-excludes-roles test flips.
- **Unchanged (hard):** **zero** new migration ops — every plan is byte-identical (golden `plan()` diff + planner/adapter suites); a live undeclared role never fails verify and never drops; non-role verify verdicts unchanged in every mode; SQLite + Mongo untouched; the layering invariant holds (no RLS/role vocabulary in `1-framework`/`2-sql`; the role-kind verdict exemption is expressed through the family's node-kind classification, not a target import).

## Contract impact

None — `PostgresRole`, its entity kind, serializer, and validator all already ship. No new IR. The only contract-adjacent change is that a contract declaring a role now has that role verified against the live database.

## Adapter impact

`adapter-postgres`: introspection already reads `pg_roles` (no change). No new DDL, no new render hooks (roles produce no ops). SQLite + Mongo untouched.

## Non-goals

- **Role provisioning** — `CREATE`/`DROP`/`ALTER ROLE`. Deferred (project non-goal); this slice verifies existence only.
- **Role attributes** — `LOGIN`, `INHERIT`, membership, password. `PostgresRole` carries only the name; a role's `isEqualTo` compares only the name. Not modeled.
- **A general dependency graph / dependency-aware planner ordering** — follow-on B. This slice ships the one policy→role edge as leaves-first ordering, not a graph.
- **Per-role control-policy overrides** — a role issue can't resolve a per-node control policy today (its path has no owning table); roles fall to the contract default, which is immaterial since `declaredMissing` fails regardless and `not-expected` is exempted. No per-role override surface is added.
- **Cross-space role existence** — a policy referencing a role owned by another contract space (Supabase's `anon`/`authenticated`) is resolved through the existing cross-space ref machinery; this slice checks existence of roles the diff sees on the root, not cross-space ownership.

## Pre-investigated edge cases

- **Role name collides with a schema name** (role `public`, schema `public`) — the flat sibling-id map throws without D1's qualified id. Pin a test with a same-named role and schema that now diff without collision.
- **Live role the contract doesn't declare** (`not-expected`) — must be tolerated under **`managed`** (not just `external`); the generic `extraAuxiliary` path would fail it under managed-strict. Pin that a managed contract with an extra live role verifies clean and plans nothing.
- **A policy references a role that is declared but absent** — the role node not-found fails verify; the policy itself is otherwise clean. Pin that the role failure is named and ordered before the policy issue.
- **A contract with roles but no live database drift** — declared role present in `pg_roles` → clean; no ops. (Guards against roles accidentally producing ops.)

## Acceptance criteria

- **AC-1 (roles diffable):** `PostgresDatabaseSchemaNode.children()` yields role nodes; the collision-safe id lets a role and a same-named schema diff without the duplicate-id throw. The old "children excludes roles" test is inverted.
- **AC-2 (missing role fails, live PGlite):** a contract declaring role `R` against a database without `R` makes `db verify` fail with an issue naming `R`, and it fails under `control: 'external'` and `control: 'managed'` alike.
- **AC-3 (extra role tolerated):** a database with a role the contract doesn't declare verifies **clean** under every control policy and plans no drop.
- **AC-4 (leaves-first):** in verify output and the raw issue list, the role issue precedes the issues of any namespace/table/policy — pinned by asserting order, not just presence.
- **AC-5 (zero ops):** roles entering the diff add **no** operations to any plan; the golden `plan()` diff over the committed examples is byte-identical, and the planner suites are unchanged.
- **AC-6 (layering + no regression):** `pnpm lint:deps` clean; no role/RLS vocabulary added to framework/SQL-family (vocabulary ratchet unchanged); SQLite + Mongo suites green; the role-kind verdict exemption lives in the family node-kind classification, not a target import.
- **AC-7 (full gate):** build, forced typecheck, whole Lint job, `fixtures:check`, all three suites, multi-space guards, `check:upgrade-coverage --mode pr`. (No breaking authoring change expected — no upgrade instructions unless a construction-site ripple surfaces.)

## Slice Definition of Done

Inherits the team floor ([`drive/calibration/dod.md`](../../../../drive/calibration/dod.md)). Slice-specific: the Supabase walking-skeleton example proves AC-2 end-to-end — a declared role dropped from the live database (or a fresh database missing it) fails `db verify` naming the role, against live PGlite.

## Grounding for the plan step

The plan must ground: the `children()` change + the collision-safe id design (`postgres-database-schema-node.ts`, `postgres-role-schema-node.ts`, and the `postgres-database-schema-node.test.ts` assertion that flips); where the `not-expected`-role exemption lands in the SQL-family verdict filter (`schema-verify.ts` `computeSqlDiffVerdict`/`classifySqlDiffIssue`, keyed on node-kind granularity — confirm the family can express "this structural kind's extras are always tolerated" without importing a target kind, else the classification seam needs a small widening); where role issues get filtered out of the planner op-mapping (`planner.ts` issue partitioning — roles need a third disposition beside `policyDiffIssues`/`relationalDiffIssues` that maps to no ops); whether authoring already guarantees every policy role is a declared role (if not, an undeclared-role reference would slip past the role-node check — flag it); and the golden-diff harness reuse for AC-5.
