# Dispatch plan — `render-redesign-core`

_Slice: rebuild the Tier-3 migration-graph renderer on the design doc's line/plane model
(`design/graph-render-redesign.md`), verified through an executable **scenario gallery**
(`spec.md § Verification surface`). Five sequential dispatches, one PR (commit-per-dispatch)._

## Shape: author the oracle (goldens) → build the real pipeline to match → cut over + delete

The verification surface is a **hand-authored oracle** (`spec.md § Verification surface`): each
scenario/variant's expected output is a hand-authored 2D array of `{glyph, colour}` cells,
serialised by a trivial `renderCells` the gallery runs. The gallery **never invokes the real
renderer**. So the goldens are authored and **operator-approved first**, then the real pipeline
(model → occlusion renderer → layout) is built to **match** them.

Order:
- **D1 (done):** topology catalogue (the inputs) + gallery harness + current-output capture =
  the RED baseline (today's real output ≠ the goldens).
- **D2:** the oracle foundation — `Cell{glyph,colour}` + `renderCells` + the gallery showing
  **goldens** in colour, and the hand-authored goldens for the **lock-the-look** set
  (`linear`/`fork-2`/`merge-2`/`diamond` × rotating/highlight-trunk/highlight-alt). Operator
  approves the corner language (`│─╯` rotating vs `╭─╯` highlighted, mode z-order). No real
  renderer.
- **D3:** hand-author the **remaining** goldens (`fan-3`, `wide-fan`, `rollback-*`,
  `self-loop`, `showcase` × variants); operator approves the full golden set — the complete,
  human-approved spec of correct rendering.
- **D4:** build the real **model + occlusion renderer + forward layout**; forward scenarios'
  real output **== golden**; green-only-on-path green for forward.
- **D5:** **back-arcs**; rollback scenarios' real output == golden; revert-to-red on
  `rollback-cross:arc-1`.
- **D6:** cut every command onto the new pipeline; regenerate command snapshots (intentional
  tee→corner); delete the old `StructuralCell`/tee path.

The old path stays live and green until D6.

> **Acceptance is human-in-the-loop.** Goldens (D2/D3) and every real-pipeline dispatch (D4/D5)
> only advance after the operator runs `pnpm gallery` and approves the colour. The golden is
> hand-authored, so "real output == golden" is a real test, not "renders what it renders".

## Non-linear hand-offs

- **D2 → D3** — D3 authors the rest of the goldens in the same `{glyph,colour}` form D2 establishes.
- **D4 builds on D2 + D3** — the real forward pipeline is asserted against the D2/D3 goldens.
- **D5 builds on D4 + D3** — back-arcs matched against the rollback goldens.
- **D6 builds on D4 + D5 + D1** — cuts commands onto the new pipeline; regenerates the
  command-level (`graph-render.test.ts`) snapshots.

_(Dispatch entries below still describe the earlier renderer-first framing for D3–D5; they are
superseded by the order above and will be rewritten once D2 proves the oracle out. D2's entry
is authoritative.)_

---

### Dispatch 1 — Scenario harness + catalogue + gallery + verbatim snapshots (RED baseline)

- **Outcome:** The scenario catalogue (`spec.md § Scenario catalogue`) exists as data
  (each scenario: contracts + edges + mode + on-path set, in its named variants). A
  `renderScenario(name) → string` returns the **exact ANSI** output of **today's** renderer.
  `pnpm --filter @prisma-next/cli gallery [filter]` prints scenarios in colour to the
  terminal, filterable to one scenario/variant. A vitest file snapshots every
  scenario/variant verbatim, plus the one **green-only-on-path** invariant assertion. The
  baseline snapshots + that assertion **capture the current bleed as RED** on the
  `highlight-alt` and `rollback-cross` variants (the assertion fails today; document which
  variants are red). No renderer change.
- **Builds on:** the spec's verification surface + the design doc.
- **Hands to:** the executable verification surface every later dispatch is judged against,
  and a documented RED baseline (which variants bleed today) to turn green.
- **Focus:** the catalogue data; fixture contract-graph construction; the gallery script
  (filter arg, colour to terminal); the snapshot test; the green-only-on-path scanner. If
  today's renderer crashes or can't express a scenario (e.g. `rollback-cross`), capture that
  as the documented before-state, don't block. **Out:** any renderer/layout change.
- **Gate (binary):** `pnpm typecheck` green; `pnpm --filter @prisma-next/cli gallery` prints
  all scenarios in colour and `gallery <one>` filters to one; the snapshot test runs and the
  green-only-on-path assertion is **RED** on the named bleeding variants, green elsewhere;
  the operator has run `pnpm gallery` and confirmed it shows the current state.

### Dispatch 2 — Oracle foundation + lock-the-look goldens (AUTHORITATIVE entry)

- **Outcome:** A `Cell{glyph, colour}` type + a trivial `renderCells(cells) → string`
  (apply colour SGR per glyph, join rows) — the **only** logic the gallery runs; it does
  **not** call any real renderer/layout. The gallery is switched to serialise hand-authored
  `{glyph,colour}` arrays. **Hand-authored goldens** for the lock-the-look set —
  `linear`/`fork-2`/`merge-2`/`diamond` × {rotating, highlight-trunk, highlight-alt} — encode
  the design's corner language (no tees; `│─╯` rotating vs `╭─╯` highlighted; mode z-order).
  `pnpm --filter @prisma-next/cli gallery [filter]` shows them in colour, filterable. **No
  real renderer, no occlusion projection, no layout this dispatch.** The operator approves the
  corner scheme before anything is built to match it.
- **Builds on:** D1's topology catalogue + gallery script (the gallery's render path is
  swapped from today's-renderer to `renderCells`-over-goldens).
- **Hands to:** an **operator-approved** visual language as concrete `{glyph,colour}` goldens —
  the spec the real pipeline (D4) must reproduce.
- **Focus:** `Cell{glyph,colour}` + `renderCells`; the hand-authored golden arrays for the four
  scenarios × three variants; the gallery wiring + filter. Author an ergonomic format for the
  arrays (e.g. parallel glyph-rows + colour-map) but the canonical model is the 2D
  `{glyph,colour}` array. **Out:** the model `Grid`/`LineRef`/planes (D4); the occlusion
  renderer (D4); any topology/layout code; back-arcs (D5); commands (D6); the old path.
- **Gate (binary):** `pnpm typecheck` green; `pnpm --filter @prisma-next/cli gallery` serialises
  all four lock-the-look scenarios × three variants from hand-authored arrays in colour, and
  `gallery merge-2:alt` filters to one; the gallery runs **no real renderer** (verify:
  `renderCells` is its only render path); the **operator has run `pnpm gallery` and approved
  the corner scheme**; old path + D1 tests untouched.

### Dispatch 3 — New layout: forward DAG topologies → grid (real scenarios through the pipeline)

- **Outcome:** A new layout builds the `Grid` from real forward topologies — each edge a
  line carrying its `LineRef`, each contract a node, the **no-tee / 2-columns-per-lane**
  single-owner discipline, plane assignment (all forward = base), mode-dependent z-order.
  All forward scenarios (`linear`, `fork-2`, `merge-2`, `diamond`, `fan-3`, `wide-fan`,
  `self-loop`) now render through the **new layout+renderer** in the gallery — rotating,
  highlight-trunk, **and highlight-alt** all correct. The green-only-on-path assertion is
  **green** for every forward scenario. No back-arcs, no convergence. Old path untouched.
- **Builds on:** D2's renderer + grid types.
- **Hands to:** a colour-correct forward pipeline — every forward scenario's `highlight-alt`
  proven clean — for D4 to extend with back-arcs.
- **Focus:** the layout builder (reuse today's traversal + lane/column allocation —
  positioning was never the bug); corner routing; single-owner invariant. **Out:** back-arcs
  (D4); command cutover (D5).
- **Gate (binary):** `pnpm typecheck` green; layout unit tests green (every cell single-owner,
  right identity/directions/plane, both modes); the forward scenarios render correctly and
  the **operator has approved** their `pnpm gallery` colour incl. highlight-alt; green-only-
  on-path assertion green for forward scenarios; `pnpm --filter @prisma-next/cli test` green.

### Dispatch 4 — New layout: back-arcs on the upper plane (rollback scenarios)

- **Outcome:** The layout routes rollback / back edges as **upper-plane** continuous lines;
  where a back-arc crosses a forward vertical the **forward line clips**. The rollback
  scenarios (`rollback-adjacent`, `rollback-arc`, `rollback-merge`, `rollback-cross`) +
  their highlight variants render correctly in the gallery. The crux: `rollback-cross:arc-1`
  — the on-path back-arc stays coloured through the crossing while the off-path arc is grey;
  reverting the renderer makes the green-only-on-path assertion fail again (**revert-to-red
  demonstrated**). Per-arc lanes kept (convergence = geometry slice). Old path untouched.
- **Builds on:** D3's forward grid + single-owner invariant.
- **Hands to:** the complete new pipeline (forward + back-arcs), every scenario in the
  catalogue colour-correct — ready for the command cutover.
- **Focus:** back-arc plane assignment + forward-clip-at-crossing, on D3's builder. **Out:**
  convergence (geometry slice); command cutover (D5).
- **Gate (binary):** `pnpm typecheck` green; layout tests green over the rollback fixtures
  (back-arc on upper plane, crossed forward cell clips, single-owner holds); all rollback
  scenarios render correctly and the **operator has approved** their gallery colour;
  revert-to-red demonstrated on `rollback-cross:arc-1`; `pnpm --filter @prisma-next/cli test`
  green.

### Dispatch 5 — Cut all commands over + retire the old tee path

- **Outcome:** `migrate --show`, `graph`, `status`, `list` switch to the new layout+renderer.
  The command-level `graph-render.test.ts` snapshots are **regenerated** to the new corner
  rendering — the **intentional** tee→corner change — and visually reviewed. The old
  `StructuralCell` union, the render `switch`, the `migrationHash?` bolt-on, the
  `branchTee`/`mergeTee` glyphs, and the dead old layout are **deleted**. The whole gallery
  gets a final `pnpm gallery` sign-off.
- **Builds on:** D2's renderer + D3/D4's layout + D1's command snapshot context.
- **Hands to:** the slice-DoD — one line/plane pipeline serves every command; colour is
  correct-by-construction; the cell-kind switch is gone.
- **Focus:** wiring the four commands; regenerating + eyeballing the command snapshots;
  deleting the old path. **Out:** convergence + configurable geometry (geometry slice).
- **Gate (binary):** `pnpm typecheck` green; `pnpm --filter @prisma-next/cli test` green with
  regenerated `graph-render` snapshots; `rg "StructuralCell|cell\.kind|branchTee|mergeTee|migrationHash\?" packages/1-framework/3-tooling/cli/src/utils/formatters`
  returns **nothing**; operator signs off the final `pnpm gallery`.

---

## Dispatch-INVEST check

- **D1** — Independent (old path untouched), Valuable (builds the verification surface + the
  RED baseline), Testable (gallery runs; named variants are red), Small (catalogue + script +
  snapshot test). ✔
- **D2** — substrate + the dumb renderer, validated on hand-built grids; Small because no
  topology code; the operator-approval gate makes "the look is right" binary. ✔
- **D3** — the forward layout; its gate is the forward scenarios going colour-correct
  including the hard highlight-alt. ✔
- **D4** — surgical back-arc extension; the named crux (`rollback-cross:arc-1`) +
  revert-to-red is the testable gate. ✔
- **D5** — mechanical cutover + snapshot regen + dead-code deletion, with a grep gate. ✔

**Sizing verdict:** one coherent slice, one PR, five commits (≤ 10). The gallery makes every
dispatch's correctness **visible to the operator in colour**, which is the property the
earlier round-trips lacked. Five ≤ 10.

## References

- Spec: [`spec.md`](spec.md) (§ Verification surface, § Scenario catalogue)
- Design-of-record: [`../../design/graph-render-redesign.md`](../../design/graph-render-redesign.md)
- Sibling slice: [`../render-redesign-geometry/spec.md`](../render-redesign-geometry/spec.md)
- Renderer surface: `packages/1-framework/3-tooling/cli/src/utils/formatters/migration-graph-{layout,rows,tree-render,lane-colors}.ts`
- Old mockups (tee language, for reference): `projects/migration-graph-rendering/mockups.md`
