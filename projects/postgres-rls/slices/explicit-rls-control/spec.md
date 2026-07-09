# Slice 3: explicit-rls-control

**Linear:** [TML-2869](https://linear.app/prisma-company/issue/TML-2869) · builds on the merged one-differ substrate ([#921](https://github.com/prisma/prisma-next/pull/921), [`../one-differ-two-ir-planner/spec.md`](../one-differ-two-ir-planner/spec.md))

RLS enablement becomes an explicit, authored table attribute instead of a side effect of planning a policy. `@@rls` marks a model RLS-controlled; the marker — not the policy set — drives `ENABLE`/`DISABLE ROW LEVEL SECURITY` through the one differ as the first real table-attribute diff. A policy rename (same content hash, different prefix) plans as `ALTER POLICY … RENAME TO` instead of drop+create. Managed/external control-policy grading is proven for every RLS op.

```prisma
namespace public {
  model Profile {
    id       String @id @default(uuid())
    userId   String @unique
    username String

    @@rls
  }

  role appUser
  policy_select profiles_read_all { target = Profile; roles = [appUser]; using = "true" }
}
```

## Decisions

### D1 — `@@rls` is a Postgres-contributed model attribute, stored as a Postgres entity

- **Authoring surface:** a bare `@@rls` model attribute (no arguments; presence = RLS-controlled). It is contributed by the Postgres target through a **new generic `modelAttributes` slot on `AuthoringContributions`** (`framework-authoring.ts:361-377` — today only `type`/`field`/`entityTypes`/`pslBlockDescriptors` exist, so targets cannot contribute `@@` attributes at all). The slot mirrors `pslBlockDescriptors`: the framework owns the generic consult in the interpreter's model-attribute loop (before the `PSL_UNSUPPORTED_MODEL_ATTRIBUTE` fallthrough, `interpreter.ts:819-824`); the descriptor is declarative (ADR 231 attribute-spec kit) and carries the target's lowering. The framework and SQL family never name RLS — the slot is target-agnostic.
- **Contract storage:** `@@rls` lowers to a Postgres-target entity in the namespace's `entries` (working name `entries['rls'][tableName]`, a `PostgresRlsEnablement { kind, tableName, namespaceId }`; final naming is implementer latitude). Registered via `postgresAuthoringEntityTypes` so serialization, round-trip, and `contract infer` omission ride the existing entity-kind machinery. It is **not** a field on the family-shared `StorageTable` (the layering violation the project spec forbids) and not an annotation bag.
- **Authoring error:** a `policy_*` block whose `target` model is not `@@rls`-marked is rejected — a load-time PSL diagnostic naming the model and the policy **prefix** (never the hash suffix). The same rule is enforced fail-loud at contract→schema-node derivation (alongside the existing policy-references-absent-table throw, `contract-to-postgres-database-schema-node.ts:123-130`) so contracts constructed outside PSL hit it too.

### D2 — Enablement is an attribute diff; fail-closed

- **Expected side:** derivation stamps `rlsEnabled: boolean` onto `PostgresTableSchemaNode` from marker presence — never from the policy set.
- **Actual side:** introspection reads `pg_class.relrowsecurity` into the table node (today it is only read inside op pre/postchecks, `checks.ts:382-415`; the actual-side tree has no signal).
- **Diff:** table `isEqualTo` compares `rlsEnabled` — the first table-attribute comparison (today it is identity-only, `postgres-table-schema-node.ts:95-97`). A `not-equal` table issue plans `EnableRowLevelSecurityCall` (expected `true`) or a **new `DisableRowLevelSecurityCall`** (expected `false`). Disable is classed destructive — it opens row access, so it requires the destructive allowance like `dropRlsPolicy`; enable stays additive.
- **The imperative path dies:** `planPostgresSchemaDiff`'s enable-on-first-new-policy (`seenEnableTables`, `planner.ts:348-367`) is deleted. This fixes today's gap where a table with in-sync policies but RLS off is never re-enabled (project DoD: "policies declared with RLS off → `ENABLE`").
- **Fail-closed semantics fall out of the model:** removing the last policy on a marked table changes nothing about enablement (expected `true`, actual `true` → no issue; deny-all). `DISABLE` plans only when the marker is removed. No special cases.
- **Verify:** enablement drift is a table `not-equal` issue → `declaredIncompatible` (`schema-verify.ts:101-121` fallthrough), graded per the table's control policy by the existing disposition — managed fails, external suppresses. No verify plumbing changes.

### D3 — Policy rename plans as `ALTER POLICY … RENAME TO`

- A **planner post-pass** inside the policy half of the diff pairs a `not-found` with a `not-expected` policy issue on the **same table** whose wire-name **hash suffixes match** and prefixes differ → one `RenamePostgresRlsPolicyCall` → `ALTER POLICY <old> ON <schema>.<table> RENAME TO <new>`. Unpaired issues proceed as create/drop exactly as today. No body inspection anywhere — this is the payoff of content-addressed names ([ADR](../../specs/adr-content-addressed-policy-names.md)).
- **Rename is non-destructive:** it plans even without the destructive allowance. A rename blocked as if it were a drop would defeat the point.
- When several candidates share one hash on a table (legal: same body, different prefixes), pair deterministically by sorted name; leftovers create/drop.
- The wire-name parse (`/^(.+)_([0-9a-f]{8})$/`, today inlined at `control-adapter.ts:1159`) is promoted to a shared helper in the target's rls module — the post-pass is its second consumer.
- Verify still reports the pair as two issues (`not-found` + `not-expected`); pairing them in verify output is out of scope.

### D4 — Managed/external grading, proven per op

The machinery already exists (`@@control` → `StorageTable.control`; `partitionCallsByControlPolicy` on the RLS call list, `planner.ts:278-287`; per-issue resolution in verify). This slice proves and completes the RLS behaviors: on an **external** table no enable/disable/create/drop/rename op is ever emitted and verify suppresses RLS drift; on a **managed** table the contract owns the full policy set and the enablement bit (extras dropped under the destructive allowance, drift fails verify). The rename call resolves its control-policy subject via the owning table like create/drop.

## Behaviour contract

- **Deliberate changes:** enablement is marker-driven (including re-enable when policies are in sync but RLS is off); `DISABLE` exists and fires only on marker removal; rename collapses drop+create into `ALTER POLICY … RENAME TO`; a policy on an unmarked model is an authoring error; example/fixture contracts declaring policies gain `@@rls`.
- **Unchanged (hard):** non-RLS planner ops byte-identical (planner/adapter suites + a golden diff of real `plan()` output — **not** `fixtures:check`, which gates contract emission only, per [`docs/onboarding/fixtures-emit-and-check.md`](../../../../docs/onboarding/fixtures-emit-and-check.md)); verify verdicts unchanged for all non-RLS scenarios in every mode; SQLite + Mongo untouched; multi-space guards green.
- **Layering invariant (project-wide, non-negotiable):** zero RLS vocabulary in `1-framework`/`2-sql` — the `modelAttributes` slot is generic; `pnpm lint:deps` and the framework-vocabulary ratchet stay clean.

## Contract impact

New Postgres entity kind (`rls` marker) in namespace `entries` — serialized, round-tripped, and omitted from `contract infer` like `policy`/`role`. New generic framework SPI: `AuthoringContributions.modelAttributes`. No change to `StorageTable` or any family contract type. **Breaking for downstream authors:** an existing contract with policies but no `@@rls` stops emitting — examples and fixtures are updated in-slice, and the change is recorded via the `record-upgrade-instructions` skill (expect `check:upgrade-coverage` to demand entries for the new SPI slot and the authoring rule).

## Adapter impact

`adapter-postgres` only: introspection reads `relrowsecurity`; new render hooks for `alterPolicyRename` and `disableRowLevelSecurity` (plus DDL nodes, contract-free constructors, pre/postchecks). SQLite and Mongo adapters untouched.

## Non-goals

- Role diffing / `pg_roles` existence checks — slice 4.
- `policy_insert` / `policy_update` / `policy_delete` / `policy_all` — slice 5.
- TypeScript authoring, including the TS `@@rls` equivalent — slice 6.
- In-place `ALTER POLICY … TO <roles>` / `USING (…)` body alters. Content addressing makes any body/role change a new wire name (drop+create); RENAME is the only `ALTER POLICY` form this project uses.
- Per-policy control-policy overrides (table-level only, per the project's locked management model).
- Verify-side rename pairing (drift reports missing+extra; the planner resolves it).
- Slice 2.6 (`unify-unique-and-index-nodes`) — independent structural cleanup, not stacked on.

## Pre-investigated edge cases

- **Table with policies in sync but RLS off** re-enables under the attribute diff — today's imperative path misses it (`planner.ts:336-387`); pin it.
- **Multiple same-hash policies on one table** during rename pairing — deterministic sorted-name pairing, leftovers create/drop (D3).
- **External table with RLS enabled and no marker** — expected `false` vs actual `true` is a real issue, suppressed by disposition; must not plan a `DISABLE`.
- **Marker on a model with zero policies** is legal and plans `ENABLE` (deny-all is the point of fail-closed).
- **Existing example migration chains:** adding `@@rls` changes each example's current `contract.json` (new entity) but not historical migration snapshots; live DB state already has RLS on from slice-1 ops, so post-apply verify stays clean with no new migration. `fixtures:check` must be green after regen.

## Acceptance criteria

- **AC-1 (`@@rls` round-trip):** a PSL model with `@@rls` lowers to the marker entity; `deserialize(serialize(contract))` is lossless; `contract infer` omits it; without the Postgres pack the attribute falls through to the existing unsupported-attribute diagnostic.
- **AC-2 (authoring error):** a `policy_*` block targeting an unmarked model produces a load-time diagnostic naming the model and policy prefix; a hand-constructed contract with the same contradiction fails loud at derivation.
- **AC-3 (enable/disable lifecycle, live PGlite):** declared-with-RLS-off plans `ENABLE` (including the in-sync-policies case); marker removal plans `DISABLE` (destructive-gated); removing the last policy on a marked table plans no enablement op, verify stays clean, and a behavioral probe shows rows are denied (fail-closed).
- **AC-4 (rename):** changing only a policy's prefix plans exactly one `ALTER POLICY … RENAME TO` (no drop, no create), applies end-to-end, verifies clean afterwards, and plans even without the destructive allowance.
- **AC-5 (grading matrix):** managed vs external pinned for each of create / drop / rename / enable / disable and for the verify verdict on each drift kind.
- **AC-6 (layering):** `pnpm lint:deps` clean; no RLS token in framework/SQL-family (vocabulary ratchet); SQLite + Mongo suites green untouched.
- **AC-7 (full gate):** build, forced typecheck, whole Lint job, `fixtures:check`, all three test suites, multi-space guards, `check:upgrade-coverage --mode pr` with recorded upgrade instructions; non-RLS op parity per the behaviour contract.

## Slice Definition of Done

Inherits the team floor ([`drive/calibration/dod.md`](../../../../drive/calibration/dod.md)). Slice-specific: the walking-skeleton Supabase example carries `@@rls` on its policy-bearing models and its e2e exercises the AC-3 fail-closed probe and the AC-4 rename round-trip against live Postgres.

## Grounding for the plan step

The plan must ground: the interpreter's model-attribute loop and where the `modelAttributes` consult slots in (`interpreter.ts:628-825`); the entity-kind registration + serializer surface for the marker; every constructor site of `PostgresTableSchemaNode` (derivation, introspection, tests) that gains `rlsEnabled`; how a table `not-equal` issue routes through `buildPostgresPlanDiff`'s policy/relational split (`planner.ts:182-188` — table issues land on the relational side today, and `mapNodeIssueToCall` has no table `not-equal` case); the op-factory-call/ddl/render/checks fan-out for the two new ops; the `regen-example-migrations` impact of marker adoption; which fixtures/tests author policies and need markers.
