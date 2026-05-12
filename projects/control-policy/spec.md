# Summary

Every Contract IR node that represents a database-persisted object carries a `control` field of type `ControlPolicy`. The value declares how much the framework's **control plane** (migrations + verification) participates in that object's lifecycle. The framework verifier and planner dispatch on `control` per node. Four policies cover the space from "we own this entirely" to "we observe but never emit DDL": `managed`, `tolerated`, `external`, `observed`.

This project introduces the primitive at the framework layer and threads it through the verifier and planner. It is the foundation for any work that ships extensions whose contracts describe objects the framework is not responsible for migrating — Supabase's `auth.users` is the motivating example, but the primitive is target-agnostic and reusable for other identity providers, externally-managed legacy schemas, and "adopt-an-existing-database" workflows.

# Context

## At a glance

Every Contract IR node representing a persisted database object — tables, columns, indexes, constraints, RLS policies, etc. — gains a `control` field:

```ts
type ControlPolicy = 'managed' | 'tolerated' | 'external' | 'observed';

interface TableDeclaration {
  readonly name: string;
  readonly namespace: Namespace;
  readonly columns: readonly ColumnDeclaration[];
  readonly control: ControlPolicy;
  // ...
}
```

```jsonc
// contract.json
{
  "models": {
    "AuthUser": {
      "namespace": "auth",
      "control": "external",
      "tableName": "users",
      "fields": { /* … */ }
    }
  }
}
```

The four policies map to one dispatch table for the verifier and one for the planner:

| Policy | Verifier behaviour | Planner / migration behaviour |
|---|---|---|
| `managed` | Must exist and match exactly. Any drift is an error. | Full lifecycle: `CREATE`, `ALTER`, `DROP`. |
| `tolerated` | Must exist; columns we declare must match; **extra columns are allowed**. | Create if missing on initial migration. Don't `ALTER` to remove undeclared columns. Don't `DROP`. |
| `external` | Must exist with the columns we declare in compatible shape; **extra columns and additional constraints/indexes/triggers are allowed and ignored**. | Never emit any DDL for it. |
| `observed` | Allowed to exist or not exist; allowed to mismatch. Verifier emits warnings, not errors. | Never emit any DDL for it. |

The four policies form a spectrum from "framework owns it completely" (`managed`) to "framework has it in the IR for typing/documentation but does not enforce or modify anything" (`observed`).

## Problem

The framework currently assumes "I own every object declared in the contract; I create it, I migrate it, I verify it strictly." This assumption is fine for greenfield apps but breaks the moment we ship an extension that **describes** objects the framework is not responsible for migrating — Supabase's `auth.users` table is the canonical example. The user wants to declare an FK to `auth.users(id)` and have the verifier confirm the column exists with the right shape, but the framework must never emit DDL that would `CREATE`, `ALTER`, or `DROP` anything in Supabase's `auth` schema.

"Externally managed" sounds like a binary toggle, but it isn't. There are at least four positions the framework can take towards a given object, each with different verifier and planner behaviour. Without an explicit primitive for this, every consumer (Supabase, future identity-provider extensions, the "adopt existing schema" workflow, future analytics-view tooling) has to reinvent the same dispatch decisions ad-hoc.

This project names the primitive (`control` field on IR nodes; `ControlPolicy` enum), centralizes the dispatch tables in the framework verifier and planner, and locks the four policies as the framework-level set targets can extend if they need to.

## Why "control policy"

We considered `posture`, `lifecycle`, `migrationPolicy`, and `management`. The chosen name connects to the existing **control plane / runtime plane** axis in this codebase — migrations and verification both live in the control plane. "The framework's control policy for this object" reads naturally: it's the strategy that determines how much the control plane participates in the object's migration lifecycle.

Splitting the field name and the type name into different jobs falls out cleanly:
- **Field: `control`** — terse on the wire and at access sites (`table.control === 'external'`).
- **Type: `ControlPolicy`** — describes *what* the field holds when reading TS signatures or prose.

In prose: "the model's control policy is `external`" / "the planner skips emit for any object whose control policy is `external` or `observed`."

## Where the field lives

A `control` field on the relevant IR node declaration. Applies to any IR node representing a database-persisted object **declared in the contract**: tables, columns, indexes, constraints, RLS policies, sequences, etc. Targets may extend the set of node kinds that carry it (e.g. Postgres-only `PostgresRole`, future `PostgresFunction`) but the four policy values are framework-level.

Per-object, not per-contract — a single contract may mix policies. The contract level may carry a `defaultControl` that propagates to declared objects, with per-object overrides allowed.

## Defaults

- **Application contracts** default to `managed` for all declared objects. Per-object override allowed (rare in practice).
- **Extension contracts** declare a contract-level `defaultControl` and per-object overrides. The Supabase extension declares `defaultControl: 'external'` for everything in its shipped contract; the app author never sees this knob.

## Authoring surface

For an extension author writing a `contract.json` by hand:

```jsonc
{
  "namespaces": ["auth"],
  "defaultControl": "external",
  "models": {
    "AuthUser": {
      "namespace": "auth",
      "tableName": "users",
      "fields": { /* … */ }
    }
  }
}
```

For an app author who wants to declare an externally-managed object inline (rare power-user feature):

```ts
m.model('LegacyAuditLog', {
  control: 'external',
  namespace: 'public',
  fields: { /* … */ },
});
```

The 80% case is "extensions ship `external` contracts; apps ship `managed` contracts." Typical app authors never touch the `control` field.

## Verifier dispatch

The verifier already walks the loaded contract aggregate and compares against the introspected schema. It learns one new behaviour: per node, consult the node's `control`, then apply the matching comparison strategy:

- `managed`: exact-match comparison; any difference is a violation.
- `tolerated`: declared properties must match; extra properties on the introspected side are allowed.
- `external`: declared properties must match with compatible shape (e.g., column types are *assignment-compatible* rather than necessarily identical); everything else is ignored.
- `observed`: log only, never fail.

A small dispatch table inside the verifier's compare loop. No structural change to the verifier; per-node policy lookup. The "compatible shape" relation is target-supplied (e.g. Postgres's `int4` ↔ `int8` is incompatible while some text types are bidirectionally compatible).

## Planner dispatch

The migration planner consults `control` per node:

- `managed`: full lifecycle ops (`CREATE TABLE`, `ALTER TABLE ADD COLUMN`, `DROP TABLE`, …).
- `tolerated`: emit creation ops only when the object is missing; never emit `ALTER` / `DROP`.
- `external`: never emit any ops for this node.
- `observed`: never emit any ops.

**Cross-cutting safety check:** the planner refuses to emit ops that *target* an `external` namespace, even if the user appears to have declared a `managed` object there. This prevents an app from accidentally trying to migrate Supabase's `auth` schema by mis-declaring a model.

# Requirements

## Functional Requirements

- **FR1.** Every Contract IR node representing a database-persisted object carries a `control: ControlPolicy` field. Targets may extend the set of node kinds that carry it but the policy values themselves are framework-level.
- **FR2.** `ControlPolicy` is exactly the union `'managed' | 'tolerated' | 'external' | 'observed'`. Targets may *not* extend this union in v0.1 (locking the framework's vocabulary; revisit if a concrete target use case demands an additional policy).
- **FR3.** Contract IR carries a contract-level `defaultControl: ControlPolicy` (optional; defaults to `managed`). Per-object `control` fields override the default. Object access semantics: the effective control for an object is the per-object value if set, otherwise the contract-level default, otherwise `managed`.
- **FR4.** The framework verifier dispatches on `control` per node using the table in § "Verifier dispatch". Family abstract bases own the dispatch wiring; the per-target "compatible shape" relation is supplied by the target SPI (TML-2459's `SchemaVerifier` family base is the natural seam).
- **FR5.** The framework planner dispatches on `control` per node using the table in § "Planner dispatch". The cross-cutting safety check (refusing to emit ops into an `external` namespace) is enforced at the planner level, before any target-specific DDL emission.
- **FR6.** The on-disk Contract IR JSON shape is `{ "control": "external" }` at the per-object level and `{ "defaultControl": "external" }` at the contract level. Existing contracts without `control` fields default to `managed` per FR3.
- **FR7.** TS authoring surface: `defineContract({ defaultControl?: ControlPolicy, … })` for contract-level default; `model(name, { control?: ControlPolicy, … })` for per-object override. The same pattern extends to other declarable nodes (indexes, constraints, RLS policies) as their authoring surfaces grow.
- **FR8.** PSL authoring surface: a model-level attribute carries the per-object override (exact spelling — `@control(external)`, `@@control(external)`, or a top-level block — settled in plan); a contract-level default is configured via `generator` block (or equivalent). PSL surface lands later than the TS surface if the PE pass shows it can split cleanly; both lower to the same IR.
- **FR9.** Round-trip fidelity: `serializeContract → deserializeContract` preserves the effective control for every node. Tested for Postgres, SQLite, and Mongo.
- **FR10.** Target-only kinds that the framework verifier doesn't know about (e.g. Postgres `PostgresRlsPolicy`, future `PostgresRole`) carry `control` and dispatch through the same table; target-specific verifier hooks compose with the framework's per-node dispatch.

## Non-Functional Requirements

- **NFR1.** The dispatch tables are small and self-contained: per-node lookup, no walk-time decision points beyond the four-value switch. Performance is dominated by the IR walk itself, not by the dispatch.
- **NFR2.** Layering: `ControlPolicy` and the `control` field declarations live in `1-framework/`. Family abstract bases consume them. Target SPI implementers extend them. Enforced by `pnpm lint:deps`.
- **NFR3.** No silent change in behaviour for existing contracts: contracts without explicit `control` fields default to `managed`, which matches today's "framework owns everything declared" assumption. Existing test suites pass after the field is added.
- **NFR4.** Family abstract bases own the dispatch logic; target SPI implementers supply only target-specific hooks (compatible-shape relation, target-only-kind dispatch). The dispatch is not duplicated per target.

## Non-goals

- **Per-column control override.** Columns inherit their parent table's effective control in v0.1. Per-column override (for tables that mix strict-managed columns with tolerated-extras columns) is a future iteration if a real use case lands. Not blocking Supabase v0.1.
- **Functions as first-class contract elements.** Postgres functions (`auth.uid()`, etc.) are not contract elements in v0.1 — they are opaque substrings inside RLS predicates or registry entries in `DefaultFunctionRegistry`. Promoting functions to first-class IR (and therefore giving them a `control`) is a separate piece of work; see Supabase project § "Stretch goals."
- **Introspection-driven default control.** When a future "describe an existing database" tool generates a contract from a live schema, what control should it default to? Likely `external` for extension-shipped namespaces and `tolerated` for the app's own schema, but the exact rules are a future concern.
- **Adding new policy values.** The four-value vocabulary is fixed in v0.1. Adding a fifth (e.g. a finer-grained variant of `external`) is a follow-up if a concrete target demands it.
- **Authoring DSL for declaring an entire namespace as external.** Namespace-level `control` would be a useful shortcut (declare a whole `auth` namespace once, every object inherits) but the IR already carries per-object `control` and the contract-level `defaultControl` covers the extension-author case. Namespace-level convenience is a future ergonomic.

## Sequencing constraints

This project lands cleanly **after TML-2459 (Target-Extensible IR)** because:

- TML-2459 introduces the polymorphic IR (framework / family / target layering) and the `SchemaVerifier` / planner SPIs. Plugging `control` dispatch into those SPIs lands cleanly; retrofitting today's flat-data IR with the field is also possible but the resulting dispatch logic would be re-shaped when TML-2459 lands.
- The cheaper retrofit: TML-2459's IR class hierarchy ships first; this project adds one field to the framework `SchemaNode` (or a relevant base) and one dispatch table to the family-level verifier/planner bases.
- This project is **not** blocked by anything Supabase-specific. It is a pure framework primitive; Supabase becomes its first consumer once both this project and TML-2459 land.

Independent / non-blocking: TML-2459 can ship without this project (today's "everything managed" behaviour is the default). Supabase is blocked until both land — but Supabase's design has been shaped against the policy semantics, so the Supabase project picks up immediately once this lands.

# Acceptance Criteria

- [ ] **AC1.** A contract declares a model with `control: 'external'`. The verifier confirms the table exists with the declared columns in compatible shape; extra columns and constraints on the database side are tolerated. The planner emits zero DDL for this model across all migration phases.
- [ ] **AC2.** A contract declares a model with `control: 'managed'` (or omits `control` and inherits the default). The verifier requires exact-match shape. The planner emits the full `CREATE` / `ALTER` / `DROP` lifecycle.
- [ ] **AC3.** A contract declares a model with `control: 'tolerated'`. The verifier requires the declared columns to match but tolerates extra columns on the database side. The planner emits `CREATE` if missing on the initial migration and skips `ALTER` / `DROP` thereafter.
- [ ] **AC4.** A contract declares a model with `control: 'observed'`. The verifier emits warnings for any mismatch but never errors. The planner emits zero DDL.
- [ ] **AC5.** A contract declares `defaultControl: 'external'` at the contract level. Every declared model inherits `external` unless it sets its own `control`. A model that explicitly sets `control: 'managed'` overrides the contract default.
- [ ] **AC6.** Cross-cutting safety: a contract declares `defaultControl: 'external'` for a namespace and then declares a `managed` model in that namespace. The planner refuses to emit ops into the `external` namespace and surfaces a diagnostic explaining the conflict.
- [ ] **AC7.** Round-trip: `serializeContract → JSON.stringify → JSON.parse → deserializeContract` preserves the effective control for every node. Verified via property tests across Postgres, SQLite, and Mongo.
- [ ] **AC8.** A target-only IR kind (e.g. `PostgresRlsPolicy`) carries `control` and dispatches through the same table. A target-specific verifier hook composes with the framework's per-node dispatch without re-implementing the dispatch.
- [ ] **AC9.** Existing test suites (unit + integration + e2e) pass without changes after the field is added. Contracts that did not previously declare `control` infer `managed` and behave identically to today.
- [ ] **AC10.** TS authoring surface lands: `defineContract({ defaultControl })` and `model({ control })` both compile, lower to the IR shape declared by FR6, and are exercised by an integration test.
- [ ] **AC11.** PSL authoring surface lands (if scoped into this project per FR8; otherwise tracked as a follow-up acceptance criterion in the plan): the per-object control override + contract-level default both parse, lower to the same IR shape as the TS path, and round-trip through `contract.json`.

# Open Questions

- **Is `observed` worth shipping in v0.1?** It is the most permissive policy and arguably exists only for documentation/typing in the IR. Could be deferred to ship only `managed | tolerated | external` if the design pressure pushes that way. Working assumption: ship all four because the dispatch table is the same shape regardless.
- **Per-column control override.** Columns inherit their parent table's policy by default. Per-column override matters if an extension's table has some columns the framework verifies strictly and some it tolerates. Not pressing for Supabase v0.1.
- **"Compatible shape" relation.** Target-supplied. Postgres needs the type-compatibility relation (e.g. `int4` ↔ `int8` is incompatible; some text types are bidirectionally compatible). The family abstract base provides the seam; concrete relation lives on the target SPI implementer.
- **PSL surface shape.** `@control(external)` vs `@@control(external)` vs a top-level block. PE pass to settle.
- **Namespace-level `control` shortcut.** A future ergonomic — declare an entire namespace as `external` once instead of repeating per-object. Useful for extension authors writing contracts by hand. Not blocking; the contract-level `defaultControl` covers the common case.
- **How does `control` interact with future introspection-based emit?** When a "describe an existing database" tool generates a contract from a live schema, default to `external` for extension-shipped namespaces and `tolerated` for the app's own schema? Decide when that tool is shaped.

# References

- [TML-2493 — Control Policy: per-IR-node migration control primitive](https://linear.app/prisma-company/issue/TML-2493/control-policy-per-ir-node-migration-control-primitive) — Linear ticket tracking this project. Blocked by TML-2459.
- [`projects/target-extensible-ir/spec.md`](../target-extensible-ir/spec.md) — IR foundation this project builds on. `SchemaVerifier` and planner SPIs are the natural seam for the dispatch tables.
- [`projects/supabase-integration/`](../supabase-integration/) — motivating consumer. Supabase declares its shipped contract with `defaultControl: 'external'` and exercises the verifier behaviour against `auth.users`, `auth.identities`, `storage.objects`.
- [`projects/supabase-integration/decisions.md`](../supabase-integration/decisions.md) § "C5. Roles are first-class contract elements" — `PostgresRole` IR consumes the same `control` field; the verifier's `pg_roles` introspection dispatches through the same table.
