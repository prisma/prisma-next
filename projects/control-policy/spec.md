# Control Policy

## Purpose

Give Prisma Next a single primitive for declaring how much the control plane (migrations + verification) participates in each persisted object's lifecycle. Without it, every feature that needs the framework to *describe* an object it must never migrate — an external identity provider's tables, an adopted legacy schema, an analytics view — reinvents the same verify-and-plan decisions ad hoc. This primitive names that decision once, at the framework layer, so every consumer dispatches on it instead of re-deriving it.

## At a glance

Every persisted object in the contract carries a `control` policy. It sits on a spectrum from "the framework owns this completely" to "the framework knows about this but never touches it":

| Policy | Verifier | Planner / migration |
|---|---|---|
| `managed` | Must exist and match exactly; any drift is an error. | Full lifecycle: `CREATE`, `ALTER`, `DROP`. |
| `tolerated` | Declared columns must match; extra columns are allowed. | Create if missing; never `ALTER`/`DROP`. |
| `external` | Declared columns must match in compatible shape; extras and additional constraints are ignored. | Never emit DDL. |
| `observed` | May exist or not, may mismatch; warnings only, never errors. | Never emit DDL. |

The motivating case is Supabase's `auth.users`: the app declares a foreign key into it and wants the verifier to confirm the column shape, but the framework must never emit DDL touching Supabase's `auth` schema. `external` expresses exactly that.

`control` is per-object and lives on **storage-plane** entities (tables, columns, target-contributed kinds such as Postgres enums) — the persistence projection, per [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md). The contract carries a `defaultControl` that every object inherits unless it overrides:

```jsonc
{
  "target": "postgres",
  "defaultControl": "managed",
  "storage": {
    "namespaces": {
      "auth": {
        "tables": {
          "users": { "control": "external", "columns": { /* … */ } }
        }
      }
    }
  }
}
```

The 80% split is "extensions ship `external` contracts; apps ship `managed` contracts." A typical app author never touches the field. An extension author sets `defaultControl: 'external'` once.

## Non-goals

- **Per-column control override.** Columns inherit their table's effective control. Mixing strict and tolerated columns within one table is a future iteration if a real case lands.
- **Functions as first-class contract elements.** Postgres functions (`auth.uid()`) stay opaque substrings / registry entries; they are not persisted IR nodes and therefore carry no `control` here.
- **Introspection-driven defaulting.** What control a future "describe an existing database" tool assigns to generated objects is that tool's concern, not this primitive's.
- **Extending the vocabulary.** The four values are framework-locked in v0.1. A fifth value is a follow-up gated on a concrete target demand.
- **Namespace-level `control` inheritance.** Marking a namespace `external` so its contents inherit. Deferred because policy boundaries align with **contract-space** boundaries — each space ships its own `defaultControl` — so no v0.1 consumer mixes policies within a single space (the Supabase extension's whole space is `external`; the app's whole space is `managed`). Promotion trigger: a single contract space that genuinely mixes namespace policies, most likely an adopt-existing-database / introspection flow. Cheap to add later: an optional namespace field plus one rung in the effective-control resolver, additive on the wire.
- **RLS policies / roles as carriers.** Those IR kinds do not exist yet (TML-2501). When they land they adopt `control` through the same dispatch; this project does not deliver them.

## Place in the larger world

- **Builds on TML-2459 — Target-Extensible IR (Done).** Its `SchemaVerifier` and `ContractSerializer` SPIs and the family abstract bases are the seams the dispatch tables plug into. This project assumes that layering exists.
- **Constrained by [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md).** Persisted objects live on the `storage` plane; the framework `Namespace` interface is `{ id, kind }` only, so there is no single framework base to hang `control` on — it is added to each concrete storage leaf class. The IR follows the [three-layer polymorphic pattern](../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md): family bases own the dispatch, targets supply the target-specific hooks.
- **Motivating consumer: the Supabase Integration project.** Supabase ships its contract with `defaultControl: 'external'` and exercises the verifier against `auth.users`, `auth.identities`, `storage.objects`. Supabase v0.1 is blocked on this project + TML-2459.
- **Downstream blockers.** This primitive blocks TML-2503 (Supabase package + example), TML-2501 (Postgres RLS), and TML-2500 (cross-contract-space FK references).

## Cross-cutting requirements

Capabilities and invariants that hold at the system level, that no single slice owns alone:

- **Backwards-compatible by default.** Absent any `control`, behaviour is byte-for-byte identical to today (`managed`). Every existing test suite passes unchanged.
- **No hash churn from introduction.** The serialized form omits `control` when an object's effective policy equals the contract default, so existing `managed` contracts hash identically and no fixtures churn.
- **One source of effective control.** A single pure resolver (`per-object value → contract default → 'managed'`) is consumed identically by the verifier and the planner. Neither re-derives the policy independently.
- **Framework-locked vocabulary.** Exactly the four values. Targets may extend the set of *node kinds* that carry `control`; they may not extend the set of *values*.
- **Family owns dispatch.** The dispatch logic lives on the family abstract bases; targets supply only target-specific hooks (the compatible-shape relation, target-only-kind dispatch). The dispatch is not duplicated per target.
- **Round-trip fidelity.** The effective control of every node survives `serialize → deserialize`, verified for Postgres, SQLite, and Mongo.
- **Planner safety floor.** The planner never emits DDL into a namespace whose effective control is `external`, regardless of a per-object mis-declaration, and surfaces a diagnostic when it refuses.
- **Layering.** `ControlPolicy` and the field declarations live in `1-framework/`; enforced by `pnpm lint:deps`.

## Transitional-shape constraints

- Every merged slice keeps CI green on `main` and leaves the contract round-trippable.
- The substrate (the field + serialization, defaulting to `managed`) lands before any slice that dispatches on it. Between the substrate slice and its consumers the field exists and changes no behaviour, so every intermediate state is a safe stopping point.

## Contract-impact

- **New framework type:** `ControlPolicy = 'managed' | 'tolerated' | 'external' | 'observed'`.
- **New optional fields:** `control` on storage-plane entities (`StorageTable`, `StorageColumn`, and target-contributed persisted kinds such as `PostgresEnumStorageEntry`); `defaultControl` on the top-level `Contract`.
- **Serializer + arktype validators** accept and round-trip the field, omitting it when it equals the effective default.
- **Consumers:** the verifier and planner read effective control through the shared resolver; no other contract entity changes.

## Adapter-impact

- **Postgres:** supplies the concrete compatible-shape relation; the planner dispatch and the external-namespace safety guard land in the Postgres target planner; `PostgresEnumStorageEntry` is the target-only kind that proves target kinds dispatch through the same table.
- **SQLite:** round-trip coverage only; no target-only carriers in v0.1.
- **Mongo:** the Mongo family verifier base mirrors the dispatch; round-trip coverage.

## ADR pointer

No existing ADR covers this. The project commits to authoring one at close-out: the four-value framework-locked vocabulary and the family-owned-dispatch / target-supplied-hook split.

## Project Definition of Done

Inherits the team-DoD floor ([`drive/calibration/dod.md`](../../drive/calibration/dod.md) § Project-DoD overlay) — not restated here. Project-specific conditions on top:

- [ ] All four policies behave end-to-end (verify + plan) for the SQL family (Postgres) and, where applicable, the Mongo family.
- [ ] A contract with `defaultControl: 'external'` plus a `managed` object mis-declared in that namespace produces zero DDL into the namespace and surfaces the conflict diagnostic.
- [ ] The TS authoring surface (`defaultControl` + per-object `control`) ships with an integration test.
- [ ] The PSL authoring surface ships, **or** is explicitly deferred to a tracked follow-up with a recorded rationale (see Open Questions).
- [ ] Round-trip fidelity verified across Postgres, SQLite, and Mongo.
- [ ] Existing `managed` contracts hash identically after the field is introduced (no fixture churn).
- [ ] The control-policy ADR is promoted to `docs/architecture docs/adrs/`.

## Open Questions

1. **Is `observed` worth shipping in v0.1?** It is the most permissive policy and exists largely for documentation/typing. Working position: ship all four — the dispatch table is the same shape regardless, and dropping it later is cheaper than the asymmetry of shipping three.
2. **PSL spelling for `control`.** `@@control(external)` vs a top-level block vs a config-level default. Working position: settle in a PE pass during the PSL slice; if it cannot split cleanly from the rest, defer the PSL slice to a tracked follow-up rather than block the project.
3. **Precision of the compatible-shape relation.** Which type changes are "compatible" for `external` (e.g. `int4` ↔ `int8` is not; some text types are). Working position: the family base owns the seam; the concrete relation lives on the Postgres target and starts conservative (identical-or-explicitly-listed-compatible).

## References

- **Linear Project:** [Control Policy](https://linear.app/prisma-company/project/control-policy-056d5d6b37c8) — umbrella issue TML-2493; slices TML-2775 … TML-2779.
- **Depends on:** TML-2459 (Target-Extensible IR) — Done.
- **Blocks:** TML-2503, TML-2501, TML-2500.
- **ADRs:** [ADR 221 — two-plane Contract IR](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md).
- **Patterns:** [three-layer polymorphic IR](../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md).
- **Consumer:** [`projects/supabase-integration/`](../supabase-integration/).
