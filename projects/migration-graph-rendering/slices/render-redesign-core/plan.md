# Dispatch plan — `render-redesign-core`

_Slice: rebuild the Tier-3 migration-graph renderer on the design doc's line/plane model
(`design/graph-render-redesign.md`). Five sequential dispatches, one PR (commit-per-dispatch)._

## Shape: build-the-new-pipeline-alongside, then cut over + delete

The layout and the renderer share one boundary — the grid type. Changing the layout's
output type in place breaks the old renderer the same instant, so no single mid-slice
commit would build green. The plan therefore builds the **new** layout + renderer
**alongside** the old `StructuralCell` path (which keeps every command working +
snapshots green), then cuts consumers over and deletes the old path last. This is the
migration shape (new-alongside → cut over → remove old), chosen so every dispatch lands
green.

**The split that matters: colour-correctness (D4) is isolated from the normal-mode visual
change (D5).** D4 proves the bleed is fixed on `migrate --show` without touching
`graph`/`status`/`list`. D5 takes the deliberate tee→corner change to normal mode (snapshot
regen + visual review) on its own, so the reviewer judges "is the new git-log rendering
good?" separately from "is the colour correct?".

> **Spec correction folded in (grounding finding):** the old done-condition "normal-mode
> snapshots byte-identical" was **wrong** — it contradicts the no-tee discipline. Dropping
> `branchTee`/`mergeTee` (`├─`) for corners *changes* `graph`/`status`/`list` output by
> design (the design doc's `│─╮─╮`). The spec now says those snapshots are **regenerated +
> visually reviewed**, and that change is quarantined to **D5**.

## Non-linear hand-offs

- **D4 builds on D1 _and_ D2+D3** — it renders D2/D3's grid *and* must flip D1's
  captured-failure tests green (revert-to-red verified). Not just D3.
- **D5 builds on D4 _and_ D2+D3** — it reuses the D4 renderer and the D2/D3 layout's
  normal-mode (trunk-on-top) z-order for the `graph`/`status`/`list` cutover.

---

### Dispatch 1 — Data model + colour-walk test helper + RED capture

- **Outcome:** A new model module exports the line/cell/grid types (`Direction`,
  `LineRef{migrationHash, role, branch-id}`, `CellLine{line, directions, plane}`,
  `Cell{node?, lines[]}`, `Grid`) — names per the design sketch, final names the
  executor's call. A per-glyph **colour-walk** assertion helper (walks rendered output
  cell-by-cell → a `G`/`D`/`R`/`.` colour map, the technique from PR #735) lands in the
  test utils. `migration-graph-colour-matrix.test.ts` gains cases that capture **today's**
  wrongness as **failing** tests: at minimum (a) the residual on-path trunk-continuity gap
  (the "Y" case) and (b) the off-path back-arc/crossing **green bleed** on the showcase
  `@db→prod` highlighted path. Both are RED against current HEAD.
- **Builds on:** the spec's chosen design + the design doc model.
- **Hands to:** a typed grid contract D2/D3 implement against, and a RED test net that D4
  must turn green — the revert-to-red anchor for the whole slice.
- **Focus:** new `migration-graph-model.ts` (types only, no logic); the colour-walk helper
  beside the existing `forcedGreen`/`forcedDim` force-colour seam; new failing cases in the
  colour matrix. **Out:** any layout/renderer behaviour change (old path stays green).
- **Gate (binary):** `pnpm typecheck` green; `pnpm --filter @prisma-next/cli test` shows
  the new captured-failure cases **FAILING** and everything else green; the colour-walk
  helper has a unit test proving it maps a known ANSI string to the right `G/D/R/.` map.

### Dispatch 2 — New layout: forward-DAG grid + single-owner discipline + mode z-order

- **Outcome:** A new layout function consumes the same traversal/row-order/lane inputs as
  today and emits the new `Grid`: each forward edge routed as a line carrying its
  `LineRef`; each contract a node; the **no-tee / 2-columns-per-lane** discipline so every
  cell is **single-owner** (lane column = vertical; connector column = corners); plane
  assignment for forward lines (all base plane) with **mode-dependent z-order** — normal =
  trunk-on-top, highlighted = on-path-branch-on-top. **No back-arcs, no convergence** yet.
  The old layout + renderer are untouched and still green.
- **Builds on:** D1's grid types.
- **Hands to:** a tested forward-graph `Grid` where the single-owner invariant provably
  holds — the structure D3 extends with back-arcs and D4 renders.
- **Focus:** new layout builder (reuse the existing traversal + lane/column allocation —
  positioning was never the bug); the corner-not-tee routing; the two z-order modes. **Out:**
  back-arcs (D3); rendering (D4); touching the old path.
- **Gate (binary):** `pnpm typecheck` green; new layout unit tests green over the forward
  fixtures (straight line · 2 branches · diamond), asserting for every cell **exactly one**
  owning line, with the expected line identity + directions + plane, in **both** z-order
  modes; `pnpm --filter @prisma-next/cli test` otherwise green (old path unchanged).

### Dispatch 3 — New layout: back-arcs on the upper plane (continuous)

- **Outcome:** The new layout routes rollback / back edges as **upper-plane** lines drawn
  **continuous**; where a back-arc crosses a forward vertical the **forward line clips** and
  the back-arc runs through. Per-arc lanes kept (convergence is the `render-redesign-geometry`
  slice). Old path still green.
- **Builds on:** D2's forward `Grid` + single-owner invariant.
- **Hands to:** the complete new `Grid` (forward + back-arcs) — everything D4 needs to render.
- **Focus:** back-arc plane assignment + the forward-clip-at-crossing rule, on top of D2's
  builder. **Out:** convergence (geometry slice); rendering (D4).
- **Gate (binary):** `pnpm typecheck` green; new layout tests green over the back-arc
  fixtures (branch+rollback · rollback-on-path · loop-via-data-invariant), asserting the
  back-arc sits on the upper plane + the crossed forward cell records the clip, single-owner
  still holds; `pnpm --filter @prisma-next/cli test` otherwise green.

### Dispatch 4 — New renderer (occlusion) + cut `migrate --show` over; prove colour-correct

- **Outcome:** A new renderer projects the `Grid`: per cell take the **topmost** line →
  glyph = box-char from its directions (verticals + corners), colour = **that line's**
  colour, lower lines occluded; node/arrow overlays last. **`migrate --show` is switched to
  the new layout+renderer.** `graph`/`status`/`list` stay on the **old** path (still green,
  output unchanged). D1's captured-failure tests now **PASS**, and reverting the new
  renderer makes them fail again (**revert-to-red verified**).
- **Builds on:** D1 (the captured tests it must green) **and** D2+D3 (the grid it renders) —
  non-linear.
- **Hands to:** a colour-correct `migrate --show` — zero off-path green, back-arcs grey —
  proven by the ground-truth force-render. The new renderer is live for one consumer; the
  old path still serves the other three.
- **Focus:** the occlusion projection (direction→glyph lookup, colour straight off the
  owning line); wiring `migrate --show` to the new pipeline; the renderer + combined tests.
  **Out:** migrating `graph`/`status`/`list` (D5); deleting old code (D5).
- **Gate (binary):** `pnpm typecheck` green; renderer unit tests + combined
  (layout→render) tests green; the **captured-failure tests pass and revert-to-red is
  demonstrated** (revert renderer → red; restore → green); a force-render of the real
  showcase `@db→prod` path shows **zero** off-path green and no rotation colour;
  `pnpm --filter @prisma-next/cli test` green (old `graph`/`status`/`list` snapshots
  **unchanged**).

### Dispatch 5 — Cut `graph`/`status`/`list` over + retire the old path

- **Outcome:** `graph`/`status`/`list` switch to the new layout+renderer. Their snapshots
  are **regenerated** to the new corner rendering (trunk-on-top `│─╮─╮`) — the **intentional**
  tee→corner change — and visually reviewed. The old `StructuralCell` union (14 kinds), the
  render `switch`, the per-cell `migrationHash?` bolt-on, the `branchTee`/`mergeTee` glyphs,
  and the now-dead old layout are **deleted**. No `StructuralCell`/`cell.kind` references
  remain.
- **Builds on:** D4's proven renderer **and** D2+D3's normal-mode (trunk-on-top) layout —
  non-linear.
- **Hands to:** the slice-DoD — one line/plane pipeline serves every command; colour is
  correct-by-construction; the cell-kind switch is gone.
- **Focus:** wiring the three normal-mode commands; regenerating + eyeballing the
  `graph-render.test.ts` snapshots; deleting the old layout/renderer/tees/hash bolt-on.
  **Out:** convergence + configurable geometry (the `render-redesign-geometry` slice).
- **Gate (binary):** `pnpm typecheck` green; `pnpm --filter @prisma-next/cli test` green
  with regenerated `graph-render` snapshots; `rg "StructuralCell|cell\.kind|branchTee|mergeTee|migrationHash\?" packages/1-framework/3-tooling/cli/src/utils/formatters`
  returns **nothing**; reviewer signs off the new corner rendering as an intended improvement.

---

## Dispatch-INVEST check

- **D1** — Independent (old path untouched), Valuable (the RED capture is the test-first
  anchor + publishes the type contract), Estimable/Testable (binary: named cases must be
  red, helper unit-tested), Small (types + helper + a few test cases). ✔
- **D2** — the substrate-change pattern: a self-contained new layout, tested in isolation,
  nothing else touched. Small because it's forward-only (back-arcs deferred to D3). ✔
- **D3** — surgical extension of D2's builder (back-arcs), its own fixtures. ✔
- **D4** — bounded: new renderer + **one** consumer cutover; the hard colour-correctness
  proof is the named, testable gate (revert-to-red + force-render). Normal mode deliberately
  excluded to keep it Small + to quarantine risk. ✔
- **D5** — the cutover-and-delete: mechanical wiring + snapshot regen + dead-code removal,
  with a grep gate proving the old path is gone. One outcome. ✔

**Sizing verdict:** a big but **coherent single slice** — layout and renderer cannot land
in separate PRs without a broken intermediate, so this is one PR, five commits. Five ≤ 10.
The two genuinely hard dispatches (D2 layout rewrite, D4 colour-correctness) are isolated
from each other and from the normal-mode visual change (D5), which is the main risk-control
move in this decomposition.

## References

- Spec: [`spec.md`](spec.md)
- Design-of-record: [`../../design/graph-render-redesign.md`](../../design/graph-render-redesign.md)
- Sibling slice: [`../render-redesign-geometry/spec.md`](../render-redesign-geometry/spec.md) (convergence + configurable geometry)
- Renderer surface: `packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-{layout,rows,tree-render,lane-colors}.ts`
- Test net: `cli/test/utils/formatters/migration-graph-{colour-matrix,cell-identity,tree-render}.test.ts`, `__snapshots__/graph-render.test.ts.snap`
