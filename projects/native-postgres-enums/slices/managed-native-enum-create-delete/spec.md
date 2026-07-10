# Slice — `managed-native-enum-create-delete` (Phase 2, Slice A)

**Project:** [`../../spec.md`](../../spec.md) · **Plan:** [`../../plan.md`](../../plan.md) · **Requirements:** R7 (create/drop, ordered before dependent columns), R10 (differ reports missing/extra/value-mismatch), R5 preserved (external enums: no DDL, no drift). Design of record: project spec § Phase 2 + [`../../specs/migration-design.md`](../../specs/migration-design.md).

## At a glance

A user declares a **`managed`** native enum — same authoring surface as Phase 1, only the control grade differs — and Prisma Next owns the type's create/delete lifecycle:

```prisma
native_enum OrderStatus {   // defaultControl: managed
  draft  = "draft"
  review = "review"
  done   = "done"
}
model Order { status pg.enum(OrderStatus) }
```

`migrate` plans `CREATE TYPE "order_status" AS ENUM ('draft', 'review', 'done')` **ordered before** the column DDL that uses it; removing the block plans `DROP TYPE` after the dependent column is gone; `db verify` reports missing / extra / value-mismatch drift for managed enums. Phase-1 `external` enums (Supabase's `auth.*`) keep producing **zero ops and zero drift** — the existing integration pins must stay green unchanged.

**Why now:** the operator green-lit Phase 2. The two prerequisites shipped this cycle: introspection reads ordered member values (PR #944 D1), and the `native_enum` entity serializes into `contract.json`'s storage segment (PR #946) — so the planner can derive the expected type from storage alone (ADR 004/199 storage-only planning). Slice C (adoption) also already shipped ahead of order via PR #944: infer emits `native_enum` blocks inheriting `defaultControl`.

## Chosen design

Follow the RLS role/policy template through the unified differ (post-#920/#921 architecture), one layer at a time:

**1. `PostgresNativeEnumSchemaNode` — the DiffableNode.** Modeled on [`postgres-role-schema-node.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/schema-ir/postgres-role-schema-node.ts): a derived, transient, never-serialized leaf registered in `PostgresSchemaNodeKind`. Unlike cluster-scoped roles, an enum type is **schema-scoped**: identity is (namespace, type name); `isEqualTo` compares **ordered** members — `['a','b'] ≠ ['b','a']` (Postgres sort order is semantic). The node carries the contract entity's `control` where the expected side has one, so the control-policy subject can resolve grade per issue.

**2. Both projections build the node.** Expected side: [`contract-to-postgres-database-schema-node.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/migrations/contract-to-postgres-database-schema-node.ts) replaces the hardcoded `nativeEnumTypeNames: []` (~135) by projecting `ns.entries.native_enum` (hydrated per PR #946) into nodes — **all grades project**; suppression is the disposition layer's job, exactly like tables/roles. Actual side: nodes built from the introspected `nativeEnums: { typeName, values }` the adapter already returns (PR #944). The namespace node's existing plain `nativeEnums`/`nativeEnumTypeNames` fields stay — infer's annotation path reads them; the diff tree gains nodes alongside.

**3. The generic differ reports; control policy dispositions.** With nodes on both sides, the unified differ pairs by identity and yields missing / extra / value-mismatch issues generically. Grade handling rides the existing per-issue subject resolution ([`control-policy.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/migrations/control-policy.ts) — `entityAt(...)?.control` like tables): `managed` issues surface and plan; `external`/`observed` suppress. R5 is pinned by the existing Supabase `db verify` integration tests, which must pass **unchanged**.

**4. Two ops, ordered by the existing dependency machinery.** `CREATE TYPE <qualified> AS ENUM (…)` and `DROP TYPE <qualified>` as `PostgresOpFactoryCall`s with control-policy subject resolution for the new factory names. Ordering requirement is only "type exists before the column that uses it; type drops after the column that used it" — carried by the planner's existing dependency handling (the op-factory-call location machinery already anticipates `CREATE TYPE` target locations). Proven by planning a new table + managed enum in one migration.

**5. Value-mismatch in this slice: reported, never silently planned.** `db verify` reports member drift for a managed enum (R10). The *planner*, on a value-mismatch, emits a **named unsupported diagnostic** ("enum value changes are not auto-migrated yet") — not a silent no-op, not a drop-and-recreate. Slice B replaces that diagnostic with the order-aware suffix-append → `ADD VALUE` and the rename/removal/reorder refusal semantics (R8/R9).

## Coherence rationale (slice-INVEST · _Small_)

One reviewer holds: **"migrate creates and drops a managed native enum, verify sees enum drift, and external enums stay untouched."** Node without projection is dead code; projection without disposition breaks R5; ops without the differ have no driver. Same one-slice shape RLS roles walked. One PR, one rollback unit.

## Scope

**In:** the `PostgresNativeEnumSchemaNode` + kind registration; both projections; differ pairing + verify dispositions (managed reports, external/observed suppress); `CREATE TYPE`/`DROP TYPE` op factories + issue→op lowering + ordering + subject resolution; the value-mismatch named diagnostic; unit + planner tests; a live PGlite integration proof (create, drop, external-untouched, verify).

**Deliberately out:**
- **`ALTER TYPE … ADD VALUE`, rename/removal/reorder semantics** — Slice B (R8/R9), including the non-transactional ADD VALUE caveat.
- **Adoption** — shipped (PR #944; infer emits blocks inheriting `defaultControl`).
- **Realization swap** (check ↔ native) — project non-goal.
- **SQLite/Mongo** — no native enum exists there.

## Pre-investigated edge cases

- **Order is semantic in `isEqualTo`.** Member equality is positional; the introspection already returns `enumsortorder`-ordered values and the entity carries declaration order — compare as sequences, not sets.
- **Suppression location.** Project all grades; suppress at disposition (the tables/roles pattern). Skipping projection for external enums would break "extra-in-DB" pairing and diverge from every other entity kind.
- **DROP TYPE only under a managed claim.** An extra type in the DB with no contract entity is Phase-1's tolerated external case unless the ownership machinery (managed namespace claim / unclaimed-elements) says otherwise — mirror whatever tables do for extra-object dispositions rather than inventing enum-specific rules.
- **Qualified rendering.** DDL must schema-qualify and quote (`CREATE TYPE "auth"."aal_level"`), reusing the existing DDL-schema resolution (`resolveDdlSchemaForNamespaceStorage`) — not string concatenation.
- **The Supabase pins are the R5 regression harness.** If any existing Supabase/external test needs editing to stay green, that is a design failure to report, not a test to update.

## Slice-specific done conditions

- Live PGlite proof: a PSL contract with a managed `native_enum` + `pg.enum` column migrates from empty — plan contains `CREATE TYPE` ordered before the dependent column DDL, applies cleanly, `db verify` clean; removing the block (column first) plans + applies `DROP TYPE`; re-verify clean.
- Verify reports missing / extra / value-mismatch for a managed enum against a live DB (R10), and the planner's value-mismatch path emits the named unsupported diagnostic.
- All existing external-enum (Supabase) integration tests pass **unchanged** (R5).

(CI-green, reviewer-accept, project-DoD floor inherited.)

## Open questions

_None blocking; the extra-object/ownership disposition follows the table precedent, discovered at implementation._

## References

- Node template: [`postgres-role-schema-node.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/schema-ir/postgres-role-schema-node.ts); kind registry: `schema-node-kinds.ts`.
- Projection seam: [`contract-to-postgres-database-schema-node.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/migrations/contract-to-postgres-database-schema-node.ts) (~135 + the roles loop below it).
- Grade/disposition seam: [`control-policy.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/migrations/control-policy.ts) (`resolvePostgresCallControlPolicySubject`, node-typed subjects ~176).
- Op vocabulary: [`op-factory-call.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts) (CREATE TYPE location comment ~1096); lowering/strategies: `issue-planner.ts`, `planner-strategies.ts`; RLS precedent tests: `rls-planner.test.ts`, `node-issue-planner.test.ts`.
- Introspected values: adapter `nativeEnums` (PR #944 D1); serialized entity: PR #946.
- Design of record: project [`spec.md`](../../spec.md) § Phase 2; [`../../specs/migration-design.md`](../../specs/migration-design.md).

## Dispatch plan

See [`plan.md`](plan.md).
