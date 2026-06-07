# Slice: graph-render redesign — colour-correct line/plane pipeline

_Parent project `projects/migration-graph-rendering/`. Outcome: the Tier-3 renderer becomes a dumb projection over a line/plane data model, so graph colouring is correct-by-construction (no bleed) and the cell-kind switch is gone._

> **Design-of-record:** [`../../design/graph-render-redesign.md`](../../design/graph-render-redesign.md). This spec is **execution only** — it does not restate the model; read the design doc for the *what* and *why*. This slice implements the core (data model + planes + occlusion render); back-arc **convergence** and **configurable geometry** are the sibling slice `render-redesign-geometry`.

## At a glance

Replace the position-keyed `StructuralCell` grid + the `switch (cell.kind)` renderer with the design doc's model: lines carry identity, the layout assigns **planes** (forward = base, back-arcs = upper, continuous), and the renderer **occludes** (topmost plane wins per cell → box-char glyph + that line's colour). This kills the colour-bleed class of bugs at the source.

## Chosen design

Per the design doc. In scope for this slice:
- New data structures: `LineRef` / `CellLine` (directions + plane) / `Cell` / `Grid` (or the final names settled during build).
- Layout produces the new grid + **plane assignment** (forward DAG = base plane; each back-arc = upper plane, drawn continuous; forward verticals clip at crossings). **No convergence yet** — keep today's per-arc lanes (that's slice 2).
- Renderer = occlusion projection: topmost plane → `boxChar(union of its directions)` + colour from the winning line (on-path > off-path priority at same-plane junctions; by-branch rotation in normal mode); node/arrow overlays; lower planes clipped.
- Retire the 14 `StructuralCell` kinds, the render `switch`, and the per-cell `migrationHash?` bolt-on.
- **Single-owner glyph discipline (the core invariant):** the glyph alphabet is **verticals + corners + arrows + node markers — no tees (`├ ┬ ┼`)**; with 2 columns per lane, every cell is owned by exactly one line, so colour is read straight off it (never arbitrated). Merges/forks render as the **top branch continuous + the others yielding into their own corner cells**; **z-order is mode-dependent** — trunk-on-top in normal mode (`│─╮─╮`), on-path-branch-on-top in highlighted mode (`╰───╮`, the path sweeps over as one continuous line).
- **Out:** back-arc convergence; extracting geometry constants to parameters (both → `render-redesign-geometry`). Keep current geometry/spacing as-is.

## Coherence rationale

The layout's output type and the renderer that consumes it change together — they share the data-structure boundary, so they cannot land in separate PRs without breaking the consumer. One reviewer holds "lines + planes + occlusion projection" as a single change; every existing render test is the safety net.

## Test-first discipline (mandatory — this is the point of the slice)

Author tests **before** the implementation, in this order, and **prove they go red against the current code first** (revert-to-red check), then implement to green:
1. **Capture current failures as RED.** Extend `migration-graph-colour-matrix.test.ts` so every *currently-wrong* case is a failing test against today's renderer — at minimum the residual on-path-trunk-continuity (Y) and the off-path back-arc/crossing bleed on the showcase `@db→prod` path. Confirm red on `main`/current HEAD.
2. **Layout tests** — over the new grid: each routing cell carries the right line identity + directions + plane; back-arc on the upper plane; the single-glyph invariant holds (no cell needs two glyphs). Fixtures from the design doc's topology set (straight line · 2 branches · branch+rollback · diamond · rollback-on-path · loop-via-invariant · showcase).
3. **Renderer tests** — over a hand-built grid: occlusion (topmost plane drawn, lower clipped); glyph = box-char from directions; colour = winning line; force-colour ANSI assertions via the existing `forcedGreen`/`forcedDim` seam + a per-glyph colour-walk helper.
4. **Combined (layout→render) tests** — the colour matrix × {normal rotation, path-highlight on trunk, on alternate branch}, asserting **no off-path cell is ever green** and the on-path line is continuous except where an upper-plane back-arc legitimately clips it.

## Slice-specific done conditions

- [ ] The captured-failure tests (Y + showcase bleed) are RED against current code and GREEN after this slice — verified by the revert-to-red check (revert the new renderer, the colour tests fail; restore, they pass).
- [ ] Force-render of the real showcase `@db→prod` path shows **zero** off-path green and no rotation colour on a path-highlighted graph (the ground-truth check we used in PR #735).
- [ ] The old `StructuralCell` kinds, the render `switch`, and the `migrationHash?` bolt-on no longer exist.
- [ ] Normal-mode (`graph`/`status`/`list`) rendering is unchanged — existing snapshots byte-identical.

## Open Questions

None. (The within-plane junction-colour question is dissolved by the no-tee / single-owner discipline — see § Chosen design and the design doc. Default columns-per-lane is settled in the `render-redesign-geometry` slice.)

## References

- Design: [`../../design/graph-render-redesign.md`](../../design/graph-render-redesign.md)
- Sibling slice: `../render-redesign-geometry/` (convergence + configurable geometry)
- Current tests to evolve: `cli/test/utils/formatters/migration-graph-colour-matrix.test.ts`, `…/migration-graph-cell-identity.test.ts`
