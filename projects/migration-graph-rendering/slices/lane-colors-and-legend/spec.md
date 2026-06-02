# Slice: colored lanes + `--legend` for `migration graph` (tree renderer)

_Parent project `projects/migration-graph-rendering/`. Outcome this slice contributes to the project's purpose: the condensed Tier-3 tree gains a readable, `git log --graph`-style colored gutter and an opt-in `--legend` key, making multi-lane topologies (diamonds, fans, routed back-arcs) scannable at a glance._

## At a glance

Two presentation changes to `migration graph`'s tree renderer (`cli/src/utils/formatters/migration-graph-tree-render.ts`):

1. **Colored lanes.** Each lane/spine/arc column renders in a distinct, rotating color (by column index, git-style) instead of the single uniform `dim` it uses today — so adjacent lanes are visually separable.
2. **`--legend`.** A new flag on `migration graph` prints a key (glyphs + their meanings + the lane-color cycle), honoring the active glyph palette (`--ascii`) and color state.

Both apply only to the `--tree` renderer; `--json` / `--dot` / the legacy dagre default and `migration status` are untouched.

## Chosen design

### Colored lanes

Today every structural cell (lanes `│`, branch/merge spine `├ ─ ╮ ┴ ┬`, routed arcs, crossings) is rendered through a single styler function, `style.lane(text)`, which is `dim()` — one flat treatment for the whole gutter:

```44:51:packages/1-framework/3-tooling/cli/src/utils/formatters/migration-list-styler.ts
    kind: (text) => text,
    dirName: (text) => bold(text),
    sourceHash: (text) => dim(cyan(text)),
    destHash: (text) => cyanBright(text),
    glyph: (text) => dim(text),
    lane: (text) => dim(text),
```

The lane's **column** is already known at render time: cells are positioned by index in `row.cells`, and the renderer walks them by index in `renderCellPair` / `renderConnectorRow`. So coloring is a localized renderer change — **no layout-model change**.

- **Color vertical lanes by column index** (a rotating palette over `colorette` hues), like `git log --graph`. A lane that is freed and reused at a later row keeps its column's color; we do **not** track per-branch identity for vertical lanes (materially more complex for no readability gain on the lanes that already read cleanly).
- **The leftmost lane (column 0) stays uncolored** — it renders with the default neutral/dim lane style, and the palette rotates over columns ≥ 1. In the single-lane linear case there is nothing to distinguish column 0 *from*, so coloring it is noise; the common linear graph then reads as clean (effectively monochrome), and color appears only once a second lane exists to need telling apart.
- **Color each routed back-arc as a single hue across its whole path** (the one exception to column-coloring). A node-skipping rollback is one logical line that runs horizontally across several columns to reach its landing node; coloring its bridge cells by the column they pass through shreds one arc into a "rainbow" of per-column colors, defeating the point of color (tracing one connection). Instead, the arc's owned cells — its vertical back-lane, horizontal bridges (`arc-land-bridge` / the arc's `horizontal-pass`), branch/land corners (`arc-branch-*` / `arc-land-*`), and the `◂` landing — all take the **arc's owning-lane color** (its back-lane column), so the arc reads as one line. This matches how `git log --graph` colors a *line*, not a static column. Crossings (`┼`, where two arcs overlap) stay dim/neutral so neither arc "steals" the cell.
- **The contract node glyph (`○`) is colored by its lane** (the column the node sits in), so each node visibly belongs to its branch — like `git log --graph` coloring the commit dot by its lane. The same column-0-neutral rule applies (a node in column 0 stays neutral). **Direction arrows (`↑ ↓ ⟲`) stay bright** — they remain the "signal" (they encode *direction*, not branch identity), so the arrow still pops against the colored gutter. In the node-marker arc pairs (`○◂` / `○─`), the `○` half takes the node's lane color while the connector half follows the arc-coloring rule below.
- The data columns (`dirName`, `from → to` hashes, `(refs)` overlay) are unchanged.
- **Alignment is preserved by construction:** coloring wraps a glyph in ANSI SGR codes without changing its visible width, and the renderer already pads with raw spaces *outside* styled tokens. Existing plain-text goldens are unaffected because color is off whenever `colorize` is false (`--no-color`, `NO_COLOR`, non-TTY, piped) — the identity styler emits zero ANSI bytes.

Mechanism: introduce a per-column lane-color selector (column → `colorette` color fn) inside the tree renderer, applied on top of / in place of `style.lane` for structural cells when `colorize` is true. Exact palette and the column→color wiring are implementer discovery; a 6-hue rotating cycle is the natural shape (hue overlap with the green `(refs)` / cyan hashes is acceptable — they are different tokens in different columns, and git reuses hues across lanes too).

### `--legend`

Add a `--legend` boolean option to `createMigrationGraphCommand`. When set (and not `--json` / `--dot` / `--quiet`), render a legend block that explains the tree's visual language, honoring the active glyph palette (unicode vs `--ascii`) and `colorize`:

- `○` contract node · `↑` forward · `↓` rollback · `⟲` self · `∅` empty/root
- `→` direction in the `from → to` data column
- `(refs)` node overlay, incl. the reserved `db` (live DB) and `contract` (working-schema) markers
- the rotating lane-color cycle (shown only when `colorize` is true)

**Placement: stderr**, alongside the existing command header (`ui.stderr(header)` in the command), so stdout stays pure graph output and `migration graph --tree | …` pipes cleanly. **Gating: `--legend` implies `--tree`** — if passed without `--tree`, auto-enable the tree path (the legend describes the tree's language; it has nothing to say about the legacy dagre default that's being retired in TML-2748).

Worked example (`migration graph --tree --legend`, color elided):

```
Legend:
  ○  contract node       ↑  forward      ↓  rollback     ⟲  self
  ∅  empty / root        →  from → to    (refs)          db / contract markers
  lanes: colored by column

○   a94b7b4              (main, contract)
│↑  add_posts            ef9de27 → a94b7b4
○   ef9de27              (db, prod)
│↑  init                 ∅       → ef9de27
○   ∅
```

## Coherence rationale

One reviewer holds this in one sitting: both changes are presentation-only edits to a single module (`migration-graph-tree-render.ts`) plus a one-flag addition in `migration-graph.ts`, behind unchanged layout, `--json`/`--dot`, and plain-text output. They share the same surface (the tree's glyph rendering) and the same guard (`colorize` / glyph palette), and roll back as one unit. Splitting colors from legend would mean two PRs touching the same two files for one coherent "make the tree readable" outcome.

## Scope

**In:**

- Per-column lane coloring in `migration-graph-tree-render.ts` (`renderCellPair`, `renderConnectorRow`, and a new column→color selector), gated on `colorize`.
- `--legend` option in `migration-graph.ts` + a legend renderer (palette-aware, color-aware), printed to stderr; `--legend` auto-enables the tree path.
- Colorized + legend test coverage in `migration-graph-tree-render.test.ts` (and command-level coverage for `--legend` / `--legend` implying `--tree`).
- A note in `projects/migration-graph-rendering/mockups.md` recording the colored-lane extension to the locked visual language (the mockups currently lock a monochrome dim gutter; this slice extends it).
- Updating the reference doc `docs/reference/migration-graph-rendering.md` (if present) and `migration graph --help` examples to mention `--legend`.

**Out:**

- The layout/grid model (`migration-graph-layout.ts`, `migration-graph-rows.ts`) — untouched; column positions already carry everything coloring needs.
- `--json` / `--dot` output — frozen.
- The legacy dagre default renderer and `migration status` — TML-2748, independent.
- Per-branch (identity-tracked) coloring of **vertical lanes** — rejected in favor of git-style column coloring. (Routed back-arcs are the one exception: colored as a single line by owning lane — see Chosen design.)
- Coloring **direction arrows** (`↑ ↓ ⟲`) — they stay bright as the signal. (Node markers `○` ARE colored by their lane — see Chosen design.)
- Making `--tree` the default — that is TML-2748.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `--no-color` / `NO_COLOR` / non-TTY / piped | No lane colors; legend prints plain | `colorize` already short-circuits to the identity styler (zero ANSI); coloring and the legend's color key both gate on it. Keeps existing plain-text goldens byte-identical. |
| `--ascii` | Legend uses the ASCII palette (`* ^ v @` …); lane colors still apply | Color (ANSI SGR) is orthogonal to glyph mode; the legend must read from the same `paletteFor(glyphMode)` the renderer uses, not hard-code unicode. |
| Lane freed and reused by a later branch | Keeps its column's color (no per-branch tracking) | Matches `git log --graph`; the simplest stable rule and avoids touching the layout model. |
| Routed back-arc spanning multiple columns | Colored as one hue (owning back-lane) across vertical + horizontal segments | Column-coloring the horizontal bridges produces a "rainbow serpent" that fragments one arc; per-arc coloring keeps it traceable. Crossings stay dim/neutral. |
| Column color clashing with green `(refs)` / cyan hashes | Acceptable | Different tokens, different columns; git reuses hues across lanes. Implementer picks a legible cycle. |

## Slice-specific done conditions

- [ ] Colorized goldens for a multi-lane fixture (diamond / 3-way fan / routed back-arc) assert lane color rotates by column, and `migration graph --tree --legend` (unicode + `--ascii`, color on + off) is snapshot-covered; the existing plain-text (`colorize: false`) tree goldens remain byte-identical.

## Open Questions

1. Exact lane-color cycle (which hues, how many). Working position: a 6-hue rotating `colorette` cycle, implementer's choice, tuned for legibility on both light and dark terminals; recorded in the mockups note.
2. Legend layout (compact multi-column block vs one glyph per line). Working position: a compact 2–3-line block as in the worked example above; refine to taste during implementation.

## References

- Parent project: `projects/migration-graph-rendering/spec.md` (Tier-3 redesign — this slice polishes its output).
- Locked visual language: `projects/migration-graph-rendering/mockups.md` (monochrome gutter today; this slice extends it with color — update the mockups note).
- Surfaces that change: `cli/src/utils/formatters/migration-graph-tree-render.ts` (lane color + legend), `cli/src/commands/migration-graph.ts` (`--legend`), `cli/test/utils/formatters/migration-graph-tree-render.test.ts` (coverage), `docs/reference/migration-graph-rendering.md` (doc).
- Surfaces protected: `migration-graph-layout.ts` / `migration-graph-rows.ts` (layout), `--json`/`--dot`, dagre renderer + `migration status` (TML-2748).
- Linear issue: [TML-2773](https://linear.app/prisma-company/issue/TML-2773) (related to TML-2746; sequenced independently of TML-2748).

## Dispatch plan

### Dispatch 1: per-column lane coloring in the tree renderer

- **Outcome:** `migration graph --tree` renders lanes / spine / arcs colored by column (rotating palette) when color is on; node markers and direction arrows stay bright; plain-text (`colorize: false`) output is byte-identical to today. A column→color selector is added to `migration-graph-tree-render.ts` and threaded through `renderCellPair` / `renderConnectorRow`. Colorized goldens over a multi-lane fixture assert rotation by column.
- **Builds on:** This spec; the existing grid model (cells already positioned by column index) and the `colorize` guard.
- **Hands to:** A tree renderer whose gutter is per-column colored behind `colorize`, with the column→color selector available for the legend to reuse. Plain goldens green.
- **Focus:** Lane coloring only. The `--legend` flag is dispatch 2.

### Dispatch 2: `--legend` flag + legend renderer

- **Outcome:** `migration graph --legend` prints a palette-aware, color-aware legend to stderr and auto-enables the tree path; reuses dispatch 1's column→color selector for the lane-color key. `--help` examples and the reference doc mention `--legend`; the mockups note records the colored-lane extension. Snapshot coverage for the legend (unicode + `--ascii`, color on/off).
- **Builds on:** Dispatch 1's renderer + column→color selector.
- **Hands to:** Legend + flag landed; colorized + legend goldens green; plain-text goldens unchanged; `--json`/`--dot` + `migration status` regression-green.
- **Focus:** Flag + legend block + docs. No change to lane-color mechanics.

### Dispatch 3: lane-color refinements — per-arc single hue + uncolored leftmost lane

Two refinements to dispatch 1's lane-color selector, in one dispatch (same file, one review):

1. **Per-arc single hue.** Routed back-arcs (node-skipping rollbacks) render in a single hue (their owning back-lane color) across the whole arc — vertical back-lane, horizontal bridges, corners, and `◂` landing — instead of each cell taking its pass-through column color (which produced the "rainbow serpent" on horizontal runs). Crossings stay dim/neutral.
2. **Uncolored leftmost lane.** Column 0 renders with the default neutral/dim lane style; the palette rotates over columns ≥ 1. The single-lane linear case is then effectively monochrome.
3. **Node glyph colored by its lane.** The contract node `○` takes its column's lane color (column-0-neutral rule applies), so each node belongs to its branch. Direction arrows (`↑ ↓ ⟲`) stay bright. In the `○◂` / `○─` arc pairs, the `○` half takes the node's lane color and the connector half follows the per-arc rule.

- **Outcome:** All three rules land in the lane-color selector / `renderNodeMarkerPair`. Vertical lanes + node glyphs at column ≥ 1 take their column hue; column 0 is neutral; routed arcs are one hue per arc; direction arrows stay bright. Colorized goldens assert (a) a single-lane linear fixture has a neutral column-0 gutter and node, (b) a routed-arc / kitchen-sink fixture's arc cells share one color, and (c) a multi-lane node `○` matches its lane color while the arrow stays bright.
- **Builds on:** Dispatch 1's lane-color selector (`migration-graph-lane-colors.ts`) + `renderNodeMarkerPair` + the arc-routing cell kinds (`arc-land-bridge`, `arc-*-corner`, `arc-branch-tee`, `arc-crossing`, the arc's `horizontal-pass`), and dispatch 2 (same file). Update the D1 colorized rotation tests for the new column-0 / column-≥1 indexing.
- **Hands to:** Slice-DoD: routed arcs are monochrome-per-arc; the leftmost lane + its node are neutral; node glyphs at column ≥ 1 match their lane; arrows stay bright; all plain-text goldens stay byte-identical; colorized + legend goldens green; `--json`/`--dot` + `migration status` regression-green.
- **Focus:** Lane-color selector + node-glyph coloring. No layout-model change.
