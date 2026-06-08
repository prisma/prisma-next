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
- **The single-owner invariant** — the layout guarantees **every cell is owned by
  exactly one line** (see § Planes: no tees + 2-col lanes). So a cell never needs more
  than one glyph can express, and never holds two differently-coloured lines.

**Render** is a **dumb projection** — no topology knowledge. Per cell:

1. Take the **topmost** line.
2. **Glyph** = box-drawing character from that line's directions (verticals + corners),
   with `○`/`∅` node markers and `↑ ↓ ⟲` arrows as overlays.
3. **Colour** = that line's colour (on-path / off-path; or the by-branch rotation in
   normal mode). Read straight off the owning line — never arbitrated.
4. Lower lines are **occluded** (clipped) — not drawn at this cell.

This makes the giant `switch` collapse to a direction→glyph lookup, and makes colour
**correct-by-construction**: exactly one owning line per cell, so a cell's colour is
never a compromise between two branches.

### Planes + z-order (the load-bearing decision)

A cell is a z-ordered stack of lines. **The topmost line in a cell is drawn; the rest
are occluded.** One rule governs **everything that overlaps**:

- **Crossings** — two lines pass through a cell: the top is drawn, the lower clips.
- **Merges / forks** — several lines meet at a node: the **top branch is drawn
  continuous; the others _yield_ beneath it** (each corners into its own connector
  cell). A merge is *not* a special junction — it is "one continuous line + N yielding
  corners", which scales to any number of parents/children.
- **Back-arcs** — see policy below.

**The single-owner invariant — this is what dissolves the colour problem: no cell is
ever owned by two lines.** Achieved by:

- **No tees.** The glyph alphabet is **verticals + corners + arrows + node markers** —
  never `├ ┬ ┼`. A tee is the *only* glyph that bundles a through-line with a branch in
  one cell; drop it and the bundling is gone. A fork/merge is the top line's continuous
  `│`/corner plus each other line's own corner.
- **2 columns per lane** — a **lane column** (a single-owner vertical) and a
  **connector column** (corners/horizontals, single-owner). Turns happen in the
  connector column, never crammed into the trunk's column. (Columns-per-lane is a
  configurable constant — see § Geometry.)

Because every cell has exactly one owner, **colour is read straight off that line** —
there is never a colour to arbitrate between two branches.

**Z-order assignment is mode-dependent — the only thing that differs between modes:**

- **Normal (multi-colour) mode → trunk on top.** The main lane stays an unbroken `│`;
  later parents corner in beneath it (`│─╮─╮…`). Compact, git-log-style.
- **Highlighted (`migrate --show`) mode → the on-path branch on top.** The chosen path
  is lifted above everything and drawn as one continuous prominent line sweeping the
  merge (`╰───╮`) — literally "the route the runner takes" — while off-path branches
  yield beneath it, each owning its own (grey) corner cells.

**Back-arc policy:**

- **Forward DAG lines = base plane; back-arcs (rollbacks) = upper plane, drawn
  continuous.** Where a back-arc crosses a forward vertical the **forward line clips**
  and the back-arc runs through; colour is orthogonal (grey when off-path).
- **Back-arc convergence:** back-arcs landing on the **same target node share one
  back-lane** — narrower, truer, fewer crossings.

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

- ~~Within-plane junction colour when a branch splits on-path/off-path.~~ **Resolved
  by the design itself:** the no-tee / 2-col-lane / single-owner rule means a junction
  is never one shared cell — the top branch is a continuous line, each other branch owns
  its own corner cell, so there is no colour to arbitrate. The choice of *which* branch
  is on top is the mode-dependent z-order (trunk-on-top normal / on-path-on-top
  highlighted), not a colour rule.
- **Default columns-per-lane** value and the full set of geometry parameters to expose.

## Relationship to the current code

- Likely **reusable**: the traversal (which nodes/edges, row order) and the lane/column
  allocation — positioning was never the bug.
- **Rewritten**: the cell representation (→ ordered lines with directions + plane), the
  plane-assignment + back-arc convergence logic (new, in the layout), and the renderer
  (→ occlusion box-char projection). The 14 cell-kinds + the render `switch` + the
  `migrationHash?` bolt-on are retired.
