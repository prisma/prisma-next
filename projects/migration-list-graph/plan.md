# Dispatch plan — `migration list --graph`

Feeds `drive-build-workflow`. Slice spec: [`spec.md`](./spec.md). Layout contract:
[`design-notes.md`](./design-notes.md). Five sequential dispatches, test-first
(repo rule: tests before implementation). Each is one logically-coherent
outcome; none sized by file count.

> **Reordered after review:** kind classification (`↩` rollback) is **not** a
> per-row predicate — it needs forward-edge ancestry — so it can't live in the
> flat renderer. The classifier is now the first dispatch (in `migration-tools`,
> reusing `MigrationGraph`), and both renderers consume it.

### Dispatch 1: Tolerant topology + kind classifier (`migration-tools`)

- **Outcome:** A pure function in `migration-tools` takes a space's ordered
  `MigrationListEntry[]` and returns, per edge, its **`EdgeKind`** (`'forward' |
  'rollback' | 'self'`) plus per-contract **forward** in/out-degree (→
  convergence / divergence). Classification is a single deterministic DFS
  (canonicalizing `from: null` → `EMPTY_CONTRACT_HASH` first): **self** iff
  `from === to`; **rollback** iff a DFS back-edge (edge into a node on the active
  stack), with neighbour order pinned to `dirName`-desc so it's stable under
  cycles — mirrors `migration-graph.ts` `detectCycles`; **forward** otherwise.
  Degrees are counted over the forward subgraph only. It reuses the
  `MigrationGraph` adjacency idiom, but is **tolerant** (does not call
  `reconstructGraph`, which throws) and makes **no single-root/genesis
  assumption** — the node set is the hashes present as `from`/`to`, roots are
  forward-in-degree-0 nodes (zero/one/several), `EMPTY_CONTRACT_HASH` is only one
  possible root. Unit tests cover every design-notes topology incl.
  convergence∧divergence, a cycle/back-edge (deterministic `↩` partition), **and
  a space with no genesis edge / multiple roots**.
- **Builds on:** The spec's chosen design + the existing `MigrationGraph` model.
- **Hands to:** A **named** result type (`EdgeKind` + a classifier result, e.g.
  `MigrationGraphTopology { kindByMigrationHash, forwardInDegree,
  forwardOutDegree }`) beside `MigrationGraph` — the shared oracle both renderers
  use. Do not grow an anonymous second `*Graph` synonym.
- **Focus:** `migration-tools` topology + its unit tests. No glyphs, no CLI, no
  flag.

### Dispatch 2: Flat-list kind-glyph retrofit

- **Outcome:** `migration-list-render.ts` leads each row with the kind glyph
  (`*` / `↩` / `⟲`, consuming Dispatch 1's classifier) and renders self-edges as
  `⟲ <dirName> <singleHash>`. Shipped flat-list snapshot/styler tests are updated
  (rollback rows show `↩`; self rows show the single-hash form). Behaviour is
  otherwise identical.
- **Builds on:** Dispatch 1's classifier (the kind it needs is no longer
  derivable locally).
- **Handoff (explicit):** the **command** computes per-space kind via the
  Dispatch-1 helper and threads a typed `kindByMigrationHash` *into*
  `renderMigrationListWithStyle`; the renderer does **not** call topology itself
  (keeps it presentation-neutral, topology stays in `migration-tools`).
- **Hands to:** A flat renderer whose kind-glyph constants + `from → to` / refs /
  invariants formatting are factored for the graph renderer to reuse.
- **Focus:** Flat renderer + its tests. No layout, no `--graph` flag.

### Dispatch 3: Pure graph-layout module (`migration-list-graph-layout.ts`)

- **Outcome:** A pure function (ordered `MigrationListEntry[]` + Dispatch 1's
  classifier) → row model encoding lane assignments (git-log-style allocator with
  `│` pass-through for non-adjacent convergence producers), node-lines inserted
  only at convergences, and the convergence∧divergence join-above/fan-below
  shape. **Consumes the enumerator order verbatim; never re-sorts.** No I/O, no
  styling. Unit tests assert the row model for every design-notes topology
  including convergence∧divergence, non-adjacent producers, and a no-genesis /
  multi-root space (lanes simply start at forward-in-degree-0 hashes).
- **Builds on:** Dispatch 1's classifier/degree oracle.
- **Hands to:** A typed, tested row model — the stable structure the renderer
  maps to glyphs.
- **Focus:** Layout algorithm + unit tests. No glyphs/ANSI, no flag. Named
  `migration-list-graph-*` (not `migration-graph-*`).

### Dispatch 4: Graph renderer + glyph-mode detection

- **Outcome:** `migration-list-graph-render.ts` maps the row model to styled
  lines and reproduces the design-notes worked examples **byte-for-byte** in
  Unicode (`o`, box-drawing, `*`/`↩`/`⟲`, `from → to`) and ASCII (`o`,
  `| - \ / +`, `*`/`<`/`~`, `->`). A pure `detectGlyphMode({ isTTY, env })` is
  added and unit-tested directly (incl. `LANG` unset → ASCII). Reuses the
  `MigrationListStyler` seam and Dispatch 2's `from → to`/refs formatting.
- **Builds on:** Dispatch 3's row model **and** Dispatch 2's shared kind-glyph +
  `from → to`/refs helpers _(non-linear: depends on both)_.
- **Hands to:** A renderer + a pure glyph-mode function the command can wire.
  Alignment-sensitive assertions live in ASCII mode (single-width).
- **Focus:** Row-model → text, `detectGlyphMode`, golden fixtures. No flag wiring.

### Dispatch 5: Flag wiring + terminal-mode integration

- **Outcome:** `prisma-next migration list --graph` renders the tree; `--ascii`
  forces ASCII and `detectGlyphMode` auto-selects ASCII off a UTF-8 TTY; `--ascii`
  and `--no-color` are orthogonal; `--graph` respects `--space` and emits one
  block per space otherwise; `--json` is unaffected. The command reads the TTY/env
  via the existing `TerminalUI` seam (today `isInteractive`; add the glyph-mode
  there) and **passes `{ isTTY, env }` into the pure `detectGlyphMode`** — no raw
  `process` reads in the formatter. The command help/description + examples are
  updated in the same PR (today's text says "source → destination contract
  hashes" and describes the mid-row `⟲`; after the retrofit it must reflect the
  leading kind column, single-hash self-edges, and `--graph`/`--ascii`).
- **Builds on:** Dispatch 4's renderer + `detectGlyphMode`.
- **Hands to:** The shipped slice — satisfies both slice-DoD conditions.
- **Focus:** `migration-list.ts` flag/route wiring + `TerminalUI` glyph-mode +
  help-text update + command tests.

## Handoff completeness check

- Slice-DoD "worked topologies reproduced as fixtures (Unicode + ASCII), incl.
  convergence∧divergence + non-adjacent producers" → Dispatch 3 (row model) +
  Dispatch 4 (rendered fixtures).
- Slice-DoD "flat-list kind-glyph retrofit in updated snapshots + linear
  `--graph` byte-identical to flat list modulo kind column" → Dispatch 2
  (retrofit) + Dispatch 4/5 (linear-degrade assertion).
- Correctness precondition "kind is classified from topology, not per-row" →
  Dispatch 1, consumed by 2/3/4.
- All reachable from the sequence; plan is complete.
