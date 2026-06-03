# Slice `verifier-dispatch` — Dispatch plan

**Slice spec:** [`spec.md`](spec.md) · **Linear:** TML-2776

Two dispatches: the SQL family dispatch + Postgres compatible-shape hook first, then the Mongo family mirror.

### Dispatch 1: SQL family four-way dispatch + Postgres compatible-shape hook

- **Outcome:** The SQL family verifier base branches on `effectiveControl(node.control, contract.defaultControl)` across `managed` / `tolerated` / `external` / `observed`, applying the comparison strategy from the slice spec. The base exposes a target-supplied compatible-shape hook; Postgres supplies a conservative concrete relation. A non-error issue kind exists for tolerated/observed/external divergence. Unit tests pin each policy's strategy on the Postgres-backed SQL path.
- **Builds on:** Slice 1's `control` field + `effectiveControl` resolver.
- **Hands to:** Verifier behaviour for all four policies + the compatible-shape hook — consumed by Supabase's `auth.users` verification.
- **Focus:** In — the family-base dispatch, the Postgres hook, the issue-kind addition, SQL/Postgres unit tests. Out — Mongo (Dispatch 2), planner behaviour (slice 3), widening the compatible relation.

### Dispatch 2: Mongo family mirror

- **Outcome:** The Mongo family verifier base applies the same four-way dispatch over collections, with Mongo's looser shape semantics, and a unit test per policy.
- **Builds on:** Dispatch 1's strategy shape (so the two families read the same resolver and produce the same issue taxonomy).
- **Hands to:** Family-parity verifier behaviour — the dispatch is not SQL-only.
- **Focus:** In — the Mongo family-base dispatch + tests. Out — Mongo authoring (slice 4), anything SQL.
