# Slice `planner-dispatch` — Dispatch plan

**Slice spec:** [`spec.md`](spec.md) · **Linear:** TML-2777

Two dispatches: the per-node DDL gate first, then the un-overridable external-namespace floor + diagnostic on top.

### Dispatch 1: per-node DDL gate

- **Outcome:** The SQL family migration seam (honoured by the Postgres planner) gates candidate DDL on `effectiveControl(node.control, contract.defaultControl)`: `managed` ⇒ full lifecycle, `tolerated` ⇒ CREATE-if-missing only, `external`/`observed` ⇒ no DDL. Unit tests pin each policy's emission; existing `managed`-path suites stay green.
- **Builds on:** Slice 1's `control` field + `effectiveControl` resolver.
- **Hands to:** Planner behaviour for all four policies — the per-object gate the safety floor sits on top of.
- **Focus:** In — the per-node gate + Postgres planner wiring + per-policy tests. Out — the namespace floor + diagnostic (Dispatch 2), verifier behaviour (slice 2).

### Dispatch 2: external-namespace safety floor + conflict diagnostic

- **Outcome:** When a contract space's effective default is `external`, the planner emits zero DDL into its namespaces regardless of a per-object `managed` override, and surfaces a diagnostic naming the mis-declared object and the external namespace. A test reproduces the project-DoD case (`defaultControl: 'external'` + a `managed` object ⇒ zero DDL + diagnostic).
- **Builds on:** Dispatch 1's per-node gate.
- **Hands to:** The external-namespace safety guard — consumed by Supabase delivery.
- **Focus:** In — the floor, the diagnostic, the mis-declaration test. Out — anything verifier- or authoring-side.
