# Design: migration-graph layout + render redesign

> **Design-of-record** for rebuilding the Tier-3 migration-graph renderer
> (`cli/src/utils/formatters/migration-graph-{layout,rows,tree-render,lane-colors}.ts`).
> This document is the **architecture** — the data structures and the rules. It is
> deliberately **independent of execution**: the slices that build it
> (`slices/render-redesign-*`) reference this doc; they do not redefine it.
> Settled in design discussion (architect + principal-engineer), 2026-06.

## Why redesign

The renderer works but is unmaintainable, and its colouring has been a long tail of
bleed bugs. The root cause is a **data-structure mismatch**:

- **Colour is a property of a _line_** (an edge's routed path — its on/off-path role).
- The current grid stores **positions**: a row×column grid of `StructuralCell`s keyed
  by lane/column. A lane is freed and **reused** by a different edge further down its
  length, so the renderer must **reverse-engineer "which edge owns this cell"** from
  position. That reverse-engineering is the source of every colour bug.

Two concrete smells confirm it:

1. The 14-variant `StructuralCell` union (`vertical-pass` / `branch-tee` /
   `merge-corner` / `arc-crossing` / …) **is the set of glyph shapes**, and the
   renderer is a `switch (cell.kind)` that looks up `palette[kind]`. The layout
   pre-bakes the glyph; the renderer re-walks it.
2. Every cell variant carries an **optional `migrationHash?`** — bolted on late to
   recover line identity the structure never modelled. Identity was never first-class.

Every bug we fixed was **mis-attribution** (which line owns a cell), never
**mis-positioning** (the lines always went to the right cells). So the expensive
traversal + lane allocation is sound; the cell representation and the render are wrong.

## The model

**A _line_ is the primitive, not a cell.** Each migration edge becomes a routed line
that carries its own identity (the migration, and its on/off-path role). Each contract
becomes a node. Colour is asked of a line, never inferred from a position.

### Phases

**Layout** routes lines on a grid and is the only place geometry/topology decisions
live. It owns:

- **Ownership** — each line ↔ a migration; each node ↔ a contract (or the empty
  state). Identity travels with the line.
- **Overlap** — a cell holds an **ordered (z) set of lines present**, each with its
  **local directions** (which of up/down/left/right it occupies in that cell).
- **Planes (z-order)** — see below; the layout assigns them.
- **The single-glyph invariant** — the layout guarantees no cell ever needs to express
  more than one glyph can (a junction and a crossing never collide in one cell).

**Render** is a **dumb projection** — no topology knowledge. Per cell:

1. Take the **topmost plane's** line(s).
2. **Glyph** = box-drawing character looked up from the union of *that plane's*
   directions (the 16 up/down/left/right combinations), with `○`/`∅` node markers and
   `↑ ↓ ⟲` arrows as overlays.
3. **Colour** = that line's colour (on-path / off-path; or the by-branch rotation in
   normal mode). Among same-plane lines that connect at a junction, pick by priority
   (on-path wins).
4. Lower planes are **occluded** (clipped) — not drawn at this cell.

This makes the giant `switch` collapse to a direction→glyph lookup, and makes colour
**correct-by-construction**: exactly one owning line per cell, so a cell's colour is
never a compromise between two branches.

### Planes (the load-bearing decision)

A cell is a z-ordered stack of lines. **Same-plane lines that meet _connect_** (a
junction — their directions combine into `├ ┬ ╮ ┴ ┼`). **Different-plane lines _do
not_ connect** — the topmost is drawn and the others are occluded (a crossing). This
single rule replaces the `merge-*` vs `arc-*` cell-kind distinction.

**Policy:**

- **Forward DAG lines = base plane.** They interconnect via real junctions.
- **Back-arcs (rollbacks) = upper plane, drawn continuous.** They are rare
  out-of-plane exceptions; where a back-arc crosses a forward vertical, the **forward
  line clips** (a small break) and the back-arc runs through. Colour stays orthogonal —
  a back-arc is a continuous line in *its own* colour (grey when off-path).
- **Back-arc convergence:** back-arcs that land on the **same target node share one
  back-lane** (sources tee in, one landing). Narrower output, truer topology, and fewer
  crossings — so the clip-vs-continuous choice bites less often.

### Geometry is configurable

Columns-per-lane and similar spacing constants must be **named parameters**, not
values hard-coded across the layout and render. Changing "3 columns per lane" must not
require rewriting the renderer.

### Data-structure sketch (illustrative, not final)

```
type Direction = 'up' | 'down' | 'left' | 'right';

interface LineRef {            // identity, carried into every cell the line touches
  readonly migrationHash: string;
  readonly role: PathRole;     // 'on-path' | 'off-path' | undefined (normal mode)
  // (branch/lane identity for the normal-mode rotation colour)
}

interface CellLine {           // one line's presence in one cell
  readonly line: LineRef;
  readonly directions: ReadonlySet<Direction>;  // which arms it occupies here
  readonly plane: number;      // z-order; higher = drawn on top
}

interface Cell {
  readonly node?: NodeRef;                 // contract marker, if any (never overlaps)
  readonly lines: readonly CellLine[];     // ordered set of lines present
}

type Grid = readonly (readonly Cell[])[];  // rows × columns
```

Render per cell: pick `max plane`; `glyph = boxChar(union of that plane's directions)`;
`colour = colourOf(that plane's winning line)`; node/arrow overlays last.

## Rationale (the durable why)

- **Correct-by-construction colour.** Identity is first-class and travels with the
  line; the render never reverse-engineers ownership, so it cannot bleed.
- **The renderer becomes trivial.** Glyph = lookup, colour = the line's colour. No
  cell-kind switch, no per-cell hash recovery.
- **Crossings vs junctions are one rule** (same plane connects, different plane
  occludes) instead of a dozen `arc-*`/`merge-*` cell kinds.
- **Unambiguous colour is the goal**, which is why occlusion beats glyph-union: one
  owner per cell means the colour always honestly belongs to a single branch.

## Alternatives rejected

- **Model A — glyph = union of directions, colour = priority** (crossings render as a
  combined `┼` coloured by the winner). Keeps both lines traceable through a crossing,
  but every crossing cell's colour necessarily **misrepresents one of its two lines** (a
  green `┼` sitting in a grey arc). Rejected: unambiguous colour is the whole point.
- **Back-arcs in ever-higher unique planes.** Would let arcs never collide, but
  **prevents convergence** (arcs to one target couldn't share a lane). Rejected in
  favour of convergence + a single upper plane.
- **Per-cell `migrationHash` bolt-on (the current patch).** Recovers identity after the
  fact instead of modelling it. It is the symptom we are removing.

## Open questions (settle at spec time)

- **Within-plane junction colour** when a branch splits on-path/off-path: a `├` whose
  spine is on-path and whose branch is off-path is one same-plane junction — confirm
  the priority (on-path wins the cell's colour) and that this reads correctly.
- **Default columns-per-lane** value and the full set of geometry parameters to expose.

## Relationship to the current code

- Likely **reusable**: the traversal (which nodes/edges, row order) and the lane/column
  allocation — positioning was never the bug.
- **Rewritten**: the cell representation (→ ordered lines with directions + plane), the
  plane-assignment + back-arc convergence logic (new, in the layout), and the renderer
  (→ occlusion box-char projection). The 14 cell-kinds + the render `switch` + the
  `migrationHash?` bolt-on are retired.
