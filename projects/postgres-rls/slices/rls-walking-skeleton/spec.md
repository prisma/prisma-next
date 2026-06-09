# Slice spec: `rls-walking-skeleton`

Parent project: `projects/postgres-rls/` ([spec](../../spec.md) · [plan](../../plan.md) · [design record](../../specs/design-generic-schema-differ.md)). Slice 1 of 4. Linear: [TML-2868](https://linear.app/prisma-company/issue/TML-2868) · PR [#771](https://github.com/prisma/prisma-next/pull/771) (draft).

> **This spec is prescriptive by intent.** It names exact files, signatures, and patterns-to-mirror so the implementer matches existing code rather than inventing. Where it says "mirror X at `path:line`", read that code and copy its shape. Where it says "confirm by grep", the exact line may have shifted — find it, don't guess. Do **not** introduce designs not described here; if something here is impossible or wrong, **halt and surface to the orchestrator** (see § Halt conditions).

## 1. Goal — the one vertical thread

A developer authors a single PSL `policy_select` block; it threads through the **new generic-differ architecture** to filter rows on a live PGlite database, while the legacy relational verifier/planner runs untouched beside it. Concretely, end-to-end:

```
PSL policy_select  →  PostgresRlsPolicy IR  →  (expected) Postgres RLS nodes
                                                     │
live PGlite introspected (pg_policies/pg_roles) →  (actual) Postgres RLS nodes
                                                     │
                          generic differ  →  SchemaDiffIssue{coordinate, outcome}
                                                     ├─ verifier reports them
                                                     └─ planner maps them → CreatePostgresRlsPolicyCall + EnableRowLevelSecurityCall
                                                                              → apply to PGlite → SET ROLE → rows filtered → re-diff clean
```

The slice proves: the generic `SchemaDiffIssue` model, node `identity()`/`isEqualTo()`, the generic differ, per-node planner dispatch, RLS introspection, and PSL `policy_select` authoring — and removes the foundation leaks as part of building the correct path.

## 2. Scope

**In scope (build all of this):** §6 A–I below.

**Explicitly OUT of scope — do not build, do not stub beyond what's stated:**
- TS authoring surface, `ref()` predicate helper, the other PSL operations (`policy_insert/update/delete/all`), duplicate-prefix/name diagnostics, TS/PSL parity test — **slice 2**.
- Policy `mismatch`/rename/tamper handling, `missing_role` emission, `DropPostgresRlsPolicyCall`/`AlterPostgresRlsPolicyCall`/`DisableRowLevelSecurityCall`, control-policy severity for RLS — **slice 3**. (This slice handles **`missing` → create** and a clean re-diff only.)
- Cross-space roles, the Supabase shim, `examples/supabase`, `auth.uid()` GUC functions, `CREATE ROLE` — **slice 4**. (The test **pre-creates** its role; see §6-I.)
- Porting any of the 25 relational kinds onto the differ; dependency-aware ordering — **follow-on projects A/B**, never in this slice.
- SQLite and Mongo: **untouched** (except deleting the leak guards in §6-A).

## 3. Invariants (must hold at slice DoD)

1. **No RLS in framework or SQL-family/core.** After this slice, `grep -ri 'rls\|policy\|rowsecurity'` over `packages/1-framework/**` and `packages/2-sql/**` finds **only** the generic, RLS-agnostic differ machinery (`SchemaDiffIssue`, `DiffableNode`, `diffNodes`) — never `PostgresRlsPolicy`, `rls_policy_*`, `StorageTable.rls`, or a Postgres validator. `pnpm lint:deps` clean.
2. **No legacy re-emission.** The new path produces `SchemaDiffIssue` (not framework `SchemaIssue`) and its own `OpFactoryCall`s (not via `mapIssueToCall`). The legacy relational verifier/planner is **not modified** (beyond deleting the leak guards).
3. **Side-by-side.** A contract with a table + a policy yields, in one run: legacy `CREATE TABLE` (legacy path) + new `EnableRowLevelSecurity` + `CreatePostgresRlsPolicy` (new path), in one applied plan.
4. **Tests-first** (repo convention): land the failing assertion, then implement.
5. **No bare casts**, no `any`, arktype not zod, `pnpm`/no `npx`, no import file-extensions — standard repo rules.

## 4. Pre-flight reconnaissance (run before coding; confirm the seams)

The line numbers below are from research on 2026-06-09 and may drift — confirm each:
- `rg -n 'verifyTargetExtensions|verifyCommonSqlSchema' packages/2-sql/9-family/src/core/ir/sql-schema-verifier-base.ts`
- `rg -n 'export function verifySqlSchema' packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts`
- `rg -n 'async introspect' packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`
- `rg -n 'class AddForeignKeyCall|PostgresOpFactoryCall =' packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`
- `sed -n '1,200p' packages/1-framework/2-authoring/psl-printer/test/fixtures/declarative-policy-select-extension.ts`
- `sed -n '100,200p' packages/3-targets/6-adapters/postgres/test/migrations/cross-namespace-fk.integration.test.ts`

## 5. Settled decisions (do not relitigate; rationale in the design record)

- **Reuse `PostgresRlsPolicy` / `PostgresRole` as the canonical diff nodes.** Do **not** create a parallel SchemaIR policy/role hierarchy. The contract IR classes *are* the canonical nodes; introspection builds the same classes; the differ compares them. (For RLS, "derive contract → SchemaIR" is identity — the policy IR is already canonical.)
- **Reuse the framework `EntityCoordinate`** (`framework-components/src/ir/storage.ts`: `{plane, namespaceId, entityKind, entityName}`) as the diff coordinate. For a policy: `entityKind: 'rlsPolicy'`, `entityName:` the full wire name. For a role: `entityKind: 'role'`, `entityName:` the role name. No new coordinate type (nested coordinates are the relational-port project's concern).
- **Identity = wire name for policies** (the content hash encodes the body), **= name for roles**. So `isEqualTo` for a policy is wire-name equality; for a role, name equality.
- **Introspection recomputes the wire name** from the introspected body via the existing `computeContentHash`/`normalizePredicate` (`postgres/src/core/rls/canonicalize.ts`). So a reformatted-but-equivalent body recomputes to the same name (no false drift); this slice only needs `missing` + clean, but build introspection to recompute (don't trust the catalog name blindly).
- **Enable-RLS is derived:** when the differ reports a `missing` policy on a table whose introspected `relrowsecurity` is false, the planner emits `EnableRowLevelSecurityCall` for that table in addition to `CreatePostgresRlsPolicyCall`. No `StorageTable.rls` field.

## 6. Build — components (each: files · change · done-check)

### A. Remove the leaks (do this first; gets the branch to a clean substrate)

Delete or relocate exactly these (confirm each by grep; the line numbers are from 2026-06-09):

**Delete (framework `SchemaIssue` union + exports):**
- `packages/1-framework/1-core/framework-components/src/control/control-result-types.ts` — remove `RlsPolicyRenamedIssue` (~104-113), `RlsPolicyTamperedIssue` (~115-122), `RlsNotEnabledIssue` (~124-129), and the three members from the `SchemaIssue` union (~131-136).
- `packages/1-framework/1-core/framework-components/src/exports/control.ts` — remove the three re-exports (~63-65).

**Delete (SQL-family classifier cases):**
- `packages/2-sql/9-family/src/core/schema-verify/verifier-disposition.ts` — remove the three RLS `case` arms in `classifySqlVerifierIssueKind` (~50-55).

**Delete (planner narrowing guards — exist only because the kinds were in the shared union):**
- `packages/3-targets/3-targets/sqlite/src/core/migrations/issue-planner.ts` (~149-151, ~201-202)
- `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-strategies.ts` (~111-113, ~144-146)
- `packages/3-targets/3-targets/sqlite/src/core/migrations/operations/tables.ts` (~264-266)
- `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts` (~156-158)

**Delete (`StorageTable.rls` / `RlsMode`):**
- `packages/2-sql/1-core/contract/src/ir/storage-table.ts` — remove `RlsMode` (~11), `StorageTableInput.rls?` (~21-28 region), the `declare readonly rls?` field (~51), and the constructor assignment (~80).
- `packages/2-sql/1-core/contract/src/types.ts` (~41) and `packages/2-sql/1-core/contract/src/exports/types.ts` (~25) — remove the `RlsMode` re-exports.
- `packages/2-sql/1-core/contract/src/validators.ts` — remove `'rls?'` from `StorageTableSchema` (~223).

**Relocate (Postgres entity validators currently in SQL core → Postgres target):**
- Move `PostgresRoleSchema` (~229-233) and `PostgresRlsPolicySchema` (~239-249) out of `packages/2-sql/1-core/contract/src/validators.ts` into the Postgres target, contributed via the existing `entityTypes` `validatorSchema` fragment channel in `packages/3-targets/3-targets/postgres/src/core/authoring.ts` (the `role`/`rlsPolicy` entries at ~59-74 already exist; attach the schemas there). Remove the hardcoded `role?`/`rlsPolicy?` fallback wiring in `createNamespaceEntrySchema` (`validators.ts:348-349`) — the fragment channel supplies them.

**Keep (these are correctly target-owned — do not touch):** `PostgresRlsPolicy`, `PostgresRole`, their `entityTypes` registration, `PostgresSchema.entries.role/rlsPolicy`, the serializer slots, `canonicalize.ts`.

**Done-check:** `pnpm typecheck` workspace-green after a build; `pnpm lint:deps` clean; `grep` for `rls`/`RlsMode`/`rls_policy_` over `packages/1-framework` and `packages/2-sql` returns nothing (except the generic differ added in B). The existing foundation tests for the IR classes + serializer still pass.

### B. Generic differ + issue type (framework, RLS-agnostic)

New file `packages/1-framework/1-core/framework-components/src/control/schema-diff.ts` (confirm the right directory next to `control-result-types.ts`):

```ts
import type { EntityCoordinate } from '../ir/storage';   // confirm path

export type SchemaDiffOutcome = 'missing' | 'extra' | 'mismatch';

export interface SchemaDiffIssue {
  readonly coordinate: EntityCoordinate;
  readonly outcome: SchemaDiffOutcome;
  readonly message: string;
}

/** A node the generic differ can align and compare. Implemented by target IR nodes. */
export interface DiffableNode {
  identity(): EntityCoordinate;          // local key, lifted to a coordinate
  isEqualTo(other: DiffableNode): boolean;
}

/** Align two node collections by identity; emit missing/extra/mismatch. Kind-agnostic. */
export function diffNodes(
  expected: readonly DiffableNode[],
  actual: readonly DiffableNode[],
): readonly SchemaDiffIssue[];
```

`diffNodes` algorithm (specify exactly): index both sides by a stable string key derived from `identity()` (e.g. `${entityKind}\0${namespaceId}\0${entityName}`); for keys in expected only → `missing` (coordinate from the expected node); actual only → `extra`; in both → call `expected.isEqualTo(actual)`, and on `false` → `mismatch`. Deterministic order (sort issues by the string key). Export `SchemaDiffIssue`, `DiffableNode`, `diffNodes` from the framework control entrypoint (`exports/control.ts`).

**Done-check:** a framework unit test over two synthetic `DiffableNode` arrays asserts missing/extra/mismatch/clean. No reference to RLS anywhere in this file.

### C. `PostgresRlsPolicy` / `PostgresRole` implement `DiffableNode`

`packages/3-targets/3-targets/postgres/src/core/postgres-rls-policy.ts` and `postgres-role.ts`: implement the framework `DiffableNode` interface.
- `PostgresRlsPolicy.identity()` → `{ plane: 'storage', namespaceId, entityKind: 'rlsPolicy', entityName: this.name }` (the full wire name).
- `PostgresRlsPolicy.isEqualTo(other)` → narrow `other` to `PostgresRlsPolicy` (assert kind), return `this.name === other.name` (wire name encodes the body — content-addressed equality).
- `PostgresRole.identity()` → `{ …, entityKind: 'role', entityName: this.name }`; `isEqualTo` → `this.name === other.name`.

(The classes already `freezeNode`; adding methods is fine — confirm methods survive freeze, i.e. defined on the prototype, not as frozen own-properties.)

**Done-check:** unit test: two `PostgresRlsPolicy` with the same body → equal identities + `isEqualTo` true; different bodies → different wire names → `isEqualTo` false.

### D. RLS introspection (Postgres adapter)

`packages/3-targets/3-targets/postgres/src/core/control-adapter.ts` — extend `introspectSchema` (~660) with three `driver.query` calls (mirror the existing `information_schema`/`pg_catalog` query pattern at ~665-891):
- `pg_policies` (schemaname, tablename, policyname, cmd, roles, qual, with_check, permissive) → build `PostgresRlsPolicy` instances. **Recompute** the wire name: normalize `qual`/`with_check` via `normalizePredicate` and `computeContentHash` (`postgres/src/core/rls/canonicalize.ts`); the `prefix` is the catalog `policyname` minus its `_<8hex>` suffix (or store the catalog name as `name` and `prefix` as catalog-name-without-suffix — confirm with the content-hash ADR). For the skeleton, map `cmd` → `operation`, `roles` → sorted role names, `permissive` → boolean.
- `pg_roles` (rolname) → `PostgresRole` instances (filter to non-system roles; confirm a sane filter — e.g. exclude `pg_*` and the bootstrap superuser).
- `pg_class.relrowsecurity` joined to the schema's tables → a per-table `boolean` "RLS enabled" map.

Stash these on the introspection output. Since `SqlSchemaIR` has **no** policy/role slots, follow the existing `annotations.pg` pattern (how `storageTypes` is stashed at ~1103-1112) — add `annotations.pg.rlsPolicies`, `annotations.pg.roles`, `annotations.pg.rlsEnabledByTable`. **Do not** add policy/role slots to the family-shared `SqlSchemaIR`.

**Done-check:** an integration test (PGlite) that `CREATE POLICY`s a row manually, then `introspect()`, finds the policy as a `PostgresRlsPolicy` with a recomputed wire name matching what the contract would produce for the same body.

### E. Contract → expected RLS nodes (derivation)

For RLS the derivation is trivial: the contract's `PostgresSchema.entries.rlsPolicy` / `entries.role` values **are** the expected `PostgresRlsPolicy` / `PostgresRole` nodes. Add a small Postgres-side helper that reads them off the contract for a namespace (mirror how the serializer reads `entries` at `postgres-contract-serializer.ts:121-146`). No new node type.

**Done-check:** covered by the verify/plan tests in H/I.

### F. Per-node planner ops + planner wiring

New file `packages/3-targets/3-targets/postgres/src/core/migrations/operations/rls.ts` — mirror `operations/constraints.ts:109-138` (`addForeignKey`):
- `createRlsPolicy(schemaName, tableName, policy: PostgresRlsPolicy): Op` — `execute: [ step('create policy …', renderCreatePolicySql(...)) ]`, with `precheck`/`postcheck` using a policy-exists check (`SELECT … FROM pg_policies WHERE policyname = $1`). `operationClass: 'additive'`.
- `enableRowLevelSecurity(schemaName, tableName): Op` — `execute: [ step('enable RLS …', 'ALTER TABLE … ENABLE ROW LEVEL SECURITY') ]`. `operationClass: 'additive'`.

New `*Call` classes in `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` — mirror `AddForeignKeyCall` (~603-627): `CreatePostgresRlsPolicyCall` (`factoryName: 'createRlsPolicy'`, holds schema/table/policy, `toOp()` → `createRlsPolicy(...)`, `renderTypeScript()`), `EnableRowLevelSecurityCall` (`factoryName: 'enableRowLevelSecurity'`). Add both to the `PostgresOpFactoryCall` union (~1106). `freeze()` in constructor.

Planner wiring — `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts` (or the `plan()` assembly): add an **RLS diff step** that runs alongside the legacy relational diff. It (1) reads expected RLS nodes from the contract (E), (2) reads actual RLS nodes from the introspected schema's `annotations.pg` (D), (3) calls `diffNodes` for policies and for roles, (4) for each `missing` policy issue emits `CreatePostgresRlsPolicyCall`, plus `EnableRowLevelSecurityCall` for its table if `annotations.pg.rlsEnabledByTable[table]` is false (dedupe enable per table). Place the new calls in coarse-bucket order **after** table creation (confirm the bucket mechanism in `classifyCall`/`ISSUE_KIND_ORDER`; add a bucket/priority so policies + enable land after `CREATE TABLE`). Do **not** route RLS through `mapIssueToCall`.

**Done-check:** an op/DDL snapshot test: given a contract with one table + one `policy_select` and an empty introspected schema, `plan()` produces `CREATE TABLE` (legacy) + `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` (new), in that order.

### G. PSL `policy_select` authoring

`packages/3-targets/3-targets/postgres/src/core/authoring.ts` — add a `pslBlockDescriptors.policy_select` contribution (the Postgres pack has **none** today). Mirror the landed fixture `packages/1-framework/2-authoring/psl-printer/test/fixtures/declarative-policy-select-extension.ts` (~157-187): `keyword: 'policy_select'`, `discriminator: 'postgres-rls-policy'`, `name.required: true`, parameters `target: {kind:'ref', refKind:'model', scope:'same-namespace', required:true}`, `roles: {kind:'list', of:{kind:'ref', refKind:'role', scope:'cross-space'}}` (**mirror the fixture, which uses `cross-space`** — corrected 2026-06-09 after D4 review; my earlier `same-namespace` was wrong: roles are *entity types*, not PSL blocks, so `entries['role']` is empty in a parsed doc and a `same-namespace` role ref spuriously fails. `cross-space` here rides the substrate's deferred **no-op pass-through**, so the role name flows through **unvalidated** for now; real role-ref resolution is slice 4), `using: {kind:'value', codecId:'pg/text@1', required:true}`. Wire the descriptor so the block lowers to a `PostgresRlsPolicy` with `operation: 'select'`, `permissive: true`, the content-hash wire `name` computed from the body (reuse `computeContentHash`). Confirm descriptors are collected via `descriptor.authoring.pslBlockDescriptors` (control-stack.ts ~188-205).

**Done-check:** a parse→lower test: a PSL `policy_select` block produces a `PostgresRlsPolicy` in `entries.rlsPolicy` with the expected wire name + fields. Round-trips through the serializer (foundation already supports this).

### H. Verify wiring (the new channel, side-by-side)

The production verifier is `verifySqlSchema` (`packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts:123`), assembled at ~296-321 into `VerifyDatabaseSchemaResult.schema`. Add a **generic, RLS-agnostic** extension channel:
- Add a new field to the verify result `schema` object (control-result-types.ts `VerifyDatabaseSchemaResult.schema`, ~162-171): `extensionIssues: readonly SchemaDiffIssue[]` (generic type from B — no RLS knowledge).
- Provide a generic seam for a target to contribute `SchemaDiffIssue[]`: the cleanest is to have the Postgres adapter/verifier compute the RLS diff (using `diffNodes` over contract vs introspected `annotations.pg`) and thread the result into `extensionIssues`. Confirm the exact call site where `verifySqlSchema` is invoked with target context (the cross-namespace test calls `familyInstance.verifySchema(...)`; trace how the Postgres adapter participates). If the only clean way to run a target-specific verify step requires touching family core with RLS knowledge, **halt and surface** — the channel must stay generic.

**Done-check:** PGlite integration: declare a policy, apply, `introspect()`, verify → `extensionIssues` empty (clean). Drop the policy out of band, verify → one `extra` (or declare-only-not-applied → one `missing`).

### I. The walking-skeleton integration test (the slice's spine)

New test under `packages/3-targets/6-adapters/postgres/test/migrations/` (mirror `cross-namespace-fk.integration.test.ts:107-197` exactly for PGlite startup, plan, apply, introspect). Use `test.execArgv = ['--no-memory-protection-keys']` (per `runner-fixtures.ts`; required on Linux CI). Scenario:

1. **Build the contract** from PSL (G) — one namespace, one table `profile(id, owner_id, …)`, one role `app_user` (same-space), one `policy_select profiles_read_own { target = profile; roles = [app_user]; using = "owner_id = current_setting('app.uid')::int" }`. (Or build the contract via the foundation IR directly if PSL plumbing in G isn't reachable from the adapter test — confirm which is simpler; PSL is preferred to prove the vertical.)
2. **Pre-create the role** in PGlite: `driver.query('CREATE ROLE app_user')` (role creation is out of scope for the planner; the harness does it).
3. **Plan** against the empty schema (mirror lines 113-121: `createPlanner(controlAdapter).plan({ contract, schema: emptySchema, policy: INIT_ADDITIVE_POLICY, fromContract: null, frameworkComponents, spaceId })`). Assert the plan contains `CREATE TABLE` (legacy), `ENABLE ROW LEVEL SECURITY`, and `CREATE POLICY` (new).
4. **Apply** (mirror lines 158-162): iterate `plan.operations`, run `[...precheck, ...execute, ...postcheck]` via `driver.query`.
5. **Prove RLS filters rows:** insert two rows with different `owner_id`; `GRANT SELECT ON profile TO app_user`; `SET ROLE app_user`; `SELECT set_config('app.uid', '<owner of row 1>', false)`; `SELECT * FROM profile` → assert **only row 1** returns; `RESET ROLE`.
6. **Re-verify clean:** `introspect()` then the verify path (H) → `extensionIssues` empty.

**Done-check:** this test passes in CI (PGlite), and is the slice's acceptance proof.

## 7. Acceptance criteria (binary)

- [ ] **AC1 — leaks gone.** No `rls`/`RlsMode`/`rls_policy_*`/Postgres-validator reference in `packages/1-framework/**` or `packages/2-sql/**` (except the generic `SchemaDiffIssue`/`DiffableNode`/`diffNodes`). `pnpm lint:deps` clean; workspace `pnpm typecheck` green post-build.
- [ ] **AC2 — generic differ.** `diffNodes` + `SchemaDiffIssue` + `DiffableNode` exist in the framework, RLS-agnostic, unit-tested for missing/extra/mismatch/clean.
- [ ] **AC3 — PSL authoring.** A `policy_select` block lowers to a `PostgresRlsPolicy` with the content-hash wire name and round-trips through the serializer.
- [ ] **AC4 — introspection.** `introspect()` reads `pg_policies`/`pg_roles`/`relrowsecurity` into `PostgresRlsPolicy`/`PostgresRole` (recomputed wire names) under `annotations.pg`; family `SqlSchemaIR` unchanged.
- [ ] **AC5 — plan.** `plan()` emits `CREATE TABLE` + `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` for a contract with one table + one policy against an empty schema; RLS calls do not go through `mapIssueToCall`.
- [ ] **AC6 — walking skeleton (the spine).** The §6-I PGlite test passes: author → plan → apply → `SET ROLE` → **only the owner's row returns** → re-verify clean (`extensionIssues` empty).
- [ ] **AC7 — side-by-side / no re-emission.** The new path emits `SchemaDiffIssue` + new `OpFactoryCall`s only; the legacy relational verifier/planner is unmodified (beyond §6-A guard deletions); SQLite + Mongo suites green; `pnpm fixtures:check` clean.

## 8. Halt conditions (surface to the orchestrator; do not improvise)

- Running a target-specific RLS verify/plan step **cannot** be wired without putting RLS knowledge into a framework or SQL-family file (i.e. the generic `extensionIssues` channel + a generic target hook is insufficient). This is the crux of the whole architecture — **stop and surface** rather than re-introducing the leak.
- `annotations.pg` is not a viable place to carry introspected RLS (e.g. it's typed closed) — surface; do not add policy/role slots to `SqlSchemaIR`.
- The planner's coarse-bucket ordering can't place policies/enable-RLS after `CREATE TABLE` without dependency-graph machinery — surface (that's follow-on B; for the skeleton a coarse bucket must suffice — if it genuinely doesn't, we rescope).
- The PSL `policy_select` descriptor can't lower to `PostgresRlsPolicy` through the landed substrate as the fixture shows — surface (it would mean the substrate isn't as landed as believed).
- The diff/scope grows past one reviewable slice — surface for a re-plan rather than expanding silently.

## 9. Edge cases (pre-investigated)

| Edge case | Disposition |
| --- | --- |
| Postgres reprints the policy body on store, so the introspected `qual` differs textually from the authored body | Handled by recomputing the wire name from the normalized introspected body (the content-addressing trick). This slice only needs `missing`→create + clean re-diff, but introspection **must** recompute (not trust the catalog name) so the clean re-diff actually holds. |
| `app_user` role absent from `pg_roles` | Out of scope (that's slice 3's `missing_role`). The test **pre-creates** the role so it exists. |
| Table already has RLS enabled | `enableRowLevelSecurity` precheck should no-op / be idempotent; for the greenfield skeleton the table starts with RLS off, so `ENABLE` always fires. |
| Two policies with the same body, different prefix | Not exercised here (that's rename, slice 3). One policy only. |

## References

- Design record (architecture + research anchors): [`../../specs/design-generic-schema-differ.md`](../../specs/design-generic-schema-differ.md)
- Project spec / plan: [`../../spec.md`](../../spec.md) · [`../../plan.md`](../../plan.md)
- Content-addressed naming ADR: [`../../specs/adr-content-addressed-policy-names.md`](../../specs/adr-content-addressed-policy-names.md)
- Patterns to mirror: `cross-namespace-fk.integration.test.ts` (apply), `op-factory-call.ts:AddForeignKeyCall` + `operations/constraints.ts:addForeignKey` (ops), `declarative-policy-select-extension.ts` (PSL descriptor), `control-adapter.ts:introspectSchema` (introspection).
