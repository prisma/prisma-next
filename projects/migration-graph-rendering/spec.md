# Slice: replace `migration graph`'s dagre renderer with a condensed, full-history diagram

_Single-slice project. Outcome: `migration graph` renders the **whole** migration graph — every contract once, every migration as a labelled edge, back-edges and disjoint components included — in the condensed lane-per-column language locked in [`mockups.md`](./mockups.md), with no golden-path assumption._

## At a glance

`migration graph` today routes its tolerant `MigrationGraph` (from `aggregate.app.graph()`) through `migrationGraphToRenderInput` — which assumes a single canonical linear history (`findPath`, `forwardChain`, a `spineTarget`, a phantom dashed edge to the current contract) — and then through a dagre auto-layout renderer that draws contracts and migrations as a large 2D node graph with per-marker glyph tags (`◆ db`, `◇ contract`).

This slice replaces both layers for `migration graph` with a new layout engine + text renderer that:

- places **every contract on exactly one `○ <hash>` row** and **every migration on its own labelled edge row**, root(s) at the bottom, tip(s) at the top;
- carries direction in the edge's own lane (`│↑` forward, `│↓` rollback, `│⟲` self), with branch/merge spine (`├ ┐ ┴ ┬`) for divergence/convergence and routed solid-box arcs only for node-skipping rollbacks;
- decorates node rows with the `migration list --graph` `(refs)` overlay — user refs plus the reserved `db` and `contract` names — instead of per-marker glyph tags;
- makes no single-canonical-path assumption: multi-root, disjoint, cyclic, and detached-contract graphs all render without throwing.

Worked example (DB one migration behind the current contract):

```
○   a94b7b4              (main, contract)
│↑  add_posts            ef9de27 → a94b7b4
○   ef9de27              (db, prod)
│↑  init                 ∅ → ef9de27
○   ∅
```

The complete visual language and the full topology gallery (linear, rollback, diamond, sequential-diamonds, 3-way fan, cross-link, kitchen-sink, routed skip-rollback, disjoint forest, dangling parent, self-edge, pure cycle, and the three overlay cases) is **locked** in [`mockups.md`](./mockups.md). That file is the design-of-record; this spec pins the implementation architecture, scope, and decomposition.

## Chosen design

### Data flow (before → after)

The command already loads through the ContractSpace aggregate and holds a tolerant `MigrationGraph` plus `refs` and `contractHash` (see `migration-graph.ts`). Only the render path changes.

| Stage | Today | This slice |
|---|---|---|
| Source | `aggregate.app.graph()` → `MigrationGraph` (tolerant) | unchanged |
| `--json` / `--dot` | read `graph.nodes` / `graph.migrationByHash` directly | unchanged (must stay byte-identical) |
| Default render | `migrationGraphToRenderInput` (golden-path) → `graphRenderer.render` (dagre) | new layout engine → new text renderer |

The new render path is a pure pipeline over the `MigrationGraph`:

1. **Row model** — classify each edge `forward` / `rollback` / `self` (DFS back-edge detection, the same classification `migration list --graph`'s topology pass already performs) and produce a deterministic vertical node ordering: roots at the bottom, tips at the top, disjoint components stacked with a blank separator. Pure data; no glyphs. Ordering tie-breaks follow the existing `dirName`-descending / enumerator order so snapshots are stable.
2. **Column model (grid)** — allocate a column per node and per in-flight edge lane; compute branch/merge spine connectors and long-edge lanes (a `git log --graph`-style allocator). Pure data: a per-row cell grid with lane assignments and spine glyphs. No back-arcs, no overlays yet.
3. **Text renderer** — emit the grid as text: node rows (`○ <hash>`), edge rows with the in-lane direction glyph and the authoritative `<from> → <to>` data column plus the migration name. Adjacency cases first (every edge points at a layout-neighbour); node-skipping back-arcs and overlays layer on top.
4. **Routed back-arcs** — node-skipping rollbacks tee off their source node (`○─╮`), run a solid back-lane (`│`), and turn into their target (`◂╯` / `◂─╯`); overlapping arcs take adjacent back-lanes left-to-right, crossings `┼`. See [`mockups.md § Routed arcs`](./mockups.md).
5. **Node overlays** — append the `(refs)` parenthetical to node rows, reusing `migration-list-styler.ts`'s `refs` styler (which already styles the reserved `db` name to pop) and aligning the parenthetical to the same column as the edge-row `from → to` data. Order: user refs lexicographically, then `db`, then `contract`. A node nothing points at carries no decoration. The detached current contract (working schema emits a hash no migration produces) renders as a **floating node** carrying `(contract)` with **no incoming edge** — deliberately dropping today's phantom dashed connector.
6. **Glyph mode / ASCII fallback** — the renderer takes a glyph set; an ASCII set (and `--ascii` / non-UTF-terminal detection) swaps box-drawing for ASCII, orthogonal to `--no-color`. Glyph-mode detection is injected (pure) via `TerminalUI`, matching the Tier-2 arrangement.

### Module placement

New modules live CLI-side under `cli/src/utils/formatters/`, matching where the Tier-2 `migration-list-graph-{topology,layout,render}.ts` engine already lives (the edge classifier `classifyMigrationListGraphTopology` is the reuse anchor). Exact filenames are implementer discovery; the natural shape mirrors Tier-2.

## Coherence rationale

One reviewer holds this in one sitting: it rewires a single command's default-render path from one renderer to another, behind unchanged `--json` / `--dot` output and an unchanged source. The dispatches are internal increments of one pipeline (row model → grid → text → arcs → overlays → ASCII); the PR is correct only as a whole, and rolls back as one unit. The locked `mockups.md` gallery is the acceptance surface, so the chosen design does not drift mid-loop.

## Scope

**In:**

- New layout engine + text renderer for `migration graph`'s default output, per [`mockups.md`](./mockups.md).
- Rewiring `migration-graph.ts`'s non-`json`/non-`dot` branch onto the new renderer.
- Reusing the Tier-2 edge classifier and the `(refs)` styler.
- Golden snapshots over the synthetic mockup topologies and the demo `examples/prisma-next-demo/migration-fixtures` pathological cases.
- A reference doc `docs/reference/migration-graph-rendering.md` (mirroring the Tier-2 `migration-list-graph-rendering.md`).

**Out:**

- `migration status`'s graph rendering. It shares `migrationGraphToRenderInput` + `graphRenderer` (the dagre renderer) and renders a *focused* root→relevant-node subgraph, a different intent from the full-history view. This slice **leaves the dagre renderer and the mapper in place** for `migration status` and does **not** delete them. Migrating `migration status` onto the new renderer (and then deleting dagre + the `@dagrejs/dagre` dependency) is **TML-2748** — a follow-up blocked by this slice. **On this slice's close, pick up TML-2748.**
- `migration list --graph` (Tier-2) — already shipped, untouched.
- The `--json` / `--dot` output shapes — frozen.
- Any change to the contract surface or target adapters (none).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Dagre renderer shared with `migration status` | Out of scope; leave dagre in place | Deleting `graph-render.ts` / `graph-migration-mapper.ts` would break `migration status`. Follow-up migrates status, then deletes. |
| `--json` / `--dot` read `graph` directly | Must stay byte-identical | Both branches bypass the render pipeline; regression-test their output. |
| Detached current contract (working schema emits an unproduced hash) | Behaviour change: floating `(contract)` node, no edge | Today draws a phantom dashed edge from the tip; the new design drops it deliberately (an edge means a migration; there is none). |
| Multi-root / disjoint / cyclic / dangling-parent graphs | Must render without throwing | The tolerant `MigrationGraph` permits all of these; golden them from the demo fixtures + synthetic cases. |
| Output determinism | Tie-break on `dirName`-desc / enumerator order | Required for stable goldens; the Tier-2 topology pass already does this. |

## Slice-specific done conditions

- [ ] Golden snapshots for the full topology gallery (synthetic mockup cases + demo `migration-fixtures`) are committed and match [`mockups.md`](./mockups.md); `migration graph --json` / `--dot` and `migration status` rendering have regression coverage proving they are unchanged.

## Open Questions

All three shaping questions are **resolved** (operator-confirmed); the decisions are folded into Chosen design above:

1. **Edge classifier — shared.** Adapt `classifyMigrationListGraphTopology` to accept the `MigrationGraph` edge set so Tier-2 and Tier-3 cannot disagree on forward/rollback/self.
2. **Module placement — CLI-side, following the `migration list --graph` pattern.** New modules mirror `migration-list-graph-{topology,layout,render}.ts` under `cli/src/utils/formatters/`.
3. **Goldens — exact-text alignment fixtures, not a stable API.** The rendered text is explicitly not a contract; fixtures pin alignment/regression and may be regenerated freely.

## References

- Locked design-of-record: [`mockups.md`](./mockups.md); prototyping harness: [`prototype/`](./prototype/).
- Linear issue: TML-2746. Follow-up (blocked by this slice): **TML-2748** — migrate `migration status` off dagre and delete the dagre renderer + `@dagrejs/dagre`.
- Tier-2 precedent (the engine this mirrors): `cli/src/utils/formatters/migration-list-graph-{topology,layout,render}.ts`; reference doc `docs/reference/migration-list-graph-rendering.md`.
- Surfaces that change / are protected: `cli/src/commands/migration-graph.ts` (rewire), `migration-list-styler.ts` (`refs` reuse), `graph-render.ts` / `graph-migration-mapper.ts` (left in place for `migration status`).

## Dispatch plan

### Dispatch 1: row model — edge classification + vertical node ordering

- **Outcome:** A pure function maps a `MigrationGraph` to an ordered list of node rows (roots bottom, tips top, disjoint components stacked) with each edge classified `forward` / `rollback` / `self`. Deterministic ordering (`dirName`-desc / enumerator tie-break). No glyphs, no columns.
- **Builds on:** The spec's chosen design; the existing `classifyMigrationListGraphTopology` (reuse anchor).
- **Hands to:** A `RowModel` (ordered nodes + classified, source/target-resolved edges) consumable by the column allocator. Unit tests over the synthetic + demo fixtures assert ordering and per-edge kind.
- **Focus:** Classification + ordering only. Lane allocation, glyphs, and rendering are later dispatches.

### Dispatch 2: column model — lane allocation + branch/merge spine

- **Outcome:** A pure function assigns a column to each node and each in-flight edge lane, and computes branch/merge spine connectors (`├ ┐ ┴ ┬`) and long-edge lanes, producing a per-row cell grid.
- **Builds on:** Dispatch 1's `RowModel`.
- **Hands to:** A `GridModel` (per-row cells with lane assignments + spine glyphs, no back-arcs, no overlays). Unit tests assert lane columns for diamond, 3-way fan, sequential-diamonds, and cross-link.
- **Focus:** Forward-grain lane allocation + spine. Node-skipping back-arcs are deferred to dispatch 4.

### Dispatch 3: text renderer (adjacency cases) + rewire `migration graph`

- **Outcome:** A renderer emits the `GridModel` as text — node rows, edge rows with in-lane direction glyph (`↑`/`↓`/`⟲`), and the `from → to` data column + migration name — for all **adjacency-only** topologies. `migration-graph.ts`'s default branch is rewired onto it (replacing `migrationGraphToRenderInput` + `graphRenderer.render`); `--json` / `--dot` branches untouched.
- **Builds on:** Dispatch 2's `GridModel`.
- **Hands to:** `migration graph` renders the condensed diagram for adjacency topologies (linear, rollback, diamond, sequential-diamonds, 3-way fan, cross-link, kitchen-sink, disjoint forest, dangling parent, self-edge, pure cycle); golden snapshots for those committed; `--json`/`--dot` regression-covered.
- **Focus:** Adjacency rendering + command rewiring. Routed arcs and overlays deferred.

### Dispatch 4: routed back-arcs for node-skipping rollbacks

- **Outcome:** Node-skipping rollbacks render as solid box-drawing arcs originating from the source node (`○─╮` / `│` / `◂╯` / `◂─╯`), with overlapping arcs in adjacent back-lanes (left-to-right) and crossings as `┼`, per [`mockups.md § Routed arcs`](./mockups.md).
- **Builds on:** Dispatch 3's renderer + the adjacency/node-skipping distinction in the grid.
- **Hands to:** The `skip-rollback` fixture renders per mockup; golden committed.
- **Focus:** Back-arc routing only.

### Dispatch 5: node overlays — `(refs)`, `db`, `contract`, detached contract

- **Outcome:** Node rows carry the `(refs)` parenthetical (reusing `migration-list-styler.ts`'s `refs` styler), aligned to the `from → to` data column, ordered user-refs-then-`db`-then-`contract`. The detached current contract renders as a floating `(contract)` node with no incoming edge (no phantom dashed edge).
- **Builds on:** Dispatch 3's renderer (node-row emission) + the command's `refs` / `contractHash` inputs.
- **Hands to:** The three overlay cases (DB-behind, everything-aligned, detached-contract) render per mockup; goldens committed.
- **Focus:** Overlay decoration + alignment. Reuses the existing styler rather than reintroducing per-marker glyph tags.

### Dispatch 6: glyph-mode / ASCII fallback + reference doc

- **Outcome:** The renderer takes a glyph set; an ASCII set is selected by `--ascii` / non-UTF-terminal detection (injected pure via `TerminalUI`), orthogonal to `--no-color`. The full fixture gallery has UTF + ASCII goldens. `docs/reference/migration-graph-rendering.md` documents the visual language.
- **Builds on:** Dispatches 3–5 (the complete renderer).
- **Hands to:** Slice-DoD: full gallery (UTF + ASCII) goldens green; `--json`/`--dot` + `migration status` regression-green; reference doc committed.
- **Focus:** Glyph-set indirection + docs. No new topology behaviour.
