# Slice: planner-dispatch

_Parent project: [`projects/control-policy/`](../../spec.md). Outcome it contributes: the migration planner gates DDL emission per node's effective control, and never emits DDL into a namespace whose effective control is `external` — even when a per-object override mis-declares `managed` there._

## At a glance

The planner currently emits the full DDL lifecycle (`CREATE`/`ALTER`/`DROP`) for every declared object. This slice gates that per effective control: `managed` keeps the full lifecycle, `tolerated` only creates when missing (never `ALTER`/`DROP`), `external` and `observed` emit no DDL at all. On top of the per-node gate sits a **safety floor**: when a contract space's effective default is `external`, the planner emits zero DDL into that space's namespaces regardless of any per-object `managed` override, and surfaces a diagnostic naming the mis-declaration.

## Settled design decisions

Decided with the operator before planning (recorded here so the implementer doesn't re-litigate):

- **The conflict diagnostic is a `warn`, not a hard `fail` (decision C).** When the floor suppresses DDL a per-object `managed` declaration would otherwise have produced, the plan **proceeds** (the namespace simply receives no DDL) and the planner surfaces a `warn`-level diagnostic. Rationale: the safe thing already happened (no DDL leaked into the external schema), so blocking the whole plan is heavier than the case warrants.
- **Authoring allows the mis-declaration; the planner floor is the safety (decision C).** The TS/PSL surface does **not** hard-reject a per-object `managed` override inside an `external` default. The floor + `warn` is the audit trail. (The diagnostic is justified — `managed`-in-`external` is a likely *mistake*, not an intentional path — without escalating to a build-blocking error.)

## Chosen design

- **Per-node DDL gate (family-owned).** The gate lives in the SQL family migration planning seam (`packages/2-sql/9-family/src/core/migrations/` — `field-event-planner.ts`, `plan-helpers.ts`, `policies.ts`, `types.ts`) and is honoured by the Postgres planner (`packages/3-targets/3-targets/postgres/src/exports/planner*.ts`). Each candidate DDL operation consults `effectiveControl(node.control, contract.defaultControl)`:
  - `managed` — full lifecycle: `CREATE`, `ALTER`, `DROP` (today's behaviour, unchanged).
  - `tolerated` — emit `CREATE` only when the object is missing; **suppress** `ALTER` and `DROP` for an existing object.
  - `external` — emit no DDL for the object.
  - `observed` — emit no DDL for the object.
- **External-namespace safety floor.** A contract space whose effective default (`defaultControl`) is `external` is a hard floor: the planner emits **zero** DDL into that space's namespaces, even if an individual object inside it carries a per-object `control: 'managed'` override. The per-object override cannot escalate DDL emission above the space's external floor. ("Namespace effective control = `external`" is driven by the space's `defaultControl: 'external'`; there is no namespace-level `control` field — that is a deferred project non-goal.)
- **Conflict diagnostic (`warn`-level).** When the safety floor suppresses DDL that a per-object `managed` declaration would otherwise have produced, the planner surfaces a `warn`-level diagnostic naming the object and the external namespace, so the mis-declaration is visible rather than silently dropped. The plan still proceeds (the namespace just gets no DDL). This is a diagnostic on a contradictory configuration, not a build-blocking error.

> **Naming caution.** The existing `control-adapter.ts` / `exports/control.ts` is the *control-plane* runtime surface (what runs migrate/verify), **not** the `control` policy field. The policy is read off the IR node via `effectiveControl`; do not entangle it with the control-plane adapter.

## Coherence rationale

Two tightly-coupled behaviours that must ship together to be safe: the per-node gate (what DDL each policy permits) and the namespace floor (the guard that a per-object override can't punch a hole through an `external` space). Shipping the gate without the floor would let a mis-declared `managed` object emit DDL into someone else's schema — the exact failure the project exists to prevent. They are one reviewable idea: "the planner emits DDL only where effective control permits it, with `external` as an un-overridable floor."

## Scope

**In:** the per-node DDL gate (full / create-if-missing / none) in the SQL family migration seam + Postgres planner; the external-namespace safety floor; the conflict diagnostic; unit tests covering each policy's emission and the mis-declaration case (`defaultControl: 'external'` + a `managed` object in that space ⇒ zero DDL into the namespace + diagnostic).

**Out:** verifier comparison strategies (slice 2); TS/PSL authoring (slices 4–5); Mongo planner behaviour beyond what the family seam already provides (the motivating consumer is Postgres/Supabase); introspection-driven defaulting.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `tolerated` object exists but its declared columns drifted | No `ALTER` emitted | `tolerated` is create-if-missing only; column drift on an existing tolerated object is the verifier's concern (slice 2), not the planner's. |
| `managed` object mis-declared inside a `defaultControl: 'external'` space | Zero DDL into the namespace + conflict diagnostic | The project-DoD case. The floor wins over the per-object override. |
| A `DROP` for an object removed from the contract, in an `external` space | Suppressed | The floor suppresses *all* DDL into the namespace, including drops of now-absent objects. |
| `tolerated` space (`defaultControl: 'tolerated'`) | Create-if-missing per object | The floor is specific to `external`; `tolerated` keeps its per-node create-if-missing semantics. |

## Slice-specific done conditions

- [ ] Each policy's DDL gate has a unit test: `managed` emits CREATE/ALTER/DROP, `tolerated` emits CREATE only when missing (no ALTER/DROP on existing), `external`/`observed` emit nothing.
- [ ] A contract with `defaultControl: 'external'` plus a `managed` object mis-declared in that namespace produces **zero** DDL into the namespace and surfaces the `warn`-level conflict diagnostic, with the plan still proceeding (the project-DoD condition).
- [ ] Existing Postgres planner/migration suites stay green (no regression for the default `managed` path).

## Open Questions

1. **Where the floor is enforced — pre-plan filter vs post-plan scrub.** Working position: filter candidate operations at the point each op is produced (consulting effective control there), with the namespace floor applied as an outer guard. The implementer confirms the cleanest insertion point in the family migration seam at dispatch time; either is acceptable so long as the floor is un-overridable and the diagnostic fires.

## References

- Parent project: [`projects/control-policy/spec.md`](../../spec.md)
- Linear issue: TML-2777
- [three-layer polymorphic IR pattern](../../../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md)
