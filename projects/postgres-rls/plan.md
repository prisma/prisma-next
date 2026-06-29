# postgres-rls — Plan

**Spec:** `projects/postgres-rls/spec.md`
**Linear Project:** [Postgres RLS](https://linear.app/prisma-company/project/postgres-rls-b7329340dbb2) · project issue [TML-2501](https://linear.app/prisma-company/issue/TML-2501) · parent umbrella [Supabase Integration](https://linear.app/prisma-company/project/supabase-integration-08e7667f5de4)

> **Re-cut 2026-06-10 (operator).** The previous cut named slices after layers ("authoring breadth", "verify/plan breadth") and let user-invisible machinery count as delivery — the local PR review exposed the consequences (drift was "detected" into a channel nothing reads; editing a policy silently left the stale one active). The new cut names each slice after the thing a user can rely on when it merges, and every slice AC is an **operator-observable behavior**, never an artifact.

## At a glance

Slice 1 makes **SELECT policies dependable end-to-end** — full lifecycle (create, change, remove), drift makes `db verify` fail, proven in the Supabase example app. Slice 1.5 (`entity-kind-migration-seam`), discovered during slice 1, builds the **generic two-sided derivation seam** so a target-contributed entity kind works on every migration command — notably `migration plan`, which slice 1 defers with a fail-loud stopgap. The forward work then runs as an ordered sequence: **slice 2 `schema-node-tree-restructure`** gives the schema-diff tree a real single-purpose node at every level (a `PostgresDatabaseSchemaNode` root above per-namespace nodes — the conflated `PostgresSchemaIR` root is retired) with no behavior change; **slice 3 `explicit-rls-control`** adds explicit `@@rls` enablement, table-level `managed`/`external` grading, and policy rename; **slice 4 `migration-support-for-roles`** makes roles diffable off the new root (the **policy→role** dependency-graph seed); **slice 5 `support-all-rls-policy-types`** extends everything to INSERT/UPDATE/DELETE/ALL; **slice 6 `rls-ts-authoring`** adds the TypeScript authoring surface with PSL parity.

RLS rides the generic schema-diff architecture (unchanged — see § Architecture decisions): generic differ + `{coordinate, outcome}` issues; zero RLS symbols in framework/SQL-family; content-addressed wire names; side-by-side with the untouched legacy relational verifier/planner. The relational port and dependency-aware planner ordering remain independent follow-on projects.

## Composition

This project can run in parallel with [cross-contract-refs](../cross-contract-refs/spec.md) and [runtime-target-layer](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md). The TS `ref()` helper consumes cross-contract model handles transparently — no integration work between the two projects beyond the brand contract already established by cross-contract-refs.

## Slices

### Slice 1 — `select-policies-dependable` · [TML-2868](https://linear.app/prisma-company/issue/TML-2868) · PR [#771](https://github.com/prisma/prisma-next/pull/771) (continues)

**Status: 🚧 in progress (PR #771).**

A developer can declare a SELECT policy and **rely on it**: it gets created, edits replace it, removals drop it, drift errors out, and the Supabase example app proves the whole thing.

Already landed on the branch: the architecture (generic differ, content-addressed naming + normalizer, introspection, PSL `policy_select` authoring through the production interpreter, create/enable ops, planner diff-wiring, the verify `extensionIssues` channel) and two PGlite e2e spines. **Remaining to slice DoD:**

1. **Fix the build** (review F01): `extensionIssues` made required without updating three constructors (mongo verify, CLI `db-verify`, `combine-schema-results`) — workspace `pnpm typecheck` must be green; add the workspace typecheck to the standing gates.
2. **Edit replaces, never accumulates** (kills the edit-trap) via **strict content-addressed drop** (F07 withdrawn — same-prefix rule superseded): the generic differ (`diffNodes`) matches on full `EntityCoordinate` identity. A `mismatch` outcome (same prefix, new hash) produces `DropPostgresRlsPolicyCall` + `CreatePostgresRlsPolicyCall`; an `extra` outcome (policy in the DB but not in the contract) produces `DropPostgresRlsPolicyCall`. Both drop calls are gated by the migration operation policy: they are only emitted when `destructive` is in `allowedOperationClasses` (i.e., `db update` with widening/destructive policy, not `db init`). Under additive-only policy (`INIT_ADDITIVE_POLICY`), drop calls are suppressed — only create/enable ops are emitted. **Shipped in slice 1.5:** the `extra`→`DropPostgresRlsPolicyCall` mapping and the unowned-*namespace* extra filter (so removal-drop works at the namespace grain). **Deferred to slice 3 (`explicit-rls-control`):** explicit `@@rls` table enablement (so RLS enable/disable is driven by the marker, not policy presence) and per-*table* `managed`/`external` grading.
3. **Drift errors out** (resolves F02 as wire-it-now, bluntly): any non-empty `extensionIssues` fails the verify verdict — fold into `ok`/counts at the family assembly and thread through `combineSchemaResults`. Nuanced per-kind severity is slice 2; slice 1's rule is simply *any RLS drift → verify fails with a message naming the policy*.
4. **Supabase example app e2e**: extend `bootstrapSupabaseShim` with the Postgres roles (`anon`, `authenticated`, `service_role`) and the `auth.uid()` GUC-reading function (verified 2026-06-10: the shim seeds only schemas/tables today; roles are platform-provided in real Supabase, so the shim emulates that — this project never authors or migrates roles); add a SELECT policy to `examples/supabase` `Profile`; e2e proves: migrate → rows filtered under the role → `db verify` clean → drop the policy out-of-band → `db verify` **fails**.
5. Review follow-ups in scope: F03 (role-name rendering shim hardening or input constraint), F05 (a parsed extension block with no registered factory must not be silently dropped), F07 (`rlsEnabledByTable` keyed by bare table name — cross-schema collision), the structural anti-leak test (assert no RLS tokens in framework/SQL-core, since `lint:deps` can't catch this class).

- **DoD (operator-observable):** declare a SELECT policy in the example app → migrate → only permitted rows visible under the role; edit the predicate → migrate → **exactly one policy active**, with the new predicate (the old version dropped via same-prefix replace); remove it from the contract → `db verify` reports the now-orphaned DB policy as drift (exits non-zero naming it) — auto-drop-on-removal is slice 2; drop/alter it out-of-band → `prisma db verify` exits non-zero naming the policy. Workspace typecheck green; all suites green.

### Slice 1.5 — `entity-kind-migration-seam` · [TML-2931](https://linear.app/prisma-company/issue/TML-2931)

**Status: ⬜ design complete, build not started.** Design: [`specs/adr-schema-diff-over-structured-ir.md`](specs/adr-schema-diff-over-structured-ir.md) (accepted) · seed [`specs/extension-migration-participation.md`](specs/extension-migration-participation.md). Slice spec: [`slices/entity-kind-migration-seam/spec.md`](slices/entity-kind-migration-seam/spec.md).

Foundational seam, discovered during slice 1. A target-contributed entity kind only half-participates in migrations: the live-database derivation is hardcoded in the Postgres reader, and the contract→schema derivation drops target-specific objects — so on the `migration plan` path the diff has no policies on either side, and on the live-DB paths it reaches into the contract object directly for the expected side. The consequence is that `migration plan` cannot emit RLS at all — slice 1 ships a fail-loud stopgap (it refuses to plan when the contract declares policies). This slice makes **both diff sides homogeneous, derived schema IRs** so a contributed node type works on **every** command.

Per the accepted schema-diff ADR:

- **project-from-contract builds a populated schema IR.** Postgres's `contractToSchema` returns a `PostgresSchemaIR` carrying its policies and roles, instead of a bare relational `SqlSchemaIR` that drops them. Both derivations — project-from-contract and project-from-database (introspection) — emit the same shape. Written directly in the Postgres target; **no registry** (deferred — follow-on C).
- **The differ walks two schema-IR roots.** A generic framework `diffSchemas(expected, actual)` walks two full roots (`identity()`→`coord()`, `children()` added). `diffPostgresSchema` (the Postgres schema-diff strategy) projects the contract's policies for the expected side, walks the **full** introspected tree for the actual side, and suppresses unowned-namespace `extra` issues **post-diff** via the generic `filterSchemaIssuesByOwnership` (the supabase multi-space fix, preserved as an outcome filter, not a pre-filter on the tree — slice 2 folds it into the unified control-policy disposition). The differ itself never reads the contract.
- **The planner becomes provenance-agnostic.** Remove the `migration plan` fail-loud stopgap and the two `isPostgresSchemaIR` command-branches in `planner.ts`; the diff path runs identically regardless of which derivation fed each side.
- **Roles projected, not yet diffed.** project-from-contract populates roles so the IR is symmetric, but only policies are diffed here (the schema root yields policies, not roles) — role drift (missing-role detection, the policy→role edge) stays slice 2. Net observable change of this slice: `migration plan` emits RLS; `db init` / `db update` / `db verify` behave exactly as before.
- **DoD (operator-observable):** `migration plan` on a contract with a SELECT policy emits `CREATE POLICY` in the generated migration; both diff sides are homogeneous schema IRs (the contract is not read directly on either side); RLS still works on `db init` / `db update` / `db verify`; SQLite + Mongo untouched.

The forward work is a single ordered sequence. Slices 1 and 1.5 are done; the rest run in this order, each with its own Linear ticket.

### Slice 2 — `schema-node-tree-restructure` · _(Linear: new ticket, blockedBy TML-2931)_

**Status: ⬜ next up.** Foundational and behavior-neutral — done first so the role/dependency work isn't dancing around a conflated root for the next several slices.

Slice 1.5 made `PostgresSchemaIR` carry three unrelated jobs at once: a node in the schema-diff tree, a Postgres schema (namespace), and the root of the tree. That conflation is the thing to remove before anything is built on top of it. This slice gives the schema-diff tree a real, single-purpose node at every level, modelled on Postgres's own object hierarchy:

- **`PostgresDatabaseSchemaNode`** (root) — children are namespaces; also holds roles (held, **not yet diffed** — that arrives in slice 4).
- **`PostgresNamespaceSchemaNode`** — one per schema/namespace; children are tables. Has the same `.tables` shape the old flat `PostgresSchemaIR` had, so the legacy per-schema consumers take a namespace node unchanged (below).
- **`PostgresTableSchemaNode`** (rename of `PostgresTableIR`) — children are policies; will carry the `rlsEnabled` flag (slice 3).
- **`PostgresPolicySchemaNode`** / **`PostgresRoleSchemaNode`** (leaves) — **new** diff nodes. The authored entities `PostgresRlsPolicy` / `PostgresRole` stay as **Contract IR** (they are serialized into `contract.json`); they lose `DiffableNode` and move out of `schema-ir/`. Tables already split this way (`StorageTable` contract vs `PostgresTableIR` diff node); policies/roles now match.

The `…SchemaNode` suffix marks these as nodes in the **schema-diff** tree (the derived database-state representation), distinct from the **Contract IR** entities — bare `…IR` is dropped because the repo has several IRs and the suffix said nothing.

- **Introspect returns the root.** The RLS differ walks the whole tree. The **legacy relational verify, planner, and CLI schema view are unchanged** — they take a `PostgresNamespaceSchemaNode` (same `.tables` shape as before); the caller walks root→namespaces and feeds each to that per-schema code (exactly one node in the single-schema common case). No flat-read of the root, no shim, no dual representation. This also retires the old multi-schema "merge into one flat IR" (and its silent cross-schema table-name collision).
- **Inference moves to the Postgres target.** Database→PSL inference is target logic — it walks the tree and owns the Postgres type/default maps (currently a layering violation: `sql-schema-ir-to-psl-ast.ts` hardcodes `createPostgresTypeMap`/`createPostgresDefaultMapping` in SQL-family code). The Postgres target descriptor gains `inferPslContract(tree)`; the family instance delegates to it; the flat `sqlSchemaIrToPslAst`/`buildPslDocumentAst` walkers are deleted. The framework keeps `PslDocumentAst` + `printPsl` (the view and printer); the control adapter is untouched. (TS contract inference stays a future sibling — same target-owned shape — not built here.)
- **No behavior change.** `migration plan` / `db init` / `db update` / `db verify` and `contract infer` output are byte-for-byte unchanged. SQLite + Mongo untouched.
- **DoD:** the node family + the `PostgresDatabaseSchemaNode` root are in place; policies/roles are split into Contract-IR entities and schema-diff nodes; inference is target-owned; all RLS migration + `contract infer` suites green with unchanged output. (Structural slice — its "observable" guarantee is *no* observable change; operator-visible behavior lands in slices 3–4 on top of the clean tree.)

### Slice 3 — `explicit-rls-control` · [TML-2869](https://linear.app/prisma-company/issue/TML-2869)

**Status: ⬜ not started.**

RLS enablement becomes explicit, and the in-a-single-schema drift variations are handled **correctly** (not just "error").

- **Explicit `@@rls` enablement** (replaces slice 1's deferred "disable on last policy"): a model marks its table RLS-controlled with a `@@rls` block, independent of whether any policy references it.

  ```prisma
  model User {
    @@rls
  }

  policy user_isolation {
    model = User
    // …
  }
  ```

  `ENABLE ROW LEVEL SECURITY` is emitted when the marker is present and the live table has RLS off; `DISABLE ROW LEVEL SECURITY` (destructive-gated) when the marker is removed. Removing the last policy from an `@@rls` model leaves RLS **on** — the table denies all access (fail-closed) rather than silently dropping authorization. A policy on a model without `@@rls` is an authoring error. RLS-enabled becomes the first real **table-attribute diff** (`PostgresTableSchemaNode.isEqualTo` compares it; introspection reads `pg_class.relhasrowsecurity`), which also subsumes the "RLS-disabled-with-policies-declared" drift case.
- **Table-level `managed`/`external` grading:** route RLS drop calls through the existing `partitionCallsByControlPolicy` so a table's `control` grade decides reconciliation — `managed` tables drop their extra policies, `external` tables are left untouched. Slice 1.5 already filters unowned-*namespace* extras and drops owned extras under the destructive gate; this adds the per-*table* grade so `managed` and `external` tables in the **same** schema are distinguished. The authoring surface (`StorageTable.control` / `defaultControlPolicy`) already exists — this slice only makes the RLS diff path consult it.
- **Policy rename:** a same-body, different-prefix policy currently emits DROP+CREATE; a planner post-pass pairs a `missing`+`extra` by content-hash on the same table and emits `ALTER POLICY … RENAME TO` instead (new op). The blunt slice-1 "any drift errors" rule refines into per-variation verdicts.
- **DoD (operator-observable):** add `@@rls` + a policy + migrate → table has RLS enabled with the policy; remove the last policy → table still RLS-enabled (deny-all), no DISABLE emitted; remove `@@rls` → DISABLE emitted (destructive-gated); rename a policy prefix → migrate emits a RENAME (verifiable in plan output); an `external` table's extra policies are left untouched while a `managed` table's are dropped.

### Slice 4 — `migration-support-for-roles` · _(Linear: new ticket, blockedBy TML-2869)_

**Status: ⬜ not started.**

The schema graph gains its first edge: a policy depends on the roles it references. The `PostgresRoleSchemaNode` leaves that slice 2 hung off the root (held, not diffed) become diffable here.

- **Roles become diffable nodes** off `PostgresDatabaseSchemaNode` — diffed once at the database level, not once per schema (the reason the root had to exist before this slice).
- **Policy → role traversal (the dependency-graph seed):** a policy referencing a role absent from `pg_roles` surfaces a missing-role issue. Issue processing is **leaves-first, then up the tree** — the role leaf's issue surfaces before/along the dependent policy's — establishing the edge model the future dependency-aware planner (follow-on B) builds on.
- **DoD (operator-observable):** reference a role that doesn't exist → verify fails naming the role; the missing-role issue is ordered before its dependent policy's.

### Slice 5 — `support-all-rls-policy-types` · [TML-2870](https://linear.app/prisma-company/issue/TML-2870)

**Status: ⬜ not started.**

Everything slices 1–4 made dependable for SELECT works for **INSERT / UPDATE / DELETE / ALL** policies.

- PSL `policy_insert | policy_update | policy_delete | policy_all` block descriptors lowering through the same generic interpreter pass; `withCheck` handling (INSERT/UPDATE) end-to-end; the lifecycle + drift behaviors from earlier slices verified per type (the content-hash already covers operation + withCheck, so this is descriptors + DDL rendering + per-type e2e, not new architecture).
- **DoD (operator-observable):** the slice-1 example-app scenario repeated with an UPDATE-own policy (`using` + `withCheck`): a user can update only their own row; editing/removing/drifting behaves exactly as for SELECT.

### Slice 6 — `rls-ts-authoring` · [TML-2883](https://linear.app/prisma-company/issue/TML-2883)

**Status: ⬜ not started.**

A developer can author the same policies in **TypeScript** instead of PSL, with identical results.

- Top-level Postgres-contributed policy helpers taking the model handle (the decided surface — the `enum`/`entityTypes` mechanism, invisible to SQLite/Mongo authors; **not** a model-builder method; rationale in [`specs/design-rls-authoring-surface.md`](specs/design-rls-authoring-surface.md)). Settles the still-open **per-operation (`policySelect(…)`) vs single-array** helper-signature decision at slice pickup.
- The `ref()` predicate helper (reads `{namespaceId, tableName}` off `extensionModel(…)` handles so predicates track renames); model-level RLS enable/disable (the TS form of `@@rls`); duplicate-prefix/name diagnostics.
- **TS/PSL parity test:** the same policies authored both ways lower to structurally identical IR with identical wire names.
- **DoD (operator-observable):** the slice-1 example-app scenario authored in TS instead of PSL behaves identically (filtered rows, lifecycle, drift→verify-fails); the parity test pins identical contracts.

## Management model — locked decision (2026-06-16)

**Default is exclusive management at the table level.**

A table is either `managed` (the contract owns its full policy set) or `external` (the contract does not touch it). There is no per-policy granularity — no "is this policy ours?" flag on individual policies.

Consequences:
- A policy present in the DB but absent from the contract on a **managed** table is `extra` → dropped on migrate.
- A policy on an **external** table is never reconciled — the differ skips it entirely; no `extra` issued.
- The `external` vs `managed` distinction is table-level authoring (on `StorageTable`'s Postgres-target annotation, not on `StorageTable` itself — no SQL-family leak).

The slice-4 resolution: when introspecting for the differ, only collect policies for tables that are `managed`; for `external` tables, the introspected policy set is treated as empty (nothing to diff against). This avoids needing per-policy provenance metadata or a `prismaManaged` flag on the catalog row.

## Not in this project's plan-of-record (operator cut, 2026-06-10)

- **Cross-space role-ref *validation* / role authoring** — roles are external (platform-provided; shim-seeded in tests); policies reference them by name. The substrate's cross-space pass-through stands; real role-ref validation arrives with slice 2's role traversal only to the extent of "referenced role exists in the DB," not authoring-time cross-space resolution.
- Independent follow-on projects: **A** — port the 25 legacy relational verifier node types onto the generic differ; **B** — dependency-aware generic planner ordering (slice 2's policy→role edges are its seed); **C** — promote the per-target derivations (project-from-contract / project-from-database) into a generic registration surface, once a second consuming node type — the relational port, or another extension — makes the shared shape concrete (deferred from slice 1.5 per the schema-diff ADR).

## Architecture decisions (locked 2026-06-09 — unchanged by the re-cut)

1. Generic differ, same-hierarchy comparison; issues are `{coordinate, outcome: missing|extra|mismatch}` — the framework never enumerates target kinds.
2. `identity()` / `isEqualTo()` as virtual methods on nodes; policy identity = content-addressed wire name.
3. Per-node-kind planner dispatch (`create/delete/update → OpFactoryCall[]`); coarse buckets now, dependency graph later (slice 2 seeds the edges; follow-on B builds the ordering).
4. Derivation/introspection hold per-kind smarts; the diff stays a pure walk.
5. Side-by-side with the legacy verifier/planner until follow-on A retires it; the new path emits only new-native structures.
6. Layering invariant: zero RLS symbols in `packages/1-framework` / `packages/2-sql` — to be enforced by a structural test (slice 1 item 5), not review vigilance.

Refined by the schema-diff ADR ([`specs/adr-schema-diff-over-structured-ir.md`](specs/adr-schema-diff-over-structured-ir.md)): the differ walks two derived schema-IR roots rather than flat node lists; the node alignment method is `coord()` (renamed from `identity()`) and nodes expose `children()`; both diff sides are homogeneous derived IRs produced by project-from-contract / project-from-database.

## Linear sync

TML-2868 → `select-policies-dependable` (re-scoped; PR #771 continues under it). [TML-2931](https://linear.app/prisma-company/issue/TML-2931) → `entity-kind-migration-seam` (slice 1.5; PR #868 merged 2026-06-28). The forward sequence and its tickets:

- **Slice 2 `schema-node-tree-restructure`** — **new top-level ticket** (not yet created), blockedBy TML-2931, blocking TML-2869.
- **Slice 3 `explicit-rls-control`** — TML-2869 (re-scoped from `drift-handled-correctly`).
- **Slice 4 `migration-support-for-roles`** — **new top-level ticket** (not yet created), blockedBy TML-2869, blocking TML-2870.
- **Slice 5 `support-all-rls-policy-types`** — [TML-2870](https://linear.app/prisma-company/issue/TML-2870).
- **Slice 6 `rls-ts-authoring`** — [TML-2883](https://linear.app/prisma-company/issue/TML-2883).

Per [[no-linear-sub-issues]] the two new tickets are sibling issues wired with blocks/blockedBy relations, not sub-issues. TML-2871 → canceled (contents split: example-app skeleton → slice 1; role existence → slice 4; cross-space role validation → dropped).
