# Slice: `migration list --graph` annotated-tree mode

_One-slice project. The project (`projects/migration-list-graph/`) is the durable
design home — the design ceremony (see [`design-notes.md`](./design-notes.md))
justified a project home; the implementation lands as a single PR. Outcome: a
text-accessible rendering of the migration graph that makes **divergence**
visible directly in `migration list`._

## At a glance

Add a `--graph` flag to `prisma-next migration list` that renders the on-disk
migrations as an annotated tree: one line per migration (`<kind> <dirName>
<from> → <to>`), with a box-drawing gutter that draws the forward spine,
branches at divergences, and inserts a contract node-line (`o <hash>`) only at
convergences. The same change also retrofits kind glyphs (`↩` rollback, `⟲`
self) into the existing flat list so both views are consistent. No new
enumeration — it consumes the `MigrationListResult` the enumerator already
produces, in the enumerator's order. Note `migration graph` (tier-3 node-graph
via dagre) is **already shipped**; this is a deliberately different, edge-per-row
view (see design-notes § Relationship to the other views).

## Chosen design

The design is fully settled in [`design-notes.md`](./design-notes.md); this
section names the surfaces and the shape. **Read the design notes for the model,
glyph palette, and worked topologies — they are the contract for layout
behaviour.**

**Layer split (topology in `migration-tools`, glyphs in the CLI):**

- **`migration-tools` (new, pure):** edge-kind classification (forward / rollback
  / self) + convergence/divergence detection over a space's
  `MigrationListEntry[]`. Kind is **not** a per-row predicate — `↩` requires
  knowing `to` is an ancestor of `from` over the forward edge set — so it is
  computed here via an **independent** tolerant adjacency + 3-colour DFS (does
  not call `reconstructGraph` or share `detectCycles` — those throw / assume
  strict genesis). The list view stays robust and offline. **No genesis/single-root assumption:** the node set is exactly the
  hashes present as `from`/`to`; roots are forward-in-degree-0 nodes (zero, one, or
  several), and `EMPTY_CONTRACT_HASH` is only one possible root — many on-disk
  graphs have no genesis edge. Both renderers consume this classifier.
- `packages/1-framework/3-tooling/cli/src/commands/migration-list.ts` — add the
  `--graph` and `--ascii` flags; route to the graph renderer when `--graph` is
  set (text output only; `--json` is unaffected).
- `packages/1-framework/3-tooling/cli/src/utils/formatters/migration-list-render.ts`
  — the existing flat renderer. Move the kind glyph into the leading column
  (`*` / `↩` / `⟲`) and adopt the self-edge single-hash form, so the flat list
  and `--graph` share kind semantics. **Handoff:** the command computes per-space
  kind via the `migration-tools` helper and passes a typed `kindByMigrationHash`
  *into* the renderer — the renderer does not call topology itself (keeps
  "topology in `migration-tools`, glyphs in CLI" intact; the renderer stays
  presentation-neutral).
- **New** layout module `…/formatters/migration-list-graph-layout.ts`: a pure
  function (ordered `MigrationListEntry[]` + classifier) → row model (lane
  assignments incl. pass-through across non-adjacent producers, node-lines at
  convergences). No I/O, no styling. *(Named `migration-list-graph-*`, not
  `migration-graph-*`, to avoid colliding with the shipped `graph-render.ts` /
  `graph-types.ts` of the `migration graph` command.)*
- **New** graph renderer `…/formatters/migration-list-graph-render.ts`:
  row-model → styled lines, Unicode default with an ASCII fallback, reusing the
  existing `MigrationListStyler` token seam and the flat list's `from → to` /
  refs / invariants formatting.

**Ordering (grounded):** the enumerator sorts each space by **`dirName`
descending** (`enumerate-migration-spaces.ts`; it does not read `createdAt`). The
layout consumes that order **verbatim and never re-sorts** — re-sorting would
diverge from the flat list and break the byte-identical-degrade guarantee.

**Layout rules (from design-notes, summarised):**

- One migration = one line; the leading **kind column** carries `*` forward / `↩`
  rollback / `⟲` self; the data column stays `from → to` (plain `→`).
- **Kind is classified by a deterministic DFS** (self first; rollback = DFS
  back-edge with neighbour order pinned to `dirName`-desc so it's stable under
  cycles; forward otherwise). **Convergence/divergence degrees are counted over
  the *forward subgraph* only** — back-edges and self-edges never trigger a
  node-line. This is the single most load-bearing layout rule.
- Convergence (forward in-degree ≥ 2) → `o` node-line, fanning out downward
  (`├─┐`) to producers; producers need not be adjacent (open lanes pass through
  `│` on intervening rows). Divergence (forward out-degree ≥ 2) → no node-line
  unless the contract is also a convergence, in which case its node-line
  additionally anchors the divergence's join-from-above (`├─┘` above the node,
  `├─┐` below — separate rows, no `┼` cross-tee).
- Non-forward edges — **and** forward edges unplaceable under the verbatim order
  (a producer sorting above its consumer; `dirName`-lexical order is not
  guaranteed topological) — are not woven; lanes pass `│` through, the kind glyph
  sits in the next free column, and meaning is read from the hashes. (Defined
  escape hatch: the gutter never lies.)
- Self-edges drop the redundant second hash (`⟲ <dirName> <hash>`).
- Degrades to the flat list for linear history.

**ASCII fallback:** default to Unicode; auto-fall back when stdout is not a
UTF-8 TTY. Detection is a **pure injected** `detectGlyphMode({ isTTY, env })`
routed through `TerminalUI` (no `process` reads in the formatter), so it is
unit-testable directly; `--ascii` forces ASCII. `--ascii` and `--no-color` are
orthogonal (ASCII keeps color; `--no-color` keeps Unicode glyphs). Mapping per
design-notes (lanes `| - \ / +`, node `o`, kind glyphs `*` / `<` / `~`, arrow
`->`).

The kind-glyph retrofit is **always-on** (the plain flat list now leads with the
kind glyph too), so `detectGlyphMode` / `--ascii` govern the flat list as well —
not just `--graph`. The `↩`/`⟲` glyphs are Ambiguous-width and now sit at
**column 0** of the default output (a 2-cell render shifts the whole row, vs.
today's mid-row `⟲` shifting one column). This wider col-0 exposure is accepted —
it's consistent with TML-2697 already shipping always-on `⟲`/`→`, and the ASCII
mode (single-width) is the escape hatch.

## Coherence rationale

One feature behind one flag: the topology classifier, the layout pass, the
renderer, the flag wiring, and the flat-list kind-glyph retrofit all serve a
single user-visible outcome — "see the relationships (especially divergence)
between migrations in `migration list`." The retrofit rides along rather than
splitting into its own PR because it consumes the *same* classifier and the
*same* kind-glyph concept the graph introduces; a reviewer holds the whole thing
in one sitting and it rolls back as one unit.

## Scope

**In:**

- New tolerant topology/classification pass in `migration-tools` (forward /
  rollback / self + convergence/divergence), reusing the `MigrationGraph` model.
- `--graph` and `--ascii` flags on `migration list`.
- New pure layout module + new graph renderer (Unicode + ASCII) under
  `migration-list-graph-*`.
- Kind column (`*`/`↩`/`⟲`) + self-edge single-hash form, applied to **both**
  the flat list and `--graph`.
- Pure injected `detectGlyphMode({ isTTY, env })` via `TerminalUI`.
- Per-space graph blocks (reuse existing multi-space framing) and `--space`
  narrowing (same semantics as the flat list).
- Tests: classifier + layout unit tests over the design-notes topologies;
  renderer tests (Unicode + ASCII); `detectGlyphMode` unit tests; flag wiring;
  updated flat-list snapshots for the retrofit.

**Out:**

- Reusing the shipped `migration graph` dagre renderer (`graph-render.ts`) — it
  is a node-per-row drawing contract, incompatible with this flat-list-aligned
  edge-per-row view (cheapest-alternative considered + rejected in design-notes
  § Relationship to the other views). We *do* reuse its topology model.
- Full graph rendering with back-edge arcs / cycle drawing — that is `migration
  graph` (tier 3, already shipped).
- Weaving non-forward edges into active lanes (settled: not woven).
- A dedicated DB-marker overlay glyph (deferred follow-up; it is the existing
  `NodeMarker.kind === 'db'`; v1 reuses the `(refs)` decoration incl. the `db`
  ref).
- `--json` changes (graph is text presentation; structured output already
  carries `from`/`to`). **Text output is not a stable API; JSON is the
  contract** — so the kind-glyph retrofit cannot break programmatic consumers.
- TML-2701 (remove vestigial `labels[]`) and TML-2709 (`MigrationStore`) —
  separate tickets.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `↩`/`⟲` kind glyphs are East-Asian Ambiguous width in the gutter | Accept; ASCII fallback is the escape hatch | The risk is **alignment, not determinism** — glyphs are deterministic bytes, so byte fixtures stay stable; only *visual* column width can break on 2-cell terminals. Keep alignment-sensitive assertions in ASCII mode (single-width by construction). |
| Contract that is **both** a convergence and a divergence (forward in-degree ≥ 2 ∧ forward out-degree ≥ 2) | Node-line anchors both: `├─┘` join above, `├─┐` fan below, on separate rows | No `┼` cross-tee needed. Settled worked case (real producers, no placeholder) in design-notes. |
| Convergence whose producers are **non-adjacent** in `dirName`-desc order | Hold the lane open with `│` pass-through across intervening rows | git-log-style lane allocator; needs a dedicated fixture. |
| **No genesis edge on disk / multiple roots** (no `EMPTY_CONTRACT_HASH` edge; earliest `from` has no producing migration present) | Treat any forward-in-degree-0 hash as a root; start a lane there; never error | Common in shallow/partial checkouts. Strict `MigrationGraph` (`findLeaf`) throws `NO_INITIAL_MIGRATION` here — the tolerant pass must not. Dedicated fixture. |
| Rollback (`↩`) classification | DFS back-edge (neighbour order pinned to `dirName`-desc), in the topology layer — not per-row | `to` older than `from` isn't derivable from the two hashes; the DFS-back-edge definition stays well-defined under cycles. |
| Cycle (`A→B`, `B→A`) | Exactly one edge is the back-edge (`↩`), decided by pinned neighbour order | Deterministic partition → stable golden fixtures on the always-on flat list. |
| Multi-hop rollback (back-edge skips intermediate nodes) | Render by hashes; not woven; doesn't bump forward degree | Destination hash makes the skip self-evident. |
| Non-forward edge — **or a forward edge unplaceable under verbatim order** (producer sorts above consumer) — interleaved into a branched region | Lanes pass `│` through; kind glyph in next free column; not woven | `dirName`-lexical order isn't guaranteed topological; defined escape hatch (gutter never lies). |
| Self-edge row | `⟲` glyph + **single** hash | This changes the shipped flat-list row *shape* (today `<hash> ⟲ <blank>`), not just adds a glyph — every shipped snapshot shifts (expected). |
| Empty / single-migration / linear space | Degrades to flat list (`*` per row) | Must be byte-identical to flat list modulo kind glyphs. |
| Multiple contract spaces | Per-space graph blocks | Reuse existing multi-space layout + headings. |

## Slice-specific done conditions

- [ ] The design-notes worked topologies (linear, diamond, N-way octopus,
      parallel edges, convergence∧divergence, non-adjacent producers, multi-hop
      rollback, partial-rollback-then-continue) are reproduced as renderer
      fixtures and assert byte-for-byte (Unicode + ASCII).
- [ ] The flat-list kind-glyph retrofit is reflected in the updated TML-2697
      snapshot/styler tests (rollback rows show `↩`, self rows show `⟲` + single
      hash), and a linear all-forward `--graph` run is asserted **byte-identical
      to the retrofitted flat list** (no gutter glyphs emitted; both lead with the
      `*` kind column).

## Resolved decisions

- **Topology pass placement (settled):** a **standalone pure helper** in
  `migration-tools` consuming `MigrationListEntry[]` — `enumerateMigrationSpaces`
  keeps its current signature, classification stays a separate call. This keeps
  the enumerator focused on I/O + ordering and keeps the presentation-derived
  kind out of the JSON contract (kind is text-presentation; `--json` is
  unchanged). The flat list's kind glyphs come from the *same* helper call.
- **`--graph` × `--space` × multi-space (settled):** `--graph` respects `--space`
  exactly as the flat list does (narrow to one space, one graph block); without
  `--space`, one graph block per space reusing the existing multi-space
  headings/framing. `--graph` only changes within-space rendering — never which
  spaces are shown or how they are delimited.
- **Convergence∧divergence node visual (settled):** `├─┘` join above the `o`,
  `├─┐` fan below, on separate rows.

## References

- Design record: [`design-notes.md`](./design-notes.md) (the layout contract).
- Companion sketch: [`assets/migration-graph-display-scenarios.md`](./assets/migration-graph-display-scenarios.md) (tier-3 inspiration, not this spec).
- Linear issue: TML-2702.
- Shipped flat list (TML-2697): `migration-list-render.ts`, `migration-list-types.ts`, `enumerate-migration-spaces.ts`.
- Topology model to reuse: `migration-tools/graph.ts` (`MigrationGraph`), `migration-graph.ts` (`reconstructGraph`, reachability), `constants.ts` (`EMPTY_CONTRACT_HASH`).
- Shipped `migration graph` (different drawing contract, not reused): `graph-render.ts`, `graph-types.ts`, `graph-migration-mapper.ts`.
- Terminal seam for detection: `cli/src/utils/terminal-ui.ts` (`isTTY`).
