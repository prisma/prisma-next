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

## Verification surface: the scenario gallery is a hand-authored oracle

The gallery is an **independent oracle** — it **never invokes the real renderer or layout**. Each scenario/variant's expected output is a **hand-authored 2D array of `{glyph, colour}` cells** (the picture we want). A trivial `renderCells(cells) → string` serialises that array — applies the colour SGR to each glyph, joins rows — and **that is the only logic the gallery runs**. This is what makes the test non-tautological: the expected output is authored by hand, independent of the code under test.

Three roles:

- **Visual check (acceptance gate).** `pnpm --filter @prisma-next/cli gallery [filter]` serialises the hand-authored arrays to the terminal **in colour** (`FORCE_COLOR`), each under a labelled header, filterable to one `scenario:variant`. A human approves the picture by eye.
- **Golden fixture.** The serialised string of the **approved** array is the golden. The **real** pipeline (topology → layout → grid → occlusion renderer → string) is asserted, per scenario, to equal its golden. The hand-authored array is committed as the fixture; it changes only when a human re-approves via `pnpm gallery`, never a blind snapshot `--update`.
- **Documentation.** The catalogue + the hand-authored pictures are the doc.

On top of the per-scenario golden match, **one targeted invariant** over the real output: the green SGR code appears **only inside on-path spans** (scenario-independent; the bug class we keep reintroducing). Its dual — every on-path cell is coloured, no grey gaps on the route — lands with the renderer rebuild (D3/D4).

### Each scenario carries its explicit input — the golden is `render(input)`

A golden is not a floating picture; it is the expected output **for a specific input graph**. Each scenario carries that input so the thing the human reasons from is exactly the thing the real pipeline (D4) is fed — the test is `render(input) === golden`.

```ts
input: {
  contracts: ['∅', 'root', 'trunk', 'alt'],            // contract hashes (identifiers only)
  migrations: [                                         // edges, from → to
    { name: '000_init',          from: '∅',    to: 'root'  },
    { name: '001_trunk_feature', from: 'root', to: 'trunk' },
    { name: '002_alt_feature',   from: 'root', to: 'alt'   },
  ],
},
from: '∅',                                              // focus variants: migrate --from (path origin / current DB state)
to:   'alt',                                            // focus variants: migrate --to   (path destination)
onPath: ['000_init', '002_alt_feature'],                // focus variants: the highlighted route's migrations (derivable from from/to)
```

- **Ordering is determined by migrations, not contract hashes.** Every migration name carries a **3-digit prefix** (`000_`, `001_`, …) that stands in for a timestamp; lexicographic order of the prefixed name **is** chronological order. The layout orders by migration order; contract-hash lex order is **not** an input to layout. (Real contract hashes are sha256 — lexically arbitrary — so hash order would be meaningless.)
- **Migration-name labels are display-only.** They render in the gallery for human readability but are **stripped from the `render(input) === golden` comparison** (the assertion is structure + colour, not label text or its alignment).
- **`from` / `to` are the `migrate --from` / `--to` contracts** — the path's origin (current DB state) and destination. A focus variant *is* a `migrate --from X --to Y`; the highlighted path is what `migrate` computes between them. So focus variants must have **distinct `from`/`to`** to be distinct real invocations (e.g. a fan/diamond whose variants all share `∅ → merge` collapse to one real `migrate` — only one route is the computed path).
- `onPath` lists the migration names on the highlighted route (empty for `flat`); it is the expected result of computing the path from `from` to `to`.

### Golden rows separate structure from identity — the label is looked up, never hand-drawn

A golden row hand-authors **only the structural graph** (lanes, connectors, arrows, node markers) and **which migration/contract that row is** — never the label text, its alignment, or its colour. The renderer looks the name up in `input` and prints it. This keeps every bit of label alignment/formatting/colour logic out of the goldens, while still pinning which line maps to which migration/contract for test expectations.

```ts
const fork2Flat = parseGrid([
  ['○',     'trunk',              'd'   ],   // node row:      [glyphs, contract, colours]
  ['│↑',    '001_trunk_feature',  'dd'  ],   // migration row: [glyphs, migration, colours]
  ['│ ○',   'alt',                'd.1' ],
  ['│ │↑',  '002_alt_feature',    'd.1d'],
  ['│─╯ ',                        'd11.'],   // connector row: [glyphs, colours]  (no identity)
  ['○',     'root',               'd'   ],
  ['│↑',    '000_init',           'dd'  ],
  ['○',     '∅',                  'd'   ],
]);
```

- A row is `[glyphs, name, colours]` when it carries a contract or migration; `[glyphs, colours]` for a pure connector row.
- **`glyphs`** = structural characters only (`│ ╭ ╮ ╰ ╯ ─ ↑ ↓ ⟲ ○ ∅` + spaces) — no label text baked in.
- **`colours`** = one code per glyph character (`colours.length === glyphs.length`); the old "last code covers the label" rule is gone.
- **`name`** must exist in the scenario's `input` (contract hash or migration name) — `renderCells` looks it up and prints the label; an unknown name is an authoring error (a free consistency check between golden and input).
- The looked-up label is **gallery display only**; the `render(input) === golden` assertion compares structure + colour, and uses `name` to verify which migration/contract the real renderer placed on each row.

**RED/GREEN.** The real pipeline starts on today's renderer, whose output ≠ the goldens (the current bleed) ⇒ RED. After the rebuild, real output == golden ⇒ GREEN; reverting the new renderer must break the match again. The hand-authored goldens are the spec of correct rendering; the human verifies them by eye via the gallery; the implementation must reproduce them.

### Scenario catalogue (locked) — three-level: `scenario : strategy : variant`

A golden is identified by three axes. **Strategy** is a first-class axis because it decides **z-order and the colour rule**, not just appearance:

- **`flat`** — no chosen path. Every lane is a peer; colour **rotates by lane, numbered from 1** (lane 0 = colour `1`, lane 1 = `2`, …) — **no dim**; the **trunk stays on top** at merges/forks (`│─╯`). **Exactly one golden per scenario** (no variants). Edge cases — convergence, multiple lanes — arise from the topology itself, so no variants are needed.
- **`focus`** — one chosen path. The path is **lifted on top and drawn as one continuous line**; **colour follows the route, not the column** — the on-path line owns *every* cell it passes through, drawn green and continuous, **occluding** whatever it crosses; off-path lanes yield beneath it, dim. **Many variants per scenario**, each highlighting a **different path** (this is where the hard logic lives, so variants are deliberately chosen to traverse distinct routes).

Identifier / filter syntax: `scenario` · `scenario:strategy` · `scenario:strategy:variant` (e.g. `merge-2:flat`, `merge-2:focus:alt`).

| Scenario | `flat` | `focus` variants (each a distinct highlighted path) |
|---|---|---|
| `linear` | ✓ | `full` |
| `fork-2` | ✓ | `trunk`, `alt` |
| `merge-2` | ✓ | `trunk`, `alt` |
| `diamond` | ✓ | `trunk`, `alt` |
| `fan-3` | ✓ | `trunk`, `altA`, `altB` |
| `wide-fan` | ✓ | `trunk`, `alt` |
| `rollback-adjacent` | ✓ | `forward`, `through-rollback` |
| `rollback-arc` | ✓ | `trunk`, `through-arc` |
| `rollback-merge` (two rollbacks landing on the same node) | ✓ | `via-A`, `via-B` |
| `rollback-cross` (one back-arc crossing another) | ✓ | `arc-1`, `arc-2` |
| `self-loop` | ✓ | `through-loop` |

`rollback-merge` renders as two separate back-lanes in this slice; convergence into one lane is the `render-redesign-geometry` slice.

## Slice-specific done conditions

- [ ] The captured-failure cases (the `focus:alt` highlight variants + `rollback-cross:focus:arc-1`) are RED against current code and GREEN after this slice — verified by the revert-to-red check (revert the new renderer, the colour tests fail; restore, they pass).
- [ ] `render(input) === golden` holds for every catalogue scenario, and the green-only-on-path invariant shows **zero** off-path green on every `focus` variant (the ground-truth check).
- [ ] The old `StructuralCell` kinds, the render `switch`, and the `migrationHash?` bolt-on no longer exist.
- [ ] Normal-mode (`graph`/`status`/`list`) rendering changes **intentionally**: the single-owner discipline replaces tees (`├`/`branchTee`/`mergeTee`) with corners, so the trunk stays a continuous `│` and parents corner in beneath it (`│─╮─╮`). The `graph-render.test.ts` snapshots are **regenerated** and the new corner rendering is visually reviewed. (Byte-identical is impossible here — it would contradict the no-tee rule. Only the *node labels, alignment, and lane assignment* stay equivalent; the *junction glyphs* change tee→corner.)

## Open Questions

None. (The within-plane junction-colour question is dissolved by the no-tee / single-owner discipline — see § Chosen design and the design doc. Default columns-per-lane is settled in the `render-redesign-geometry` slice.)

## References

- Design: [`../../design/graph-render-redesign.md`](../../design/graph-render-redesign.md)
- Sibling slice: `../render-redesign-geometry/` (convergence + configurable geometry)
- Current tests to evolve: `cli/test/utils/formatters/migration-graph-colour-matrix.test.ts`, `…/migration-graph-cell-identity.test.ts`
