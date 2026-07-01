# postgres-rls — Plan

**Spec:** `spec.md` · **Linear:** [Postgres RLS](https://linear.app/prisma-company/project/postgres-rls-b7329340dbb2) ([TML-2501](https://linear.app/prisma-company/issue/TML-2501)) under [Supabase Integration](https://linear.app/prisma-company/project/supabase-integration-08e7667f5de4)

Each slice is named for what a developer can **rely on** when it merges; every DoD is an operator-observable behavior, never an artifact. Slices 1, 1.5, 2 are foundational (1.5 and 2 ship no user-visible change); the user-facing RLS behaviors land in 3–6.

## Slices

| # | Slice | Delivers | Status | Ticket / PR |
| --- | --- | --- | --- | --- |
| 1 | `select-policies-dependable` | A SELECT policy is dependable end-to-end — create / edit-replaces / remove, drift fails `db verify`, proven in the Supabase example app. | ✅ merged | [TML-2868](https://linear.app/prisma-company/issue/TML-2868) · [#771](https://github.com/prisma/prisma-next/pull/771) |
| 1.5 | `entity-kind-migration-seam` | Foundational: both diff sides are derived schema IRs, so `migration plan` emits RLS like every other command. | ✅ merged | [TML-2931](https://linear.app/prisma-company/issue/TML-2931) · [#868](https://github.com/prisma/prisma-next/pull/868) |
| 2 | `schema-node-tree-restructure` | Foundational: a real `database → namespace → table → policy` node tree; inference moves to the Postgres target. Behavior-neutral. | ✅ in review | [#894](https://github.com/prisma/prisma-next/pull/894) · ticket TBD |
| 3 | `explicit-rls-control` | `@@rls` enablement, policy rename, per-table `managed`/`external` grading. | ⬜ | [TML-2869](https://linear.app/prisma-company/issue/TML-2869) |
| 4 | `migration-support-for-roles` | A policy referencing a missing role fails verify (policy→role edge; dependency-graph seed). | ⬜ | new ticket (TBD) |
| 5 | `support-all-rls-policy-types` | INSERT / UPDATE / DELETE / ALL policies, same lifecycle as SELECT. | ⬜ | [TML-2870](https://linear.app/prisma-company/issue/TML-2870) |
| 6 | `rls-ts-authoring` | Author the same policies in TypeScript, identical result. | ⬜ | [TML-2883](https://linear.app/prisma-company/issue/TML-2883) |

## Not-yet-done slices

### 2 — `schema-node-tree-restructure` (in review — [#894](https://github.com/prisma/prisma-next/pull/894))

Retire the conflated `PostgresSchemaIR` (it was a tree node, a schema, and the root at once). New single-purpose tree: **`PostgresDatabaseSchemaNode`** (root; holds roles) → **`PostgresNamespaceSchemaNode`** → **`PostgresTableSchemaNode`** → **`PostgresPolicySchemaNode`** / **`PostgresRoleSchemaNode`** leaves. Diff nodes are split from the authored Contract-IR entities (`PostgresRlsPolicy` / `PostgresRole` stay as the serialized entities). `introspect()` returns the root as a node; consumers `ensure` the target type and walk. Database→PSL inference moves onto the Postgres target (fixing a SQL-family layering violation). **No behavior change.** Spec + design: [`slices/schema-node-tree-restructure/`](slices/schema-node-tree-restructure/).

**Landed:** verify, the planner, and the migration runner share one `diffDatabaseSchema` (returning `{ issues, schemaDiffIssues }` — the two issue types stay distinct until follow-on A); the expected-side projection builds per-namespace, so same-named tables across schemas (`public.thing` + `auth.thing`) now project instead of throwing; inference moved to the Postgres target descriptor. Residual: **D1** (PSL inference still gathers the tree to a flat document for today's single-namespace `contract infer`; a fail-loud throw guards the same-name collision — tree-walk tracked in [TML-2958](https://linear.app/prisma-company/issue/TML-2958)).

### 3 — `explicit-rls-control`

- **`@@rls`** marks a model RLS-controlled independent of any policy → drives ENABLE/DISABLE. Removing the last policy leaves RLS **on** (deny-all, fail-closed); DISABLE only on marker removal. A policy on an unmarked model is an authoring error. First real table-attribute diff.
- **`managed`/`external` grading** per table, via the existing `partitionCallsByControlPolicy`.
- **Policy rename** → `ALTER POLICY … RENAME TO` (planner post-pass pairing `missing`+`extra` by content-hash).

### 4 — `migration-support-for-roles`

Roles become diffable off the root; a policy referencing a role absent from `pg_roles` fails verify, surfaced before the dependent policy (leaves-first). Seeds the dependency graph (follow-on B).

### 5 — `support-all-rls-policy-types`

PSL `policy_insert | policy_update | policy_delete | policy_all` descriptors + `withCheck`; the slice-3/4 lifecycle and drift behaviors verified per type. Descriptors + DDL + e2e, no new architecture.

### 6 — `rls-ts-authoring`

Top-level Postgres policy helpers taking the model handle (not a model-builder method), the `ref()` predicate helper, TS `@@rls`. A TS/PSL parity test pins structurally identical IR with identical wire names. Rationale: [`specs/design-rls-authoring-surface.md`](specs/design-rls-authoring-surface.md).

## Locked decisions

- **Architecture** ([ADR](specs/adr-schema-diff-over-structured-ir.md)): a generic differ walks two derived schema-IR trees → `{path, outcome}` issues; the framework never enumerates target kinds; node identity = content-addressed wire name; per-node-kind planner dispatch. **Zero RLS symbols in `1-framework` / `2-sql`** (enforced by a structural test). The legacy relational verifier/planner runs side-by-side until follow-on A retires it.
- **Management model:** a table is `managed` (contract owns its full policy set; extras dropped) or `external` (untouched) — table-level only, no per-policy flag. Authored on the table's Postgres-target annotation (no SQL-family leak).

## Out of scope / follow-on projects

- Role-ref **authoring** validation — roles are platform-provided; policies only reference them by name (slice 4 checks existence in the DB, nothing more).
- **A** — port the legacy relational verifier onto the generic differ (merges the two issue types `SchemaIssue` + `SchemaDiffIssue` into one). **B** — dependency-aware planner ordering (slice 4's edges seed it). **C** — a generic project-from-contract / project-from-database registration surface, once a second node type needs the shared shape. **D1** ([TML-2958](https://linear.app/prisma-company/issue/TML-2958)) — walk the schema-node tree in PSL inference instead of gathering it to a flat document; a fail-loud throw guards the same-name collision until then. (No planned slice owns this — it is not the RLS slices 3–6.)

## Linear

Tickets: slice 1 → TML-2868, 1.5 → TML-2931, 3 → TML-2869, 5 → TML-2870, 6 → TML-2883. **Slices 2 and 4 need new top-level tickets** (sibling issues with blocks/blockedBy relations, not sub-issues — [[no-linear-sub-issues]]). Blocking chain: 2931 → ⟨slice 2⟩ → TML-2869 → ⟨slice 4⟩ → TML-2870 → TML-2883. TML-2871 canceled (its contents folded into slices 1 and 4).
