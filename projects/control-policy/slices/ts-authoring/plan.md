# Slice `ts-authoring` — Dispatch plan

**Slice spec:** [`spec.md`](spec.md) · **Linear:** TML-2778

Two dispatches: the contract-level default option first, then the per-object override + the integration test that exercises both ends.

### Dispatch 1: contract-level `defaultControl` option

- **Outcome:** The SQL TS contract builder accepts `defaultControl?: ControlPolicy` at the contract-build entry point, type-checked to the four values, lowering to `Contract.defaultControl`. A focused test (unit or type-level) confirms the option reaches the IR.
- **Builds on:** Slice 1's `Contract.defaultControl` field + `ControlPolicy` type.
- **Hands to:** The contract-level default — the 80% extension-author path (`defaultControl: 'external'`).
- **Focus:** In — the builder option + its lowering + a focused test. Out — the per-object override (Dispatch 2), PSL (slice 5).

### Dispatch 2: per-table `control` override + integration test

- **Outcome:** Table authoring accepts `control?: ControlPolicy`, lowering to `StorageTable.control`. An integration test authors a contract with a `defaultControl` plus at least one per-table override, builds it, and asserts per-node effective control (via `effectiveControl`) matches intent and that the contract round-trips.
- **Builds on:** Dispatch 1's contract-level option.
- **Hands to:** The full ergonomic surface — default + override — exercised end-to-end.
- **Focus:** In — the per-table option, its lowering, the mixed-contract integration test. Out — per-column override (non-goal), Mongo authoring, PSL.
