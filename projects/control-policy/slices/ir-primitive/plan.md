# Slice `ir-primitive` — Dispatch plan

**Slice spec:** [`spec.md`](spec.md) · **Linear:** TML-2775

Three sequential dispatches: foundation type + resolver, then a uniform fan-out of the field across the storage IR, then cross-target round-trip + no-churn verification.

### Dispatch 1: foundation type, resolver, and contract-default field

- **Outcome:** `ControlPolicy` and `effectiveControl(nodeControl, defaultControl)` exist in `@prisma-next/contract`; `Contract` carries `defaultControl?: ControlPolicy` (type only). Unit tests pin the resolver's precedence (`node → default → 'managed'`).
- **Builds on:** The spec's chosen design.
- **Hands to:** The exported `ControlPolicy` type + `effectiveControl` resolver that every later dispatch and downstream slice imports, and the `defaultControl` field on `Contract`.
- **Focus:** In — foundation type, the pure resolver + its unit tests, the `Contract` type field. Out — the per-node `control` field and **all** arktype validator wiring (Dispatch 2), which keeps this dispatch foundation-only (typecheck + unit test gate, no cross-package surface).

### Dispatch 2: fan `control?` out across every storage-plane node + validators

- **Outcome:** SQL `StorageTable`/`StorageColumn`, the Mongo storage entity, and `PostgresEnumStorageEntry` each carry `control?: ControlPolicy` via the existing `declare readonly` + assign-if-defined idiom; every affected arktype validator accepts `control`, and the contract-shape validator accepts `defaultControl`. A set value survives construction; an unset value is never assigned.
- **Builds on:** Dispatch 1's `ControlPolicy` type + `Contract.defaultControl` field.
- **Hands to:** Every storage-plane IR node carrying `control`, validated, with omit-when-default holding at the class level.
- **Focus:** In — the uniform field addition + all validator updates (per-node `control` and contract-level `defaultControl`) across the named classes. Out — the resolver's consumers, and any round-trip/fixture verification (Dispatch 3).

### Dispatch 3: cross-target round-trip + no-hash-churn verification

- **Outcome:** Round-trip property tests pass for Postgres, SQLite, and Mongo (mixed `control` + `defaultControl` preserved per node through `serialize → deserialize`); `pnpm fixtures:check` shows zero churn; existing package suites stay green.
- **Builds on:** Dispatch 2's field-bearing storage nodes.
- **Hands to:** The slice-DoD evidence — round-trip fidelity (the project's AC7 obligation) and the proof that managed-default contracts hash identically.
- **Focus:** In — the property tests across the three targets, `fixtures:check`, and confirming no existing suite regressed. Out — nothing further; this closes the slice.
