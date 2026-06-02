# Slice: ts-authoring

_Parent project: [`projects/control-policy/`](../../spec.md). Outcome it contributes: the TS authoring surface lets authors set the contract-level default and per-object overrides, lowering to the slice-1 IR shape._

## At a glance

Slice 1 added `control` to the IR and `defaultControl` to the contract, but nothing in the TS authoring surface sets them. This slice wires the ergonomic surface: a contract-level `defaultControl` option and a per-object (per-table) `control` override in the SQL TS contract builder, both lowering to the slice-1 IR fields. An integration test authors a contract that mixes a default with a per-object override and asserts the resulting IR carries the right effective control per node.

## Settled design decisions

Decided with the operator before planning:

- **Spelling:** `defineContract({ defaultControl: 'external', … })` at the contract level + a per-table `{ control: 'external' }` option, type-checked to the four `ControlPolicy` values.
- **Per-table only** — no per-column override (project non-goal); **enums deferred** to a follow-up.
- **Authoring does not reject `managed`-in-`external`.** A per-table `control: 'managed'` inside a `defaultControl: 'external'` contract is allowed at authoring time; the planner's safety floor + `warn` diagnostic (slice 3) is the audit trail, not an authoring-time hard error.
- **Lowering only — no policy logic here.** This slice threads authored values to the IR fields; it does not re-derive or validate effective control.

## Chosen design

- **Contract-level default.** The SQL TS contract builder (`packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts` + `build-contract.ts`, with types in `contract-types.ts`) accepts an optional `defaultControl?: ControlPolicy` at the contract-build entry point, lowering straight to `Contract.defaultControl`. The 80% path: an extension author writes `defaultControl: 'external'` once.
- **Per-object override.** Table authoring accepts an optional `control?: ControlPolicy`, lowering to the `control` field on the table's storage-plane node (`StorageTable`). Per the project non-goal, there is **no per-column override** — columns inherit their table's effective control.
- **Lowering only — no new policy logic.** This slice does not re-derive or validate effective control; it only threads the authored values down to the IR fields slice 1 defined. The omit-when-default behaviour from slice 1 holds automatically: a table authored without `control`, in a contract without `defaultControl`, lowers to an IR with no `control` set and hashes identically.
- **Surface ordering.** PSL is the default authoring surface generally, but this slice is *specifically about the TS surface* (the PSL spelling is slice 5, an open question). The integration test therefore uses the TS builder; the PSL path is out of scope here.

> **Naming caution.** The `control` authoring option is the *control policy*, unrelated to the existing control-plane runtime surface (`exports/control.ts`). It is a plain authoring field that lowers to the IR.

## Coherence rationale

One ergonomic surface for one IR shape: the contract default and the per-object override are the two ends of the same inheritance the slice-1 resolver already implements (`node ?? default ?? 'managed'`). Shipping them together with one integration test that exercises both ends is the smallest coherent proof that the authoring surface reaches the IR. Splitting default from override would leave a half-wired surface that can't express the motivating case (an `external` default with a `managed` exception, or vice versa).

## Scope

**In:** the contract-level `defaultControl` option + its lowering to `Contract.defaultControl`; the per-table `control` override + its lowering to `StorageTable.control`; type-level surfacing so authors get completion/checking on the four values; one integration test authoring a mixed contract and asserting per-node effective control + round-trip.

**Out:** PSL authoring (slice 5); per-column override (project non-goal); Mongo TS authoring (the motivating consumer authors SQL/Postgres; Mongo authoring parity is a follow-up if a case lands); verifier/planner behaviour (slices 2–3) — this slice only sets the fields, it does not consume them.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Author sets neither default nor any override | Lowers to IR with no `control`/`defaultControl` | Byte-identical hash to today — the slice-1 no-churn guarantee, re-confirmed via the integration test's round-trip. |
| Author sets `defaultControl` but no per-object override | All objects inherit the default; no per-node `control` written | The resolver yields the default; the IR omits per-node `control`. |
| Author sets a per-object `control` equal to the contract default | Lowers to per-node `control` set (explicit) | Acceptable: slice-1 omit-when-default is about the *effective* default; an explicit equal value may or may not serialize per slice-1's serializer rule. Confirm the integration test asserts effective control, not raw field presence, to stay robust to that choice. |

## Slice-specific done conditions

- [ ] The SQL TS contract builder accepts `defaultControl` (contract-level) and `control` (per-table), type-checked to the four `ControlPolicy` values.
- [ ] An integration test authors a contract with a `defaultControl` plus at least one per-table override, builds it, and asserts the resulting IR's effective control per node (via `effectiveControl`) matches the authored intent, and that the contract round-trips.

## Open Questions

1. **Whether enums (and other target-only storage kinds) get a TS override now.** Working position: ship table-level + contract-default for v0.1 (the motivating Supabase case is table-shaped); a per-enum override is additive and deferred unless the integration target needs it.

## References

- Parent project: [`projects/control-policy/spec.md`](../../spec.md)
- Linear issue: TML-2778
- [`prefer-psl-in-design-docs`](../../../../.agents/rules/prefer-psl-in-design-docs.mdc) — why this TS-specific slice is an explicit exception (PSL spelling is slice 5).
