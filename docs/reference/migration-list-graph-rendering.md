# `migration list --graph` — annotated-tree rendering

This document is the rendering contract for `migration list --graph`: how it draws
the on-disk migration set, the topology it computes, the glyph palette, the worked
topologies, its relationship to the other migration views, and the lane-allocator
state machine. It is reference material for anyone maintaining or extending the
`--graph` output.

## Problem framing

`migration list` prints every on-disk migration as a flat, scannable line:

```
<dirName>  <from> → <to>  (refs)
```

`--graph` keeps that list but adds an ASCII drawing that shows how the migrations
relate — the `git log --oneline` → `git log --graph --oneline` move.

### The core obstacle: migrations are edges, contracts are nodes

Git can draw its graph trivially because **commits are nodes and are unique**. This
graph is the other way around:

- **Migrations are edges** (`from → to`). They carry the human-facing info.
- **Contract hashes are nodes** — and they are **not unique as arrival points**:
  several migrations can produce the same contract hash (convergence), and a
  contract can be departed from by several migrations (divergence).

A naive "one row per migration, connect rows that chain" drawing therefore
**misrepresents convergence**. If two migrations (`merge_a`, `merge_b`) both produce
`D`, and a later migration `finalize` departs from `D`, drawing `finalize` with a
git-style merge fork (`|\`) to both producers asserts a *conjunction* ("finalize
merges both histories") when the truth is a *disjunction* ("D is reachable either
way; finalize needs only D"). Git's `|\` means "this node has both these parents";
that would borrow it to mean something false.

**Conclusion:** faithful relationship-drawing of this graph requires the contract
nodes to appear *somewhere*. Pure edge-rows can render a linear spine and
divergence, but at a convergence they must either stay silent or lie.

## The model

> Every migration is one line carrying `from → to` — that is authoritative and
> complete. The gutter draws only the **forward spine**. A contract node-line is
> introduced **only where the graph converges** (in-degree ≥ 2), so the node can
> own the fan-in and no edge ever falsely claims two parents. Anything the forward
> gutter cannot faithfully draw (back-edges, self-edges, an un-anchored terminal
> convergence) still appears as a row; its relationship is read from the hashes.
> The drawing never filters; it only decorates what it can prove.

Concretely:

1. **One migration = one line:** `[gutter] <kind> <dirName>  <from> → <to>  (refs)`.
2. **The gutter branches at divergences** (a contract with >1 outgoing *forward*
   migration) — lanes, exactly like `git log --graph`. A divergence needs **no**
   node-line: its single producing migration anchors the fan (it's a true fan-out —
   every branch genuinely descends from that one edge).
3. **A contract node-line (`o  <hash>`) is inserted only at a convergence** (a
   contract reached by ≥ 2 *forward* migrations). The node owns the fan-in. (Forward
   in/out-degree only — back-edges and self-edges don't count; see § Topology
   source.)
4. **Degrades to the flat list for linear history:** no branch, no convergence → no
   gutter lines, no node-lines → it's the flat list with a `*` per row.

### Topology source

The view never re-derives graph structure ad hoc. Convergence (forward in-degree
≥ 2), divergence (forward out-degree ≥ 2), and edge kind (forward / rollback / self)
are all **topology facts**, and `migration-tools` owns a dedicated tolerant
classifier for this view. It does **not** call `reconstructGraph` or reuse
`MigrationGraph`'s `detectCycles` — those paths throw on invalid graphs and assume a
strict genesis model. Instead the classifier runs an **independent** adjacency build
+ 3-colour DFS over the enumerator's `MigrationListEntry[]`, placed beside
`MigrationGraph` and sharing only naming conventions (`EMPTY_CONTRACT_HASH`, hash
canonicalization). The separate pass exists because the list views must stay
**tolerant** — show every on-disk migration, offline, never fail.

- **No single-root / genesis assumption.** The strict `MigrationGraph` path
  (`findLeaf`, `reconstructGraph`) anchors traversal at `EMPTY_CONTRACT_HASH` and
  throws `NO_INITIAL_MIGRATION` when no edge departs it — but **many on-disk graphs
  have no genesis edge at all** (e.g. a shallow/partial checkout, or a space whose
  earliest migration's `from` is a hash whose producing migration isn't present).
  The tolerant pass treats the node set as exactly the hashes that appear as
  `from`/`to` among the present entries; a **root** is simply any hash that no
  *forward* edge produces (forward in-degree 0). There can be **zero, one, or
  several** roots, and `EMPTY_CONTRACT_HASH` (the `from: null` baseline) is just *one
  possible* root — never assumed present. The classifier canonicalizes `from: null`
  → `EMPTY_CONTRACT_HASH` up front (the same bridge `reconstructGraph` does), so `∅`
  rendering and ancestry share one node space. A `from` with no producing edge is a
  dangling parent (the gutter just starts a lane there), not an error.
- **Convergence/divergence degrees are counted over the *forward subgraph* only**
  (edges classified `forward` — excluding back-edges and self-edges). This is
  load-bearing: it is what decides when an `o` node-line appears. Counting raw
  arrivals would make a rollback edge landing on a contract spuriously look like a
  convergence and demand a node-line the drawing doesn't (and shouldn't) have.
  Back-edges/self-edges still occupy rows; they just don't bump the degree counts
  that drive node-line/fan placement.
- Glyph rendering (lane assignment, node-line placement, Unicode/ASCII) lives in the
  CLI formatter, mirroring the `migration-list-render.ts` seam.

### Why the convergence node-line removes the lie

With the node mediating, a downstream migration connects to the **node**, not to the
edges:

```
*      20250315_finalize       d41a8c3 → e5f6789
o      d41a8c3
├─┐
* │    20250302_merge_tags     9c4f1e7 → d41a8c3
│ *    20250301_merge_posts    7e1b9a0 → d41a8c3
```

`finalize` has one real edge down to the `d41a8c3` node; the **node** fans to its two
producers. Every line is true.

## Glyph palette

> **Vocabulary note.** The leading glyph on a migration row is the **kind glyph** (it
> tells you the edge *kind*). This is deliberately *not* called a "marker" — the
> sibling `migration graph` view owns a typed `NodeMarker` (`graph-types.ts`: `db` /
> `ref` / `contract` / `custom`) attached to *nodes*. Two different concepts; two
> different words. (The "DB is here" overlay in § Out of scope is that existing
> `NodeMarker.kind === 'db'`, not a kind glyph.)

| Glyph | Meaning |
|---|---|
| `*` | kind glyph: a forward migration |
| `↩` | kind glyph: a rollback (back-edge — `to` is an ancestor of `from`) |
| `⟲` | kind glyph: a self-edge (`from == to`) |
| `o` | a contract node; drawn **only** at convergences (forward in-degree ≥ 2) |
| `│ ─` | lane (vertical / horizontal) |
| `├ ┤ ┬ ┴` | lane fan / join tees |
| `┌ ┐ └ ┘` | lane corners |
| `<from> → <to>` | the edge's data column — always `from → to`, forward `→` |

**The kind column carries the edge *kind*; the data column stays `from → to`.** Every
migration row leads with a kind glyph — `*` forward, `↩` rollback, `⟲` self — and that
glyph is the only thing that signals direction/kind. The data column is untouched:
it's always `from → to` with a plain `→` (the kind glyph, not the arrow, tells you
it's a rollback). Self-edges are the exception to "two hashes": since `from == to`,
the redundant second hash is dropped, leaving a single hash (`⟲  <dirName>  <hash>`).

> **The kind is a graph property, not a per-row predicate.** `*` vs `↩` is *not*
> computable from one migration's two hashes — contract hashes have no intrinsic
> order. Classification is a single deterministic DFS over the edge set
> (canonicalizing `from: null` → `EMPTY_CONTRACT_HASH` first), with neighbour order
> pinned to the enumerator's `dirName`-descending order so the partition is stable
> even when the graph contains cycles:
>
> - **self-edge** (`⟲`) iff `from == to` — classified first, the one genuinely local
>   case;
> - **rollback** (`↩`) iff the edge is a **DFS back-edge** — it points at a node
>   currently on the DFS stack (i.e. an ancestor on the active path). Defining it as a
>   back-edge (rather than "`to` can reach `from`") is what makes the forward/back
>   partition well-defined under cycles: in an `A→B`/`B→A` pair exactly one edge is
>   the back-edge, decided by the pinned neighbour order. It applies the same 3-colour
>   back-edge idiom as `migration-graph.ts`'s `detectCycles`, implemented
>   independently in the tolerant pass — it does not call `detectCycles`;
> - **forward** (`*`) otherwise.
>
> The DFS seeds from forward-in-degree-0 nodes (`EMPTY_CONTRACT_HASH` first, then
> lexicographic), and seeds any still-unvisited remainder lexicographically (covering
> a pure cycle with no in-degree-0 root) — so the partition is fully determined even
> with no genesis / multiple roots. (Root-start order matters only for graphs where
> it has freedom; where an "intended" rollback exists, this seeding recovers it.)
>
> Kind classification therefore lives in the topology layer (see § Topology source),
> not in either renderer. Both the flat list and `--graph` consume the same
> classifier. **The forward edges (everything not a back-edge or self-edge) form the
> "forward subgraph"; convergence/divergence degrees are counted over that subgraph
> only.**

The kind glyph is **not always col 0** — it sits in whatever gutter lane the
migration occupies, so in a branched region a rollback can be nested (e.g. `│ ↩  …`).
The kind glyph and the lane glyphs share that cell.

The kind glyphs also apply to the **flat list** (which otherwise shows every row with
`→` and renders self-edges as `<hash> ⟲` in the data column); moving kind into the
leading column makes both views consistent and resolves the scannability gap.

**Width-safety, and the one accepted exception:** the geometric glyphs (`● ○ ◆ ■ ◉`)
are East-Asian **Ambiguous width** — they render as two cells in some
terminals/locales and break column alignment. ASCII `*` / `o` and the box-drawing
block (`U+2500–257F`) are reliably single-width, which is why the forward kind glyph
is `*` and the node glyph is the ASCII letter `o`, **not** the prettier hollow circle
`○`. (The sibling `migration graph` renderer uses `○ ◆ ◇` for its node markers —
those sit on dedicated node rows there, not in a per-row gutter; the difference is
noted in § Relationship to the other views.)

The exception: the `↩` and `⟲` kind glyphs *are* Ambiguous width, and they live in the
gutter (the most alignment-sensitive column, since lanes align there). This tradeoff
is accepted — `→`/`⟲` already ship in the flat list's output, and on modern terminals
they render single-width. The risk is **alignment, not determinism**: the glyphs are
deterministic *bytes*, so byte-for-byte fixtures stay stable; what can break is the
*visual* column alignment when a terminal renders them as two cells. The ASCII
fallback (see § ASCII fallback) is the escape hatch, and is single-width by
construction.

Lanes are two cells wide (glyph + space); a fan/join from col0 to col1 spans `├─┐` /
`├─┘`; an N-way fan is `├─┬─┐` / `└─┴─┘`.

## Worked cases

### Linear chain (degrades to the flat list, git-identical)

```
*   20250310_add_comments   7e1b9a0 → f03da82
*   20250203_add_posts      abc1234 → 7e1b9a0
*   20250115_add_users      ∅       → abc1234
```

(`git log --graph` on a linear history is likewise bare `*` lines with no
connectors.)

### Diamond (divergence + convergence)

```
o     d41a8c3
├─┐
* │   20250302_merge_tags    9c4f1e7 → d41a8c3
│ *   20250301_merge_posts   7e1b9a0 → d41a8c3
* │   20250210_add_tags      abc1234 → 9c4f1e7
│ *   20250203_add_posts     abc1234 → 7e1b9a0
├─┘
*     20250115_add_users     ∅       → abc1234
```

The convergence at `d41a8c3` gets an `o` node-line; the divergence at `abc1234` is
anchored by `add_users` (the `├─┘` join), no node-line needed.

### N-way convergence (octopus) — cleaner than git's `*-.`

```
o       d41a8c3
├─┬─┐
* │ │   20250310_merge_a   a1b2c3d → d41a8c3
│ * │   20250309_merge_b   b1c2d3e → d41a8c3
│ │ *   20250308_merge_c   c1d2e3f → d41a8c3
* │ │   20250304_branch_a  4cb4256 → a1b2c3d
│ * │   20250303_branch_b  4cb4256 → b1c2d3e
│ │ *   20250302_branch_c  4cb4256 → c1d2e3f
└─┴─┘
*       20250115_add_base  ∅       → 4cb4256
```

### Parallel edges (same `from`→same `to`, different ops)

```
o     def5678
├─┐
* │   20250203_add_posts_v2   abc1234 → def5678
│ *   20250203_add_posts      abc1234 → def5678
├─┘
*     20250115_add_users      ∅       → abc1234
```

A two-edge bubble: convergence at `def5678`, divergence at `abc1234`. (`…_v2` sorts
*above* `…add_posts` because `dirName`-descending puts the longer same-prefix string
first — the order is the enumerator's, consumed verbatim.)

### Convergence ∧ divergence on the same contract

A contract `d41a8c3` that is **both** reached by ≥ 2 migrations (convergence) **and**
departed by ≥ 2 migrations (divergence). In latest-first order its consumers (newer,
departing `d41a8c3`) sort *above* the node-line and its producers (older, producing
`d41a8c3`) sort *below* it. The node-line is emitted because of the convergence
(in-degree ≥ 2); it then *also* anchors the divergence — the consumer lanes **join
into it from above**, and it **fans out to producers below**, on **separate gutter
rows**:

```
*     20250320_add_x      d41a8c3 → e1f2a3b
│ *   20250319_add_y      d41a8c3 → c4d5e6f
├─┘
o     d41a8c3
├─┐
* │   20250310_merge_a    a1b2c3d → d41a8c3
│ *   20250309_merge_b    b1c2d3e → d41a8c3
* │   20250304_branch_a   4cb4256 → a1b2c3d
│ *   20250303_branch_b   4cb4256 → b1c2d3e
├─┘
*     20250115_add_base   ∅       → 4cb4256
```

Trace it through: `add_x`/`add_y` both depart `d41a8c3` (forward out-degree 2), so
their two lanes **join into the node from above** (`├─┘`). The **lane-opening is
lazy**: a divergence consumer's lane opens only where its own tip row appears (reading
top-down), so the topmost consumer `add_x` is a bare `*` and `add_y` opens lane 1
below it — the same tip discipline the diamond and partial-rollback cases use (the
diamond's `* │` first-merge row comes from the node's **fan** opening both lanes, not
from eager pre-opening). The node `o d41a8c3` is emitted because `d41a8c3` has forward
in-degree 2 (`merge_a`, `merge_b`), which **fan below** it (`├─┐`). `merge_a`/`merge_b`
then continue on their own lanes down to their producers `branch_a`/`branch_b`, which
both depart `4cb4256` and join at `add_base` (`├─┘`). Every lane resolves to a real
producer — there is no placeholder.

Because the join-from-above (`├─┘`) and the fan-to-below (`├─┐`) are on **separate
rows** bracketing the `o` node-line, no combined cross-tee glyph (`┼`) is needed — the
palette suffices. The rule generalises cleanly: **a node-line appears iff forward
in-degree ≥ 2; if that same contract also has forward out-degree ≥ 2, the node-line
additionally anchors the divergence's join from above.** A *pure* divergence (forward
out-degree ≥ 2, forward in-degree < 2) still gets no node-line — its single producing
migration anchors the fan, as before.

### Multi-hop rollback (back-edge skipping a node)

```
↩   20250312_full_rollback   ghi7890 → abc1234
*   20250310_add_comments    def5678 → ghi7890
*   20250203_add_posts       abc1234 → def5678
*   20250115_add_users       ∅       → abc1234
```

The `↩` glyph flags `full_rollback` as a rollback at a glance, while the data column
stays a plain `ghi7890 → abc1234`. The destination (`abc1234`, the *bottom* contract)
makes the multi-hop skip self-evident from the hash. No further annotation needed.

### Partial rollback then continue

`def5678` diverges (forward) into `add_comments` and `add_likes`, and a rollback lands
back on it:

```
*     20250320_add_likes          def5678 → jkl1234
│ ↩   20250312_rollback_comments  ghi7890 → def5678
│ *   20250310_add_comments       def5678 → ghi7890
├─┘
*     20250203_add_posts          abc1234 → def5678
*     20250115_add_users          ∅       → abc1234
```

The forward divergence draws fine. The **back-edge is the strain**:
`rollback_comments` departs from `ghi7890`, which — in latest-first order — is created
*below* it. Git never produces this (DAG), so there is no idiom to borrow; the gutter
cannot draw the arc. The row is listed with its hashes; the arc is `migration graph`'s
job.

This is also the worked example for **non-forward-edge column placement**: when a
back-edge (or self-edge) is interleaved into a region with open lanes, those lanes
pass straight through as `│` on its row, and the kind glyph (`↩`/`⟲`) sits in the
**next free column** to the right of the open lanes — here lane 0 (held open by
`add_likes`, which has not yet joined) draws `│`, and `↩` lands in column 1. The glyph
never overwrites an open lane.

## Relationship to the other views

| View | Rows | Draws |
|---|---|---|
| `migration list` | migrations | nothing (flat) |
| `migration list --graph` | migrations (+ node-lines at convergences) | forward spine |
| `migration graph` | contracts (nodes) + migrations (edges) | full node-graph via dagre, incl. back-edges/branches/markers |

**`migration graph` is a different drawing contract.** `migration-graph.ts` (command)
+ `graph-render.ts` (dagre layout + `CharGrid`) + `graph-migration-mapper.ts` +
`graph-types.ts` render a **node graph**: contracts are `○` nodes, migrations are
edge-lines between them, laid out by dagre. `migration list --graph` is **one row per
migration (edge)** with node-lines inserted *only* at convergences — a deliberately
different shape that stays close to the flat-list spirit (the `git log --oneline` →
`git log --graph --oneline` move).

It does **not** reuse the dagre renderer: that draws a *node-per-row* graph, whereas
this view is *edge-per-row* and must align column-for-column with the flat list it
extends (same `from → to` data column, same refs decoration, byte-identical degrade to
the flat list for linear history). The two views answer different questions (`graph` =
"what is the whole topology", `list --graph` = "show me the list, but make divergence
visible"). It also does **not** reuse `MigrationGraph` / `reconstructGraph`: those are
strict (they throw on invalid graphs and assume a genesis root), whereas the list view
must stay offline and never fail. Instead it runs an independent *tolerant*
classification pass over the same `MigrationListEntry` edges (see § Topology source) —
sharing the edge model and the back-edge idiom, not the code.

**Glyph divergence with `migration graph` (intentional).** `graph-render.ts` uses
`○ ◆ ◇` for its node markers; this view uses ASCII `o` for the contract node. The
reason is positional: in `migration graph` the node glyph sits on a dedicated node
row, whereas here the node and kind glyphs ride the per-row gutter where
Ambiguous-width glyphs threaten column alignment on every line (see § Glyph palette).
Keeping `o` here is the width-safe call; the two views differ because their layouts
differ.

## Lane allocator (state machine)

The layout is a deterministic state machine over the verbatim (`dirName`-desc) row
order. It is **not** literally git's allocator: git's node-bearing event is the
*commit* (a node) and merges fan at divergence; this one is inverted — rows are
*edges*, the node-bearing event is **convergence**, and a row is placed by matching
its `to` against open lanes. State = an ordered list of **lanes**, each carrying the
contract hash it currently *wants* (the `to` it is descending toward). Reading each
migration row top-down:

1. **Place.** If some open lane wants this migration's `to`, the migration is drawn
   (`*`/`↩`/`⟲`) in the leftmost such lane; that lane's want becomes the migration's
   `from`. If no lane wants it, **open** a new lane at the right (this is a tip — its
   `to` is consumed by nothing above) and place it there.
2. **Converge (node-line + fan-below).** When the contract just reached has forward
   in-degree ≥ 2, emit an `o <hash>` node-line and a `├─┐`/`├─┬─┐` fan on the next row,
   opening one lane per *forward* producer (ordered by the producers' verbatim row
   order). Producers need not be adjacent: each open producer-lane draws `│`
   pass-through on intervening rows until its producer's row appears.
3. **Diverge (join-below, no node-line).** When ≥ 2 open lanes want the same contract
   and that contract has a single forward producer, they **join** into the leftmost
   via `├─┘`/`└─┴─┘` on the producer's row; lanes to the right close and may be reused.
4. **Convergence ∧ divergence.** A contract that is both gets its node-line (rule 2);
   the consumer lanes join *into* it from above (`├─┘`, rule 3 applied one row above
   the node) and producers fan *below* it (rule 2) — separate rows, no `┼`.
5. **Non-forward / non-topological pass-through.** A row that is a back-edge or
   self-edge — **or** a *forward* edge that cannot be placed because its `to` isn't
   wanted by any open lane under the verbatim order (the order is lexical on `dirName`,
   which is **not guaranteed** to be topological; a producer can sort above its
   consumer in a partial checkout) — is **not woven**. Open lanes draw `│` straight
   through; the row's kind glyph sits in the next free column; its relationship is read
   from `from → to`. This is the defined escape hatch: the gutter never lies, it just
   declines to draw an arc it cannot prove.

Lane order is stable, left-to-right by first appearance reading top-down. Exhaustive
lane-reuse / tie-break behaviour beyond this skeleton is pinned by tests, not prose.

## Design rules (summary)

- Migrations stay one-line with `from → to`; this is the authoritative data, the
  gutter is a forward-spine aid.
- Contract node-lines appear iff forward in-degree ≥ 2 (convergence). A contract that
  is also a divergence (forward out-degree ≥ 2) reuses that node-line to anchor the
  divergence's join-from-above; a *pure* divergence still needs no node-line.
- Structure in width-safe box-drawing; node glyph `o` (intentionally differs from
  `migration graph`'s `○`; see § Relationship to the other views).
- **Topology lives in `migration-tools`, glyphs in the CLI.** Edge-kind classification
  (forward/rollback/self) and convergence/divergence detection run an independent
  *tolerant* adjacency pass over the `MigrationListEntry` edges — it does not reuse
  `MigrationGraph` / `reconstructGraph` (those throw and assume a single-root/genesis),
  and there is no single-root/genesis assumption here: roots are forward-in-degree-0
  nodes; `EMPTY_CONTRACT_HASH` is only one possible root. Both the flat list and
  `--graph` consume the same classifier. Lane assignment + node-line placement + glyph
  rendering live in the CLI formatter.
- The **kind column** carries the edge *kind*: `*` forward, `↩` rollback, `⟲` self. The
  data column stays `from → to` (plain `→`) — the kind glyph, not the arrow, signals
  direction. No bare `←` between hashes. ("Kind glyph", not "marker": `NodeMarker` is
  the sibling `migration graph` view's node concept.)
- The kind glyph is not always col 0 — it sits in the migration's gutter lane, so a
  rollback can be nested in a branch (e.g. `│ ↩  …`).
- Self-edges use the `⟲` glyph + a **single** hash (drop the redundant second hash).
- The `↩`/`⟲` glyphs apply to the flat list too, so both views are consistent.
- It must reduce to the flat list for linear history.
- **Non-forward edges are not woven into lanes.** A back-edge interleaved into a
  branched region sits at its row slot; the active lanes draw straight through (`│`
  pass-throughs), and its relationship is read from `from → to`. Full arc-drawing of
  back-edges is `migration graph`'s job. This preserves the enumerator's row order and
  never lies; the residual "which lane?" ambiguity is resolved by the hashes.
- **Ordering is the enumerator's order, consumed verbatim — never re-sorted.** The
  enumerator sorts each space by **`dirName` descending** (latest-first;
  `enumerate-migration-spaces.ts` — it does *not* read `createdAt`). The layout
  consumes that order as-is. This is load-bearing: re-sorting by `createdAt` would
  disagree with the flat list on same-prefix `dirName`s and break the "degrades
  byte-identically to the flat list" guarantee. The tie-break is `dirName`
  lexicographic, owned by the enumerator.

### ASCII fallback

Default to Unicode; auto-fall back to ASCII when stdout is not a UTF-8 TTY
(piped/redirected, dumb terminal, non-UTF-8 locale); plus an explicit `--ascii` flag
for tests/CI. Mapping: lanes `| - \ / +`, node `o` (already ASCII), forward kind glyph
`*`, rollback `<`, self `~`, data arrow `->`. Detection is a pure injected function
`detectGlyphMode({ isTTY, env })` routed through `TerminalUI` (keeping `process` reads
out of the formatter); `--ascii` and `--no-color` are orthogonal (ASCII mode keeps
color; `--no-color` keeps Unicode glyphs).

## Out of scope

- **DB-marker overlay.** A dedicated "DB is here" marker is cross-cutting with
  `migration status` / `migration graph`, so it is not drawn here; `--graph` reuses the
  flat-list `(refs)` decoration, including the `db` ref (which already means "DB is
  here"). It is the existing `NodeMarker.kind === 'db'`, not a kind glyph.
- **Full back-edge arc drawing.** Drawing the arc of a rollback/back-edge across rows
  is `migration graph`'s (node-graph) job; `--graph` lists the row and reads the
  relationship from the hashes.
