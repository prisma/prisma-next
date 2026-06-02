# Slice: consolidate the per-edge breakdown onto the migration plan

_Parent project `projects/migration-graph-rendering/`. Outcome this slice contributes to: the ledger-foundation slice (TML-2769) threads the per-edge breakdown to the runners as a **sibling field** (`migrationEdges`) next to `plan: MigrationPlan`. The edges are really the plan's own finer structure, so the two fields must be kept consistent by hand (a `Σ operationCount === plan.operations.length` guard exists only because they can desync). This slice moves the breakdown **onto the plan** so the runner reads `plan.edges`, the sibling field disappears, and the guard's reason to exist goes away._

## At a glance

Today — two parallel fields the runner must reconcile:

```ts
runner.execute({
  plan: MigrationPlan,        // aggregate shape: origin → destination + flat operations[]
  migrationEdges: [           // sibling: per-edge breakdown (dirName, hash, from, to, opCount)
    { migrationHash, dirName, from, to, operationCount },
  ],
  // …
});
```

After — the breakdown is part of the plan:

```ts
runner.execute({
  plan: {
    ...MigrationPlan,
    edges: [{ migrationHash, dirName, from, to, operationCount }],
  },
  // …
});
```

## Chosen design

`MigrationPlan` carries only the aggregate shape — one `origin`→`destination` and a **flat** `operations[]`. The per-edge breakdown (per-edge `dirName`, `migrationHash`, intermediate `from`/`to`, per-edge `operationCount`) is what the ledger journal needs (one row per applied migration), and it is **not** a pure duplicate of the plan — only the endpoints (first edge's `from` = `plan.origin`, last edge's `to` = `plan.destination`) and the op-count total overlap. But threading it as a **sibling** of `plan` on the runner options is the smell: `PerSpacePlan` already carries `migrationEdges` (the planner builds it alongside the plan), and the producer copies it onto the runner options next to `plan`, so the runner receives two fields describing the same apply and must guard against their desync.

This slice:

- **Adds `readonly edges` to `MigrationPlan`** (in `framework-components`). The element type stays a **structural inline** object (`{ migrationHash; dirName; from; to; operationCount }`) for the same layering reason the sibling field is inline today: `framework-components` (layer 1-core) cannot import `AggregateMigrationEdgeRef` from `migration-tools` (layer 3-tooling).
- **Runners read `plan.edges`** instead of `options.migrationEdges` (mongo, postgres, sqlite).
- **Drops the sibling `migrationEdges`** from `MigrationRunnerPerSpaceOptions`, `MongoMigrationRunnerExecuteOptions`, and the SQL family's per-space option shape.
- **Producer stamps `edges` onto the plan it already builds.** The planner already holds `PerSpacePlan.migrationEdges`; it sets `plan.edges` from the same source rather than emitting a separate field. `apply.ts` no longer copies a sibling.
- **Retires the `Σ operationCount === plan.operations.length` desync guard** — once `edges` and `operations` are constructed together on one object, they can't drift independently. (Optionally keep it as a cheap internal `assert` in the runner; settle at pickup.)

## Scope

**In:**

- `MigrationPlan.edges` (structural inline, framework-components).
- Runners read `plan.edges`; sibling `migrationEdges` removed from all runner-option shapes.
- Producer (`apply.ts` / planner) stamps `edges` onto the plan.
- Migrate every construction site — the package runner tests (`synthEdges(plan)` helpers) and the five example-app manual/chain tests — from sibling `migrationEdges` to `plan.edges`.

**Out:**

- The per-edge data itself (unchanged — same five fields).
- `PerSpacePlan.migrationEdges` naming on the planner side (internal; can stay or be renamed `edges` for symmetry — decide at pickup).
- The ∅-origin spelling (`from: ''` / `sha256:empty` / `null`) — see sibling slice `empty-origin-as-null`.

## Open Questions

1. **Keep the op-count guard as an internal assertion?** Once edges live on the plan the desync path is gone, but a cheap `assert(Σ edges.operationCount === operations.length)` in the runner still catches a malformed producer. Decide whether the assertion earns its keep.
2. **`edges` required vs optional on `MigrationPlan`.** The sibling field is currently required (synth/at-head plans carry a single synthesised edge). Keep it required for the same reason, or model at-head as an empty array — settle at pickup.
3. **Rename `PerSpacePlan.migrationEdges` → `edges`?** Cosmetic symmetry with the new plan field; optional.

## References

- Parent project: `projects/migration-graph-rendering/spec.md`.
- Predecessor: `slices/ledger-foundation/spec.md` (TML-2769) introduced the sibling `migrationEdges`; this slice consolidates it.
- Surfaced by the TML-2769 / PR #665 review (the "single structure of migration runners" thread). The blast radius of making the sibling field required — five example-app call sites plus every runner-option test — is itself evidence that the breakdown belongs on the plan.
- Linear issue: _to be filed at pickup (standalone, related to TML-2769 / TML-2774)._
