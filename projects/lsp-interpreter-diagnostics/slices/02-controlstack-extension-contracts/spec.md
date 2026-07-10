# Slice 02 — ControlStack exposes extension contracts

**Project:** [`../../spec.md`](../../spec.md) · **Project plan:** [`../../plans/plan.md`](../../plans/plan.md) § M2 · **Linear:** TML-2984

## Design (settled — operator Option A, 2026-07-09; see project spec § Place in the larger world)

`ContractSourceContext` is a pure property bag; the only non-pick today is
`composedExtensionContracts`, assembled inline in the CLI emit path
(`packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts`
~lines 196–225) via two `blindCast`s. Root-cause fix:

1. **`ControlStack` gains `extensionContracts: ReadonlyMap<string, Contract>`**
   (`packages/1-framework/1-core/framework-components/src/control/control-stack.ts`),
   built inside `createControlStack` from each contract-space-bearing extension
   descriptor, keyed by space id (extension pack id). `createControlStack` already
   structurally reads `contractSpace.contractJson` at lines ~409–417 for extension
   load ordering — the map is built beside that existing read. The one unavoidable
   `contractJson → Contract` cast lives there and **only** there
   (framework-components already depends on `@prisma-next/contract`).
2. **CLI emit context construction collapses to pure property picks** — the inline
   `toExtensionInputs` + map-building block and its two `blindCast`s are deleted;
   `composedExtensionContracts` becomes `stack.extensionContracts`.
3. **`composedExtensionPacks`**: check whether `stack.extensionIds` equals
   `extensionPacks.map(p => p.id)` (content **and** order — load-order matters to the
   interpreter). If equal, use it; else keep the id map inline.
4. **Grep gate** ("no `contractJson` casts outside framework-components") lands in
   `drive/calibration/grep-library.md`.

`toExtensionInputs` and the CLI's per-consumer adapters stay untouched — its other
consumers (migrate-pass, extension-migrations, migration commands) still need it.

## Coherence rationale

One reviewable PR: "the stack carries what its consumers were re-deriving." The
property addition and the CLI simplification are producer and first consumer of the
same fact; landing the property without deleting the inline assembly would leave two
sources of truth — exactly what the amended AC5 forbids. Emit output is bit-identical;
behavior-preserving by construction.

## Slice Definition of Done (beyond CI / reviewer / project-DoD)

- [ ] SDoD1 — `ControlStack.extensionContracts` carries each contract-space-bearing
      extension's contract keyed by space id, in extension load order semantics
      consistent with `extensionPacks`; extensions without a contract space are
      absent from the map (unit tests in framework-components, TC-8).
- [ ] SDoD2 — `contract-emit.ts` context construction is pure property picks; its two
      inline `blindCast`s are gone; net cast-ratchet ≤ baseline (the relocated cast in
      `createControlStack` is the only `contractJson` cast in the repo).
- [ ] SDoD3 — Emit output bit-identical: existing emit/e2e fixtures green,
      `pnpm fixtures:check` clean (TC-8).
- [ ] SDoD4 — Grep gate documented in `drive/calibration/grep-library.md` and passing:
      no `contractJson` casts outside `framework-components`.

## Edge cases (pre-investigated)

- `extensionIds` vs `extensionPacks.map(p => p.id)`: `createControlStack` orders
  `extensionPacks` via `buildExtensionLoadOrder`; whether `extensionIds` is the same
  ordered projection or a differently-sourced list must be *verified in code*, not
  assumed (project plan flags this check explicitly).
- Test fixtures constructing `ControlStack`-shaped objects gain the new required
  property — typecheck surfaces every site; fixtures should use a small helper or
  empty map, not per-site casts.
- The descriptor's `contractJson` is `unknown` at the structural-read site; the cast
  reason string should mirror the CLI's original ("the typed contract for this
  extension space").

## Dispatch plan

Target: 2 dispatches, sequential (D2 consumes D1's property).

### D1 — `ControlStack.extensionContracts` in framework-components

- **Outcome:** the stack exposes the typed map, built in `createControlStack` beside
  the existing structural read; unit tests cover populated/empty/no-contract-space
  cases; the `extensionIds` ≟ ordered-ids question answered in code (test pins the
  answer); stack-shaped test fixtures adapted.
- **Builds on:** slice 01 (merged; no code dependency).
- **Hands to:** D2 (CLI consumes the property).
- **Focus:** `packages/1-framework/1-core/framework-components/` only.
- **Gate:** `pnpm --filter @prisma-next/framework-components test` + typecheck + lint,
  `pnpm typecheck`, `pnpm test:packages`, cast-ratchet delta = +1 here (transitional;
  D2 deletes 2).

### D2 — CLI emit simplification + grep gate

- **Outcome:** `contract-emit.ts` builds `ContractSourceContext` by property picks;
  two `blindCast`s deleted; grep gate documented in
  `drive/calibration/grep-library.md`; emit fixtures bit-identical.
- **Builds on:** D1.
- **Hands to:** slice 04 (LSP builds the same context by picks).
- **Focus:** `packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts`,
  `drive/calibration/grep-library.md`.
- **Gate:** `pnpm --filter @prisma-next/cli test` + typecheck + lint,
  `pnpm typecheck`, `pnpm test:e2e` (emit cycle), `pnpm fixtures:check`,
  `pnpm lint:deps`, net cast-ratchet ≤ baseline − 1.
