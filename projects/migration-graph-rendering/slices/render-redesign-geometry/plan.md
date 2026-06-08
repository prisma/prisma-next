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
  (scenarios + `pnpm gallery`) and `migration-graph-gallery-snapshots.test.ts`
  (vitest `toMatchSnapshot()` for verbatim ANSI, plus structural invariants: no-tee
  alphabet, focus colours present). Existing rollback scenarios: `rollback-adjacent`,
  `rollback-arc`, `rollback-merge` (co-**sourced** — same source, different targets,
  NOT convergence), `rollback-cross`. **No converging scenario** (≥2 skipping rollbacks
  → the *same* target).

### Pinned definition of "converged" (structural, design decision)

The design doc states the convergence *rule* but has no worked example in the new
corner model (the old `converging-back-arcs` ASCII used now-forbidden tees). Because
the harness snapshots bytes automatically, the meaningful RED/GREEN signal is a
**structural assertion**, not a hand-drawn glyph golden. "Converged" means:

1. Skipping rollbacks that land on the **same target node** share **one** back-lane
   column. Total grid width = `(numForwardLanes + numTargetGroups) * colsPerLane`
   (today it is `(numForwardLanes + numSkippingArcs) * colsPerLane`).
2. Each source tees into the shared rail (corner, never a tee — occlusion arbitrates
   the shared vertical's colour per the existing line/plane model).
3. A single landing closes at the target (one drawn `◂`/corner; others occluded).
4. Display order is unchanged — the tip stays topmost (convergence is a back-lane
   routing change only; `computeDisplayOrder` is not touched).

Exact glyphs are not pinned: they fall out of the renderer + occlusion in D2 and are
recorded in the auto-captured snapshot. The structural width/lane-count assertion is
what proves convergence.

## Dispatches

### Dispatch 1: Convergence scenario + RED structural assertion

- **Outcome:** A `rollback-converge` scenario (two node-skipping rollbacks landing on
  the *same* target, e.g. `∅→a→b→c→d` trunk + `d→a` + `c→a`; plus a three-arc variant
  `d→a` + `c→a` + `b→a`) is added to the scenario gallery. A **structural convergence
  assertion** (arcs sharing a target occupy exactly one back-lane column → grid width
  per the pinned formula; tip stays topmost) is added, marked expected-fail (`it.fails`,
  the core slice's RED convention) against today's per-arc layout. Red confirmed.
- **Builds on:** the merged `render-redesign-core` scenario gallery + occlusion pipeline.
- **Hands to:** a failing structural assertion pinning the narrowed converged shape, plus
  the new scenario whose verbatim snapshot is auto-captured (per-arc bytes for now; D2
  re-records it converged).
- **Focus:** `migration-graph-scenario-gallery.ts` + `migration-graph-gallery-snapshots.test.ts`
  only. No `src/` change.
- **Completed when:** the new structural assertion is RED for the expected reason (more
  than one back-lane column for same-target arcs); `it.fails` passes (i.e. it genuinely
  fails); every other gallery case still green; `pnpm test:packages -- @prisma-next/cli`.

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
- **Completed when:** D1's structural convergence assertion passes (flip `it.fails` →
  `it`; **strengthen the tip-topmost check** when un-`fails`ing — assert `grid[0]`'s node
  cell is the highest-rank tip, not merely that some node leads the grid, per the D1
  review); revert-to-red verified by reverting the layout change); the `rollback-converge`
  snapshot is re-recorded to the converged output via `pnpm gallery` then
  `--update-snapshots`; `rollback-arc` / `rollback-cross` / `rollback-merge` /
  `rollback-adjacent` snapshots byte-identical (non-converging cases untouched);
  `pnpm test:packages -- @prisma-next/cli` green.

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
