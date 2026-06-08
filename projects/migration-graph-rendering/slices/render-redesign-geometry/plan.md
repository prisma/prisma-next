# Dispatch plan — render-redesign-geometry

Decomposes [`spec.md`](./spec.md) (back-arc convergence + configurable geometry) into
dispatches. Design-of-record: [`../../design/graph-render-redesign.md`](../../design/graph-render-redesign.md)
(§ Planes → convergence; § Geometry is configurable). Builds on the merged
`render-redesign-core` line/plane/occlusion pipeline.

Supersedes the obsolete `../converging-back-arcs/` slice (it targeted the deleted
`migration-graph-layout.ts` / tee glyphs); its convergence outcome lives here.

## Grounding (current code)

- **Layout:** `src/utils/formatters/migration-graph-grid-layout.ts`. Skipping
  rollbacks currently get **one back-lane per arc** (`numBackLanes =
  skippingRollbacks.length`, line ~283; `geomLaneOf` assigns a distinct rail per
  arc). `backArcsByTarget` already exists but is unused for lane sharing.
- **Geometry:** `colsPerLane` is **already** a `GridOptions` param threaded through
  `buildGrid`; the occlusion renderer reads the pre-widened grid, so widening needs
  no renderer edit. Remaining hard-coded geometry is label-side: `hashLength` and
  `dirNameWidth` in `migration-graph-labels.ts`.
- **Test harness:** `test/utils/formatters/migration-graph-scenario-gallery.ts`
  (hand-authored oracle + `pnpm gallery`) and `migration-graph-gallery-snapshots.test.ts`.
  Existing rollback scenarios: `rollback-adjacent`, `rollback-arc`, `rollback-merge`,
  `rollback-cross`. **No converging scenario** (≥2 skipping rollbacks → same target).

## Dispatches

### Dispatch 1: Convergence oracle (RED)

- **Outcome:** A `rollback-converge` scenario (two node-skipping rollbacks landing on
  one target, plus a three-arc variant) is added to the scenario gallery with
  hand-authored expected output showing **one shared back-lane** + a single landing
  (per the design doc's converged before/after) and the tip staying topmost. Wired as
  a gallery assertion that **fails** against today's per-arc layout. Red confirmed.
- **Builds on:** the merged `render-redesign-core` scenario gallery + occlusion pipeline.
- **Hands to:** a failing convergence oracle pinning the narrowed converged shape
  (current layout renders N rails; the golden expects 1).
- **Focus:** `migration-graph-scenario-gallery.ts` + the gallery snapshot test only.
  No `src/` change.
- **Completed when:** `pnpm test:packages -- cli` shows the new `rollback-converge`
  case failing for the expected reason (extra back-lane columns); all other gallery
  cases still green.

### Dispatch 2: Convergence layout (GREEN)

- **Outcome:** In `migration-graph-grid-layout.ts`, skipping rollbacks are grouped by
  target node; **one shared `geomLane` per target group** (not per arc); each source
  tees into the shared rail; a single landing closes at the target; `numBackLanes` /
  `totalCols` derive from the group count. Occlusion keeps each arc's own colour on the
  segment it owns; the single-owner invariant holds.
- **Builds on:** Dispatch 1's failing convergence oracle.
- **Hands to:** back-arcs to a shared target render as one rail; the colour matrix and
  all non-converging rollback scenarios are unchanged.
- **Focus:** back-arc planning + tee/landing emission + width computation in
  `grid-layout.ts`. No colour-semantics change; no geometry-constant refactor.
- **Completed when:** D1's `rollback-converge` cases pass (revert-to-red verified by
  reverting the layout change); `rollback-arc` / `rollback-cross` / `rollback-merge`
  snapshots byte-identical; `pnpm test:packages -- cli` green.

### Dispatch 3: Configurable geometry

- **Outcome:** Every hard-coded geometry constant (label-side `hashLength` /
  `dirNameWidth`, any connector-gap literal, and `colsPerLane`'s default) is a named
  parameter on the options surface consumed by layout + labels. A test renders one
  fixture at `colsPerLane` 2 vs 3 and asserts the output scales **with no renderer
  edit**; the default keeps existing snapshots byte-identical.
- **Builds on:** Dispatch 2's converged layout (so the audited constant set is final).
- **Hands to:** geometry fully parameterized — a one-line constant change rescales the
  output; defaults unchanged.
- **Focus:** the geometry-constant surface across `grid-layout.ts` + `labels.ts`
  (+ `command-render.ts` plumbing). No topology or colour change.
- **Completed when:** a `colsPerLane` 2-vs-3 scaling test passes with no `src/` change
  beyond the constant; `grep` finds no remaining hard-coded geometry literal in the
  named files; default-path snapshots byte-identical; `pnpm test:packages -- cli` green.

## dispatch-INVEST check

- **Independent:** D1 (tests only) → D2 (layout) → D3 (constants) are strictly
  sequential; each hand-off is a named stable state. No concurrent work elsewhere.
- **Negotiable:** each names the outcome; the implementation path (exact grouping data
  structure, constant names) is executor discovery.
- **Valuable:** D1 pins the contract, D2 delivers convergence, D3 delivers
  configurability — each is a slice-DoD line, none is pure prep.
- **Estimable:** each `Completed when` is a binary test/grep gate.
- **Small:** convergence is one coherent layout change (D2); the geometry audit is a
  bounded constant lift (D3); both fit one executor session. One reviewable PR.
- **Testable:** gated by `pnpm test:packages -- cli` + targeted greps.

Hand-offs are linear; the final hand-off (D3) plus D2's colour-matrix-green check cover
all three slice-DoD conditions. One slice, one PR.

## Model tiers

Implementers: sonnet-mid. Reviewer pass: opus-high.
